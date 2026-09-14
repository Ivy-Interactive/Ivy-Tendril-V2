//! The agent / model / effort catalog the UI populates its picker from.
//!
//! Everything here is derived from what [`crate::agents::providers::build_agent_spec`] actually
//! accepts: the agent ids are its match arms, the effort ids are the arms of each provider's own
//! effort mapping, and the models are [`crate::agents::model_specs::all_specs`] filtered by an
//! id-prefix table. Every model and effort list starts with a synthetic `default` entry, which is
//! the floor a caller gets when a provider takes no `--model` / `--effort` at all.

use serde::{Deserialize, Serialize};

use super::model_specs::all_specs;

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
}

/// A coding agent, with the models and efforts it can be launched with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOption {
    pub id: String,
    pub label: String,
    pub models: Vec<ModelOption>,
    pub supports_effort: bool,
    pub efforts: Vec<EffortOption>,
}

/// The id every model and effort list starts with: "whatever the provider defaults to".
pub const DEFAULT_OPTION_ID: &str = "default";

/// How a model id is matched to an agent. `Prefix` covers families (`claude-*`), `Exact` the
/// handful of ids that carry no family prefix (`o1`, `opus`), and `Any` the proxying agents that
/// can reach every provider.
enum ModelFilter {
    Any,
    Patterns(&'static [ModelPattern]),
    None,
}

enum ModelPattern {
    Prefix(&'static str),
    Exact(&'static str),
}

struct AgentDef {
    id: &'static str,
    label: &'static str,
    models: ModelFilter,
    /// The effort ids this agent's `build_agent_spec` arm maps to themselves. Empty means the
    /// provider ignores `effort` entirely.
    efforts: &'static [&'static str],
}

const CLAUDE_MODELS: &[ModelPattern] = &[
    ModelPattern::Prefix("claude-"),
    ModelPattern::Exact("opus"),
    ModelPattern::Exact("sonnet"),
    ModelPattern::Exact("haiku"),
];

const CODEX_MODELS: &[ModelPattern] = &[
    ModelPattern::Prefix("gpt-"),
    ModelPattern::Exact("o1"),
    ModelPattern::Prefix("o3"),
    ModelPattern::Prefix("o4-"),
    ModelPattern::Exact("codex-mini"),
];

const GEMINI_MODELS: &[ModelPattern] = &[ModelPattern::Prefix("gemini-")];

const ANTIGRAVITY_MODELS: &[ModelPattern] =
    &[ModelPattern::Prefix("gemini-"), ModelPattern::Prefix("claude-")];

/// Declared in the order the picker lists them.
const AGENTS: &[AgentDef] = &[
    AgentDef {
        id: "claude",
        label: "Claude",
        models: ModelFilter::Patterns(CLAUDE_MODELS),
        efforts: &["low", "medium", "high", "xhigh", "max"],
    },
    AgentDef {
        id: "codex",
        label: "Codex",
        models: ModelFilter::Patterns(CODEX_MODELS),
        efforts: &["low", "medium", "high", "xhigh"],
    },
    AgentDef {
        id: "gemini",
        label: "Gemini",
        models: ModelFilter::Patterns(GEMINI_MODELS),
        efforts: &[],
    },
    AgentDef {
        id: "opencode",
        label: "OpenCode",
        models: ModelFilter::Any,
        efforts: &["low", "medium", "high", "max"],
    },
    AgentDef {
        id: "copilot",
        label: "Copilot",
        models: ModelFilter::Any,
        efforts: &["low", "medium", "high", "xhigh"],
    },
    AgentDef {
        id: "antigravity",
        label: "Antigravity",
        models: ModelFilter::Patterns(ANTIGRAVITY_MODELS),
        efforts: &["low", "medium", "high"],
    },
    AgentDef {
        id: "ivy",
        label: "Ivy",
        models: ModelFilter::None,
        efforts: &[],
    },
];

fn matches(patterns: &[ModelPattern], model_id: &str) -> bool {
    patterns.iter().any(|pattern| match pattern {
        ModelPattern::Prefix(prefix) => model_id.starts_with(prefix),
        ModelPattern::Exact(id) => model_id == *id,
    })
}

fn default_model_option() -> ModelOption {
    ModelOption {
        id: DEFAULT_OPTION_ID.to_string(),
        display_name: "Default".to_string(),
    }
}

fn effort_label(id: &str) -> String {
    match id {
        "low" => "Low".to_string(),
        "medium" => "Medium".to_string(),
        "high" => "High".to_string(),
        "xhigh" => "Extra High".to_string(),
        "max" => "Max".to_string(),
        other => other.to_string(),
    }
}

/// The full catalog: every agent `build_agent_spec` dispatches on, with its models and efforts.
pub fn all_agents() -> Vec<AgentOption> {
    let specs = all_specs();

    AGENTS
        .iter()
        .map(|def| {
            let mut models = vec![default_model_option()];
            match &def.models {
                ModelFilter::None => {}
                ModelFilter::Any => models.extend(specs.iter().map(|spec| ModelOption {
                    id: spec.model_id.to_string(),
                    display_name: spec.display_name.to_string(),
                })),
                ModelFilter::Patterns(patterns) => models.extend(
                    specs
                        .iter()
                        .filter(|spec| matches(patterns, spec.model_id.as_ref()))
                        .map(|spec| ModelOption {
                            id: spec.model_id.to_string(),
                            display_name: spec.display_name.to_string(),
                        }),
                ),
            }

            let supports_effort = !def.efforts.is_empty();
            let efforts = if supports_effort {
                let mut efforts = vec![EffortOption {
                    id: DEFAULT_OPTION_ID.to_string(),
                    display_name: "Default".to_string(),
                }];
                efforts.extend(def.efforts.iter().map(|id| EffortOption {
                    id: (*id).to_string(),
                    display_name: effort_label(id),
                }));
                efforts
            } else {
                Vec::new()
            };

            AgentOption {
                id: def.id.to_string(),
                label: def.label.to_string(),
                models,
                supports_effort,
                efforts,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::providers::{build_agent_spec, AgentLaunchConfig};

    #[test]
    fn every_agent_but_ivy_offers_models_beyond_the_default() {
        for agent in all_agents() {
            if agent.id == "ivy" {
                assert_eq!(
                    agent.models.len(),
                    1,
                    "ivy proxies a fixed model and offers only the default"
                );
            } else {
                assert!(
                    agent.models.len() > 1,
                    "{} should offer models beyond the default",
                    agent.id
                );
            }
        }
    }

    #[test]
    fn default_is_first_in_every_model_and_effort_list() {
        for agent in all_agents() {
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
    fn model_filters_keep_each_family_with_its_own_agent() {
        let agents = all_agents();
        let find = |id: &str| agents.iter().find(|a| a.id == id).unwrap().clone();

        let claude = find("claude");
        let claude_ids: Vec<&str> = claude.models.iter().map(|m| m.id.as_str()).collect();
        assert!(claude_ids.contains(&"claude-opus-5"));
        assert!(claude_ids.contains(&"sonnet"));
        assert!(!claude_ids.iter().any(|id| id.starts_with("gpt-")));

        let codex = find("codex");
        let codex_ids: Vec<&str> = codex.models.iter().map(|m| m.id.as_str()).collect();
        assert!(codex_ids.contains(&"gpt-5.5"));
        assert!(codex_ids.contains(&"o3-mini"));
        assert!(codex_ids.contains(&"codex-mini"));
        assert!(!codex_ids.iter().any(|id| id.starts_with("claude")));

        let gemini = find("gemini");
        assert!(gemini
            .models
            .iter()
            .skip(1)
            .all(|m| m.id.starts_with("gemini-")));

        // The proxying agents reach every provider, so they list the whole catalog.
        assert_eq!(find("opencode").models.len(), all_specs().len() + 1);
        assert_eq!(find("copilot").models.len(), all_specs().len() + 1);

        let antigravity = find("antigravity");
        assert!(antigravity
            .models
            .iter()
            .skip(1)
            .all(|m| m.id.starts_with("gemini-") || m.id.starts_with("claude-")));
    }

    /// Each advertised effort must survive `build_agent_spec` verbatim; an id the provider does
    /// not know is silently rewritten to "medium", which would make the picker lie.
    #[test]
    fn advertised_efforts_are_accepted_by_the_providers_own_arm() {
        for agent in all_agents() {
            if !agent.supports_effort {
                continue;
            }
            for effort in agent.efforts.iter().skip(1) {
                let config = AgentLaunchConfig {
                    prompt: "hi".to_string(),
                    // Antigravity only emits effort arguments alongside a model.
                    model: Some("claude-opus-5".to_string()),
                    effort: Some(effort.id.clone()),
                    ..Default::default()
                };
                let spec = build_agent_spec(&agent.id, &config);
                assert!(
                    spec.args.iter().any(|arg| arg.contains(&effort.id)),
                    "{} rewrote effort '{}' instead of accepting it",
                    agent.id,
                    effort.id
                );
            }
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

        for agent in all_agents() {
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
}
