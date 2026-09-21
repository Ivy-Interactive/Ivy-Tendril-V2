use crate::state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::{load_config, update_config_raw};
use tendril_core::config_text::{read_config_text_masked, write_config_text_unmasked};

pub async fn get_config_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    Json(settings)
}

pub async fn put_config_handler(
    State(state): State<Arc<AppState>>,
    Json(incoming): Json<serde_json::Value>,
) -> impl IntoResponse {
    let result = update_config_raw(&state.config_path, &incoming);
    // Dropped whatever the outcome: a partial write still changes what the next request must see, and
    // mtime granularity means the cached snapshot cannot be relied on to notice a same-tick write.
    state.invalidate_settings_cache();

    match result {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({ "status": "ok", "message": "Config updated" })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Failed to update config: {}", e) })),
        ),
    }
}

/// The body of `PUT /api/config/text`: the operator's own bytes, mask sentinels and all.
///
/// A struct rather than `String` so the route keeps a JSON content type, matching `PUT /api/config`
/// and the bridge's `put_config_text`, which sends `{ "text": ... }`.
#[derive(Debug, Deserialize)]
pub struct ConfigTextBody {
    pub text: String,
}

/// `config.yaml` verbatim with every secret masked (`GET /api/config/text`).
///
/// Separate from [`get_config_handler`] because that one round-trips through `serde` and drops the
/// comments, key order and blank lines the operator wrote - keeping those is the entire reason the
/// in-app editor exists rather than the Settings form.
///
/// A failure is served as a failure rather than as a partial document. `mask_config_text` errors
/// exactly when it cannot be certain it has found the whole of a secret's value - a block scalar
/// under `apiKey`, a flow mapping - and in that case the safe answer is to refuse to open the file,
/// not to hand the webview a document that might still hold a credential. The status is 500 because
/// the request was fine and the file on disk is what cannot be served; the message names the path
/// and the shape, never the value (see the error constructors in `config_text`).
///
/// Deliberately no `tracing` line carrying the body: it is `config.yaml`.
pub async fn get_config_text_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match read_config_text_masked(&state.config_path) {
        Ok(masked) => (StatusCode::OK, Json(json!(masked))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

/// Writes an edited `config.yaml` back (`PUT /api/config/text`).
///
/// The daemon resolves each untouched sentinel to the stored value *by path* and validates the
/// result before anything is written, so a save cannot leave a daemon that no longer loads its own
/// config - the defect in V1's `RawConfigEditorView.cs`, which wrote whatever was in the box.
///
/// `400` for every failure, including the ones that are really about the file on disk. They are all
/// the same thing to the editor: the submission was not accepted and the text is still the user's to
/// fix. `e.to_string()` is safe to return because every error this path can produce is built without
/// the offending value - `validation_error_without_secrets` re-runs a failed parse against the
/// still-masked submission precisely so the message quotes a placeholder instead of an API key.
///
/// Deliberately no `tracing` line: mid-edit the text can hold a credential the operator has typed
/// and not yet saved, which makes a log line the cheapest possible way to leak one.
pub async fn put_config_text_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConfigTextBody>,
) -> impl IntoResponse {
    let result = write_config_text_unmasked(&state.config_path, &body.text);
    // Invalidated whatever the outcome, for the reason `put_config_handler` gives: a partial write
    // still changes what the next request must see, and mtime granularity means the cached snapshot
    // cannot be relied on to notice a same-tick write.
    state.invalidate_settings_cache();

    match result {
        Ok(()) => (
            StatusCode::OK,
            Json(json!({ "status": "ok", "message": "config.yaml saved" })),
        ),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}
