//! Cross-process and in-process exclusion for read-modify-write cycles on a single file, plus
//! crash-safe atomic writes.
//!
//! This is the port of upstream Tendril's `ConfigFileLock`. Its reason for existing is the same:
//! once a filesystem watcher wakes readers on every write, a reader can otherwise observe a file
//! that a writer has truncated but not yet finished filling. `write_atomic` closes that window by
//! staging to a sibling temp file and renaming, and `FileLock` serialises the read-modify-write
//! cycles that a plain rename cannot make safe on its own.

use crate::error::{Result, TendrilError};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

/// Default acquisition budget: 50 retries x 100 ms = 5 s, matching upstream's timeout.
const MAX_RETRIES: u32 = 50;
const RETRY_DELAY_MS: u64 = 100;

/// A `.lock` sidecar older than this is assumed to belong to a process that crashed while holding
/// it. Unlike the C# implementation's `FileOptions.DeleteOnClose`, nothing cleans a sidecar up for
/// us when a process dies, so without take-over a single crash would wedge the file forever.
const STALE_LOCK: Duration = Duration::from_secs(60);

/// Paths currently locked by *this* process.
///
/// Belt and braces alongside the `.lock` sidecar, because `create_new` is only exclusive across
/// processes — two handles inside one process would both be told the file is theirs.
fn held_paths() -> &'static Mutex<HashSet<PathBuf>> {
    static HELD: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    HELD.get_or_init(|| Mutex::new(HashSet::new()))
}

fn try_claim_in_process(path: &Path) -> bool {
    held_paths()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(path.to_path_buf())
}

fn release_in_process(path: &Path) {
    held_paths()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(path);
}

fn lock_sidecar_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".lock");
    match path.parent() {
        Some(parent) => parent.join(name),
        None => PathBuf::from(name),
    }
}

/// Exclusive access to one file, held for the lifetime of the guard.
///
/// **Never nest two `FileLock`s over the same path.** A locked write that calls another locked write
/// on the same file cannot make progress and will exhaust its retry budget — the same caveat
/// `ConfigFileLock` carries upstream. Acquire once per call path, at the outermost level that needs
/// the whole read-modify-write cycle to be atomic.
#[derive(Debug)]
pub struct FileLock {
    target: PathBuf,
    lock_path: PathBuf,
}

impl FileLock {
    /// Blocks until exclusive access to `path` is held, retrying for up to 5 s.
    ///
    /// Fails with [`TendrilError::Io`] whose message says how long we waited, so a caller that hits
    /// it can tell a genuine contention timeout from an unrelated I/O error (upstream translates
    /// the Windows sharing violation into a `TimeoutException` for the same reason).
    pub fn acquire(path: &Path) -> Result<FileLock> {
        Self::acquire_with_budget(path, MAX_RETRIES, RETRY_DELAY_MS)
    }

    /// Test seam: asserting the timeout path without burning the full 5 s budget.
    pub fn acquire_with_budget(path: &Path, max_retries: u32, delay_ms: u64) -> Result<FileLock> {
        let lock_path = lock_sidecar_path(path);
        if let Some(parent) = lock_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }

        for attempt in 0..=max_retries {
            if try_claim_in_process(path) {
                match std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&lock_path)
                {
                    Ok(_) => {
                        return Ok(FileLock {
                            target: path.to_path_buf(),
                            lock_path,
                        })
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        // Another process holds it. Give up the in-process claim so we do not block
                        // our own threads while waiting on a foreign one.
                        release_in_process(path);
                        if take_over_if_stale(&lock_path) {
                            continue;
                        }
                    }
                    Err(e) => {
                        release_in_process(path);
                        return Err(e.into());
                    }
                }
            }

            if attempt < max_retries {
                std::thread::sleep(Duration::from_millis(delay_ms));
            }
        }

        Err(TendrilError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            format!(
                "Timed out after waiting {} ms for exclusive access to {} (lock held at {})",
                max_retries as u64 * delay_ms,
                path.display(),
                lock_path.display()
            ),
        )))
    }
}

/// Removes a sidecar left behind by a crashed holder. Returns whether it removed one.
fn take_over_if_stale(lock_path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(lock_path) else {
        // Vanished between the failed create and here — the next attempt will win it.
        return true;
    };
    let Ok(modified) = meta.modified() else {
        return false;
    };
    let age = SystemTime::now()
        .duration_since(modified)
        .unwrap_or(Duration::ZERO);
    if age < STALE_LOCK {
        return false;
    }
    tracing::warn!(
        "Taking over stale lock {} (age {:?}); the holder likely crashed",
        lock_path.display(),
        age
    );
    std::fs::remove_file(lock_path).is_ok()
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.lock_path);
        release_in_process(&self.target);
    }
}

/// Runs `f` while holding the lock for `path`. See [`FileLock::acquire`] on nesting.
pub fn with_file_lock<T>(path: &Path, f: impl FnOnce() -> Result<T>) -> Result<T> {
    let _lock = FileLock::acquire(path)?;
    f()
}

/// Writes `contents` to `path` via a `<path>.tmp.<pid>` staging file and a rename.
///
/// A concurrent reader sees either the old file or the new one, never a truncated one. The staging
/// name is deliberately matched by the watcher's ignore rules, so our own staging file never
/// generates a change event of its own.
pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let mut tmp_name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    tmp_name.push(format!(".tmp.{}", std::process::id()));
    let tmp_path = match path.parent() {
        Some(parent) => parent.join(tmp_name),
        None => PathBuf::from(tmp_name),
    };

    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp_path)?;
        f.write_all(contents)?;
        // Without the flush to disk, a crash between rename and writeback can leave the renamed
        // file present but empty — the very state write_atomic exists to prevent.
        f.sync_all()?;
    }

    // Record the write before the rename becomes visible: the watcher must never see the event
    // ahead of the suppression note, or it would treat our own write as foreign.
    crate::watcher::self_writes::note_self_write(path);

    match std::fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(e.into())
        }
    }
}
