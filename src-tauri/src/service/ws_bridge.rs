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
                                            if let Ok(server_msg) = serde_json::from_str::<WSServerMessage>(&text_str) {
                                                if server_msg.msg_type == "state" || server_msg.msg_type == "status" {
                                                    let _ = app_handle.emit("plan-event", &server_msg);
                                                } else {
                                                    let _ = app_handle.emit("job-event", &server_msg);
                                                }
                                            } else {
                                                let _ = app_handle.emit("job-event", text_str);
                                            }
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
                        tracing::warn!("WebSocket connection failed: {e}. Retrying in {backoff:?}...");
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
