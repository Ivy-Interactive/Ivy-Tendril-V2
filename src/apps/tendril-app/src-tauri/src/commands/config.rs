use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{
    CreateProjectDto, DoctorCheckDto, ModelCatalogStatusDto, OnboardingStatusDto,
    ProjectSummaryDto, SubscribeOutcomeDto, TendrilConfigDto, VersionInfoDto,
};
use crate::service::review_action_bridge::{self, StartedReviewAction};

#[tauri::command]
pub async fn cmd_list_projects() -> Result<Vec<ProjectSummaryDto>, BridgeError> {
    get_client_from_master()?.list_projects().await
}

#[tauri::command]
pub async fn cmd_get_config() -> Result<TendrilConfigDto, BridgeError> {
    get_client_from_master()?.get_config().await
}

#[tauri::command]
pub async fn cmd_get_models_status() -> Result<ModelCatalogStatusDto, BridgeError> {
    get_client_from_master()?.get_models_status().await
}

#[tauri::command]
pub async fn cmd_refresh_models() -> Result<ModelCatalogStatusDto, BridgeError> {
    get_client_from_master()?.refresh_models().await
}

/// Writes a single top-level config key, merged into `config.yaml` server-side. The wizard uses it
/// for `codingAgent`; nothing else is touched.
#[tauri::command]
pub async fn cmd_put_config(key: String, value: serde_json::Value) -> Result<(), BridgeError> {
    get_client_from_master()?.put_config(&key, value).await
}

/// `config.yaml` as text, with its secrets already masked daemon-side (`GET /api/config/text`).
///
/// A command rather than a `fetch` for the reason every route on this file is one: the daemon's
/// bearer secret is read from `.master` natively and never crosses into the webview, and there is no
/// `/api` proxy outside the dev server, so a relative `fetch` from the packaged app resolves against
/// the asset origin and reaches neither the daemon nor a credential. `api/configTextApi.ts` picks
/// between this and `fetch` once, by host - the two paths are exclusive rather than a fallback
/// chain, so a real rejection here stays the reason the operator sees.
///
/// The reply comes back untouched. It is `config.yaml` itself, so this side neither parses it nor
/// traces it: the daemon is the only side that may see the unmasked values, and it fails this route
/// closed rather than serving a file whose secrets it could not confidently mask.
#[tauri::command]
pub async fn cmd_get_config_text() -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.get_config_text().await
}

/// Writes an edited `config.yaml` back (`PUT /api/config/text`).
///
/// A command for the same reason as `cmd_get_config_text`, plus one of its own: the daemon resolves
/// the mask sentinels the operator left in place back to the stored secrets, which only it can read.
///
/// Deliberately no `tracing` line carrying `text`, unlike most write commands. Mid-edit the buffer
/// can hold an API key the operator has typed and not yet saved, and a log line is the cheapest way
/// for one to end up in a bug report. `text` is passed straight through and the reply handed back
/// untouched - a property that holds only as long as this stays a delegation.
#[tauri::command]
pub async fn cmd_put_config_text(text: String) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.put_config_text(&text).await
}

#[tauri::command]
pub async fn cmd_get_onboarding_status() -> Result<OnboardingStatusDto, BridgeError> {
    get_client_from_master()?.get_onboarding_status().await
}

#[tauri::command]
pub async fn cmd_complete_onboarding() -> Result<(), BridgeError> {
    get_client_from_master()?.complete_onboarding().await
}

#[tauri::command]
pub async fn cmd_dismiss_onboarding() -> Result<(), BridgeError> {
    get_client_from_master()?.dismiss_onboarding().await
}

#[tauri::command]
pub async fn cmd_subscribe_newsletter(email: String) -> Result<SubscribeOutcomeDto, BridgeError> {
    get_client_from_master()?.subscribe_newsletter(&email).await
}

#[tauri::command]
pub async fn cmd_run_doctor() -> Result<Vec<DoctorCheckDto>, BridgeError> {
    get_client_from_master()?.run_doctor().await
}

#[tauri::command]
pub async fn cmd_create_project(
    request: CreateProjectDto,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.create_project(request).await
}

/// Adds one repository to an existing project (`POST /api/projects/:name/repos`).
///
/// The project settings screen used to add a repository by writing the whole `repos` list back
/// through `cmd_put_config`, which is `PUT /api/config` and does not clone: a remote URL was stored
/// verbatim, credentials and all, and `resolve_working_directory` then skipped the entry because its
/// path is not a directory. Only this route clones, so only this route may add a repository.
///
/// No `tracing` line, for the reason `cmd_put_config_text` has none: `path` can be a URL with a
/// token embedded in it, and a log line is the cheapest way for one to reach a bug report. The reply
/// is the stored `RepoRef` — the clone's path, never the URL — and is handed back untouched.
#[tauri::command]
pub async fn cmd_add_project_repo(
    project_name: String,
    path: String,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .add_project_repo(&project_name, &path)
        .await
}

/// Starts a review action and returns the session the webview must address to talk to it.
///
/// The stream itself is consumed natively — `invoke` cannot stream, and the route is
/// bearer-authenticated with a native-only secret — and re-emitted as `review-action-event`. The
/// caller should already be listening for those: the process can write before this return value has
/// crossed back over the `invoke` boundary.
#[tauri::command]
pub async fn cmd_get_version_info() -> Result<VersionInfoDto, BridgeError> {
    get_client_from_master()?.get_version_info().await
}

#[tauri::command]
pub async fn cmd_check_version_now() -> Result<VersionInfoDto, BridgeError> {
    get_client_from_master()?.check_version_now().await
}

#[tauri::command]
pub async fn cmd_execute_review_action(
    app_handle: tauri::AppHandle,
    project_name: String,
    action_name: String,
    plan_id: Option<String>,
    worktree: Option<String>,
) -> Result<StartedReviewAction, BridgeError> {
    let response = get_client_from_master()?
        .execute_review_action(
            &project_name,
            &action_name,
            plan_id.as_deref(),
            worktree.as_deref(),
        )
        .await?;

    review_action_bridge::start(app_handle, response).await
}

/// Forwards keystrokes to a running review action. `data` is base64 of the raw bytes.
#[tauri::command]
pub async fn cmd_send_review_action_input(
    project_name: String,
    action_name: String,
    session_id: String,
    data: String,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .review_action_input(&project_name, &action_name, &session_id, &data)
        .await
}

/// Reports the terminal's size to a running review action, so a process that wraps its own output
/// redraws to fit.
#[tauri::command]
pub async fn cmd_resize_review_action(
    project_name: String,
    action_name: String,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .review_action_resize(&project_name, &action_name, &session_id, rows, cols)
        .await
}

/// Stops consuming a review action's stream, without stopping the process: the app it started has to
/// keep serving the preview that replaces the terminal.
#[tauri::command]
pub async fn cmd_close_review_action(session_id: String) -> Result<bool, BridgeError> {
    Ok(review_action_bridge::close(&session_id))
}
