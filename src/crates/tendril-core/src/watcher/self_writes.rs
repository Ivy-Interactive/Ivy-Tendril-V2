//! Port of `ConfigService._suppressNextReload`: a short-lived record of the paths this process just
//! wrote, so the watcher event our own write provokes does not loop back into our own reload.
//!
//! Only the *internal* reaction is suppressed. Client notification is not: other windows still need
//! to hear about a daemon write, and that notification comes from `FsWatcher::notify_changed`,
//! called by the write path itself, rather than from the watcher event.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How long after our own write a matching event is treated as ours.
///
/// Long enough to cover the kernel's delivery latency (FSEvents batches up to ~500 ms by default),
/// short enough that a foreign write landing on the same file a moment later is not swallowed.
pub const SUPPRESS_WINDOW: Duration = Duration::from_secs(1);

fn recent_writes() -> &'static Mutex<HashMap<PathBuf, Instant>> {
    static WRITES: OnceLock<Mutex<HashMap<PathBuf, Instant>>> = OnceLock::new();
    WRITES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Records that this process just wrote `path`. Called by `write_atomic`.
pub fn note_self_write(path: &Path) {
    note_self_write_at(path, Instant::now());
}

/// Clock-injected form, so the expiry behaviour is testable without sleeping.
pub fn note_self_write_at(path: &Path, now: Instant) {
    let mut map = recent_writes().lock().unwrap_or_else(|e| e.into_inner());
    // Pruning on insert keeps the map bounded without a background task: every write both adds one
    // entry and drops every entry that can no longer suppress anything.
    map.retain(|_, at| now.saturating_duration_since(*at) < SUPPRESS_WINDOW);
    map.insert(path.to_path_buf(), now);
}

/// True when `path` was written by this process within [`SUPPRESS_WINDOW`] of `now`.
pub fn was_self_written(path: &Path, now: Instant) -> bool {
    let map = recent_writes().lock().unwrap_or_else(|e| e.into_inner());
    match map.get(path) {
        Some(at) => now.saturating_duration_since(*at) < SUPPRESS_WINDOW,
        None => false,
    }
}

/// Drops every recorded write. Exists for tests, which share one process-wide map.
pub fn clear_self_writes() {
    recent_writes()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
}
