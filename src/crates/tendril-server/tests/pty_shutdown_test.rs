//! A live pty session must not keep the daemon alive after it has been asked to stop.
//!
//! This is the `dev:desktop` shutdown hang, isolated. The runner signals the daemon, waits five
//! seconds, and then SIGKILLs it:
//!
//! ```text
//! [dev-desktop] The service did not stop within 5000ms; killing it.
//! ```
//!
//! The daemon printed "Shutting down Tendril Server gracefully...", released the listener, and then
//! sat there. The reason is not the server future — that returns promptly. It is that every pty
//! session (a review action, a chat terminal) reads its output on a `spawn_blocking` thread parked
//! in `reader.read(..)`, which returns only once the last slave fd closes. `#[tokio::main]` drops
//! the runtime when `main` returns, and dropping a runtime *joins* its blocking pool, so one parked
//! reader holds the process open for as long as its child lives — `sleep 3600`, a dev server, an
//! agent waiting for input.
//!
//! Signalling the process tree does not help, which is what made this hard to see: `portable_pty`
//! gives each child its own session so it can own the terminal, so it is in neither the daemon's
//! process group nor its session, and the group-wide SIGINT `dev-desktop.ts` sends reaches the
//! daemon and misses the child entirely.
//!
//! The assertions below are about *elapsed time to return*, because the bug was never a wrong value
//! anywhere — it was a process that would not leave.

use std::time::{Duration, Instant};

/// Generous enough that a loaded machine spawning `sh` is not the thing being measured, and far
/// below the "forever" the bug produced. `dev-desktop.ts` itself allows 5s.
const MUST_FINISH_WITHIN: Duration = Duration::from_secs(20);

/// Nothing here should take anywhere near this; it is the "it hung" tripwire.
const JOIN_TIMEOUT: Duration = Duration::from_secs(60);

/// A command that outlives the daemon unless something kills it. Long enough that a test which
/// passes by waiting it out is not possible.
const LONG_RUNNING: &str = "sleep 3600";

/// `pty::SESSIONS` is process-wide — deliberately, since a session is owned by the daemon rather
/// than by the request that opened it — and `kill_all_sessions` drains all of it. Cargo runs the
/// tests in this binary as threads of one process, so without this they reap each other's sessions
/// and the counts below become whichever test got there first.
///
/// Only the tests that actually spawn sessions take it. The two stream tests build their own
/// channels and never touch `SESSIONS`, so they have nothing to serialize against — and taking a
/// blocking lock across their awaits is what `clippy::await_holding_lock` exists to stop.
static SERIALIZE: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn serialized() -> std::sync::MutexGuard<'static, ()> {
    SERIALIZE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Runs `body` on its own runtime *on a separate thread*, and reports how long it took for that
/// thread to finish — runtime drop included.
///
/// Dropping the runtime is the whole point: that is where the join on the blocking pool happens, and
/// therefore where the hang was. Doing it on a worker thread rather than inline is what lets the
/// test fail with a message instead of hanging the suite forever.
fn time_to_full_shutdown<F>(body: F) -> Option<Duration>
where
    F: FnOnce() + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let start = Instant::now();
        body();
        let _ = tx.send(start.elapsed());
    });
    rx.recv_timeout(JOIN_TIMEOUT).ok()
}

/// The regression: a session whose child is still running must not outlive `run_server`'s teardown.
///
/// Without `kill_all_sessions` this never completes — the reader thread is parked in `read` on a pty
/// whose child is `sleep 3600`, so the runtime drop blocks for the full hour.
#[test]
fn a_live_pty_session_does_not_block_the_daemon_from_exiting() {
    let _guard = serialized();
    let elapsed = time_to_full_shutdown(|| {
        let runtime = tokio::runtime::Runtime::new().expect("build a runtime");
        runtime.block_on(async {
            let stream = tendril_server::pty::spawn_review_action(LONG_RUNNING, None, &[])
                .expect("spawn the pty session");
            // Held, not dropped: a client that has gone away is a different situation, and the bug
            // reproduces with the stream very much attached.
            let _stream = stream;

            // Let the child actually start, so the reader is genuinely parked in `read` rather than
            // still being set up.
            tokio::time::sleep(Duration::from_millis(400)).await;

            // Exactly what `run_server` now does on its way out, in the same place.
            tendril_server::pty::kill_all_sessions();
        });
        // `runtime` drops here, joining the blocking pool. This is the line that used to hang.
    });

    let elapsed = elapsed.unwrap_or_else(|| {
        panic!(
            "the daemon never finished shutting down: a pty session's blocking reader is still \
             parked in read(), which is exactly the hang dev-desktop.ts reports as \
             'The service did not stop within 5000ms; killing it.'"
        )
    });

    assert!(
        elapsed < MUST_FINISH_WITHIN,
        "shutdown with one live pty session took {elapsed:?}, which is past the {MUST_FINISH_WITHIN:?} \
         budget — dev-desktop.ts only waits 5s before it SIGKILLs the daemon"
    );
}

/// The same thing with several sessions, since a real session has one terminal per pane open.
#[test]
fn several_live_pty_sessions_do_not_block_the_daemon_from_exiting() {
    let _guard = serialized();
    let elapsed = time_to_full_shutdown(|| {
        let runtime = tokio::runtime::Runtime::new().expect("build a runtime");
        runtime.block_on(async {
            let streams: Vec<_> = (0..3)
                .map(|_| {
                    tendril_server::pty::spawn_review_action(LONG_RUNNING, None, &[])
                        .expect("spawn the pty session")
                })
                .collect();
            tokio::time::sleep(Duration::from_millis(400)).await;

            let killed = tendril_server::pty::kill_all_sessions();
            assert_eq!(killed, 3, "every live session must be accounted for");

            drop(streams);
        });
    });

    assert!(
        elapsed.is_some_and(|e| e < MUST_FINISH_WITHIN),
        "three live pty sessions must not hold the daemon open; took {elapsed:?}"
    );
}

/// The other half: a terminal's SSE body must end itself when the daemon is signalled.
///
/// Killing the child unblocks the *process*; this unblocks *graceful shutdown*. axum waits for every
/// open connection before the server future resolves, and a terminal stream has no terminal event of
/// its own — so an attached one used to sit on the full ten-second `SHUTDOWN_GRACE`, which is twice
/// the five seconds `dev-desktop.ts` allows. Measured end to end that was a daemon which "exited",
/// but only after 10s and a SIGKILL.
///
/// A quiet session is the case that matters, so this one produces no frames at all after the first:
/// a body that only noticed shutdown when a frame happened to arrive would pass a chattier test and
/// still hang here.
#[tokio::test]
async fn a_terminal_stream_ends_itself_when_the_daemon_shuts_down() {
    use futures_util::StreamExt;

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let (frame_tx, frame_rx) = tokio::sync::mpsc::channel(8);

    let mut body = Box::pin(tendril_server::pty::shutdown_aware_body(
        frame_rx,
        shutdown_rx,
    ));

    // One frame, so the stream is provably established and attached.
    frame_tx
        .send(Ok(axum::response::sse::Event::default().data("hello")))
        .await
        .expect("queue a frame");
    assert!(
        body.next().await.is_some(),
        "the stream must deliver frames normally"
    );

    // Nothing more will ever arrive on `frame_tx` — a terminal sitting at a prompt. The sender is
    // deliberately kept alive, because a *closed* channel ends the stream for an unrelated reason
    // and would make this pass without the fix.
    let signalled = Instant::now();
    shutdown_tx.send(true).expect("signal shutdown");

    let ended = tokio::time::timeout(Duration::from_secs(5), body.next())
        .await
        .expect(
            "the stream did not end when the daemon was signalled: axum's graceful shutdown will \
             wait for it, which is the 10s SHUTDOWN_GRACE that dev-desktop.ts cuts short at 5s",
        );

    assert!(
        ended.is_none(),
        "a signalled stream must end rather than yield another frame"
    );
    assert!(
        signalled.elapsed() < Duration::from_secs(1),
        "the stream should end promptly on the signal, not on a later poll; took {:?}",
        signalled.elapsed()
    );

    drop(frame_tx);
}

/// A stream opened *after* the signal must not attach at all — `watch` latches for exactly this, and
/// a late subscriber that missed the edge would hang the same way.
#[tokio::test]
async fn a_terminal_stream_opened_during_shutdown_ends_immediately() {
    use futures_util::StreamExt;

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    shutdown_tx.send(true).expect("signal shutdown first");

    let (frame_tx, frame_rx) = tokio::sync::mpsc::channel(8);
    frame_tx
        .send(Ok(axum::response::sse::Event::default().data("late")))
        .await
        .expect("queue a frame");

    let mut body = Box::pin(tendril_server::pty::shutdown_aware_body(
        frame_rx,
        shutdown_rx,
    ));

    let first = tokio::time::timeout(Duration::from_secs(5), body.next())
        .await
        .expect("a stream opened during shutdown must not hang");
    assert!(
        first.is_none(),
        "a stream opened after the signal must end at once, even with a frame already queued"
    );
}

/// Killing the sessions must not depend on there being any: a daemon that never ran a terminal is
/// the common case, and this is called unconditionally on every shutdown.
#[test]
fn killing_sessions_when_there_are_none_is_a_no_op() {
    let _guard = serialized();
    let runtime = tokio::runtime::Runtime::new().expect("build a runtime");
    runtime.block_on(async {
        assert_eq!(tendril_server::pty::kill_all_sessions(), 0);
        // Idempotent, because shutdown can be reached more than one way.
        assert_eq!(tendril_server::pty::kill_all_sessions(), 0);
    });
}
