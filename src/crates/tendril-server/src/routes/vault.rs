//! `/api/vaults` — the HTTP surface over [`tendril_core::vault`].
//!
//! This route table is plan 00574's contract for the Settings UI, so treat the paths, methods and
//! body shapes as a public API.
//!
//! `:id` accepts the literal `default`, meaning "the primary vault", which is what the CLI sends when
//! the user names no vault. Any other id must exist: an unknown one is a 404 rather than a silent
//! answer about a different vault. Handlers that reach GitHub can be slow, but none of them holds a
//! lock — the vault state lives in `config.yaml` and is re-read per request.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::load_config;
use tendril_core::vault::{self, VaultExportRequest, VaultImportRequest};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectVaultRequest {
    pub repo_url: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultRequest {
    pub repo_name: String,
    /// Defaults to a private repository: a vault holds a team's configuration, and an accidental
    /// public one cannot be un-published.
    #[serde(default = "default_private")]
    pub private: bool,
    #[serde(default)]
    pub org: Option<String>,
}

fn default_private() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetAlwaysUpToDateRequest {
    pub always_up_to_date: bool,
}

/// `VaultImportRequest` plus the `merge` flag that picks between replace and merge semantics.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProjectRequest {
    #[serde(flatten)]
    pub request: VaultImportRequest,
    #[serde(default)]
    pub merge: bool,
}

/// `default` and a blank id both mean "the primary vault"; anything else is passed through.
fn requested_id(id: &str) -> Option<&str> {
    let id = id.trim();
    (!id.is_empty() && !id.eq_ignore_ascii_case("default")).then_some(id)
}

/// Rejects an id that names no vault, so a typo does not get answered as if it were `default`.
fn ensure_vault_exists(state: &Arc<AppState>, id: &str) -> Result<(), axum::response::Response> {
    let Some(id) = requested_id(id) else {
        return Ok(());
    };

    let settings = load_config(&state.config_path).unwrap_or_default();
    if vault::find_vault(&vault::load_vaults(&settings), id).is_some() {
        return Ok(());
    }

    Err(not_found(format!("Vault '{}' not found", id)))
}

/// Rejects a project the vault does not contain, so the UI can tell "no such project" apart from a
/// git or GitHub failure, which the service reports the same way.
fn ensure_vault_project_exists(
    state: &Arc<AppState>,
    id: &str,
    project: &str,
) -> Result<(), axum::response::Response> {
    let settings = load_config(&state.config_path).unwrap_or_default();
    let vaults = vault::load_vaults(&settings);
    let Some(resolved) = vault::resolve_vault(&vaults, requested_id(id)) else {
        return Err(not_found("No vault is configured"));
    };

    if vault::vault_project_dir(&state.tendril_home, &resolved, project).exists() {
        return Ok(());
    }

    Err(not_found(format!(
        "Project '{}' was not found in vault '{}'",
        project, resolved.id
    )))
}

fn not_found(message: impl std::fmt::Display) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": message.to_string() })),
    )
        .into_response()
}

fn internal_error(what: &str, e: impl std::fmt::Display) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": format!("Failed to {}: {}", what, e) })),
    )
        .into_response()
}

/// A `success: false` result answers 500 carrying the whole body: the UI needs the `message` and
/// `errorMessage`, not just a status code. Only genuinely missing things answer 404.
fn result_status(success: bool) -> StatusCode {
    if success {
        StatusCode::OK
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

pub async fn list_vaults(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match vault::get_vaults(&state.tendril_home) {
        Ok(statuses) => (StatusCode::OK, Json(json!(statuses))).into_response(),
        Err(e) => internal_error("list vaults", e),
    }
}

pub async fn get_vault_status(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(response) = ensure_vault_exists(&state, &id) {
        return response;
    }

    match vault::get_status(&state.tendril_home, requested_id(&id)) {
        Ok(status) => (StatusCode::OK, Json(json!(status))).into_response(),
        Err(e) => internal_error("get vault status", e),
    }
}

pub async fn connect_vault(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConnectVaultRequest>,
) -> impl IntoResponse {
    match vault::connect_vault(&state.tendril_home, &body.repo_url, body.name.as_deref()).await {
        Ok(result) => vault_result_response(result),
        Err(e) => internal_error("connect vault", e),
    }
}

pub async fn create_vault_repo(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateVaultRequest>,
) -> impl IntoResponse {
    match vault::create_vault_repo(
        &state.tendril_home,
        &body.repo_name,
        body.private,
        body.org.as_deref(),
    )
    .await
    {
        Ok(result) => vault_result_response(result),
        Err(e) => internal_error("create vault repository", e),
    }
}

pub async fn discover_vaults(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match vault::discover_existing_vaults(&state.tendril_home).await {
        Ok(repos) => (StatusCode::OK, Json(json!(repos))).into_response(),
        Err(e) => internal_error("discover vaults", e),
    }
}

pub async fn github_accounts() -> impl IntoResponse {
    match vault::list_github_accounts().await {
        Ok(accounts) => (StatusCode::OK, Json(json!(accounts))).into_response(),
        Err(e) => internal_error("list GitHub accounts", e),
    }
}

pub async fn disconnect_vault(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(response) = ensure_vault_exists(&state, &id) {
        return response;
    }

    match vault::disconnect_vault(&state.tendril_home, requested_id(&id)) {
        Ok(result) => vault_result_response(result),
        Err(e) => internal_error("disconnect vault", e),
    }
}

pub async fn set_always_up_to_date(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<SetAlwaysUpToDateRequest>,
) -> impl IntoResponse {
    if let Err(response) = ensure_vault_exists(&state, &id) {
        return response;
    }

    match vault::set_always_up_to_date(
        &state.tendril_home,
        body.always_up_to_date,
        requested_id(&id),
    ) {
        Ok(result) => vault_result_response(result),
        Err(e) => internal_error("set vault auto-sync", e),
    }
}

pub async fn get_catalog(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(response) = ensure_vault_exists(&state, &id) {
        return response;
    }

    match vault::get_catalog(&state.tendril_home, requested_id(&id)) {
        Ok(catalog) => (StatusCode::OK, Json(json!(catalog))).into_response(),
        Err(e) => internal_error("read vault catalog", e),
    }
}

pub async fn pull_latest(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(response) = ensure_vault_exists(&state, &id) {
        return response;
    }

    match vault::pull_latest(&state.tendril_home, requested_id(&id)).await {
        Ok(result) => (result_status(result.success), Json(json!(result))).into_response(),
        Err(e) => internal_error("pull vault changes", e),
    }
}

pub async fn push_and_create_pr(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<VaultExportRequest>,
) -> impl IntoResponse {
    if let Err(response) = ensure_vault_exists(&state, &id) {
        return response;
    }

    match vault::push_and_create_pr(&state.tendril_home, &body, requested_id(&id)).await {
        Ok(result) => (result_status(result.success), Json(json!(result))).into_response(),
        Err(e) => internal_error("push to vault", e),
    }
}

pub async fn import_project(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<ImportProjectRequest>,
) -> impl IntoResponse {
    if let Err(response) = ensure_vault_exists(&state, &id) {
        return response;
    }
    if let Err(response) = ensure_vault_project_exists(&state, &id, &body.request.project_name) {
        return response;
    }

    let vault_id = requested_id(&id);
    let result = if body.merge {
        vault::merge_project(&state.tendril_home, &body.request, vault_id)
    } else {
        vault::import_project(&state.tendril_home, &body.request, vault_id).await
    };

    match result {
        Ok(result) => vault_result_response(result),
        Err(e) => internal_error("import vault project", e),
    }
}

pub async fn delete_project_from_vault(
    State(state): State<Arc<AppState>>,
    Path((id, project)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(response) = ensure_vault_exists(&state, &id) {
        return response;
    }
    if let Err(response) = ensure_vault_project_exists(&state, &id, &project) {
        return response;
    }

    match vault::delete_project_from_vault(&state.tendril_home, &project, requested_id(&id)).await {
        Ok(result) => (result_status(result.success), Json(json!(result))).into_response(),
        Err(e) => internal_error("delete vault project", e),
    }
}

fn vault_result_response(result: vault::VaultResult) -> axum::response::Response {
    (result_status(result.success), Json(json!(result))).into_response()
}
