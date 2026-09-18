//! The agent / model / effort catalog the UI populates its picker from.
//!
//! This is a port of V1's catalogue, whose authority is spread over three places:
//!
//! * `AgentServiceCollectionExtensions.AddAgentInfrastructure` registers the providers, and
//!   `IAgentRunner.RegisteredAgents` hands that registration order straight to the picker — which is
//!   why [`AGENTS`] below is ordered antigravity, claude, codex, copilot, gemini, opencode, ivy,
//!   openaiproxy rather than alphabetically or by popularity.
//! * each provider's `GetStaticModels()` declares the models that provider offers **and the effort
//!   ladder each of those models carries**. The ladder is therefore a property of the (agent, model)
//!   pair, not of the agent: Copilot on `claude-opus-5` offers Claude's five levels, and on `gpt-5.4`
//!   its own four. `ChatApp.GetEffortsForAgentAndModel` resolves it — model row first, agent
//!   descriptor second — and [`efforts_for`] is that function.
//! * `Abstractions/ModelCatalog.EffortLevels` declares the ladders themselves.
//!
//! # Why the model set is declared rather than derived
//!
//! An earlier V2 built each agent's list by filtering one shared spec table
//! ([`crate::agents::model_specs`]) on an id prefix — `claude-*` for Claude, `gemini-*` for Gemini —
//! on the theory that the ids the picker offers and the ids that carry pricing could then never
//! drift. That inverts V1: `CachedModelCatalogProvider.GetModelsAsync` takes the provider's own
//! `GetStaticModels()` as the row set and lets models.dev **enrich the prices of those rows only**;
//! models.dev never adds a row.
//!
//! Deriving the rows instead made provenance a property of the id *string*, which is not provenance
//! at all:
//!
//! * `register_dynamic_specs` loads all of models.dev — some 15,000 rows across a hundred providers
//!   — into the shared table, so every Bedrock, Vertex and OpenRouter spelling of a model
//!   (`claude-opus-5@eu`, `claude-4.5-sonnet`, `moonshotai/kimi-k3-free`) landed in the picker of
//!   whichever agent's prefix it happened to match. Claude's list went from 18 rows to 83, most of
//!   them ids the Claude CLI cannot launch.
//! * a row whose id matched no prefix was offered by any agent whose filter was `Any` — which the
//!   proxy pointed at an unrecognised base URL was, so it offered every model in existence,
//!   including every Gemini, where V1 offers a declared union of five catalogues.
//!
//! So the row set is declared here, one list per provider, exactly as V1 declares it
//! ([`CLAUDE_MODELS`] and friends are `ClaudeModelCatalog.GetStaticModels()` and friends), and
//! `model_specs` is left to do the one job V1 gives it: price a model once one is chosen. The
//! no-drift promise is kept by a test instead of by construction —
//! `every_declared_model_carries_a_pricing_spec` asserts every id here resolves through
//! `model_specs::find`.
//!
//! # The default model is a real model
//!
//! V1 has no synthetic `default` row. One row per catalogue carries `ModelInfo.IsDefault`,
//! `ModelCatalogSorter.Sort(preserveDefault: true)` pins that row **first**, and
//! `ChatApp.ResolveModel` resolves "the default" to that row's real id. So V1's picker lists real
//! models, the first of them is the default, and nothing in the UI ever says `default`.
//!
//! V2 used to prepend a fake `default` row to every list instead, which put an id in the picker that
//! named no model and meant something different in each arm of the launcher. [`AgentDef::default_model`]
//! is V1's flag, [`build_agent`] pins it first, and [`default_model_for`] is `ResolveModel`.
//!
//! `default` survives in exactly two places, both of them V1's:
//!
//! * **as an effort**, where V1 really does offer a "Default" option and normalises it to `""` on save
//!   (`CodingAgentSetupView.SetProfile`), and
//! * **as a config value for a profile's model**, where it is how `config.yaml` spells "no opinion" —
//!   `resolution::is_set` reads it as unset and the launcher then passes no `--model` at all. Configs
//!   already hold it, so it keeps that meaning; it is simply no longer offered as something to choose.
//!
//! One thing is deliberately not V1: **retired ids**. V1 still declares `claude-fable-5` and
//! `claude-5.1`, which no longer resolve; V2 declares `claude-fable-5-1` in their place and does not
//! resurrect the dead ones.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::model_sorting::{sort_models, SortableModel};
use super::model_specs::normalize_model_id;

/// A reasoning-effort level a provider's CLI accepts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffortOption {
    pub id: String,
    pub display_name: String,
}

/// A model a provider can be launched with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub id: String,
    pub display_name: String,
    /// The ladder this model offers under this agent, which is not always the agent's own — see the
    /// module docs. Empty when the agent ignores effort entirely, and then omitted from the wire.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub efforts: Vec<EffortOption>,
}

impl SortableModel for ModelOption {
    fn model_id(&self) -> &str {
        &self.id
    }
    fn model_display_name(&self) -> &str {
        &self.display_name
    }
}

/// A coding agent, with the models and efforts it can be launched with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOption {
    pub id: String,
    pub label: String,
    /// V1 `Helpers/AgentBranding.IconFor`, serialised as the `Icons` enum name the webview's
    /// `BrandIcon` resolves. Like the label, the proxy's icon follows the provider it points at.
    pub icon: String,
    pub models: Vec<ModelOption>,
    /// The model this agent launches with when nobody has chosen one — V1 `ModelInfo.IsDefault`,
    /// resolved by `ChatApp.ResolveModel`. It is a **real id** from [`Self::models`], and because
    /// `ModelCatalogSorter.Sort(preserveDefault: true)` pins that row first it is always `models[0]`.
    pub default_model: String,
    pub supports_effort: bool,
    /// The ladder for a model that carries none of its own, and for `default`. V1's
    /// `IAgentDescriptor.SupportedEfforts`.
    pub efforts: Vec<EffortOption>,
}

/// The id an **effort** list starts with, and the value `config.yaml` uses for a profile field nobody
/// has set. V1 offers it as an effort (`GetEffortOptions` prepends it) and `resolution::is_set` reads it
/// as unset for a model. It is deliberately not a model anyone can pick — see the module docs.
pub const DEFAULT_OPTION_ID: &str = "default";

// ---------------------------------------------------------------------------
// Effort ladders — V1 `Abstractions/ModelCatalog.EffortLevels`
// ---------------------------------------------------------------------------

const CLAUDE_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
/// Codex is the one ladder with a `none`: the Codex CLI is usable with no reasoning at all.
const CODEX_EFFORTS: &[&str] = &["none", "low", "medium", "high", "xhigh"];
const COPILOT_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh"];
const ANTIGRAVITY_EFFORTS: &[&str] = &["low", "medium", "high"];
const GEMINI_EFFORTS: &[&str] = &["low", "medium", "high"];
const OPENCODE_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];
// ---------------------------------------------------------------------------
// The provider catalogues — one per V1 `*ModelCatalog.GetStaticModels()`
// ---------------------------------------------------------------------------

/// One row of a provider's own catalogue: V1's `ModelInfo`, minus the fields the picker never reads.
/// Limits and prices are deliberately absent — those come from [`crate::agents::model_specs`], which
/// is V1's `.WithSpec()`.
struct CatalogModel {
    id: &'static str,
    display_name: &'static str,
    /// V1 `ModelInfo.SupportedEfforts`, declared per row. Empty falls back to the agent's ladder.
    efforts: &'static [&'static str],
}

const fn model(
    id: &'static str,
    display_name: &'static str,
    efforts: &'static [&'static str],
) -> CatalogModel {
    CatalogModel {
        id,
        display_name,
        efforts,
    }
}

/// The row each catalogue flags `IsDefault`, which every picker over that catalogue pins first.
const CLAUDE_DEFAULT: &str = "claude-opus-5";
const CODEX_DEFAULT: &str = "gpt-5.6-terra";
const COPILOT_DEFAULT: &str = "gpt-5.4";
/// V1 flags `gemini-3.7-flash`, which was the newest Flash when it was written. 3.8 is, and both
/// catalogues already list it first, so the row V2 pins is 3.8 - the one deliberate departure from
/// V1's `IsDefault` flags.
const GEMINI_DEFAULT: &str = "gemini-3.8-flash";
const OPENCODE_DEFAULT: &str = "moonshotai/Kimi-K3";

/// V1 `ClaudeModelCatalog`. Also the list the proxy serves when pointed at `api.anthropic.com`, and
/// the first third of `IvyModelCatalog`.
static CLAUDE_MODELS: &[CatalogModel] = &[
    model("claude-opus-5", "Claude Opus 5", CLAUDE_EFFORTS),
    model("claude-fable-5-1", "Claude Fable 5.1", CLAUDE_EFFORTS),
    model("claude-opus-5-1", "Claude Opus 5.1", CLAUDE_EFFORTS),
    model("claude-opus-4-8", "Claude Opus 4.8", CLAUDE_EFFORTS),
    model("claude-opus-4-7", "Claude Opus 4.7", CLAUDE_EFFORTS),
    model("claude-opus-4-6", "Claude Opus 4.6", CLAUDE_EFFORTS),
    model("opus", "Claude Opus", CLAUDE_EFFORTS),
    model("claude-sonnet-5-1", "Claude Sonnet 5.1", CLAUDE_EFFORTS),
    model("claude-sonnet-5", "Claude Sonnet 5", CLAUDE_EFFORTS),
    model("claude-sonnet-4-6", "Claude Sonnet 4.6", CLAUDE_EFFORTS),
    model("claude-3-7-sonnet", "Claude Sonnet 3.7", CLAUDE_EFFORTS),
    model("claude-3-5-sonnet", "Claude Sonnet 3.5", CLAUDE_EFFORTS),
    model("sonnet", "Claude Sonnet", CLAUDE_EFFORTS),
    model("claude-haiku-5-1", "Claude Haiku 5.1", CLAUDE_EFFORTS),
    model("claude-haiku-4-5", "Claude Haiku 4.5", CLAUDE_EFFORTS),
    model("claude-3-5-haiku", "Claude Haiku 3.5", CLAUDE_EFFORTS),
    model("haiku", "Claude Haiku", CLAUDE_EFFORTS),
];

/// V1 `CodexModelCatalog`. Also the list the proxy serves when pointed at `api.openai.com` or at
/// nothing at all, and the last third of `IvyModelCatalog`.
static CODEX_MODELS: &[CatalogModel] = &[
    model("gpt-6-astra", "GPT-6 Astra", CODEX_EFFORTS),
    model("gpt-5.6-sol", "GPT-5.6-Sol", CODEX_EFFORTS),
    model("gpt-5.6-terra", "GPT-5.6-Terra", CODEX_EFFORTS),
    model("gpt-5.6-luna", "GPT-5.6-Luna", CODEX_EFFORTS),
    model("gpt-5.5", "GPT-5.5", CODEX_EFFORTS),
    model("gpt-5.4", "GPT-5.4", CODEX_EFFORTS),
    model("gpt-5.4-mini", "GPT-5.4 Mini", CODEX_EFFORTS),
    model("gpt-5.3-codex", "GPT-5.3 Codex", CODEX_EFFORTS),
    model("o3", "O3", CODEX_EFFORTS),
    model("o4-mini", "O4 Mini", CODEX_EFFORTS),
    model("gpt-4.1", "GPT-4.1", CODEX_EFFORTS),
    model("codex-mini", "Codex Mini", CODEX_EFFORTS),
];

/// V1 `CopilotModelCatalog`: GitHub Copilot really does serve both OpenAI's models and Anthropic's,
/// and the Claude rows carry Claude's ladder rather than Copilot's — which is where `max`, a level
/// Copilot's own ladder does not have, comes from.
static COPILOT_MODELS: &[CatalogModel] = &[
    model("gpt-5.4", "GPT-5.4", COPILOT_EFFORTS),
    model("gpt-5.4-mini", "GPT-5.4 Mini", COPILOT_EFFORTS),
    model("gpt-5.3-codex", "GPT-5.3 Codex", COPILOT_EFFORTS),
    model("gpt-5.2-codex", "GPT-5.2 Codex", COPILOT_EFFORTS),
    model("gpt-5.2", "GPT-5.2", COPILOT_EFFORTS),
    model("gpt-5-mini", "GPT-5 Mini", COPILOT_EFFORTS),
    model("gpt-4.1", "GPT-4.1", COPILOT_EFFORTS),
    model("claude-fable-5-1", "Claude Fable 5.1", CLAUDE_EFFORTS),
    model("claude-opus-5-1", "Claude Opus 5.1", CLAUDE_EFFORTS),
    model("claude-opus-5", "Claude Opus 5", CLAUDE_EFFORTS),
    model("claude-sonnet-5-1", "Claude Sonnet 5.1", CLAUDE_EFFORTS),
    model("claude-sonnet-5", "Claude Sonnet 5", CLAUDE_EFFORTS),
    model("claude-sonnet-4-6", "Claude Sonnet 4.6", CLAUDE_EFFORTS),
    model("claude-sonnet-4-5", "Claude Sonnet 4.5", CLAUDE_EFFORTS),
    model("claude-haiku-4-5", "Claude Haiku 4.5", CLAUDE_EFFORTS),
];

/// V1 `GeminiModelCatalog`. The rows declare Gemini's ladder even though the Gemini agent itself
/// takes no effort argument, because the same rows are reached through the Ivy proxy, which does.
static GEMINI_MODELS: &[CatalogModel] = &[
    model("gemini-3.8-flash", "Gemini 3.8 Flash", GEMINI_EFFORTS),
    model("gemini-3.7-flash", "Gemini 3.7 Flash", GEMINI_EFFORTS),
    model("gemini-3.6-flash", "Gemini 3.6 Flash", GEMINI_EFFORTS),
    model("gemini-3.1-pro", "Gemini 3.1 Pro", GEMINI_EFFORTS),
    model("gemini-3-pro-preview", "Gemini 3 Pro", GEMINI_EFFORTS),
    model("gemini-3-flash-preview", "Gemini 3 Flash", GEMINI_EFFORTS),
];

/// V1 `AntigravityModelCatalog`: Gemini's models, Anthropic's, and one open-weights OpenAI row.
static ANTIGRAVITY_MODELS: &[CatalogModel] = &[
    model("gemini-3.8-flash", "Gemini 3.8 Flash", ANTIGRAVITY_EFFORTS),
    model("gemini-3.7-flash", "Gemini 3.7 Flash", ANTIGRAVITY_EFFORTS),
    model("gemini-3.6-flash", "Gemini 3.6 Flash", ANTIGRAVITY_EFFORTS),
    model("gemini-3.1-pro", "Gemini 3.1 Pro", ANTIGRAVITY_EFFORTS),
    model("claude-fable-5-1", "Claude Fable 5.1", CLAUDE_EFFORTS),
    model("claude-opus-5-1", "Claude Opus 5.1", CLAUDE_EFFORTS),
    model("claude-opus-5", "Claude Opus 5", CLAUDE_EFFORTS),
    model("claude-opus-4-6", "Claude Opus 4.6", CLAUDE_EFFORTS),
    model("claude-sonnet-5-1", "Claude Sonnet 5.1", CLAUDE_EFFORTS),
    model("claude-sonnet-5", "Claude Sonnet 5", CLAUDE_EFFORTS),
    model("claude-sonnet-4-6", "Claude Sonnet 4.6", CLAUDE_EFFORTS),
    model("gpt-oss-120b", "GPT-OSS 120B", ANTIGRAVITY_EFFORTS),
];

/// V1 `OpenCodeModelCatalog`. Its own `default` row is not declared here because [`build_agent`]
/// prepends one to every list, and V1's proxy splices this list only after dropping it.
static OPENCODE_MODELS: &[CatalogModel] = &[
    model("moonshotai/Kimi-K3", "Kimi k3", OPENCODE_EFFORTS),
    model("claude-fable-5-1", "Claude Fable 5.1", CLAUDE_EFFORTS),
    model("claude-opus-5-1", "Claude Opus 5.1", CLAUDE_EFFORTS),
    model("claude-opus-5", "Claude Opus 5", CLAUDE_EFFORTS),
    model("claude-opus-4-7", "Claude Opus 4.7", CLAUDE_EFFORTS),
    model("claude-sonnet-5-1", "Claude Sonnet 5.1", CLAUDE_EFFORTS),
    model("claude-sonnet-5", "Claude Sonnet 5", CLAUDE_EFFORTS),
    model("claude-sonnet-4-6", "Claude Sonnet 4.6", CLAUDE_EFFORTS),
    model("gpt-5.5", "GPT-5.5", OPENCODE_EFFORTS),
];

/// The one row V1's `GetModelsForBaseUrl` adds to OpenCode's list for Berget's endpoint.
static BERGET_MODELS: &[CatalogModel] = &[model(
    "Qwen/Qwen2.5-Coder-32B-Instruct",
    "Qwen 2.5 Coder 32B",
    OPENCODE_EFFORTS,
)];

/// V1's `IvyModelCatalog` concatenates the Claude, Gemini and Codex catalogues in that order, so the
/// Ivy proxy offers all three families and each model keeps the ladder of the catalogue it came
/// from — including Gemini's, which the Gemini agent itself cannot use.
static IVY_CATALOGUES: &[&[CatalogModel]] = &[CLAUDE_MODELS, GEMINI_MODELS, CODEX_MODELS];

/// V1's fallback for a base URL it does not recognise: the union of the five catalogues it knows,
/// deduplicated. Not "every model that exists" — a proxy is still only useful for models something
/// behind it can serve, and this is the set V2 can name a ladder and a price for.
static CUSTOM_PROXY_CATALOGUES: &[&[CatalogModel]] =
    &[CODEX_MODELS, CLAUDE_MODELS, GEMINI_MODELS, OPENCODE_MODELS];

// ---------------------------------------------------------------------------
// The agents
// ---------------------------------------------------------------------------

struct AgentDef {
    id: &'static str,
    /// V1 `IAgentCli.DisplayName`.
    label: &'static str,
    /// V1 `AgentBranding.IconFor`.
    icon: &'static str,
    /// The provider catalogues this agent offers, in the order its own V1 catalogue declares them —
    /// which is the order the picker groups them in, because `ModelCatalogSorter` groups by a
    /// provider's first appearance in the list it is given.
    catalogues: &'static [&'static [CatalogModel]],
    /// The id V1 flags `IsDefault` in the first of those catalogues — `FirstOrDefault(m =>
    /// m.IsDefault)` over the concatenation — which every picker pins first and
    /// `ChatApp.ResolveModel` resolves "the default" to.
    default_model: &'static str,
    /// V1 `IAgentDescriptor.SupportedEfforts`, the ladder for `default` and for any row that
    /// declares none. Empty means the provider has no `EffortControl` capability and the picker
    /// hides the control.
    efforts: &'static [&'static str],
}

/// Declared in V1's registration order, which is the order the picker lists them.
/// `openaiproxy` is appended by [`all_agents_for_proxy_base_url`], because what it offers depends on
/// where it points.
///
/// V1's `ivy` row - the rebranded `ivy-agent` CLI - is deliberately absent. V2 bundles OpenCode
/// instead of shipping a rebranded agent, so nothing installs that binary and the row offered a
/// choice that could not launch. It was also the one row the Coding Agent pane never listed, which
/// is how the chat picker came to show an agent the settings screen had no card for. The `ivy` id
/// is still *accepted* everywhere it was - `agent_environment` still reads credentials from an
/// `ivy` entry, and `resolve_ivy_agent_binary` still resolves the binary - so an existing
/// `config.yaml` naming it keeps working; it is only no longer offered.
static AGENTS: &[AgentDef] = &[
    AgentDef {
        id: "antigravity",
        label: "Antigravity",
        icon: "Antigravity",
        catalogues: &[ANTIGRAVITY_MODELS],
        default_model: GEMINI_DEFAULT,
        efforts: ANTIGRAVITY_EFFORTS,
    },
    AgentDef {
        id: "claude",
        label: "Claude Code",
        icon: "ClaudeCode",
        catalogues: &[CLAUDE_MODELS],
        default_model: CLAUDE_DEFAULT,
        efforts: CLAUDE_EFFORTS,
    },
    AgentDef {
        id: "codex",
        label: "Codex",
        icon: "OpenAI",
        catalogues: &[CODEX_MODELS],
        default_model: CODEX_DEFAULT,
        efforts: CODEX_EFFORTS,
    },
    AgentDef {
        id: "copilot",
        label: "Copilot",
        icon: "Copilot",
        catalogues: &[COPILOT_MODELS],
        default_model: COPILOT_DEFAULT,
        efforts: COPILOT_EFFORTS,
    },
    AgentDef {
        id: "gemini",
        label: "Gemini",
        icon: "Gemini",
        catalogues: &[GEMINI_MODELS],
        default_model: GEMINI_DEFAULT,
        // `GeminiCli.Capabilities` is the one that omits `EffortControl`, so the Gemini agent takes
        // no effort argument at all.
        efforts: &[],
    },
    AgentDef {
        id: "opencode",
        label: "OpenCode",
        icon: "OpenCode",
        catalogues: &[OPENCODE_MODELS],
        default_model: OPENCODE_DEFAULT,
        efforts: OPENCODE_EFFORTS,
    },
];

// ---------------------------------------------------------------------------
// The OpenAI proxy, whose catalogue follows its base URL
// ---------------------------------------------------------------------------

/// V1 `OpenAiProxyModelCatalog.GetModelsForBaseUrl` and `AgentBranding.For`: one agent id whose
/// label, icon and model list all follow the `ANTHROPIC_BASE_URL` it is configured with.
pub const OPENAI_PROXY_AGENT_ID: &str = "openaiproxy";

fn openai_proxy_def(base_url: Option<&str>) -> &'static AgentDef {
    let url = base_url.unwrap_or("").to_ascii_lowercase();

    if url.contains("ivy.app") {
        return &OPENAI_PROXY_IVY;
    }
    if url.contains("api.berget.ai") {
        return &OPENAI_PROXY_BERGET;
    }
    if url.contains("api.anthropic.com") {
        return &OPENAI_PROXY_ANTHROPIC;
    }
    if url.contains("generativelanguage.googleapis.com")
        || url.contains("gemini")
        || url.contains("google")
    {
        return &OPENAI_PROXY_GOOGLE;
    }
    if url.contains("api.openai.com") || url.is_empty() {
        return &OPENAI_PROXY_OPENAI;
    }
    &OPENAI_PROXY_CUSTOM
}

/// Pointed at Ivy's own proxy, this is still branded as the proxy rather than as Ivy: V1's
/// `AgentBranding` only relabels `openaiproxy` for Berget and for Anthropic, and the `ivy` agent id
/// is the one that carries Ivy's own mark.
static OPENAI_PROXY_IVY: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "OpenAI Proxy",
    icon: "OpenAI",
    catalogues: IVY_CATALOGUES,
    default_model: CLAUDE_DEFAULT,
    efforts: OPENCODE_EFFORTS,
};

/// Berget's endpoint is the one V1 relabels outright, because the user picked a provider rather than
/// a proxy.
static OPENAI_PROXY_BERGET: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "Berget AI",
    icon: "ChevronUp",
    catalogues: &[OPENCODE_MODELS, BERGET_MODELS],
    default_model: OPENCODE_DEFAULT,
    efforts: OPENCODE_EFFORTS,
};

static OPENAI_PROXY_ANTHROPIC: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "Anthropic",
    icon: "ClaudeCode",
    catalogues: &[CLAUDE_MODELS],
    default_model: CLAUDE_DEFAULT,
    efforts: OPENCODE_EFFORTS,
};

static OPENAI_PROXY_GOOGLE: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "OpenAI Proxy",
    icon: "OpenAI",
    catalogues: &[GEMINI_MODELS],
    default_model: GEMINI_DEFAULT,
    efforts: OPENCODE_EFFORTS,
};

static OPENAI_PROXY_OPENAI: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "OpenAI Proxy",
    icon: "OpenAI",
    catalogues: &[CODEX_MODELS],
    default_model: CODEX_DEFAULT,
    efforts: OPENCODE_EFFORTS,
};

static OPENAI_PROXY_CUSTOM: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "OpenAI Proxy",
    icon: "OpenAI",
    catalogues: CUSTOM_PROXY_CATALOGUES,
    default_model: CODEX_DEFAULT,
    efforts: OPENCODE_EFFORTS,
};

// ---------------------------------------------------------------------------
// Building the catalog
// ---------------------------------------------------------------------------

impl AgentDef {
    fn supports_effort(&self) -> bool {
        !self.efforts.is_empty()
    }

    /// The declared row for a model id, matched the way `ModelSpecs.Find` matches: case and
    /// dot/dash insensitively, so `gpt-5.6-sol` and `gpt-5-6-sol` are the same row.
    fn row(&self, model_id: &str) -> Option<&'static CatalogModel> {
        let wanted = normalize_model_id(model_id);
        self.catalogues
            .iter()
            .flat_map(|catalogue| catalogue.iter())
            .find(|row| normalize_model_id(row.id) == wanted)
    }

    /// V1's per-model `SupportedEfforts`, which each provider's catalogue sets per row.
    fn efforts_for_row(&self, row: Option<&CatalogModel>) -> &'static [&'static str] {
        if !self.supports_effort() {
            return &[];
        }
        match row {
            Some(row) if !row.efforts.is_empty() => row.efforts,
            _ => self.efforts,
        }
    }
}

fn effort_options(ids: &[&str]) -> Vec<EffortOption> {
    if ids.is_empty() {
        return Vec::new();
    }
    let mut options = Vec::with_capacity(ids.len() + 1);
    options.push(EffortOption {
        id: DEFAULT_OPTION_ID.to_string(),
        display_name: "Default".to_string(),
    });
    options.extend(ids.iter().map(|id| EffortOption {
        id: (*id).to_string(),
        display_name: effort_label(id).to_string(),
    }));
    options
}

fn effort_label(id: &str) -> &str {
    match id {
        "none" => "None",
        "low" => "Low",
        "medium" => "Medium",
        "high" => "High",
        "xhigh" => "Extra High",
        "max" => "Max",
        other => other,
    }
}

fn build_agent(def: &AgentDef) -> AgentOption {
    let agent_efforts = effort_options(def.efforts);

    // No synthetic `default` row: V1's picker lists real models and flags one of them. See the module
    // docs.
    let mut models: Vec<ModelOption> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for catalogue in def.catalogues {
        for row in catalogue.iter() {
            // Concatenated catalogues overlap — every one of them declares `claude-opus-5` — and V1
            // splices them with `DistinctBy(m => m.Id)`, first spelling wins.
            if !seen.insert(normalize_model_id(row.id)) {
                continue;
            }
            models.push(ModelOption {
                id: row.id.to_string(),
                display_name: row.display_name.to_string(),
                efforts: effort_options(def.efforts_for_row(Some(row))),
            });
        }
    }

    // No group order is supplied: `sort_models` then groups by a provider's first appearance in the
    // declared list, which is what V1's `ModelCatalogSorter` does to `GetStaticModels()`.
    sort_models(&mut models, &[], false);

    // `ModelCatalogSorter.Sort(preserveDefault: true)`: the `IsDefault` row is lifted out before the
    // sort and put back at the head, so "the default" and "the first row" are the same model.
    let default_model = match models
        .iter()
        .position(|model| normalize_model_id(&model.id) == normalize_model_id(def.default_model))
    {
        Some(index) => {
            let row = models.remove(index);
            let id = row.id.clone();
            models.insert(0, row);
            id
        }
        // Unreachable while `every_agents_default_is_one_of_its_own_models` passes; falling back to the
        // first row keeps the invariant "the default is a model this agent offers" true regardless.
        None => models
            .first()
            .map(|model| model.id.clone())
            .unwrap_or_default(),
    };

    AgentOption {
        id: def.id.to_string(),
        label: def.label.to_string(),
        icon: def.icon.to_string(),
        models,
        default_model,
        supports_effort: def.supports_effort(),
        efforts: agent_efforts,
    }
}

/// The model an agent launches with when nobody has chosen one — V1 `ChatApp.ResolveModel`'s
/// `GetStaticModels().FirstOrDefault(m => m.IsDefault)?.Id`, which is a real id rather than a sentinel.
///
/// This is the chat picker's rule. A *profile tier*'s default is a different question with a different
/// answer — `provider_models::select_defaults`, V1's `ModelProfileSelector` — because a tier is chosen
/// against the models an endpoint actually offers.
pub fn default_model_for(agent_id: &str) -> Option<String> {
    let def = find_agent_def(agent_id)?;
    Some(build_agent(def).default_model)
}

/// The full catalog, with the OpenAI proxy pointed wherever [`openai_proxy_def`]'s fallback says —
/// i.e. at OpenAI. Callers that know the configured `ANTHROPIC_BASE_URL` should use
/// [`all_agents_for_proxy_base_url`] so the proxy is labelled and populated for where it really
/// points.
pub fn all_agents() -> Vec<AgentOption> {
    all_agents_for_proxy_base_url(None)
}

/// [`all_agents`], with the `openaiproxy` row resolved against `proxy_base_url`.
pub fn all_agents_for_proxy_base_url(proxy_base_url: Option<&str>) -> Vec<AgentOption> {
    let mut agents: Vec<AgentOption> = AGENTS.iter().map(build_agent).collect();
    agents.push(build_agent(openai_proxy_def(proxy_base_url)));
    agents
}

/// Every row any provider declares, for the id-to-name lookup below.
static ALL_CATALOGUES: &[&[CatalogModel]] = &[
    CLAUDE_MODELS,
    CODEX_MODELS,
    COPILOT_MODELS,
    GEMINI_MODELS,
    ANTIGRAVITY_MODELS,
    OPENCODE_MODELS,
    BERGET_MODELS,
];

/// The name a declared row gives a model id, if any provider declares it.
///
/// This is V1's `allKnownLookup` in `FetchModelsDetailedAsync`, narrowed to the one field it is safe to
/// borrow: a model discovered live at an endpoint takes a *label* from the catalogue when the catalogue
/// knows the id, and nothing else. It does not become a catalogue row, so it carries no effort ladder
/// and no agent starts offering it.
pub fn declared_display_name(model_id: &str) -> Option<&'static str> {
    let wanted = normalize_model_id(model_id);
    ALL_CATALOGUES
        .iter()
        .flat_map(|catalogue| catalogue.iter())
        .find(|row| normalize_model_id(row.id) == wanted)
        .map(|row| row.display_name)
}

fn find_agent_def(agent_id: &str) -> Option<&'static AgentDef> {
    // The same aliases `build_agent_spec` dispatches on, plus V1's `NormalizeAgentName`.
    let id = match agent_id.to_ascii_lowercase().as_str() {
        "claudecode" => "claude".to_string(),
        "agy" => "antigravity".to_string(),
        "proxy" => OPENAI_PROXY_AGENT_ID.to_string(),
        other => other.to_string(),
    };
    if id == OPENAI_PROXY_AGENT_ID {
        return Some(openai_proxy_def(None));
    }
    // `ivy` is no longer *offered* (see `AGENTS`), but a `config.yaml` written before it was dropped
    // may still name it, and resolving nothing there would leave that install with no models and no
    // effort ladder. The Ivy proxy def carries the identical catalogues and ladder, differing only
    // in the label and icon that a configured agent never shows, so it answers for the old id.
    if id == "ivy" {
        return Some(&OPENAI_PROXY_IVY);
    }
    AGENTS.iter().find(|def| def.id == id)
}

/// The effort ladder an agent offers for one model — V1 `ChatApp.GetEffortsForAgentAndModel`.
///
/// The model's own ladder wins, then the agent's. `None` or `Some("default")` for `model_id` asks
/// for the agent's, because the provider's default model is not known here. An agent with no
/// `EffortControl` capability returns nothing at all, which is the same thing `supports_effort:
/// false` says on the wire.
pub fn efforts_for(agent_id: &str, model_id: Option<&str>) -> Vec<EffortOption> {
    let Some(def) = find_agent_def(agent_id) else {
        return Vec::new();
    };
    match model_id {
        Some(model) if !model.is_empty() && !model.eq_ignore_ascii_case(DEFAULT_OPTION_ID) => {
            effort_options(def.efforts_for_row(def.row(model)))
        }
        _ => effort_options(def.efforts),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model_sorting::ProviderGroup;
    use crate::agents::model_specs;
    use crate::agents::providers::{build_agent_spec, AgentLaunchConfig};

    fn agents() -> Vec<AgentOption> {
        all_agents()
    }

    fn agent(id: &str) -> AgentOption {
        agents()
            .into_iter()
            .find(|agent| agent.id == id)
            .unwrap_or_else(|| panic!("{id} should be in the catalog"))
    }

    /// An agent by id whether or not it is *listed*. `ivy` still resolves - an existing
    /// `config.yaml` may name it - but it is no longer offered, so `agent()` cannot find it.
    fn resolved(id: &str) -> AgentOption {
        build_agent(find_agent_def(id).unwrap_or_else(|| panic!("{id} should still resolve")))
    }

    fn model_ids(agent: &AgentOption) -> Vec<String> {
        agent.models.iter().map(|m| m.id.clone()).collect()
    }

    fn has(ids: &[String], id: &str) -> bool {
        ids.iter().any(|found| found == id)
    }

    fn effort_ids(efforts: &[EffortOption]) -> Vec<&str> {
        efforts.iter().map(|e| e.id.as_str()).collect()
    }

    /// The groups a model list actually draws on, `default` excluded.
    fn groups_of(agent: &AgentOption) -> Vec<ProviderGroup> {
        let mut groups: Vec<ProviderGroup> = Vec::new();
        for model in agent.models.iter() {
            let group = ProviderGroup::of(&model.id);
            if !groups.contains(&group) {
                groups.push(group);
            }
        }
        groups
    }

    /// V1 `AgentServiceCollectionExtensions.AddAgentInfrastructure` registers the providers in this
    /// order and `IAgentRunner.RegisteredAgents` preserves it, so this *is* the picker's order.
    #[test]
    fn agents_are_listed_in_v1s_registration_order() {
        assert_eq!(
            agents()
                .iter()
                .map(|agent| agent.id.clone())
                .collect::<Vec<_>>(),
            vec![
                "antigravity",
                "claude",
                "codex",
                "copilot",
                "gemini",
                "opencode",
                "openaiproxy",
            ]
        );
    }

    /// V1 `AgentBranding.IconFor`, whose names the webview's `BrandIcon` resolves.
    #[test]
    fn icons_are_v1s_brand_marks() {
        let icons: Vec<(String, String)> = agents()
            .iter()
            .map(|agent| (agent.id.clone(), agent.icon.clone()))
            .collect();
        assert_eq!(
            icons,
            vec![
                ("antigravity".to_string(), "Antigravity".to_string()),
                ("claude".to_string(), "ClaudeCode".to_string()),
                ("codex".to_string(), "OpenAI".to_string()),
                ("copilot".to_string(), "Copilot".to_string()),
                ("gemini".to_string(), "Gemini".to_string()),
                ("opencode".to_string(), "OpenCode".to_string()),
                ("openaiproxy".to_string(), "OpenAI".to_string()),
            ]
        );
    }

    /// V1 `IAgentCli.DisplayName` for each provider.
    #[test]
    fn labels_are_the_clis_own_display_names() {
        let labels: Vec<(String, String)> = agents()
            .iter()
            .map(|agent| (agent.id.clone(), agent.label.clone()))
            .collect();
        assert_eq!(
            labels,
            vec![
                ("antigravity".to_string(), "Antigravity".to_string()),
                ("claude".to_string(), "Claude Code".to_string()),
                ("codex".to_string(), "Codex".to_string()),
                ("copilot".to_string(), "Copilot".to_string()),
                ("gemini".to_string(), "Gemini".to_string()),
                ("opencode".to_string(), "OpenCode".to_string()),
                ("openaiproxy".to_string(), "OpenAI Proxy".to_string()),
            ]
        );
    }

    /// V1 `Abstractions/ModelCatalog.EffortLevels`, one assertion per ladder.
    #[test]
    fn every_effort_ladder_matches_v1() {
        let expected: &[(&str, &[&str])] = &[
            ("antigravity", &["default", "low", "medium", "high"]),
            (
                "claude",
                &["default", "low", "medium", "high", "xhigh", "max"],
            ),
            (
                "codex",
                &["default", "none", "low", "medium", "high", "xhigh"],
            ),
            ("copilot", &["default", "low", "medium", "high", "xhigh"]),
            ("gemini", &[]),
            (
                "opencode",
                &["default", "low", "medium", "high", "xhigh", "max"],
            ),
            (
                "openaiproxy",
                &["default", "low", "medium", "high", "xhigh", "max"],
            ),
        ];

        for (id, ladder) in expected {
            let agent = agent(id);
            assert_eq!(effort_ids(&agent.efforts), *ladder, "{id}'s effort ladder");
            assert_eq!(
                agent.supports_effort,
                !ladder.is_empty(),
                "{id}'s supportsEffort should follow whether it has a ladder"
            );
        }
    }

    /// The substantive divergence from V2's old shape: V1 attaches the ladder to the model row, so
    /// the same agent offers different ladders for different models.
    #[test]
    fn efforts_are_resolved_per_model_then_per_agent() {
        // V1 `CopilotModelCatalog`: its GPT rows carry `EffortLevels.Copilot`, its Claude rows
        // carry `EffortLevels.Claude` — five levels including `max`, which Copilot's own ladder
        // does not have.
        assert_eq!(
            effort_ids(&efforts_for("copilot", Some("claude-opus-5"))),
            vec!["default", "low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(
            effort_ids(&efforts_for("copilot", Some("gpt-5.4"))),
            vec!["default", "low", "medium", "high", "xhigh"]
        );

        // The Antigravity catalogue makes the same split between Gemini and Claude rows.
        assert_eq!(
            effort_ids(&efforts_for("antigravity", Some("gemini-3.7-flash"))),
            vec!["default", "low", "medium", "high"]
        );
        assert_eq!(
            effort_ids(&efforts_for("antigravity", Some("claude-sonnet-5"))),
            vec!["default", "low", "medium", "high", "xhigh", "max"]
        );

        // Ivy concatenates three catalogues, so it carries three ladders.
        assert_eq!(
            effort_ids(&efforts_for("ivy", Some("claude-opus-5"))),
            vec!["default", "low", "medium", "high", "xhigh", "max"]
        );
        assert_eq!(
            effort_ids(&efforts_for("ivy", Some("gemini-3.7-flash"))),
            vec!["default", "low", "medium", "high"]
        );
        assert_eq!(
            effort_ids(&efforts_for("ivy", Some("gpt-5.5"))),
            vec!["default", "none", "low", "medium", "high", "xhigh"]
        );

        // A row is matched the way `ModelSpecs.Find` matches, so a dotted id and a dashed one are
        // the same row rather than two.
        assert_eq!(
            efforts_for("codex", Some("gpt-5-6-sol")),
            efforts_for("codex", Some("gpt-5.6-sol"))
        );

        // `default` and an unknown model both fall back to the agent's own ladder.
        assert_eq!(
            effort_ids(&efforts_for("copilot", Some(DEFAULT_OPTION_ID))),
            effort_ids(&efforts_for("copilot", None))
        );
        assert_eq!(
            effort_ids(&efforts_for("copilot", Some("llama-4"))),
            vec!["default", "low", "medium", "high", "xhigh"]
        );

        // An agent with no effort control has nothing to offer for any model.
        assert!(efforts_for("gemini", Some("gemini-3.7-flash")).is_empty());
        assert!(efforts_for("nonesuch", None).is_empty());

        // V1 `NormalizeAgentName` and `build_agent_spec`'s aliases resolve to the same rows.
        assert_eq!(
            efforts_for("claudecode", Some("claude-opus-5")),
            efforts_for("claude", Some("claude-opus-5"))
        );
        assert_eq!(efforts_for("agy", None), efforts_for("antigravity", None));
        assert_eq!(efforts_for("proxy", None), efforts_for("openaiproxy", None));
    }

    /// Every model row carries the ladder [`efforts_for`] resolves for it, so a stateless client
    /// never has to ask.
    #[test]
    fn every_model_row_carries_its_own_resolved_ladder() {
        for agent in agents() {
            for model in &agent.models {
                let expected = if model.id == DEFAULT_OPTION_ID {
                    efforts_for(&agent.id, None)
                } else {
                    efforts_for(&agent.id, Some(&model.id))
                };
                assert_eq!(
                    model.efforts, expected,
                    "{}'s {} row should carry its resolved ladder",
                    agent.id, model.id
                );
            }
        }
    }

    /// **The synthetic `default` row is gone.** V1 lists real models and flags one of them; a row whose
    /// id is `default` named no model, and meant a different thing in each arm of the launcher.
    #[test]
    fn no_agents_model_list_contains_a_default_row() {
        for agent in agents() {
            assert!(
                !agent
                    .models
                    .iter()
                    .any(|model| model.id.eq_ignore_ascii_case(DEFAULT_OPTION_ID)),
                "{} still offers a synthetic default row: {:?}",
                agent.id,
                model_ids(&agent)
            );
        }
    }

    /// V1 `ChatApp.ResolveModel` + `ModelCatalogSorter.Sort(preserveDefault: true)`: the default is the
    /// `IsDefault` row, it is a real model the agent offers, and it is pinned first.
    #[test]
    fn every_agents_default_is_one_of_its_own_models_and_comes_first() {
        let expected: &[(&str, &str)] = &[
            ("antigravity", "gemini-3.8-flash"),
            ("claude", "claude-opus-5"),
            ("codex", "gpt-5.6-terra"),
            ("copilot", "gpt-5.4"),
            ("gemini", "gemini-3.8-flash"),
            ("opencode", "moonshotai/Kimi-K3"),
            ("openaiproxy", "gpt-5.6-terra"),
        ];

        for (id, default) in expected {
            let agent = agent(id);
            assert_eq!(&agent.default_model, default, "{id}'s default model");
            assert_eq!(
                agent.models.first().map(|model| model.id.as_str()),
                Some(*default),
                "{id} must list its default first"
            );
            assert_eq!(default_model_for(id).as_deref(), Some(*default));
            // A default nobody can be billed for is not a default.
            assert!(model_specs::find(default).is_some());
        }

        // Aliases resolve to the same row.
        assert_eq!(default_model_for("claudecode"), default_model_for("claude"));
        assert_eq!(default_model_for("agy"), default_model_for("antigravity"));
        assert_eq!(default_model_for("nonesuch"), None);
    }

    #[test]
    fn the_effort_default_is_left_alone() {
        // V1 really does offer "Default" as an effort (`GetEffortOptions` prepends it) and normalises it
        // to `""` on save, so the removal above is scoped to models.
        for agent in agents() {
            if agent.supports_effort {
                assert_eq!(
                    agent.efforts.first().map(|e| e.id.as_str()),
                    Some(DEFAULT_OPTION_ID),
                    "{} effort list must start with the default",
                    agent.id
                );
            } else {
                assert!(
                    agent.efforts.is_empty(),
                    "{} ignores effort, so it should list none",
                    agent.id
                );
            }
        }
    }

    #[test]
    fn every_agent_offers_models_beyond_the_default() {
        for agent in agents() {
            assert!(
                agent.models.len() > 1,
                "{} should offer models beyond the default",
                agent.id
            );
        }
    }

    #[test]
    fn no_model_is_listed_twice() {
        for agent in agents() {
            let mut seen: HashSet<String> = HashSet::new();
            for model in &agent.models {
                assert!(
                    seen.insert(normalize_model_id(&model.id)),
                    "{} lists {} twice",
                    agent.id,
                    model.id
                );
            }
        }
    }

    /// **The bug this file was rewritten for.** An agent must only offer models it can actually
    /// serve, and the only reason it ever offered another provider's was that provenance was being
    /// guessed from the id string. Each agent's admissible groups are the providers its V1
    /// catalogue declares — no more, and no fewer.
    #[test]
    fn no_agent_offers_a_model_from_a_provider_it_cannot_serve() {
        let expected: &[(&str, &[ProviderGroup])] = &[
            // V1 `AntigravityModelCatalog`: Gemini, Anthropic, and one open-weights OpenAI row.
            (
                "antigravity",
                &[
                    ProviderGroup::Google,
                    ProviderGroup::Anthropic,
                    ProviderGroup::OpenAi,
                ],
            ),
            // The Claude CLI serves Anthropic's models and nothing else.
            ("claude", &[ProviderGroup::Anthropic]),
            ("codex", &[ProviderGroup::OpenAi]),
            // V1 `CopilotModelCatalog`: Copilot really does serve both, so both are correct here.
            (
                "copilot",
                &[ProviderGroup::OpenAi, ProviderGroup::Anthropic],
            ),
            ("gemini", &[ProviderGroup::Google]),
            // V1 `OpenCodeModelCatalog`: Kimi, Anthropic, one OpenAI row.
            (
                "opencode",
                &[
                    ProviderGroup::Moonshot,
                    ProviderGroup::Anthropic,
                    ProviderGroup::OpenAi,
                ],
            ),
            ("openaiproxy", &[ProviderGroup::OpenAi]),
        ];

        for (id, allowed) in expected {
            let agent = agent(id);
            for model in agent.models.iter() {
                let group = ProviderGroup::of(&model.id);
                assert!(
                    allowed.contains(&group),
                    "{id} offers {} ({group:?}), which it cannot serve",
                    model.id
                );
            }
            for group in *allowed {
                assert!(
                    groups_of(&agent).contains(group),
                    "{id} should offer {group:?} models"
                );
            }
        }

        // The report that started this: picking Claude and being shown Gemini.
        let claude = model_ids(&agent("claude"));
        assert!(
            !claude.iter().any(|id| id.contains("gemini")),
            "the Claude row must offer no Gemini model"
        );
        assert!(
            claude
                .iter()
                .all(|id| ProviderGroup::of(id) == ProviderGroup::Anthropic),
            "the Claude row must offer no OpenAI model"
        );

        // ...and the two agents that legitimately span providers still do.
        let copilot = model_ids(&agent("copilot"));
        assert!(copilot.iter().any(|id| id.starts_with("gpt-")));
        assert!(copilot.iter().any(|id| id.starts_with("claude-")));
        let ivy = model_ids(&resolved("ivy"));
        assert!(ivy.iter().any(|id| id.starts_with("claude-")));
        assert!(ivy.iter().any(|id| id.starts_with("gemini-")));
        assert!(ivy.iter().any(|id| id.starts_with("gpt-")));
    }

    /// The other half of the promise the prefix filter was there to keep: a model the picker offers
    /// is a model V2 can cost. `find` is what the cost path calls, so this is that call.
    #[test]
    fn every_declared_model_carries_a_pricing_spec() {
        for agent in agents() {
            for model in agent.models.iter() {
                assert!(
                    model_specs::find(&model.id).is_some(),
                    "{}'s {} has no pricing spec",
                    agent.id,
                    model.id
                );
            }
        }
    }

    #[test]
    fn each_agents_catalogue_is_the_one_its_provider_declares() {
        let claude = agent("claude");
        let claude_ids = model_ids(&claude);
        assert!(has(&claude_ids, "claude-opus-5"));
        assert!(has(&claude_ids, "sonnet"));
        assert!(!claude_ids.iter().any(|id| id.starts_with("gpt-")));

        let codex = agent("codex");
        let codex_ids = model_ids(&codex);
        assert!(has(&codex_ids, "gpt-5.5"));
        assert!(has(&codex_ids, "o4-mini"));
        assert!(has(&codex_ids, "codex-mini"));
        assert!(!codex_ids.iter().any(|id| id.contains("claude")));

        let gemini = agent("gemini");
        assert!(gemini.models.iter().all(|m| m.id.starts_with("gemini-")));

        // V1 `CopilotModelCatalog`: GPT and Claude, and nothing else.
        let copilot = agent("copilot");
        assert!(copilot.models.iter().all(|m| matches!(
            ProviderGroup::of(&m.id),
            ProviderGroup::OpenAi | ProviderGroup::Anthropic
        )));
        assert!(!model_ids(&copilot)
            .iter()
            .any(|id| id.starts_with("gemini-")));

        // V1 `IvyModelCatalog` = Claude + Gemini + Codex.
        let ivy = resolved("ivy");
        let ivy_ids = model_ids(&ivy);
        assert!(has(&ivy_ids, "claude-opus-5"));
        assert!(has(&ivy_ids, "gemini-3.7-flash"));
        assert!(has(&ivy_ids, "gpt-5.5"));

        // V1 `AntigravityModelCatalog`: Gemini and Claude, plus its one open-weights row.
        let antigravity = agent("antigravity");
        let antigravity_ids = model_ids(&antigravity);
        assert!(has(&antigravity_ids, "gemini-3.7-flash"));
        assert!(has(&antigravity_ids, "claude-opus-5"));
        assert!(has(&antigravity_ids, "gpt-oss-120b"));

        // V1 `OpenCodeModelCatalog`: Kimi in the format the OpenCode CLI accepts.
        assert!(has(&model_ids(&agent("opencode")), "moonshotai/Kimi-K3"));
    }

    /// The tier defaults `resolution.rs` falls back to have to be models the picker offers, or the
    /// pane names a model in its placeholder that its own select cannot select.
    ///
    /// `default` is the exception, and deliberately so: as a *config* value it means "no opinion", which
    /// `is_set` reads as unset and the launcher answers by passing no `--model` at all. That is a
    /// different thing from a model, which is why it is no longer offered as one.
    #[test]
    fn every_tier_default_is_a_model_its_agent_offers() {
        for agent_id in [
            "claude",
            "codex",
            "gemini",
            "antigravity",
            "opencode",
            "copilot",
        ] {
            let offered = model_ids(&agent(agent_id));
            for tier in crate::agents::resolution::default_profiles(agent_id) {
                let Some(model) = tier.model else { continue };
                if model.eq_ignore_ascii_case(DEFAULT_OPTION_ID) {
                    assert!(
                        !crate::agents::resolution::is_set(model),
                        "`default` must keep reading as unset"
                    );
                    continue;
                }
                assert!(
                    offered
                        .iter()
                        .any(|id| normalize_model_id(id) == normalize_model_id(model)),
                    "{agent_id}'s {} tier defaults to {model}, which it does not offer",
                    tier.tier
                );
            }
        }
    }

    /// V1's `ModelCatalogSorter`, applied to a real catalogue rather than a fixture: the `IsDefault` row
    /// pinned at the head, then newest first within a family, families in the order the agent's own
    /// catalogue declares them.
    #[test]
    fn models_are_sorted_the_way_v1_sorts_them() {
        let claude = model_ids(&agent("claude"));
        // The pinned default leads; everything after it is in the sorter's order.
        assert_eq!(claude[0], CLAUDE_DEFAULT);
        let rest = &claude[1..];
        // Opus before Sonnet before Haiku, and 5.1 before 5 inside a tier.
        let position = |id: &str| rest.iter().position(|found| *found == id).unwrap();
        assert!(position("claude-fable-5-1") < position("claude-opus-5-1"));
        assert!(position("claude-opus-5-1") < position("claude-opus-4-8"));
        assert!(position("claude-opus-4-8") < position("claude-sonnet-5-1"));
        assert!(position("claude-sonnet-5-1") < position("claude-haiku-5-1"));
        // The bare aliases carry no version, so they trail their tier.
        assert!(position("claude-opus-4-6") < position("opus"));

        // Copilot leads with OpenAI because that is what its own catalogue declares first, even
        // though Anthropic outranks OpenAI inside a group.
        let copilot = model_ids(&agent("copilot"));
        assert_eq!(
            copilot.first().map(|id| ProviderGroup::of(id)),
            Some(ProviderGroup::OpenAi)
        );
        let first_anthropic = copilot
            .iter()
            .position(|id| ProviderGroup::of(id) == ProviderGroup::Anthropic)
            .unwrap();
        let last_openai = copilot
            .iter()
            .rposition(|id| ProviderGroup::of(id) == ProviderGroup::OpenAi)
            .unwrap();
        assert!(last_openai < first_anthropic);

        // Antigravity leads with Google for the same reason.
        let antigravity = model_ids(&agent("antigravity"));
        assert_eq!(ProviderGroup::of(&antigravity[1]), ProviderGroup::Google);

        // Ivy leads with Anthropic, which is the catalogue it concatenates first.
        let ivy = model_ids(&resolved("ivy"));
        assert_eq!(ProviderGroup::of(&ivy[1]), ProviderGroup::Anthropic);
    }

    /// V1 `OpenAiProxyModelCatalog.GetModelsForBaseUrl` + `AgentBranding.For`.
    #[test]
    fn the_proxy_follows_the_base_url_it_points_at() {
        let proxy = |base_url: Option<&str>| {
            all_agents_for_proxy_base_url(base_url)
                .into_iter()
                .find(|agent| agent.id == OPENAI_PROXY_AGENT_ID)
                .expect("the proxy should always be listed")
        };

        let anthropic = proxy(Some("https://api.anthropic.com"));
        assert_eq!(anthropic.label, "Anthropic");
        assert_eq!(anthropic.icon, "ClaudeCode");
        assert!(anthropic
            .models
            .iter()
            .all(|m| ProviderGroup::of(&m.id) == ProviderGroup::Anthropic));
        // V1 hands the proxy Claude's own catalogue, so the two lists are the same models.
        assert_eq!(model_ids(&anthropic), model_ids(&agent("claude")));

        let berget = proxy(Some("https://api.berget.ai/v1"));
        assert_eq!(berget.label, "Berget AI");
        assert_eq!(berget.icon, "ChevronUp");
        assert!(model_ids(&berget)
            .iter()
            .any(|id| id.to_ascii_lowercase().contains("qwen")));

        let ivy = proxy(Some("https://llmproxy.ivy.app"));
        assert_eq!(ivy.label, "OpenAI Proxy");
        assert_eq!(model_ids(&ivy), model_ids(&resolved("ivy")));

        let google = proxy(Some("https://generativelanguage.googleapis.com"));
        assert!(google.models.iter().all(|m| m.id.starts_with("gemini-")));
        assert_eq!(
            effort_ids(&google.models[1].efforts),
            vec!["default", "low", "medium", "high"]
        );

        // No base URL, OpenAI's own, and an unrecognised one: OpenAI models, then V1's declared
        // union of the catalogues it knows — never every model in existence.
        let openai = proxy(None);
        assert_eq!(openai.label, "OpenAI Proxy");
        assert!(openai
            .models
            .iter()
            .all(|m| ProviderGroup::of(&m.id) == ProviderGroup::OpenAi));
        assert_eq!(
            model_ids(&proxy(Some("https://api.openai.com/v1"))),
            model_ids(&openai)
        );

        let custom = proxy(Some("http://localhost:11434/v1"));
        assert!(custom.models.len() > openai.models.len());
        assert_eq!(
            groups_of(&custom),
            vec![
                ProviderGroup::OpenAi,
                ProviderGroup::Anthropic,
                ProviderGroup::Google,
                ProviderGroup::Moonshot
            ]
        );
    }

    /// Every advertised effort must be one the provider's own arm recognises. The mapping is lossy
    /// on purpose — V1's `CodexCli` sends `xhigh` for both `xhigh` and `max`, its `OpenCodeCli`
    /// sends `max` for both, and `none` reaches neither CLI as a level of its own — so this pins the
    /// argument each level actually produces rather than asserting it survives verbatim.
    #[test]
    fn advertised_efforts_map_onto_the_arguments_v1_sends() {
        let arg_for = |agent_id: &str, model: &str, effort: &str| {
            let config = AgentLaunchConfig {
                prompt: "hi".to_string(),
                model: Some(model.to_string()),
                effort: Some(effort.to_string()),
                ..Default::default()
            };
            build_agent_spec(agent_id, &config).args.join(" ")
        };

        // Claude passes its whole ladder through untouched.
        for level in ["low", "medium", "high", "xhigh", "max"] {
            assert!(
                arg_for("claude", "claude-opus-5", level).contains(&format!("--effort {level}")),
                "claude should send --effort {level}"
            );
        }

        // Codex: `none` has no reasoning level of its own, and `max` is `xhigh`.
        for (level, sent) in [
            ("none", "medium"),
            ("low", "low"),
            ("medium", "medium"),
            ("high", "high"),
            ("xhigh", "xhigh"),
        ] {
            assert!(
                arg_for("codex", "gpt-5.5", level)
                    .contains(&format!("model_reasoning_effort=\"{sent}\"")),
                "codex should send model_reasoning_effort={sent} for {level}"
            );
        }

        // OpenCode (and the ivy / openaiproxy wrappers around it) collapse `xhigh` onto `max`.
        for agent_id in ["opencode", "ivy", "openaiproxy"] {
            for (level, sent) in [
                ("low", "low"),
                ("medium", "medium"),
                ("high", "high"),
                ("xhigh", "max"),
                ("max", "max"),
            ] {
                assert!(
                    arg_for(agent_id, "claude-opus-5", level)
                        .contains(&format!("--variant {sent}")),
                    "{agent_id} should send --variant {sent} for {level}"
                );
            }
        }

        // Copilot's own four pass through; a Claude model's extra `max` collapses onto `xhigh`.
        for (level, sent) in [
            ("low", "low"),
            ("medium", "medium"),
            ("high", "high"),
            ("xhigh", "xhigh"),
            ("max", "xhigh"),
        ] {
            assert!(
                arg_for("copilot", "gpt-5.4", level).contains(&format!("--effort {sent}")),
                "copilot should send --effort {sent} for {level}"
            );
        }

        // Antigravity has three levels, and only emits them alongside a model.
        for (level, sent) in [("low", "low"), ("medium", "medium"), ("high", "high")] {
            assert!(
                arg_for("antigravity", "gemini-3.7-flash", level)
                    .contains(&format!("--effort {sent}")),
                "antigravity should send --effort {sent} for {level}"
            );
        }
    }

    /// Every catalog id must hit its own `build_agent_spec` arm rather than falling through to the
    /// claude default.
    #[test]
    fn every_agent_id_has_its_own_build_agent_spec_arm() {
        let config = AgentLaunchConfig {
            prompt: "hi".to_string(),
            ..Default::default()
        };
        let claude_command = build_agent_spec("claude", &config).command;
        assert_eq!(claude_command, "claude");

        for agent in agents() {
            let command = build_agent_spec(&agent.id, &config).command;
            if agent.id == "claude" {
                assert_eq!(command, claude_command);
            } else {
                assert_ne!(
                    command, claude_command,
                    "{} fell through to the claude arm",
                    agent.id
                );
            }
        }
    }

    /// The picker's ids are launched verbatim, so a dead id would be a broken row. These are the
    /// current Claude models; V1's `claude-fable-5` and `claude-5.1` are deliberately absent.
    #[test]
    fn the_claude_row_offers_the_current_models_and_no_retired_ones() {
        let ids = model_ids(&agent("claude"));
        for current in [
            "claude-opus-5",
            "claude-sonnet-5",
            "claude-fable-5-1",
            "claude-haiku-4-5",
        ] {
            assert!(has(&ids, current), "{current} should be offered");
        }
        for retired in ["claude-fable-5", "claude-5.1"] {
            assert!(!has(&ids, retired), "{retired} should not be offered");
        }
    }
}
