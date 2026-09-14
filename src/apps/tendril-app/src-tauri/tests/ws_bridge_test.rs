//! The WebSocket bridge is constructed during `run()`'s `setup`, before the daemon is known to be
//! up. Construction must therefore never fail the app launch, however unreachable the URL is.

use tendril_app_lib::service::WsBridge;

/// Port 1 on loopback: nothing listens there, and connecting fails immediately rather than hanging.
const UNREACHABLE_WS_URL: &str = "ws://127.0.0.1:1/api/ws";

#[tokio::test]
async fn test_new_against_an_unreachable_url_does_not_panic() {
    let app = tauri::test::mock_app();

    let bridge = WsBridge::new(
        app.handle().clone(),
        UNREACHABLE_WS_URL.to_string(),
        Some("test-secret".to_string()),
    );

    // The connect attempt runs on a spawned task; give it long enough to fail and start backing off.
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    assert!(
        !bridge.is_connected(),
        "a bridge that never connected must not report itself connected"
    );

    // Still alive and still answering after the failure — the retry loop kept the task going.
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    assert!(!bridge.is_connected());
}

#[tokio::test]
async fn test_new_without_a_secret_is_accepted() {
    let app = tauri::test::mock_app();

    // A daemon running without auth is a legitimate configuration, so `None` must not panic either.
    let bridge = WsBridge::new(app.handle().clone(), UNREACHABLE_WS_URL.to_string(), None);

    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    assert!(!bridge.is_connected());
}
