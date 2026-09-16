use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast::error::RecvError;

/// Sent to a single client that fell too far behind the broadcast channel to be told what it missed.
///
/// It carries no state of its own: the client is expected to re-fetch, or to top up through
/// `GET /api/events/backfill?since=<its last seq>`, which reports `gap: true` for exactly this case.
/// Deliberately not `plan.`/`chat.`-prefixed — the desktop bridge routes anything else to
/// `job-event`, and a resync is not a plan or chat event.
pub const RESYNC_EVENT_TYPE: &str = "resync";

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
    /// Stamped by [`AppState::dispatch_ws_event`] once this is sent, not set here — kept `None` on
    /// construction so callers never have to guess a sequence number ahead of dispatch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
}

#[derive(Deserialize, Debug, Default)]
pub struct WsQuery {
    /// A reconnecting client's last-seen `seq`. When present, [`handle_socket`] replays every
    /// buffered event with `seq > since` before forwarding live broadcasts, so a brief disconnect
    /// never needs a full re-fetch of state.
    pub since: Option<u64>,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(query): Query<WsQuery>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state, query.since))
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, since: Option<u64>) {
    let (mut sender, mut receiver) = socket.split();
    // Subscribed before the ring buffer is ever read, so an event dispatched between the snapshot
    // and the subscribe can't fall into the gap and be missed entirely.
    let mut rx = state.ws_tx.subscribe();

    let mut max_replayed_seq = 0u64;
    if let Some(since) = since {
        for envelope in state.ring_buffer.get_since(since, None) {
            max_replayed_seq = max_replayed_seq.max(envelope.seq);
            if let Ok(json) = serde_json::to_string(&envelope) {
                if sender.send(Message::Text(json)).await.is_err() {
                    return;
                }
            }
        }
    }

    tokio::spawn(async move {
        loop {
            let msg = match rx.recv().await {
                Ok(msg) => msg,
                // This client fell behind a burst. Returning here would leave the socket open with
                // nothing ever written to it again — the client would never see a close, never
                // reconnect, and go silently deaf. So it is told to resync and the loop continues:
                // `recv` resumes at the oldest event still retained.
                Err(RecvError::Lagged(dropped)) => {
                    tracing::warn!("WebSocket client lagged by {dropped} events; sending a resync");
                    let hint = serde_json::json!({
                        "type": RESYNC_EVENT_TYPE,
                        "dropped": dropped,
                    })
                    .to_string();
                    if sender.send(Message::Text(hint)).await.is_err() {
                        break;
                    }
                    continue;
                }
                Err(RecvError::Closed) => break,
            };
            // A live broadcast can race the replay above and repeat an event already sent; the
            // replayed copy's `seq` is authoritative, so drop anything at or below it. Parsed only
            // when there was a replay: a client that sent no `since` has nothing to deduplicate
            // against, and a `serde_json` pass per event is exactly what makes this loop lag.
            if max_replayed_seq > 0 {
                let seq = serde_json::from_str::<serde_json::Value>(&msg)
                    .ok()
                    .and_then(|v| v.get("seq").and_then(|s| s.as_u64()));
                if let Some(seq) = seq {
                    if seq <= max_replayed_seq {
                        continue;
                    }
                }
            }
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
                        seq: None,
                    };
                    state.dispatch_ws_event(serde_json::json!(notify_msg));
                }
                "approve_plan" => {
                    let notify_msg = WSServerMessage {
                        msg_type: "status".to_string(),
                        step: None,
                        message: Some("Plan approved".to_string()),
                        seq: None,
                    };
                    state.dispatch_ws_event(serde_json::json!(notify_msg));
                }
                _ => {}
            }
        }
    }
}

#[derive(Deserialize, Debug, Default)]
pub struct EventsBackfillQuery {
    /// Return events with `seq > since`. Omitted (or `0`) means "everything retained".
    pub since: Option<u64>,
    pub limit: Option<usize>,
}

/// `GET /api/events/backfill` and `GET /api/events` — the REST counterpart to `?since=<seq>` WS
/// resume, for a client that would rather poll than hold a socket open (or that needs to top up
/// before opening one). `gap: true` means events between `since` and [`EventRingBuffer::oldest_seq`]
/// were already evicted, so `events` alone cannot bring the client fully up to date.
pub async fn events_backfill_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<EventsBackfillQuery>,
) -> impl IntoResponse {
    let since = query.since.unwrap_or(0);
    let events = state.ring_buffer.get_since(since, query.limit);
    Json(serde_json::json!({
        "events": events,
        "oldest_seq": state.ring_buffer.oldest_seq(),
        "latest_seq": state.ring_buffer.latest_seq(),
        "gap": state.ring_buffer.has_gap(since),
    }))
}
