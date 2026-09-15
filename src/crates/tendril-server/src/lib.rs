pub mod auth;
pub mod event_buffer;
pub mod local_file_guard;
pub mod master;
pub mod pr_sync;
pub mod pty;
pub mod routes;
pub mod state;
pub mod tasks;
pub mod watch;
mod webviewer;

pub use auth::*;
pub use master::*;
pub use routes::*;
pub use state::*;
pub use watch::spawn_change_watcher;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;

/// How often the master rechecks blocked plans, wait-for dependents, stuck jobs and stale entries.
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(60);

/// How long in-flight requests get to finish once a TLS server has been asked to shut down.
const TLS_SHUTDOWN_GRACE: Duration = Duration::from_secs(10);

/// PEM certificate and key for a TLS listener — what `tendril generate-certs` writes.
#[derive(Debug, Clone)]
pub struct TlsOptions {
    pub cert: PathBuf,
    pub key: PathBuf,
}

/// How often queued telemetry events are posted. Long enough that a busy daemon batches, short enough
/// that a daemon killed without a clean shutdown loses little.
const TELEMETRY_FLUSH_INTERVAL: Duration = Duration::from_secs(30);

pub async fn run_server(
    port: u16,
    tendril_home: PathBuf,
    host: Option<String>,
    tls: Option<TlsOptions>,
) -> anyhow::Result<()> {
    let host = host.unwrap_or_else(|| "127.0.0.1".to_string());
    let is_loopback = host == "127.0.0.1" || host == "::1" || host == "localhost";
    if !is_loopback {
        tracing::warn!(
            "Server binding to non-loopback address: {}. External network access is enabled.",
            host
        );
    }

    if let Err(e) = tendril_core::config::ensure_home_directories(&tendril_home) {
        tracing::warn!(
            "Could not create Tendril home directories under {}: {}",
            tendril_home.display(),
            e
        );
    }

    // Loaded before anything claims the port or writes `.master`: an unreadable certificate should
    // stop the daemon, not leave a half-announced server behind.
    let tls_config = match &tls {
        Some(opts) => Some(load_tls_config(opts).await?),
        None => None,
    };
    let scheme = if tls_config.is_some() {
        "https"
    } else {
        "http"
    };

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::new(tendril_home.clone(), secret.clone()));
    let app = create_router(state.clone());

    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr).await?;
    println!(
        ">>> Tendril Server running on {}://{}:{}",
        scheme, host, port
    );

    let _master = MasterGuard::acquire(&tendril_home, port, &secret, &host, scheme)?;

    // Master-only, like everything below: two daemons would double-count every event. Strictly
    // opt-in — `init` returns `None` unless `config.yaml` says `telemetry: true`, and nothing is
    // installed, queued or sent in that case.
    let telemetry = init_telemetry(&tendril_home);

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
    spawn_cost_backfill(tendril_home.clone());
    tasks::spawn_version_check(state.clone());
    spawn_assigned_issues_importer(tendril_home.clone(), state.clone());

    // `into_make_service_with_connect_info` on both arms is what makes the socket peer address
    // available to `POST /api/auth/login`, which keys its rate limiter on it. Without it every login
    // would share one key, so one client's failures would back off everybody else.
    match tls_config {
        None => {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .with_graceful_shutdown(shutdown_signal())
            .await?;
        }
        Some(config) => {
            // `axum::serve` has no TLS, and `axum_server` drives shutdown through a handle rather
            // than a future, so this branch wires the same signal up the other way round.
            let handle = axum_server::Handle::new();
            let signalled = handle.clone();
            tokio::spawn(async move {
                shutdown_signal().await;
                signalled.graceful_shutdown(Some(TLS_SHUTDOWN_GRACE));
            });

            axum_server::from_tcp_rustls(listener.into_std()?, config)
                .handle(handle)
                .serve(app.into_make_service_with_connect_info::<std::net::SocketAddr>())
                .await?;
        }
    }

    // Whatever is still queued, posted once on the way out. A best-effort call on a client that may
    // not exist: no client means nothing was ever queued.
    if let Some(telemetry) = &telemetry {
        telemetry.flush().await;
    }

    Ok(())
}

/// Reads the PEM pair `serve --tls-cert/--tls-key` was given.
async fn load_tls_config(
    opts: &TlsOptions,
) -> anyhow::Result<axum_server::tls_rustls::RustlsConfig> {
    // `rustls` here is built with the ring provider only, but it still installs no process-wide
    // default on its own, and `RustlsConfig` panics rather than errors without one. An `Err` means
    // some other component installed a provider first, which is just as good.
    let _ = rustls::crypto::ring::default_provider().install_default();

    axum_server::tls_rustls::RustlsConfig::from_pem_file(&opts.cert, &opts.key)
        .await
        .map_err(|e| {
            anyhow::anyhow!(
                "could not load TLS certificate {} and key {}: {}. `tendril generate-certs <dir>` \
                 writes a matching pair.",
                opts.cert.display(),
                opts.key.display(),
                e
            )
        })
}

/// Builds and publishes the process-wide telemetry client, and emits `app_started`.
///
/// Returns the handle so `run_server` can flush on shutdown. `None` whenever telemetry is off, which
/// is the default: see `docs/TELEMETRY.md`.
fn init_telemetry(
    tendril_home: &std::path::Path,
) -> Option<Arc<tendril_core::telemetry::Telemetry>> {
    use tendril_core::telemetry::{self, AppStartContext};

    let config_path = tendril_core::config::get_config_path(tendril_home);
    let settings = tendril_core::config::load_config(&config_path).unwrap_or_default();

    let telemetry = telemetry::init(tendril_home, &settings)?;
    telemetry::install(telemetry.clone());
    telemetry::spawn_flusher(telemetry.clone(), TELEMETRY_FLUSH_INTERVAL);

    telemetry.track_app_started(&AppStartContext {
        version: tendril_core::version().to_string(),
        project_count: settings.projects.len() as i64,
        llm_configured: settings.llm.is_some(),
    });

    Some(telemetry)
}

/// Periodic cost backfill. Started only by the master — the `MasterGuard` has already been acquired by
/// the time this is called — and re-checked per pass, because a daemon can be superseded while
/// running and a demoted one must not write cost rows to the shared database.
///
/// Shaped like [`spawn_worktree_reaper`] on purpose: this is the same recurring-task pattern, not a
/// second scheduling mechanism.
fn spawn_cost_backfill(tendril_home: PathBuf) {
    // Comfortably after the models.dev enrichment that `AppState` kicks off at startup, so the first
    // pass prices against live data rather than the static fallback table.
    const INITIAL_DELAY: Duration = Duration::from_secs(60);
    // The pass is self-limiting: it goes quiet once every row is either filled or unfillable, which is
    // why it needs no config key of its own.
    const INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

    tokio::spawn(async move {
        let mut delay = INITIAL_DELAY;
        loop {
            // Every pass sleeps before it runs, so backfill never competes with startup for disk.
            tokio::time::sleep(delay).await;
            delay = INTERVAL;

            if !tendril_core::config::is_master(&tendril_home) {
                continue;
            }

            let home = tendril_home.clone();
            // A panic inside a pass must not take the loop down with it.
            let pass = tokio::task::spawn_blocking(move || {
                tendril_core::jobs::cost_backfill::run_pass(&home)
            })
            .await;

            match pass {
                Ok(report) => {
                    if !report.is_empty() {
                        tracing::info!(
                            "Cost backfill: {} estimated, {} unpriced, {} failed",
                            report.filled,
                            report.unpriced,
                            report.failed,
                        );
                    }
                }
                Err(e) => tracing::warn!("Cost backfill pass failed: {}", e),
            }
        }
    });
}

/// Periodic import of the GitHub issues assigned to the user, following `spawn_worktree_reaper`'s
/// shape: sleep first, re-read the config each pass, and treat a non-positive interval as "disabled,
/// recheck occasionally" rather than "never look again".
///
/// The master check lives inside the sweep rather than here, so a daemon that loses the election
/// while running stops importing on the next pass instead of racing the winner. That is also why the
/// pass takes the config from disk each time: an operator can enable the importer, or change its
/// cadence, without restarting the daemon.
fn spawn_assigned_issues_importer(tendril_home: PathBuf, state: Arc<AppState>) {
    /// Startup is busy enough without a `gh` call; the first sweep waits.
    const SEED_DELAY: Duration = Duration::from_secs(90);
    /// How long a disabled importer waits before re-reading the config.
    const DISABLED_RECHECK: Duration = Duration::from_secs(30 * 60);

    tokio::spawn(async move {
        tokio::time::sleep(SEED_DELAY).await;

        loop {
            let config_path = tendril_core::config::get_config_path(&tendril_home);
            let settings = tendril_core::config::load_config(&config_path).unwrap_or_default();

            let interval = settings.inbox.check_interval_minutes;
            if interval <= 0 {
                tokio::time::sleep(DISABLED_RECHECK).await;
                continue;
            }

            let report = tendril_core::inbox::run_assigned_issues_sweep(
                &tendril_home,
                &settings,
                &state.job_manager,
            )
            .await;

            if !report.imported.is_empty() {
                tracing::info!(
                    "Assigned issue import: {} imported ({} auto-accepted), {} already known",
                    report.imported.len(),
                    report.accepted,
                    report.skipped,
                );
            }
            for error in &report.errors {
                tracing::warn!("Assigned issue import: {}", error);
            }

            // `max(1)`: a fractional-minute interval is not expressible, and a zero-length sleep would
            // spin on `gh`.
            tokio::time::sleep(Duration::from_secs((interval as u64).max(1) * 60)).await;
        }
    });
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

    let interval_home = tendril_home.clone();
    let body_home = tendril_home;

    tasks::spawn_recurring(
        "worktree reaper",
        move || {
            let config_path = tendril_core::config::get_config_path(&interval_home);
            let settings = tendril_core::config::load_config(&config_path).unwrap_or_default();
            if settings.worktree_reaper_interval <= 0 {
                None
            } else {
                Some(Duration::from_secs(
                    settings.worktree_reaper_interval as u64 * 60,
                ))
            }
        },
        move || {
            let tendril_home = body_home.clone();
            async move {
                let config_path = tendril_core::config::get_config_path(&tendril_home);
                let settings = tendril_core::config::load_config(&config_path).unwrap_or_default();

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
        },
    );
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

    rebuild_recommendations(tendril_home, &plans_dir).await;
}

/// Rebuilds the `Recommendations` projection from the plan folders on disk, once per daemon start.
///
/// `sync_plan` keeps the projection current from here on, but every database that predates it holds
/// rows no write path has touched since the original app wrote them — including rows for plans that
/// no longer exist. Repairing on startup is what fixes those without waiting for someone to run
/// `tendril plan rec rebuild`. Runs after plan migration so it projects the migrated YAML, blocks
/// off-reactor, and logs rather than fails: one unparseable plan folder must not stop the daemon
/// booting.
async fn rebuild_recommendations(tendril_home: &std::path::Path, plans_dir: &std::path::Path) {
    let db_path = tendril_core::config::get_database_path(tendril_home);
    let plans_dir = plans_dir.to_path_buf();

    let outcome = tokio::task::spawn_blocking(move || {
        let conn = tendril_core::db::open_database(&db_path)
            .map_err(|e| format!("could not open the database: {e}"))?;
        tendril_core::db::rebuild_recommendations_projection(&conn, &plans_dir)
            .map_err(|e| e.to_string())
    })
    .await;

    match outcome {
        Ok(Ok((rows, plans))) => tracing::info!(
            "Rebuilt recommendations projection: {} row(s) from {} plan(s)",
            rows,
            plans
        ),
        Ok(Err(e)) => tracing::warn!("Recommendations projection rebuild failed: {}", e),
        Err(e) => tracing::warn!("Recommendations projection rebuild panicked: {}", e),
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
