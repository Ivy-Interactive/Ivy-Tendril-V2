//! A minimal Chrome DevTools Protocol client -- enough for "navigate, wait, capture".
//!
//! Ported from V1's `Browser/CdpConnection.cs`. Hand-rolled there rather than taking a dependency,
//! for a reason that holds here too: a browser-automation crate would pull in a driver stack for the
//! nine protocol calls this uses, and the tool's headline promise is that it needs no runtime of its
//! own. `tokio-tungstenite` is already a workspace dependency.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{broadcast, oneshot};

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>;

/// One CDP event: its method name and its `params`.
#[derive(Debug, Clone)]
pub struct CdpEvent {
    pub method: String,
    pub params: Value,
}

pub struct CdpConnection {
    outgoing: tokio::sync::mpsc::UnboundedSender<String>,
    pending: Pending,
    events: broadcast::Sender<CdpEvent>,
    next_id: AtomicI64,
}

impl CdpConnection {
    pub async fn connect(web_socket_url: &str) -> Result<Self> {
        let (stream, _) = tokio_tungstenite::connect_async(web_socket_url)
            .await
            .with_context(|| format!("Connecting to DevTools at {web_socket_url}"))?;
        let (mut sink, mut source) = stream.split();

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let (events, _) = broadcast::channel(256);
        let (outgoing, mut outbox) = tokio::sync::mpsc::unbounded_channel::<String>();

        tokio::spawn(async move {
            while let Some(text) = outbox.recv().await {
                if sink
                    .send(tokio_tungstenite::tungstenite::Message::Text(text.into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        // The read loop. tungstenite reassembles fragmented frames for us, which is the thing V1
        // has to do by hand: `Page.captureScreenshot` returns a base64 PNG inline, and a 2880x1800
        // sketch arrives as several megabytes across dozens of frames. Parsing per frame yields
        // intermittent JSON errors that only ever show up on large pages.
        {
            let pending = Arc::clone(&pending);
            let events = events.clone();
            tokio::spawn(async move {
                while let Some(Ok(message)) = source.next().await {
                    let text = match message {
                        tokio_tungstenite::tungstenite::Message::Text(t) => t.to_string(),
                        tokio_tungstenite::tungstenite::Message::Close(_) => break,
                        _ => continue,
                    };
                    let Ok(value) = serde_json::from_str::<Value>(&text) else {
                        continue;
                    };

                    if let Some(id) = value.get("id").and_then(Value::as_i64) {
                        let sender = pending.lock().unwrap().remove(&id);
                        if let Some(sender) = sender {
                            let outcome = match value.get("error") {
                                Some(error) => Err(error.to_string()),
                                None => Ok(value.get("result").cloned().unwrap_or(Value::Null)),
                            };
                            let _ = sender.send(outcome);
                        }
                        continue;
                    }

                    if let Some(method) = value.get("method").and_then(Value::as_str) {
                        let _ = events.send(CdpEvent {
                            method: method.to_string(),
                            params: value.get("params").cloned().unwrap_or(Value::Null),
                        });
                    }
                }

                // Connection closed: fail anything still waiting so callers do not hang.
                let mut waiting = pending.lock().unwrap();
                for (_, sender) in waiting.drain() {
                    let _ = sender.send(Err("The DevTools connection closed.".to_string()));
                }
            });
        }

        Ok(Self {
            outgoing,
            pending,
            events,
            next_id: AtomicI64::new(0),
        })
    }

    pub async fn send(
        &self,
        method: &str,
        parameters: Option<Value>,
        session_id: Option<&str>,
    ) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);

        let mut envelope = json!({ "id": id, "method": method });
        if let Some(parameters) = parameters {
            envelope["params"] = parameters;
        }
        if let Some(session_id) = session_id {
            envelope["sessionId"] = json!(session_id);
        }

        self.outgoing
            .send(envelope.to_string())
            .map_err(|_| anyhow!("The DevTools connection is closed."))?;

        match rx.await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(error)) => bail!("CDP error: {error}"),
            Err(_) => bail!("The DevTools connection closed before {method} answered."),
        }
    }

    /// Waits for one CDP event, or fails on timeout.
    ///
    /// Subscribes before the caller's triggering command runs, so an event that arrives immediately
    /// is not missed -- which is why this hands back a receiver rather than taking a closure.
    pub fn subscribe(&self) -> broadcast::Receiver<CdpEvent> {
        self.events.subscribe()
    }

    pub async fn wait_for_event(
        &self,
        method: &str,
        timeout: Duration,
        receiver: &mut broadcast::Receiver<CdpEvent>,
    ) -> Result<Value> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                bail!("Timed out waiting for {method}.");
            }
            match tokio::time::timeout(remaining, receiver.recv()).await {
                Err(_) => bail!("Timed out waiting for {method}."),
                Ok(Err(broadcast::error::RecvError::Closed)) => {
                    bail!("The DevTools connection closed while waiting for {method}.")
                }
                // Lagged only means the buffer overflowed; keep reading rather than failing.
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Ok(event)) if event.method == method => return Ok(event.params),
                Ok(Ok(_)) => continue,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_refused_endpoint_names_what_it_tried() {
        // Port 1 is never a DevTools endpoint, so this exercises the connect error path without
        // needing a browser.
        // `unwrap_err` would need `CdpConnection: Debug`, which it cannot usefully derive: it holds
        // channel halves, not data.
        let err = match CdpConnection::connect("ws://127.0.0.1:1/devtools/browser/x").await {
            Ok(_) => panic!("port 1 answered the DevTools handshake"),
            Err(e) => e.to_string(),
        };
        assert!(err.contains("ws://127.0.0.1:1"), "got {err}");
    }

    #[test]
    fn ids_increment_from_one() {
        // V1 uses Interlocked.Increment on a zero-initialised field, so the first id is 1. Matching
        // it keeps a protocol trace comparable between the two implementations.
        let counter = AtomicI64::new(0);
        assert_eq!(counter.fetch_add(1, Ordering::SeqCst) + 1, 1);
        assert_eq!(counter.fetch_add(1, Ordering::SeqCst) + 1, 2);
    }
}
