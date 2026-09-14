//! Team Vault commands — a thin proxy over the daemon's `/api/vaults` routes.
//!
//! Plan 00571 shipped the vault service, the CLI and the HTTP surface but no Tauri commands, so these
//! exist for the same reason the plan commands do: the bearer secret lives in `.master` on the native
//! side and must not travel into the webview, so the webview cannot call the daemon itself.
//!
//! Payloads are forwarded as JSON (see `TendrilClient::vault_request`) rather than re-declared here.

use super::get_client_from_master;
use crate::error::BridgeError;

/// `default` means "the primary vault", which is what the service resolves a blank id to as well.
/// The UI omits the id until the operator picks a specific vault from the switcher.
fn vault_id_or_default(vault_id: Option<String>) -> String {
    match vault_id {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => "default".to_string(),
    }
}

#[tauri::command]
pub async fn cmd_vault_list() -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.list_vaults().await
}

#[tauri::command]
pub async fn cmd_vault_status(vault_id: Option<String>) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .get_vault_status(&vault_id_or_default(vault_id))
        .await
}

#[tauri::command]
pub async fn cmd_vault_catalog(vault_id: Option<String>) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .get_vault_catalog(&vault_id_or_default(vault_id))
        .await
}

#[tauri::command]
pub async fn cmd_vault_github_accounts() -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.list_github_accounts().await
}

#[tauri::command]
pub async fn cmd_vault_discover() -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.discover_vaults().await
}

/// Create a vault repository on GitHub. `private` defaults to true on the service side: a vault holds
/// a team's configuration, and an accidentally public one cannot be un-published.
#[tauri::command]
pub async fn cmd_vault_create(
    name: String,
    is_private: Option<bool>,
    org: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    if name.trim().is_empty() {
        return Err(BridgeError::validation("Vault repository name is required"));
    }

    get_client_from_master()?
        .create_vault_repo(name.trim(), is_private.unwrap_or(true), org.as_deref())
        .await
}

#[tauri::command]
pub async fn cmd_vault_connect(
    repo_url: String,
    name: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    if repo_url.trim().is_empty() {
        return Err(BridgeError::validation("Vault repository URL is required"));
    }

    get_client_from_master()?
        .connect_vault(repo_url.trim(), name.as_deref())
        .await
}

#[tauri::command]
pub async fn cmd_vault_disconnect(
    vault_id: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .disconnect_vault(&vault_id_or_default(vault_id))
        .await
}

#[tauri::command]
pub async fn cmd_vault_set_always_up_to_date(
    vault_id: Option<String>,
    always_up_to_date: bool,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .set_vault_always_up_to_date(&vault_id_or_default(vault_id), always_up_to_date)
        .await
}

#[tauri::command]
pub async fn cmd_vault_pull(vault_id: Option<String>) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .pull_vault_latest(&vault_id_or_default(vault_id))
        .await
}

/// What a local project could publish, for the export dialog's asset picker.
#[tauri::command]
pub async fn cmd_vault_project_assets(
    project_name: String,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .collect_project_assets(&project_name)
        .await
}

#[tauri::command]
pub async fn cmd_vault_push(
    request: serde_json::Value,
    vault_id: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .push_to_vault(&vault_id_or_default(vault_id), request)
        .await
}

#[tauri::command]
pub async fn cmd_vault_import(
    request: serde_json::Value,
    vault_id: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .import_vault_project(&vault_id_or_default(vault_id), request, false)
        .await
}

/// Adopt a vault project into the local project of the same name, keeping local repo paths.
#[tauri::command]
pub async fn cmd_vault_merge(
    request: serde_json::Value,
    vault_id: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .import_vault_project(&vault_id_or_default(vault_id), request, true)
        .await
}

/// Open a pull request that removes a project from the vault. Nothing local is deleted.
#[tauri::command]
pub async fn cmd_vault_delete_project(
    project_name: String,
    vault_id: Option<String>,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?
        .delete_vault_project(&vault_id_or_default(vault_id), &project_name)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_or_blank_vault_id_becomes_default() {
        assert_eq!(vault_id_or_default(None), "default");
        assert_eq!(vault_id_or_default(Some(String::new())), "default");
        assert_eq!(vault_id_or_default(Some("   ".to_string())), "default");
    }

    #[test]
    fn a_named_vault_id_is_kept_and_trimmed() {
        assert_eq!(
            vault_id_or_default(Some("abc12345".to_string())),
            "abc12345"
        );
        assert_eq!(
            vault_id_or_default(Some(" abc12345 ".to_string())),
            "abc12345"
        );
    }

    #[tokio::test]
    async fn creating_a_vault_without_a_name_is_rejected_before_any_request() {
        // The guard runs before `get_client_from_master`, so this holds with no daemon running.
        let err = cmd_vault_create("  ".to_string(), None, None)
            .await
            .expect_err("a blank repository name must be refused");
        assert_eq!(err.code, "VALIDATION_ERROR");
    }

    #[tokio::test]
    async fn connecting_without_a_url_is_rejected_before_any_request() {
        let err = cmd_vault_connect("  ".to_string(), None)
            .await
            .expect_err("a blank repository URL must be refused");
        assert_eq!(err.code, "VALIDATION_ERROR");
    }
}
