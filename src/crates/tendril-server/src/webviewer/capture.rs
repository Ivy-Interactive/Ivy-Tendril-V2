//! Screenshot storage for the WebViewer.
//!
//! Adapted rather than ported verbatim: the V2 page agent posts `{dataUrl, mode, w, h}` and
//! `WebViewer.tsx`'s `saveCapture` reads `filename` back off the response, where the upstream C#
//! handler read `{dataUrl, name}` and answered `{url, path, file}`. The frontend is already merged,
//! so the contract here follows it.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use regex::Regex;
use serde::Deserialize;
use std::sync::{Arc, LazyLock};

use crate::state::AppState;

/// Largest screenshot the endpoint will store.
pub(crate) const MAX_CAPTURE_BYTES: usize = 32 * 1024 * 1024;

/// Captures live under `tendril_home`, alongside the other data this app persists, rather than in the
/// OS temp directory the C# original used.
const CAPTURE_DIRECTORY: &str = "webviewer-captures";

static PNG_DATA_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)^data:image/png;base64,(.+)$").unwrap());

static UNSAFE_NAME_CHARS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[^a-zA-Z0-9_-]+").unwrap());

/// The agent also sends `w`/`h`; they describe the image it already has, so nothing here needs them
/// and serde drops them.
#[derive(Deserialize)]
struct CaptureRequest {
    #[serde(rename = "dataUrl")]
    data_url: Option<String>,
    mode: Option<String>,
}

pub(crate) async fn handle_capture(State(state): State<Arc<AppState>>, body: Bytes) -> Response {
    let Ok(request) = serde_json::from_slice::<CaptureRequest>(&body) else {
        return text(StatusCode::BAD_REQUEST, "Bad JSON");
    };

    let data_url = request.data_url.unwrap_or_default();
    let Some(captures) = PNG_DATA_URL.captures(&data_url) else {
        return text(StatusCode::BAD_REQUEST, "Expected a PNG data URL");
    };

    let Ok(png) = base64::engine::general_purpose::STANDARD.decode(captures[1].as_bytes()) else {
        return text(StatusCode::BAD_REQUEST, "Malformed base64 payload");
    };
    if png.len() > MAX_CAPTURE_BYTES {
        return text(
            StatusCode::PAYLOAD_TOO_LARGE,
            &format!("Capture exceeds {MAX_CAPTURE_BYTES} bytes"),
        );
    }

    let file_name = capture_file_name(request.mode.as_deref().unwrap_or("capture"));
    let directory = state.tendril_home.join(CAPTURE_DIRECTORY);
    let absolute = directory.join(&file_name);

    if let Err(e) = tokio::fs::create_dir_all(&directory).await {
        return text(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Write failed: {e}"),
        );
    }
    if let Err(e) = tokio::fs::write(&absolute, &png).await {
        return text(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Write failed: {e}"),
        );
    }

    axum::Json(serde_json::json!({
        "filename": file_name,
        "url": format!("/__captures/{file_name}"),
    }))
    .into_response()
}

pub(crate) async fn handle_serve_capture(
    State(state): State<Arc<AppState>>,
    Path(file): Path<String>,
) -> Response {
    // file_name() drops any traversal the caller put in the segment.
    let Some(name) = std::path::Path::new(&file).file_name() else {
        return text(StatusCode::NOT_FOUND, "Not found");
    };
    let absolute = state.tendril_home.join(CAPTURE_DIRECTORY).join(name);

    match tokio::fs::read(&absolute).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "image/png"),
                (header::CACHE_CONTROL, "no-cache"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => text(StatusCode::NOT_FOUND, "Not found"),
    }
}

/// Timestamp plus a sanitised label, so two captures in the same session never collide and nothing
/// the page chose reaches the filesystem verbatim.
fn capture_file_name(label: &str) -> String {
    let mut safe = UNSAFE_NAME_CHARS.replace_all(label, "_").into_owned();
    safe.truncate(
        safe.char_indices()
            .nth(40)
            .map(|(index, _)| index)
            .unwrap_or(safe.len()),
    );
    format!("{}-{}.png", chrono::Utc::now().timestamp_millis(), safe)
}

fn text(status: StatusCode, body: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/plain")],
        body.to_string(),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_file_name_sanitises_and_truncates() {
        // A run of unsafe characters collapses to one underscore, so the traversal leaves nothing
        // behind that a path resolver could act on.
        let name = capture_file_name("page/../../etc/passwd");
        assert!(name.ends_with("-page_etc_passwd.png"), "{name}");
        assert!(!name.contains('/'), "{name}");
        assert!(!name.contains(".."), "{name}");

        let long = capture_file_name(&"a".repeat(100));
        let label = long.split_once('-').unwrap().1.trim_end_matches(".png");
        assert_eq!(label.len(), 40);
    }

    #[test]
    fn png_data_url_matches_only_png_payloads() {
        assert!(PNG_DATA_URL.is_match("data:image/png;base64,AAAA"));
        assert!(!PNG_DATA_URL.is_match("data:image/jpeg;base64,AAAA"));
        assert!(!PNG_DATA_URL.is_match("data:image/png;base64,"));
        // A base64 payload wrapping onto a second line still matches (?s).
        assert!(PNG_DATA_URL.is_match("data:image/png;base64,AA\nAA"));
    }
}
