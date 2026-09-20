//! End-to-end watcher behaviour against a real temp directory and a real `notify` backend.
//!
//! **Every path assertion canonicalises both sides.** On macOS `std::env::temp_dir()` is
//! `/var/folders/...` while the resolved path is `/private/var/folders/...`, and notify reports the
//! resolved form — so a test comparing an event against the un-resolved temp path fails on exactly
//! the machines the Rust gates run on, while looking correct.

use std::path::PathBuf;
use std::time::Duration;
use tendril_core::watcher::{ChangeEvent, ChangeTarget, FsWatcher, WatchConfig};
use tokio::sync::broadcast;

/// Long enough that a two-file burst always lands inside one window even when FSEvents batches with
/// its own latency, short enough to keep the suite quick. The property under test is "one burst, one
/// notification", not the exact millisecond count.
const WINDOW: Duration = Duration::from_millis(500);

/// A canonicalised throwaway Tendril home, removed on drop.
struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-watch-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(home.join("Plans")).expect("create Plans");
        std::fs::create_dir_all(home.join("Inbox")).expect("create Inbox");
        let home = std::fs::canonicalize(&home).expect("canonicalize home");
        Self { home }
    }

    fn plans_dir(&self) -> PathBuf {
        self.home.join("Plans")
    }

    fn config_path(&self) -> PathBuf {
        self.home.join("config.yaml")
    }

    fn config(&self) -> WatchConfig {
        let mut cfg = WatchConfig::new(
            self.plans_dir(),
            self.config_path(),
            self.home.join("Inbox"),
        );
        cfg.plans_debounce = WINDOW;
        cfg.config_debounce = WINDOW;
        // The poll safety net would otherwise inject full-rescan events into the assertions.
        cfg.rescan_interval = Duration::from_secs(3600);
        cfg
    }

    /// A plan folder complete with the subdirectories the watcher registers.
    fn write_plan(&self, folder: &str) -> PathBuf {
        let plan = self.plans_dir().join(folder);
        std::fs::create_dir_all(plan.join("Revisions")).expect("create Revisions");
        std::fs::create_dir_all(plan.join("Verification")).expect("create Verification");
        // Foreign writes throughout: `std::fs::write` leaves no self-write note, so the watcher
        // treats these exactly as it would a CLI or promptware write.
        std::fs::write(plan.join("plan.yaml"), "state: Draft\n").expect("write plan.yaml");
        plan
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let temp = std::fs::canonicalize(std::env::temp_dir()).expect("canonicalize temp dir");
        assert!(self.home.starts_with(&temp), "fixture escaped the temp dir");
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// Waits up to `budget` for one event.
async fn next_event(
    rx: &mut broadcast::Receiver<ChangeEvent>,
    budget: Duration,
) -> Option<ChangeEvent> {
    tokio::time::timeout(budget, rx.recv()).await.ok()?.ok()
}

/// Collects every event delivered within `budget`.
async fn drain(rx: &mut broadcast::Receiver<ChangeEvent>, budget: Duration) -> Vec<ChangeEvent> {
    let deadline = tokio::time::Instant::now() + budget;
    let mut out = Vec::new();
    while let Some(remaining) = deadline.checked_duration_since(tokio::time::Instant::now()) {
        match next_event(rx, remaining).await {
            Some(e) => out.push(e),
            None => break,
        }
    }
    out
}

#[tokio::test]
async fn plan_yaml_write_emits_exactly_one_event() {
    let fx = Fixture::new("one-event");
    let plan = fx.write_plan("00576-Foo");

    let (tx, mut rx) = broadcast::channel(64);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    // Registration is synchronous, but FSEvents needs a moment before it reports anything.
    tokio::time::sleep(Duration::from_millis(300)).await;

    // One logical mutation, four files — the shape every plan write has.
    std::fs::write(plan.join("plan.yaml"), "state: Executing\n").unwrap();
    std::fs::write(plan.join("Revisions").join("001.md"), "# Plan\n").unwrap();
    std::fs::write(plan.join("Verification").join("RustBuild.md"), "ok\n").unwrap();
    std::fs::write(fx.plans_dir().join(".counter"), "577\n").unwrap();

    let first = next_event(&mut rx, Duration::from_secs(3))
        .await
        .expect("expected a change event");
    // `.counter` lives at the plans root, so a burst touching it and a plan folder escalates — the
    // assertion is on the count, and on the target being a plans change.
    assert!(matches!(first.target, ChangeTarget::Plans { .. }));

    let rest = drain(&mut rx, Duration::from_millis(900)).await;
    assert!(
        rest.is_empty(),
        "a single burst must cost one notification, got {} more: {:?}",
        rest.len(),
        rest
    );
}

/// A read of the plans directory must not look like a write to it.
///
/// This is the Linux livelock in miniature. notify's inotify backend watches with `IN_OPEN` set, and
/// inotify reports that against the watched directory itself, while the watcher's own
/// `register_paths` reads `Plans/` to enumerate plan folders - so before the fix a top-level event
/// scheduled a catch-up, the catch-up's
/// `read_dir` produced an `Access(Open)` on `Plans/`, and that event scheduled the next catch-up. It
/// never terminated: one four-file write produced 6,755 events and 5,871 spurious notifications in
/// six seconds, so a live daemon spun a core and republished the mirror forever, with `None`
/// absorbing every folder name on the way through the coalescer.
///
/// Written as "a reader outside the daemon opens the directory" because that is the shape a test can
/// state without reaching into the watcher's internals, and it is the same inotify event. It passes
/// trivially on macOS and Windows, whose backends never construct an `EventKind::Access` - the
/// regression it guards can only reappear on Linux, which is exactly where nobody runs the suite by
/// hand.
#[tokio::test]
async fn reading_the_plans_directory_is_not_a_change_to_it() {
    let fx = Fixture::new("read-not-write");
    fx.write_plan("00576-Foo");

    let (tx, mut rx) = broadcast::channel(64);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Enumerating a watched directory, which is all `register_paths` does.
    for _ in 0..3 {
        let _: Vec<_> = std::fs::read_dir(fx.plans_dir())
            .expect("read plans dir")
            .filter_map(|e| e.ok())
            .collect();
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let events = drain(&mut rx, Duration::from_millis(1500)).await;
    assert!(
        events.is_empty(),
        "reading the plans directory must announce nothing, got {:?}",
        events
    );
}

#[tokio::test]
async fn new_plan_folder_is_picked_up_after_creation() {
    let fx = Fixture::new("new-folder");

    let (tx, mut rx) = broadcast::channel(64);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    // The folder appears empty first and its plan.yaml lands later, inside a folder nobody was
    // watching when it was created. The self-heal re-registration is what closes that race.
    let plan = fx.plans_dir().join("00600-Later");
    std::fs::create_dir_all(&plan).unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    std::fs::write(plan.join("plan.yaml"), "state: Draft\n").unwrap();

    let mut named = false;
    for _ in 0..6 {
        let Some(event) = next_event(&mut rx, Duration::from_secs(3)).await else {
            break;
        };
        match event.target {
            ChangeTarget::Plans {
                folder: Some(ref f),
            } if f == "00600-Later" => {
                named = true;
                break;
            }
            // A full rescan from a catch-up pass is a valid intermediate; keep looking.
            _ => continue,
        }
    }
    assert!(named, "no event named the newly created plan folder");
}

#[tokio::test]
async fn worktree_churn_emits_no_events() {
    let fx = Fixture::new("worktree-churn");
    let plan = fx.write_plan("00576-Foo");

    let (tx, mut rx) = broadcast::channel(256);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Nothing like the real thing's volume, but the same shape: a checkout writing a tree of files
    // inside the plan's worktree. Watching this is what destabilised upstream's machine.
    let repo = plan.join("Worktrees").join("repo").join("src");
    std::fs::create_dir_all(&repo).unwrap();
    for i in 0..200 {
        std::fs::write(repo.join(format!("file{i}.rs")), "fn main() {}\n").unwrap();
    }

    let events = drain(&mut rx, Duration::from_millis(1500)).await;
    assert!(
        events.is_empty(),
        "worktree churn must be invisible to the watcher, got {:?}",
        events
    );
}

#[tokio::test]
async fn config_write_emits_config_event() {
    let fx = Fixture::new("config");
    std::fs::write(fx.config_path(), "codingAgent: claude\n").unwrap();

    let (tx, mut rx) = broadcast::channel(64);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    std::fs::write(fx.config_path(), "codingAgent: codex\n").unwrap();

    let event = next_event(&mut rx, Duration::from_secs(3))
        .await
        .expect("expected a config event");
    assert_eq!(event.target, ChangeTarget::Config);

    // A sibling file in the same watched directory is not a config change: the watcher registers the
    // directory but the classification pass filters down to the one file name.
    std::fs::write(fx.home.join("config.yaml.backup"), "old\n").unwrap();
    let rest = drain(&mut rx, Duration::from_millis(1200)).await;
    assert!(
        rest.is_empty(),
        "config.yaml.backup must not be reported, got {:?}",
        rest
    );
}

#[tokio::test]
async fn a_self_written_plan_yaml_is_announced_exactly_once() {
    let fx = Fixture::new("self-write");
    let plan = fx.write_plan("00576-Foo");

    let (tx, mut rx) = broadcast::channel(64);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    // The daemon's own write. Both halves of the design are under test here: the watcher echo is
    // suppressed, *and* the write path re-announces the write itself — so a second app window, a
    // second desktop instance and the VS Code extension all still hear about it. Getting only the
    // suppression (which is where this started) means a daemon-side write is announced to nobody
    // until the 30s rescan, and a rescan does not even fire for an in-place edit.
    tendril_core::fs_lock::write_atomic(&plan.join("plan.yaml"), b"state: Review\n").unwrap();

    let event = next_event(&mut rx, Duration::from_secs(3))
        .await
        .expect("a daemon write must still reach clients");
    assert_eq!(
        event.target,
        ChangeTarget::Plans {
            folder: Some("00576-Foo".to_string())
        }
    );

    // One write, one notification: the announcement goes through the same coalescer as watcher
    // events, so the suppressed echo cannot arrive as a second event.
    let rest = drain(&mut rx, Duration::from_millis(1500)).await;
    assert!(
        rest.is_empty(),
        "our own write must be announced once, not once per route: {:?}",
        rest
    );
}

#[tokio::test]
async fn a_daemon_write_the_os_watcher_cannot_see_is_still_announced() {
    let fx = Fixture::new("self-write-unwatched");
    let plan = fx.write_plan("00576-Foo");
    // `Notes/` is inside a plan folder but is not one of the directories `watch_paths` registers, and
    // every registration is non-recursive — so no OS event for this write can reach the watcher. The
    // event asserted below therefore cannot have come from the filesystem: the write path is the only
    // possible source, which is what makes this test specific to the announcement rather than to the
    // debounce or to FSEvents timing.
    let notes = plan.join("Notes");
    std::fs::create_dir_all(&notes).expect("create Notes");

    let (tx, mut rx) = broadcast::channel(64);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    tendril_core::fs_lock::write_atomic(&notes.join("note.md"), b"# Note\n").unwrap();

    let event = next_event(&mut rx, Duration::from_secs(3))
        .await
        .expect("the write path must announce a write the OS watcher never reports");
    assert_eq!(
        event.target,
        ChangeTarget::Plans {
            folder: Some("00576-Foo".to_string())
        }
    );
}

#[tokio::test]
async fn a_daemon_write_outside_the_watched_tree_is_not_announced() {
    let fx = Fixture::new("self-write-foreign");
    let (tx, mut rx) = broadcast::channel(64);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Every `write_atomic` in the process reaches the announcement, including the ones for logs,
    // caches and job artifacts. Classification is what keeps those off the change stream, and it has
    // to hold for the announced path exactly as it does for a raw event.
    let logs = fx.home.join("Logs").join("Jobs");
    std::fs::create_dir_all(&logs).expect("create Logs");
    tendril_core::fs_lock::write_atomic(&logs.join("00001.raw.log"), b"line\n").unwrap();

    let events = drain(&mut rx, Duration::from_millis(1200)).await;
    assert!(
        events.is_empty(),
        "a write outside Plans/, config.yaml and Inbox/ is not a change event: {:?}",
        events
    );
}

#[tokio::test]
async fn notify_changed_goes_through_the_coalescer() {
    let fx = Fixture::new("notify-changed");
    fx.write_plan("00576-Foo");

    let (tx, mut rx) = broadcast::channel(64);
    let watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Three in-process notifications for one plan cost one event, exactly as three watcher events
    // would: the write path and the watcher share the debounce.
    for _ in 0..3 {
        watcher.notify_changed(ChangeTarget::Plans {
            folder: Some("00576-Foo".to_string()),
        });
    }

    let event = next_event(&mut rx, Duration::from_secs(3))
        .await
        .expect("expected an event from notify_changed");
    assert_eq!(
        event.target,
        ChangeTarget::Plans {
            folder: Some("00576-Foo".to_string())
        }
    );
    assert!(drain(&mut rx, Duration::from_millis(900)).await.is_empty());
}
