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
async fn self_written_plan_yaml_does_not_wake_the_watcher() {
    let fx = Fixture::new("self-write");
    let plan = fx.write_plan("00576-Foo");

    let (tx, mut rx) = broadcast::channel(64);
    let _watcher = FsWatcher::spawn(fx.config(), tx).expect("spawn watcher");
    tokio::time::sleep(Duration::from_millis(300)).await;

    // The daemon's own write. Clients still hear about it — via `notify_changed` from the write path
    // — but the watcher echo must not feed back into the daemon's own re-sync.
    tendril_core::fs_lock::write_atomic(&plan.join("plan.yaml"), b"state: Review\n").unwrap();

    let events = drain(&mut rx, Duration::from_millis(1500)).await;
    assert!(
        events.is_empty(),
        "our own write must not come back as a foreign change, got {:?}",
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
