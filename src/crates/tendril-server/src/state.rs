use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::chat::execution::ChatExecutionManager;
use tendril_core::config::{
    get_config_path, get_database_path, get_plans_dir_with_settings, load_config,
};
use tendril_core::jobs::JobManager;
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

        // Make any cached models.dev enrichment immediately available, then optionally
        // refresh it in the background so startup never blocks on network access.
        if let Ok(cached_specs) = tendril_core::agents::model_cache::load_disk_cache(&tendril_home)
        {
            if !cached_specs.is_empty() {
                tendril_core::agents::model_specs::register_dynamic_specs(cached_specs);
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
                        tracing::info!("Enriched model specs cache from models.dev ({count} models)")
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
            secret,
        }
    }
}
