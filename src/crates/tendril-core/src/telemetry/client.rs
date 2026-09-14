//! PostHog ingestion client.
//!
//! No new crate dependency: `reqwest` is already a `tendril-core` dependency and PostHog's ingestion
//! API is a single JSON POST, so the .NET `PostHogClient` is not worth reproducing.

use crate::config::TendrilSettings;
use crate::telemetry::events::*;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

/// Public project token — safe to expose, like a website tracking snippet. Ported verbatim from the
/// original's `TelemetryService.CreatePostHogOptions`.
pub const PROJECT_TOKEN: &str = "phc_uHeJHFURzThFPnizzGMzLEimLWnRAuqy8DunK8N3oYcd";

/// EU ingestion host, as the original uses.
pub const DEFAULT_HOST: &str = "https://eu.i.posthog.com";

/// The file holding the random per-install identifier.
pub const ANONYMOUS_ID_FILE: &str = ".anonymous-id";

/// A batch is never allowed to grow without bound: a daemon that cannot reach PostHog for a week must
/// not accumulate a week of events in memory.
const MAX_QUEUE: usize = 500;

fn batch_endpoint(host: &str) -> String {
    format!("{}/batch/", host.trim_end_matches('/'))
}

/// Buffers events and posts them to PostHog in batches.
///
/// Every `track_*` swallows its own errors and never blocks: capture pushes onto the queue, and a
/// background task (see [`spawn_flusher`]) drains it. Telemetry must not be able to fail or slow a
/// job.
pub struct Telemetry {
    client: reqwest::Client,
    /// Overridable so the disabled-path test can point it at a listener it controls: without the
    /// override, a passing "no network call" test could be passing only because the real host was
    /// unreachable.
    endpoint: String,
    distinct_id: String,
    super_props: Map<String, Value>,
    queue: Mutex<Vec<Value>>,
}

/// Builds a client when — and only when — telemetry is explicitly enabled.
///
/// `None` whenever telemetry is off. Every `track_*` on `Option<&Telemetry>` is then a no-op, so
/// "disabled" is unrepresentable as "constructed but suppressed".
pub fn init(tendril_home: &Path, settings: &TendrilSettings) -> Option<Arc<Telemetry>> {
    if !settings.telemetry_enabled() {
        return None;
    }
    Some(Arc::new(Telemetry::new(
        tendril_home,
        DEFAULT_HOST,
        crate::version(),
    )))
}

/// Same as [`init`] but with the ingestion host injected. For tests only: production goes through
/// [`init`], which is the one place the enabled check lives.
pub fn init_with_host(
    tendril_home: &Path,
    settings: &TendrilSettings,
    host: &str,
) -> Option<Arc<Telemetry>> {
    if !settings.telemetry_enabled() {
        return None;
    }
    Some(Arc::new(Telemetry::new(
        tendril_home,
        host,
        crate::version(),
    )))
}

static GLOBAL: OnceLock<Arc<Telemetry>> = OnceLock::new();

/// Publishes the process-wide client. Called only from `run_server`, so a CLI process never has one
/// and `tendril plan ...` sends nothing — matching the original, where the client lives in the app
/// process.
pub fn install(t: Arc<Telemetry>) {
    let _ = GLOBAL.set(t);
}

pub fn global() -> Option<&'static Arc<Telemetry>> {
    GLOBAL.get()
}

/// The tracker free functions and hooks should reach for: `telemetry::tracker().track_*(&ctx)` is a
/// no-op in a process that never called [`install`].
pub fn tracker() -> Option<&'static Telemetry> {
    GLOBAL.get().map(Arc::as_ref)
}

impl Telemetry {
    fn new(tendril_home: &Path, host: &str, app_version: &str) -> Self {
        let mut super_props = Map::new();
        // Exactly the original's set, no additions. `distribution`/`source` are omitted: they carry
        // the .NET `AppBrand`, which has no V2 equivalent.
        super_props.insert(
            "$session_id".to_string(),
            json!(uuid::Uuid::new_v4().to_string()),
        );
        // GeoIP left enabled so PostHog resolves the request IP to a country; the IP is not stored as
        // an event property.
        super_props.insert("$geoip_disable".to_string(), json!(false));
        super_props.insert("app_version".to_string(), json!(app_version));
        super_props.insert("os".to_string(), json!(std::env::consts::OS));
        super_props.insert("os_version".to_string(), json!(os_version()));

        Self {
            client: reqwest::Client::new(),
            endpoint: batch_endpoint(host),
            distinct_id: get_or_create_anonymous_id(tendril_home),
            super_props,
            queue: Mutex::new(Vec::new()),
        }
    }

    pub fn anonymous_id(&self) -> &str {
        &self.distinct_id
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// How many events are waiting to be posted. Exposed so a test can assert nothing was enqueued.
    pub fn queued(&self) -> usize {
        self.queue.lock().map(|q| q.len()).unwrap_or(0)
    }

    fn capture(&self, event: &str, props: Map<String, Value>) {
        let mut properties = self.super_props.clone();
        properties.extend(props);
        properties.insert("distinct_id".to_string(), json!(self.distinct_id));

        let payload = json!({
            "event": event,
            "properties": properties,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });

        // A poisoned lock means a previous capture panicked mid-push. Telemetry is not worth
        // propagating that to a job, so the event is dropped.
        if let Ok(mut queue) = self.queue.lock() {
            if queue.len() >= MAX_QUEUE {
                queue.remove(0);
            }
            queue.push(payload);
        }
    }

    /// Posts everything queued. Never returns an error: a failed flush drops the batch rather than
    /// retrying forever, because the alternative is unbounded growth for data nobody is waiting on.
    pub async fn flush(&self) {
        let batch = match self.queue.lock() {
            Ok(mut queue) if !queue.is_empty() => std::mem::take(&mut *queue),
            _ => return,
        };

        let body = json!({ "api_key": PROJECT_TOKEN, "batch": batch });
        match self.client.post(&self.endpoint).json(&body).send().await {
            Ok(resp) if resp.status().is_success() => {
                tracing::debug!("Flushed {} telemetry event(s)", batch.len());
            }
            Ok(resp) => tracing::debug!("Telemetry flush rejected with status {}", resp.status()),
            Err(e) => tracing::debug!("Telemetry flush failed: {}", e),
        }
    }

    pub fn track_app_started(&self, ctx: &AppStartContext) {
        let mut p = Map::new();
        p.insert("version".to_string(), json!(ctx.version));
        p.insert("project_count".to_string(), json!(ctx.project_count));
        p.insert("llm_configured".to_string(), json!(ctx.llm_configured));
        self.capture("app_started", p);
    }

    pub fn track_onboarding_completed(&self, ctx: &OnboardingCompletedContext) {
        let mut p = Map::new();
        p.insert("project_count".to_string(), json!(ctx.project_count));
        insert_opt(&mut p, "agent", ctx.agent.as_deref());
        self.capture("onboarding_completed", p);
    }

    pub fn track_project_created(&self, ctx: &ProjectCreatedContext) {
        let mut p = Map::new();
        p.insert("repo_count".to_string(), json!(ctx.repo_count));
        insert_opt(&mut p, "stack_hash", ctx.stack_hash.as_deref());
        self.capture("project_created", p);
    }

    pub fn track_job_created(&self, ctx: &JobCreatedContext) {
        let mut p = Map::new();
        p.insert("job_type".to_string(), json!(ctx.job_type));
        insert_opt(&mut p, "agent", ctx.agent.as_deref());
        self.add_plan_uuid(&mut p, ctx.plan_id.as_deref());
        self.capture("job_created", p);
    }

    pub fn track_job_completed(&self, ctx: &JobCompletedContext) {
        let mut p = Map::new();
        p.insert("job_type".to_string(), json!(ctx.job_type));
        p.insert("status".to_string(), json!(ctx.status));
        p.insert(
            "duration_seconds".to_string(),
            json!(ctx.duration_seconds.unwrap_or(0)),
        );
        insert_opt(&mut p, "agent", ctx.agent.as_deref());
        self.add_plan_uuid(&mut p, ctx.plan_id.as_deref());
        self.capture("job_completed", p);
    }

    pub fn track_plan_created(&self, ctx: &PlanCreatedContext) {
        let mut p = Map::new();
        p.insert("level".to_string(), json!(ctx.level));
        p.insert(
            "duration_seconds".to_string(),
            json!(ctx.duration_seconds.unwrap_or(0)),
        );
        insert_opt(&mut p, "agent", ctx.agent.as_deref());
        insert_opt(&mut p, "stack_hash", ctx.stack_hash.as_deref());
        self.add_plan_uuid(&mut p, ctx.plan_id.as_deref());
        self.capture("plan_created", p);
    }

    pub fn track_pr_created(&self, ctx: &PrCreatedContext) {
        let mut p = Map::new();
        p.insert(
            "duration_seconds".to_string(),
            json!(ctx.duration_seconds.unwrap_or(0)),
        );
        insert_opt(&mut p, "agent", ctx.agent.as_deref());
        self.add_plan_uuid(&mut p, ctx.plan_id.as_deref());
        self.capture("pr_created", p);
    }

    pub fn track_plan_state_transition(&self, ctx: &PlanStateTransitionContext) {
        let mut p = Map::new();
        p.insert("from_state".to_string(), json!(ctx.from_state));
        p.insert("to_state".to_string(), json!(ctx.to_state));
        self.add_plan_uuid(&mut p, ctx.plan_id.as_deref());
        self.capture("plan_state_transition", p);
    }

    fn add_plan_uuid(&self, props: &mut Map<String, Value>, plan_id: Option<&str>) {
        if let Some(uuid) = derive_plan_uuid(&self.distinct_id, plan_id) {
            props.insert("plan_uuid".to_string(), json!(uuid));
        }
    }
}

/// The same `track_*` surface on an `Option`, so a disabled client is a no-op at the call site rather
/// than something every caller has to branch on.
pub trait Track {
    fn track_app_started(&self, ctx: &AppStartContext);
    fn track_onboarding_completed(&self, ctx: &OnboardingCompletedContext);
    fn track_project_created(&self, ctx: &ProjectCreatedContext);
    fn track_job_created(&self, ctx: &JobCreatedContext);
    fn track_job_completed(&self, ctx: &JobCompletedContext);
    fn track_plan_created(&self, ctx: &PlanCreatedContext);
    fn track_pr_created(&self, ctx: &PrCreatedContext);
    fn track_plan_state_transition(&self, ctx: &PlanStateTransitionContext);
}

impl Track for Option<&Telemetry> {
    fn track_app_started(&self, ctx: &AppStartContext) {
        if let Some(t) = self {
            t.track_app_started(ctx);
        }
    }

    fn track_onboarding_completed(&self, ctx: &OnboardingCompletedContext) {
        if let Some(t) = self {
            t.track_onboarding_completed(ctx);
        }
    }

    fn track_project_created(&self, ctx: &ProjectCreatedContext) {
        if let Some(t) = self {
            t.track_project_created(ctx);
        }
    }

    fn track_job_created(&self, ctx: &JobCreatedContext) {
        if let Some(t) = self {
            t.track_job_created(ctx);
        }
    }

    fn track_job_completed(&self, ctx: &JobCompletedContext) {
        if let Some(t) = self {
            t.track_job_completed(ctx);
        }
    }

    fn track_plan_created(&self, ctx: &PlanCreatedContext) {
        if let Some(t) = self {
            t.track_plan_created(ctx);
        }
    }

    fn track_pr_created(&self, ctx: &PrCreatedContext) {
        if let Some(t) = self {
            t.track_pr_created(ctx);
        }
    }

    fn track_plan_state_transition(&self, ctx: &PlanStateTransitionContext) {
        if let Some(t) = self {
            t.track_plan_state_transition(ctx);
        }
    }
}

fn insert_opt(props: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(v) = value {
        props.insert(key.to_string(), json!(v));
    }
}

/// Stable, globally unique identifier for a plan, used to group its events.
///
/// Plan ids are a per-install sequential counter, so `00042` exists on every install and would merge
/// unrelated users' plans. Hashing it with the anonymous id makes it unique per install and one-way,
/// so the raw counter never leaves the machine. Ids are normalized to five digits first, so the
/// int-shaped form taken from the database (`42`) and the folder-shaped form (`"00042"`) derive the
/// same value.
///
/// Returns `None` when there is no plan or no anonymous id.
pub fn derive_plan_uuid(distinct_id: &str, plan_id: Option<&str>) -> Option<String> {
    let plan_id = plan_id?.trim();
    if plan_id.is_empty() || distinct_id.is_empty() {
        return None;
    }

    let normalized = match plan_id.parse::<i64>() {
        Ok(n) => format!("{:05}", n),
        Err(_) => plan_id.to_string(),
    };

    let hash = Sha256::digest(format!("tendril-plan:{}:{}", distinct_id, normalized).as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    bytes[6] = (bytes[6] & 0x0F) | 0x80; // RFC 9562 version 8 (custom)
    bytes[8] = (bytes[8] & 0x3F) | 0x80; // RFC 9562 variant

    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    Some(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

/// The random per-install identifier, at `<TendrilHome>/.anonymous-id`.
///
/// *Divergence from the original*, which prefers `<LocalAppData>/Tendril/.anonymous-id` and only falls
/// back to `TENDRIL_HOME`: a .NET-specific `LocalApplicationData` path is not worth reproducing in
/// Rust. The cost is that a machine running both apps counts as two installs.
///
/// Never derived from a username, machine name or repository.
pub fn get_or_create_anonymous_id(tendril_home: &Path) -> String {
    let path = tendril_home.join(ANONYMOUS_ID_FILE);

    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let new_id = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::create_dir_all(tendril_home);
    let _ = std::fs::write(&path, &new_id);
    new_id
}

/// A best-effort OS version string. `uname` on unix (`libc` is already a dependency there), and the
/// platform family elsewhere — worth neither a new crate nor a spawned process.
fn os_version() -> String {
    #[cfg(unix)]
    {
        let mut info = std::mem::MaybeUninit::<libc::utsname>::uninit();
        // SAFETY: `uname` writes a `utsname` through the pointer and reads nothing else. The result is
        // only read when it reports success.
        if unsafe { libc::uname(info.as_mut_ptr()) } == 0 {
            // SAFETY: `uname` returned 0, so the struct is initialised.
            let info = unsafe { info.assume_init() };
            let release: Vec<u8> = info
                .release
                .iter()
                .take_while(|&&c| c != 0)
                .map(|&c| c as u8)
                .collect();
            if let Ok(release) = String::from_utf8(release) {
                if !release.is_empty() {
                    return release;
                }
            }
        }
    }

    std::env::consts::FAMILY.to_string()
}

/// Drains the queue on an interval for the process lifetime.
///
/// Separate from capture on purpose: an event must cost a job nothing more than a push onto a
/// `Vec`.
pub fn spawn_flusher(telemetry: Arc<Telemetry>, interval: std::time::Duration) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            telemetry.flush().await;
        }
    });
}
