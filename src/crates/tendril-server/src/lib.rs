pub mod auth;
pub mod master;
pub mod routes;
pub mod state;
pub mod watch;

pub use auth::*;
pub use master::*;
pub use routes::*;
pub use state::*;
pub use watch::spawn_change_watcher;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;

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

    // Master-only, for the same reason as the reconcile below: two daemons mirroring the same Plans
    // folder into the same database would fight. Held for the process lifetime — dropping the handle
    // stops watching. A daemon up without realtime push is more useful than one refusing to boot, so
    // a failure here is a warning and clients fall back to polling.
    let _watcher = match spawn_change_watcher(state.clone()) {
        Ok(watcher) => Some(watcher),
        Err(e) => {
            tracing::warn!("Filesystem watcher unavailable; clients must poll: {}", e);
            None
        }
    };

    // Only the master reconciles: a daemon that lost the race must never reap the winner's jobs.
    reconcile_after_restart(&tendril_home).await;

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
