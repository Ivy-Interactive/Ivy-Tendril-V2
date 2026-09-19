//! `POST /api/attachments/:session_id?fileName=<name>` — stages a file the user attached.
//!
//! The body is the file's bytes, and the answer is the absolute path they were written to, inside
//! `<TendrilHome>/Attachments/<session_id>/`. That path is the whole point of the route: it is inside a
//! [`tendril_core::security::local_file_roots`] root, so `GET /ivy/local-file` will serve it back and a
//! chat attachment can be previewed. The original file — a screenshot on the user's Desktop, say — is
//! outside every root and never will be, and widening the roots to reach it would make every path on
//! the machine readable through a route that is deliberately reachable without a bearer header. So the
//! file comes to Tendril instead. V1 does the same thing through its framework's `/ivy/upload/...`
//! handler; this is that handler's half of the contract.
//!
//! Two things this route is not:
//!
//! * **A write-anywhere primitive.** [`tendril_core::jobs::attachments::store_attachment`] owns that:
//!   the session id and the file name are each accepted only as a plain path segment, and the composed
//!   path is checked to be a direct child of the session directory before anything is created.
//! * **Published.** It is registered on the `owner_local` router, so it takes the bearer credential
//!   *and* is refused when the request arrives over either tunnel. A share visitor is already denied
//!   by `share_token_allows` being deny-by-default, but "writes files into the daemon's home" is not a
//!   surface to leave one middleware away from being reachable from the internet.

use crate::state::AppState;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::jobs::attachments::{store_attachment, AttachmentError};

#[derive(Debug, Deserialize)]
pub struct UploadAttachmentQuery {
    /// The name to store the file under. In the query string rather than the path so that a name
    /// carrying a separator arrives here and is *refused*, instead of being unroutable and answered
    /// with a bare 404 that says nothing.
    #[serde(rename = "fileName", alias = "file_name")]
    pub file_name: String,
}

pub async fn upload_attachment(
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Query(query): Query<UploadAttachmentQuery>,
    body: Bytes,
) -> Response {
    if body.is_empty() {
        return error(StatusCode::BAD_REQUEST, "The uploaded file is empty");
    }

    match store_attachment(
        &state.tendril_home,
        &session_id,
        &query.file_name,
        body.as_ref(),
    ) {
        Ok(path) => (
            StatusCode::CREATED,
            Json(json!({
                "path": path.to_string_lossy(),
                "name": path.file_name().map(|n| n.to_string_lossy().to_string()),
            })),
        )
            .into_response(),
        // The rejected name is not echoed back: it is caller-supplied text and the answer is the same
        // whatever it was.
        Err(err @ (AttachmentError::InvalidName | AttachmentError::InvalidSession)) => {
            tracing::warn!("Refused an attachment upload: {err}");
            error(StatusCode::BAD_REQUEST, &err.to_string())
        }
        Err(err @ AttachmentError::TooLarge) => {
            error(StatusCode::PAYLOAD_TOO_LARGE, &err.to_string())
        }
        Err(err) => {
            tracing::error!("Failed to store an attachment: {err}");
            error(StatusCode::INTERNAL_SERVER_ERROR, &err.to_string())
        }
    }
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}
