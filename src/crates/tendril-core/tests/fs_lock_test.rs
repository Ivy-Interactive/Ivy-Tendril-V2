//! `fs_lock`: exclusion for read-modify-write cycles, and writes a concurrent reader cannot catch
//! half-finished.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tendril_core::fs_lock::{write_atomic, FileLock};

struct Fixture {
    dir: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tendril-fslock-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).expect("create fixture dir");
        Self { dir }
    }

    fn file(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.dir.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn second_acquire_blocks_until_first_drops() {
    let fx = Fixture::new("blocks");
    let path = fx.file("plan.yaml");
    std::fs::write(&path, "state: Draft\n").unwrap();

    let first_released = Arc::new(AtomicBool::new(false));
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();

    let holder_path = path.clone();
    let holder_flag = Arc::clone(&first_released);
    let holder = std::thread::spawn(move || {
        let lock = FileLock::acquire(&holder_path).expect("first acquire");
        entered_tx.send(()).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        holder_flag.store(true, Ordering::SeqCst);
        drop(lock);
    });

    entered_rx.recv().expect("holder acquired the lock");

    let waiter_path = path.clone();
    let waiter_flag = Arc::clone(&first_released);
    let waiter = std::thread::spawn(move || {
        let lock = FileLock::acquire(&waiter_path).expect("second acquire");
        // The ordering assertion: the second acquire cannot have succeeded before the first released.
        assert!(
            waiter_flag.load(Ordering::SeqCst),
            "second acquire returned while the first lock was still held"
        );
        drop(lock);
    });

    holder.join().unwrap();
    waiter.join().unwrap();

    // The sidecar is cleaned up by the guard's Drop, not left behind.
    assert!(!fx.file("plan.yaml.lock").exists());
}

#[test]
fn acquire_times_out_with_budget() {
    let fx = Fixture::new("timeout");
    let path = fx.file("config.yaml");
    std::fs::write(&path, "codingAgent: claude\n").unwrap();

    let _held = FileLock::acquire(&path).expect("first acquire");

    let start = std::time::Instant::now();
    let err = FileLock::acquire_with_budget(&path, 2, 10)
        .expect_err("a contended acquire must time out rather than return a bogus lock");
    let waited = start.elapsed();

    let msg = err.to_string();
    assert!(
        msg.contains("Timed out") && msg.contains("config.yaml"),
        "the error must say we waited and on what: {msg}"
    );
    assert!(
        waited < Duration::from_secs(1),
        "the budget was ignored; waited {waited:?}"
    );
}

#[test]
fn stale_lock_is_taken_over() {
    let fx = Fixture::new("stale");
    let path = fx.file("plan.yaml");
    std::fs::write(&path, "state: Draft\n").unwrap();

    // A sidecar left behind by a process that crashed while holding the lock. Nothing removes it for
    // us — the C# original relied on FileOptions.DeleteOnClose — so without take-over one crash would
    // wedge the file permanently.
    let sidecar = fx.file("plan.yaml.lock");
    std::fs::write(&sidecar, "").unwrap();
    backdate(&sidecar, Duration::from_secs(120));

    let lock =
        FileLock::acquire_with_budget(&path, 2, 10).expect("stale lock should be taken over");
    drop(lock);
    assert!(!sidecar.exists());
}

#[test]
fn fresh_foreign_lock_is_not_taken_over() {
    let fx = Fixture::new("fresh");
    let path = fx.file("plan.yaml");
    std::fs::write(&path, "state: Draft\n").unwrap();

    // Same shape as the stale case but recent, so it must be respected: taking over a live holder's
    // lock would defeat the whole mechanism.
    let sidecar = fx.file("plan.yaml.lock");
    std::fs::write(&sidecar, "").unwrap();

    FileLock::acquire_with_budget(&path, 1, 10)
        .expect_err("a fresh foreign lock must be respected");
    assert!(sidecar.exists());
    let _ = std::fs::remove_file(&sidecar);
}

#[test]
fn write_atomic_leaves_no_partial_file() {
    let fx = Fixture::new("atomic");
    let path = fx.file("plan.yaml");

    // A payload big enough that a naive `fs::write` would be observably mid-flight.
    let body = "state: Draft\nrepos:\n".to_string()
        + &(0..20_000)
            .map(|i| format!("- /repo/path/number/{i}\n"))
            .collect::<String>();
    std::fs::write(&path, &body).unwrap();

    let stop = Arc::new(AtomicBool::new(false));
    let reader_path = path.clone();
    let reader_stop = Arc::clone(&stop);
    let reader = std::thread::spawn(move || {
        let mut reads = 0u32;
        while !reader_stop.load(Ordering::SeqCst) {
            match std::fs::read_to_string(&reader_path) {
                Ok(contents) => {
                    // Either the old file or the new one — never a truncated one.
                    assert!(
                        contents.starts_with("state: ") && contents.ends_with('\n'),
                        "reader observed a partial file of {} bytes",
                        contents.len()
                    );
                    reads += 1;
                }
                // The rename is atomic, so the path is never absent; a transient EINTR-style failure
                // is not what this test is about.
                Err(e) => panic!("reader failed: {e}"),
            }
        }
        reads
    });

    for i in 0..20 {
        let payload = format!("state: Executing\nround: {i}\n") + &body;
        write_atomic(&path, payload.as_bytes()).expect("atomic write");
    }

    stop.store(true, Ordering::SeqCst);
    let reads = reader.join().expect("reader thread");
    assert!(reads > 0, "the reader never got a look in");

    // No staging file survives a successful write.
    let leftovers: Vec<String> = std::fs::read_dir(&fx.dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.contains(".tmp."))
        .collect();
    assert!(
        leftovers.is_empty(),
        "staging files left behind: {leftovers:?}"
    );
}

#[test]
fn with_file_lock_releases_on_error() {
    let fx = Fixture::new("release");
    let path = fx.file("plan.yaml");
    std::fs::write(&path, "state: Draft\n").unwrap();

    let result: tendril_core::error::Result<()> =
        tendril_core::fs_lock::with_file_lock(&path, || {
            Err(tendril_core::error::TendrilError::Plan("boom".to_string()))
        });
    assert!(result.is_err());

    // A failed critical section must not leave the file locked for the rest of the process.
    let lock =
        FileLock::acquire_with_budget(&path, 2, 10).expect("lock released despite the error");
    drop(lock);
    assert!(!fx.file("plan.yaml.lock").exists());
}

/// Moves a file's mtime `age` into the past.
fn backdate(path: &std::path::Path, age: Duration) {
    let when = std::time::SystemTime::now() - age;
    let times = std::fs::FileTimes::new().set_modified(when);
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("open for backdating");
    file.set_times(times).expect("set mtime");
}
