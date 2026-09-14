//! SSE stream of filesystem change events, modelled on `stream_job_events`.

use crate::state::AppState;
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::watcher::ChangeEvent;
use tokio::sync::broadcast::error::RecvError;

/// `GET /api/changes/events`
///
/// Unlike the jobs stream there is no terminal `end` event: the stream lives as long as the client
/// does, because "the filesystem stopped changing" is not a state a client can act on.
pub async fn stream_changes(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut change_rx = state.change_tx.subscribe();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Result<Event, std::convert::Infallible>>(64);

    tokio::spawn(async move {
        loop {
            let event = match change_rx.recv().await {
                Ok(event) => event,
                // The client fell behind a burst. It cannot be told what it missed, so it is told to
                // assume everything did: a full rescan is a slow refresh, a missed update is a lie.
                Err(RecvError::Lagged(n)) => {
                    tracing::debug!("Change stream client lagged by {n} events; sending a rescan");
                    ChangeEvent::full_rescan()
                }
                Err(RecvError::Closed) => break,
            };

            let Ok(json) = serde_json::to_string(&event) else {
                continue;
            };
            if tx
                .send(Ok(Event::default().event("change").data(json)))
                .await
                .is_err()
            {
                // The client hung up.
                break;
            }
        }
    });

    let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx));
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}
