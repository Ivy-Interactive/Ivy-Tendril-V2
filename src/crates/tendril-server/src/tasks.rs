//! Generic recurring-task scheduling. [`spawn_recurring`] owns the "sleep, then run a pass, and
//! never let one bad pass kill the loop" shape that used to be duplicated per background task (see
//! `lib.rs`'s `spawn_worktree_reaper`, now built on top of it); [`spawn_version_check`] is the
//! version-check daemon task built on it.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use crate::state::AppState;

/// How long a disabled task waits before rechecking whether it has been re-enabled.
const DISABLED_RECHECK: Duration = Duration::from_secs(30 * 60);

/// Runs `body` on a repeating cadence given by `next_interval`, forever, as a detached task.
///
/// `next_interval` is called before every pass (including the first) and re-evaluated each time,
/// so an operator can change a task's cadence without restarting the daemon. Returning `None`
/// means "disabled for now": the pass is skipped and `next_interval` is rechecked after
/// [`DISABLED_RECHECK`].
///
/// A pass runs in its own `tokio::spawn`, so a panic inside `body` is caught (surfaced as a
/// warning) rather than taking the whole loop down — the next pass still runs on schedule.
pub fn spawn_recurring<F, Fut>(
    name: &'static str,
    next_interval: impl Fn() -> Option<Duration> + Send + 'static,
    body: F,
) -> tokio::task::JoinHandle<()>
where
    F: Fn() -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        loop {
            match next_interval() {
                Some(interval) => tokio::time::sleep(interval).await,
                None => {
                    tokio::time::sleep(DISABLED_RECHECK).await;
                    continue;
                }
            }

            if let Err(e) = tokio::spawn(body()).await {
                tracing::warn!("{name} pass panicked: {e}");
            }
        }
    })
}

/// Success interval once the release feed is reachable.
const VERSION_CHECK_SUCCESS_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Ceiling for the failure backoff ladder below.
const VERSION_CHECK_MAX_BACKOFF: Duration = Duration::from_secs(12 * 60 * 60);

/// 1h, 2h, 4h, 8h, then capped at [`VERSION_CHECK_MAX_BACKOFF`] (12h) for every failure after that.
fn version_check_interval(consecutive_failures: u32) -> Duration {
    if consecutive_failures == 0 {
        return VERSION_CHECK_SUCCESS_INTERVAL;
    }
    // Capped low enough that the shift can never overflow; the `Duration::min` below makes any
    // exponent past the ladder's fourth step (which already reaches the 12h ceiling) equivalent.
    let hours = 1u64 << (consecutive_failures - 1).min(6);
    Duration::from_secs(hours * 60 * 60).min(VERSION_CHECK_MAX_BACKOFF)
}

/// Starts the periodic release check: every 6h while it can reach the release feed, backing off
/// on repeated failure per [`version_check_interval`]. Silent on failure — a `tracing::debug!` on
/// the first failure of a run is the only signal, and the in-memory `VersionInfo` (read by
/// `GET /api/version`) simply keeps showing the last successful result.
pub fn spawn_version_check(state: Arc<AppState>) -> tokio::task::JoinHandle<()> {
    let interval_state = state.clone();
    let body_state = state.clone();

    spawn_recurring(
        "version check",
        move || {
            let failures = interval_state
                .version_info
                .try_read()
                .map(|info| info.consecutive_failures)
                .unwrap_or(0);
            Some(version_check_interval(failures))
        },
        move || {
            let state = body_state.clone();
            async move {
                let settings =
                    tendril_core::config::load_config(&state.config_path).unwrap_or_default();
                let client = tendril_core::version_check::build_client();
                let result = tendril_core::version_check::check_once(
                    &client,
                    &state.tendril_home,
                    settings.beta,
                )
                .await;

                let mut info = state.version_info.write().await;
                match result {
                    Ok(fresh) => *info = fresh,
                    Err(e) => {
                        let is_first_failure = info.consecutive_failures == 0;
                        info.consecutive_failures = info.consecutive_failures.saturating_add(1);
                        if is_first_failure {
                            tracing::debug!("Version check failed: {e}");
                        }
                    }
                }
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test(start_paused = true)]
    async fn spawn_recurring_disabled_interval_does_not_run_body() {
        let calls = Arc::new(AtomicUsize::new(0));
        let body_calls = calls.clone();

        let handle = spawn_recurring(
            "test-disabled",
            || None,
            move || {
                let calls = body_calls.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                }
            },
        );

        // Advance well past several would-be disabled-recheck cycles; the body must never run.
        tokio::time::advance(DISABLED_RECHECK * 5).await;
        handle.abort();

        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn spawn_recurring_survives_a_panicking_pass() {
        let calls = Arc::new(AtomicUsize::new(0));
        let body_calls = calls.clone();

        let handle = spawn_recurring(
            "test-panicking",
            || Some(Duration::from_millis(1)),
            move || {
                let calls = body_calls.clone();
                async move {
                    let n = calls.fetch_add(1, Ordering::SeqCst);
                    if n == 0 {
                        panic!("first pass always panics");
                    }
                }
            },
        );

        // Give the loop room to run the panicking first pass, then a healthy second one. Advancing
        // in small increments (rather than one large jump) avoids relying on exactly how many
        // passes a single `advance` call drives through.
        for _ in 0..50 {
            tokio::time::advance(Duration::from_millis(1)).await;
            if calls.load(Ordering::SeqCst) >= 2 {
                break;
            }
        }
        handle.abort();

        assert!(
            calls.load(Ordering::SeqCst) >= 2,
            "expected the loop to keep going past the panicking pass"
        );
    }

    #[test]
    fn version_check_interval_backs_off_and_caps() {
        assert_eq!(version_check_interval(0), VERSION_CHECK_SUCCESS_INTERVAL);
        assert_eq!(version_check_interval(1), Duration::from_secs(60 * 60));
        assert_eq!(version_check_interval(2), Duration::from_secs(2 * 60 * 60));
        assert_eq!(version_check_interval(3), Duration::from_secs(4 * 60 * 60));
        assert_eq!(version_check_interval(4), Duration::from_secs(8 * 60 * 60));
        assert_eq!(version_check_interval(5), VERSION_CHECK_MAX_BACKOFF);
        assert_eq!(version_check_interval(50), VERSION_CHECK_MAX_BACKOFF);
    }
}
