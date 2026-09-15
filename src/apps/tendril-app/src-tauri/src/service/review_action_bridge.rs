//! Native consumer of one review action's `/execute` SSE stream.
//!
//! The same problem [`super::changes_bridge`] solves — the webview's origin is `tauri://`, the route
//! is bearer-authenticated with a native-only secret, and `invoke` cannot stream — with one
//! difference that shapes the whole module: this stream is **not** reconnectable. Re-issuing the POST
//! would spawn a second copy of the dev server, so a broken stream ends the session instead of
//! climbing a backoff ladder.
//!
//! One bridge exists per invocation, registered under the session id the daemon reports in its first
//! frame. That id is also what the `input` and `resize` routes are keyed by, so the webview needs it
//! before it can type: [`start`] therefore waits for that first frame and returns it, and only the
//! frames after it are re-emitted as Tauri events.

use crate::error::BridgeError;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::Emitter;

/// Tauri event carrying `{ sessionId, event, data }` for one SSE frame.
pub const REVIEW_ACTION_EVENT: &str = "review-action-event";
/// Tauri event carrying `{ sessionId, status }` where status is `"connected"` / `"disconnected"`.
pub const REVIEW_ACTION_STATUS_EVENT: &str = "review-action-stream-status";

/// How long the daemon has to announce the session before the invocation is treated as failed. The
/// frame is emitted before the process is even spawned, so this only has to cover the round trip.
const META_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// The `meta` frame, which is what the caller needs in order to address the session at all.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StartedReviewAction {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// How a `log` frame's payload is encoded. Always `base64` today; carried through rather than
    /// assumed so a client can refuse a stream it cannot decode.
    pub encoding: String,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, serde::Serialize)]
struct ReviewActionFrame {
    #[serde(rename = "sessionId")]
    session_id: String,
    event: String,
    data: String,
}

#[derive(Debug, Clone, serde::Serialize)]
struct ReviewActionStatus {
    #[serde(rename = "sessionId")]
    session_id: String,
    status: &'static str,
}

/// Reader tasks by session id, so a view that has been closed can stop the one it started.
static READERS: LazyLock<Mutex<HashMap<String, tokio::task::AbortHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Consumes `response` until the `meta` frame, then keeps consuming it in the background, emitting
/// every later frame as a Tauri event.
///
/// Returns once the session is addressable. The caller is expected to have subscribed to
/// [`REVIEW_ACTION_EVENT`] already: output starts arriving the moment the process writes, which can
/// be before this function's return value has made it back across the `invoke` boundary.
pub async fn start<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut response: reqwest::Response,
) -> Result<StartedReviewAction, BridgeError> {
    let mut buffer = String::new();
    let mut backlog: Vec<(String, String)> = Vec::new();
    let deadline = tokio::time::Instant::now() + META_TIMEOUT;

    let started = loop {
        let chunk = tokio::time::timeout_at(deadline, response.chunk())
            .await
            .map_err(|_| {
                BridgeError::new(
                    "REVIEW_ACTION_NO_META",
                    "The review action stream did not announce a session",
                )
            })?
            .map_err(BridgeError::from)?;

        let Some(chunk) = chunk else {
            return Err(BridgeError::new(
                "REVIEW_ACTION_STREAM_CLOSED",
                "The review action stream closed before announcing a session",
            ));
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        let mut started = None;
        for (name, data) in super::changes_bridge::parse_sse_frames(&mut buffer) {
            if started.is_none() && name == "meta" {
                started = Some(serde_json::from_str::<StartedReviewAction>(&data).map_err(
                    |e| {
                        BridgeError::new(
                            "REVIEW_ACTION_BAD_META",
                            format!(
                                "The review action stream announced an unreadable session: {e}"
                            ),
                        )
                    },
                )?);
                continue;
            }
            // A chunk can carry `meta` and the first output together; those frames still have to be
            // delivered, in order, once the session is known.
            backlog.push((name, data));
        }

        if let Some(started) = started {
            break started;
        }
    };

    let _ = app_handle.emit(
        REVIEW_ACTION_STATUS_EVENT,
        ReviewActionStatus {
            session_id: started.session_id.clone(),
            status: "connected",
        },
    );

    let session_id = started.session_id.clone();
    let reader = tokio::spawn(async move {
        for (event, data) in backlog {
            emit_frame(&app_handle, &session_id, event, data);
        }

        loop {
            match response.chunk().await {
                Ok(Some(bytes)) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    for (event, data) in super::changes_bridge::parse_sse_frames(&mut buffer) {
                        emit_frame(&app_handle, &session_id, event, data);
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    tracing::warn!("Review action stream read failed: {e}");
                    break;
                }
            }
        }

        // The session is gone either way — the process exited, or the stream broke and cannot be
        // reopened without starting a second process.
        lock(&READERS).remove(&session_id);
        let _ = app_handle.emit(
            REVIEW_ACTION_STATUS_EVENT,
            ReviewActionStatus {
                session_id: session_id.clone(),
                status: "disconnected",
            },
        );
    });

    lock(&READERS).insert(started.session_id.clone(), reader.abort_handle());

    Ok(started)
}

fn emit_frame<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    session_id: &str,
    event: String,
    data: String,
) {
    let _ = app_handle.emit(
        REVIEW_ACTION_EVENT,
        ReviewActionFrame {
            session_id: session_id.to_string(),
            event,
            data,
        },
    );
}

/// Stops consuming a session's stream.
///
/// Deliberately does not stop the process: a review action's whole point is that the app it started
/// keeps serving after the terminal is swapped for the preview. Dropping the response closes this
/// end of the connection; the daemon keeps draining the pty so the child never blocks on a full
/// buffer.
///
/// Returns whether a reader was actually running, so closing twice is not an error.
pub fn close(session_id: &str) -> bool {
    match lock(&READERS).remove(session_id) {
        Some(handle) => {
            handle.abort();
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_an_unknown_session_is_not_an_error() {
        assert!(!close("never-started"));
    }

    #[test]
    fn meta_parses_the_shape_the_daemon_sends() {
        let started: StartedReviewAction = serde_json::from_str(
            r#"{"encoding":"base64","sessionId":"abc123","rows":24,"cols":80}"#,
        )
        .unwrap();

        assert_eq!(started.session_id, "abc123");
        assert_eq!(started.encoding, "base64");
        assert_eq!((started.rows, started.cols), (24, 80));
    }
}
