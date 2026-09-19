use std::collections::HashSet;
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
        // One announcement per conversation per job outcome, keyed as V1's `OnJobFinished` keys it
        // (`"{sessionId}:{jobId}:{status}"`). A terminal status can be written more than once — a
        // reconciled or re-supervised job re-persists its row, and every such write republishes the
        // event — and each announcement here does not just append a message, it runs a whole agent turn.
        // Bounded so a long-lived daemon cannot grow it without limit; far above any plausible number of
        // jobs one conversation announces.
        const MAX_ANNOUNCED: usize = 4096;
        let mut announced: HashSet<String> = HashSet::new();

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
            let folder_name = event_plan_folder(&event, &plans_dir);
            let message = describe_job_event(&event, &plans_dir, folder_name.as_deref());
            let recipients = notifier_recipients(&tendril_home, &plans_dir, &event);
            if recipients.is_empty() {
                continue;
            }

            for session_id in recipients {
                let key = format!("{}:{}:{:?}", session_id, event.job_id, event.status);
                if !announced.insert(key) {
                    continue;
                }
                if announced.len() > MAX_ANNOUNCED {
                    announced.clear();
                }
                if let Err(err) = chat_manager.notify_event(&session_id, &message).await {
                    tracing::debug!("Could not notify chat session {session_id}: {err}");
                }
            }
        }
    });
}

/// The plan an event is *about*.
///
/// A `CreatePlan` starts with no plan folder and only learns its plan through
/// `tendril job status --plan-id`, so the reported id is the fallback — without it the one job type
/// whose whole purpose is to produce a plan was the one type that could never announce it.
fn event_plan_folder(
    event: &tendril_core::jobs::manager::JobEvent,
    plans_dir: &Path,
) -> Option<String> {
    event.plan_folder.clone().or_else(|| {
        event.reported_plan_id.as_deref().and_then(|plan_id| {
            tendril_core::plans::helpers::resolve_plan_folder_name(plan_id, plans_dir).ok()
        })
    })
}

/// The conversations a job event belongs to, in the order they are announced.
///
/// Two ways a conversation can own an event, and a job may match either: it was started *from* that
/// conversation (`chat_session_id`, which is the only route open to a job with no plan — a `CreatePlan`
/// has none until it finishes), or the conversation is attached to the plan the job worked on. The union
/// is what makes both a plain chat and a plan's own side-panel chat hear about the same job, and the
/// dedupe is what stops a conversation that matches both ways hearing about it twice — each announcement
/// runs a whole agent turn.
///
/// Extracted from the notifier loop so it can be tested without a chat manager or a broadcast channel.
fn notifier_recipients(
    tendril_home: &Path,
    plans_dir: &Path,
    event: &tendril_core::jobs::manager::JobEvent,
) -> Vec<String> {
    let mut recipients: Vec<String> = Vec::new();

    if let Some(folder_name) = event_plan_folder(event, plans_dir) {
        let plan_chat_session_id =
            tendril_core::plans::reader::read_plan_yaml(&plans_dir.join(&folder_name))
                .ok()
                .and_then(|(plan, _)| plan.chat_session_id.clone());
        match tendril_core::chat::storage::plan_session_recipients(
            tendril_home,
            &folder_name,
            plan_chat_session_id.as_deref(),
        ) {
            Ok(found) => recipients = found,
            Err(err) => {
                tracing::debug!("Could not resolve chat recipients for {folder_name}: {err}");
            }
        }
    }

    if let Some(chat_session_id) = event
        .chat_session_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        if !recipients.iter().any(|id| id == chat_session_id) {
            recipients.push(chat_session_id.to_string());
        }
    }

    recipients
}

/// The sentence a job event becomes in a chat.
///
/// The wording is V1's to the character, because it is a parsed format and not just prose: the app
/// reads it back with `formatSystemEvent`'s `FINISHED` regex to render the line as a completed/failed
/// event with a clickable plan chip, and `resolveJobState` uses the job id it recovers to keep a job
/// that has aged out of the live list in the conversation's header. A sentence this function words
/// differently still *reads* fine and silently loses both.
///
/// `Job <id> (<Type>) for '<plan-id>: <title>' has finished with status: <Status> (<reason>)`, then a
/// trailing instruction that is addressed to the agent and dropped from the display.
fn describe_job_event(
    event: &tendril_core::jobs::manager::JobEvent,
    plans_dir: &Path,
    folder_name: Option<&str>,
) -> String {
    // `<plan-id>: <title>` is what the app's `PLAN_INFO` looks for to offer "open plan"; anything else
    // in these quotes renders as a plain name, which is what a job with no plan wants.
    let subject = folder_name
        .map(|folder_name| {
            // A plan folder is `<5-digit id>-<TitleInPascalCase>`. The split is guarded on those digits
            // rather than taken at the first `-`, or a folder that is not a plan at all
            // (`not-a-plan-folder`) would lose its first segment and be named `a-plan-folder`.
            let (plan_id, name_part) = match folder_name.split_once('-') {
                Some((id, rest)) => match id.parse::<u32>() {
                    Ok(plan_id) => (Some(plan_id), rest),
                    Err(_) => (None, folder_name),
                },
                None => (None, folder_name),
            };
            // The plan's real title when it can be read; otherwise its folder's name, which is derived
            // from that title and is the best available stand-in for a plan that is gone or unreadable.
            let title = tendril_core::plans::reader::read_plan_yaml(&plans_dir.join(folder_name))
                .ok()
                .map(|(plan, _)| plan.title.clone())
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| name_part.to_string());
            match plan_id {
                Some(plan_id) => format!("{:05}: {}", plan_id, title),
                // Not a plan folder at all, so there is no id to offer — name it and stop there.
                None => title,
            }
        })
        .unwrap_or_else(|| event.job_type.clone());

    let reason = match &event.status_message {
        Some(message) if !message.trim().is_empty() => format!(" ({})", message.trim()),
        _ => String::new(),
    };
    let advice = if event.event_type == tendril_core::jobs::manager::JOB_EVENT_COMPLETED {
        "Review the outcome and advise on next steps."
    } else {
        "Diagnose the failure and advise on next steps."
    };

    format!(
        "[System Event] Job {} ({}) for '{}' has finished with status: {}{}. {}",
        event.job_id,
        event.job_type,
        subject,
        event.status.as_str(),
        reason,
        advice
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
    use super::{describe_job_event, notifier_recipients};
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
            chat_session_id: None,
            reported_plan_id: None,
        }
    }

    /// A throwaway `TENDRIL_HOME` with a plans directory, removed on drop.
    struct Home {
        path: std::path::PathBuf,
    }

    impl Home {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "tendril-notifier-{label}-{}",
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(path.join("Plans")).expect("create Plans");
            Self { path }
        }

        fn plans_dir(&self) -> std::path::PathBuf {
            self.path.join("Plans")
        }

        /// A plan folder whose `plan.yaml` optionally names the conversation it belongs to.
        fn write_plan(&self, folder_name: &str, chat_session_id: Option<&str>) {
            let folder = self.plans_dir().join(folder_name);
            std::fs::create_dir_all(&folder).expect("create plan folder");
            let mut plan = tendril_core::models::PlanYaml {
                schema_version: 3,
                state: "Review".to_string(),
                project: "FixtureProject".to_string(),
                title: "Port The Chat".to_string(),
                ..Default::default()
            };
            plan.chat_session_id = chat_session_id.map(str::to_string);
            tendril_core::plans::writer::write_plan_yaml(&folder, &plan).expect("write plan.yaml");
        }

        /// A chat session, optionally attached to a plan's folder as a side-panel chat is.
        fn write_session(&self, id: &str, plan_folder_name: Option<&str>) {
            let now = chrono::Utc::now();
            let session = tendril_core::chat::models::ChatSession {
                id: id.to_string(),
                title: id.to_string(),
                created_at: now,
                updated_at: now,
                agent_id: "claude".to_string(),
                model_id: "default".to_string(),
                messages: Vec::new(),
                effort: None,
                spawned_job_ids: Vec::new(),
                plan_folder_name: plan_folder_name.map(str::to_string),
            };
            tendril_core::chat::storage::save_session(&self.path, &session).expect("save session");
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    /// Which conversations a job event reaches — the union that makes both a plain chat and a plan's own
    /// side-panel chat hear about the same job, and the dedupe that stops one hearing about it twice.
    #[test]
    fn an_event_reaches_the_chat_that_started_it_and_the_plans_own_chat() {
        let home = Home::new("recipients");
        home.write_plan("00007-PortTheChat", Some("sess-plan"));
        home.write_session("sess-plan", None);
        home.write_session("sess-panel", Some("00007-PortTheChat"));
        home.write_session("sess-caller", None);
        home.write_session("sess-unrelated", None);

        // A job on that plan, started from a third conversation: all three hear, and nobody else does.
        let mut event = event(JOB_EVENT_COMPLETED, JobStatus::Completed, None);
        event.chat_session_id = Some("sess-caller".to_string());
        let recipients = notifier_recipients(&home.path, &home.plans_dir(), &event);
        assert!(
            recipients.contains(&"sess-plan".to_string()),
            "{recipients:?}"
        );
        assert!(
            recipients.contains(&"sess-panel".to_string()),
            "{recipients:?}"
        );
        assert!(
            recipients.contains(&"sess-caller".to_string()),
            "{recipients:?}"
        );
        assert!(
            !recipients.contains(&"sess-unrelated".to_string()),
            "{recipients:?}"
        );

        // A conversation that owns the event both ways is named once: each announcement runs a turn.
        event.chat_session_id = Some("sess-plan".to_string());
        let recipients = notifier_recipients(&home.path, &home.plans_dir(), &event);
        assert_eq!(
            recipients.iter().filter(|id| *id == "sess-plan").count(),
            1,
            "{recipients:?}"
        );
    }

    /// The case the notifier used to give up on entirely: a job with no plan folder. A `CreatePlan` has
    /// none until it finishes, so before this it was the one job type that could never announce itself.
    #[test]
    fn a_job_with_no_plan_still_reaches_the_chat_that_started_it() {
        let home = Home::new("planless");
        home.write_session("sess-caller", None);

        let mut event = event(JOB_EVENT_COMPLETED, JobStatus::Completed, None);
        event.plan_folder = None;
        event.chat_session_id = Some("sess-caller".to_string());

        assert_eq!(
            notifier_recipients(&home.path, &home.plans_dir(), &event),
            vec!["sess-caller".to_string()]
        );
    }

    /// And a `CreatePlan` that reported its plan reaches that plan's conversation too, resolved from the
    /// bare id it reported rather than from a folder it never had.
    #[test]
    fn a_reported_plan_id_finds_the_plans_own_chat() {
        let home = Home::new("reported");
        home.write_plan("00042-SomePlan", Some("sess-plan"));
        home.write_session("sess-plan", None);

        let mut event = event(JOB_EVENT_COMPLETED, JobStatus::Completed, None);
        event.plan_folder = None;
        event.reported_plan_id = Some("00042".to_string());

        assert_eq!(
            notifier_recipients(&home.path, &home.plans_dir(), &event),
            vec!["sess-plan".to_string()]
        );
    }

    /// Nobody to tell is not an error — a job started from a terminal on a plan no chat is watching.
    #[test]
    fn a_job_no_conversation_owns_reaches_nobody() {
        let home = Home::new("nobody");
        home.write_plan("00007-PortTheChat", None);
        home.write_session("sess-unrelated", None);

        let mut event = event(
            JOB_EVENT_FAILED,
            JobStatus::Failed,
            Some("verification failed"),
        );
        event.chat_session_id = None;

        assert!(notifier_recipients(&home.path, &home.plans_dir(), &event).is_empty());
    }

    /// The app's `FINISHED` pattern from `utils/systemEvents.ts`, copied here rather than described,
    /// because this sentence exists to be parsed by it. A wording change that still reads well but no
    /// longer matches costs the timeline its completed/failed styling and its clickable plan chip, and
    /// costs the chat header the job ids `resolveJobState` recovers from the transcript.
    fn parses_as_finished(message: &str) -> Option<(String, String, String, String)> {
        let body = message.strip_prefix("[System Event] ")?;
        let rest = body.strip_prefix("Job ")?;
        let (job_id, rest) = rest.split_once(' ')?;
        let rest = rest.strip_prefix('(')?;
        let (job_type, rest) = rest.split_once(')')?;
        let rest = rest.strip_prefix(" for '")?;
        let (info, rest) = rest.split_once('\'')?;
        let rest = rest.strip_prefix(" has finished with status: ")?;
        let status: String = rest.chars().take_while(|c| c.is_alphanumeric()).collect();
        Some((
            job_id.to_string(),
            job_type.to_string(),
            info.to_string(),
            status,
        ))
    }

    /// The sentence a job event becomes in a chat, in V1's exact shape.
    #[test]
    fn a_finished_job_reads_as_an_event_naming_its_plan() {
        // No plan on disk here, so the title falls back to the folder's own name.
        let dir = std::path::Path::new("/nonexistent-plans-dir");

        let completed = describe_job_event(
            &event(JOB_EVENT_COMPLETED, JobStatus::Completed, None),
            dir,
            Some("00007-PortTheChat"),
        );
        assert_eq!(
            completed,
            "[System Event] Job 00042 (ExecutePlan) for '00007: PortTheChat' has finished with \
             status: Completed. Review the outcome and advise on next steps."
        );
        assert_eq!(
            parses_as_finished(&completed),
            Some((
                "00042".to_string(),
                "ExecutePlan".to_string(),
                "00007: PortTheChat".to_string(),
                "Completed".to_string()
            ))
        );

        // A failure names the outcome and carries the reason, which is the whole value of the event.
        // The reason goes in parentheses directly after the status because that is the group the app
        // renders as the event's detail line.
        let failed = describe_job_event(
            &event(
                JOB_EVENT_FAILED,
                JobStatus::Failed,
                Some("verification failed"),
            ),
            dir,
            Some("00007-PortTheChat"),
        );
        assert_eq!(
            failed,
            "[System Event] Job 00042 (ExecutePlan) for '00007: PortTheChat' has finished with \
             status: Failed (verification failed). Diagnose the failure and advise on next steps."
        );

        // Timeout and Stopped are failures too, and say which they were rather than "failed".
        let timed_out = describe_job_event(
            &event(JOB_EVENT_FAILED, JobStatus::Timeout, None),
            dir,
            Some("00007-PortTheChat"),
        );
        assert_eq!(
            parses_as_finished(&timed_out).map(|p| p.3),
            Some("Timeout".to_string())
        );

        // A blank status message adds no empty parentheses.
        let blank = describe_job_event(
            &event(JOB_EVENT_FAILED, JobStatus::Failed, Some("   ")),
            dir,
            Some("00007-PortTheChat"),
        );
        assert!(!blank.contains("()"), "got: {}", blank);

        // A folder that is not a plan folder is named, but offers no plan id to open.
        let odd = describe_job_event(
            &event(JOB_EVENT_COMPLETED, JobStatus::Completed, None),
            dir,
            Some("not-a-plan-folder"),
        );
        assert_eq!(
            parses_as_finished(&odd).map(|p| p.2),
            Some("not-a-plan-folder".to_string())
        );

        // A job with no plan at all — `SetupProject`, or a `CreatePlan` that failed before it made
        // one — still produces a parseable sentence, named by what the job was.
        let planless = describe_job_event(
            &event(JOB_EVENT_FAILED, JobStatus::Failed, Some("no repo")),
            dir,
            None,
        );
        assert_eq!(
            parses_as_finished(&planless),
            Some((
                "00042".to_string(),
                "ExecutePlan".to_string(),
                "ExecutePlan".to_string(),
                "Failed".to_string()
            ))
        );
    }
}
