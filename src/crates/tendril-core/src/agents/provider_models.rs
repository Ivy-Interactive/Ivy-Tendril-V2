//! Live model discovery against a bring-your-own-LLM endpoint, and the profile defaults picked from
//! whatever it answers.
//!
//! This is V1's onboarding mechanism, ported whole:
//!
//! * `Providers/OpenAiProxy/OpenAiProxyModelCatalog.FetchModelsDetailedAsync` — ask the endpoint's own
//!   `/models` for the ids it will actually accept ([`fetch_models_detailed`]).
//! * `Helpers/LlmEndpointTester.TestModelPromptAsync` — when there is no model list, send a real
//!   five-token `ping` and read the refusal ([`test_model_prompt`]).
//! * `Helpers/ModelProfileSelector` + `Helpers/ModelProfilePriorities` — choose a Deep / Balanced /
//!   Quick model out of what came back, per provider ([`select_defaults`]).
//! * `Apps/Onboarding/CodingAgentStepView.cs:334-400` — the decision tree over those three, which is
//!   what turns one failure into an error on the *right* field ([`discover_provider_models`]).
//!
//! Two things are V2's rather than V1's, and both are why this lives in the daemon instead of the
//! webview:
//!
//! * **The key never leaves the daemon.** It is read from `config.yaml`'s coding-agent environment by
//!   the route, sent to the provider, and never returned, logged or interpolated into an error: every
//!   message that leaves here goes through [`redact`] first, because a provider that echoes the key it
//!   rejected would otherwise put it in the UI.
//! * **Discovery never touches the declared catalogue.** [`crate::agents::catalog`] is the list of
//!   models an agent is *declared* to serve, and a fetched id that is not in it stays out of it — it is
//!   offered for this endpoint only. All the catalogue contributes is a display name for an id it
//!   already knows, which is V1's `allKnownLookup`.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::catalog::declared_display_name;
use super::model_specs::normalize_model_id;
// Full path rather than `agents::*`: `agents/mod.rs` deliberately does not re-export `sort_models`,
// on the grounds that the name is too generic to sit alongside everything else in that namespace.
use super::model_sorting::{sort_models, SortableModel};

/// How long the provider gets. V1's `OpenAiProxyModelCatalog` allows 8s for a listing and
/// `LlmEndpointTester` 15s for a completion, which is the same split.
const LIST_TIMEOUT: Duration = Duration::from_secs(8);
const PING_TIMEOUT: Duration = Duration::from_secs(15);

/// V1 `Helpers/ModelProfilePriorities.ModelProviderKind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelProviderKind {
    Generic,
    Ivy,
    Anthropic,
    OpenAi,
    Google,
    Berget,
    OpenCode,
}

impl ModelProviderKind {
    /// V1 `ModelProfileSelector.DetectProvider`'s URL branch, which is the one the view reaches
    /// through: its `isGoogle` flag is exactly "the URL mentions Google's endpoint, gemini or google".
    pub fn detect(base_url: &str) -> Self {
        let url = base_url.trim().to_ascii_lowercase();
        if url.contains("llmproxy.ivy.app") || url.contains("ivy.app") {
            return Self::Ivy;
        }
        if url.contains("api.anthropic.com") {
            return Self::Anthropic;
        }
        if url.contains("generativelanguage.googleapis.com")
            || url.contains("gemini")
            || url.contains("google")
        {
            return Self::Google;
        }
        if url.contains("api.berget.ai") {
            return Self::Berget;
        }
        if url.contains("api.openai.com") || url.is_empty() {
            return Self::OpenAi;
        }
        Self::Generic
    }
}

/// One model an endpoint says it serves. Deliberately *not* a
/// [`crate::agents::catalog::ModelOption`]: it carries no effort ladder, because nothing declared it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub display_name: String,
}

impl SortableModel for DiscoveredModel {
    fn model_id(&self) -> &str {
        &self.id
    }
    fn model_display_name(&self) -> &str {
        &self.display_name
    }
}

/// V1 `Abstractions/AgentTypes.ModelValidationStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModelValidationStatus {
    Ok,
    InvalidModel,
    AuthError,
    /// The model is valid and reachable but its quota is exhausted, so nothing launched against it
    /// will do any work. Reported as an error rather than a warning: a fleet started in this state
    /// produces nothing at all.
    RateLimit,
    Timeout,
    Unknown,
}

/// V1 `ModelValidationResult`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelValidation {
    pub status: ModelValidationStatus,
    pub model: String,
    pub error_message: Option<String>,
}

/// V1 `FetchModelsResult`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FetchModelsResult {
    pub success: bool,
    pub models: Vec<DiscoveredModel>,
    pub is_auth_error: bool,
    pub error_message: Option<String>,
}

/// The Deep / Balanced / Quick trio V1's `SelectDefaults` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDefaults {
    pub deep: String,
    pub balanced: String,
    pub quick: String,
}

// ---------------------------------------------------------------------------
// Profile priorities — V1 `Helpers/ModelProfilePriorities`
// ---------------------------------------------------------------------------

/// V1's `PriorityMap`, verbatim: the ids to look for in a fetched list, best first. The first entry
/// doubles as `GetDefaultModel`, i.e. what the tier falls back to when the endpoint lists nothing.
const fn priorities(kind: ModelProviderKind, tier: ProfileTier) -> &'static [&'static str] {
    use ModelProviderKind as K;
    use ProfileTier as T;
    match (kind, tier) {
        (K::Ivy, T::Deep) => &[
            "claude-fable-5-1",
            "claude-opus-5-5",
            "claude-opus-5-1",
            "claude-opus-5",
            "claude-opus-4-8",
            "claude-opus-4-7",
            "claude-opus-4-6",
            "claude-opus-4",
            "opus",
            "gpt-5.6-sol",
            "gpt-6-astra",
            "astra",
            "sol",
            "claude-sonnet-5",
            "gemini-3.8-flash",
            "gemini-3.7-flash",
        ],
        (K::Ivy, T::Balanced) => &[
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "claude-sonnet-5-1",
            "claude-sonnet-5",
            "claude-sonnet-4-6",
            "gpt-5.6-terra",
            "terra",
            "gemini-2.5-flash",
        ],
        (K::Ivy, T::Quick) => &[
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-2.5-flash",
            "claude-haiku-5-1",
            "claude-haiku-4-5",
            "gpt-5.6-luna",
            "luna",
            "gpt-4o-mini",
        ],

        (K::Anthropic, T::Deep) => &[
            "claude-fable-5-1",
            "claude-opus-5-5",
            "claude-opus-5-1",
            "claude-opus-5",
            "claude-opus-4-8",
            "claude-opus-4-7",
            "claude-opus-4-6",
            "claude-opus-4",
            "opus",
            "claude-sonnet-5",
        ],
        // `claude-sonnet-5-1` and `claude-haiku-5-1` used to head these two lists and neither has
        // ever existed: the Sonnet line stops at `claude-sonnet-5` and the Haiku line at
        // `claude-haiku-4-5`. Heading the list is the one position where a phantom id is not merely
        // inert — `select_model` returns `candidates[0]` verbatim when the endpoint lists nothing,
        // so an unlaunchable head became the stored default and 404'd at launch. Later entries are
        // only ever returned after matching something the endpoint offered, so a stale id further
        // down is harmless; these lists are trimmed to ids that resolve anyway.
        (K::Anthropic, T::Balanced) => &[
            "claude-sonnet-5",
            "claude-sonnet-4-6",
            "claude-sonnet-4-5",
            "sonnet",
            "claude-haiku-4-5",
        ],
        (K::Anthropic, T::Quick) => &["claude-haiku-4-5", "claude-3-5-haiku", "haiku"],

        (K::Google, T::Deep) => &[
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-3.1-pro",
            "gemini-3-pro",
            "gemini-2.5-pro",
            "gemini-2.5-flash",
        ],
        (K::Google, T::Balanced) => &[
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
        ],
        (K::Google, T::Quick) => &[
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
        ],

        (K::OpenAi, T::Deep) => &[
            "gpt-5.6-sol",
            "gpt-6-astra",
            "astra",
            "gpt-5.6",
            "gpt-5.5",
            "gpt-5",
            "sol",
            "o3",
            "o1",
            "gpt-4o",
        ],
        (K::OpenAi, T::Balanced) => &["gpt-5.6-terra", "gpt-5.6", "gpt-5", "terra", "gpt-4o"],
        (K::OpenAi, T::Quick) => &["gpt-5.6-luna", "luna", "gpt-4o-mini", "gpt-4.1-mini"],

        // Berget serves one coding model, so all three tiers name it.
        (K::Berget, _) => &["moonshotai/Kimi-K3", "kimi-k3", "kimi"],

        (K::OpenCode, T::Deep) => &[
            "claude-fable-5-1",
            "claude-opus-5-1",
            "claude-opus-5",
            "gpt-5.6-sol",
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "claude-sonnet-5",
        ],
        (K::OpenCode, T::Balanced) => &[
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "claude-sonnet-5-1",
            "claude-sonnet-5",
            "gpt-5.6-terra",
        ],
        (K::OpenCode, T::Quick) => &[
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "claude-haiku-4-5",
            "gpt-5.6-luna",
        ],

        (K::Generic, T::Deep) => &[
            "gpt-5.6-sol",
            "gpt-6-astra",
            "claude-fable-5-1",
            "claude-opus-5-1",
            "claude-opus-5",
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "claude-sonnet-5",
            "gpt-4o",
        ],
        (K::Generic, T::Balanced) => &[
            "gpt-5.6-terra",
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "claude-sonnet-5-1",
            "claude-sonnet-5",
            "gpt-4o",
        ],
        (K::Generic, T::Quick) => &[
            "gpt-5.6-luna",
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "claude-haiku-4-5",
            "gpt-4o-mini",
        ],
    }
}

/// The three tiers `apply_profile` maps by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileTier {
    Deep,
    Balanced,
    Quick,
}

impl ProfileTier {
    /// V1's `fallbackIndex`: with no candidate matched, take the nth listed model.
    fn fallback_index(self) -> usize {
        match self {
            Self::Deep => 0,
            Self::Balanced => 1,
            Self::Quick => 2,
        }
    }
}

/// V1 `ModelProfileSelector.SelectModel`: the first prioritised candidate the endpoint offers, matched
/// exactly or as a substring (`claude-opus-5` matches `anthropic/claude-opus-5-20260101`), then the
/// tier's positional fallback, then the provider's declared default.
pub fn select_model(kind: ModelProviderKind, tier: ProfileTier, available: &[String]) -> String {
    let candidates = priorities(kind, tier);
    if available.is_empty() {
        return candidates[0].to_string();
    }

    for candidate in candidates {
        let wanted = normalize_model_id(candidate);
        if let Some(found) = available.iter().find(|id| {
            let id = normalize_model_id(id);
            id == wanted || id.contains(&wanted)
        }) {
            return found.clone();
        }
    }

    available
        .get(tier.fallback_index())
        .or_else(|| available.first())
        .cloned()
        .unwrap_or_else(|| candidates[0].to_string())
}

/// V1 `ModelProfileSelector.SelectDefaults`.
pub fn select_defaults(models: &[DiscoveredModel], kind: ModelProviderKind) -> ProfileDefaults {
    let ids: Vec<String> = models.iter().map(|model| model.id.clone()).collect();
    ProfileDefaults {
        deep: select_model(kind, ProfileTier::Deep, &ids),
        balanced: select_model(kind, ProfileTier::Balanced, &ids),
        quick: select_model(kind, ProfileTier::Quick, &ids),
    }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/// Removes every non-empty secret from a message, whole and in the truncated forms a provider tends
/// to echo (`sk-abc...`, the last four characters).
///
/// This runs on **every** string that leaves this module. A provider that quotes the credential it
/// refused is common enough — Google's and OpenAI's error bodies both do it — that treating the
/// provider's own text as safe would put the key on screen and in the log.
pub fn redact(message: &str, secrets: &[&str]) -> String {
    let mut out = message.to_string();
    for secret in secrets {
        let secret = secret.trim();
        if secret.len() < 4 {
            continue;
        }
        out = out.replace(secret, "***");
        // The prefix a provider echoes when it truncates, e.g. `sk-proj-abcd...`.
        for len in [12, 8, 6] {
            if secret.len() > len {
                out = out.replace(&secret[..len], "***");
            }
        }
        let tail = &secret[secret.len() - 4..];
        // A bare four-character tail is too short to match safely on its own, so only the forms a
        // provider actually prints are replaced.
        for form in [format!("...{tail}"), format!("…{tail}"), format!("*{tail}")] {
            out = out.replace(&form, "***");
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Error message extraction — V1 `LlmEndpointTester.ExtractErrorMessage`
// ---------------------------------------------------------------------------

/// V1 `ExtractErrorMessage`: `error.message`, `error`, `detail`, `message`, then the raw body capped
/// at 200 characters.
pub fn extract_error_message(body: &str, status: u16) -> String {
    if body.trim().is_empty() {
        return format!("HTTP {status}");
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(error) = json.get("error") {
            if let Some(text) = error.as_str() {
                return clean_nested(text);
            }
            if error.is_object() {
                if let Some(message) = error.get("message").and_then(|m| m.as_str()) {
                    return clean_nested(message);
                }
                return clean_nested(&error.to_string());
            }
        }
        if let Some(detail) = json.get("detail") {
            return clean_nested(
                detail
                    .as_str()
                    .map_or_else(|| detail.to_string(), String::from)
                    .as_str(),
            );
        }
        if let Some(message) = json.get("message").and_then(|m| m.as_str()) {
            return clean_nested(message);
        }
    }

    let trimmed = body.trim();
    if trimmed.chars().count() > 200 {
        let capped: String = trimmed.chars().take(200).collect();
        return clean_nested(&format!("{capped}..."));
    }
    clean_nested(trimmed)
}

/// V1 `CleanNestedErrorMessage`: providers wrap another provider's JSON in a string often enough that
/// the inner `"message": "..."` is the only readable part. V1 uses a lookaround-free regex; this is the
/// same extraction hand-rolled, because the `regex` crate is not a dependency here.
fn clean_nested(message: &str) -> String {
    let trimmed = message.trim();
    for key in ["error", "message"] {
        for quote in ['\'', '"'] {
            let needle = format!("{quote}{key}{quote}");
            let Some(at) = trimmed.find(&needle) else {
                continue;
            };
            let rest = &trimmed[at + needle.len()..];
            let Some(colon) = rest.find(':') else {
                continue;
            };
            let value = rest[colon + 1..].trim_start();
            let Some(opener) = value.chars().next() else {
                continue;
            };
            if opener != '\'' && opener != '"' {
                continue;
            }
            let inner = &value[opener.len_utf8()..];
            let Some(end) = inner.find(opener) else {
                continue;
            };
            let extracted = inner[..end]
                .trim_start_matches("/chat/completions:")
                .trim()
                .replace('`', "");
            if !extracted.is_empty() {
                return extracted;
            }
        }
    }
    trimmed.to_string()
}

/// V1's auth test, which is a status check *and* a message check because several providers answer 400
/// for a bad key.
fn is_auth_failure(status: u16, message: &str) -> bool {
    if status == 401 || status == 403 {
        return true;
    }
    let lower = message.to_ascii_lowercase();
    [
        "api_key_invalid",
        "api key not valid",
        "authenticationerror",
        "authentication_error",
        "invalid_api_key",
        "unauthorized",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

/// V1's `InvalidModel` test.
fn is_invalid_model(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "model_not_found",
        "invalid model",
        "does not exist",
        "not found",
        "not supported",
        "not available",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

// ---------------------------------------------------------------------------
// Endpoints and payloads
// ---------------------------------------------------------------------------

fn trim_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

/// V1 `FetchModelsDetailedAsync`'s `urlsToTry`. Anthropic's listing is at a fixed URL because its
/// `/v1/models` is the only one V1 knows the shape of.
pub fn model_list_endpoints(base_url: &str) -> Vec<String> {
    let url = trim_url(base_url);
    if url.to_ascii_lowercase().contains("api.anthropic.com") {
        return vec!["https://api.anthropic.com/v1/models".to_string()];
    }
    if url.to_ascii_lowercase().ends_with("/v1") {
        return vec![format!("{url}/models")];
    }
    vec![format!("{url}/v1/models"), format!("{url}/models")]
}

/// V1 `TestModelPromptAsync`'s `endpointsToTry`.
pub fn chat_endpoints(base_url: &str) -> Vec<String> {
    let url = trim_url(base_url);
    let lower = url.to_ascii_lowercase();
    if lower.contains("api.anthropic.com") {
        return if lower.ends_with("/v1") {
            vec![format!("{url}/messages")]
        } else {
            vec![format!("{url}/v1/messages")]
        };
    }
    if lower.ends_with("/v1") {
        return vec![format!("{url}/chat/completions")];
    }
    vec![
        format!("{url}/v1/chat/completions"),
        format!("{url}/chat/completions"),
    ]
}

/// V1's `effectiveModel`: which model to ping when the caller named none.
pub fn ping_model_for(base_url: &str) -> &'static str {
    match ModelProviderKind::detect(base_url) {
        ModelProviderKind::Ivy => "claude-opus-5",
        ModelProviderKind::Anthropic => "claude-sonnet-5",
        ModelProviderKind::Google => "gemini-3.7-flash",
        ModelProviderKind::Berget => "moonshotai/Kimi-K3",
        _ => "gpt-5.6-terra",
    }
}

/// V1 `ParseModelsJson`: OpenAI's and Anthropic's `{data:[{id, display_name}]}`, Ollama's
/// `{models:[{name, model}]}`, and a bare array.
pub fn parse_models_json(body: &str) -> Vec<DiscoveredModel> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };

    let mut out: Vec<DiscoveredModel> = Vec::new();
    let mut push = |id: Option<&str>, name: Option<&str>| {
        let Some(id) = id.map(str::trim).filter(|id| !id.is_empty()) else {
            return;
        };
        // The catalogue's own name for an id it declares, which is V1's `allKnownLookup` — a
        // display-name lookup only. The row itself is never taken from the catalogue, so a fetched id
        // cannot inherit an effort ladder nobody declared for this endpoint.
        let display_name = declared_display_name(id)
            .map(str::to_string)
            .or_else(|| {
                name.map(str::trim)
                    .filter(|name| !name.is_empty() && *name != id)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| id.to_string());
        out.push(DiscoveredModel {
            id: id.to_string(),
            display_name,
        });
    };

    if let Some(data) = json.get("data").and_then(|d| d.as_array()) {
        for item in data {
            push(
                item.get("id").and_then(|v| v.as_str()),
                item.get("display_name")
                    .or_else(|| item.get("name"))
                    .and_then(|v| v.as_str()),
            );
        }
    } else if let Some(models) = json.get("models").and_then(|d| d.as_array()) {
        for item in models {
            let id = item
                .get("name")
                .or_else(|| item.get("model"))
                .or_else(|| item.get("id"))
                .and_then(|v| v.as_str());
            push(id, id);
        }
    } else if let Some(array) = json.as_array() {
        for item in array {
            let id = item.get("id").and_then(|v| v.as_str());
            push(id, id);
        }
    }

    // One endpoint can list the same id twice (an alias and its dated form); the picker shows it once.
    let mut seen = std::collections::HashSet::new();
    out.retain(|model| seen.insert(normalize_model_id(&model.id)));

    // A provider's `/models` answers in its own order — creation order for the OpenAI-compatible
    // endpoints, unspecified for the rest — so without this the picker is ordered when it falls back to
    // the declared catalogue and arbitrary when a fetch succeeded. V1 sorts the fetched list here too:
    // `OpenAiProxyModelCatalog.GetModelsAsync` line 59, `ModelCatalogSorter.Sort(models)`.
    //
    // Same arguments as the declared path in `catalog::build_agent`: no group order, and no pinned
    // default, because a discovered list carries no `default` row.
    //
    // `&[]` is worth being explicit about. It means provider *groups* keep the order they first appear
    // in — so a canonical order applies within a brand, while the brands themselves follow the
    // endpoint. That is not an oversight on either side: V1's `ModelCatalogSorter.Sort` buckets the
    // same way, under the comment "Group by provider while preserving appearance order of providers",
    // and it runs that same single-argument overload on this very path. Passing a fixed group order
    // here would order the brands too, but it would be a deliberate divergence from V1 rather than the
    // parity fix this is, so it is left to a decision rather than taken quietly.
    //
    // Note this also feeds `select_defaults`, whose fallback is positional (`fallback_index`: Deep 0,
    // Balanced 1, Quick 2) and whose substring match takes the first id that contains the candidate.
    // Sorting first is what makes those positions mean "the flagship", and is the order V1's
    // `ModelProfileSelector` has always seen.
    sort_models(&mut out, &[], false);
    out
}

fn ping_payload(model: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "max_tokens": 5,
        "messages": [{ "role": "user", "content": "ping" }],
    })
}

/// The headers a provider wants, per V1: Anthropic takes `x-api-key` plus a version, everything else a
/// bearer, and the Ivy proxy takes both because it accepts either SDK.
///
/// Getting this wrong reads as an authentication failure, which the pane would report as a bad key — so
/// it is a pure function with its own test rather than a detail of the request builder.
pub fn auth_headers(base_url: &str, api_key: &str) -> Vec<(&'static str, String)> {
    let lower = base_url.to_ascii_lowercase();
    if lower.contains("api.anthropic.com") {
        return vec![
            ("x-api-key", api_key.to_string()),
            ("anthropic-version", "2023-06-01".to_string()),
        ];
    }
    let mut headers = vec![("authorization", format!("Bearer {api_key}"))];
    if lower.contains("ivy.app") || lower.contains("llmproxy") {
        headers.push(("x-api-key", api_key.to_string()));
    }
    headers
}

fn authorize(
    request: reqwest::RequestBuilder,
    base_url: &str,
    api_key: &str,
) -> reqwest::RequestBuilder {
    auth_headers(base_url, api_key)
        .into_iter()
        .fold(request, |request, (name, value)| {
            request.header(name, value)
        })
}

// ---------------------------------------------------------------------------
// The two network calls
// ---------------------------------------------------------------------------

fn client(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .unwrap_or_default()
}

/// V1 `OpenAiProxyModelCatalog.FetchModelsDetailedAsync`.
///
/// Every message on the way out is redacted of the key.
pub async fn fetch_models_detailed(base_url: &str, api_key: &str) -> FetchModelsResult {
    if trim_url(base_url).is_empty() {
        return FetchModelsResult {
            error_message: Some("Base URL is not configured.".to_string()),
            ..Default::default()
        };
    }

    let http = client(LIST_TIMEOUT);
    let mut last_error: Option<String> = None;
    let mut is_auth_error = false;

    for endpoint in model_list_endpoints(base_url) {
        let mut request = http.get(&endpoint);
        if !api_key.trim().is_empty() {
            request = authorize(request, base_url, api_key);
        }

        match request.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                let body = response.text().await.unwrap_or_default();
                if (200..300).contains(&status) {
                    let models = parse_models_json(&body);
                    if !models.is_empty() {
                        return FetchModelsResult {
                            success: true,
                            models,
                            is_auth_error: false,
                            error_message: None,
                        };
                    }
                }
                let message = redact(&extract_error_message(&body, status), &[api_key]);
                if is_auth_failure(status, &message) {
                    is_auth_error = true;
                }
                last_error = Some(message);
            }
            Err(err) => last_error = Some(redact(&transport_error(&err), &[api_key])),
        }
    }

    FetchModelsResult {
        success: false,
        models: Vec::new(),
        is_auth_error,
        error_message: last_error,
    }
}

/// V1 `LlmEndpointTester.TestModelPromptAsync`.
pub async fn test_model_prompt(base_url: &str, api_key: &str, model: &str) -> ModelValidation {
    let refuse = |message: &str| ModelValidation {
        status: ModelValidationStatus::AuthError,
        model: model.to_string(),
        error_message: Some(message.to_string()),
    };

    if trim_url(base_url).is_empty() {
        return refuse("Base URL is not configured.");
    }
    if api_key.trim().is_empty() {
        return refuse("API key is not configured.");
    }

    let effective = if model.trim().is_empty() || model.eq_ignore_ascii_case("default") {
        ping_model_for(base_url).to_string()
    } else {
        model.to_string()
    };

    let http = client(PING_TIMEOUT);
    let mut last_error: Option<String> = None;
    let mut last_status = ModelValidationStatus::Unknown;

    for endpoint in chat_endpoints(base_url) {
        let request =
            authorize(http.post(&endpoint), base_url, api_key).json(&ping_payload(&effective));
        match request.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                if (200..300).contains(&status) {
                    return ModelValidation {
                        status: ModelValidationStatus::Ok,
                        model: model.to_string(),
                        error_message: None,
                    };
                }
                let body = response.text().await.unwrap_or_default();
                let message = redact(&extract_error_message(&body, status), &[api_key]);
                if is_auth_failure(status, &message) {
                    return ModelValidation {
                        status: ModelValidationStatus::AuthError,
                        model: model.to_string(),
                        error_message: Some(message),
                    };
                }
                last_status = if is_invalid_model(&message) {
                    ModelValidationStatus::InvalidModel
                } else {
                    ModelValidationStatus::Unknown
                };
                last_error = Some(message);
            }
            Err(err) => {
                last_status = if err.is_timeout() {
                    ModelValidationStatus::Timeout
                } else {
                    ModelValidationStatus::Unknown
                };
                last_error = Some(redact(&transport_error(&err), &[api_key]));
            }
        }
    }

    ModelValidation {
        status: last_status,
        model: model.to_string(),
        error_message: Some(last_error.unwrap_or_else(|| "Model validation failed".to_string())),
    }
}

/// A transport failure, phrased so the base-URL routing below can recognise it. `reqwest`'s own
/// `Display` includes the URL, which is the operator's own base URL rather than a secret, but never the
/// headers.
fn transport_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        return "Could not connect: the endpoint timed out.".to_string();
    }
    if err.is_connect() {
        return format!("Could not connect to the endpoint: {err}");
    }
    format!("HTTP request failed: {err}")
}

// ---------------------------------------------------------------------------
// The decision tree — V1 `CodingAgentStepView.cs:334-400`
// ---------------------------------------------------------------------------

/// What the pane should do with the answer. The three failure arms are three *different fields*, which
/// is the whole value of V1's routing: the operator is told which of the key, the URL and the model is
/// the thing that is wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ProviderModelsOutcome {
    /// The endpoint listed models: offer them in the selects, with these tiers preselected.
    Models {
        models: Vec<DiscoveredModel>,
        defaults: ProfileDefaults,
        provider: ModelProviderKind,
    },
    /// The endpoint answered but lists nothing, and a real prompt reached it: type the ids by hand.
    CustomNames {
        defaults: ProfileDefaults,
        provider: ModelProviderKind,
        /// Why there is no list, when the endpoint said something worth repeating.
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    /// The key is wrong. Not the same as an endpoint without a model list, so this never falls through
    /// to custom names.
    ApiKeyError { message: String },
    /// Nothing answered at that URL.
    BaseUrlError { message: String },
}

/// V1's `Continue` handler, minus the state sets: fetch, and route the outcome.
pub async fn discover_provider_models(base_url: &str, api_key: &str) -> ProviderModelsOutcome {
    let provider = ModelProviderKind::detect(base_url);

    if trim_url(base_url).is_empty() {
        return ProviderModelsOutcome::BaseUrlError {
            message: "API Base URL is required.".to_string(),
        };
    }
    if api_key.trim().is_empty() {
        return ProviderModelsOutcome::ApiKeyError {
            message: "API Key is required.".to_string(),
        };
    }

    let fetched = fetch_models_detailed(base_url, api_key).await;

    if fetched.is_auth_error {
        return ProviderModelsOutcome::ApiKeyError {
            message: fetched.error_message.unwrap_or_else(|| {
                "Invalid API Key or unauthorized for this endpoint.".to_string()
            }),
        };
    }

    if fetched.success && !fetched.models.is_empty() {
        let defaults = select_defaults(&fetched.models, provider);
        return ProviderModelsOutcome::Models {
            models: fetched.models,
            defaults,
            provider,
        };
    }

    // No list. V1 does not give up here: it sends a real prompt, because an endpoint with no `/models`
    // is common and an endpoint that is simply unreachable must not be reported as one.
    let defaults = select_defaults(&[], provider);
    let ping = test_model_prompt(base_url, api_key, &defaults.balanced).await;

    if ping.status == ModelValidationStatus::AuthError {
        return ProviderModelsOutcome::ApiKeyError {
            message: ping
                .error_message
                .unwrap_or_else(|| "Invalid API Key for this endpoint.".to_string()),
        };
    }

    let unreachable = matches!(
        ping.status,
        ModelValidationStatus::Unknown | ModelValidationStatus::Timeout
    ) && ping.error_message.as_deref().is_some_and(|message| {
        let lower = message.to_ascii_lowercase();
        lower.contains("connect") || lower.contains("http")
    });
    if unreachable {
        return ProviderModelsOutcome::BaseUrlError {
            message: ping
                .error_message
                .unwrap_or_else(|| "Could not reach the endpoint.".to_string()),
        };
    }

    ProviderModelsOutcome::CustomNames {
        defaults,
        provider,
        message: fetched.error_message.or(ping.error_message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn models(ids: &[&str]) -> Vec<DiscoveredModel> {
        ids.iter()
            .map(|id| DiscoveredModel {
                id: (*id).to_string(),
                display_name: (*id).to_string(),
            })
            .collect()
    }

    #[test]
    fn provider_is_detected_from_the_base_url() {
        for (url, expected) in [
            ("https://llmproxy.ivy.app", ModelProviderKind::Ivy),
            ("https://api.anthropic.com/v1", ModelProviderKind::Anthropic),
            (
                "https://generativelanguage.googleapis.com",
                ModelProviderKind::Google,
            ),
            (
                "https://my-gemini-gateway.internal",
                ModelProviderKind::Google,
            ),
            ("https://api.berget.ai/v1", ModelProviderKind::Berget),
            ("https://api.openai.com", ModelProviderKind::OpenAi),
            ("", ModelProviderKind::OpenAi),
            ("http://localhost:11434/v1", ModelProviderKind::Generic),
        ] {
            assert_eq!(ModelProviderKind::detect(url), expected, "{url}");
        }
    }

    /// Every tier's head candidate has to name a model that can actually be launched.
    ///
    /// The head is the one entry in each list that is returned *unverified*: `select_model` hands
    /// back `candidates[0]` verbatim when the endpoint lists nothing, so whatever sits there becomes
    /// the stored default without ever having been offered by a provider. Every other entry is only
    /// reached by matching an id the endpoint really returned, so it cannot invent one.
    ///
    /// `claude-sonnet-5-1` and `claude-haiku-5-1` headed the two Anthropic lists and neither is a
    /// real model — the Sonnet line stops at `claude-sonnet-5`, the Haiku line at
    /// `claude-haiku-4-5` — so onboarding against an endpoint that listed nothing stored an id that
    /// 404s at launch.
    ///
    /// `SPECS` is the launchable set for this purpose: it is the table the rest of the daemon
    /// resolves a model through, so an id absent from it has no context window, no pricing and no
    /// launch path. Matched exactly rather than through `model_specs::find`, whose longest-prefix
    /// fallback would happily resolve `claude-sonnet-5-1` to `claude-sonnet-5` and hide exactly the
    /// bug this test exists to catch.
    #[test]
    fn every_tier_head_names_a_launchable_model() {
        use super::super::model_specs::{strip_provider_prefix, SPECS};

        let launchable: Vec<String> = SPECS
            .iter()
            .map(|spec| normalize_model_id(spec.model_id.as_ref()))
            .collect();

        for kind in [
            ModelProviderKind::Generic,
            ModelProviderKind::Ivy,
            ModelProviderKind::Anthropic,
            ModelProviderKind::OpenAi,
            ModelProviderKind::Google,
            ModelProviderKind::Berget,
            ModelProviderKind::OpenCode,
        ] {
            for tier in [ProfileTier::Deep, ProfileTier::Balanced, ProfileTier::Quick] {
                let head = priorities(kind, tier)[0];

                // What an endpoint that listed nothing would store, which is the head verbatim.
                assert_eq!(
                    select_model(kind, tier, &[]),
                    head,
                    "{kind:?}/{tier:?}: the empty-listing default is the head candidate"
                );

                // A vendor-qualified head is still launchable — Berget's real wire id is
                // `moonshotai/Kimi-K3`, which `SPECS` carries unprefixed as `kimi-k3`. Any single
                // vendor segment is stripped, not just the handful `strip_provider_prefix` knows,
                // so the check is about whether the *model* exists rather than who serves it.
                let bare = head.rsplit('/').next().unwrap_or(head);
                let normalized = normalize_model_id(strip_provider_prefix(bare));
                assert!(
                    launchable.contains(&normalized),
                    "{kind:?}/{tier:?} heads its priority list with '{head}', which is not a \
                     launchable model id — it would be stored as the default and 404 at launch"
                );
            }
        }
    }

    /// V1 `ModelProfileSelector.SelectModel`: prioritised match, substring match, positional
    /// fallback, then the provider's own default.
    #[test]
    fn tier_defaults_are_chosen_from_what_the_endpoint_offers() {
        let anthropic = select_defaults(
            &models(&["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"]),
            ModelProviderKind::Anthropic,
        );
        assert_eq!(anthropic.deep, "claude-opus-5");
        assert_eq!(anthropic.balanced, "claude-sonnet-5");
        assert_eq!(anthropic.quick, "claude-haiku-4-5");

        // A dated or provider-qualified spelling is matched as a substring, and the id the endpoint
        // actually accepts is what gets stored.
        let dated = select_defaults(
            &models(&[
                "anthropic/claude-opus-5-20260101",
                "anthropic/claude-haiku-4-5",
            ]),
            ModelProviderKind::Anthropic,
        );
        assert_eq!(dated.deep, "anthropic/claude-opus-5-20260101");
        assert_eq!(dated.quick, "anthropic/claude-haiku-4-5");

        // Nothing recognisable: the tier's positional fallback, so three different models are still
        // offered rather than the same one three times.
        let unknown = select_defaults(
            &models(&["alpha", "beta", "gamma"]),
            ModelProviderKind::Generic,
        );
        assert_eq!(
            (
                unknown.deep.as_str(),
                unknown.balanced.as_str(),
                unknown.quick.as_str()
            ),
            ("alpha", "beta", "gamma")
        );

        // An empty list falls back to the provider's declared default, which is what the custom-name
        // fields are prefilled with.
        let none = select_defaults(&[], ModelProviderKind::OpenAi);
        assert_eq!(none.deep, "gpt-5.6-sol");
        assert_eq!(none.balanced, "gpt-5.6-terra");
        assert_eq!(none.quick, "gpt-5.6-luna");
        assert_eq!(
            select_defaults(&[], ModelProviderKind::Berget).balanced,
            "moonshotai/Kimi-K3"
        );
    }

    /// Anthropic's endpoint takes `x-api-key` and a version header rather than a bearer, and the Ivy
    /// proxy takes both because it accepts either SDK. Sending the wrong one reads as a refused
    /// credential, which the pane would report as a bad key.
    #[test]
    fn each_provider_gets_the_wire_protocol_it_expects() {
        let names = |url: &str| {
            auth_headers(url, "sk-test")
                .into_iter()
                .map(|(name, _)| name)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            names("https://api.anthropic.com/v1"),
            vec!["x-api-key", "anthropic-version"]
        );
        assert_eq!(names("https://api.openai.com"), vec!["authorization"]);
        assert_eq!(
            names("https://llmproxy.ivy.app"),
            vec!["authorization", "x-api-key"]
        );
        assert_eq!(names("http://localhost:11434/v1"), vec!["authorization"]);
        // The bearer really is a bearer.
        assert_eq!(
            auth_headers("https://api.openai.com", "sk-test")[0].1,
            "Bearer sk-test"
        );
    }

    /// V1's own vectors, from `Ivy.Tendril.Agents.Test/Helpers/ModelProfileSelectorTests.cs`. They pin
    /// the two parts of `SelectModel` that are easy to get wrong: the candidate list is walked **in
    /// order** rather than scored, and a candidate matches an available id by substring as well as by
    /// equality.
    #[test]
    fn v1s_model_profile_selector_vectors_still_hold() {
        let ivy = |ids: &[&str]| select_defaults(&models(ids), ModelProviderKind::Ivy);

        let with_38 = ivy(&[
            "claude-opus-4",
            "claude-opus-5",
            "claude-sonnet-5",
            "gemini-2.5-flash-lite",
            "gemini-3.8-flash",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
        ]);
        assert_eq!(with_38.deep, "claude-opus-5");
        assert_eq!(with_38.balanced, "gemini-3.8-flash");
        assert_eq!(with_38.quick, "gemini-3.8-flash");

        let with_37 = ivy(&[
            "claude-opus-4",
            "claude-opus-5",
            "claude-sonnet-5",
            "gemini-2.5-flash-lite",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
        ]);
        assert_eq!(with_37.deep, "claude-opus-5");
        assert_eq!(with_37.balanced, "gemini-3.7-flash");
        assert_eq!(with_37.quick, "gemini-3.7-flash");

        let with_36 = ivy(&[
            "claude-opus-4",
            "claude-opus-5",
            "claude-sonnet-5",
            "gemini-2.5-flash-lite",
            "gemini-3.6-flash",
        ]);
        assert_eq!(with_36.deep, "claude-opus-5");
        assert_eq!(with_36.balanced, "gemini-3.6-flash");
        assert_eq!(with_36.quick, "gemini-3.6-flash");

        // The substring match, which is what lets a candidate reach a provider's decorated spelling.
        let decorated = select_defaults(
            &models(&["claude-opus-5@eu", "claude-haiku-4-5@eu"]),
            ModelProviderKind::Anthropic,
        );
        assert_eq!(decorated.deep, "claude-opus-5@eu");
        assert_eq!(decorated.quick, "claude-haiku-4-5@eu");
    }

    #[test]
    fn model_and_chat_endpoints_follow_v1s_probing_order() {
        assert_eq!(
            model_list_endpoints("https://api.openai.com"),
            vec![
                "https://api.openai.com/v1/models",
                "https://api.openai.com/models"
            ]
        );
        assert_eq!(
            model_list_endpoints("http://localhost:11434/v1/"),
            vec!["http://localhost:11434/v1/models"]
        );
        assert_eq!(
            model_list_endpoints("https://api.anthropic.com"),
            vec!["https://api.anthropic.com/v1/models"]
        );
        assert_eq!(
            chat_endpoints("https://api.anthropic.com"),
            vec!["https://api.anthropic.com/v1/messages"]
        );
        assert_eq!(
            chat_endpoints("https://api.berget.ai/v1"),
            vec!["https://api.berget.ai/v1/chat/completions"]
        );
    }

    /// V1 `ParseModelsJson`, all three shapes, plus the display name a declared row lends an id.
    #[test]
    fn every_listing_shape_v1_accepts_is_parsed() {
        let openai = parse_models_json(
            r#"{"data":[{"id":"gpt-5.6-sol"},{"id":"o3","name":"o3 reasoning"}]}"#,
        );
        assert_eq!(openai[0].id, "gpt-5.6-sol");
        // `catalog.rs` declares this id, so its own label wins over the endpoint's silence.
        assert_eq!(openai[0].display_name, "GPT-5.6-Sol");
        assert_eq!(openai[1].display_name, "O3");

        let anthropic = parse_models_json(
            r#"{"data":[{"id":"claude-nova-9","display_name":"Claude Nova 9"}]}"#,
        );
        assert_eq!(anthropic[0].id, "claude-nova-9");
        // Not declared anywhere: the endpoint's own name is used, and the row stays out of the
        // catalogue.
        assert_eq!(anthropic[0].display_name, "Claude Nova 9");

        let ollama = parse_models_json(r#"{"models":[{"name":"qwen3:32b"},{"model":"llama4"}]}"#);
        assert_eq!(
            ollama.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["qwen3:32b", "llama4"]
        );

        let bare = parse_models_json(r#"[{"id":"custom-1"},{"id":"custom-1"}]"#);
        assert_eq!(bare.len(), 1, "the same id twice is listed once");

        assert!(parse_models_json("not json").is_empty());
        assert!(parse_models_json(r#"{"data":[]}"#).is_empty());
    }

    /// A fetched listing is ordered on the way out, so the picker does not change its mind about
    /// ordering depending on whether a fetch happened to succeed (issue #224).
    ///
    /// This pins the half of the behaviour that surprises people: `sort_models` is canonical *within*
    /// a provider, and keeps providers themselves in the order they first appear. Google leads here
    /// only because the endpoint mentioned a Gemini model first. V1 is the same — see the note on the
    /// `sort_models` call, and `ModelCatalogSorter.Sort`'s own "preserving appearance order of
    /// providers".
    #[test]
    fn a_fetched_listing_comes_back_ordered() {
        let shuffled = parse_models_json(
            r#"{"data":[
                {"id":"gemini-3.7-flash"},
                {"id":"claude-sonnet-5"},
                {"id":"gemini-3.8-flash"},
                {"id":"claude-opus-4"},
                {"id":"claude-opus-5"},
                {"id":"claude-haiku-5"}
            ]}"#,
        );

        assert_eq!(
            shuffled.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec![
                // Google first: `gemini-3.7-flash` was the first row, and newest wins inside the group.
                "gemini-3.8-flash",
                "gemini-3.7-flash",
                // Then Anthropic, by tier (Opus, Sonnet, Haiku) with version descending inside a tier.
                "claude-opus-5",
                "claude-opus-4",
                "claude-sonnet-5",
                "claude-haiku-5",
            ]
        );

        // The other listing shapes reach the same sort, because they share one exit.
        let ollama = parse_models_json(
            r#"{"models":[{"name":"claude-haiku-5"},{"model":"claude-opus-5"}]}"#,
        );
        assert_eq!(
            ollama.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["claude-opus-5", "claude-haiku-5"]
        );

        let bare = parse_models_json(r#"[{"id":"claude-haiku-5"},{"id":"claude-opus-5"}]"#);
        assert_eq!(
            bare.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["claude-opus-5", "claude-haiku-5"]
        );
    }

    /// V1 `ExtractErrorMessage` and `CleanNestedErrorMessage`.
    #[test]
    fn provider_errors_are_reduced_to_their_message() {
        assert_eq!(
            extract_error_message(r#"{"error":{"message":"Incorrect API key provided"}}"#, 401),
            "Incorrect API key provided"
        );
        assert_eq!(
            extract_error_message(r#"{"error":"model_not_found"}"#, 404),
            "model_not_found"
        );
        assert_eq!(
            extract_error_message(r#"{"detail":"Not authenticated"}"#, 403),
            "Not authenticated"
        );
        assert_eq!(extract_error_message("", 502), "HTTP 502");
        // A provider quoting another provider's body: the inner message is the readable part.
        assert_eq!(
            extract_error_message(
                r#"{"error":{"message":"upstream said {'message': '/chat/completions: no such model `zz`'}"}}"#,
                400
            ),
            "no such model zz"
        );
    }

    #[test]
    fn auth_and_model_failures_are_told_apart() {
        assert!(is_auth_failure(401, "nope"));
        assert!(is_auth_failure(400, "invalid_api_key"));
        assert!(is_auth_failure(
            400,
            "API key not valid. Please pass a valid API key."
        ));
        assert!(!is_auth_failure(404, "model_not_found"));
        assert!(is_invalid_model("The model `gpt-9` does not exist"));
        assert!(!is_invalid_model("rate limit reached"));
    }

    /// The key must not survive in anything that leaves this module, including the forms providers
    /// echo it in.
    #[test]
    fn the_api_key_is_redacted_from_every_message() {
        let key = "sk-proj-abcdef0123456789";
        for message in [
            format!("Incorrect API key provided: {key}"),
            format!("Incorrect API key provided: {}...", &key[..12]),
            format!("key ...{} was rejected", &key[key.len() - 4..]),
        ] {
            let redacted = redact(&message, &[key]);
            assert!(!redacted.contains(key), "{redacted}");
            assert!(!redacted.contains(&key[..12]), "{redacted}");
            assert!(redacted.contains("***"), "{redacted}");
        }

        // A short or empty secret is not a secret, and must not turn every message into asterisks.
        assert_eq!(redact("hello", &[""]), "hello");
        assert_eq!(redact("hello", &["l"]), "hello");
    }

    #[tokio::test]
    async fn an_unconfigured_endpoint_is_reported_before_any_request() {
        assert_eq!(
            discover_provider_models("", "sk-test").await,
            ProviderModelsOutcome::BaseUrlError {
                message: "API Base URL is required.".to_string()
            }
        );
        assert_eq!(
            discover_provider_models("https://api.openai.com", "  ").await,
            ProviderModelsOutcome::ApiKeyError {
                message: "API Key is required.".to_string()
            }
        );
    }

    /// Nothing is listening on this port, so the fetch fails at the transport and the ping does too —
    /// which is V1's base-URL error rather than "type your model names".
    #[tokio::test]
    async fn an_unreachable_endpoint_is_a_base_url_error() {
        let outcome = discover_provider_models("http://127.0.0.1:1/v1", "sk-test").await;
        match outcome {
            ProviderModelsOutcome::BaseUrlError { message } => {
                assert!(!message.contains("sk-test"), "{message}");
            }
            other => panic!("expected a base URL error, got {other:?}"),
        }
    }
}
