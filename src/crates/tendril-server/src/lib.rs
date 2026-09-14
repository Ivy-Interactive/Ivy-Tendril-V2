pub mod auth;
pub mod master;
pub mod pr_sync;
pub mod routes;
pub mod state;
mod webviewer;

pub use auth::*;
pub use master::*;
pub use routes::*;
pub use state::*;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;

/// How often the master rechecks blocked plans, wait-for dependents, stuck jobs and stale entries.
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(60);

pub async fn run_server(
    port: u16,
    tendril_home: PathBuf,
    host: Option<String>,
) -> anyhow::Result<()> {
    let host = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let is_loopback = host == "127.0.0.1" || host == "::1" || host == "localhost";
    if !is_loopback {
        tracing::warn!(
            "Server binding to non-loopback address: {}. External network access is enabled.",
            host
        );
    }

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::new(tendril_home.clone(), secret.clone()));
    let app = create_router(state.clone());

    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr).await?;
    println!(">>> Tendril Server running on http://{}:{}", host, port);

    let _master = MasterGuard::acquire(&tendril_home, port, &secret, &host)?;

    // Only the master reconciles: a daemon that lost the race must never reap the winner's jobs.
    reconcile_after_restart(&tendril_home).await;

    // Only the master runs maintenance: a daemon that lost the race must not reap the winner's jobs.
    let maintenance_state = state.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(MAINTENANCE_INTERVAL);
        // Delay rather than Burst: a pass that overran must not be followed by a flurry of catch-up
        // passes fighting over the same jobs.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            let report = maintenance_state.job_manager.run_maintenance_pass().await;
            if !report.is_empty() {
                tracing::info!(
                    "Job maintenance: {} plans unblocked, {} jobs released, {} reaped, {} evicted",
                    report.unblocked_plans.len(),
                    report.released_jobs.len(),
                    report.reaped_jobs.len(),
                    report.evicted_jobs.len(),
                );
            }
        }
    });

    spawn_worktree_reaper(tendril_home.clone());

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Periodic worktree reclamation. Started only by the master — the `MasterGuard` has already been
/// acquired by the time this is called — so a daemon that lost the race never reaps the winner's
/// worktrees, for the same reason `reconcile_after_restart` is master-only.
///
/// The config is re-read each pass, so an operator can change the interval or the branch-delete mode
/// without restarting the daemon.
fn spawn_worktree_reaper(tendril_home: PathBuf) {
    use tendril_core::git::worktree_reaper::{reap_worktrees, BranchDeleteMode, ReaperConfig};
    use tendril_core::git::WorktreeLifecycleLog;

    // The reaper never competes with startup for disk: every pass sleeps before it runs.
    const DISABLED_RECHECK: Duration = Duration::from_secs(30 * 60);

    tokio::spawn(async move {
        loop {
            let config_path = tendril_core::config::get_config_path(&tendril_home);
            let settings = tendril_core::config::load_config(&config_path).unwrap_or_default();

            if settings.worktree_reaper_interval <= 0 {
                tokio::time::sleep(DISABLED_RECHECK).await;
                continue;
            }

            tokio::time::sleep(Duration::from_secs(
                settings.worktree_reaper_interval as u64 * 60,
            ))
            .await;

            let mode = BranchDeleteMode::from_str_loose(&settings.worktree_branch_delete_mode)
                .unwrap_or_else(|| {
                    tracing::warn!(
                        "Unrecognised worktreeBranchDeleteMode '{}'; using PreserveUnpushed",
                        settings.worktree_branch_delete_mode
                    );
                    BranchDeleteMode::PreserveUnpushed
                });
            let grace = Duration::from_secs(settings.worktree_reaper_grace.max(0) as u64 * 60);
            let plans_dir = tendril_core::config::get_plans_dir(&tendril_home);
            let log = WorktreeLifecycleLog::new(&tendril_home);

            // A panic inside a pass must not take the reaper down with it.
            let pass = tokio::task::spawn_blocking(move || {
                let cfg = ReaperConfig {
                    grace,
                    mode,
                    log: Some(log),
                };
                reap_worktrees(&plans_dir, &cfg)
            })
            .await;

            match pass {
                Ok(report) => {
                    if !report.reclaimed.is_empty() || !report.skipped.is_empty() {
                        tracing::info!(
                            "Worktree reaper: {} reclaimed, {} skipped",
                            report.reclaimed.len(),
                            report.skipped.len()
                        );
                    }
                }
                Err(e) => tracing::warn!("Worktree reaper pass failed: {}", e),
            }
        }
    });
}

/// Realigns persisted job and plan state with reality. A failure here is logged rather than fatal:
/// the daemon is more useful up with stale rows than refusing to start.
async fn reconcile_after_restart(tendril_home: &std::path::Path) {
    let config_path = tendril_core::config::get_config_path(tendril_home);
    let settings = tendril_core::config::load_config(&config_path).unwrap_or_default();

    match tendril_core::jobs::recovery::reconcile_jobs_on_startup(tendril_home, &settings).await {
        Ok(report) => {
            tracing::info!(
                "Startup reconciliation: {} live, {} completed, {} failed, {} queued, {} unblocked, {} plans reverted",
                report.live_jobs.len(),
                report.completed_jobs.len(),
                report.failed_jobs.len(),
                report.queued_jobs.len(),
                report.unblocked_plans.len(),
                report.reverted_plans.len(),
            );
        }
        Err(e) => tracing::warn!("Startup reconciliation failed: {}", e),
    }

    let plans_dir = tendril_core::config::get_plans_dir(tendril_home);
    let migrator = tendril_core::plans::migrations::PlanMigrator::new();
    match migrator.migrate_plans(&plans_dir, None) {
        Ok(migrated_count) => {
            if migrated_count > 0 {
                tracing::info!(
                    "Migrated {} plan(s) to schema version {}",
                    migrated_count,
                    migrator.latest_version()
                );
            }
        }
        Err(e) => tracing::warn!("Plan migration failed: {}", e),
    }

    // Runs after the migrator so a rewritten plan.yaml is read in its migrated shape. This is the
    // only place V2 reconciles the database from disk: a plan folder created outside a V2 write path
    // (by the original, by hand, or by the migration above) otherwise never reaches the Plans table.
    let db_path = tendril_core::config::get_database_path(tendril_home);
    match tendril_core::db::open_database(&db_path) {
        Ok(conn) => {
            let since = tendril_core::db::get_last_sync_time(&conn).unwrap_or(None);
            match tendril_core::db::sync_plans_from_disk(&conn, &plans_dir, since) {
                Ok(synced) => {
                    if synced > 0 {
                        tracing::info!("Synced {} plan folder(s) from disk", synced);
                    }
                }
                Err(e) => tracing::warn!("Plan disk sync failed: {}", e),
            }
        }
        Err(e) => tracing::warn!("Plan disk sync skipped, database unavailable: {}", e),
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    println!("Shutting down Tendril Server gracefully...");
}
