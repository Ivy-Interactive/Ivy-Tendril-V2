use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSClientMessage {
    pub action: String,
    pub scenario_id: Option<String>,
    pub plan_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WSServerMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub step: Option<serde_json::Value>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WsBridge {
    tx: mpsc::Sender<WSClientMessage>,
    is_connected: Arc<AtomicBool>,
}

impl WsBridge {
    pub fn new<R: tauri::Runtime>(
        app_handle: tauri::AppHandle<R>,
        ws_url: String,
        secret: Option<String>,
    ) -> Self {
        let (tx, mut rx) = mpsc::channel::<WSClientMessage>(64);
        let is_connected = Arc::new(AtomicBool::new(false));
        let is_connected_clone = Arc::clone(&is_connected);

        tokio::spawn(async move {
            let mut backoff = Duration::from_millis(500);
            let max_backoff = Duration::from_secs(10);

            loop {
                let mut req = match ws_url.as_str().into_client_request() {
                    Ok(r) => r,
                    Err(e) => {
                        tracing::error!("Invalid WebSocket URL: {e}");
                        tokio::time::sleep(backoff).await;
                        continue;
                    }
                };

                if let Some(ref sec) = secret {
                    req.headers_mut().insert(
                        "Authorization",
                        reqwest::header::HeaderValue::from_str(&format!("Bearer {sec}"))
                            .unwrap_or_else(|_| reqwest::header::HeaderValue::from_static("")),
                    );
                }

                let _ = app_handle.emit("service-status", "reconnecting");

                match connect_async(req).await {
                    Ok((ws_stream, _)) => {
                        backoff = Duration::from_millis(500);
                        is_connected_clone.store(true, Ordering::SeqCst);
                        let _ = app_handle.emit("service-status", "connected");

                        let (mut write, mut read) = ws_stream.split();

                        loop {
                            tokio::select! {
                                Some(client_msg) = rx.recv() => {
                                    if let Ok(json_str) = serde_json::to_string(&client_msg) {
                                        if write.send(Message::Text(json_str.into())).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                                msg_opt = read.next() => {
                                    match msg_opt {
                                        Some(Ok(Message::Text(txt))) => {
                                            let text_str = txt.to_string();
                                            let (event_name, payload) = route_ws_message(&text_str);
                                            let _ = app_handle.emit(event_name, &payload);
                                        }
                                        Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                                            break;
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }

                        is_connected_clone.store(false, Ordering::SeqCst);
                        let _ = app_handle.emit("service-status", "disconnected");
                    }
                    Err(e) => {
                        tracing::warn!(
                            "WebSocket connection failed: {e}. Retrying in {backoff:?}..."
                        );
                        is_connected_clone.store(false, Ordering::SeqCst);
                        let _ = app_handle.emit("service-status", "disconnected");
                    }
                }

                tokio::time::sleep(backoff).await;
                backoff = std::cmp::min(backoff * 2, max_backoff);
            }
        });

        Self { tx, is_connected }
    }

    pub async fn send_action(&self, action: &str, plan_id: Option<String>) -> Result<(), String> {
        let msg = WSClientMessage {
            action: action.to_string(),
            scenario_id: None,
            plan_id,
        };
        self.tx
            .send(msg)
            .await
            .map_err(|e| format!("Failed to send action over WS: {e}"))
    }

    pub fn is_connected(&self) -> bool {
        self.is_connected.load(Ordering::SeqCst)
    }
}

pub fn route_ws_message(text_str: &str) -> (&'static str, serde_json::Value) {
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(text_str) {
        let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if msg_type.starts_with("chat.") {
            ("chat-event", val)
        } else if msg_type == "state" || msg_type == "status" {
            ("plan-event", val)
        } else {
            ("job-event", val)
        }
    } else {
        ("job-event", serde_json::Value::String(text_str.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_route_chat_events() {
        let delta_json =
            r#"{"type":"chat.stream_delta","sessionId":"s1","messageId":"m1","delta":"Hello"}"#;
        let (channel, payload) = route_ws_message(delta_json);
        assert_eq!(channel, "chat-event");
        assert_eq!(payload["delta"], "Hello");

        let msg_added_json = r#"{"type":"chat.message_added","sessionId":"s1","message":{"id":"m1","role":"user","content":"Hi"}}"#;
        let (channel, payload) = route_ws_message(msg_added_json);
        assert_eq!(channel, "chat-event");
        assert_eq!(payload["sessionId"], "s1");

        let gen_state_json =
            r#"{"type":"chat.generating_state","sessionId":"s1","isGenerating":true}"#;
        let (channel, payload) = route_ws_message(gen_state_json);
        assert_eq!(channel, "chat-event");
        assert_eq!(payload["isGenerating"], true);
    }

    #[test]
    fn test_route_plan_and_job_events() {
        let state_json = r#"{"type":"state","planId":"00010"}"#;
        let (channel, _) = route_ws_message(state_json);
        assert_eq!(channel, "plan-event");

        let status_json = r#"{"type":"status","planId":"00010"}"#;
        let (channel, _) = route_ws_message(status_json);
        assert_eq!(channel, "plan-event");

        let job_json = r#"{"type":"job_started","jobId":"00100"}"#;
        let (channel, _) = route_ws_message(job_json);
        assert_eq!(channel, "job-event");
    }
}
