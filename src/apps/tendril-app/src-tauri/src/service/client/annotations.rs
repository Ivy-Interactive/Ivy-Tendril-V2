//! Draft annotations — the free-standing notes a plan carries alongside its diff comments.

use super::{path_segment, urlencoding, TendrilClient};
use crate::error::BridgeError;
use crate::models::AnnotationDto;
use serde_json::json;

impl TendrilClient {
    // --- Draft annotations ---
    //
    // Same contract as the diff comments above: every mutation returns the plan's new list.

    fn annotations_url(&self, id: &str) -> String {
        format!(
            "{}/api/plans/{}/annotations",
            self.base_url,
            path_segment(id)
        )
    }

    pub async fn list_annotations(&self, id: &str) -> Result<Vec<AnnotationDto>, BridgeError> {
        let resp = self
            .client
            .get(self.annotations_url(id))
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_ANNOTATIONS_FAILED",
                format!("Failed to list annotations for plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn upsert_annotation(
        &self,
        id: &str,
        annotation: &AnnotationDto,
    ) -> Result<Vec<AnnotationDto>, BridgeError> {
        let resp = self
            .client
            .post(self.annotations_url(id))
            .headers(self.headers())
            .json(annotation)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPSERT_ANNOTATION_FAILED",
                format!("Failed to save annotation on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn replace_annotations(
        &self,
        id: &str,
        annotations: &[AnnotationDto],
    ) -> Result<Vec<AnnotationDto>, BridgeError> {
        let resp = self
            .client
            .put(self.annotations_url(id))
            .headers(self.headers())
            .json(&json!({ "annotations": annotations }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "REPLACE_ANNOTATIONS_FAILED",
                format!("Failed to replace annotations on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn delete_annotation(
        &self,
        id: &str,
        annotation_id: &str,
    ) -> Result<Vec<AnnotationDto>, BridgeError> {
        let url = format!(
            "{}?id={}",
            self.annotations_url(id),
            urlencoding(annotation_id)
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
                "DELETE_ANNOTATION_FAILED",
                format!("Failed to delete annotation on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Drop a plan's whole annotation set — no query string means clear-all.
    pub async fn clear_annotations(&self, id: &str) -> Result<(), BridgeError> {
        let resp = self
            .client
            .delete(self.annotations_url(id))
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CLEAR_ANNOTATIONS_FAILED",
                format!("Failed to clear annotations on plan '{id}' ({status}): {text}"),
            ));
        }

        Ok(())
    }
}
