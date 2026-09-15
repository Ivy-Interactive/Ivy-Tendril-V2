use crate::error::{Result, TendrilError};
use crate::models::{LevelConfig, ProjectConfig, ProjectVerificationRef, VerificationConfig};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TendrilSettings {
    #[serde(rename = "codingAgent", default = "default_coding_agent")]
    pub coding_agent: String,

    #[serde(rename = "jobTimeout", default = "default_job_timeout")]
    pub job_timeout: i32,

    #[serde(
        rename = "staleOutputTimeout",
        default = "default_stale_output_timeout"
    )]
    pub stale_output_timeout: i32,

    #[serde(rename = "gitTimeout", default = "default_git_timeout")]
    pub git_timeout: i32,

    /// Seconds to wait for a reply from the local daemon. Note the unit: unlike `jobTimeout`,
    /// which is minutes, this is seconds. `0` or negative disables the timeout entirely.
    #[serde(
        rename = "daemonRequestTimeout",
        default = "default_daemon_request_timeout"
    )]
    pub daemon_request_timeout: i32,

    #[serde(rename = "maxConcurrentJobs", default = "default_max_concurrent_jobs")]
    pub max_concurrent_jobs: i32,

    #[serde(default)]
    pub projects: Vec<ProjectConfig>,

    #[serde(default)]
    pub verifications: Vec<VerificationConfig>,

    #[serde(rename = "planTemplate", default)]
    pub plan_template: String,

    #[serde(
        rename = "planFolder",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub plan_folder: Option<String>,

    /// Root of the team promptware overlay layer, applied on top of the shipped `src/promptwares`
    /// tree at deploy time. `TENDRIL_PROMPTWARE_OVERLAY` overrides it. See
    /// [`crate::promptware::overlay`].
    #[serde(
        rename = "promptwareOverlay",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub promptware_overlay: Option<String>,

    #[serde(default = "default_levels")]
    pub levels: Vec<LevelConfig>,

    /// Opt-in. `None` (key absent) and `Some(false)` both mean no client is constructed and no
    /// network call is ever attempted. Skipped on serialize when absent, so V2 never *introduces* the
    /// key into a config.yaml shared with the original app, whose policy is opt-out and which reads an
    /// absent key as "on". An explicit value round-trips unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telemetry: Option<bool>,

    /// Endpoint / key / model for the auxiliary LLM the original app uses for summarisation. Modeled
    /// rather than left in `extra` because `telemetry_enabled`'s `app_started` event reports whether
    /// it is configured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm: Option<LlmConfig>,

    /// The original defaults this to true, and unlike telemetry that default is not a privacy
    /// decision, so it is mirrored as-is. No reader in V2 yet — modeling it stops it being silently
    /// unreadable.
    #[serde(rename = "desktopNotifications", default = "default_true")]
    pub desktop_notifications: bool,

    #[serde(default = "default_theme")]
    pub theme: String,

    /// Minutes between worktree reaper passes. `0` or negative disables the reaper entirely.
    #[serde(
        rename = "worktreeReaperInterval",
        default = "default_worktree_reaper_interval"
    )]
    pub worktree_reaper_interval: i32,

    /// Minutes a plan must be idle (since `updated`) before an eligible plan is reaped.
    #[serde(
        rename = "worktreeReaperGrace",
        default = "default_worktree_reaper_grace"
    )]
    pub worktree_reaper_grace: i32,

    /// `PreserveUnpushed` or `Force`. An unrecognised value falls back to `PreserveUnpushed`: a typo
    /// must not escalate to force-delete.
    #[serde(
        rename = "worktreeBranchDeleteMode",
        default = "default_worktree_branch_delete_mode"
    )]
    pub worktree_branch_delete_mode: String,

    #[serde(default)]
    pub beta: bool,

    /// Whether the first-run wizard has been completed or dismissed. See [`OnboardingConfig`].
    #[serde(default, skip_serializing_if = "OnboardingConfig::is_default")]
    pub onboarding: OnboardingConfig,

    /// Per-coding-agent arguments, environment and named profiles. Tolerant of shape: see
    /// [`deserialize_coding_agents`].
    #[serde(
        rename = "codingAgents",
        default,
        deserialize_with = "deserialize_coding_agents",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub coding_agents: Vec<AgentConfig>,

    /// Per-promptware profile and tool rules, keyed by promptware name. The reserved key `_default`
    /// applies to every promptware.
    #[serde(
        default,
        deserialize_with = "deserialize_promptwares",
        skip_serializing_if = "BTreeMap::is_empty"
    )]
    pub promptwares: BTreeMap<String, PromptwareConfig>,

    #[serde(rename = "enrichModels", default = "default_true")]
    pub enrich_models: bool,

    /// Hours between background models.dev refreshes while `enrichModels` is on. `0` or
    /// negative means "refresh once at startup and never again".
    #[serde(
        rename = "modelEnrichmentIntervalHours",
        default = "default_model_enrichment_interval_hours"
    )]
    pub model_enrichment_interval_hours: i32,

    /// Soft age threshold (in days) past which the models.dev disk cache is still used but
    /// logged as a warning. `0` or negative disables this tier (never warn).
    #[serde(
        rename = "modelCacheWarnAgeDays",
        default = "default_model_cache_warn_age_days"
    )]
    pub model_cache_warn_age_days: i64,

    /// Hard age threshold (in days) past which the models.dev disk cache is ignored entirely
    /// and the static `SPECS` table is used instead. `0` or negative disables this tier (never
    /// expire).
    #[serde(
        rename = "modelCacheMaxAgeDays",
        default = "default_model_cache_max_age_days"
    )]
    pub model_cache_max_age_days: i64,

    /// Password (session) authentication. Absent on every install that has never enabled it, and
    /// `skip_serializing_if` keeps it absent through a save/reload round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<ApiSettings>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security: Option<SecuritySettings>,

    /// Assigned-issue auto-import. Tolerant of shape: see [`deserialize_inbox`].
    #[serde(default, deserialize_with = "deserialize_inbox")]
    pub inbox: InboxConfig,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl TendrilSettings {
    /// The single reader of the `telemetry` key. Strictly opt-in: only an explicit `telemetry: true`
    /// enables it, so an absent key and `telemetry: false` behave identically. No call site tests the
    /// field directly.
    pub fn telemetry_enabled(&self) -> bool {
        self.telemetry == Some(true)
    }
}

/// Password authentication, mirroring the original's `AuthConfig` record. `password` holds an Argon2
/// PHC string and `hash_secret` the base64 pepper fed to Argon2 as its secret key (`K`).
///
/// The nested `extra` matters: real configs in the wild carry keys this record does not model (e.g.
/// `enabled`, `tokenExpiry`), and dropping them on the next `save_config` would break V2's promise
/// that an unknown key survives a round-trip.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuthConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,

    /// Argon2 PHC string. Empty means password auth is not configured.
    #[serde(default)]
    pub password: String,

    /// Base64-encoded Argon2 secret (pepper). The snake_case spelling is accepted too, because the
    /// untyped reader this field replaced (`BasicAuthConfig::from_settings`) tolerated both.
    #[serde(rename = "hashSecret", alias = "hash_secret", default)]
    pub hash_secret: String,

    #[serde(rename = "rateLimit", default, skip_serializing_if = "Option::is_none")]
    pub rate_limit: Option<LoginRateLimitConfig>,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl AuthConfig {
    /// Whether password login is actually usable. A config carrying only `auth: {enabled: true}` —
    /// which is what several inherited configs look like — must not lock anybody out, so both the
    /// hash and the pepper have to be present before the login route accepts anything.
    pub fn is_active(&self) -> bool {
        !self.password.trim().is_empty() && !self.hash_secret.trim().is_empty()
    }

    /// The rate-limit config to use, falling back to the defaults the original applies when
    /// `rateLimit` is absent (`TendrilAuthProvider` constructs `new LoginRateLimitConfig()`).
    pub fn effective_rate_limit(&self) -> LoginRateLimitConfig {
        self.rate_limit.clone().unwrap_or_default()
    }
}

/// Exponential-backoff parameters for failed logins. The defaults are the original's: three free
/// attempts, then 1s doubling up to 60s.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LoginRateLimitConfig {
    #[serde(default = "default_rate_limit_threshold")]
    pub threshold: i32,

    #[serde(rename = "baseDelaySeconds", default = "default_rate_limit_base_delay")]
    pub base_delay_seconds: f64,

    #[serde(rename = "maxDelaySeconds", default = "default_rate_limit_max_delay")]
    pub max_delay_seconds: f64,
}

impl Default for LoginRateLimitConfig {
    fn default() -> Self {
        Self {
            threshold: default_rate_limit_threshold(),
            base_delay_seconds: default_rate_limit_base_delay(),
            max_delay_seconds: default_rate_limit_max_delay(),
        }
    }
}

/// `api.apiKey`: when set, every `/api` request must also present a matching `X-Api-Key`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ApiSettings {
    #[serde(rename = "apiKey", default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SecuritySettings {
    /// Extra hosts `/ivy/local-file` may be reached on, on top of loopback, private IPv4,
    /// `*.local` and the active tunnel host.
    #[serde(
        rename = "allowedHosts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub allowed_hosts: Option<Vec<String>>,

    /// Extra directories `GET /ivy/local-file` may serve from, on top of the Tendril home,
    /// the plans folder and configured project repos.
    #[serde(
        rename = "localFileRoots",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub local_file_roots: Option<Vec<String>>,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Mirrors the original's `LlmConfig` (endpoint / apiKey / model). `extra` is required, not
/// defensive: a real config.yaml carries `llm: { provider: openrouter }` and the original's
/// tolerant JSON binding keeps it. A struct without `extra` would drop `provider` on the next save.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LlmConfig {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub endpoint: String,

    #[serde(rename = "apiKey", default, skip_serializing_if = "String::is_empty")]
    pub api_key: String,

    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Assigned-issue auto-import. `autoAcceptAssignedIssues` selects what a swept issue becomes: a
/// `CreatePlan` job when true, a proposal awaiting a human when false. Either way the sweep still
/// runs — the flag picks the landing mode, it does not disable the import.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxConfig {
    #[serde(rename = "autoAcceptAssignedIssues", default)]
    pub auto_accept_assigned_issues: bool,

    /// Minutes between sweeps. `0` or negative disables the importer entirely, the way
    /// `worktreeReaperInterval` disables the reaper.
    #[serde(
        rename = "checkIntervalMinutes",
        default = "default_check_interval_minutes"
    )]
    pub check_interval_minutes: i32,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

impl Default for InboxConfig {
    fn default() -> Self {
        Self {
            auto_accept_assigned_issues: false,
            check_interval_minutes: default_check_interval_minutes(),
            extra: BTreeMap::new(),
        }
    }
}

/// Reads `inbox`, degrading a non-mapping or unparseable body to defaults rather than failing the
/// whole load, for the same reason as [`deserialize_coding_agents`]: a bad hand-edit to one section
/// must not take Tendril down.
fn deserialize_inbox<'de, D>(deserializer: D) -> std::result::Result<InboxConfig, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    Ok(match raw {
        serde_json::Value::Object(_) => {
            serde_json::from_value::<InboxConfig>(raw).unwrap_or_default()
        }
        _ => InboxConfig::default(),
    })
}

/// The persisted outcome of the first-run wizard. `crate::onboarding` owns the rules that read it;
/// an all-default value is omitted from `config.yaml` entirely, so a config written before this key
/// existed is untouched by a round-trip and deserializes as "neither completed nor dismissed".
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct OnboardingConfig {
    #[serde(default)]
    pub completed: bool,

    #[serde(default)]
    pub dismissed: bool,

    #[serde(
        rename = "completedAt",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub completed_at: Option<String>,
}

impl OnboardingConfig {
    /// Untouched onboarding state, i.e. nothing worth writing to `config.yaml`.
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}
/// What a single promptware asks for: the profile it runs under and the tool rules it contributes.
///
/// `allowed_tools` is purely additive on top of the base set; `denied_tools` is subtracted from the
/// merged allowlist. Both are resolved by `crate::agents::resolve_agent`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptwareConfig {
    #[serde(default)]
    pub profile: String,

    #[serde(rename = "allowedTools", default)]
    pub allowed_tools: Vec<String>,

    #[serde(rename = "deniedTools", default)]
    pub denied_tools: Vec<String>,

    #[serde(
        rename = "customInstructions",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub custom_instructions: Option<String>,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// One named profile of a coding agent, e.g. `deep` mapping to `opus` at `max` effort.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentProfileConfig {
    #[serde(default)]
    pub name: String,

    #[serde(default)]
    pub model: String,

    #[serde(default)]
    pub effort: String,

    #[serde(default)]
    pub arguments: String,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Configuration for one coding agent CLI.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentConfig {
    #[serde(default)]
    pub name: String,

    #[serde(default)]
    pub arguments: String,

    #[serde(rename = "environmentVariables", default)]
    pub environment_variables: HashMap<String, String>,

    #[serde(default)]
    pub profiles: Vec<AgentProfileConfig>,

    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// Reads `codingAgents` from either of the two shapes found in real configs — a sequence of agent
/// entries, or a mapping of agent name to entry — and degrades a malformed section to "no configured
/// agents" instead of failing the whole load. Built-in tier defaults then apply, which is a working
/// Tendril; a config that refuses to parse is not.
fn deserialize_coding_agents<'de, D>(
    deserializer: D,
) -> std::result::Result<Vec<AgentConfig>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    Ok(match raw {
        serde_json::Value::Array(items) => items
            .into_iter()
            .filter_map(|item| serde_json::from_value::<AgentConfig>(item).ok())
            .collect(),
        serde_json::Value::Object(map) => map
            .into_iter()
            .filter_map(|(key, value)| {
                let mut agent = serde_json::from_value::<AgentConfig>(value).ok()?;
                if agent.name.is_empty() {
                    agent.name = key;
                }
                Some(agent)
            })
            .collect(),
        _ => Vec::new(),
    })
}

/// Reads `promptwares`, skipping any entry whose body is not a mapping rather than failing the load,
/// for the same reason as [`deserialize_coding_agents`].
fn deserialize_promptwares<'de, D>(
    deserializer: D,
) -> std::result::Result<BTreeMap<String, PromptwareConfig>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = serde_json::Value::deserialize(deserializer)?;
    Ok(match raw {
        serde_json::Value::Object(map) => map
            .into_iter()
            .filter_map(|(key, value)| {
                serde_json::from_value::<PromptwareConfig>(value)
                    .ok()
                    .map(|cfg| (key, cfg))
            })
            .collect(),
        _ => BTreeMap::new(),
    })
}

fn default_coding_agent() -> String {
    "claude".to_string()
}
fn default_job_timeout() -> i32 {
    30
}
fn default_stale_output_timeout() -> i32 {
    10
}
fn default_git_timeout() -> i32 {
    10
}
fn default_daemon_request_timeout() -> i32 {
    crate::http::DEFAULT_DAEMON_REQUEST_TIMEOUT_SECS as i32
}
fn default_max_concurrent_jobs() -> i32 {
    20
}
fn default_true() -> bool {
    true
}
fn default_theme() -> String {
    "default".to_string()
}
fn default_check_interval_minutes() -> i32 {
    15
}
fn default_model_enrichment_interval_hours() -> i32 {
    crate::agents::model_cache::DEFAULT_ENRICHMENT_INTERVAL_HOURS
}
fn default_model_cache_warn_age_days() -> i64 {
    crate::agents::model_cache::DEFAULT_CACHE_WARN_AGE_DAYS
}
fn default_model_cache_max_age_days() -> i64 {
    crate::agents::model_cache::DEFAULT_CACHE_MAX_AGE_DAYS
}
fn default_worktree_reaper_interval() -> i32 {
    30
}
fn default_worktree_reaper_grace() -> i32 {
    10
}
fn default_worktree_branch_delete_mode() -> String {
    "PreserveUnpushed".to_string()
}
fn default_rate_limit_threshold() -> i32 {
    3
}
fn default_rate_limit_base_delay() -> f64 {
    1.0
}
fn default_rate_limit_max_delay() -> f64 {
    60.0
}

fn default_levels() -> Vec<LevelConfig> {
    vec![
        LevelConfig {
            name: "Bug".to_string(),
            color: "Red".to_string(),
            badge: None,
        },
        LevelConfig {
            name: "Feature".to_string(),
            color: "Blue".to_string(),
            badge: None,
        },
        LevelConfig {
            name: "Epic".to_string(),
            color: "Purple".to_string(),
            badge: None,
        },
        LevelConfig {
            name: "Chore".to_string(),
            color: "Slate".to_string(),
            badge: None,
        },
        LevelConfig {
            name: "Nitpick".to_string(),
            color: "Gray".to_string(),
            badge: None,
        },
    ]
}

impl Default for TendrilSettings {
    fn default() -> Self {
        Self {
            coding_agent: default_coding_agent(),
            job_timeout: default_job_timeout(),
            stale_output_timeout: default_stale_output_timeout(),
            git_timeout: default_git_timeout(),
            daemon_request_timeout: default_daemon_request_timeout(),
            max_concurrent_jobs: default_max_concurrent_jobs(),
            projects: Vec::new(),
            verifications: Vec::new(),
            plan_template: String::new(),
            plan_folder: None,
            promptware_overlay: None,
            levels: default_levels(),
            telemetry: None,
            llm: None,
            desktop_notifications: true,
            theme: default_theme(),
            worktree_reaper_interval: default_worktree_reaper_interval(),
            worktree_reaper_grace: default_worktree_reaper_grace(),
            worktree_branch_delete_mode: default_worktree_branch_delete_mode(),
            beta: false,
            onboarding: OnboardingConfig::default(),
            coding_agents: Vec::new(),
            promptwares: BTreeMap::new(),
            enrich_models: true,
            model_enrichment_interval_hours: default_model_enrichment_interval_hours(),
            model_cache_warn_age_days: default_model_cache_warn_age_days(),
            model_cache_max_age_days: default_model_cache_max_age_days(),
            auth: None,
            api: None,
            security: None,
            inbox: InboxConfig::default(),
            extra: BTreeMap::new(),
        }
    }
}

pub trait EnvSource {
    fn get_var(&self, key: &str) -> Option<String>;
}

pub struct SystemEnv;

impl EnvSource for SystemEnv {
    fn get_var(&self, key: &str) -> Option<String> {
        std::env::var(key).ok()
    }
}

impl<F> EnvSource for F
where
    F: Fn(&str) -> Option<String>,
{
    fn get_var(&self, key: &str) -> Option<String> {
        self(key)
    }
}

impl EnvSource for std::collections::HashMap<String, String> {
    fn get_var(&self, key: &str) -> Option<String> {
        self.get(key).cloned()
    }
}

impl EnvSource for std::collections::HashMap<&str, &str> {
    fn get_var(&self, key: &str) -> Option<String> {
        self.get(key).map(|v| (*v).to_string())
    }
}

impl EnvSource for std::collections::HashMap<&str, String> {
    fn get_var(&self, key: &str) -> Option<String> {
        self.get(key).cloned()
    }
}

impl EnvSource for std::collections::HashMap<String, &str> {
    fn get_var(&self, key: &str) -> Option<String> {
        self.get(key).map(|v| (*v).to_string())
    }
}

pub fn get_default_tendril_home_with_env(env: &impl EnvSource) -> PathBuf {
    if let Some(val) = env.get_var("TENDRIL_HOME") {
        let trimmed = val.trim().trim_matches('"');
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Some(home) = dirs_home_with_env(env) {
        let pointer_file = home.join(".tendril_location");
        if pointer_file.is_file() {
            if let Ok(loc) = std::fs::read_to_string(&pointer_file) {
                let loc = loc.trim().trim_matches('"');
                if !loc.is_empty() {
                    let loc_path = PathBuf::from(loc);
                    if loc_path.join("config.yaml").exists() {
                        return loc_path;
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    {
        let d_tendril = PathBuf::from(r"D:\.tendril");
        if d_tendril.exists() {
            return d_tendril;
        }
        if let Some(home) = dirs_home_with_env(env) {
            let user_tendril = home.join(".tendril");
            if user_tendril.exists() {
                return user_tendril;
            }
        }
        // If D:\ drive root exists, use D:\.tendril, else user home .tendril
        if Path::new(r"D:\").exists() {
            return PathBuf::from(r"D:\.tendril");
        }
        if let Some(home) = dirs_home_with_env(env) {
            return home.join(".tendril");
        }
        PathBuf::from(r"D:\.tendril")
    }

    #[cfg(not(windows))]
    {
        if let Some(home) = dirs_home_with_env(env) {
            home.join(".tendril")
        } else {
            PathBuf::from("/tmp/.tendril")
        }
    }
}

pub fn get_default_tendril_home() -> PathBuf {
    get_default_tendril_home_with_env(&SystemEnv)
}

pub fn get_tendril_home_with_env(env: &impl EnvSource) -> PathBuf {
    get_default_tendril_home_with_env(env)
}

pub fn get_tendril_home() -> PathBuf {
    get_default_tendril_home()
}

/// The operator's real Tendril home, resolved as if `TENDRIL_HOME` were not set.
///
/// A test that pins `TENDRIL_HOME` to a temp directory still needs to know which path it must never
/// touch, so this deliberately ignores the variable that isolates it.
pub fn real_user_tendril_home() -> PathBuf {
    get_default_tendril_home_with_env(&|key: &str| {
        if key == "TENDRIL_HOME" {
            None
        } else {
            std::env::var(key).ok()
        }
    })
}

/// True when the current process looks like a test binary.
///
/// `TENDRIL_TEST_ISOLATION=1` is the explicit opt-in (the VS Code extension harness sets it for its
/// children); the `target/*/deps/` check covers cargo test binaries, so a harness added later cannot
/// silently opt out of [`ensure_not_real_home`].
pub fn in_test_context() -> bool {
    if std::env::var("TENDRIL_TEST_ISOLATION").as_deref() == Ok("1") {
        return true;
    }

    std::env::current_exe()
        .map(|p| p.components().any(|c| c.as_os_str() == "deps"))
        .unwrap_or(false)
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| -> String {
        let resolved = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let s = normalize_slashes(&resolved)
            .trim_end_matches('/')
            .to_string();
        if cfg!(windows) || cfg!(target_os = "macos") {
            s.to_lowercase()
        } else {
            s
        }
    };

    norm(a) == norm(b)
}

/// Refuses to claim the operator's real Tendril home from a test process.
///
/// Outside a test context this is a no-op, so production behaviour is unchanged.
pub fn ensure_not_real_home(home: &Path) -> Result<()> {
    if !in_test_context() {
        return Ok(());
    }

    let real = real_user_tendril_home();
    if paths_equal(home, &real) {
        return Err(TendrilError::Other(format!(
            "Refusing to use the real Tendril home {} from a test process: claiming mastership \
             there hijacks the operator's running daemon. Set TENDRIL_HOME to a temp directory for \
             this test.",
            real.display()
        )));
    }

    Ok(())
}

pub fn normalize_slashes(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn expand_variables_with_env(input: &str, tendril_home: &str, env: &impl EnvSource) -> String {
    let mut res = input
        .replace("%TENDRIL_HOME%", tendril_home)
        .replace("${TENDRIL_HOME}", tendril_home)
        .replace("$TENDRIL_HOME", tendril_home);

    res = expand_env_percent_vars(&res, env);

    if res.starts_with('~') {
        if let Some(home) = dirs_home_with_env(env) {
            let home_str = home.to_string_lossy();
            if res == "~" {
                res = home_str.to_string();
            } else if res.starts_with("~/") || res.starts_with("~\\") {
                res = format!("{}{}", home_str, &res[1..]);
            }
        }
    }

    res
}

pub fn expand_variables(input: &str, tendril_home: &str) -> String {
    expand_variables_with_env(input, tendril_home, &SystemEnv)
}

/// Replaces every `%NAME%` that names a set environment variable with its value.
///
/// `config.yaml` is documented to accept arbitrary `%ENV_VAR%` (the example config's repo paths use
/// `%REPOS_HOME%`, and hook actions are written the same way), so this closes the gap between the
/// documented syntax and the one variable the expander used to know.
///
/// An unset name is left exactly as written, which is what keeps this backwards compatible: a string
/// that reached the shell literally before still does. Only `[A-Za-z_][A-Za-z0-9_]*` between two `%`
/// is considered a name, so a bare `%` or a `50% faster` is never touched.
fn expand_env_percent_vars(input: &str, env: &impl EnvSource) -> String {
    if !input.contains('%') {
        return input.to_string();
    }

    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != b'%' {
            // Push whole UTF-8 characters: indexing is byte-wise, so a multi-byte character must be
            // copied in one piece.
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }

        match bytes[i + 1..].iter().position(|b| *b == b'%') {
            Some(offset) => {
                let name = &input[i + 1..i + 1 + offset];
                match (is_env_var_name(name), env.get_var(name)) {
                    (true, Some(value)) => {
                        out.push_str(&value);
                        i += offset + 2;
                    }
                    // Not a name, or a name nothing is set for: emit the opening `%` and carry on
                    // from the next character, so `%a% %HOME%` still resolves `HOME`.
                    _ => {
                        out.push('%');
                        i += 1;
                    }
                }
            }
            None => {
                out.push_str(&input[i..]);
                break;
            }
        }
    }

    out
}

fn is_env_var_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn dirs_home_with_env(env: &impl EnvSource) -> Option<PathBuf> {
    if let Some(val) = env.get_var("USERPROFILE") {
        let trimmed = val.trim().trim_matches('"');
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    if let Some(val) = env.get_var("HOME") {
        let trimmed = val.trim().trim_matches('"');
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    None
}

pub fn dirs_home() -> Option<PathBuf> {
    dirs_home_with_env(&SystemEnv)
}

pub fn get_config_path_with_env(tendril_home: &Path, env: &impl EnvSource) -> PathBuf {
    if let Some(val) = env.get_var("TENDRIL_CONFIG") {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    tendril_home.join("config.yaml")
}

pub fn get_config_path(tendril_home: &Path) -> PathBuf {
    get_config_path_with_env(tendril_home, &SystemEnv)
}

pub fn get_plans_dir_with_env(
    tendril_home: &Path,
    settings: Option<&TendrilSettings>,
    env: &impl EnvSource,
) -> PathBuf {
    if let Some(val) = env.get_var("TENDRIL_PLANS") {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    let loaded;
    let effective_settings = match settings {
        Some(s) => Some(s),
        None => {
            let config_path = get_config_path_with_env(tendril_home, env);
            if let Ok(s) = load_config(&config_path) {
                loaded = s;
                Some(&loaded)
            } else {
                None
            }
        }
    };

    if let Some(s) = effective_settings {
        if let Some(ref folder) = s.plan_folder {
            let trimmed = folder.trim();
            if !trimmed.is_empty() {
                let expanded = expand_variables(trimmed, &tendril_home.to_string_lossy());
                let p = PathBuf::from(&expanded);
                return if p.is_absolute()
                    || trimmed.contains("%TENDRIL_HOME%")
                    || trimmed.contains("${TENDRIL_HOME}")
                    || trimmed.contains("$TENDRIL_HOME")
                    || trimmed.starts_with('~')
                {
                    p
                } else {
                    tendril_home.join(p)
                };
            }
        }
    }

    tendril_home.join("Plans")
}

pub fn get_plans_dir_with_settings(
    tendril_home: &Path,
    settings: Option<&TendrilSettings>,
) -> PathBuf {
    get_plans_dir_with_env(tendril_home, settings, &SystemEnv)
}

pub fn get_plans_dir(tendril_home: &Path) -> PathBuf {
    get_plans_dir_with_settings(tendril_home, None)
}

pub fn get_database_path(tendril_home: &Path) -> PathBuf {
    tendril_home.join("tendril.db")
}

/// Where `config.yaml` hook actions keep their scripts, e.g.
/// `pwsh -NoProfile -File %TENDRIL_HOME%/Hooks/NotifySlack.ps1`.
pub fn get_hooks_dir(tendril_home: &Path) -> PathBuf {
    tendril_home.join("Hooks")
}

/// Creates the home directories that nothing else owns. Idempotent: `create_dir_all` on an existing
/// directory is a no-op, so it is safe on every daemon start, not just the first.
///
/// Deliberately only `Hooks` (plus the home itself): `Plans`, `Logs/Jobs`, `Attachments` and
/// `Promptwares` are each created on demand by their owner, and duplicating that here would give two
/// owners for one directory.
pub fn ensure_home_directories(tendril_home: &Path) -> Result<()> {
    std::fs::create_dir_all(tendril_home)?;
    std::fs::create_dir_all(get_hooks_dir(tendril_home))?;
    Ok(())
}

/// Strip everything outside `[A-Za-z0-9._-]`, matching the C# `InputSanitizer.SanitizeProjectName`
/// so the directory layout stays byte-identical between the two implementations.
pub fn sanitize_project_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
        .collect()
}

pub fn get_project_root_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    let projects = tendril_home.join("Projects");
    if project_name.trim().is_empty() {
        return projects;
    }
    projects.join(sanitize_project_name(project_name))
}

pub fn get_project_repos_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    get_project_root_dir(tendril_home, project_name).join("Repos")
}

pub fn get_project_skills_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    get_project_root_dir(tendril_home, project_name).join("Skills")
}

pub fn get_project_mcp_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    get_project_root_dir(tendril_home, project_name).join("MCP")
}

pub fn get_project_memory_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    get_project_root_dir(tendril_home, project_name).join("Memory")
}

pub fn load_config(config_path: &Path) -> Result<TendrilSettings> {
    if !config_path.exists() {
        return Ok(TendrilSettings::default());
    }

    let raw = std::fs::read_to_string(config_path).map_err(|e| {
        TendrilError::Config(format!(
            "Failed to read config file {}: {}",
            config_path.display(),
            e
        ))
    })?;

    let settings: TendrilSettings = serde_yaml::from_str(&raw).map_err(|e| {
        TendrilError::Config(format!("Failed to parse {}: {}", config_path.display(), e))
    })?;

    Ok(settings)
}

/// Replaces `config.yaml` atomically while holding its lock.
///
/// The caller must not already hold that lock — see
/// [`FileLock::acquire`][crate::fs_lock::FileLock::acquire] on nesting.
pub fn save_config(config_path: &Path, settings: &TendrilSettings) -> Result<()> {
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let yaml = serde_yaml::to_string(settings)
        .map_err(|e| TendrilError::Config(format!("Failed to serialize settings: {}", e)))?;

    let _lock = crate::fs_lock::FileLock::acquire(config_path)?;
    crate::fs_lock::write_atomic(config_path, yaml.as_bytes())
}

/// The `name` of a `projects:` entry, if it has one.
fn project_entry_name(entry: &serde_yaml::Value) -> Option<&str> {
    entry.get("name")?.as_str()
}

/// Merges an incoming `projects` sequence into the existing one **by project name**.
///
/// Entries are matched case-insensitively on `name` — the same lookup every `/api/projects` handler
/// uses. A matched pair is merged as a mapping (so a payload naming one key does not clear the
/// project's other keys), an incoming entry matching nothing is appended, and an existing project the
/// payload does not mention is left untouched.
///
/// **Omission is not deletion.** Removing a project goes through `DELETE /api/projects/:name`, never
/// `PUT /api/config`. Do not later "fix" this merge to honour an omitted project as a delete — that
/// would turn every partial config PUT into a mass project wipe.
fn merge_projects_by_name(existing: &mut serde_yaml::Value, incoming: serde_yaml::Value) {
    let incoming_seq = match incoming {
        serde_yaml::Value::Sequence(seq) => seq,
        // Not a sequence: nothing to match on, so fall back to replacement.
        other => {
            *existing = other;
            return;
        }
    };

    let existing_seq = match existing.as_sequence_mut() {
        Some(seq) => seq,
        None => {
            *existing = serde_yaml::Value::Sequence(incoming_seq);
            return;
        }
    };

    for incoming_proj in incoming_seq {
        let matched = project_entry_name(&incoming_proj).and_then(|name| {
            existing_seq.iter().position(|existing_proj| {
                project_entry_name(existing_proj).is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
        });

        match matched {
            Some(idx) => merge_config_value(&mut existing_seq[idx], incoming_proj, false),
            None => existing_seq.push(incoming_proj),
        }
    }
}

/// Deep-merges `incoming` into `existing` for [`update_config_raw`].
///
/// - **Mappings merge recursively**, key by key. A key present only in `existing` is kept.
/// - **Sequences replace.** This must not be generalised: an incoming `filePermissions: []` or
///   `verifications: [...]` means "this is the list now", so merging list elements would make
///   clearing a list impossible.
/// - **The top-level `projects` sequence is the single exception** — see [`merge_projects_by_name`].
///   `at_root` is what keeps that exception to the real `projects` key, so a nested key that happens
///   to be called `projects` inside some project's own data is merged like any other sequence.
/// - Scalars, and any type mismatch between the two sides, replace.
fn merge_config_value(
    existing: &mut serde_yaml::Value,
    incoming: serde_yaml::Value,
    at_root: bool,
) {
    let incoming_map = match incoming {
        serde_yaml::Value::Mapping(map) => map,
        other => {
            *existing = other;
            return;
        }
    };

    let existing_map = match existing.as_mapping_mut() {
        Some(map) => map,
        None => {
            *existing = serde_yaml::Value::Mapping(incoming_map);
            return;
        }
    };

    for (key, value) in incoming_map {
        let is_projects = at_root && key.as_str() == Some("projects");
        match existing_map.get_mut(&key) {
            Some(slot) if is_projects => merge_projects_by_name(slot, value),
            Some(slot) => merge_config_value(slot, value, false),
            None => {
                existing_map.insert(key, value);
            }
        }
    }
}

/// Merges `incoming` into `config.yaml` and writes the result.
///
/// The merge is a **deep** one — see [`merge_config_value`] for the exact rules, and
/// [`merge_projects_by_name`] for why `projects` is special. A shallow top-level `insert` per
/// incoming key was the previous behaviour and meant a payload carrying `projects:` replaced the
/// entire projects array.
///
/// This is a read-modify-write, so the lock is held across **both** halves: releasing it between the
/// read and the write is exactly how two concurrent settings edits drop one another.
pub fn update_config_raw(config_path: &Path, incoming: &serde_json::Value) -> Result<()> {
    let _lock = crate::fs_lock::FileLock::acquire(config_path)?;
    let existing_raw = if config_path.exists() {
        std::fs::read_to_string(config_path).map_err(|e| {
            TendrilError::Config(format!("Failed to read {}: {}", config_path.display(), e))
        })?
    } else {
        String::new()
    };

    let mut existing_val: serde_yaml::Value = if !existing_raw.trim().is_empty() {
        serde_yaml::from_str(&existing_raw)
            .unwrap_or_else(|_| serde_yaml::Value::Mapping(serde_yaml::Mapping::new()))
    } else {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    };

    let incoming_yaml: serde_yaml::Value = serde_yaml::to_value(incoming)
        .map_err(|e| TendrilError::Config(format!("Invalid incoming config: {}", e)))?;

    if !incoming_yaml.is_mapping() {
        return Err(TendrilError::Config(
            "Config update payload must be an object".to_string(),
        ));
    }
    merge_config_value(&mut existing_val, incoming_yaml, true);

    let yaml_str = serde_yaml::to_string(&existing_val)
        .map_err(|e| TendrilError::Config(format!("Failed to serialize merged config: {}", e)))?;

    // Verify merged config is valid
    serde_yaml::from_str::<TendrilSettings>(&yaml_str)
        .map_err(|e| TendrilError::Config(format!("Merged config is invalid: {}", e)))?;

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // `write_atomic` rather than `save_config`: the lock is already held here, and re-acquiring it
    // would deadlock.
    crate::fs_lock::write_atomic(config_path, yaml_str.as_bytes())
}

pub fn generate_bearer_secret() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn default_capabilities() -> Vec<String> {
    vec![
        "jobs".to_string(),
        "plans".to_string(),
        "projects".to_string(),
        "ws".to_string(),
        "auth_bearer".to_string(),
        "auth_api_key".to_string(),
    ]
}

#[cfg(unix)]
pub fn is_process_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let res = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if res == 0 {
        true
    } else {
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

#[cfg(windows)]
pub fn is_process_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    use std::process::Command;
    let output = Command::new("cmd")
        .args(["/C", &format!("tasklist /FI \"PID eq {}\" /NH", pid)])
        .output();
    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        text.contains(&pid.to_string())
    } else {
        false
    }
}

#[cfg(not(any(unix, windows)))]
pub fn is_process_running(_pid: u32) -> bool {
    true
}

pub fn probe_health(host: &str, port: u16) -> bool {
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let host_norm = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    let addr_str = format!("{}:{}", host_norm, port);
    let addrs: Vec<_> = match addr_str.to_socket_addrs() {
        Ok(iter) => iter.collect(),
        Err(_) => return false,
    };

    for addr in addrs {
        if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
            let req = format!(
                "GET /api/ping HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
                addr
            );
            if stream.write_all(req.as_bytes()).is_ok() {
                let mut buf = [0u8; 1024];
                if let Ok(n) = stream.read(&mut buf) {
                    let resp = String::from_utf8_lossy(&buf[..n]);
                    if resp.contains("200 OK") || resp.contains("pong") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_api_version() -> u32 {
    1
}

/// `.master` files written before `serve --tls-cert/--tls-key` existed carry no `scheme`, and every
/// one of them describes a plaintext server.
fn default_scheme() -> String {
    "http".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterInfo {
    pub port: u16,
    pub pid: u32,
    #[serde(default)]
    pub secret: String,
    #[serde(rename = "startedAt", alias = "started_at", default)]
    pub started_at: String,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub version: String,
    #[serde(
        rename = "apiVersion",
        alias = "api_version",
        default = "default_api_version"
    )]
    pub api_version: u32,
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// `"http"` or `"https"` — which one `serve` was started with. Clients must not guess: a request
    /// to the wrong scheme is a connection error, not a redirect.
    #[serde(default = "default_scheme")]
    pub scheme: String,
}

impl MasterInfo {
    /// The base URL of the daemon's API, e.g. `https://127.0.0.1:5010`.
    pub fn base_url(&self) -> String {
        format!("{}://{}:{}", self.scheme, self.host, self.port)
    }
}

#[cfg(test)]
mod master_info_tests {
    use super::MasterInfo;

    #[test]
    fn base_url_follows_the_recorded_scheme() {
        let mut info: MasterInfo =
            serde_json::from_str(r#"{"port":5010,"pid":1,"host":"127.0.0.1","scheme":"http"}"#)
                .unwrap();
        assert_eq!(info.base_url(), "http://127.0.0.1:5010");

        info.scheme = "https".to_string();
        assert_eq!(info.base_url(), "https://127.0.0.1:5010");
    }

    #[test]
    fn a_master_file_without_a_scheme_reads_as_http() {
        let json = r#"{"port":5010,"pid":42,"host":"127.0.0.1"}"#;
        let parsed: MasterInfo = serde_json::from_str(json).unwrap();

        assert_eq!(parsed.scheme, "http");
        assert_eq!(parsed.base_url(), "http://127.0.0.1:5010");
    }
}

pub fn read_master(tendril_home: &Path) -> Option<MasterInfo> {
    let master_file = tendril_home.join(".master");
    if !master_file.exists() {
        return None;
    }

    let content = std::fs::read_to_string(&master_file).ok()?;
    serde_json::from_str(&content).ok()
}

/// True when this process owns the `.master` file. [`MasterGuard::acquire`] wrote our pid there;
/// anything else — a foreign pid, or no file at all — means we lost the race or were superseded, so
/// we must not write to anything the master owns.
///
/// Checked per pass rather than once at spawn: a daemon can be superseded while running. Being a
/// function of the file rather than of process-wide environment state, it is testable without the
/// cross-thread interference an env-var seam would cause.
pub fn is_master(tendril_home: &Path) -> bool {
    read_master(tendril_home).is_some_and(|m| m.pid == std::process::id())
}

pub fn write_master_info(tendril_home: &Path, info: &MasterInfo) -> Result<()> {
    let tmp_file = tendril_home.join(format!(".master.tmp.{}", info.pid));
    let master_file = tendril_home.join(".master");

    let json = serde_json::to_string_pretty(info)?;

    if let Err(e) = std::fs::write(&tmp_file, json) {
        let _ = std::fs::remove_file(&tmp_file);
        return Err(TendrilError::Io(e));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        if let Err(e) = std::fs::set_permissions(&tmp_file, perms) {
            let _ = std::fs::remove_file(&tmp_file);
            return Err(TendrilError::Io(e));
        }
    }

    if let Err(e) = std::fs::rename(&tmp_file, &master_file) {
        let _ = std::fs::remove_file(&tmp_file);
        return Err(TendrilError::Io(e));
    }

    Ok(())
}

pub fn write_master(
    tendril_home: &Path,
    port: u16,
    secret: &str,
    host: &str,
    scheme: &str,
) -> Result<()> {
    let info = MasterInfo {
        port,
        pid: std::process::id(),
        secret: secret.to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        host: host.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
        scheme: scheme.to_string(),
    };
    write_master_info(tendril_home, &info)
}

pub fn delete_master(tendril_home: &Path) {
    let master_file = tendril_home.join(".master");
    if master_file.exists() {
        let _ = std::fs::remove_file(master_file);
    }
}

pub struct MasterGuard {
    tendril_home: PathBuf,
    pid: u32,
}

/// Number of `/api/ping` attempts before a running master is declared unresponsive.
pub const HEALTH_PROBE_ATTEMPTS: u32 = 3;
const HEALTH_PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(300);

/// Probes `/api/ping` repeatedly, so one dropped probe on a loaded machine cannot decide mastership.
pub fn probe_health_with_retries(host: &str, port: u16, attempts: u32) -> bool {
    for attempt in 0..attempts.max(1) {
        if probe_health(host, port) {
            return true;
        }
        if attempt + 1 < attempts {
            std::thread::sleep(HEALTH_PROBE_INTERVAL);
        }
    }
    false
}

fn master_takeover_allowed() -> bool {
    std::env::var("TENDRIL_ALLOW_MASTER_TAKEOVER").as_deref() == Ok("1")
}

impl MasterGuard {
    pub fn acquire(
        tendril_home: &Path,
        port: u16,
        secret: &str,
        host: &str,
        scheme: &str,
    ) -> Result<Self> {
        ensure_not_real_home(tendril_home)?;

        if let Some(existing) = read_master(tendril_home) {
            if is_process_running(existing.pid) {
                // `probe_health` speaks plaintext HTTP, so it cannot tell a live TLS server from a
                // dead one; for those, the pid check above is the whole answer.
                let responding = existing.scheme.eq_ignore_ascii_case("https")
                    || probe_health_with_retries(
                        &existing.host,
                        existing.port,
                        HEALTH_PROBE_ATTEMPTS,
                    );
                if responding {
                    return Err(TendrilError::Other(format!(
                        "Another Tendril instance is running with PID {} on port {}",
                        existing.pid, existing.port
                    )));
                }

                if !master_takeover_allowed() {
                    return Err(TendrilError::Other(format!(
                        "Refusing to take mastership from live PID {} on port {} recorded in \
                         {}/.master: the process is alive but did not answer /api/ping after {} \
                         probes. Stop that instance, or start this one with a different \
                         TENDRIL_HOME.",
                        existing.pid,
                        existing.port,
                        tendril_home.display(),
                        HEALTH_PROBE_ATTEMPTS
                    )));
                }

                tracing::warn!(
                    "TENDRIL_ALLOW_MASTER_TAKEOVER=1: evicting live but unresponsive master PID {} on port {}",
                    existing.pid,
                    existing.port
                );
                delete_master(tendril_home);
            } else {
                tracing::warn!(
                    "Cleaning up stale .master file from PID {} on port {} (process is not running)",
                    existing.pid,
                    existing.port
                );
                delete_master(tendril_home);
            }
        }

        write_master(tendril_home, port, secret, host, scheme)?;
        Ok(Self {
            tendril_home: tendril_home.to_path_buf(),
            pid: std::process::id(),
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }
}

impl Drop for MasterGuard {
    fn drop(&mut self) {
        if let Some(info) = read_master(&self.tendril_home) {
            if info.pid == self.pid {
                delete_master(&self.tendril_home);
            } else {
                tracing::warn!(
                    "Not deleting .master on drop: file has foreign pid {} (current pid {})",
                    info.pid,
                    self.pid
                );
            }
        }
    }
}

pub fn find_projects_referencing_verification(
    settings: &TendrilSettings,
    verification_name: &str,
) -> Vec<String> {
    settings
        .projects
        .iter()
        .filter(|p| {
            p.verifications
                .iter()
                .any(|v| v.name.eq_ignore_ascii_case(verification_name))
        })
        .map(|p| p.name.clone())
        .collect()
}

pub fn remove_verification_from_projects(
    settings: &mut TendrilSettings,
    verification_name: &str,
) -> Vec<String> {
    let mut modified = Vec::new();
    for p in &mut settings.projects {
        let before_len = p.verifications.len();
        p.verifications
            .retain(|v| !v.name.eq_ignore_ascii_case(verification_name));
        if p.verifications.len() != before_len {
            modified.push(p.name.clone());
        }
    }
    modified
}

/// Where a verification goes in a project's ordered verification list. The order is the run
/// order, which is why moving an entry is a first-class operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerificationPlacement {
    /// Immediately before the named verification.
    Before(String),
    /// Immediately after the named verification.
    After(String),
    /// At this zero-based index, clamped to the list length.
    Position(usize),
}

/// Resolves a placement to an insert index against `verifications` as it stands. For a move,
/// pass the list with the moved entry already removed — that is what makes `--after` behave
/// correctly when an entry moves forward.
fn resolve_insert_index(
    verifications: &[ProjectVerificationRef],
    placement: &VerificationPlacement,
) -> Result<usize> {
    let find = |name: &str| {
        verifications
            .iter()
            .position(|v| v.name.eq_ignore_ascii_case(name))
    };
    let available = || {
        verifications
            .iter()
            .map(|v| v.name.clone())
            .collect::<Vec<_>>()
            .join(", ")
    };

    match placement {
        VerificationPlacement::Before(name) => find(name).ok_or_else(|| {
            TendrilError::Config(format!(
                "Target verification for --before not found: '{}'. Available: {}",
                name,
                available()
            ))
        }),
        VerificationPlacement::After(name) => find(name).map(|i| i + 1).ok_or_else(|| {
            TendrilError::Config(format!(
                "Target verification for --after not found: '{}'. Available: {}",
                name,
                available()
            ))
        }),
        VerificationPlacement::Position(n) => Ok((*n).min(verifications.len())),
    }
}

/// Moves an existing verification within a project, returning the index it landed at.
/// The list is left untouched if the placement target cannot be resolved.
pub fn move_project_verification(
    project: &mut ProjectConfig,
    verification: &str,
    placement: &VerificationPlacement,
) -> Result<usize> {
    let current = project
        .verifications
        .iter()
        .position(|v| v.name.eq_ignore_ascii_case(verification))
        .ok_or_else(|| {
            TendrilError::Config(format!(
                "Verification not found: '{}'. Available: {}",
                verification,
                project
                    .verifications
                    .iter()
                    .map(|v| v.name.clone())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })?;

    // Resolve against the shortened list, but before mutating, so a bad target leaves the
    // project's order exactly as it was.
    let mut shortened = project.verifications.clone();
    let item = shortened.remove(current);
    let insert_index = resolve_insert_index(&shortened, placement)?;

    shortened.insert(insert_index, item);
    project.verifications = shortened;
    Ok(insert_index)
}

/// Inserts a new verification into a project, returning the index it landed at.
/// `after: None` appends. Errors if the verification is already present, or if `after`
/// names a verification the project does not have.
pub fn insert_project_verification(
    project: &mut ProjectConfig,
    entry: ProjectVerificationRef,
    after: Option<&str>,
) -> Result<usize> {
    if project
        .verifications
        .iter()
        .any(|v| v.name.eq_ignore_ascii_case(&entry.name))
    {
        return Err(TendrilError::Config(format!(
            "Verification already exists in project: {}",
            entry.name
        )));
    }

    let insert_index = match after {
        Some(name) => resolve_insert_index(
            &project.verifications,
            &VerificationPlacement::After(name.to_string()),
        )?,
        None => project.verifications.len(),
    };

    project.verifications.insert(insert_index, entry);
    Ok(insert_index)
}
