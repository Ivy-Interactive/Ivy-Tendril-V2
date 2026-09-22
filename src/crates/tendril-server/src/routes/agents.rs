use std::sync::Arc;

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use tendril_core::agents::catalog::{all_agents_for_proxy_base_url, OPENAI_PROXY_AGENT_ID};
use tendril_core::agents::probe::{
    all_sign_in_hints, check_auth, check_install, validate_model, AgentAuthResult,
    AgentInstallStatus, ProbeCredentials,
};
use tendril_core::agents::provider_models::{discover_provider_models, ModelValidation};
use tendril_core::agents::resolution::normalize_agent_name;
use tendril_core::agents::usage::{agent_usage, AgentUsageSnapshot};
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

/// `GET /api/agents/hints` — how to install and sign in to every card the Coding Agent pane offers.
///
/// Static data, served from the daemon rather than kept in the webview, because the same facts are
/// what a failed auth probe returns: `probe::sign_in_hint` is the one table, and both the pane's
/// Help section and the Test Agent dialog's failure row render entries from it. Keeping a second
/// copy in TypeScript is exactly what drifted — three hints named commands their CLI does not have,
/// and the pane and the probe disagreed about all three.
///
/// A GET with no parameters: it launches nothing, reads no credential and is the same for every
/// caller, which is what makes it cacheable and safe in a way `/test` deliberately is not.
pub async fn get_agent_hints_handler() -> impl IntoResponse {
    Json(all_sign_in_hints())
}

/// What the Coding Agent pane asks for when it wants the models an endpoint really serves.
///
/// Both fields are optional and both default to what is already in `config.yaml`, because the point of
/// this route is that the operator does not have to re-enter a key they have already saved. A key sent
/// here is one the operator just typed and has not saved yet.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchProviderModelsRequest {
    /// The agent entry whose environment holds the credentials — `openaiproxy` or `ivy`.
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    /// Only ever an inbound field. It is never echoed, never logged, and never part of a reply.
    #[serde(default)]
    pub api_key: Option<String>,
}

/// `POST /api/agents/models` — V1's onboarding "Continue": ask the endpoint for its models, and if it
/// has none, ping it with a real prompt so the failure can be attributed to the key, the URL or neither.
///
/// This runs in the daemon rather than the webview for two reasons: the credential lives in
/// `config.yaml` and the daemon is what may read it, and a provider call from a webview would be a
/// cross-origin request with the key in the renderer. Nothing in the reply carries the key — see
/// `provider_models::redact`, which every message passes through.
pub async fn fetch_provider_models_handler(
    State(state): State<Arc<AppState>>,
    Json(request): Json<FetchProviderModelsRequest>,
) -> impl IntoResponse {
    let snapshot = state.settings_snapshot();
    let agent = normalize_agent_name(request.agent.as_deref().unwrap_or(OPENAI_PROXY_AGENT_ID));

    let base_url = request
        .base_url
        .filter(|url| !url.trim().is_empty())
        .or_else(|| agent_environment(&snapshot.settings, &agent, BASE_URL_KEYS))
        .unwrap_or_default();
    let api_key = request
        .api_key
        .filter(|key| !key.trim().is_empty())
        .or_else(|| agent_environment(&snapshot.settings, &agent, API_KEY_KEYS))
        .unwrap_or_default();

    // Deliberately no `tracing` line carrying either value: the URL is harmless but the key is not,
    // and a log line with one and not the other invites the next edit to add it.
    Json(discover_provider_models(&base_url, &api_key).await)
}

/// What the Test Agent dialog asks for: one agent, and the models it should be tested against.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAgentRequest {
    /// The models to validate, in the order the dialog lists them. Empty means install and auth only.
    #[serde(default)]
    pub models: Vec<String>,
}

/// Everything V1's dialog draws: one install row, one auth row, and one row per model.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestAgentResponse {
    pub agent: String,
    pub install: AgentInstallStatus,
    /// Absent when the CLI is not installed: V1 short-circuits there rather than running an auth
    /// probe against a binary that does not exist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<AgentAuthResult>,
    pub models: Vec<ModelValidation>,
}

/// `POST /api/agents/:agent/test` — V1's Test Agent dialog, as one call.
///
/// The three checks run here rather than as three routes because they are strictly sequential and
/// each one's usefulness depends on the last: an auth probe against a missing binary reports a
/// spawn failure, and a model probe against a signed-out CLI reports an auth error for every model
/// in the list. V1 short-circuits for exactly that reason, and so does this.
///
/// It can take a while — Claude and Copilot each get thirty seconds per model — because the only
/// honest test of whether a provider will serve a model is asking it to.
pub async fn test_agent_handler(
    State(state): State<Arc<AppState>>,
    Path(agent): Path<String>,
    Json(request): Json<TestAgentRequest>,
) -> impl IntoResponse {
    let snapshot = state.settings_snapshot();
    let agent = normalize_agent_name(&agent);
    let credentials = probe_credentials(&snapshot.settings, &agent);

    let install = check_install(&agent).await;
    if !install.is_installed {
        return Json(TestAgentResponse {
            agent,
            install,
            auth: None,
            models: Vec::new(),
        });
    }

    let auth = check_auth(&agent, &credentials).await;

    let mut models = Vec::with_capacity(request.models.len());
    for model in &request.models {
        // Sequentially, not concurrently: these are real prompts against one provider, and firing
        // three at once at an account near its rate limit turns a model check into the thing that
        // exhausts the quota.
        models.push(validate_model(&agent, model, &credentials).await);
    }

    Json(TestAgentResponse {
        agent,
        install,
        auth: Some(auth),
        models,
    })
}

/// `GET /api/agents/:agent/usage` — the rate-limit windows behind the settings pane's usage strip.
///
/// `null` for the four agents whose providers publish no usage, which the pane reads as "draw no
/// strip". That is not an error and is not reported as one.
pub async fn get_agent_usage_handler(
    Path(agent): Path<String>,
) -> Json<Option<AgentUsageSnapshot>> {
    Json(agent_usage(&agent).await)
}

/// The base URL and key a bring-your-own-LLM probe needs, read from `config.yaml`.
///
/// Empty for every CLI-backed agent, which never looks at them: only the proxy arm of the probe
/// reads credentials, and it is the only arm that has no binary to ask instead.
fn probe_credentials(settings: &TendrilSettings, agent: &str) -> ProbeCredentials {
    ProbeCredentials {
        base_url: agent_environment(settings, agent, BASE_URL_KEYS).unwrap_or_default(),
        api_key: agent_environment(settings, agent, API_KEY_KEYS).unwrap_or_default(),
    }
}

/// The variables `codingAgents.ts`'s `byoEnvironment` writes, in the order `readApiKey` /
/// `readBaseUrl` read them.
const API_KEY_KEYS: &[&str] = &["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "IVY_API_KEY"];
const BASE_URL_KEYS: &[&str] = &["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "IVY_BASE_URL"];

/// The first of `keys` set on `agent`'s entry. Falls back to the sibling proxy entry, because the Ivy
/// card writes its credentials to both `ivy` and `openaiproxy` and either may be the configured id.
fn agent_environment(settings: &TendrilSettings, agent: &str, keys: &[&str]) -> Option<String> {
    let siblings: &[&str] = match agent {
        "ivy" => &["ivy", OPENAI_PROXY_AGENT_ID],
        OPENAI_PROXY_AGENT_ID | "proxy" => &[OPENAI_PROXY_AGENT_ID, "proxy", "ivy"],
        other => &[other],
    };

    for name in siblings {
        let entry = settings
            .coding_agents
            .iter()
            .find(|candidate| normalize_agent_name(&candidate.name) == *name);
        let Some(entry) = entry else { continue };
        for key in keys {
            if let Some(value) = entry
                .environment_variables
                .get(*key)
                .filter(|value| !value.trim().is_empty())
            {
                return Some(value.clone());
            }
        }
    }
    None
}

/// Whether a saved key exists for an agent, so the pane can offer to fetch without asking for one.
/// Reports only the fact, never the value.
pub fn has_saved_api_key(settings: &TendrilSettings, agent: &str) -> bool {
    agent_environment(settings, &normalize_agent_name(agent), API_KEY_KEYS).is_some()
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
    use axum::extract::Path as AxumPath;
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
        // No synthetic `default` row: the first model is the real one V1 flags `IsDefault`, and
        // `defaultModel` names it so a client never has to invent a sentinel.
        assert_eq!(claude["models"][0]["id"], "claude-opus-5");
        assert_eq!(claude["models"][0]["displayName"], "Claude Opus 5");
        assert_eq!(claude["defaultModel"], "claude-opus-5");
        assert!(!claude["models"]
            .as_array()
            .unwrap()
            .iter()
            .any(|model| model["id"] == "default"));
        assert!(claude["models"]
            .as_array()
            .unwrap()
            .iter()
            .any(|model| model["id"] == "claude-opus-5-5"));
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

    /// The saved key is the one the operator "already gave", and reading it here is what lets the pane
    /// ask for models without asking for a credential again.
    ///
    /// Proven without a provider: with no key anywhere the route refuses before making a request, and
    /// with one in `config.yaml` it gets as far as the endpoint — so reaching the endpoint at all is the
    /// evidence that the configured key was found.
    #[tokio::test]
    async fn the_saved_api_key_is_read_from_config_rather_than_asked_for() {
        let unconfigured = scratch_state("tendril-agents-fetch-nokey", None);
        let refusal = body_json(
            fetch_provider_models_handler(
                State(unconfigured),
                Json(FetchProviderModelsRequest {
                    base_url: Some("http://127.0.0.1:1/v1".to_string()),
                    ..Default::default()
                }),
            )
            .await
            .into_response(),
        )
        .await;
        assert_eq!(refusal["status"], "apiKeyError");
        assert_eq!(refusal["message"], "API Key is required.");

        let configured = scratch_state(
            "tendril-agents-fetch-key",
            Some(
                "codingAgents:\n  - name: openaiproxy\n    environmentVariables:\n      OPENAI_API_KEY: sk-configured-0123456789\n      ANTHROPIC_BASE_URL: http://127.0.0.1:1/v1\n",
            ),
        );
        let reached = body_json(
            fetch_provider_models_handler(
                State(configured),
                Json(FetchProviderModelsRequest::default()),
            )
            .await
            .into_response(),
        )
        .await;
        // Nothing is listening on port 1, so the configured key got as far as a connection attempt.
        assert_eq!(reached["status"], "baseUrlError");

        // And the whole reply is free of it, in every form.
        let serialized = reached.to_string();
        assert!(
            !serialized.contains("sk-configured-0123456789"),
            "{serialized}"
        );
        assert!(!serialized.contains("sk-configured"), "{serialized}");
    }

    /// The Ivy card writes its credentials to both the `ivy` and the `openaiproxy` entries, so either id
    /// must find them.
    #[tokio::test]
    async fn either_proxy_id_finds_the_credentials_the_other_saved() {
        let state = scratch_state(
            "tendril-agents-fetch-ivy",
            Some(
                "codingAgents:\n  - name: ivy\n    environmentVariables:\n      ANTHROPIC_API_KEY: sk-ivy-0123456789\n      ANTHROPIC_BASE_URL: https://llmproxy.ivy.app\n",
            ),
        );
        let snapshot = state.settings_snapshot();
        let settings = snapshot.settings.as_ref();
        assert!(has_saved_api_key(settings, "ivy"));
        assert!(has_saved_api_key(settings, "openaiproxy"));
        assert!(!has_saved_api_key(settings, "claude"));
    }

    /// A missing CLI stops the run rather than producing two more rows that only restate it.
    #[tokio::test]
    async fn testing_an_uninstalled_agent_reports_the_install_row_and_nothing_else() {
        let state = scratch_state("tendril-agents-test-missing", None);
        let response = body_json(
            test_agent_handler(
                State(state),
                AxumPath("tendril-no-such-agent-7f3c".to_string()),
                Json(TestAgentRequest {
                    models: vec!["some-model".to_string()],
                }),
            )
            .await
            .into_response(),
        )
        .await;

        assert_eq!(response["install"]["isInstalled"], false);
        assert!(response["install"]["error"]
            .as_str()
            .unwrap()
            .contains("not found on PATH"));
        // No auth row and no model rows: neither would mean anything without a binary.
        assert!(response.get("auth").is_none() || response["auth"].is_null());
        assert_eq!(response["models"].as_array().unwrap().len(), 0);
    }

    /// The proxy arm needs the saved credential, and the reply must not carry it back.
    #[tokio::test]
    async fn a_proxy_test_reads_the_saved_key_and_never_echoes_it() {
        let state = scratch_state(
            "tendril-agents-test-proxy",
            Some(
                "codingAgents:\n  - name: openaiproxy\n    environmentVariables:\n      OPENAI_API_KEY: sk-probe-0123456789\n      ANTHROPIC_BASE_URL: http://127.0.0.1:1/v1\n",
            ),
        );
        let snapshot = state.settings_snapshot();
        let credentials = probe_credentials(snapshot.settings.as_ref(), "openaiproxy");
        assert_eq!(credentials.api_key, "sk-probe-0123456789");
        assert_eq!(credentials.base_url, "http://127.0.0.1:1/v1");

        // Nothing is listening on port 1, so the probe fails at the connection - which is the proof
        // it got as far as using the configured credential.
        let response = body_json(
            test_agent_handler(
                State(state),
                AxumPath("openaiproxy".to_string()),
                Json(TestAgentRequest::default()),
            )
            .await
            .into_response(),
        )
        .await;

        let serialized = response.to_string();
        assert!(!serialized.contains("sk-probe-0123456789"), "{serialized}");
        assert!(!serialized.contains("sk-probe"), "{serialized}");
    }

    /// A CLI-backed agent's probe never reads a credential from config - it asks its own binary.
    #[tokio::test]
    async fn a_cli_agent_is_probed_without_credentials() {
        let state = scratch_state(
            "tendril-agents-test-cli-creds",
            Some(
                "codingAgents:\n  - name: openaiproxy\n    environmentVariables:\n      OPENAI_API_KEY: sk-not-for-claude\n",
            ),
        );
        let snapshot = state.settings_snapshot();
        let credentials = probe_credentials(snapshot.settings.as_ref(), "claude");
        assert!(credentials.api_key.is_empty());
        assert!(credentials.base_url.is_empty());
    }

    /// Parity with V1's three usage providers: the other agents report nothing, and that is a
    /// `null` body rather than an error the pane would have to handle.
    #[tokio::test]
    async fn an_agent_without_a_usage_provider_answers_null() {
        for agent in ["gemini", "copilot", "opencode"] {
            let response = body_json(
                get_agent_usage_handler(AxumPath(agent.to_string()))
                    .await
                    .into_response(),
            )
            .await;
            assert!(response.is_null(), "{agent}: {response}");
        }
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
