//! The inbox: captured notes and the plan proposals distilled from them.

use super::{path_segment, TendrilClient};
use crate::error::BridgeError;
use serde_json::json;

impl TendrilClient {
    pub async fn post_inbox(
        &self,
        title: &str,
        description: &str,
        project: &str,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/inbox", self.base_url);
        let body = json!({
            "title": title,
            "description": description,
            "project": project,
        });

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "POST_INBOX_FAILED",
                format!("Failed to post to inbox ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Forces an assigned-issue sweep. The sweep report is returned for any status the service treats
    /// as success, so the caller can distinguish `Ran` from `AlreadyRunning`; only `NotMaster`
    /// (a `409`) surfaces as an error.
    pub async fn check_inbox(&self) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/inbox/check", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CHECK_INBOX_FAILED",
                format!("Failed to check for assigned issues ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Swept issues awaiting a decision. `state` of `None` uses the service default (`Pending`).
    pub async fn list_inbox_proposals(
        &self,
        state: Option<&str>,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = match state {
            Some(s) if !s.trim().is_empty() => format!(
                "{}/api/inbox/proposals?state={}",
                self.base_url,
                path_segment(s)
            ),
            _ => format!("{}/api/inbox/proposals", self.base_url),
        };
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_INBOX_PROPOSALS_FAILED",
                format!("Failed to list inbox proposals ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn accept_inbox_proposal(&self, id: i64) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/inbox/proposals/{}/accept", self.base_url, id);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "ACCEPT_INBOX_PROPOSAL_FAILED",
                format!("Failed to accept inbox proposal {id} ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn dismiss_inbox_proposal(&self, id: i64) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/inbox/proposals/{}/dismiss", self.base_url, id);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "DISMISS_INBOX_PROPOSAL_FAILED",
                format!("Failed to dismiss inbox proposal {id} ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }
}
