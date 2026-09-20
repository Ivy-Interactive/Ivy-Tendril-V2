//! The app's share-tunnel bridge, against a mock daemon on a loopback port.
//!
//! No real daemon, no `.master`, no `cloudflared`, no network beyond `127.0.0.1`. The mock answers the
//! four `/api/tunnel/share*` shapes the real daemon answers, including the failure ones, because those
//! are what the share dialog has to render.

use axum::{
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tendril_app_lib::service::TunnelClient;
use tokio::net::TcpListener;

const SECRET: &str = "mock-daemon-secret";

/// How the mock behaves, so one server can stand in for each state the dialog has to handle.
#[derive(Clone, Copy)]
enum Behaviour {
    /// `GET` reports disabled; `POST` reports connecting, and every `GET` after it reports connected —
    /// the real sequence the dialog polls through.
    Normal,
    /// `POST` refuses with the daemon's not-installed message.
    NoCloudflared,
    /// A daemon that predates sharing.
    OldDaemon,
}

async fn spawn_mock(behaviour: Behaviour) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let started = Arc::new(AtomicUsize::new(0));
    let authorised = |headers: &HeaderMap| -> bool {
        headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value == format!("Bearer {SECRET}"))
    };

    let app = match behaviour {
        Behaviour::OldDaemon => Router::new(),
        _ => {
            let start_counter = started.clone();
            let stop_counter = started.clone();
            let get_counter = started.clone();
            Router::new()
                .route(
                    "/api/tunnel/share",
                    get(move |headers: HeaderMap| {
                        let counter = get_counter.clone();
                        async move {
                            if !authorised(&headers) {
                                return (
                                    StatusCode::UNAUTHORIZED,
                                    Json(json!({ "error": "Unauthorized" })),
                                );
                            }
                            let body = if counter.load(Ordering::SeqCst) == 0 {
                                json!({ "status": "disabled", "installed": true, "sharePort": 5011 })
                            } else {
                                json!({
                                    "status": "connected",
                                    "url": "https://calm-otter.trycloudflare.com",
                                    "shareToken": "share-token-abc",
                                    "installed": true,
                                    "startedAt": "2026-09-16T10:00:00Z",
                                    "sharePort": 5011
                                })
                            };
                            (StatusCode::OK, Json(body))
                        }
                    })
                    .post(move |headers: HeaderMap| {
                        let counter = start_counter.clone();
                        async move {
                            if !authorised(&headers) {
                                return (
                                    StatusCode::UNAUTHORIZED,
                                    Json(json!({ "error": "Unauthorized" })),
                                );
                            }
                            if matches!(behaviour, Behaviour::NoCloudflared) {
                                return (
                                    StatusCode::CONFLICT,
                                    Json(json!({
                                        "error": "cloudflared is not installed. Tendril looked for it at /tmp/tools/cloudflared and on PATH. Install it with your package manager (macOS: `brew install cloudflared`)."
                                    })),
                                );
                            }
                            counter.fetch_add(1, Ordering::SeqCst);
                            (
                                StatusCode::OK,
                                Json(json!({
                                    "status": "connecting",
                                    "shareToken": "share-token-abc",
                                    "installed": true,
                                    "startedAt": "2026-09-16T10:00:00Z",
                                    "sharePort": 5011
                                })),
                            )
                        }
                    })
                    .delete(move |headers: HeaderMap| {
                        let counter = stop_counter.clone();
                        async move {
                            if !authorised(&headers) {
                                return (
                                    StatusCode::UNAUTHORIZED,
                                    Json(json!({ "error": "Unauthorized" })),
                                );
                            }
                            counter.store(0, Ordering::SeqCst);
                            (
                                StatusCode::OK,
                                Json(json!({ "status": "disabled", "installed": true, "sharePort": 5011 })),
                            )
                        }
                    }),
                )
                .route(
                    "/api/tunnel/share/install",
                    get(move |headers: HeaderMap| async move {
                        if !authorised(&headers) {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "error": "Unauthorized" })),
                            );
                        }
                        (
                            StatusCode::OK,
                            Json(json!({
                                "installed": false,
                                "expectedPath": "/tmp/home/tools/cloudflared",
                                "assetName": "cloudflared-darwin-arm64.tgz",
                                "downloadUrl": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
                                "downloadable": true,
                                "progress": {
                                    "phase": "downloading",
                                    "downloadedBytes": 1048576,
                                    "totalBytes": 20971520
                                }
                            })),
                        )
                    })
                    // The daemon answers a started install with `202 Accepted` and the state to poll.
                    // The bridge has to treat that as success, not as an unexpected status.
                    .post(move |headers: HeaderMap| async move {
                        if !authorised(&headers) {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "error": "Unauthorized" })),
                            );
                        }
                        (
                            StatusCode::ACCEPTED,
                            Json(json!({
                                "installed": false,
                                "expectedPath": "/tmp/home/tools/cloudflared",
                                "assetName": "cloudflared-darwin-arm64.tgz",
                                "downloadUrl": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
                                "downloadable": true,
                                "progress": { "phase": "resolving", "downloadedBytes": 0 }
                            })),
                        )
                    })
                    .delete(move |headers: HeaderMap| async move {
                        if !authorised(&headers) {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "error": "Unauthorized" })),
                            );
                        }
                        (
                            StatusCode::OK,
                            Json(json!({
                                "installed": false,
                                "expectedPath": "/tmp/home/tools/cloudflared",
                                "assetName": "cloudflared-darwin-arm64.tgz",
                                "downloadUrl": "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz",
                                "downloadable": true,
                                "progress": { "phase": "cancelled", "downloadedBytes": 0 }
                            })),
                        )
                    }),
                )
        }
    };

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let addr = listener.local_addr().expect("mock addr");
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (addr, handle)
}

fn client(addr: SocketAddr, secret: Option<&str>) -> TunnelClient {
    TunnelClient::new(format!("http://{addr}"), secret.map(str::to_string))
}

/// The sequence the dialog actually walks: read status, start, poll until connected, stop.
#[tokio::test]
async fn the_bridge_walks_the_start_poll_stop_sequence() {
    let (addr, server) = spawn_mock(Behaviour::Normal).await;
    let client = client(addr, Some(SECRET));

    let initial = client.status().await.expect("status");
    assert_eq!(initial.status, "disabled");
    assert!(initial.url.is_none());
    assert!(initial.share_token.is_none());
    assert_eq!(initial.share_port, 5011);

    let started = client.start().await.expect("start");
    assert_eq!(
        started.status, "connecting",
        "start returns before the tunnel is routable"
    );
    assert_eq!(started.share_token.as_deref(), Some("share-token-abc"));
    assert!(
        started.url.is_none(),
        "a connecting tunnel has no URL to show yet"
    );

    let connected = client.status().await.expect("poll");
    assert_eq!(connected.status, "connected");
    assert_eq!(
        connected.url.as_deref(),
        Some("https://calm-otter.trycloudflare.com")
    );
    assert_eq!(connected.share_token.as_deref(), Some("share-token-abc"));

    let stopped = client.stop().await.expect("stop");
    assert_eq!(stopped.status, "disabled");
    assert!(stopped.url.is_none() && stopped.share_token.is_none());

    server.abort();
}

/// The message the operator sees when `cloudflared` is missing is the daemon's, verbatim, because it is
/// the only place the install instructions live.
#[tokio::test]
async fn a_missing_cloudflared_surfaces_the_daemons_install_instructions() {
    let (addr, server) = spawn_mock(Behaviour::NoCloudflared).await;
    let err = client(addr, Some(SECRET))
        .start()
        .await
        .expect_err("start is refused");

    assert_eq!(err.code, "TUNNEL_PRECONDITION");
    assert!(
        err.message.contains("cloudflared is not installed"),
        "{err}"
    );
    assert!(err.message.contains("brew install cloudflared"), "{err}");
    assert!(err.message.contains("/tmp/tools/cloudflared"), "{err}");

    server.abort();
}

/// The install check has to be readable even when nothing is installed — that is its whole job.
#[tokio::test]
async fn the_install_check_reports_where_to_get_cloudflared() {
    let (addr, server) = spawn_mock(Behaviour::Normal).await;
    let state = client(addr, Some(SECRET))
        .install_state()
        .await
        .expect("install state");

    assert!(!state.installed);
    assert!(state.binary_path.is_none());
    assert_eq!(state.expected_path, "/tmp/home/tools/cloudflared");
    assert!(state.download_url.ends_with(&state.asset_name));
    // The same read carries the progress of a running install, which is how the pane draws a bar
    // without a second endpoint or a stream.
    let progress = state.progress.expect("a running install reports progress");
    assert_eq!(progress.phase, "downloading");
    assert_eq!(progress.downloaded_bytes, 1_048_576);
    assert_eq!(progress.total_bytes, Some(20_971_520));

    server.abort();
}

/// Starting an install and getting out of one, over the bridge.
///
/// `202 Accepted` is the daemon's answer to a started download — it has begun, it is not finished — and
/// the bridge must read it as success. Without that, the Install button would report a failure for a
/// download that is in fact running.
#[tokio::test]
async fn an_install_can_be_started_and_cancelled_over_the_bridge() {
    let (addr, server) = spawn_mock(Behaviour::Normal).await;
    let client = client(addr, Some(SECRET));

    let started = client.install().await.expect("install starts");
    assert_eq!(
        started.progress.expect("progress").phase,
        "resolving",
        "a started install reports as running, not done"
    );
    assert!(started.downloadable);

    let cancelled = client.cancel_install().await.expect("install cancels");
    assert_eq!(cancelled.progress.expect("progress").phase, "cancelled");
    assert!(!cancelled.installed, "cancelling installs nothing");

    server.abort();
}

/// The bearer secret is the credential. Without it every route is a 401, which the bridge has to report
/// as `UNAUTHENTICATED` rather than as a generic failure.
#[tokio::test]
async fn a_missing_secret_is_reported_as_unauthenticated() {
    let (addr, server) = spawn_mock(Behaviour::Normal).await;
    let client = client(addr, None);

    for err in [
        client.status().await.expect_err("status"),
        client.start().await.expect_err("start"),
        client.stop().await.expect_err("stop"),
        client.install_state().await.expect_err("install"),
        // Starting or cancelling a download is owner-only too: neither may be driven without the
        // bearer secret.
        client.install().await.expect_err("install start"),
        client.cancel_install().await.expect_err("install cancel"),
    ] {
        assert_eq!(err.code, "UNAUTHENTICATED", "{err}");
    }

    server.abort();
}

/// A daemon from before sharing existed answers 404. The dialog must say "update the daemon", not
/// "something went wrong".
#[tokio::test]
async fn a_daemon_without_the_routes_is_reported_as_unsupported() {
    let (addr, server) = spawn_mock(Behaviour::OldDaemon).await;
    let err = client(addr, Some(SECRET))
        .status()
        .await
        .expect_err("no such route");

    assert_eq!(err.code, "TUNNEL_UNSUPPORTED");
    assert!(err.message.contains("too old"), "{err}");

    server.abort();
}

/// A daemon that is not running at all is `DISCONNECTED`, not an HTTP error — the app has a specific
/// "service is down" surface for that state.
#[tokio::test]
async fn an_unreachable_daemon_is_reported_as_disconnected() {
    // Bind and immediately drop, so the port is almost certainly closed.
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("addr");
    drop(listener);

    let err = client(addr, Some(SECRET))
        .status()
        .await
        .expect_err("nothing listening");
    assert_eq!(err.code, "DISCONNECTED", "{err}");
    assert!(err.message.contains("Could not reach"), "{err}");
}
