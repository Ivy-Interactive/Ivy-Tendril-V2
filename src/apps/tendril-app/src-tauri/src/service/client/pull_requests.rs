//! Pull request status and the sync pass that refreshes it.

use super::TendrilClient;
use crate::error::BridgeError;
use crate::models::{PrStatusDto, PrSyncReportDto};

impl TendrilClient {
    pub async fn list_pull_requests(&self) -> Result<Vec<PrStatusDto>, BridgeError> {
        let url = format!("{}/api/pull-requests", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_PULL_REQUESTS_FAILED",
                format!("Failed to list pull requests ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn sync_pull_requests(&self) -> Result<PrSyncReportDto, BridgeError> {
        let url = format!("{}/api/pull-requests/sync", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;

        // A pass already in flight is not a failure — the caller just re-reads the list when the
        // running pass broadcasts its result.
        if resp.status() == reqwest::StatusCode::CONFLICT {
            return Err(BridgeError::new(
                "PR_SYNC_IN_PROGRESS",
                "A pull request sync is already running",
            ));
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "SYNC_PULL_REQUESTS_FAILED",
                format!("Failed to sync pull requests ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }
}
