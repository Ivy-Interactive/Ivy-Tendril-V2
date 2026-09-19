//! An agent must only ever offer models it can actually serve.
//!
//! The bug: picking Claude and being shown Gemini models. The cause was structural — `catalog.rs`
//! built each agent's list by prefix-matching one shared spec table that `register_dynamic_specs`
//! fills from models.dev at daemon startup (some 15,000 rows across a hundred providers), so
//! provenance was inferred from the id *string* rather than declared. Any row whose id looked like a
//! family the agent served was offered by it, and the proxy pointed at an unrecognised base URL
//! offered everything.
//!
//! V1 works the other way round: `CachedModelCatalogProvider.GetModelsAsync` takes the provider's
//! own `GetStaticModels()` as the row set and lets models.dev **enrich the prices of those rows**.
//! `catalog.rs` now declares the same per-provider lists, so this file pins the property that makes
//! the bug impossible: the enrichment registry cannot add, rename or reroute a picker row.
//!
//! This lives in its own integration test binary because `register_dynamic_specs` writes a
//! process-wide static, which would otherwise leak into every other test in the crate.

use std::borrow::Cow;
use tendril_core::agents::catalog::{all_agents, all_agents_for_proxy_base_url, efforts_for};
use tendril_core::agents::model_sorting::ProviderGroup;
use tendril_core::agents::model_specs::{self, ModelSpec};

fn spec(model_id: &'static str, display_name: &'static str) -> ModelSpec {
    ModelSpec {
        model_id: Cow::Borrowed(model_id),
        display_name: Cow::Borrowed(display_name),
        context_window: 128_000,
        max_output_tokens: 8_192,
        input_per_million: 1.0,
        output_per_million: 2.0,
        cache_read_per_million: 0.1,
        cache_write_per_million: 0.0,
    }
}

fn model_ids(agent_id: &str) -> Vec<String> {
    all_agents()
        .into_iter()
        .find(|agent| agent.id == agent_id)
        .unwrap_or_else(|| panic!("{agent_id} should be in the catalog"))
        .models
        .into_iter()
        .map(|model| model.id)
        .collect()
}

#[test]
fn models_dev_enrichment_cannot_add_a_row_to_any_agents_picker() {
    let before: Vec<Vec<String>> = all_agents()
        .iter()
        .map(|agent| agent.models.iter().map(|m| m.id.clone()).collect())
        .collect();

    // Everything the live models.dev payload throws at the old prefix filter, in miniature:
    //
    // * a Gemini model published under a plain id — the row that ended up in Claude's picker once
    //   any agent's filter admitted more than its own declared list,
    // * the same model under a provider-qualified id,
    // * a Bedrock/Vertex regional spelling of a Claude model the Claude CLI cannot launch,
    // * a model from a provider V2 has no group for at all, which is the id an `Any` filter could
    //   not even guess at.
    model_specs::register_dynamic_specs(vec![
        spec("gemini-99-ultra", "Gemini 99 Ultra"),
        spec("google/gemini-99-ultra", "Gemini 99 Ultra"),
        spec("claude-opus-5@eu", "Claude Opus 5 (EU)"),
        spec("wat-9000-turbo", "Wat 9000 Turbo"),
    ]);

    let after: Vec<Vec<String>> = all_agents()
        .iter()
        .map(|agent| agent.models.iter().map(|m| m.id.clone()).collect())
        .collect();
    assert_eq!(
        before, after,
        "the enrichment registry must not change what any agent offers"
    );

    for agent in all_agents() {
        for leaked in [
            "gemini-99-ultra",
            "google/gemini-99-ultra",
            "claude-opus-5@eu",
            "wat-9000-turbo",
        ] {
            assert!(
                !agent.models.iter().any(|model| model.id == leaked),
                "{} offers {leaked}, which no provider declared",
                agent.id
            );
        }
    }

    // The proxy pointed at a base URL nobody recognises is the one that used to offer the whole
    // registry. It offers V1's declared union instead, so it is still bounded.
    let custom = all_agents_for_proxy_base_url(Some("http://localhost:11434/v1"))
        .into_iter()
        .find(|agent| agent.id == "openaiproxy")
        .expect("the proxy should always be listed");
    assert!(
        !custom
            .models
            .iter()
            .any(|model| model.id.contains("wat-9000") || model.id.contains("gemini-99")),
        "the custom proxy must offer a declared union, not the enrichment registry"
    );

    // ...while enrichment still does its actual job: pricing a model once one is chosen. Both the
    // rows the picker offers and the ones it does not resolve, which is what the cost path needs.
    assert!(model_specs::find("wat-9000-turbo").is_some());
    assert!(model_specs::find("claude-opus-5").is_some());

    model_specs::register_dynamic_specs(Vec::new());
}

/// The user's report, stated as an assertion: Claude offers Anthropic's models and nobody else's,
/// while the two agents that legitimately span providers still span them.
#[test]
fn each_agent_offers_exactly_the_providers_it_can_serve() {
    let claude = model_ids("claude");
    assert!(claude.len() > 1, "claude should offer models");
    assert!(
        !claude.iter().any(|id| id.contains("gemini")),
        "claude offered a Gemini model: {claude:?}"
    );
    assert!(
        claude
            .iter()
            .skip(1)
            .all(|id| ProviderGroup::of(id) == ProviderGroup::Anthropic),
        "claude offered a model it cannot serve: {claude:?}"
    );

    // V1 `CopilotModelCatalog`: Copilot really does serve Anthropic's models and OpenAI's.
    let copilot = model_ids("copilot");
    assert!(copilot.iter().any(|id| id.starts_with("claude-")));
    assert!(copilot.iter().any(|id| id.starts_with("gpt-")));
    assert!(!copilot.iter().any(|id| id.contains("gemini")));

    // The `ivy` row is no longer offered - V2 bundles OpenCode rather than shipping a rebranded
    // agent - so it has no model list to check here. Its ladder is still resolvable, because an
    // existing `config.yaml` may still name the id, and that is what the two assertions below check.
    assert!(efforts_for("ivy", Some("gemini-3.7-flash"))
        .iter()
        .all(|effort| effort.id != "max"));
    assert!(efforts_for("ivy", Some("claude-opus-5"))
        .iter()
        .any(|effort| effort.id == "max"));
}
