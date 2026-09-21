//! Uploading an attachment to a plan or chat session.

use super::{path_segment, urlencoding, TendrilClient};
use crate::error::BridgeError;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

impl TendrilClient {
    /// Stages an attached file with the daemon and answers with the absolute path it now lives at,
    /// inside `<TendrilHome>/Attachments/<session_id>/`.
    ///
    /// The bytes travel, not the source path: the daemon owns the Tendril home (and need not be on this
    /// machine), so it is the only thing that can write there, and handing it a path to copy *from*
    /// would give the route a file-reading half it has no business having. See
    /// `tendril_server::routes::attachments`.
    ///
    /// The credential is the ordinary bearer header here — unlike [`Self::get_local_file_data_url`],
    /// nothing about this request is made by the webview, so there is no reason for it to leave the
    /// `Authorization` header.
    pub async fn upload_attachment(
        &self,
        session_id: &str,
        file_name: &str,
        bytes: Vec<u8>,
    ) -> Result<crate::models::ChatAttachmentDto, BridgeError> {
        let url = format!(
            "{}/api/attachments/{}?fileName={}",
            self.base_url,
            path_segment(session_id),
            urlencoding(file_name)
        );

        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        );
        if let Some(ref secret) = self.secret {
            if let Ok(value) = HeaderValue::from_str(&format!("Bearer {secret}")) {
                headers.insert(AUTHORIZATION, value);
            }
        }

        let resp = self
            .client
            .post(&url)
            .headers(headers)
            .body(bytes)
            .send()
            .await?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(BridgeError::unauthenticated(
                "The daemon refused the credential for an attachment upload",
            ));
        }
        if !status.is_success() {
            let detail = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPLOAD_ATTACHMENT_FAILED",
                format!("Tendril would not store '{file_name}' ({status}): {detail}"),
            ));
        }

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Stored {
            path: String,
        }
        let stored: Stored = resp.json().await?;
        Ok(crate::models::ChatAttachmentDto {
            // The name the user picked the file by, not the name it was stored under: those differ
            // when the session already held a file of that name, and the chip has to keep reading the
            // way the user chose it.
            name: file_name.to_string(),
            path: stored.path,
            mime_type: None,
        })
    }
}
