//! Vaults — discovery, connection, and moving projects in and out of them.

use super::{path_segment, TendrilClient};
use crate::error::BridgeError;
use serde_json::json;

impl TendrilClient {
    /// One `/api/vaults` request, forwarding the JSON body both ways.
    ///
    /// Vault payloads are owned by `tendril_core::vault::models` and consumed directly by the
    /// webview's `types/vault.ts`, so the native side is a transport rather than a third copy of the
    /// schema: a copy here could only drift, and would silently drop fields the UI later needs.
    ///
    /// A failed *vault result* (`{ success: false, message, errorMessage }`) answers 500 while
    /// carrying the text the dialogs must show, so a body that looks like one is returned as `Ok`
    /// and the caller reads `success`. Only a missing thing (404) or an unparseable answer becomes a
    /// `BridgeError`.
    async fn vault_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.client.request(method, &url).headers(self.headers());
        if let Some(body) = body {
            request = request.json(&body);
        }

        let resp = request.send().await?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let parsed = serde_json::from_str::<serde_json::Value>(&text).ok();

        if status.is_success() {
            return parsed.ok_or_else(|| {
                BridgeError::with_details(
                    "VAULT_REQUEST_FAILED",
                    format!("The vault service answered {status} with a non-JSON body"),
                    text,
                )
            });
        }

        if let Some(value) = parsed.as_ref() {
            if value.get("success").and_then(|s| s.as_bool()) == Some(false) {
                return Ok(value.clone());
            }
        }

        let message = parsed
            .as_ref()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()))
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("Vault request to {path} failed ({status})"));

        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(BridgeError::not_found(message));
        }
        Err(BridgeError::with_details(
            "VAULT_REQUEST_FAILED",
            message,
            text,
        ))
    }

    pub async fn list_vaults(&self) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(reqwest::Method::GET, "/api/vaults", None)
            .await
    }

    pub async fn get_vault_status(&self, vault_id: &str) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::GET,
            &format!("/api/vaults/{}", path_segment(vault_id)),
            None,
        )
        .await
    }

    pub async fn get_vault_catalog(
        &self,
        vault_id: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::GET,
            &format!("/api/vaults/{}/catalog", path_segment(vault_id)),
            None,
        )
        .await
    }

    pub async fn list_github_accounts(&self) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(reqwest::Method::GET, "/api/vaults/accounts", None)
            .await
    }

    pub async fn discover_vaults(&self) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(reqwest::Method::GET, "/api/vaults/discover", None)
            .await
    }

    pub async fn create_vault_repo(
        &self,
        repo_name: &str,
        private: bool,
        org: Option<&str>,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::POST,
            "/api/vaults/create",
            Some(json!({ "repoName": repo_name, "private": private, "org": org })),
        )
        .await
    }

    pub async fn connect_vault(
        &self,
        repo_url: &str,
        name: Option<&str>,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::POST,
            "/api/vaults",
            Some(json!({ "repoUrl": repo_url, "name": name })),
        )
        .await
    }

    pub async fn disconnect_vault(&self, vault_id: &str) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::DELETE,
            &format!("/api/vaults/{}", path_segment(vault_id)),
            None,
        )
        .await
    }

    pub async fn set_vault_always_up_to_date(
        &self,
        vault_id: &str,
        always_up_to_date: bool,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::PUT,
            &format!("/api/vaults/{}", path_segment(vault_id)),
            Some(json!({ "alwaysUpToDate": always_up_to_date })),
        )
        .await
    }

    pub async fn pull_vault_latest(
        &self,
        vault_id: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::POST,
            &format!("/api/vaults/{}/pull", path_segment(vault_id)),
            None,
        )
        .await
    }

    pub async fn collect_project_assets(
        &self,
        project_name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::GET,
            &format!("/api/vaults/project-assets/{}", path_segment(project_name)),
            None,
        )
        .await
    }

    pub async fn push_to_vault(
        &self,
        vault_id: &str,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::POST,
            &format!("/api/vaults/{}/push", path_segment(vault_id)),
            Some(request),
        )
        .await
    }

    /// Import or merge a vault project. Both are `POST /api/vaults/:id/projects`; `merge` picks
    /// between adopting a local project of the same name and creating a new one.
    pub async fn import_vault_project(
        &self,
        vault_id: &str,
        mut request: serde_json::Value,
        merge: bool,
    ) -> Result<serde_json::Value, BridgeError> {
        if let Some(object) = request.as_object_mut() {
            object.insert("merge".to_string(), json!(merge));
        }

        self.vault_request(
            reqwest::Method::POST,
            &format!("/api/vaults/{}/projects", path_segment(vault_id)),
            Some(request),
        )
        .await
    }

    pub async fn delete_vault_project(
        &self,
        vault_id: &str,
        project_name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.vault_request(
            reqwest::Method::DELETE,
            &format!(
                "/api/vaults/{}/projects/{}",
                path_segment(vault_id),
                path_segment(project_name)
            ),
            None,
        )
        .await
    }
}
