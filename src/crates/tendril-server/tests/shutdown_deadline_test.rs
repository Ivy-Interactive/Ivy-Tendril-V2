//! The daemon has to exit when it is asked to, even with a stream open.
//!
//! `/api/changes/events` and `/api/ws` have no terminal event by design — they live as long as their
//! client does — and the desktop app holds one permanently. axum's graceful shutdown waits for
//! *every* connection, so an unbounded plaintext server never returns from `serve` and has to be
//! SIGKILLed, which skips `MasterGuard::drop` and leaves `.master` behind (issue #127).
//!
//! These tests hold a real, never-ending SSE response open across the shutdown signal rather than
//! asserting that a flag was set: the whole bug was that the signal *was* delivered and the server
//! still would not leave.

use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::get;
use axum::Router;
use std::convert::Infallible;
use std::task::Poll;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Short enough to keep the suite fast, long enough to be told apart from "exited immediately".
const GRACE: Duration = Duration::from_millis(400);

/// A route shaped like `stream_changes`: an SSE body that never yields and never ends.
fn endless_stream_router() -> Router {
    Router::new().route(
        "/stream",
        get(|| async {
            let stream = futures_util::stream::poll_fn(|_cx| {
                Poll::Pending::<Option<Result<Event, Infallible>>>
            });
            Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        }),
    )
}

/// Opens `/stream` and reads the response head, so the connection is provably established and the
/// endless body provably in flight. The returned socket must stay alive.
async fn open_stream(port: u16) -> TcpStream {
    let mut socket = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("connect to the test server");
    socket
        .write_all(b"GET /stream HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .expect("send the stream request");

    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    // Read up to the end of the response head; anything after that is the (never-arriving) body.
    while !head.ends_with(b"\r\n\r\n") {
        let n = socket
            .read(&mut byte)
            .await
            .expect("read the response head");
        assert!(n > 0, "server closed the connection before answering");
        head.extend_from_slice(&byte);
    }
    let head = String::from_utf8_lossy(&head).to_string();
    assert!(head.starts_with("HTTP/1.1 200"), "unexpected head: {head}");
    assert!(
        head.contains("text/event-stream"),
        "the fixture must hold an SSE stream open, got: {head}"
    );

    socket
}

#[tokio::test]
async fn shutdown_completes_within_the_grace_with_a_stream_open() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();

    let (signal_tx, signal_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(tendril_server::serve_with_shutdown_deadline(
        listener,
        endless_stream_router(),
        async move {
            let _ = signal_rx.await;
        },
        GRACE,
    ));

    let _stream = open_stream(port).await;

    let signalled = Instant::now();
    signal_tx.send(()).expect("deliver the shutdown signal");

    // Four times the grace: generous enough not to be flaky, far short of "never", which is what the
    // unbounded server does (see the test below).
    let finished = tokio::time::timeout(GRACE * 4, server)
        .await
        .expect("the server must return once the shutdown grace elapses, stream or no stream")
        .expect("server task panicked");
    finished.expect("serving ended with an error");

    let elapsed = signalled.elapsed();
    assert!(
        elapsed >= GRACE,
        "in-flight requests must still get the full grace; returned after {elapsed:?}"
    );
}

/// The regression this pins: the same server *without* a deadline, which is what the plaintext arm of
/// `run_server` used to be. If this ever stops hanging, axum changed its graceful-shutdown semantics
/// and the deadline above can be revisited.
#[tokio::test]
async fn unbounded_graceful_shutdown_hangs_with_a_stream_open() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();

    let (signal_tx, signal_rx) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            endless_stream_router().into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = signal_rx.await;
        })
        .await
    });

    let _stream = open_stream(port).await;
    signal_tx.send(()).expect("deliver the shutdown signal");

    assert!(
        tokio::time::timeout(GRACE * 4, server).await.is_err(),
        "an unbounded graceful shutdown is expected to wait forever for the open stream"
    );
}

/// The `dev:desktop` regression, on the real route rather than a fixture.
///
/// The deadline above is a safety net, and for a long time it was also the *normal* path: the desktop
/// app holds `/api/changes/events` open for its whole life, nothing ever told that stream the daemon
/// was leaving, so every shutdown waited out the full `SHUTDOWN_GRACE` and `dev-desktop.ts` — which
/// only waits five seconds — SIGKILLed the daemon on every single run. A SIGKILL skips
/// `MasterGuard::drop`, so it also left `.master` behind.
///
/// The grace here is deliberately long: an assertion that the server returned in a fraction of it is
/// an assertion that the stream ended *itself*, not that a timer eventually fired.
#[tokio::test]
async fn change_stream_does_not_hold_the_daemon_open_at_shutdown() {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-shutdown-stream-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(tendril_home.join("Plans")).expect("create the test home");

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let port = listener.local_addr().expect("addr").port();

    let secret = tendril_core::config::generate_bearer_secret();
    let state = std::sync::Arc::new(tendril_server::AppState::with_plans_dir(
        tendril_home.clone(),
        tendril_home.join("Plans"),
        secret.clone(),
    ));
    let app = tendril_server::create_router(state.clone());

    // Ten seconds, as the daemon itself uses. Riding it out is the bug; the assertion below is that
    // we do not come close.
    let grace = Duration::from_secs(10);
    let (signal_tx, signal_rx) = tokio::sync::oneshot::channel::<()>();
    let signalled_state = state.clone();
    let server = tokio::spawn(tendril_server::serve_with_shutdown_deadline(
        listener,
        app,
        async move {
            let _ = signal_rx.await;
            // Exactly what `run_server` does when the signal lands.
            signalled_state.begin_shutdown();
        },
        grace,
    ));

    // A real subscriber on the real route, with the response head read so the stream is provably
    // established and provably still attached when the signal arrives.
    let mut response = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/api/changes/events"))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {secret}"))
        .send()
        .await
        .expect("open the change stream");
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.starts_with("text/event-stream")),
        Some(true),
        "the fixture must be holding a real SSE stream open"
    );

    let signalled = Instant::now();
    signal_tx.send(()).expect("deliver the shutdown signal");

    let finished = tokio::time::timeout(grace * 2, server)
        .await
        .expect("the daemon must return with a change stream still attached")
        .expect("server task panicked");
    finished.expect("serving ended with an error");

    let elapsed = signalled.elapsed();
    assert!(
        elapsed < grace / 2,
        "the change stream must end itself rather than ride the grace out; \
         returned after {elapsed:?} of a {grace:?} grace"
    );

    // And the client sees the stream close, rather than being left hanging on a dead socket.
    let tail = tokio::time::timeout(Duration::from_secs(5), response.chunk())
        .await
        .expect("the stream must be closed, not left open");
    assert!(
        matches!(tail, Ok(None)) || tail.is_err(),
        "the client's stream should have ended once the daemon shut down"
    );

    let _ = std::fs::remove_dir_all(&tendril_home);
}
