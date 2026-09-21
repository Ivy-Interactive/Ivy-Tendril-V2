//! Serialisation and restoration for the unit tests that touch process-global environment
//! variables.
//!
//! Several resolution helpers in this crate are configured entirely through the environment --
//! `WIREFRAME_BROWSER` in [`crate::browser::locator`], `WIREFRAME_CACHE` and `WIREFRAME_ESBUILD` in
//! [`crate::build::esbuild`] -- so the only way to exercise them is to set those variables. The
//! environment is per-process, not per-test, and libtest runs the whole crate's unit tests as
//! threads of a single binary: a test that sets a variable sets it for every sibling running at
//! that instant, and a test that clears one afterwards clears whatever the developer had exported.
//!
//! This is the exact bug class that turned CI red for ten consecutive runs in `tendril-core`, where
//! a test repointed `TMPDIR` process-wide, deleted the directory and never put it back. It
//! reproduced 20/20 at one and two test threads and 0/20 at three or more -- with enough
//! parallelism the siblings had already finished before the mutation landed, so it was invisible on
//! a developer machine and deterministic on a two-job runner. The shape below is taken from the fix
//! that landed there, `tendril-core/tests/agent_providers_test.rs`, deliberately unchanged so the
//! two read the same.
//!
//! Two rules make it work, and both are load-bearing:
//!
//!   1. Every test that reads or writes one of these variables takes [`env_lock`] first, so only
//!      one of them is ever observing the environment.
//!   2. Every mutation goes through an [`EnvGuard`] declared *after* the lock guard. Rust drops
//!      locals in reverse declaration order, so the variable is restored before the mutex is
//!      released -- and because the restore happens in `Drop` it also runs when an assertion
//!      panics, which is when leaving the environment dirty does the most damage.
//!
//! One caller is still outstanding: the unit tests for `project::wireframe_cache_dir` set and clear
//! `WIREFRAME_CACHE` directly, so that variable is only half-protected until they are converted to
//! this module too.

use std::ffi::{OsStr, OsString};
use std::sync::{Mutex, MutexGuard};

/// Serialises every unit test in this crate that reads or writes a `WIREFRAME_*` variable.
pub(crate) fn env_lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    // A sibling that panicked while holding this poisoned it, and the poison says nothing about
    // whether the environment is usable -- that test's guards restored it on the way out of the
    // panic. Take the lock anyway rather than cascading one failure into every other test in the
    // binary, which is what `unwrap()` here would do.
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Restores a process-global environment variable to what it was, on drop and on panic.
pub(crate) struct EnvGuard {
    key: &'static str,
    /// `OsString` rather than `String`, so a value the developer exported that is not valid UTF-8
    /// survives the round trip instead of being restored as absent.
    previous: Option<OsString>,
}

impl EnvGuard {
    /// Sets `key` for as long as the returned guard lives.
    pub(crate) fn set(key: &'static str, value: impl AsRef<OsStr>) -> Self {
        let guard = Self::capture(key);
        // SAFETY: the caller holds `env_lock`, and every test that touches these variables takes
        // that lock first, so no other thread is reading the environment concurrently.
        unsafe { std::env::set_var(key, value) };
        guard
    }

    /// Unsets `key` for as long as the returned guard lives.
    ///
    /// Needed as much as [`set`](Self::set) is: a test that asserts on the *absence* of an override
    /// has to clear it, and clearing it is the same process-global mutation as setting it. Doing
    /// that bare is how a developer with a real `WIREFRAME_BROWSER` exported loses it mid-run.
    pub(crate) fn remove(key: &'static str) -> Self {
        let guard = Self::capture(key);
        // SAFETY: as in `set` -- the caller holds `env_lock`.
        unsafe { std::env::remove_var(key) };
        guard
    }

    fn capture(key: &'static str) -> Self {
        Self {
            key,
            previous: std::env::var_os(key),
        }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        // SAFETY: as in `set` -- the lock is still held for as long as this guard is alive, because
        // the guard is always declared after it.
        unsafe {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A name of our own, so these never disturb a real `WIREFRAME_*` override.
    const KEY: &str = "WIREFRAME_TEST_SUPPORT_PROBE";

    #[test]
    fn a_guard_puts_back_the_value_it_replaced() {
        let _env = env_lock();
        let _outer = EnvGuard::set(KEY, "original");
        {
            let _inner = EnvGuard::set(KEY, "replacement");
            assert_eq!(std::env::var(KEY).as_deref(), Ok("replacement"));
        }
        assert_eq!(std::env::var(KEY).as_deref(), Ok("original"));
    }

    #[test]
    fn a_guard_puts_back_a_variable_that_was_absent() {
        // Restoring "absent" as an empty string would be a silent behaviour change: every reader in
        // this crate trims a value and treats the empty result as no override, but
        // `local_candidates` would still have pushed a `PathBuf` for it before that check existed.
        let _env = env_lock();
        let _absent = EnvGuard::remove(KEY);
        {
            let _set = EnvGuard::set(KEY, "transient");
            assert!(std::env::var_os(KEY).is_some());
        }
        assert!(
            std::env::var_os(KEY).is_none(),
            "a variable that was absent must come back absent, not empty"
        );
    }

    #[test]
    fn a_panicking_test_still_restores() {
        // This is the case a `remove_var` at the end of a test body cannot cover, and it is the one
        // that matters: a failing assertion is exactly when the environment must not be left dirty
        // for every sibling that runs after it. Unwinding through the guard has to be enough.
        let _env = env_lock();
        let _outer = EnvGuard::set(KEY, "survivor");
        let result = std::panic::catch_unwind(|| {
            let _doomed = EnvGuard::set(KEY, "doomed");
            panic!("as a failing assertion would");
        });
        assert!(result.is_err(), "the probe was supposed to panic");
        assert_eq!(std::env::var(KEY).as_deref(), Ok("survivor"));
    }
}
