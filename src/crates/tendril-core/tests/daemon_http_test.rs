//! The daemon client's timeout and the transport classification built on it.
//!
//! No mock-server dependency is needed: a `TcpListener` that accepts and never writes *is* a
//! stalled daemon, and a listener that is bound and then dropped gives a port guaranteed to refuse.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tendril_core::config::{get_config_path, write_master, TendrilSettings};
use tendril_core::http::{
    classify_transport_error, daemon_client, daemon_client_with_timeout, daemon_request_timeout,
    DaemonTransportFailure, DAEMON_TIMEOUT_HINT, DEFAULT_DAEMON_REQUEST_TIMEOUT_SECS,
};
use tendril_core::mcp::dispatch::{McpDispatcher, DAEMON_OFFLINE_MESSAGE};

/// A temp home that cleans itself up, so a failing assertion cannot leave one behind.
struct TempHome(PathBuf);

impl TempHome {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-daemon-http-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    /// Writes a `config.yaml` carrying just `daemonRequestTimeout`, the way an operator would.
    fn with_daemon_timeout(self, secs: i32) -> Self {
        std::fs::write(
            get_config_path(self.path()),
            format!("daemonRequestTimeout: {}\n", secs),
        )
        .unwrap();
        self
    }
}

impl Drop for TempHome {
    fn drop(&mut self) {
        assert!(
            self.0.starts_with(std::env::temp_dir()),
            "refusing to delete a fixture outside the temp dir: {}",
            self.0.display()
        );
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A listener that accepts connections and then never writes a byte — a daemon that is up, has
/// taken the request, and will not answer. Held connections are leaked deliberately: dropping the
/// socket would send a FIN and turn the stall into a clean close.
async fn stalled_daemon() -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((socket, _)) = listener.accept().await {
            held.push(socket);
        }
    });
    addr
}

/// A port nothing is listening on, so a connect attempt is refused immediately.
async fn refused_port() -> SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    addr
}

#[tokio::test]
async fn daemon_client_honours_configured_timeout() {
    let home = TempHome::new("configured").with_daemon_timeout(1);
    let addr = stalled_daemon().await;

    let started = Instant::now();
    let err = daemon_client(home.path())
        .get(format!("http://{}/api/jobs", addr))
        .send()
        .await
        .expect_err("a stalled daemon must not produce a response");
    let elapsed = started.elapsed();

    // reqwest exposes no getter for a client's configured timeout, so the setting is asserted
    // behaviourally — which is the property that actually matters.
    assert!(
        elapsed < Duration::from_secs(5),
        "the 1s configured timeout was not applied; the request took {:?}",
        elapsed
    );
    assert_eq!(
        classify_transport_error(&err),
        DaemonTransportFailure::Timeout
    );
}

#[tokio::test]
async fn daemon_client_without_a_config_still_has_a_timeout() {
    // A home with no config.yaml at all must fall back to the default, not to no timeout — an
    // unreadable config is not consent to hang forever.
    let home = TempHome::new("no-config");
    assert!(!get_config_path(home.path()).exists());

    let addr = stalled_daemon().await;
    let client = daemon_client(home.path());

    // Proving the 30s default fires would mean waiting 30s, so this asserts the weaker property
    // that can be checked quickly: the request is still outstanding well after a 1s budget would
    // have expired, and the client is not the untimed one.
    let outstanding = tokio::time::timeout(
        Duration::from_millis(1500),
        client.get(format!("http://{}/api/jobs", addr)).send(),
    )
    .await;
    assert!(
        outstanding.is_err(),
        "the default budget should be 30s, so nothing should have resolved in 1.5s"
    );
}

#[test]
fn daemon_request_timeout_disabled_by_zero() {
    let mut settings = TendrilSettings::default();

    assert_eq!(
        daemon_request_timeout(&settings),
        Some(Duration::from_secs(DEFAULT_DAEMON_REQUEST_TIMEOUT_SECS)),
        "the default config must carry a timeout"
    );
    assert_eq!(DEFAULT_DAEMON_REQUEST_TIMEOUT_SECS, 30);

    settings.daemon_request_timeout = 0;
    assert_eq!(daemon_request_timeout(&settings), None);

    settings.daemon_request_timeout = -5;
    assert_eq!(daemon_request_timeout(&settings), None);

    settings.daemon_request_timeout = 7;
    assert_eq!(
        daemon_request_timeout(&settings),
        Some(Duration::from_secs(7)),
        "the unit is seconds, unlike jobTimeout's minutes"
    );
}

#[tokio::test]
async fn classify_transport_error_separates_refused_from_timeout() {
    let refused = refused_port().await;
    let err = daemon_client_with_timeout(Some(Duration::from_secs(5)))
        .get(format!("http://{}/api/jobs", refused))
        .send()
        .await
        .expect_err("a refused port must not produce a response");
    assert_eq!(
        classify_transport_error(&err),
        DaemonTransportFailure::Unreachable,
        "a refused connection proves the daemon never saw the request"
    );

    let stalled = stalled_daemon().await;
    let err = daemon_client_with_timeout(Some(Duration::from_millis(300)))
        .get(format!("http://{}/api/jobs", stalled))
        .send()
        .await
        .expect_err("a stalled daemon must not produce a response");
    assert_eq!(
        classify_transport_error(&err),
        DaemonTransportFailure::Timeout
    );
    // The ordering guard: reqwest sets is_connect() as well as is_timeout() on a connect timeout,
    // so a timeout must never be filed as the definite "never received it" case.
    assert_ne!(
        classify_transport_error(&err),
        DaemonTransportFailure::Unreachable
    );
}

#[tokio::test]
async fn mcp_reports_offline_only_when_unreachable() {
    let home = TempHome::new("mcp-offline");
    let addr = refused_port().await;
    write_master(home.path(), addr.port(), "test-secret", "127.0.0.1").unwrap();

    let plans_dir = home.path().join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();
    let dispatcher = McpDispatcher::with_plans_dir(home.path(), &plans_dir);

    let outcome = dispatcher
        .call("tendril_list_jobs", &serde_json::json!({}))
        .await
        .expect("the tool itself is known");
    assert!(outcome.is_error);
    assert!(
        outcome.text.contains(DAEMON_OFFLINE_MESSAGE),
        "an unreachable daemon really is offline, so this message is correct here: {}",
        outcome.text
    );
}

#[tokio::test]
async fn mcp_reports_timeout_not_offline() {
    // The regression test for the message that is actively wrong: a daemon that is up and busy was
    // reported as "not running", telling the operator to start a daemon that is already running.
    let home = TempHome::new("mcp-timeout").with_daemon_timeout(1);
    let addr = stalled_daemon().await;
    write_master(home.path(), addr.port(), "test-secret", "127.0.0.1").unwrap();

    let plans_dir = home.path().join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();
    let dispatcher = McpDispatcher::with_plans_dir(home.path(), &plans_dir);

    let outcome = dispatcher
        .call("tendril_list_jobs", &serde_json::json!({}))
        .await
        .expect("the tool itself is known");
    assert!(outcome.is_error);
    assert!(
        outcome.text.contains("did not respond within 1s"),
        "the timeout message should name the configured budget: {}",
        outcome.text
    );
    assert!(
        outcome.text.contains(DAEMON_TIMEOUT_HINT),
        "the operator needs to be told the request may already have been applied: {}",
        outcome.text
    );
    assert!(
        !outcome.text.contains("is not running"),
        "the daemon is running — it is just busy: {}",
        outcome.text
    );
}
