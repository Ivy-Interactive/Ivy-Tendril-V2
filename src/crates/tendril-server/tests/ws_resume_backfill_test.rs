//! Realtime event resume and backfill: monotonic sequencing, ring buffer retention, WebSocket
//! `?since=<seq>` replay, and the REST backfill endpoints that back it.

use futures_util::StreamExt;
use reqwest::header::AUTHORIZATION;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{generate_bearer_secret, MasterGuard};
use tendril_server::{create_router, AppState};
use tokio_tungstenite::tungstenite::Message as WsMessage;

struct TestServer {
    pub tendril_home: PathBuf,
    pub port: u16,
    pub secret: String,
    pub state: Arc<AppState>,
    _guard: MasterGuard,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

impl TestServer {
    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }

    fn ws_url(&self, query: &str) -> String {
        format!(
            "ws://127.0.0.1:{}/api/ws?token={}&{}",
            self.port, self.secret, query
        )
    }

    fn bearer(&self) -> String {
        format!("Bearer {}", self.secret)
    }
}

async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-ws-resume-backfill-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let host_str = "127.0.0.1".to_string();
    let tokio_listener = tokio::net::TcpListener::bind(format!("{}:0", host_str))
        .await
        .unwrap();
    let port = tokio_listener.local_addr().unwrap().port();

    let secret = generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, &host_str, "http").unwrap();

    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();

    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));

    let app = create_router(state.clone());
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _ = axum::serve(tokio_listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    TestServer {
        tendril_home,
        port,
        secret,
        state,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

#[tokio::test]
async fn test_monotonic_sequence_generation() {
    let server = start_test_server().await;

    let mut seqs = Vec::new();
    for i in 0..5 {
        let envelope = server
            .state
            .dispatch_ws_event(json!({"type": "test_event", "i": i}));
        seqs.push(envelope.seq);
    }

    // Strictly increasing by exactly one, whatever the counter's starting value was.
    for pair in seqs.windows(2) {
        assert_eq!(pair[1], pair[0] + 1, "sequence numbers must be consecutive");
    }
    assert_eq!(seqs.len(), 5);
}

#[tokio::test]
async fn test_ring_buffer_retention_and_eviction() {
    let server = start_test_server().await;

    // One more than the default capacity (1024), so exactly the first event is evicted.
    let total = tendril_server::event_buffer::DEFAULT_RING_BUFFER_CAPACITY + 1;
    let mut last_seq = 0u64;
    for i in 0..total {
        let envelope = server
            .state
            .dispatch_ws_event(json!({"type": "fill", "i": i}));
        last_seq = envelope.seq;
    }

    let oldest = server.state.ring_buffer.oldest_seq().unwrap();
    let latest = server.state.ring_buffer.latest_seq().unwrap();
    assert_eq!(latest, last_seq);
    assert_eq!(
        latest - oldest + 1,
        tendril_server::event_buffer::DEFAULT_RING_BUFFER_CAPACITY as u64,
        "the buffer must retain exactly `capacity` events once it has overflowed"
    );

    // The very first dispatched event's seq predates everything now retained: a resume/backfill
    // from before it must be reported as a gap.
    assert!(server.state.ring_buffer.has_gap(0));
    assert!(!server.state.ring_buffer.has_gap(oldest));
}

#[tokio::test]
async fn test_ws_connection_resume_replay() {
    let server = start_test_server().await;

    // Establish a first connection so events dispatched before "disconnecting" have somewhere to go,
    // then drop it — the ring buffer is what makes replay possible after that, not the socket.
    let (first_conn, _) = tokio_tungstenite::connect_async(server.ws_url("since=0"))
        .await
        .expect("initial connection must succeed");
    drop(first_conn);

    let before = server
        .state
        .dispatch_ws_event(json!({"type": "before_resume", "n": 1}));

    // Dispatched while no client is connected. Resume must still surface these.
    let missed_a = server
        .state
        .dispatch_ws_event(json!({"type": "missed", "n": 2}));
    let missed_b = server
        .state
        .dispatch_ws_event(json!({"type": "missed", "n": 3}));

    let (mut resumed, _) =
        tokio_tungstenite::connect_async(server.ws_url(&format!("since={}", before.seq)))
            .await
            .expect("resumed connection must succeed");

    let mut replayed_seqs = Vec::new();
    for _ in 0..2 {
        let msg = tokio::time::timeout(std::time::Duration::from_secs(5), resumed.next())
            .await
            .expect("a replayed event must arrive within 5s")
            .expect("stream must not end")
            .expect("frame must not be an error");
        if let WsMessage::Text(text) = msg {
            let value: Value = serde_json::from_str(&text).unwrap();
            replayed_seqs.push(value["seq"].as_u64().unwrap());
        }
    }
    assert_eq!(replayed_seqs, vec![missed_a.seq, missed_b.seq]);

    // A live event dispatched after resume must arrive exactly once, not duplicated with the replay.
    let live = server
        .state
        .dispatch_ws_event(json!({"type": "live", "n": 4}));
    let live_msg = tokio::time::timeout(std::time::Duration::from_secs(5), resumed.next())
        .await
        .expect("the live event must arrive within 5s")
        .expect("stream must not end")
        .expect("frame must not be an error");
    if let WsMessage::Text(text) = live_msg {
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["seq"].as_u64().unwrap(), live.seq);
    } else {
        panic!("expected a text frame for the live event");
    }
}

#[tokio::test]
async fn test_rest_backfill_endpoint() {
    let server = start_test_server().await;

    let e1 = server.state.dispatch_ws_event(json!({"type": "a"}));
    let e2 = server.state.dispatch_ws_event(json!({"type": "b"}));
    let e3 = server.state.dispatch_ws_event(json!({"type": "c"}));

    let client = reqwest::Client::new();
    let resp = client
        .get(server.url(&format!("/api/events/backfill?since={}", e1.seq)))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);

    let body: Value = resp.json().await.unwrap();
    let events = body["events"].as_array().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["seq"].as_u64().unwrap(), e2.seq);
    assert_eq!(events[1]["seq"].as_u64().unwrap(), e3.seq);
    assert_eq!(body["latest_seq"].as_u64().unwrap(), e3.seq);
    assert_eq!(body["oldest_seq"].as_u64().unwrap(), e1.seq);
    assert_eq!(body["gap"], false);

    // `/api/events` is the same handler under a shorter alias.
    let resp2 = client
        .get(server.url("/api/events"))
        .header(AUTHORIZATION, server.bearer())
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.status(), reqwest::StatusCode::OK);
    let body2: Value = resp2.json().await.unwrap();
    assert_eq!(body2["events"].as_array().unwrap().len(), 3);

    // A `since` older than everything retained is a gap once the buffer has actually evicted past
    // it; here nothing has been evicted, so `since=0` must not be reported as one.
    assert_eq!(body2["gap"], false);
}

/// A client that falls behind the broadcast channel must be told to resync and keep receiving.
///
/// The per-client sender task used `while let Ok(msg) = rx.recv().await`, which exits on
/// `RecvError::Lagged` as readily as on `Closed` — but the socket stays open, so the client never sees
/// a close, never reconnects, and goes silently deaf for the rest of its life. This asserts the two
/// things that fixes it: the client is told, and later events still arrive.
#[tokio::test]
async fn test_ws_client_survives_a_lagged_broadcast() {
    let server = start_test_server().await;

    let (mut socket, _) = tokio_tungstenite::connect_async(server.ws_url(""))
        .await
        .expect("connection must succeed");

    // Dispatched in one synchronous burst on a current-thread runtime, so the per-client task cannot
    // be scheduled in between: it is guaranteed to still be at the start of the channel when the
    // burst overruns `ws_tx`'s 500-slot capacity.
    let overrun = 600;
    for i in 0..overrun {
        server
            .state
            .dispatch_ws_event(json!({"type": "flood", "i": i}));
    }
    let live = server.state.dispatch_ws_event(json!({"type": "after_lag"}));

    // Read until the event dispatched after the lag arrives. Reaching it at all is the assertion:
    // before the fix the task had already returned and nothing further was ever written.
    let mut saw_resync = false;
    let mut saw_live = false;
    for _ in 0..(overrun + 32) {
        let msg = tokio::time::timeout(std::time::Duration::from_secs(5), socket.next())
            .await
            .expect("the client must keep receiving after a lag")
            .expect("stream must not end")
            .expect("frame must not be an error");
        if let WsMessage::Text(text) = msg {
            let value: Value = serde_json::from_str(&text).unwrap();
            if value["type"] == "resync" {
                saw_resync = true;
                assert!(
                    value["dropped"].as_u64().unwrap_or(0) > 0,
                    "a resync hint names how many events were lost: {value}"
                );
            }
            if value["seq"].as_u64() == Some(live.seq) {
                saw_live = true;
                break;
            }
        }
    }

    assert!(
        saw_resync,
        "a client that lost events must be told, or it cannot know to refetch"
    );
    assert!(
        saw_live,
        "events dispatched after a lag must still reach the client"
    );
}
