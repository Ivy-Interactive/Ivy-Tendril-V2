use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::agents::model_cache::{self, CacheFreshness};
use tendril_core::chat::execution::ChatExecutionManager;
use tendril_core::config::{
    get_config_path, get_database_path, get_plans_dir_with_settings, load_config,
};
use tendril_core::jobs::JobManager;
use tendril_core::watcher::ChangeEvent;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub tendril_home: PathBuf,
    pub config_path: PathBuf,
    pub plans_dir: PathBuf,
    pub db_path: PathBuf,
    pub job_manager: Arc<JobManager>,
    pub chat_manager: Arc<ChatExecutionManager>,
    pub ws_tx: broadcast::Sender<String>,
    /// Filesystem change notifications, fed by the watcher the master daemon starts and consumed by
    /// `/api/changes/events`. The channel exists whether or not a watcher is running, so a test can
    /// publish on it directly and a daemon that lost the master race still serves the route.
    pub change_tx: broadcast::Sender<ChangeEvent>,
    pub secret: String,
}

impl AppState {
    pub fn new(tendril_home: PathBuf, secret: String) -> Self {
        let config_path = get_config_path(&tendril_home);
        let settings = load_config(&config_path).unwrap_or_default();
        let plans_dir = get_plans_dir_with_settings(&tendril_home, Some(&settings));
        Self::with_plans_dir(tendril_home, plans_dir, secret)
    }

    pub fn with_plans_dir(tendril_home: PathBuf, plans_dir: PathBuf, secret: String) -> Self {
        let config_path = get_config_path(&tendril_home);
        let db_path = get_database_path(&tendril_home);

        let settings = load_config(&config_path).unwrap_or_default();
        let enrich_models = settings.enrich_models;
        let warn_age_days = settings.model_cache_warn_age_days;
        let max_age_days = settings.model_cache_max_age_days;

        // Make any cached models.dev enrichment immediately available (unless it has expired),
        // then optionally refresh it in the background so startup never blocks on network access.
        if let Ok(catalog) = model_cache::load_disk_cache(&tendril_home) {
            if !catalog.is_empty() {
                match model_cache::classify(&catalog, warn_age_days, max_age_days) {
                    CacheFreshness::Fresh { age_days } => {
                        tracing::debug!(
                            "Using models.dev disk cache ({} models, age: {})",
                            catalog.specs.len(),
                            age_days.map_or("unknown".to_string(), |d| format!("{d} days"))
                        );
                        tendril_core::agents::model_specs::register_dynamic_specs(catalog.specs);
                    }
                    CacheFreshness::Stale { age_days } => {
                        let age = age_days.map_or("unknown".to_string(), |d| format!("{d} days"));
                        tracing::warn!(
                            "Model cache from models.dev is {age} old; pricing may be out of date. Run `tendril models --refresh` or check network access."
                        );
                        tendril_core::agents::model_specs::register_dynamic_specs(catalog.specs);
                    }
                    CacheFreshness::Expired { age_days } => {
                        let age = age_days.map_or("no recorded fetch time".to_string(), |d| {
                            format!("{d} days old")
                        });
                        tracing::warn!(
                            "Ignoring models.dev cache ({age}); falling back to built-in model specs"
                        );
                    }
                }
            }
        }
        if enrich_models {
            let enrich_home = tendril_home.clone();
            tokio::spawn(async move {
                let client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(10))
                    .build()
                    .unwrap_or_default();
                match tendril_core::agents::model_cache::fetch_live_models(&client, &enrich_home)
                    .await
                {
                    Ok(count) => {
                        tracing::info!(
                            "Enriched model specs cache from models.dev ({count} models)"
                        )
                    }
                    Err(err) => {
                        tracing::warn!(
                            "models.dev live enrichment skipped (offline or network error): {err}"
                        )
                    }
                }
            });
        }

        // `share` rather than `Arc::new`: a finished job needs a handle back to the manager to start
        // the jobs that were waiting on it.
        let job_manager = JobManager::new(tendril_home.clone(), settings).share();
        let chat_manager = Arc::new(ChatExecutionManager::new(tendril_home.clone()));
        let (ws_tx, _) = broadcast::channel(500);
        // Coalesced change events, so 256 is generous: a client would have to be a full burst-window
        // behind to lag, and `stream_changes` degrades a lag to one full rescan anyway. Constructing
        // state deliberately does not start a watcher — only the master daemon does that.
        let (change_tx, _) = broadcast::channel(256);

        // Forward chat events to WebSocket clients
        let mut chat_rx = chat_manager.subscribe_events();
        let ws_tx_clone = ws_tx.clone();
        tokio::spawn(async move {
            while let Ok(evt) = chat_rx.recv().await {
                if let Ok(json) = serde_json::to_string(&evt) {
                    let _ = ws_tx_clone.send(json);
                }
            }
        });

        Self {
            tendril_home,
            config_path,
            plans_dir,
            db_path,
            job_manager,
            chat_manager,
            ws_tx,
            change_tx,
            secret,
        }
    }
}
