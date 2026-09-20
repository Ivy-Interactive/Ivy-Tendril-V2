//! [`TendrilSettings`] — the whole of `config.yaml` as one struct — together with its field
//! defaults and the `chatMode` vocabulary.
//!
//! The nested section types the fields are typed as live in [`super::sections`]; this module is the
//! top-level document and the `default_*` functions its `serde` attributes name.

use super::sections::{
    deserialize_coding_agents, deserialize_inbox, deserialize_promptwares, AgentConfig,
    ApiSettings, AuthConfig, InboxConfig, LlmConfig, OnboardingConfig, PromptwareConfig,
    SecuritySettings,
};
use crate::models::{LevelConfig, ProjectConfig, VerificationConfig};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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

    /// The colour-scheme preset Appearance applies, spelled as one of
    /// `packages/components/src/lib/theme-presets.ts`'s ids (`default`, `dracula`, ...). An id no
    /// preset matches resolves to `default` in the UI rather than failing the load, which is what
    /// `TendrilThemes.GetTheme` does with an unknown id.
    #[serde(default = "default_theme")]
    pub theme: String,

    /// `light`, `dark` or `system`, mirroring the original's `TendrilSettings.ThemeMode`. Read by the
    /// webview at start-up, which is why it is modeled rather than left in [`Self::extra`]: an
    /// unmodeled key still round-trips, but a mistyped value would then reach the client unvalidated.
    #[serde(rename = "themeMode", default = "default_theme_mode")]
    pub theme_mode: String,

    /// Whether the main sidebar starts expanded, for **new client sessions** — the original reads it
    /// once per shell build (`UseState(() => config.Settings.SidebarOpen)`) and does not write a
    /// runtime toggle back, so this is a default, not live state.
    #[serde(rename = "sidebarOpen", default = "default_true")]
    pub sidebar_open: bool,

    /// What the Chat button opens: `chat` for the chat view, `terminal` for the agent's own terminal.
    ///
    /// The original's `TendrilSettings.ChatMode`, read by `ChatLauncher.TargetFor` to decide which app
    /// a new session goes to. Modeled rather than left in [`Self::extra`] for the same reason
    /// [`Self::theme_mode`] is: the client reads it to pick a view, so an unrecognised value must
    /// resolve to the default here rather than reaching the client unvalidated —
    /// [`chat_mode_is_terminal`] is the single question every consumer asks.
    #[serde(rename = "chatMode", default = "default_chat_mode")]
    pub chat_mode: String,

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

    /// Identity appended as a `Co-Authored-By` trailer to the commits **Tendril itself** creates —
    /// a promptware agent executing a plan, and the vault's own git calls — in `Name <email>` form,
    /// e.g. `my-bot <bot@example.com>`.
    ///
    /// Config rather than a constant, and no accompanying boolean: the identity is different for
    /// every installation, so a shipped literal would attribute one customer's commits to another's
    /// bot account. Absent (the default) means no trailer *and no hook install* — see
    /// [`crate::git::coauthor_hooks`], where an unset value returns before anything is created.
    ///
    /// `skip_serializing_if` for the same reason as [`Self::telemetry`]: V2 must never *introduce*
    /// the key into a `config.yaml` shared with the original app.
    #[serde(rename = "coAuthor", default, skip_serializing_if = "Option::is_none")]
    pub co_author: Option<String>,

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

    /// The single reader of `coAuthor`, returning the identity only when it is usable.
    ///
    /// Rejected here rather than at the point of use so that a bad value degrades to "feature off"
    /// once, instead of each consumer inventing its own handling:
    ///
    /// * blank — the natural way to spell "off" in YAML, and an empty trailer is meaningless anyway;
    /// * containing a newline or a carriage return — `git interpret-trailers` would read the tail as
    ///   further trailers, so a configured value could forge a `Co-Authored-By` for anyone, or split
    ///   the commit message. This is the one genuinely load-bearing rejection.
    ///
    /// Deliberately *not* rejected: a missing `<email>`. Git itself only credits a co-author it can
    /// match to an account, so a malformed identity is inert rather than dangerous, and refusing it
    /// here would turn a cosmetic mistake into a silent loss of attribution the operator never
    /// configured their way out of.
    pub fn co_author_identity(&self) -> Option<&str> {
        let value = self.co_author.as_deref()?.trim();
        if value.is_empty() || value.contains(['\n', '\r']) {
            return None;
        }
        Some(value)
    }
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
/// `TendrilSettings.ThemeMode`'s default: follow the OS.
fn default_theme_mode() -> String {
    "system".to_string()
}

/// `ChatModes.Chat`: the Chat button opens the chat view unless it is told otherwise.
pub const CHAT_MODE_CHAT: &str = "chat";
/// `ChatModes.Terminal`: the Chat button opens the agent's own terminal.
pub const CHAT_MODE_TERMINAL: &str = "terminal";

fn default_chat_mode() -> String {
    CHAT_MODE_CHAT.to_string()
}

/// Whether a `chatMode` value asks for the terminal. The original's `ChatModes.IsTerminal`: only the
/// exact `terminal` opt-in counts, so anything unrecognised — including a value hand-edited into
/// `config.yaml` — falls back to the chat view rather than to a view the user cannot get out of.
pub fn chat_mode_is_terminal(mode: &str) -> bool {
    mode.trim().eq_ignore_ascii_case(CHAT_MODE_TERMINAL)
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
            theme_mode: default_theme_mode(),
            sidebar_open: true,
            chat_mode: default_chat_mode(),
            worktree_reaper_interval: default_worktree_reaper_interval(),
            worktree_reaper_grace: default_worktree_reaper_grace(),
            worktree_branch_delete_mode: default_worktree_branch_delete_mode(),
            co_author: None,
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
