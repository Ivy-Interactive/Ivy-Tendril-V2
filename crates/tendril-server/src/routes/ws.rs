use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Serialize, Deserialize, Debug)]
pub struct WSClientMessage {
    pub action: String, // "start" | "approve_plan"
    pub scenario_id: Option<String>,
    pub plan_id: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct WSServerMessage {
    #[serde(rename = "type")]
    pub msg_type: String, // "state" | "complete" | "status" | "log"
    pub step: Option<serde_json::Value>,
    pub message: Option<String>,
}

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_tx.subscribe();

    tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(Message::Text(text))) = receiver.next().await {
        if let Ok(msg) = serde_json::from_str::<WSClientMessage>(&text) {
            match msg.action.as_str() {
                "start" => {
                    let notify_msg = WSServerMessage {
                        msg_type: "status".to_string(),
                        step: None,
                        message: Some("Job simulation / execution started".to_string()),
                    };
                    let _ = state
                        .ws_tx
                        .send(serde_json::to_string(&notify_msg).unwrap_or_default());
                }
                "approve_plan" => {
                    let notify_msg = WSServerMessage {
                        msg_type: "status".to_string(),
                        step: None,
                        message: Some("Plan approved".to_string()),
                    };
                    let _ = state
                        .ws_tx
                        .send(serde_json::to_string(&notify_msg).unwrap_or_default());
                }
                _ => {}
            }
        }
    }
}
