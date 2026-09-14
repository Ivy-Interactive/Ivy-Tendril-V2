use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};
use std::time::SystemTime;
use tendril_core::agents::model_cache::{self, CacheFreshness};
use tendril_core::auth::rate_limit::LoginRateLimiter;
use tendril_core::chat::execution::ChatExecutionManager;
use tendril_core::config::{
    get_config_path, get_database_path, get_plans_dir_with_settings, load_config, TendrilSettings,
};
use tendril_core::jobs::JobManager;
use tendril_core::security::local_file_roots::compute_roots;
use tendril_core::watcher::ChangeEvent;
use tokio::sync::broadcast;

/// `config.yaml` as of a given mtime, plus everything derived from it that a per-request check needs.
///
/// The API key and the local-file roots are both read on requests that must not pay for a YAML parse
/// (and, for the roots, a directory-resolution walk) every time, so they are cached together and
/// invalidated together.
pub struct CachedSettings {
    /// `None` when `config.yaml` does not exist — an install with no config still gets a snapshot,
    /// and will pick one up the moment the file appears.
    pub mtime: Option<SystemTime>,
    pub settings: Arc<TendrilSettings>,
    pub local_file_roots: Arc<Vec<PathBuf>>,
}

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
    /// Exponential backoff for `POST /api/auth/login`, shared by every request so the backoff is not
    /// reset by anything short of a successful login or the cleanup sweep.
    pub login_rate_limiter: Arc<LoginRateLimiter>,
    /// Settings snapshot behind an mtime check — the V2 equivalent of the original's
    /// `SettingsReloaded` event, and it also catches an edit made directly to `config.yaml`.
    pub settings_cache: Arc<RwLock<Option<Arc<CachedSettings>>>>,
    /// Held for the duration of a PR reconciliation pass, so the periodic driver and a manual
    /// `POST /api/pull-requests/sync` can never run concurrently.
    pub pr_sync_running: Arc<AtomicBool>,
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
        let rate_limit = settings
            .auth
            .as_ref()
            .map(|auth| auth.effective_rate_limit())
            .unwrap_or_default();
        let enrich_models = settings.enrich_models;
        let enrichment_hours = settings.model_enrichment_interval_hours;
        let warn_age_days = settings.model_cache_warn_age_days;
        let max_age_days = settings.model_cache_max_age_days;

        // Make any cached models.dev enrichment immediately available (unless it has expired),
        // then optionally refresh it in the background — on a repeating cadence, not just once —
        // so startup never blocks on network access and pricing/limit changes are eventually
        // picked up without restarting the daemon.
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
            model_cache::spawn_enrichment(
                tendril_home.clone(),
                model_cache::enrichment_interval(enrichment_hours),
            );
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

        // Reconcile tracked pull requests on a timer. The task captures clones rather than the
        // `AppState` it is being constructed inside, so nothing here has to be `Arc`ed early.
        let pr_sync_running = Arc::new(AtomicBool::new(false));
        crate::pr_sync::spawn_pr_status_sync(
            db_path.clone(),
            plans_dir.clone(),
            pr_sync_running.clone(),
            ws_tx.clone(),
        );

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
            login_rate_limiter: Arc::new(LoginRateLimiter::new(rate_limit)),
            settings_cache: Arc::new(RwLock::new(None)),
            pr_sync_running,
        }
    }

    /// The current settings and local-file roots, reparsing `config.yaml` only when its mtime moved.
    ///
    /// mtime granularity means two writes inside the same filesystem tick can look identical, so the
    /// config write path calls [`AppState::invalidate_settings_cache`] rather than relying on this.
    pub fn settings_snapshot(&self) -> Arc<CachedSettings> {
        let mtime = std::fs::metadata(&self.config_path)
            .ok()
            .and_then(|meta| meta.modified().ok());

        if let Some(cached) = self
            .settings_cache
            .read()
            .ok()
            .and_then(|guard| guard.clone())
        {
            if cached.mtime == mtime {
                return cached;
            }
        }

        let settings = load_config(&self.config_path).unwrap_or_default();
        let roots = compute_roots(&settings, &self.tendril_home, &self.plans_dir);
        let fresh = Arc::new(CachedSettings {
            mtime,
            settings: Arc::new(settings),
            local_file_roots: Arc::new(roots),
        });

        if let Ok(mut guard) = self.settings_cache.write() {
            *guard = Some(fresh.clone());
        }

        fresh
    }

    /// Drops the snapshot so the next reader reparses. Called by the config write path, where the new
    /// contents are known to differ whatever the mtime says.
    pub fn invalidate_settings_cache(&self) {
        if let Ok(mut guard) = self.settings_cache.write() {
            *guard = None;
        }
    }

    /// The configured `api.apiKey`, or `None` when the install has none (every install that has never
    /// set one, which is the no-op path for the API-key layer).
    pub fn api_key(&self) -> Option<String> {
        self.settings_snapshot()
            .settings
            .api
            .as_ref()
            .and_then(|api| api.api_key.as_ref())
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty())
    }
}
