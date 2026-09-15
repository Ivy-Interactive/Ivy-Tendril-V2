//! In-memory ring buffer for realtime WebSocket events, plus the monotonic sequence numbering
//! that lets a reconnecting client replay what it missed instead of re-fetching full state.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;
use tokio::sync::broadcast;

/// Default number of recent events retained for backfill/resume.
pub const DEFAULT_RING_BUFFER_CAPACITY: usize = 1024;

/// One dispatched WebSocket event, stamped with a monotonic sequence number.
///
/// `payload` is flattened on serialization, so an envelope wrapping `{"type": "status"}` serializes
/// as `{"seq": 1, "type": "status"}` — the shape every existing consumer (`ws_bridge.rs`'s
/// `val.get("type")` routing) already expects, with `seq` riding alongside for free.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WSEventEnvelope {
    pub seq: u64,
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

/// Bounded FIFO of recently dispatched events. Oldest events are evicted once `capacity` is
/// exceeded, so a client that has been offline longer than the buffer's retention window sees
/// [`EventRingBuffer::has_gap`] return `true` rather than silently missing events.
pub struct EventRingBuffer {
    capacity: usize,
    buffer: RwLock<VecDeque<WSEventEnvelope>>,
}

impl EventRingBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            buffer: RwLock::new(VecDeque::with_capacity(capacity)),
        }
    }

    pub fn push(&self, envelope: WSEventEnvelope) {
        let mut buffer = self.buffer.write().unwrap();
        buffer.push_back(envelope);
        while buffer.len() > self.capacity {
            buffer.pop_front();
        }
    }

    /// Buffered events with `seq > since`, in ascending order, capped at `limit` when present.
    pub fn get_since(&self, since: u64, limit: Option<usize>) -> Vec<WSEventEnvelope> {
        let buffer = self.buffer.read().unwrap();
        let events = buffer.iter().filter(|e| e.seq > since).cloned();
        match limit {
            Some(limit) => events.take(limit).collect(),
            None => events.collect(),
        }
    }

    pub fn oldest_seq(&self) -> Option<u64> {
        self.buffer.read().unwrap().front().map(|e| e.seq)
    }

    pub fn latest_seq(&self) -> Option<u64> {
        self.buffer.read().unwrap().back().map(|e| e.seq)
    }

    /// `true` when at least one event between `since` and the oldest retained one was evicted,
    /// meaning a backfill/resume from `since` cannot be complete.
    ///
    /// Sequence numbers are contiguous from 1, so `since` and `oldest` straddling a gap of zero
    /// (`oldest == since + 1`) is the normal "caught up" case, not a loss — including a fresh
    /// client's `since: 0` against an `oldest: 1` buffer that has never evicted anything.
    pub fn has_gap(&self, since: u64) -> bool {
        self.oldest_seq().is_some_and(|oldest| oldest > since + 1)
    }
}

impl Default for EventRingBuffer {
    fn default() -> Self {
        Self::new(DEFAULT_RING_BUFFER_CAPACITY)
    }
}

/// Stamps `payload` with the next monotonic sequence number, records the resulting envelope in
/// `ring_buffer`, and broadcasts its serialized form across `ws_tx`.
///
/// Free function (rather than a method requiring a constructed `AppState`) so it can be called
/// from contexts that only hold the three underlying pieces — e.g. the PR sync background task and
/// `AppState`'s own constructor, both of which run before an `Arc<AppState>` exists.
pub fn dispatch_event(
    seq_counter: &AtomicU64,
    ring_buffer: &EventRingBuffer,
    ws_tx: &broadcast::Sender<String>,
    payload: serde_json::Value,
) -> WSEventEnvelope {
    let seq = seq_counter.fetch_add(1, Ordering::SeqCst);
    let envelope = WSEventEnvelope { seq, payload };
    ring_buffer.push(envelope.clone());
    if let Ok(json) = serde_json::to_string(&envelope) {
        let _ = ws_tx.send(json);
    }
    envelope
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope(seq: u64) -> WSEventEnvelope {
        WSEventEnvelope {
            seq,
            payload: serde_json::json!({"type": "test"}),
        }
    }

    #[test]
    fn envelope_serializes_seq_flattened_alongside_payload() {
        let json = serde_json::to_value(envelope(7)).unwrap();
        assert_eq!(json["seq"], 7);
        assert_eq!(json["type"], "test");
    }

    #[test]
    fn retains_capacity_and_evicts_oldest() {
        let buffer = EventRingBuffer::new(3);
        for seq in 1..=5 {
            buffer.push(envelope(seq));
        }
        assert_eq!(buffer.oldest_seq(), Some(3));
        assert_eq!(buffer.latest_seq(), Some(5));
        let since = buffer.get_since(0, None);
        assert_eq!(
            since.iter().map(|e| e.seq).collect::<Vec<_>>(),
            vec![3, 4, 5]
        );
    }

    #[test]
    fn detects_gap_once_events_are_evicted() {
        let buffer = EventRingBuffer::new(2);
        for seq in 1..=4 {
            buffer.push(envelope(seq));
        }
        assert!(buffer.has_gap(1));
        assert!(!buffer.has_gap(3));
    }

    #[test]
    fn a_fresh_client_against_an_unevicted_buffer_has_no_gap() {
        let buffer = EventRingBuffer::new(1024);
        buffer.push(envelope(1));
        buffer.push(envelope(2));
        // Nothing has ever been evicted, so `since: 0` — "I have seen nothing" — is caught up, not
        // missing events
        assert!(!buffer.has_gap(0));
    }
}
