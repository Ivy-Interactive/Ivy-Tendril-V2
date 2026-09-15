//! The daemon's pull-request reconciliation driver: one periodic pass, plus the manual pass behind
//! `POST /api/pull-requests/sync`.
//!
//! Both go through [`run_pr_sync_pass`], which holds an `AtomicBool` for the duration, so the timer
//! and an operator's Refresh click can never run concurrently and double the `gh` call count.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tendril_core::db::open_database;
use tendril_core::error::{Result, TendrilError};
use tendril_core::git::pr_sync::{sync_pr_statuses, PrSyncReport};
use tokio::sync::broadcast;

use crate::event_buffer::{self, EventRingBuffer};

/// Let the daemon settle before the first pass.
const FIRST_RUN_DELAY: Duration = Duration::from_secs(30);
/// The original `PrStatusSyncService.CheckInterval`.
const CHECK_INTERVAL: Duration = Duration::from_secs(10 * 60);

/// Runs one reconciliation pass, or returns `None` when one is already in flight.
///
/// `sync_pr_statuses` is blocking and holds a `rusqlite::Connection` (not `Send`), so the work runs
/// inside `spawn_blocking` on its own connection — exactly as the route handlers open theirs.
pub async fn run_pr_sync_pass(
    db_path: &Path,
    plans_dir: &Path,
    running: &Arc<AtomicBool>,
    ws_tx: &broadcast::Sender<String>,
    ring_buffer: &EventRingBuffer,
    seq_counter: &AtomicU64,
) -> Option<Result<PrSyncReport>> {
    if running.swap(true, Ordering::SeqCst) {
        return None;
    }

    let db = db_path.to_path_buf();
    let plans = plans_dir.to_path_buf();
    let joined = tokio::task::spawn_blocking(move || run_pass_blocking(&db, &plans)).await;
    running.store(false, Ordering::SeqCst);

    let result = joined.unwrap_or_else(|e| {
        Err(TendrilError::Other(format!(
            "PR status sync task panicked: {}",
            e
        )))
    });

    if let Ok(report) = &result {
        if report.changed() {
            // The WS bridge forwards this to the frontend, so the UI refreshes without polling.
            event_buffer::dispatch_event(
                seq_counter,
                ring_buffer,
                ws_tx,
                serde_json::json!({"type": "pr_status_changed"}),
            );
        }
    }

    Some(result)
}

fn run_pass_blocking(db_path: &Path, plans_dir: &Path) -> Result<PrSyncReport> {
    let conn = open_database(db_path)?;
    sync_pr_statuses(&conn, plans_dir)
}

/// Starts the periodic driver: first pass after 30s, then every 10 minutes. A failed pass is logged
/// and never propagated — the daemon is more useful up with a stale cache than dead.
pub fn spawn_pr_status_sync(
    db_path: PathBuf,
    plans_dir: PathBuf,
    running: Arc<AtomicBool>,
    ws_tx: broadcast::Sender<String>,
    ring_buffer: Arc<EventRingBuffer>,
    seq_counter: Arc<AtomicU64>,
) {
    tokio::spawn(async move {
        tokio::time::sleep(FIRST_RUN_DELAY).await;
        let mut ticker = tokio::time::interval(CHECK_INTERVAL);
        // The first tick completes immediately; consume it so the loop's cadence is one pass per
        // interval rather than two back to back.
        ticker.tick().await;

        loop {
            match run_pr_sync_pass(
                &db_path,
                &plans_dir,
                &running,
                &ws_tx,
                &ring_buffer,
                &seq_counter,
            )
            .await
            {
                Some(Ok(report)) => log_report(&report),
                Some(Err(e)) => tracing::warn!("PR status sync pass failed: {}", e),
                None => tracing::debug!("PR status sync skipped: a pass is already running"),
            }
            ticker.tick().await;
        }
    });
}

pub fn log_report(report: &PrSyncReport) {
    if !report.errors.is_empty() {
        tracing::warn!(
            "PR status sync: {} repository failure(s): {}",
            report.errors.len(),
            report.errors.join("; ")
        );
    }
    if !report.refused_completions.is_empty() {
        tracing::warn!(
            "PR status sync: completion refused for {}",
            report.refused_completions.join("; ")
        );
    }

    if report.changed() {
        tracing::info!(
            "PR status sync: {} tracked, {} checked ({} merged, {} fresh skipped), {} transition(s), completed {:?}, unblocked {:?}",
            report.tracked,
            report.checked,
            report.skipped_merged,
            report.skipped_fresh,
            report.transitions.len(),
            report.completed_plans,
            report.unblocked_plans,
        );
    } else {
        tracing::debug!(
            "PR status sync: {} tracked, {} checked, nothing changed",
            report.tracked,
            report.checked
        );
    }
}
