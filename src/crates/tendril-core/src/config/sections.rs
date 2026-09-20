//! The typed sections nested inside [`TendrilSettings`][super::settings::TendrilSettings]: `auth`,
//! `api`, `security`, `llm`, `inbox`, `onboarding`, `promptwares` and `codingAgents`.
//!
//! Three of them are read through hand-written deserializers rather than the derive, because real
//! configs carry more than one shape for them and a malformed section must degrade to a default
//! instead of failing the whole load.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

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
pub(super) fn deserialize_inbox<'de, D>(
    deserializer: D,
) -> std::result::Result<InboxConfig, D::Error>
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
pub(super) fn deserialize_coding_agents<'de, D>(
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
pub(super) fn deserialize_promptwares<'de, D>(
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

fn default_check_interval_minutes() -> i32 {
    15
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
