//! Pure watcher logic: coalescing, escalation, ignore rules and watch-path computation.
//!
//! Nothing here touches a real watcher or sleeps. The clock is arithmetic on a single `Instant`, so
//! a debounce assertion is exact rather than timing-dependent.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tendril_core::watcher::{
    self_writes, should_ignore, watch_paths, ChangeEvent, ChangeTarget, Coalescer, WatchConfig,
    MAX_WATCHED_PLAN_FOLDERS,
};

const PLANS_WINDOW: Duration = Duration::from_millis(500);
const CONFIG_WINDOW: Duration = Duration::from_millis(300);

fn coalescer() -> Coalescer {
    Coalescer::new(PLANS_WINDOW, CONFIG_WINDOW)
}

fn plans(folder: Option<&str>) -> ChangeTarget {
    ChangeTarget::Plans {
        folder: folder.map(|f| f.to_string()),
    }
}

/// A fixture directory under the temp dir, canonicalised so macOS's `/var` -> `/private/var`
/// symlink cannot make a path comparison fail.
struct TempTree {
    path: PathBuf,
}

impl TempTree {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-watcher-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).expect("create fixture dir");
        let path = std::fs::canonicalize(&path).expect("canonicalize fixture dir");
        Self { path }
    }
}

impl Drop for TempTree {
    fn drop(&mut self) {
        assert!(self
            .path
            .starts_with(std::fs::canonicalize(std::env::temp_dir()).unwrap()));
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn coalesces_burst_for_one_plan_into_single_event() {
    let mut c = coalescer();
    let t0 = Instant::now();

    // One logical plan mutation: plan.yaml, a revision, .counter, a verification report, a re-write.
    for i in 0..5 {
        c.push(plans(Some("00576-Foo")), t0 + Duration::from_millis(i * 20));
    }

    let events = c.poll(t0 + PLANS_WINDOW);
    assert_eq!(events, vec![ChangeEvent::new(plans(Some("00576-Foo")))]);
    assert!(c.poll(t0 + PLANS_WINDOW * 3).is_empty());
}

#[test]
fn escalates_to_full_rescan_for_two_folders() {
    let mut c = coalescer();
    let t0 = Instant::now();

    c.push(plans(Some("00576-Foo")), t0);
    c.push(plans(Some("00577-Bar")), t0 + Duration::from_millis(10));

    let events = c.poll(t0 + PLANS_WINDOW);
    assert_eq!(
        events,
        vec![ChangeEvent::new(plans(None))],
        "a burst naming two folders costs one full rescan, not two targeted refreshes"
    );
}

#[test]
fn full_rescan_overrides_pending_folder() {
    let mut c = coalescer();
    let t0 = Instant::now();

    c.push(plans(Some("00576-Foo")), t0);
    c.push(plans(None), t0 + Duration::from_millis(10));
    // A later specific folder must not narrow an already-escalated burst back down.
    c.push(plans(Some("00576-Foo")), t0 + Duration::from_millis(20));

    assert_eq!(
        c.poll(t0 + PLANS_WINDOW),
        vec![ChangeEvent::new(plans(None))]
    );
}

#[test]
fn debounce_defers_until_window_elapses() {
    let mut c = coalescer();
    let t0 = Instant::now();

    c.push(plans(Some("00576-Foo")), t0);

    assert!(c.poll(t0).is_empty());
    assert!(c
        .poll(t0 + PLANS_WINDOW - Duration::from_millis(1))
        .is_empty());
    assert_eq!(c.next_deadline(), Some(t0 + PLANS_WINDOW));

    let at_window = t0 + PLANS_WINDOW;
    assert_eq!(
        c.poll(at_window),
        vec![ChangeEvent::new(plans(Some("00576-Foo")))]
    );
    // Emitting clears the pending state, so polling the same instant again yields nothing.
    assert!(c.poll(at_window).is_empty());
    assert_eq!(c.next_deadline(), None);
}

#[test]
fn sustained_stream_emits_once_per_window() {
    let mut c = coalescer();
    let t0 = Instant::now();
    let step = Duration::from_millis(50);
    let total = PLANS_WINDOW * 5;

    let mut emitted = 0;
    let mut elapsed = Duration::ZERO;
    while elapsed <= total {
        c.push(plans(Some("00576-Foo")), t0 + elapsed);
        emitted += c.poll(t0 + elapsed).len();
        elapsed += step;
    }

    // The guard is against `Throttle` semantics, where a writer pushing every 50 ms would defer the
    // refresh forever. `Sample` semantics keep it flowing; the exact count is not the contract.
    assert!(
        emitted >= 4,
        "a writer pushing every {step:?} for {total:?} starved refreshes: {emitted} emitted"
    );
}

#[test]
fn plans_config_and_inbox_coalesce_independently() {
    let mut c = coalescer();
    let t0 = Instant::now();

    c.push(plans(Some("00576-Foo")), t0);
    c.push(ChangeTarget::Config, t0);
    c.push(ChangeTarget::Inbox, t0);

    let events = c.poll(t0 + PLANS_WINDOW);
    assert_eq!(
        events.len(),
        3,
        "one event per target class, not one merged event"
    );
    assert!(events.contains(&ChangeEvent::new(plans(Some("00576-Foo")))));
    assert!(events.contains(&ChangeEvent::new(ChangeTarget::Config)));
    assert!(events.contains(&ChangeEvent::new(ChangeTarget::Inbox)));
}

#[test]
fn config_uses_its_own_shorter_window() {
    let mut c = coalescer();
    let t0 = Instant::now();

    c.push(ChangeTarget::Config, t0);
    c.push(plans(Some("00576-Foo")), t0);

    // Config's 300 ms window elapses first, so it is emitted alone.
    assert_eq!(
        c.poll(t0 + CONFIG_WINDOW),
        vec![ChangeEvent::new(ChangeTarget::Config)]
    );
    assert_eq!(
        c.poll(t0 + PLANS_WINDOW),
        vec![ChangeEvent::new(plans(Some("00576-Foo")))]
    );
}

#[test]
fn ignores_worktrees_git_and_build_artifacts() {
    let root = Path::new("/tendril/Plans/00576-Foo");

    let ignored = [
        "Worktrees/Ivy-Interactive/Ivy-Tendril-V2/src/main.rs",
        "Worktrees/repo/.git/index",
        ".git/index",
        "target/debug/x",
        "node_modules/y/index.js",
        "dist/z.js",
        "build/out.o",
        "bin/Debug/a.dll",
        "obj/project.assets.json",
        ".vp/cache",
        ".next/server.js",
        "Artifacts/a.png",
        "Logs/b.md",
        "plan.yaml.tmp.123",
        "plan.yaml.lock",
        ".DS_Store",
        "plan.yaml.swp",
        "plan.yaml~",
    ];
    for rel in ignored {
        let path = root.join(rel);
        assert!(
            should_ignore(&path),
            "{} should be ignored but was not",
            path.display()
        );
    }

    let watched = [
        "plan.yaml",
        "Revisions/002.md",
        "Verification/RustBuild.md",
        ".counter",
    ];
    for rel in watched {
        let path = root.join(rel);
        assert!(
            !should_ignore(&path),
            "{} should be watched but was ignored",
            path.display()
        );
    }

    for path in [
        Path::new("/tendril/config.yaml"),
        Path::new("/tendril/Inbox/x.md"),
        Path::new("/tendril/Plans/.counter"),
    ] {
        assert!(
            !should_ignore(path),
            "{} should be watched but was ignored",
            path.display()
        );
    }
}

#[test]
fn watch_paths_never_include_worktrees() {
    // This is the regression test for the CPU catastrophe: watching a plan's worktree during
    // execution overflowed upstream's watcher buffer and destabilised the machine. If anyone
    // reintroduces a recursive registration or drops the ignore pass, this fails loudly.
    let tree = TempTree::new("paths");
    let plans_dir = tree.path.join("Plans");
    let plan = plans_dir.join("00576-Foo");
    for sub in [
        "Revisions",
        "Verification",
        "Artifacts",
        "Logs",
        "Worktrees/repo/.git",
        "Worktrees/repo/src",
    ] {
        std::fs::create_dir_all(plan.join(sub)).expect("create fixture subdir");
    }
    std::fs::write(plan.join("plan.yaml"), "state: Draft\n").expect("write plan.yaml");
    std::fs::write(tree.path.join("config.yaml"), "codingAgent: claude\n").expect("write config");

    let cfg = WatchConfig::new(
        plans_dir.clone(),
        tree.path.join("config.yaml"),
        tree.path.join("Inbox"),
    );
    let paths = watch_paths(&cfg);

    assert!(paths.contains(&plans_dir), "the plans root must be watched");
    assert!(paths.contains(&plan), "the plan folder must be watched");
    assert!(paths.contains(&plan.join("Revisions")));
    assert!(paths.contains(&plan.join("Verification")));
    // config.yaml is watched via its directory, mirroring FileSystemWatcher(dir, "config.yaml").
    assert!(paths.contains(&tree.path));

    for path in &paths {
        let s = path.to_string_lossy();
        assert!(
            !s.contains("Worktrees"),
            "{s} is under Worktrees and must never be registered"
        );
        assert!(!s.contains("Artifacts"), "{s} is under Artifacts");
        assert!(!s.contains("Logs"), "{s} is under Logs");
        assert!(!s.contains(".git"), "{s} is under .git");
    }

    // Inbox/ does not exist in this fixture and must simply be absent rather than fatal.
    assert!(!paths.contains(&tree.path.join("Inbox")));
}

#[test]
fn watch_paths_respects_max_watched_plan_folders() {
    let tree = TempTree::new("cap");
    let plans_dir = tree.path.join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");
    for i in 0..(MAX_WATCHED_PLAN_FOLDERS + 100) {
        std::fs::create_dir_all(plans_dir.join(format!("{:05}-Plan", i))).expect("create plan dir");
    }

    let cfg = WatchConfig::new(
        plans_dir.clone(),
        tree.path.join("config.yaml"),
        tree.path.join("Inbox"),
    );
    let paths = watch_paths(&cfg);

    let plan_folders: Vec<&PathBuf> = paths
        .iter()
        .filter(|p| p.parent() == Some(plans_dir.as_path()))
        .collect();
    assert_eq!(plan_folders.len(), MAX_WATCHED_PLAN_FOLDERS);
    assert!(
        paths.contains(&plans_dir),
        "the root is watched on top of the cap"
    );

    // Newest first: the highest-numbered folders are the ones a user is looking at.
    let newest = plans_dir.join(format!("{:05}-Plan", MAX_WATCHED_PLAN_FOLDERS + 99));
    let oldest = plans_dir.join("00000-Plan");
    assert!(plan_folders.contains(&&newest));
    assert!(!plan_folders.contains(&&oldest));
}

/// Serialises the tests that touch the self-write map.
///
/// That map is one process-wide static, and cargo runs tests on threads, so the two tests below are
/// not independent however carefully they pick their paths: each opens with `clear_self_writes`, and
/// a clear landing between the other test's note and its assertion wipes the very entry it is about
/// to check. CI caught that as a flake in `self_write_is_suppressed_within_window`; it reproduces on
/// demand by delaying the second test's clear by 40 ms.
///
/// The failure is worse in the other direction, which is why both tests take the lock rather than
/// just the one that flaked: `self_write_expires_after_window` asserts a *negative*, so a stray clear
/// makes it pass without testing anything.
fn self_write_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[test]
fn self_write_is_suppressed_within_window() {
    let _guard = self_write_lock();
    self_writes::clear_self_writes();
    let path = Path::new("/tendril/Plans/00576-Foo/plan.yaml");
    let now = Instant::now();

    self_writes::note_self_write_at(path, now);

    assert!(self_writes::was_self_written(path, now));
    assert!(self_writes::was_self_written(
        path,
        now + Duration::from_millis(500)
    ));
    assert!(
        !self_writes::was_self_written(Path::new("/tendril/config.yaml"), now),
        "a note for one path must not suppress another"
    );
}

#[test]
fn self_write_expires_after_window() {
    let _guard = self_write_lock();
    self_writes::clear_self_writes();
    let path = Path::new("/tendril/Plans/00577-Bar/plan.yaml");
    let now = Instant::now();

    self_writes::note_self_write_at(path, now);

    // A foreign write landing a second later must not be swallowed as ours.
    assert!(!self_writes::was_self_written(
        path,
        now + self_writes::SUPPRESS_WINDOW
    ));
    assert!(!self_writes::was_self_written(
        path,
        now + Duration::from_secs(5)
    ));
}

#[test]
fn classify_path_maps_each_target() {
    use tendril_core::watcher::classify_path;

    let cfg = WatchConfig::new(
        PathBuf::from("/tendril/Plans"),
        PathBuf::from("/tendril/config.yaml"),
        PathBuf::from("/tendril/Inbox"),
    );

    assert_eq!(
        classify_path(&cfg, Path::new("/tendril/config.yaml")),
        Some(ChangeTarget::Config)
    );
    // A sibling of config.yaml is not a config change.
    assert_eq!(
        classify_path(&cfg, Path::new("/tendril/config.yaml.backup")),
        None
    );
    assert_eq!(
        classify_path(&cfg, Path::new("/tendril/Inbox/issue.md")),
        Some(ChangeTarget::Inbox)
    );
    assert_eq!(
        classify_path(&cfg, Path::new("/tendril/Plans")),
        Some(plans(None))
    );
    assert_eq!(
        classify_path(&cfg, Path::new("/tendril/Plans/00576-Foo")),
        Some(plans(Some("00576-Foo")))
    );
    assert_eq!(
        classify_path(&cfg, Path::new("/tendril/Plans/00576-Foo/Revisions/001.md")),
        Some(plans(Some("00576-Foo")))
    );
    assert_eq!(classify_path(&cfg, Path::new("/elsewhere/thing.txt")), None);
}

#[test]
fn change_event_serialises_to_the_client_contract() {
    let json = serde_json::to_value(ChangeEvent::new(plans(Some("00576-Foo")))).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "type": "fs.change",
            "target": { "kind": "plans", "folder": "00576-Foo" }
        })
    );

    let rescan = serde_json::to_value(ChangeEvent::full_rescan()).unwrap();
    assert_eq!(
        rescan,
        serde_json::json!({
            "type": "fs.change",
            "target": { "kind": "plans", "folder": null }
        })
    );

    let config = serde_json::to_value(ChangeEvent::new(ChangeTarget::Config)).unwrap();
    assert_eq!(
        config,
        serde_json::json!({ "type": "fs.change", "target": { "kind": "config" } })
    );
}
