//! A project's memory files and its repo-asset import — the routes behind Settings' project memory
//! table (`EditProjectMemorySheet`) and `ImportRepoAssetsDialog`.
//!
//! Plain JSON passthrough, like the vault calls: the shapes are the daemon's
//! (`routes/projects/memory.rs`, `routes/projects/repo_assets.rs`) and are not re-declared here.

use super::{path_segment, TendrilClient, CLONE_TIMEOUT};
use crate::error::BridgeError;

impl TendrilClient {
    async fn project_assets_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
        failure_code: &str,
        action: &str,
        timeout: Option<std::time::Duration>,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}{}", self.base_url, path);
        let mut request = self.client.request(method, &url).headers(self.headers());
        if let Some(body) = body {
            request = request.json(&body);
        }
        if let Some(timeout) = timeout {
            request = request.timeout(timeout);
        }
        let resp = request.send().await?;
        if !resp.status().is_success() {
            // `expect_success` answers `Err` for every non-2xx status, carrying the daemon's message.
            Self::expect_success(resp, failure_code, action).await?;
            return Err(BridgeError::new(
                failure_code,
                format!("Could not {action}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn list_project_memory(
        &self,
        project_name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.project_assets_request(
            reqwest::Method::GET,
            &format!("/api/projects/{}/memory", path_segment(project_name)),
            None,
            "PROJECT_MEMORY_FAILED",
            "list project memories",
            None,
        )
        .await
    }

    pub async fn get_project_memory(
        &self,
        project_name: &str,
        file_name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.project_assets_request(
            reqwest::Method::GET,
            &format!(
                "/api/projects/{}/memory/{}",
                path_segment(project_name),
                path_segment(file_name)
            ),
            None,
            "PROJECT_MEMORY_FAILED",
            "read the memory file",
            None,
        )
        .await
    }

    pub async fn put_project_memory(
        &self,
        project_name: &str,
        file_name: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        self.project_assets_request(
            reqwest::Method::PUT,
            &format!(
                "/api/projects/{}/memory/{}",
                path_segment(project_name),
                path_segment(file_name)
            ),
            Some(body),
            "PROJECT_MEMORY_FAILED",
            "save the memory file",
            None,
        )
        .await
    }

    pub async fn delete_project_memory(
        &self,
        project_name: &str,
        file_name: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        self.project_assets_request(
            reqwest::Method::DELETE,
            &format!(
                "/api/projects/{}/memory/{}",
                path_segment(project_name),
                path_segment(file_name)
            ),
            None,
            "PROJECT_MEMORY_FAILED",
            "delete the memory file",
            None,
        )
        .await
    }

    /// Scanning may clone a git URL first, so it gets the clone timeout rather than the shared 10s.
    pub async fn scan_repo_assets(
        &self,
        project_name: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        self.project_assets_request(
            reqwest::Method::POST,
            &format!(
                "/api/projects/{}/repo-assets/scan",
                path_segment(project_name)
            ),
            Some(body),
            "REPO_ASSETS_FAILED",
            "scan the repository",
            Some(CLONE_TIMEOUT),
        )
        .await
    }

    pub async fn import_repo_assets(
        &self,
        project_name: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, BridgeError> {
        self.project_assets_request(
            reqwest::Method::POST,
            &format!(
                "/api/projects/{}/repo-assets/import",
                path_segment(project_name)
            ),
            Some(body),
            "REPO_ASSETS_FAILED",
            "import from the repository",
            Some(CLONE_TIMEOUT),
        )
        .await
    }
}
