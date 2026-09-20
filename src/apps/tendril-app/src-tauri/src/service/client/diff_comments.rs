//! Draft diff comments — the unsent review notes a plan's diff view holds per file and change.

use super::{path_segment, urlencoding, TendrilClient};
use crate::error::BridgeError;
use crate::models::DraftCommentDto;
use serde_json::json;

impl TendrilClient {
    // --- Draft diff comments ---
    //
    // Every mutation returns the plan's new list, so the caller never has to re-fetch and stays
    // correct even when the WebSocket bridge is down.

    fn diff_comments_url(&self, id: &str) -> String {
        format!(
            "{}/api/plans/{}/diff-comments",
            self.base_url,
            path_segment(id)
        )
    }

    pub async fn list_diff_comments(&self, id: &str) -> Result<Vec<DraftCommentDto>, BridgeError> {
        let resp = self
            .client
            .get(self.diff_comments_url(id))
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_DIFF_COMMENTS_FAILED",
                format!("Failed to list diff comments for plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn upsert_diff_comment(
        &self,
        id: &str,
        comment: &DraftCommentDto,
    ) -> Result<Vec<DraftCommentDto>, BridgeError> {
        let resp = self
            .client
            .post(self.diff_comments_url(id))
            .headers(self.headers())
            .json(comment)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPSERT_DIFF_COMMENT_FAILED",
                format!("Failed to save diff comment on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn replace_diff_comments(
        &self,
        id: &str,
        comments: &[DraftCommentDto],
    ) -> Result<Vec<DraftCommentDto>, BridgeError> {
        let resp = self
            .client
            .put(self.diff_comments_url(id))
            .headers(self.headers())
            .json(&json!({ "comments": comments }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "REPLACE_DIFF_COMMENTS_FAILED",
                format!("Failed to replace diff comments on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn delete_diff_comment(
        &self,
        id: &str,
        file_path: &str,
        change_key: &str,
    ) -> Result<Vec<DraftCommentDto>, BridgeError> {
        let url = format!(
            "{}?filePath={}&changeKey={}",
            self.diff_comments_url(id),
            urlencoding(file_path),
            urlencoding(change_key)
        );
        let resp = self
            .client
            .delete(url)
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "DELETE_DIFF_COMMENT_FAILED",
                format!("Failed to delete diff comment on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Drop a plan's whole review — no query string means clear-all.
    pub async fn clear_diff_comments(&self, id: &str) -> Result<(), BridgeError> {
        let resp = self
            .client
            .delete(self.diff_comments_url(id))
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CLEAR_DIFF_COMMENTS_FAILED",
                format!("Failed to clear diff comments on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(())
    }
}
