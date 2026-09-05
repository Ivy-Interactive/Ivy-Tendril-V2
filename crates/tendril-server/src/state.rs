use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_config_path, get_database_path, get_plans_dir, load_config};
use tendril_core::jobs::JobManager;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub tendril_home: PathBuf,
    pub config_path: PathBuf,
    pub plans_dir: PathBuf,
    pub db_path: PathBuf,
    pub job_manager: Arc<JobManager>,
    pub ws_tx: broadcast::Sender<String>,
    pub secret: String,
}

impl AppState {
    pub fn new(tendril_home: PathBuf, secret: String) -> Self {
        let config_path = get_config_path(&tendril_home);
        let plans_dir = get_plans_dir(&tendril_home);
        let db_path = get_database_path(&tendril_home);

        let settings = load_config(&config_path).unwrap_or_default();
        let job_manager = Arc::new(JobManager::new(tendril_home.clone(), settings));
        let (ws_tx, _) = broadcast::channel(500);

        Self {
            tendril_home,
            config_path,
            plans_dir,
            db_path,
            job_manager,
            ws_tx,
            secret,
        }
    }
}
