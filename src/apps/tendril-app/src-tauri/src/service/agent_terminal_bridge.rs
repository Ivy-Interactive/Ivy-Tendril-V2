//! Native consumer of one chat session's interactive-agent SSE stream.
//!
//! Same problem, same shape as [`super::review_action_bridge`]: the webview's origin is `tauri://`,
//! `/api/chat/sessions/:id/terminal` is bearer-authenticated with a native-only secret, and `invoke`
//! cannot stream — so the frames are read here and re-emitted as Tauri events.
//!
//! Two differences from the review-action bridge, both deliberate:
//!
//! 1. **Closing kills the agent.** A review action's dev server has to outlive its pane, because the
//!    preview that replaces the terminal is what it serves. An interactive agent has nothing to serve
//!    once its pane is gone, and leaving one running would leak a model session per closed tab — so
//!    [`close`] asks the daemon to end it, then stops reading.
//! 2. **A reader is keyed by the *chat* session, not the pty session.** A pane is addressed by the
//!    conversation it belongs to (that is what the URL carries and what the view knows on mount), and
//!    the pty id only exists once the daemon has answered. Keying by chat session is what lets a pane
//!    that remounts stop the reader it started before.

use crate::error::BridgeError;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::Emitter;

/// Tauri event carrying `{ chatSessionId, event, data }` for one SSE frame.
pub const AGENT_TERMINAL_EVENT: &str = "agent-terminal-event";
/// Tauri event carrying `{ chatSessionId, status }` where status is `"connected"` / `"disconnected"`.
pub const AGENT_TERMINAL_STATUS_EVENT: &str = "agent-terminal-stream-status";

/// How long the daemon has to announce the session before the invocation is treated as failed. The
/// frame is emitted before the agent is even spawned, so this only has to cover the round trip.
const META_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// The `meta` frame, which is what the caller needs in order to type into the session at all.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StartedAgentTerminal {
    /// The **pty** session id, which `input` / `resize` / close are keyed by.
    #[serde(rename = "sessionId")]
    pub session_id: String,
    /// How a `log` frame's payload is encoded. Always `base64` today; carried through rather than
    /// assumed so a client can refuse a stream it cannot decode.
    pub encoding: String,
    pub rows: u16,
    pub cols: u16,
}

#[derive(Debug, Clone, serde::Serialize)]
struct AgentTerminalFrame {
    #[serde(rename = "chatSessionId")]
    chat_session_id: String,
    event: String,
    data: String,
}

#[derive(Debug, Clone, serde::Serialize)]
struct AgentTerminalStatus {
    #[serde(rename = "chatSessionId")]
    chat_session_id: String,
    status: &'static str,
}

/// A live pane: the reader consuming its stream, and the pty id needed to end its agent.
struct Reader {
    handle: tokio::task::AbortHandle,
    pty_session_id: String,
}

/// Readers by **chat** session id, so a view that has been closed can stop the one it started.
static READERS: LazyLock<Mutex<HashMap<String, Reader>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The pty session behind a chat session's pane, if one is running.
pub fn pty_session_id(chat_session_id: &str) -> Option<String> {
    lock(&READERS)
        .get(chat_session_id)
        .map(|reader| reader.pty_session_id.clone())
}

/// Consumes `response` until the `meta` frame, then keeps consuming it in the background, emitting
/// every later frame as a Tauri event.
///
/// Returns once the session is addressable. The caller is expected to have subscribed to
/// [`AGENT_TERMINAL_EVENT`] already: output starts arriving the moment the agent writes, which can be
/// before this function's return value has made it back across the `invoke` boundary.
pub async fn start<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    chat_session_id: String,
    mut response: reqwest::Response,
) -> Result<StartedAgentTerminal, BridgeError> {
    let mut buffer = String::new();
    let mut backlog: Vec<(String, String)> = Vec::new();
    let deadline = tokio::time::Instant::now() + META_TIMEOUT;

    let started = loop {
        let chunk = tokio::time::timeout_at(deadline, response.chunk())
            .await
            .map_err(|_| {
                BridgeError::new(
                    "AGENT_TERMINAL_NO_META",
                    "The agent terminal stream did not announce a session",
                )
            })?
            .map_err(BridgeError::from)?;

        let Some(chunk) = chunk else {
            return Err(BridgeError::new(
                "AGENT_TERMINAL_STREAM_CLOSED",
                "The agent terminal stream closed before announcing a session",
            ));
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        let mut started = None;
        for (name, data) in super::changes_bridge::parse_sse_frames(&mut buffer) {
            if started.is_none() && name == "meta" {
                started = Some(serde_json::from_str::<StartedAgentTerminal>(&data).map_err(
                    |e| {
                        BridgeError::new(
                            "AGENT_TERMINAL_BAD_META",
                            format!(
                                "The agent terminal stream announced an unreadable session: {e}"
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
        AGENT_TERMINAL_STATUS_EVENT,
        AgentTerminalStatus {
            chat_session_id: chat_session_id.clone(),
            status: "connected",
        },
    );

    let emit_id = chat_session_id.clone();
    let reader = tokio::spawn(async move {
        for (event, data) in backlog {
            emit_frame(&app_handle, &emit_id, event, data);
        }

        loop {
            match response.chunk().await {
                Ok(Some(bytes)) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    for (event, data) in super::changes_bridge::parse_sse_frames(&mut buffer) {
                        emit_frame(&app_handle, &emit_id, event, data);
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    tracing::warn!("Agent terminal stream read failed: {e}");
                    break;
                }
            }
        }

        // The agent is gone either way — it exited, or the stream broke and cannot be reopened
        // without spawning a second one.
        lock(&READERS).remove(&emit_id);
        let _ = app_handle.emit(
            AGENT_TERMINAL_STATUS_EVENT,
            AgentTerminalStatus {
                chat_session_id: emit_id.clone(),
                status: "disconnected",
            },
        );
    });

    lock(&READERS).insert(
        chat_session_id,
        Reader {
            handle: reader.abort_handle(),
            pty_session_id: started.session_id.clone(),
        },
    );

    Ok(started)
}

fn emit_frame<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    chat_session_id: &str,
    event: String,
    data: String,
) {
    let _ = app_handle.emit(
        AGENT_TERMINAL_EVENT,
        AgentTerminalFrame {
            chat_session_id: chat_session_id.to_string(),
            event,
            data,
        },
    );
}

/// Stops consuming a pane's stream, and returns the pty session whose agent the caller should end.
///
/// The kill itself is a daemon round trip, so it is left to the command rather than done here — this
/// module owns the reader, not the credential. Returns `None` when nothing was running, so closing
/// twice is not an error.
pub fn close(chat_session_id: &str) -> Option<String> {
    let reader = lock(&READERS).remove(chat_session_id)?;
    reader.handle.abort();
    Some(reader.pty_session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_an_unknown_pane_is_not_an_error() {
        assert_eq!(close("never-started"), None);
        assert_eq!(pty_session_id("never-started"), None);
    }
}
