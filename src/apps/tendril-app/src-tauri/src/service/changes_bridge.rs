//! Native consumer of the daemon's `/api/changes/events` SSE stream.
//!
//! The webview cannot read the stream itself: the route is bearer-authenticated and the secret is
//! deliberately native-only. So the stream is consumed here and re-emitted as Tauri events, the same
//! shape [`super::ws_bridge::WsBridge`] establishes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

/// Tauri event carrying one change frame's JSON payload.
pub const CHANGE_EVENT: &str = "change-event";
/// Tauri event carrying `"connected"` / `"disconnected"` on transitions only.
pub const CHANGE_STATUS_EVENT: &str = "change-stream-status";

/// The SSE event name the daemon uses for change frames.
const SSE_EVENT_NAME: &str = "change";

#[derive(Debug, Clone)]
pub struct ChangeBridge {
    is_connected: Arc<AtomicBool>,
}

impl ChangeBridge {
    /// Reconnecting SSE consumer. 500 ms backoff doubling to 10 s, the same ladder as `WsBridge`.
    ///
    /// `base_url` is the daemon origin as known at startup, e.g. `http://127.0.0.1:5001`. Spawning
    /// does not require the daemon to be up: the app may well start first, and the ladder covers the
    /// gap. Each attempt re-reads `.master` when it can, so an origin that was a guess at startup —
    /// or a daemon that restarts on a different port — is picked up without restarting the app.
    pub fn new<R: tauri::Runtime>(
        app_handle: tauri::AppHandle<R>,
        base_url: String,
        secret: Option<String>,
    ) -> Self {
        let is_connected = Arc::new(AtomicBool::new(false));
        let connected = Arc::clone(&is_connected);

        tokio::spawn(async move {
            let mut backoff = Duration::from_millis(500);
            let max_backoff = Duration::from_secs(10);
            // No timeout: an idle change stream is normal, and the keep-alive comments are what
            // distinguish "quiet" from "dead".
            let client = reqwest::Client::new();
            let discovery = super::MasterDiscovery::new();
            let mut origin = base_url.trim_end_matches('/').to_string();
            let mut secret = secret;

            loop {
                // The startup values are only a starting point; `.master` is the authority whenever
                // it is readable.
                if let Ok(master) = discovery.read_master() {
                    let current = format!("{}://{}:{}", master.scheme, master.host, master.port);
                    if current != origin {
                        tracing::info!("Change stream origin moved to {current}");
                        origin = current;
                    }
                    secret = Some(master.secret);
                }

                let url = format!("{origin}/api/changes/events");
                let mut request = client.get(&url);
                if let Some(ref sec) = secret {
                    request = request.bearer_auth(sec);
                }

                match request.send().await {
                    Ok(response) if response.status().is_success() => {
                        backoff = Duration::from_millis(500);
                        if !connected.swap(true, Ordering::SeqCst) {
                            let _ = app_handle.emit(CHANGE_STATUS_EVENT, "connected");
                        }

                        let mut response = response;
                        let mut buffer = String::new();
                        loop {
                            match response.chunk().await {
                                Ok(Some(bytes)) => {
                                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                                    for (name, data) in parse_sse_frames(&mut buffer) {
                                        if name == SSE_EVENT_NAME {
                                            // Forwarded as the parsed value where possible so the
                                            // webview does not have to double-decode.
                                            match serde_json::from_str::<serde_json::Value>(&data) {
                                                Ok(value) => {
                                                    let _ = app_handle.emit(CHANGE_EVENT, value);
                                                }
                                                Err(e) => tracing::warn!(
                                                    "Discarding unparseable change frame: {e}"
                                                ),
                                            }
                                        }
                                    }
                                }
                                // Stream ended or broke: reconnect on the ladder.
                                Ok(None) => break,
                                Err(e) => {
                                    tracing::warn!("Change stream read failed: {e}");
                                    break;
                                }
                            }
                        }
                    }
                    Ok(response) => {
                        tracing::warn!(
                            "Change stream rejected with {}; retrying in {backoff:?}",
                            response.status()
                        );
                    }
                    Err(e) => {
                        tracing::debug!("Change stream unavailable: {e}. Retrying in {backoff:?}");
                    }
                }

                // Transitions only, so a daemon that is down for an hour does not emit an event per
                // retry.
                if connected.swap(false, Ordering::SeqCst) {
                    let _ = app_handle.emit(CHANGE_STATUS_EVENT, "disconnected");
                }

                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, max_backoff);
            }
        });

        Self { is_connected }
    }

    pub fn is_connected(&self) -> bool {
        self.is_connected.load(Ordering::SeqCst)
    }
}

/// Pulls every complete frame out of `buffer`, leaving any partial trailing frame behind.
///
/// Split out from the connection loop so it is unit-testable without a server, the way
/// `route_ws_message` is. A chunk boundary can fall anywhere — including mid-`data:` line — so the
/// buffer must survive between chunks rather than being parsed per chunk.
pub(crate) fn parse_sse_frames(buffer: &mut String) -> Vec<(String, String)> {
    let mut frames = Vec::new();

    // Frames are separated by a blank line. Anything after the last separator is incomplete.
    while let Some(end) = buffer.find("\n\n") {
        let frame: String = buffer.drain(..end + 2).collect();

        let mut event_name = String::new();
        let mut data_lines: Vec<&str> = Vec::new();

        for line in frame.lines() {
            let line = line.trim_end_matches('\r');
            // A line starting with ':' is a comment — which is exactly what the keep-alive is.
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            if let Some(rest) = line.strip_prefix("event:") {
                event_name = rest.trim_start().to_string();
            } else if let Some(rest) = line.strip_prefix("data:") {
                data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
            }
        }

        if data_lines.is_empty() {
            continue;
        }
        // Per the SSE spec, multiple data lines in one frame join with newlines.
        let name = if event_name.is_empty() {
            "message".to_string()
        } else {
            event_name
        };
        frames.push((name, data_lines.join("\n")));
    }

    frames
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_frames_handles_chunk_boundaries() {
        let mut buffer = String::new();

        // First chunk cuts the frame in half, mid-`data:`. Nothing is emitted yet, and nothing is
        // lost: a per-chunk parser would drop this frame entirely.
        buffer.push_str("event: change\ndata: {\"type\":\"fs.chan");
        assert!(parse_sse_frames(&mut buffer).is_empty());

        buffer.push_str("ge\",\"target\":{\"kind\":\"config\"}}\n\n");
        let frames = parse_sse_frames(&mut buffer);
        assert_eq!(frames.len(), 1, "the reassembled frame must parse once");
        assert_eq!(frames[0].0, "change");
        assert_eq!(
            frames[0].1,
            r#"{"type":"fs.change","target":{"kind":"config"}}"#
        );
        assert!(buffer.is_empty(), "a consumed frame must leave the buffer");

        // The keep-alive is a bare comment line and carries no data, so it must not surface as a
        // frame — treating it as one would trigger a spurious refresh every 15 s.
        buffer.push_str(": keep-alive\n\n");
        assert!(parse_sse_frames(&mut buffer).is_empty());

        // Two frames in one chunk, plus the start of a third.
        buffer.push_str(
            "event: change\ndata: {\"a\":1}\n\nevent: change\ndata: {\"b\":2}\n\nevent: chan",
        );
        let frames = parse_sse_frames(&mut buffer);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].1, r#"{"a":1}"#);
        assert_eq!(frames[1].1, r#"{"b":2}"#);
        assert_eq!(buffer, "event: chan", "the partial frame must be retained");
    }

    #[test]
    fn parse_sse_frames_defaults_the_event_name_and_joins_data_lines() {
        let mut buffer = String::from("data: one\ndata: two\n\n");
        let frames = parse_sse_frames(&mut buffer);
        assert_eq!(
            frames,
            vec![("message".to_string(), "one\ntwo".to_string())]
        );
    }
}
