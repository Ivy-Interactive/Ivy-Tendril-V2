use std::sync::Arc;

use axum::extract::State;
use axum::response::IntoResponse;
use axum::Json;
use tendril_core::agents::catalog::{all_agents_for_proxy_base_url, OPENAI_PROXY_AGENT_ID};
use tendril_core::config::TendrilSettings;

use crate::state::AppState;

/// Returns the agent catalog the chat picker is built from: every agent, the models it accepts, the
/// effort levels its CLI understands, and the levels each individual model understands where those
/// differ (Copilot on a Claude model offers Claude's ladder, not Copilot's).
pub async fn get_agents_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let snapshot = state.settings_snapshot();
    let proxy_base_url = openai_proxy_base_url(&snapshot.settings);
    Json(all_agents_for_proxy_base_url(proxy_base_url.as_deref()))
}

/// The `ANTHROPIC_BASE_URL` configured for the `openaiproxy` agent, which is what decides that
/// agent's label and model list. V1 `AgentBranding.For` reads exactly this key off exactly this
/// entry.
fn openai_proxy_base_url(settings: &TendrilSettings) -> Option<String> {
    settings
        .coding_agents
        .iter()
        .find(|agent| {
            let name = agent.name.to_ascii_lowercase();
            name == OPENAI_PROXY_AGENT_ID || name == "proxy"
        })
        .and_then(|agent| agent.environment_variables.get("ANTHROPIC_BASE_URL"))
        .filter(|url| !url.trim().is_empty())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::response::Response;

    fn scratch_state(name: &str, config_yaml: Option<&str>) -> Arc<AppState> {
        let home = std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&home).unwrap();
        if let Some(yaml) = config_yaml {
            std::fs::write(home.join("config.yaml"), yaml).unwrap();
        }
        Arc::new(AppState::new(home, "test-secret".to_string()))
    }

    async fn body_json(response: Response) -> serde_json::Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    async fn catalog(state: Arc<AppState>) -> serde_json::Value {
        body_json(get_agents_handler(State(state)).await.into_response()).await
    }

    #[tokio::test]
    async fn serves_the_catalog_as_camel_cased_json() {
        let state = scratch_state("tendril-agents-route", None);
        let agents = catalog(state).await;
        let agents = agents.as_array().expect("expected an array of agents");

        assert!(!agents.is_empty());
        let claude = agents
            .iter()
            .find(|agent| agent["id"] == "claude")
            .expect("claude should be in the catalog");

        assert_eq!(claude["label"], "Claude Code");
        assert_eq!(claude["icon"], "ClaudeCode");
        assert_eq!(claude["supportsEffort"], true);
        assert_eq!(claude["models"][0]["id"], "default");
        assert_eq!(claude["models"][0]["displayName"], "Default");
        assert!(claude["efforts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|effort| effort["id"] == "high"));
    }

    /// The per-model ladder has to reach the wire, or a stateless client cannot tell that Copilot on
    /// a Claude model offers `max`.
    #[tokio::test]
    async fn model_rows_carry_their_own_effort_ladder() {
        let state = scratch_state("tendril-agents-route-efforts", None);
        let agents = catalog(state).await;
        let copilot = agents
            .as_array()
            .unwrap()
            .iter()
            .find(|agent| agent["id"] == "copilot")
            .expect("copilot should be in the catalog")
            .clone();

        let ladder = |model_id: &str| {
            copilot["models"]
                .as_array()
                .unwrap()
                .iter()
                .find(|model| model["id"] == model_id)
                .unwrap_or_else(|| panic!("{model_id} should be offered"))["efforts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|effort| effort["id"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };

        assert!(ladder("claude-opus-5").contains(&"max".to_string()));
        assert!(!ladder("gpt-5.4").contains(&"max".to_string()));
    }

    /// A Gemini row carries no ladder at all, so the field is absent rather than an empty array.
    #[tokio::test]
    async fn an_agent_without_effort_control_sends_no_ladder() {
        let state = scratch_state("tendril-agents-route-gemini", None);
        let agents = catalog(state).await;
        let gemini = agents
            .as_array()
            .unwrap()
            .iter()
            .find(|agent| agent["id"] == "gemini")
            .expect("gemini should be in the catalog")
            .clone();

        assert_eq!(gemini["supportsEffort"], false);
        assert!(gemini["efforts"].as_array().unwrap().is_empty());
        assert!(gemini["models"][1].get("efforts").is_none());
    }

    /// V1 `AgentBranding.For`: the proxy is relabelled for the provider it is pointed at.
    #[tokio::test]
    async fn the_proxy_is_labelled_for_the_base_url_it_is_configured_with() {
        let state = scratch_state(
            "tendril-agents-route-proxy",
            Some(
                "codingAgents:\n  - name: openaiproxy\n    environmentVariables:\n      ANTHROPIC_BASE_URL: https://api.berget.ai/v1\n",
            ),
        );
        let agents = catalog(state).await;
        let proxy = agents
            .as_array()
            .unwrap()
            .iter()
            .find(|agent| agent["id"] == OPENAI_PROXY_AGENT_ID)
            .expect("the proxy should be in the catalog")
            .clone();

        assert_eq!(proxy["label"], "Berget AI");
        assert_eq!(proxy["icon"], "ChevronUp");
    }

    #[tokio::test]
    async fn the_proxy_falls_back_to_its_own_label_with_no_configuration() {
        let state = scratch_state("tendril-agents-route-proxy-default", None);
        let agents = catalog(state).await;
        let proxy = agents
            .as_array()
            .unwrap()
            .iter()
            .find(|agent| agent["id"] == OPENAI_PROXY_AGENT_ID)
            .expect("the proxy should be in the catalog")
            .clone();

        assert_eq!(proxy["label"], "OpenAI Proxy");
    }
}
