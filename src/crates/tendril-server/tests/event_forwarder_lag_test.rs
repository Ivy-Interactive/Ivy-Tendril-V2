//! The chat and job forwarders must survive falling behind their source.
//!
//! Both used `while let Ok(evt) = rx.recv().await`, which exits on `RecvError::Lagged` as readily as
//! on `Closed`. The chat channel holds 1000 events and `chat.stream_delta` fires per agent output
//! line, so lagging is reachable in ordinary use — and once it happened, **no chat event reached any
//! client again until the daemon restarted**, because that task is the only route chat events have to
//! the WebSocket. The same is now true of job events.
//!
//! These tests drive the receiver into `Lagged` for real (by overrunning a small channel before the
//! forwarder is spawned) rather than inspecting which arm the code takes.

use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::chat::execution::ChatEvent;
use tendril_core::jobs::manager::JobEvent;
use tendril_server::event_buffer::EventRingBuffer;
use tendril_server::state::spawn_event_forwarder;
use tokio::sync::broadcast;

fn delta(n: usize) -> ChatEvent {
    ChatEvent::StreamDelta {
        session_id: "s1".to_string(),
        message_id: "m1".to_string(),
        delta: n.to_string(),
    }
}

/// Reads one forwarded message, or fails.
async fn next_forwarded(rx: &mut broadcast::Receiver<String>) -> serde_json::Value {
    let text = tokio::time::timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("a forwarded event must arrive within 5s")
        .expect("the ws channel must not close");
    serde_json::from_str(&text).expect("forwarded events are JSON")
}

#[tokio::test]
async fn a_lagged_chat_forwarder_keeps_forwarding() {
    // Capacity 2 stands in for the real 1000: what matters is that the receiver is behind by more
    // than the channel retains, which is the same condition either way.
    let (chat_tx, chat_rx) = broadcast::channel::<ChatEvent>(2);

    // Sent before the forwarder is spawned, so `chat_rx` is already overrun: its first `recv` returns
    // `Lagged(3)`. This is the state a burst of stream deltas puts it in.
    for i in 0..5 {
        chat_tx.send(delta(i)).expect("the receiver is still alive");
    }

    let (ws_tx, mut ws_rx) = broadcast::channel::<String>(64);
    spawn_event_forwarder(
        "chat",
        chat_rx,
        Arc::new(AtomicU64::new(1)),
        Arc::new(EventRingBuffer::default()),
        ws_tx.clone(),
    );

    // The two events the channel still retains: a lag costs the client what was dropped and nothing
    // more. Before the fix the forwarder had already returned and these never arrived.
    let first = next_forwarded(&mut ws_rx).await;
    assert_eq!(first["type"], "chat.stream_delta");
    assert_eq!(first["delta"], "3");
    let second = next_forwarded(&mut ws_rx).await;
    assert_eq!(second["delta"], "4");

    // And the forwarder is still live for everything after the lag — the property whose absence made
    // this permanent rather than momentary.
    chat_tx.send(delta(99)).expect("still subscribed");
    let after = next_forwarded(&mut ws_rx).await;
    assert_eq!(after["delta"], "99");

    // Sequence numbers stay monotonic across the gap, so a client can still tell what it missed.
    assert!(
        after["seq"].as_u64().unwrap() > first["seq"].as_u64().unwrap(),
        "seq must keep increasing across a lag: {first} then {after}"
    );
}

#[tokio::test]
async fn a_lagged_job_forwarder_keeps_forwarding() {
    let (job_tx, job_rx) = broadcast::channel::<JobEvent>(2);

    let mut job = tendril_core::models::JobItem::new(
        "00001".to_string(),
        "ExecutePlan".to_string(),
        "/tmp/Plans/00001-Thing".to_string(),
        "FixtureProject".to_string(),
    );
    for _ in 0..5 {
        job.status = tendril_core::models::JobStatus::Running;
        job_tx
            .send(JobEvent::status_changed(&job))
            .expect("the receiver is still alive");
    }

    let (ws_tx, mut ws_rx) = broadcast::channel::<String>(64);
    spawn_event_forwarder(
        "job",
        job_rx,
        Arc::new(AtomicU64::new(1)),
        Arc::new(EventRingBuffer::default()),
        ws_tx.clone(),
    );

    let first = next_forwarded(&mut ws_rx).await;
    assert_eq!(first["type"], "job.status_changed");
    assert_eq!(first["jobId"], "00001");

    job.status = tendril_core::models::JobStatus::Completed;
    job_tx
        .send(JobEvent::terminal(&job).expect("a Completed job has an outcome"))
        .expect("still subscribed");

    // Drain until the completion arrives: the retained backlog comes first.
    for _ in 0..8 {
        let evt = next_forwarded(&mut ws_rx).await;
        if evt["type"] == "job.completed" {
            assert_eq!(evt["status"], "Completed");
            return;
        }
    }
    panic!("the completion never reached the WebSocket after a lag");
}
