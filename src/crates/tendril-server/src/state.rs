use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64};
// The settings snapshot is read from synchronous middleware, so it uses the std lock; `version_info`
// is awaited and uses tokio's. Both names would be `RwLock`, hence the alias.
use std::sync::Arc;
use std::sync::RwLock as StdRwLock;
use std::time::SystemTime;
use tendril_core::agents::model_cache::{self, CacheFreshness};
use tendril_core::auth::rate_limit::LoginRateLimiter;
use tendril_core::chat::execution::ChatExecutionManager;
use tendril_core::config::{
    get_config_path, get_database_path, get_plans_dir_with_settings, load_config, TendrilSettings,
};
use tendril_core::jobs::JobManager;
use tendril_core::security::local_file_roots::compute_roots;
use tendril_core::version_check::VersionInfo;
use tendril_core::watcher::ChangeEvent;
use tokio::sync::{broadcast, RwLock};

use crate::event_buffer::{self, EventRingBuffer, WSEventEnvelope};

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

/// Forwards one in-process event source onto the WebSocket, stamping and buffering each event
/// through [`event_buffer::dispatch_event`] so a resuming client sees it too.
///
/// **A lag is not fatal.** `recv` reports [`broadcast::error::RecvError::Lagged`] when this task fell
/// behind the sender, and the obvious `while let Ok(evt) = rx.recv().await` exits on it just as it
/// exits on `Closed` — so one burst (and `chat.stream_delta` fires per agent output line) would end
/// the only route that source has to any client, for the whole life of the daemon. The dropped events
/// are unrecoverable, but the next one is not: it is forwarded, and the `seq` gap tells a client to
/// top up through `GET /api/events/backfill`, which reports `gap: true` for exactly this case.
/// `routes::changes::stream_changes` and `watch::spawn_change_watcher` make the same choice.
pub fn spawn_event_forwarder<T>(
    label: &'static str,
    mut rx: broadcast::Receiver<T>,
    seq_counter: Arc<AtomicU64>,
    ring_buffer: Arc<EventRingBuffer>,
    ws_tx: broadcast::Sender<String>,
) where
    T: serde::Serialize + Clone + Send + 'static,
{
    tokio::spawn(async move {
        loop {
            let evt = match rx.recv().await {
                Ok(evt) => evt,
                Err(broadcast::error::RecvError::Lagged(dropped)) => {
                    tracing::warn!(
                        "{label} event forwarder lagged by {dropped} events; continuing with the next one"
                    );
                    continue;
                }
                // Only the sender going away ends the forwarder.
                Err(broadcast::error::RecvError::Closed) => break,
            };
            if let Ok(payload) = serde_json::to_value(&evt) {
                event_buffer::dispatch_event(&seq_counter, &ring_buffer, &ws_tx, payload);
            }
        }
    });
}

/// Turns a finished job into an event in the chat sessions that are watching its plan, and lets the
/// agent react to it.
///
/// This is the other half of V1's job→chat channel. The daemon could already *store* a system message
/// into a plan's chats (`chat::storage::broadcast_system_message_to_plan_sessions`, used for the
/// pull-request case), but nothing ran a turn afterwards, so the agent never saw the event. Here the
/// event goes through `ChatExecutionManager::notify_event`, which stores it as a `system` message *and*
/// runs a turn under the `# Current Event Notification` framing — the thing that makes the agent treat
/// it as something to advise on rather than answer.
///
/// It listens on the job manager's own broadcast rather than living inside
/// [`tendril_core::jobs::manager`]: a job's completion path should not have to know that chats exist,
/// and the events it already publishes carry everything needed (the outcome, the plan folder, the
/// status message). Only terminal events are acted on — a `job.status_changed` per transition would
/// start a turn for every step of a job's life.
fn spawn_chat_job_notifier(
    tendril_home: PathBuf,
    plans_dir: PathBuf,
    chat_manager: Arc<ChatExecutionManager>,
    mut rx: broadcast::Receiver<tendril_core::jobs::manager::JobEvent>,
) {
    tokio::spawn(async move {
        loop {
            let event = match rx.recv().await {
                Ok(event) => event,
                // A lag is not fatal, for the same reason `spawn_event_forwarder` says it is not: the
                // events dropped are unrecoverable but the next one is not.
                Err(broadcast::error::RecvError::Lagged(dropped)) => {
                    tracing::warn!(
                        "chat job notifier lagged by {dropped} events; continuing with the next one"
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            };

            if !matches!(
                event.event_type.as_str(),
                tendril_core::jobs::manager::JOB_EVENT_COMPLETED
                    | tendril_core::jobs::manager::JOB_EVENT_FAILED
            ) {
                continue;
            }
            let Some(folder_name) = event.plan_folder.clone() else {
                // A job with no plan has no chat to report to; V2 has no per-job chat association.
                continue;
            };

            let message = describe_job_event(&event, &plans_dir, &folder_name);
            let plan_chat_session_id =
                tendril_core::plans::reader::read_plan_yaml(&plans_dir.join(&folder_name))
                    .ok()
                    .and_then(|(plan, _)| plan.chat_session_id.clone());

            // The same recipient rule the pull-request case uses: every session attached to the plan's
            // folder, plus the plan's own chat.
            let recipients = match tendril_core::chat::storage::plan_session_recipients(
                &tendril_home,
                &folder_name,
                plan_chat_session_id.as_deref(),
            ) {
                Ok(recipients) => recipients,
                Err(err) => {
                    tracing::debug!("Could not resolve chat recipients for {folder_name}: {err}");
                    continue;
                }
            };

            for session_id in recipients {
                if let Err(err) = chat_manager.notify_event(&session_id, &message).await {
                    tracing::debug!("Could not notify chat session {session_id}: {err}");
                }
            }
        }
    });
}

/// The sentence a job event becomes in a chat, in the shape V1's injected events take: an
/// `[System Event]` prefix, the job and what it was, the plan it was for, and the reason when it failed.
fn describe_job_event(
    event: &tendril_core::jobs::manager::JobEvent,
    plans_dir: &Path,
    folder_name: &str,
) -> String {
    let plan_id: u32 = folder_name
        .split('-')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let title = tendril_core::plans::reader::read_plan_yaml(&plans_dir.join(folder_name))
        .ok()
        .map(|(plan, _)| plan.title.clone())
        .filter(|t| !t.trim().is_empty());
    let plan = match title {
        Some(title) => format!(" for plan '{}' (#{:05})", title, plan_id),
        None => format!(" for plan #{:05}", plan_id),
    };

    let outcome = if event.event_type == tendril_core::jobs::manager::JOB_EVENT_COMPLETED {
        "completed".to_string()
    } else {
        format!("ended as {:?}", event.status)
    };
    let reason = match &event.status_message {
        Some(message) if !message.trim().is_empty() => format!(" Reason: {}.", message.trim()),
        _ => String::new(),
    };

    format!(
        "[System Event] Job {} ({}) {}{}.{}",
        event.job_id, event.job_type, outcome, plan, reason
    )
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
    /// Recent events dispatched over `ws_tx`, kept so a reconnecting client can resume via
    /// `?since=<seq>` instead of re-fetching full state. See [`AppState::dispatch_ws_event`].
    pub ring_buffer: Arc<EventRingBuffer>,
    /// Source of the monotonic `seq` stamped onto every dispatched event. Starts at 1 so the first
    /// dispatched event of a daemon's lifetime is `seq: 1`, never `0`.
    pub seq_counter: Arc<AtomicU64>,
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
    pub settings_cache: Arc<StdRwLock<Option<Arc<CachedSettings>>>>,
    /// Password credentials as of startup, or `None` when `config.yaml` has no `auth` block — which is
    /// the norm, and means the bearer token stays the only accepted credential.
    ///
    /// **This is a snapshot, not the live credential.** `auth_middleware` reads the Basic-auth config
    /// from [`AppState::settings_snapshot`] instead, so that `PUT /api/auth/password` takes effect
    /// without a daemon restart. Kept for callers that want to know how the daemon started up, and
    /// because `settings_snapshot` is the one place that should be doing config reads.
    pub basic_auth: Option<crate::auth::BasicAuthConfig>,
    /// Held for the duration of a PR reconciliation pass, so the periodic driver and a manual
    /// `POST /api/pull-requests/sync` can never run concurrently.
    pub pr_sync_running: Arc<AtomicBool>,
    /// Last known release-check result, seeded from disk at startup and refreshed by
    /// `spawn_version_check`/`POST /api/version/check`. `consecutive_failures` lives only here —
    /// the disk cache is never written on a failed check.
    pub version_info: Arc<RwLock<VersionInfo>>,
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
        let basic_auth = crate::auth::BasicAuthConfig::from_settings(&settings);
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
        let ring_buffer = Arc::new(EventRingBuffer::default());
        let seq_counter = Arc::new(AtomicU64::new(1));
        // Coalesced change events, so 256 is generous: a client would have to be a full burst-window
        // behind to lag, and `stream_changes` degrades a lag to one full rescan anyway. Constructing
        // state deliberately does not start a watcher — only the master daemon does that.
        let (change_tx, _) = broadcast::channel(256);

        // Forward chat events to WebSocket clients, through the same ring buffer/seq path every
        // other event source uses so a resuming client sees chat events too.
        spawn_event_forwarder(
            "chat",
            chat_manager.subscribe_events(),
            seq_counter.clone(),
            ring_buffer.clone(),
            ws_tx.clone(),
        );

        // Job lifecycle events take the same route. Without this the WebSocket surface carries no
        // job events at all and the app is left polling: a job that starts, fails or completes while
        // no job view is open is invisible until the next fetch. See
        // [`tendril_core::jobs::manager::JobEvent`] on why the names are `job.`-prefixed.
        spawn_event_forwarder(
            "job",
            job_manager.subscribe_events(),
            seq_counter.clone(),
            ring_buffer.clone(),
            ws_tx.clone(),
        );

        // A finished job becomes an event in the chats watching its plan, and the agent advises on it.
        spawn_chat_job_notifier(
            tendril_home.clone(),
            plans_dir.clone(),
            Arc::clone(&chat_manager),
            job_manager.subscribe_events(),
        );

        // Reconcile tracked pull requests on a timer. The task captures clones rather than the
        // `AppState` it is being constructed inside, so nothing here has to be `Arc`ed early.
        let pr_sync_running = Arc::new(AtomicBool::new(false));
        crate::pr_sync::spawn_pr_status_sync(
            db_path.clone(),
            plans_dir.clone(),
            pr_sync_running.clone(),
            ws_tx.clone(),
            ring_buffer.clone(),
            seq_counter.clone(),
        );

        // `current_version` is always known, cache or not — only `latest_version`/`has_update`
        // depend on a check ever having succeeded.
        let mut seeded_version_info = tendril_core::version_check::load_cache(&tendril_home);
        if seeded_version_info.current_version.is_empty() {
            seeded_version_info.current_version =
                tendril_core::version_check::current_version().to_string();
        }
        let version_info = Arc::new(RwLock::new(seeded_version_info));

        Self {
            tendril_home,
            config_path,
            plans_dir,
            db_path,
            job_manager,
            chat_manager,
            ws_tx,
            ring_buffer,
            seq_counter,
            change_tx,
            secret,
            login_rate_limiter: Arc::new(LoginRateLimiter::new(rate_limit)),
            settings_cache: Arc::new(StdRwLock::new(None)),
            basic_auth,
            pr_sync_running,
            version_info,
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

    /// Stamps `event` with the next monotonic sequence number, records it in [`Self::ring_buffer`],
    /// and broadcasts it across [`Self::ws_tx`]. Every event a WebSocket client can observe should
    /// go through this rather than `ws_tx.send` directly, so a reconnecting client's `?since=<seq>`
    /// replay and the REST backfill endpoint both see it too.
    pub fn dispatch_ws_event(&self, event: serde_json::Value) -> WSEventEnvelope {
        event_buffer::dispatch_event(&self.seq_counter, &self.ring_buffer, &self.ws_tx, event)
    }
}

#[cfg(test)]
mod tests {
    use super::describe_job_event;
    use tendril_core::jobs::manager::{JobEvent, JOB_EVENT_COMPLETED, JOB_EVENT_FAILED};
    use tendril_core::models::JobStatus;

    fn event(event_type: &str, status: JobStatus, status_message: Option<&str>) -> JobEvent {
        JobEvent {
            event_type: event_type.to_string(),
            job_id: "00042".to_string(),
            job_type: "ExecutePlan".to_string(),
            status,
            status_message: status_message.map(str::to_string),
            plan_folder: Some("00007-PortTheChat".to_string()),
        }
    }

    /// The sentence a job event becomes in a chat. The `[System Event]` prefix is what V1's injected
    /// events carry, and the plan id is the padded form a plan is known by everywhere else.
    #[test]
    fn a_finished_job_reads_as_an_event_naming_its_plan() {
        // No plan on disk here, so the title is absent and the id alone identifies it.
        let dir = std::path::Path::new("/nonexistent-plans-dir");

        let completed = describe_job_event(
            &event(JOB_EVENT_COMPLETED, JobStatus::Completed, None),
            dir,
            "00007-PortTheChat",
        );
        assert_eq!(
            completed,
            "[System Event] Job 00042 (ExecutePlan) completed for plan #00007."
        );

        // A failure names the outcome and carries the reason, which is the whole value of the event.
        let failed = describe_job_event(
            &event(
                JOB_EVENT_FAILED,
                JobStatus::Failed,
                Some("verification failed"),
            ),
            dir,
            "00007-PortTheChat",
        );
        assert_eq!(
            failed,
            "[System Event] Job 00042 (ExecutePlan) ended as Failed for plan #00007. Reason: verification failed."
        );

        // Timeout and Stopped are failures too, and say which they were rather than "failed".
        let timed_out = describe_job_event(
            &event(JOB_EVENT_FAILED, JobStatus::Timeout, None),
            dir,
            "00007-PortTheChat",
        );
        assert!(timed_out.contains("ended as Timeout"), "got: {}", timed_out);

        // A blank status message adds no dangling "Reason:".
        let blank = describe_job_event(
            &event(JOB_EVENT_FAILED, JobStatus::Failed, Some("   ")),
            dir,
            "00007-PortTheChat",
        );
        assert!(!blank.contains("Reason:"), "got: {}", blank);

        // An unparseable folder still produces a sentence rather than nothing.
        let odd = describe_job_event(
            &event(JOB_EVENT_COMPLETED, JobStatus::Completed, None),
            dir,
            "not-a-plan-folder",
        );
        assert!(odd.contains("#00000"), "got: {}", odd);
    }
}
