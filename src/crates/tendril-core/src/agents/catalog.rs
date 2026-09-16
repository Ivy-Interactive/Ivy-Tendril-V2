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
//! Two things are deliberately not V1:
//!
//! * **The model set.** V1 declares each agent's models by hand; V2 derives them from
//!   [`crate::agents::model_specs::all_specs`] filtered by family, so the ids the picker offers and
//!   the ids that carry pricing can never drift. V1's dead ids (`claude-fable-5`, `claude-5.1`) are
//!   not resurrected.
//! * **`IsDefault`.** V1 flags one row per catalogue as the provider's default and pins it first.
//!   V2 instead prepends a synthetic `default` row to every list, which is the same promise
//!   ("whatever the provider defaults to") without a second source of truth for what that is.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::model_sorting::{sort_models, ProviderGroup, SortableModel};
use super::model_specs::{all_specs, normalize_model_id, ModelSpec};

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
    pub supports_effort: bool,
    /// The ladder for a model that carries none of its own, and for `default`. V1's
    /// `IAgentDescriptor.SupportedEfforts`.
    pub efforts: Vec<EffortOption>,
}

/// The id every model and effort list starts with: "whatever the provider defaults to".
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
/// V1's `EffortLevels.Ivy` is `EffortLevels.OpenCode`'s list, and `IvyCli` wraps `OpenCodeCli`, so
/// the two are the same ladder rather than a coincidence.
const IVY_EFFORTS: &[&str] = OPENCODE_EFFORTS;

// ---------------------------------------------------------------------------
// Model families
// ---------------------------------------------------------------------------

/// How a model id is matched to a family. `Prefix` covers families (`claude-*`) and `Exact` the
/// handful of ids that carry no family prefix (`o1`, `opus`).
enum ModelPattern {
    Prefix(&'static str),
    Exact(&'static str),
}

/// One provider's models, and the group they sort and take their effort ladder from.
struct ModelFamily {
    group: ProviderGroup,
    patterns: &'static [ModelPattern],
}

static ANTHROPIC: ModelFamily = ModelFamily {
    group: ProviderGroup::Anthropic,
    patterns: &[
        ModelPattern::Prefix("claude-"),
        // The Claude CLI's own aliases for "the current model of this tier".
        ModelPattern::Exact("opus"),
        ModelPattern::Exact("sonnet"),
        ModelPattern::Exact("haiku"),
    ],
};

static OPENAI: ModelFamily = ModelFamily {
    group: ProviderGroup::OpenAi,
    patterns: &[
        ModelPattern::Prefix("gpt-"),
        ModelPattern::Exact("o1"),
        ModelPattern::Prefix("o3"),
        ModelPattern::Prefix("o4-"),
        ModelPattern::Exact("codex-mini"),
    ],
};

static GOOGLE: ModelFamily = ModelFamily {
    group: ProviderGroup::Google,
    patterns: &[ModelPattern::Prefix("gemini-")],
};

static MOONSHOT: ModelFamily = ModelFamily {
    group: ProviderGroup::Moonshot,
    patterns: &[
        ModelPattern::Prefix("kimi"),
        ModelPattern::Prefix("moonshot"),
    ],
};

static DEEPSEEK: ModelFamily = ModelFamily {
    group: ProviderGroup::DeepSeek,
    patterns: &[ModelPattern::Prefix("deepseek")],
};

static QWEN: ModelFamily = ModelFamily {
    group: ProviderGroup::Qwen,
    patterns: &[ModelPattern::Prefix("qwen")],
};

/// Which models an agent offers. `Families` lists them in the order V1's own catalogue for that
/// agent declares its providers, which is the order the picker groups them in; `Any` is the proxy
/// pointed at a base URL nobody recognises, V1's "unified list" case.
enum ModelFilter {
    Any,
    Families(&'static [&'static ModelFamily]),
}

struct AgentDef {
    id: &'static str,
    /// V1 `IAgentCli.DisplayName`.
    label: &'static str,
    /// V1 `AgentBranding.IconFor`.
    icon: &'static str,
    models: ModelFilter,
    /// The ladder this agent's V1 catalogue attaches to a model of the given family. A family the
    /// table omits falls back to `efforts`.
    family_efforts: &'static [(ProviderGroup, &'static [&'static str])],
    /// V1 `IAgentDescriptor.SupportedEfforts`, the ladder for `default` and for anything
    /// `family_efforts` does not cover. Empty means the provider has no `EffortControl` capability
    /// and the picker hides the control.
    efforts: &'static [&'static str],
}

/// Declared in V1's registration order, which is the order the picker lists them.
/// `openaiproxy` is appended by [`all_agents_for_proxy_base_url`], because what it offers depends on
/// where it points.
static AGENTS: &[AgentDef] = &[
    AgentDef {
        id: "antigravity",
        label: "Antigravity",
        icon: "Antigravity",
        models: ModelFilter::Families(&[&GOOGLE, &ANTHROPIC]),
        family_efforts: &[
            (ProviderGroup::Google, ANTIGRAVITY_EFFORTS),
            (ProviderGroup::Anthropic, CLAUDE_EFFORTS),
        ],
        efforts: ANTIGRAVITY_EFFORTS,
    },
    AgentDef {
        id: "claude",
        label: "Claude Code",
        icon: "ClaudeCode",
        models: ModelFilter::Families(&[&ANTHROPIC]),
        family_efforts: &[(ProviderGroup::Anthropic, CLAUDE_EFFORTS)],
        efforts: CLAUDE_EFFORTS,
    },
    AgentDef {
        id: "codex",
        label: "Codex",
        icon: "OpenAI",
        models: ModelFilter::Families(&[&OPENAI]),
        family_efforts: &[(ProviderGroup::OpenAi, CODEX_EFFORTS)],
        efforts: CODEX_EFFORTS,
    },
    AgentDef {
        id: "copilot",
        label: "Copilot",
        icon: "Copilot",
        models: ModelFilter::Families(&[&OPENAI, &ANTHROPIC]),
        family_efforts: &[
            (ProviderGroup::OpenAi, COPILOT_EFFORTS),
            (ProviderGroup::Anthropic, CLAUDE_EFFORTS),
        ],
        efforts: COPILOT_EFFORTS,
    },
    AgentDef {
        id: "gemini",
        label: "Gemini",
        icon: "Gemini",
        models: ModelFilter::Families(&[&GOOGLE]),
        // `GeminiCli.Capabilities` is the one that omits `EffortControl`, so the Gemini agent takes
        // no effort argument at all. The ladder still exists for Gemini models reached through a
        // proxy that does — see `IVY_FAMILY_EFFORTS`.
        family_efforts: &[],
        efforts: &[],
    },
    AgentDef {
        id: "opencode",
        label: "OpenCode",
        icon: "OpenCode",
        models: ModelFilter::Families(&[&MOONSHOT, &ANTHROPIC, &OPENAI, &DEEPSEEK, &QWEN]),
        family_efforts: &[(ProviderGroup::Anthropic, CLAUDE_EFFORTS)],
        efforts: OPENCODE_EFFORTS,
    },
    AgentDef {
        id: "ivy",
        label: "Ivy Agent",
        icon: "IvyCorner",
        models: ModelFilter::Families(IVY_FAMILIES),
        family_efforts: IVY_FAMILY_EFFORTS,
        efforts: IVY_EFFORTS,
    },
];

/// V1's `IvyModelCatalog` concatenates the Claude, Gemini and Codex catalogues in that order, so the
/// Ivy proxy offers all three families and each model keeps the ladder of the catalogue it came
/// from — including Gemini's, which the Gemini agent itself cannot use.
static IVY_FAMILIES: &[&ModelFamily] = &[&ANTHROPIC, &GOOGLE, &OPENAI];
static IVY_FAMILY_EFFORTS: &[(ProviderGroup, &[&str])] = &[
    (ProviderGroup::Anthropic, CLAUDE_EFFORTS),
    (ProviderGroup::Google, GEMINI_EFFORTS),
    (ProviderGroup::OpenAi, CODEX_EFFORTS),
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
    models: ModelFilter::Families(IVY_FAMILIES),
    family_efforts: IVY_FAMILY_EFFORTS,
    efforts: OPENCODE_EFFORTS,
};

/// Berget's endpoint is the one V1 relabels outright, because the user picked a provider rather than
/// a proxy.
static OPENAI_PROXY_BERGET: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "Berget AI",
    icon: "ChevronUp",
    models: ModelFilter::Families(&[&MOONSHOT, &ANTHROPIC, &OPENAI, &QWEN, &DEEPSEEK]),
    family_efforts: &[(ProviderGroup::Anthropic, CLAUDE_EFFORTS)],
    efforts: OPENCODE_EFFORTS,
};

static OPENAI_PROXY_ANTHROPIC: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "Anthropic",
    icon: "ClaudeCode",
    models: ModelFilter::Families(&[&ANTHROPIC]),
    family_efforts: &[(ProviderGroup::Anthropic, CLAUDE_EFFORTS)],
    efforts: OPENCODE_EFFORTS,
};

static OPENAI_PROXY_GOOGLE: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "OpenAI Proxy",
    icon: "OpenAI",
    models: ModelFilter::Families(&[&GOOGLE]),
    family_efforts: &[(ProviderGroup::Google, GEMINI_EFFORTS)],
    efforts: OPENCODE_EFFORTS,
};

static OPENAI_PROXY_OPENAI: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "OpenAI Proxy",
    icon: "OpenAI",
    models: ModelFilter::Families(&[&OPENAI]),
    family_efforts: &[(ProviderGroup::OpenAi, CODEX_EFFORTS)],
    efforts: OPENCODE_EFFORTS,
};

static OPENAI_PROXY_CUSTOM: AgentDef = AgentDef {
    id: OPENAI_PROXY_AGENT_ID,
    label: "OpenAI Proxy",
    icon: "OpenAI",
    models: ModelFilter::Any,
    family_efforts: IVY_FAMILY_EFFORTS,
    efforts: OPENCODE_EFFORTS,
};

// ---------------------------------------------------------------------------
// Building the catalog
// ---------------------------------------------------------------------------

impl ModelFamily {
    fn accepts(&self, model_id: &str) -> bool {
        self.patterns.iter().any(|pattern| match pattern {
            ModelPattern::Prefix(prefix) => model_id.starts_with(prefix),
            ModelPattern::Exact(id) => model_id == *id,
        })
    }
}

impl ModelFilter {
    fn accepts(&self, model_id: &str) -> bool {
        match self {
            Self::Any => true,
            Self::Families(families) => families.iter().any(|family| family.accepts(model_id)),
        }
    }

    /// The provider groups in declaration order, which is the order the picker groups models in.
    fn group_order(&self) -> Vec<ProviderGroup> {
        match self {
            Self::Any => Vec::new(),
            Self::Families(families) => families.iter().map(|family| family.group).collect(),
        }
    }
}

impl AgentDef {
    fn supports_effort(&self) -> bool {
        !self.efforts.is_empty()
    }

    /// V1's per-model `SupportedEfforts`, which each provider's catalogue sets per row.
    fn efforts_for_model(&self, model_id: &str) -> &'static [&'static str] {
        if !self.supports_effort() {
            return &[];
        }
        let group = ProviderGroup::of(model_id);
        self.family_efforts
            .iter()
            .find(|(family, _)| *family == group)
            .map(|(_, efforts)| *efforts)
            .unwrap_or(self.efforts)
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

fn build_agent(def: &AgentDef, specs: &[ModelSpec]) -> AgentOption {
    let agent_efforts = effort_options(def.efforts);

    let mut models = vec![ModelOption {
        id: DEFAULT_OPTION_ID.to_string(),
        display_name: "Default".to_string(),
        efforts: agent_efforts.clone(),
    }];

    let mut seen: HashSet<String> = HashSet::new();
    seen.insert(DEFAULT_OPTION_ID.to_string());
    for spec in specs {
        let model_id = spec.model_id.as_ref();
        if !def.models.accepts(model_id) {
            continue;
        }
        // The dynamic spec registry can carry the same model under two spellings; the picker must
        // list it once.
        if !seen.insert(normalize_model_id(model_id)) {
            continue;
        }
        models.push(ModelOption {
            id: model_id.to_string(),
            display_name: spec.display_name.to_string(),
            efforts: effort_options(def.efforts_for_model(model_id)),
        });
    }

    sort_models(&mut models, &def.models.group_order(), true);

    AgentOption {
        id: def.id.to_string(),
        label: def.label.to_string(),
        icon: def.icon.to_string(),
        models,
        supports_effort: def.supports_effort(),
        efforts: agent_efforts,
    }
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
    let specs = all_specs();
    let mut agents: Vec<AgentOption> = AGENTS.iter().map(|def| build_agent(def, &specs)).collect();
    agents.push(build_agent(openai_proxy_def(proxy_base_url), &specs));
    agents
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
            effort_options(def.efforts_for_model(model))
        }
        _ => effort_options(def.efforts),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn model_ids(agent: &AgentOption) -> Vec<String> {
        agent.models.iter().map(|m| m.id.clone()).collect()
    }

    fn has(ids: &[String], id: &str) -> bool {
        ids.iter().any(|found| found == id)
    }

    fn effort_ids(efforts: &[EffortOption]) -> Vec<&str> {
        efforts.iter().map(|e| e.id.as_str()).collect()
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
                "ivy",
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
                ("ivy".to_string(), "IvyCorner".to_string()),
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
                ("ivy".to_string(), "Ivy Agent".to_string()),
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
            ("ivy", &["default", "low", "medium", "high", "xhigh", "max"]),
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

    #[test]
    fn default_is_first_in_every_model_and_effort_list() {
        for agent in agents() {
            assert_eq!(
                agent.models.first().map(|m| m.id.as_str()),
                Some(DEFAULT_OPTION_ID),
                "{} model list must start with the default",
                agent.id
            );
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
    fn model_filters_keep_each_family_with_the_agents_that_can_reach_it() {
        let claude = agent("claude");
        let claude_ids = model_ids(&claude);
        assert!(has(&claude_ids, "claude-opus-5"));
        assert!(has(&claude_ids, "sonnet"));
        assert!(!claude_ids.iter().any(|id| id.starts_with("gpt-")));

        let codex = agent("codex");
        let codex_ids = model_ids(&codex);
        assert!(has(&codex_ids, "gpt-5.5"));
        assert!(has(&codex_ids, "o3-mini"));
        assert!(has(&codex_ids, "codex-mini"));
        assert!(!codex_ids.iter().any(|id| id.contains("claude")));

        let gemini = agent("gemini");
        assert!(gemini
            .models
            .iter()
            .skip(1)
            .all(|m| m.id.starts_with("gemini-")));

        // V1 `CopilotModelCatalog`: GPT and Claude, and nothing else.
        let copilot = agent("copilot");
        assert!(copilot.models.iter().skip(1).all(|m| matches!(
            ProviderGroup::of(&m.id),
            ProviderGroup::OpenAi | ProviderGroup::Anthropic
        )));
        assert!(!model_ids(&copilot)
            .iter()
            .any(|id| id.starts_with("gemini-")));

        // V1 `IvyModelCatalog` = Claude + Gemini + Codex.
        let ivy = agent("ivy");
        let ivy_ids = model_ids(&ivy);
        assert!(has(&ivy_ids, "claude-opus-5"));
        assert!(has(&ivy_ids, "gemini-3.7-flash"));
        assert!(has(&ivy_ids, "gpt-5.5"));

        // V1 `AntigravityModelCatalog`: Gemini and Claude.
        let antigravity = agent("antigravity");
        assert!(antigravity
            .models
            .iter()
            .skip(1)
            .all(|m| m.id.starts_with("gemini-")
                || ProviderGroup::of(&m.id) == ProviderGroup::Anthropic));
    }

    /// V1's `ModelCatalogSorter`, applied to a real catalogue rather than a fixture: newest first
    /// within a family, families in the order the agent's own catalogue declares them, `default`
    /// pinned at the head.
    #[test]
    fn models_are_sorted_the_way_v1_sorts_them() {
        let claude = model_ids(&agent("claude"));
        assert_eq!(claude[0], DEFAULT_OPTION_ID);
        // Opus before Sonnet before Haiku, and 5.1 before 5 inside a tier.
        let position = |id: &str| claude.iter().position(|found| *found == id).unwrap();
        assert!(position("claude-opus-5-1") < position("claude-opus-5"));
        assert!(position("claude-opus-5") < position("claude-sonnet-5"));
        assert!(position("claude-sonnet-5") < position("claude-haiku-5-1"));
        // The bare aliases carry no version, so they trail their tier.
        assert!(position("claude-opus-4") < position("opus"));

        // Copilot leads with OpenAI because that is what its own catalogue declares first, even
        // though Anthropic outranks OpenAI inside a group.
        let copilot = model_ids(&agent("copilot"));
        assert_eq!(
            copilot[1..].first().map(|id| ProviderGroup::of(id)),
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
        let ivy = model_ids(&agent("ivy"));
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
            .skip(1)
            .all(|m| ProviderGroup::of(&m.id) == ProviderGroup::Anthropic));

        let berget = proxy(Some("https://api.berget.ai/v1"));
        assert_eq!(berget.label, "Berget AI");
        assert_eq!(berget.icon, "ChevronUp");
        assert!(model_ids(&berget).iter().any(|id| id.contains("qwen")));

        let ivy = proxy(Some("https://llmproxy.ivy.app"));
        assert_eq!(ivy.label, "OpenAI Proxy");
        assert_eq!(model_ids(&ivy), model_ids(&agent("ivy")));

        let google = proxy(Some("https://generativelanguage.googleapis.com"));
        assert!(google
            .models
            .iter()
            .skip(1)
            .all(|m| m.id.starts_with("gemini-")));
        assert_eq!(
            effort_ids(&google.models[1].efforts),
            vec!["default", "low", "medium", "high"]
        );

        // No base URL, OpenAI's own, and an unrecognised one: OpenAI models, then everything.
        let openai = proxy(None);
        assert_eq!(openai.label, "OpenAI Proxy");
        assert!(openai
            .models
            .iter()
            .skip(1)
            .all(|m| ProviderGroup::of(&m.id) == ProviderGroup::OpenAi));
        assert_eq!(
            model_ids(&proxy(Some("https://api.openai.com/v1"))),
            model_ids(&openai)
        );

        let custom = proxy(Some("http://localhost:11434/v1"));
        assert!(custom.models.len() > openai.models.len());
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
            "claude-haiku-4-5-20251001",
        ] {
            assert!(has(&ids, current), "{current} should be offered");
        }
        for retired in ["claude-fable-5", "claude-5.1"] {
            assert!(!has(&ids, retired), "{retired} should not be offered");
        }
    }
}
