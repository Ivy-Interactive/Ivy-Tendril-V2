//! Filesystem watching for the Plans folder, `config.yaml` and the inbox.
//!
//! Port of upstream Tendril's `PlanWatcherService` / `InboxWatcherService` / `ConfigService` watcher
//! trio. Four of their behaviours are requirements rather than optimisations, and each lives in its
//! own file here so it can be tested in isolation:
//!
//! - [`coalescer`] — one logical mutation touches `plan.yaml`, `Revisions/NNN.md`, `.counter` and
//!   sometimes `Verification/*.md`. Per-event pushes cause refresh storms, so a burst collapses into
//!   one notification, and a burst naming two folders escalates to a single full rescan.
//! - [`ignore`] — `Worktrees/` must never be watched. Upstream's watcher buffer overflowed and
//!   destabilised the machine when worktree churn reached it.
//! - [`self_writes`] — a write by this process must not loop back into a reload by this process. The
//!   other half of that rule lives in [`announce_self_write`]: suppressing the echo without
//!   re-announcing the write would leave a daemon-side write announced to nobody.
//! - [`watch_paths`] — an explicit set of **non-recursive** registrations. There is no code path in
//!   this module that passes [`RecursiveMode::Recursive`], and `watch_paths_never_include_worktrees`
//!   is the regression test that keeps it that way.

pub mod coalescer;
pub mod ignore;
pub mod self_writes;

pub use coalescer::Coalescer;
pub use ignore::should_ignore;

use crate::error::{Result, TendrilError};
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

/// The discriminator clients key on, on both the WebSocket and the SSE stream.
pub const CHANGE_EVENT_TYPE: &str = "fs.change";

/// Upper bound on per-plan-folder registrations.
///
/// inotify watch descriptors are a per-user budget on Linux, and an installation with thousands of
/// plans would exhaust it. Beyond the cap the periodic rescan is what keeps the mirror honest.
pub const MAX_WATCHED_PLAN_FOLDERS: usize = 500;

/// Default debounce for plan changes, matching `PlanWatcherService`.
pub const DEFAULT_PLANS_DEBOUNCE: Duration = Duration::from_millis(500);
/// Default debounce for config changes, matching `ConfigService`.
pub const DEFAULT_CONFIG_DEBOUNCE: Duration = Duration::from_millis(300);
/// Default interval of the poll safety net.
pub const DEFAULT_RESCAN_INTERVAL: Duration = Duration::from_secs(30);

/// Catch-up passes scheduled after a top-level `Plans/` event.
///
/// A brand-new plan folder fires while it is still empty, and its `plan.yaml` lands a moment later
/// inside a folder nobody is watching yet. These two passes are upstream's self-heal for that race.
const CATCHUP_DELAYS: [Duration; 2] = [Duration::from_millis(1000), Duration::from_millis(4000)];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEvent {
    /// Always [`CHANGE_EVENT_TYPE`].
    pub r#type: &'static str,
    pub target: ChangeTarget,
}

impl ChangeEvent {
    pub fn new(target: ChangeTarget) -> Self {
        Self {
            r#type: CHANGE_EVENT_TYPE,
            target,
        }
    }

    /// The event a client is sent when it has fallen too far behind to be told what changed.
    pub fn full_rescan() -> Self {
        Self::new(ChangeTarget::Plans { folder: None })
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChangeTarget {
    /// `folder: None` is a full rescan, exactly like `PlanWatcherService`'s null folder.
    Plans {
        folder: Option<String>,
    },
    Config,
    Inbox,
}

#[derive(Debug, Clone)]
pub struct WatchConfig {
    pub plans_dir: PathBuf,
    pub config_path: PathBuf,
    pub inbox_dir: PathBuf,
    pub plans_debounce: Duration,
    pub config_debounce: Duration,
    pub rescan_interval: Duration,
}

impl WatchConfig {
    /// Config for a Tendril home: `<home>/Inbox`, the given plans dir, the given config file.
    pub fn new(plans_dir: PathBuf, config_path: PathBuf, inbox_dir: PathBuf) -> Self {
        Self {
            plans_dir,
            config_path,
            inbox_dir,
            plans_debounce: DEFAULT_PLANS_DEBOUNCE,
            config_debounce: DEFAULT_CONFIG_DEBOUNCE,
            rescan_interval: DEFAULT_RESCAN_INTERVAL,
        }
    }

    /// Resolves symlinks in every configured path that already exists.
    ///
    /// notify reports resolved paths, so without this the classification below silently fails to
    /// match on macOS, where `/var/folders/...` is a symlink to `/private/var/folders/...`. Missing
    /// paths are left as-is: they may appear later, and the rescan re-canonicalises then.
    pub fn canonicalized(&self) -> WatchConfig {
        fn resolve(p: &Path) -> PathBuf {
            std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
        }
        // The config file itself may not exist yet; resolve its directory and keep the file name.
        let config_path = match (self.config_path.parent(), self.config_path.file_name()) {
            (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => {
                resolve(parent).join(name)
            }
            _ => self.config_path.clone(),
        };
        WatchConfig {
            plans_dir: resolve(&self.plans_dir),
            config_path,
            inbox_dir: resolve(&self.inbox_dir),
            plans_debounce: self.plans_debounce,
            config_debounce: self.config_debounce,
            rescan_interval: self.rescan_interval,
        }
    }
}

/// The set of directories to register with notify, in a stable order.
///
/// Every entry is watched **non-recursively**. Nothing under `Worktrees/`, `Artifacts/` or `Logs/`
/// is ever returned, which is what stops execution-time churn from reaching the watcher at all.
pub fn watch_paths(cfg: &WatchConfig) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if cfg.plans_dir.is_dir() {
        // The plans root catches created/deleted/renamed plan folders — the equivalent of upstream's
        // `NotifyFilters.DirectoryName` registration.
        paths.push(cfg.plans_dir.clone());

        let mut folders: Vec<PathBuf> = match std::fs::read_dir(&cfg.plans_dir) {
            Ok(entries) => entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .map(|e| e.path())
                .filter(|p| !should_ignore(p))
                .collect(),
            Err(e) => {
                tracing::warn!("Cannot enumerate {}: {}", cfg.plans_dir.display(), e);
                Vec::new()
            }
        };

        // Newest first: plan folders are `NNNNN-Title`, so a descending name sort is a descending ID
        // sort, and recent plans are the ones a user is looking at.
        folders.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

        if folders.len() > MAX_WATCHED_PLAN_FOLDERS {
            tracing::warn!(
                "{} plan folders exceed the {} watch cap; the {} oldest rely on the {}s rescan instead",
                folders.len(),
                MAX_WATCHED_PLAN_FOLDERS,
                folders.len() - MAX_WATCHED_PLAN_FOLDERS,
                cfg.rescan_interval.as_secs()
            );
            folders.truncate(MAX_WATCHED_PLAN_FOLDERS);
        }

        for folder in folders {
            // The folder root carries `plan.yaml` and `.counter`-adjacent writes.
            paths.push(folder.clone());
            for sub in ["Revisions", "Verification"] {
                let sub_path = folder.join(sub);
                if sub_path.is_dir() {
                    paths.push(sub_path);
                }
            }
        }
    }

    // notify watches directories, so the config file is watched via its parent and filtered by the
    // classification pass below — mirroring `new FileSystemWatcher(directory, "config.yaml")`.
    if let Some(parent) = cfg.config_path.parent() {
        if parent.is_dir() && !paths.iter().any(|p| p == parent) {
            paths.push(parent.to_path_buf());
        }
    }

    if cfg.inbox_dir.is_dir() && !paths.iter().any(|p| p == &cfg.inbox_dir) {
        paths.push(cfg.inbox_dir.clone());
    }

    paths
}

/// Which change class an event path belongs to, or `None` when it belongs to none of them.
///
/// Takes the path exactly as delivered, so callers that compare against a configured root must have
/// canonicalised both sides first (see [`WatchConfig::canonicalized`]).
pub fn classify_path(cfg: &WatchConfig, path: &Path) -> Option<ChangeTarget> {
    if path == cfg.config_path {
        return Some(ChangeTarget::Config);
    }

    if path.starts_with(&cfg.inbox_dir) && path != cfg.inbox_dir {
        return Some(ChangeTarget::Inbox);
    }

    if path == cfg.plans_dir {
        return Some(ChangeTarget::Plans { folder: None });
    }

    if let Ok(rel) = path.strip_prefix(&cfg.plans_dir) {
        let folder = rel
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .map(|s| s.to_string());
        return Some(ChangeTarget::Plans { folder });
    }

    None
}

/// Messages the driving task consumes.
enum WatchMsg {
    /// A raw path from notify's OS callback thread.
    Raw(PathBuf),
    /// An in-process notification from [`FsWatcher::notify_changed`].
    Direct(ChangeTarget),
    /// A path this process just wrote, from [`announce_self_write`]. Classified like a raw event but
    /// exempt from the self-write check, that check being the very reason it has to be replayed.
    SelfWrite(PathBuf),
}

/// Live watchers in this process, so the write path can announce a write without a handle.
///
/// [`self_writes`] suppresses the watcher echo of our own writes, and the compensating notification
/// has to come from the write path itself. Threading an `FsWatcher` to every writer would mean an
/// `AppState` field, a plumbing change in each of the plan, config and inbox write paths, and a
/// silent no-op wherever one was forgotten — which is the state this replaced. A registry keyed off
/// the one function every self-write already calls cannot be forgotten.
///
/// A `Vec` rather than an `Option`: tests run several watchers in one process, and a stale entry
/// would send a live watcher's events into a dead one's channel.
type Notifiers = std::sync::Mutex<Vec<(u64, mpsc::UnboundedSender<WatchMsg>)>>;

fn notifiers() -> &'static Notifiers {
    static NOTIFIERS: std::sync::OnceLock<Notifiers> = std::sync::OnceLock::new();
    NOTIFIERS.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

/// Re-announces a path this process just wrote to every live watcher.
///
/// Called from [`self_writes::note_self_write`], which `write_atomic` already calls on every daemon
/// write — so this is the port of V1's `IPlanWatcherService.NotifyChanged` call from the write paths,
/// made once, in the one place that cannot be bypassed. The suppressed echo is replayed as a
/// [`WatchMsg::SelfWrite`], is classified and coalesced exactly like a foreign event, and so costs
/// one notification per burst however many files the write touched.
///
/// A no-op in a process with no watcher — every CLI invocation, and any daemon that lost the master
/// race — which is why it takes no handle and returns nothing.
pub(crate) fn announce_self_write(path: &Path) {
    let mut guard = match notifiers().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    // A closed channel means that watcher's task is gone; drop it rather than keep retrying.
    guard.retain(|(_, tx)| tx.send(WatchMsg::SelfWrite(path.to_path_buf())).is_ok());
}

/// A live filesystem watcher. Stops watching when dropped.
pub struct FsWatcher {
    msg_tx: mpsc::UnboundedSender<WatchMsg>,
    task: tokio::task::JoinHandle<()>,
    /// This watcher's entry in [`notifiers`], removed on drop.
    notifier_id: u64,
}

impl Drop for FsWatcher {
    fn drop(&mut self) {
        // Deregistered before the abort: `task.abort()` is not synchronous, so leaving the entry in
        // place would keep handing writes to a task that will never read them again.
        if let Ok(mut guard) = notifiers().lock() {
            guard.retain(|(id, _)| *id != self.notifier_id);
        }
        // Aborting drops the task's future, which drops the notify watcher it owns and so
        // deregisters every path.
        self.task.abort();
    }
}

impl FsWatcher {
    /// Spawns the notify watcher and the coalescing task. Events land on `tx`.
    ///
    /// Succeeds with a live watcher even when a watched path is missing: the rescan picks it up once
    /// it appears, and a daemon that refuses to start because `Inbox/` does not exist yet would be
    /// worse than one running without realtime push for that path.
    pub fn spawn(cfg: WatchConfig, tx: broadcast::Sender<ChangeEvent>) -> Result<FsWatcher> {
        let cfg = cfg.canonicalized();
        let (msg_tx, mut msg_rx) = mpsc::unbounded_channel::<WatchMsg>();

        let raw_tx = msg_tx.clone();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            match res {
                Ok(event) => {
                    // A read is not a change, and on Linux treating it as one is a livelock rather
                    // than merely noise. inotify reports `IN_OPEN`/`IN_ACCESS`/`IN_CLOSE` against the
                    // *watched directory itself*, and `register_paths` reads `Plans/` to enumerate
                    // plan folders. So: any top-level event schedules a catch-up pass, the catch-up
                    // calls `register_paths`, its `read_dir` makes inotify emit `Access(Open)` on
                    // `Plans/`, that path classifies as `Plans { folder: None }` and is top-level, so
                    // it schedules another catch-up - which reads the directory again. Measured on
                    // Linux before this filter: one four-file write produced 6,755 events and 5,871
                    // spurious `Plans` notifications in the six seconds a test ran, and the loop has
                    // no exit, so a live daemon would spin a core and republish the plans mirror
                    // forever. `None` is absorbing in the coalescer, so it also erases the folder name
                    // from every event a client would otherwise have been able to act on narrowly.
                    //
                    // Nothing is lost by dropping these. A write still arrives as `Create`/`Modify`
                    // (verified against notify 8.2.0's inotify backend: `std::fs::write` emits
                    // `Create(File)`, `Modify(Data)` and `Access(Close(Write))` - the first two carry
                    // the same path). The fsevent and windows backends never construct an
                    // `EventKind::Access` at all, so on macOS and Windows this filter is a no-op.
                    if matches!(event.kind, notify::EventKind::Access(_)) {
                        return;
                    }
                    for path in event.paths {
                        // A closed channel means the driving task is gone; nothing to do but drop.
                        let _ = raw_tx.send(WatchMsg::Raw(path));
                    }
                }
                Err(e) => tracing::warn!("Filesystem watcher error: {}", e),
            }
        })
        .map_err(|e| TendrilError::Watcher(format!("Cannot create filesystem watcher: {e}")))?;

        let mut watched: HashSet<PathBuf> = HashSet::new();
        register_paths(&mut watcher, &cfg, &mut watched);
        tracing::info!(
            "Filesystem watcher registered {} non-recursive paths under {}",
            watched.len(),
            cfg.plans_dir.display()
        );

        let task = tokio::spawn(async move {
            // Moved in so the watcher lives exactly as long as this task.
            let mut watcher = watcher;
            let mut watched = watched;
            let mut coalescer = Coalescer::new(cfg.plans_debounce, cfg.config_debounce);
            let mut catchups: Vec<Instant> = Vec::new();
            let mut rescan_at = Instant::now() + cfg.rescan_interval;

            loop {
                let deadline = [coalescer.next_deadline(), catchups.iter().min().copied()]
                    .into_iter()
                    .flatten()
                    .min()
                    .unwrap_or(rescan_at)
                    .min(rescan_at);

                tokio::select! {
                    msg = msg_rx.recv() => {
                        match msg {
                            None => break, // every sender dropped: the FsWatcher is gone
                            Some(WatchMsg::Raw(path)) => {
                                let now = Instant::now();
                                if should_ignore(&path) {
                                    continue;
                                }
                                // Our own write already notified clients directly; reacting to its
                                // watcher echo as well is how a write/reload loop starts.
                                if self_writes::was_self_written(&path, now) {
                                    tracing::trace!("Ignoring self-written {}", path.display());
                                    continue;
                                }
                                let Some(target) = classify_path(&cfg, &path) else {
                                    continue;
                                };
                                let is_top_level = path.parent() == Some(cfg.plans_dir.as_path())
                                    || path == cfg.plans_dir;
                                coalescer.push(target, now);
                                if is_top_level {
                                    // A new folder's contents land after the folder itself, so
                                    // re-register now and schedule the catch-up passes.
                                    register_paths(&mut watcher, &cfg, &mut watched);
                                    for delay in CATCHUP_DELAYS {
                                        catchups.push(now + delay);
                                    }
                                }
                            }
                            Some(WatchMsg::Direct(target)) => {
                                coalescer.push(target, Instant::now());
                            }
                            Some(WatchMsg::SelfWrite(path)) => {
                                let now = Instant::now();
                                if should_ignore(&path) {
                                    continue;
                                }
                                // The write path passes the path it was handed, which on macOS is
                                // typically the `/var/folders` alias of a `/private/var/folders`
                                // config root. Classification is a prefix comparison against
                                // canonicalised roots, so without this every self-write of a temp
                                // home classifies as `None` and is silently dropped.
                                let path = resolve_for_classification(&path);
                                let Some(target) = classify_path(&cfg, &path) else {
                                    continue;
                                };
                                coalescer.push(target, now);
                                // The write may have created the folder it landed in, which nothing
                                // is watching yet. Registering here is enough on its own — unlike the
                                // raw path, this write has already been announced, so there is
                                // nothing for a catch-up pass to recover.
                                if path.parent() == Some(cfg.plans_dir.as_path())
                                    || path.parent().and_then(|p| p.parent())
                                        == Some(cfg.plans_dir.as_path())
                                {
                                    register_paths(&mut watcher, &cfg, &mut watched);
                                }
                            }
                        }
                    }
                    _ = tokio::time::sleep_until(deadline.into()) => {}
                }

                let now = Instant::now();

                // Catch-up passes: re-register and re-announce the plans class so a `plan.yaml`
                // written into a folder we were not yet watching is not lost.
                let due: Vec<Instant> = catchups.iter().copied().filter(|d| *d <= now).collect();
                if !due.is_empty() {
                    catchups.retain(|d| *d > now);
                    register_paths(&mut watcher, &cfg, &mut watched);
                    coalescer.push(ChangeTarget::Plans { folder: None }, now);
                }

                if now >= rescan_at {
                    rescan_at = now + cfg.rescan_interval;
                    let before = watched.len();
                    let changed = register_paths(&mut watcher, &cfg, &mut watched);
                    // Announce a rescan only when it can tell a client something: either the set of
                    // watched paths moved, or the cap is biting so some folders have no watch at all
                    // and a periodic sweep is their only route to the mirror.
                    let capped = watched.len() >= MAX_WATCHED_PLAN_FOLDERS;
                    if changed || capped {
                        tracing::debug!(
                            "Rescan: {} watched paths (was {}), capped={}",
                            watched.len(),
                            before,
                            capped
                        );
                        coalescer.push(ChangeTarget::Plans { folder: None }, now);
                    }
                }

                for event in coalescer.poll(now) {
                    // Send failure only means nobody is subscribed right now.
                    let _ = tx.send(event);
                }
            }
        });

        // Registered only once the task exists, so an announcement can never reach a channel with
        // nothing reading it.
        static NEXT_NOTIFIER_ID: std::sync::atomic::AtomicU64 =
            std::sync::atomic::AtomicU64::new(1);
        let notifier_id = NEXT_NOTIFIER_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        match notifiers().lock() {
            Ok(mut guard) => guard.push((notifier_id, msg_tx.clone())),
            Err(poisoned) => poisoned.into_inner().push((notifier_id, msg_tx.clone())),
        }

        Ok(FsWatcher {
            msg_tx,
            task,
            notifier_id,
        })
    }

    /// In-process notification: the port of `IPlanWatcherService.NotifyChanged`.
    ///
    /// Goes through the same coalescer as watcher events, so a daemon write and the watcher event it
    /// provokes cost one notification between them rather than two.
    pub fn notify_changed(&self, target: ChangeTarget) {
        let _ = self.msg_tx.send(WatchMsg::Direct(target));
    }
}

/// Resolves symlinks in a path's parent so it can be compared against a canonicalised root.
///
/// The file itself is deliberately not canonicalised: `note_self_write` runs *before*
/// `write_atomic`'s rename, so for a brand-new file there is nothing to resolve yet, and
/// `canonicalize` would fail on exactly the case that matters most.
fn resolve_for_classification(path: &Path) -> PathBuf {
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => {
            match std::fs::canonicalize(parent) {
                Ok(resolved) => resolved.join(name),
                Err(_) => path.to_path_buf(),
            }
        }
        _ => path.to_path_buf(),
    }
}

/// Diffs [`watch_paths`] against the live registration set, returning whether anything changed.
fn register_paths(
    watcher: &mut notify::RecommendedWatcher,
    cfg: &WatchConfig,
    watched: &mut HashSet<PathBuf>,
) -> bool {
    let desired: HashSet<PathBuf> = watch_paths(cfg).into_iter().collect();
    let mut changed = false;

    for path in desired.difference(watched).cloned().collect::<Vec<_>>() {
        // NonRecursive, always. A recursive registration anywhere under Plans/ would pull worktree
        // churn into the watcher, which is the failure this module is shaped around.
        match watcher.watch(&path, RecursiveMode::NonRecursive) {
            Ok(()) => {
                watched.insert(path);
                changed = true;
            }
            Err(e) => tracing::warn!("Cannot watch {}: {}", path.display(), e),
        }
    }

    for path in watched.difference(&desired).cloned().collect::<Vec<_>>() {
        let _ = watcher.unwatch(&path);
        watched.remove(&path);
        changed = true;
    }

    changed
}
