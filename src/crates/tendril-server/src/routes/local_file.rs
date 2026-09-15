//! `GET /ivy/local-file?path=<abs>&token=<secret>` — serves a screenshot or PDF that a plan produced.
//!
//! The handler is deliberately dull: by the time it runs, [`crate::local_file_guard`] has already
//! decided the caller is authorised and that the path is inside an allowed root, and has handed it
//! over as an [`ApprovedPath`]. Nothing here re-parses the query string, so there is no second chance
//! to disagree with the guard about which file was asked for.

use crate::local_file_guard::ApprovedPath;
use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub async fn get_local_file(req: Request) -> Response {
    // Absent only if the route were ever registered without the guard, which is a wiring bug rather
    // than a request the caller can make — answering 404 keeps it from being a disclosure either way.
    let Some(ApprovedPath(path)) = req.extensions().get::<ApprovedPath>().cloned() else {
        tracing::error!("/ivy/local-file reached without the guard layer; refusing the request");
        return not_found();
    };

    let Ok(metadata) = tokio::fs::metadata(&path).await else {
        return not_found();
    };
    if !metadata.is_file() {
        return not_found();
    }

    let Ok(bytes) = tokio::fs::read(&path).await else {
        return not_found();
    };

    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, content_type_for(&path))],
        Body::from(bytes),
    )
        .into_response()
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "File not found" })),
    )
        .into_response()
}

/// Content type for the extension allowlist the guard enforces. `application/octet-stream` is
/// unreachable in practice and is the safe answer if it ever is reached.
fn content_type_for(path: &std::path::Path) -> &'static str {
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        // Served with `Content-Security-Policy: default-src 'none'; sandbox` by the guard, which is
        // what makes an SVG's script content inert.
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}
