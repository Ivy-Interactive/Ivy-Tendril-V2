use axum::{routing::get, Json, Router};
use serde_json::json;
use std::fs::File;
use std::io::Write;
use std::time::{Duration, Instant};
use tempfile::tempdir;

use tendril_app_lib::service::supervisor::{
    calculate_backoff_secs, redact_sensitive_tokens, CircuitBreaker, MasterReclaim,
    ServiceOwnership, ServiceSupervisor, SupervisorStatus,
};

/// Stands up a daemon-shaped server that answers `/api/health` and `/api/ping`, and writes a
/// `.master` naming this (very much alive) process. This is what a healthy daemon looks like to the
/// supervisor.
async fn healthy_daemon_fixture(tendril_home: &std::path::Path) -> u16 {
    let app = Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({"apiVersion": 1, "capabilities": ["plans", "jobs"]})) }),
        )
        .route("/api/ping", get(|| async { "pong" }));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let port = listener.local_addr().expect("port").port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    write_master(tendril_home, port, std::process::id());
    port
}

fn write_master(tendril_home: &std::path::Path, port: u16, pid: u32) {
    let content = json!({
        "port": port,
        "pid": pid,
        "secret": "test-secret-token",
        "startedAt": "2026-09-06T12:00:00Z",
        "host": "127.0.0.1",
        "scheme": "http",
        "version": "0.1.0",
        "apiVersion": 1,
        "capabilities": ["plans", "jobs"]
    });
    std::fs::write(tendril_home.join(".master"), content.to_string()).expect("write master");
}

/// Issue #129: "Repair service" deleted `.master` with no liveness check at all, which unregisters a
/// running daemon permanently — `is_master()` reads false for the rest of its life, so its
/// master-only sweeps stop, every client reports "not running", and a second daemon can claim the
/// home.
#[tokio::test]
async fn repair_refuses_to_unregister_a_live_answering_daemon() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();
    let port = healthy_daemon_fixture(&tendril_home).await;

    let supervisor = ServiceSupervisor::new(tendril_home.clone(), None);
    let outcome = supervisor.repair_master().await.expect("repair");

    assert_eq!(
        outcome,
        MasterReclaim::RefusedLive {
            pid: std::process::id(),
            port
        }
    );
    assert!(
        tendril_home.join(".master").exists(),
        "a live daemon's registration must survive Repair"
    );
}

/// The same for the synchronous path, which `start_managed_service` uses: a second daemon must not be
/// launched over a live one's claim, and must certainly not delete it first.
#[tokio::test]
async fn starting_a_managed_daemon_will_not_clear_a_live_claim() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();
    let _port = healthy_daemon_fixture(&tendril_home).await;

    let mock_bin = temp.path().join("mock_daemon.sh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut f = File::create(&mock_bin).expect("create mock daemon");
        writeln!(f, "#!/bin/sh\nsleep 5").expect("write script");
        let mut perms = f.metadata().expect("meta").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&mock_bin, perms).expect("chmod");
    }

    let mut supervisor = ServiceSupervisor::new(tendril_home.clone(), Some(mock_bin.clone()));
    let err = supervisor
        .start_managed_service(&mock_bin, &[])
        .expect_err("must refuse to start over a live claim");
    assert!(err.contains("claimed by a running daemon"), "got: {err}");
    assert!(tendril_home.join(".master").exists());
    assert!(
        !tendril_home.join(".managed_service.lock").exists(),
        "nothing was started, so nothing may be locked"
    );
}

/// A pid that is alive but not answering is the wedged claim an operator has no other way out of —
/// the only alternative today is the undocumented `TENDRIL_ALLOW_MASTER_TAKEOVER=1`. Repair is
/// allowed to clear that one.
#[tokio::test]
async fn repair_clears_a_wedged_claim_whose_daemon_does_not_answer() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();

    // A port nothing is listening on, recorded against this live pid.
    let dead_port = {
        let probe = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        probe.local_addr().expect("addr").port()
    };
    write_master(&tendril_home, dead_port, std::process::id());

    let supervisor = ServiceSupervisor::new(tendril_home.clone(), None);
    let outcome = supervisor.repair_master().await.expect("repair");

    assert_eq!(
        outcome,
        MasterReclaim::Removed {
            pid: Some(std::process::id())
        }
    );
    assert!(!tendril_home.join(".master").exists());
}

#[tokio::test]
async fn repair_reports_when_there_was_nothing_to_clean_up() {
    let temp = tempdir().expect("tempdir");
    let supervisor = ServiceSupervisor::new(temp.path().to_path_buf(), None);
    assert_eq!(
        supervisor.repair_master().await.expect("repair"),
        MasterReclaim::NoClaim
    );
}

#[tokio::test]
async fn test_adoption_of_mock_external_daemon() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();

    let app = Router::new()
        .route(
            "/api/health",
            get(|| async {
                Json(json!({
                    "apiVersion": 1,
                    "capabilities": ["plans", "jobs"]
                }))
            }),
        )
        .route("/api/ping", get(|| async { "pong" }));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind listener");
    let port = listener.local_addr().expect("port").port();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let current_pid = std::process::id();
    let master_content = json!({
        "port": port,
        "pid": current_pid,
        "secret": "test-secret-token",
        "startedAt": "2026-09-06T12:00:00Z",
        "host": "127.0.0.1",
        "scheme": "http",
        "version": "0.1.0",
        "apiVersion": 1,
        "capabilities": ["plans", "jobs"]
    });
    std::fs::write(tendril_home.join(".master"), master_content.to_string()).expect("write master");

    let mut supervisor = ServiceSupervisor::new(tendril_home.clone(), None);

    let res = supervisor.discover_and_adopt().await.expect("adopt");
    assert!(res.is_some(), "Should adopt running daemon");
    let info = res.unwrap();
    assert_eq!(info.status, SupervisorStatus::Connected);
    assert_eq!(info.ownership, Some(ServiceOwnership::AdoptedExternal));
    assert_eq!(info.port, Some(port));
    assert_eq!(info.pid, Some(current_pid));

    assert!(supervisor.stop_managed_service().is_ok());
    assert!(tendril_home.join(".master").exists());
}

#[test]
fn test_detection_and_atomic_cleanup_of_stale_master() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();
    let master_file = tendril_home.join(".master");

    let stale_content = json!({
        "port": 58999,
        "pid": 9999999,
        "secret": "stale-secret",
        "startedAt": "2026-01-01T00:00:00Z"
    });
    std::fs::write(&master_file, stale_content.to_string()).expect("write stale master");
    assert!(master_file.exists());

    let supervisor = ServiceSupervisor::new(tendril_home.clone(), None);
    let outcome = supervisor.remove_master_if_stale().expect("cleanup");
    assert_eq!(outcome, MasterReclaim::Removed { pid: Some(9999999) });
    assert!(outcome.removed());
    assert!(!master_file.exists());
}

#[test]
fn test_clean_startup_of_mock_managed_daemon() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();

    let mock_bin = temp.path().join("mock_daemon.sh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut f = File::create(&mock_bin).expect("create mock daemon");
        writeln!(f, "#!/bin/sh\nsleep 5").expect("write script");
        let mut perms = f.metadata().expect("meta").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&mock_bin, perms).expect("chmod");
    }

    let mut supervisor = ServiceSupervisor::new(tendril_home.clone(), Some(mock_bin.clone()));
    let start_res = supervisor
        .start_managed_service(&mock_bin, &[])
        .expect("start managed");

    assert_eq!(start_res.status, SupervisorStatus::Starting);
    assert_eq!(start_res.ownership, Some(ServiceOwnership::Managed));
    assert!(start_res.pid.is_some());

    let lock_file = tendril_home.join(".managed_service.lock");
    assert!(lock_file.exists());

    let log_file = tendril_home.join("Logs").join("service.log");
    assert!(log_file.exists());

    supervisor.stop_managed_service().expect("stop managed");
    assert!(!lock_file.exists());
}

#[test]
fn test_crash_loop_detection_and_circuit_breaker() {
    let mut breaker = CircuitBreaker::new(5, Duration::from_secs(60));
    let now = Instant::now();

    for _ in 0..5 {
        assert!(!breaker.record_crash(now));
        assert!(!breaker.is_tripped());
    }

    assert!(breaker.record_crash(now));
    assert!(breaker.is_tripped());

    assert_eq!(calculate_backoff_secs(0), 0);
    assert_eq!(calculate_backoff_secs(1), 1);
    assert_eq!(calculate_backoff_secs(2), 2);
    assert_eq!(calculate_backoff_secs(3), 4);
    assert_eq!(calculate_backoff_secs(4), 8);
    assert_eq!(calculate_backoff_secs(5), 16);
    assert_eq!(calculate_backoff_secs(6), 30);
    assert_eq!(calculate_backoff_secs(10), 30);
}

#[test]
fn test_sensitive_token_redaction() {
    let log1 = "2026-09-06T12:00:00Z [INFO] Incoming request Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz finished";
    let redacted1 = redact_sensitive_tokens(log1);
    assert!(!redacted1.contains("eyJhbGciOiJIUzI1NiJ9.abc.xyz"));
    assert!(redacted1.contains("Bearer [REDACTED_BEARER_TOKEN]"));

    let log2 = r#"{"level":"info","secret":"my_super_secret_master_token","message":"ready"}"#;
    let redacted2 = redact_sensitive_tokens(log2);
    assert!(!redacted2.contains("my_super_secret_master_token"));
    assert!(redacted2.contains("[REDACTED_SECRET]"));
}

/// The other half of issue #129, and the one the V1 CLI actually tripped: a `.master` the app *cannot
/// read* used to be deleted, on the reasoning that it names no pid and so blocks every client for
/// nothing. It names no pid we recognise — which is not the same as naming nobody. V1's
/// `MasterLock.ReadLiveMaster` deleted a live V2 claim on exactly that reasoning and took the daemon
/// off the air, so the app now leaves it standing and says so.
#[tokio::test]
async fn repair_leaves_a_registration_it_cannot_read_standing() {
    for (label, content, schema_version) in [
        // A newer daemon's claim: readable JSON, self-declared schema this build does not know.
        (
            "a newer schema",
            json!({ "port": 5010, "pid": 1, "secret": "s", "version": "9.9.9", "schemaVersion": 99 })
                .to_string(),
            Some(99),
        ),
        // Structured, and nothing this build can make a claim out of.
        ("an unknown shape", json!({ "hello": "world" }).to_string(), None),
    ] {
        let temp = tempdir().expect("tempdir");
        let tendril_home = temp.path().to_path_buf();
        std::fs::write(tendril_home.join(".master"), &content).expect("write master");

        let supervisor = ServiceSupervisor::new(tendril_home.clone(), None);
        assert_eq!(
            supervisor.repair_master().await.expect("repair"),
            MasterReclaim::RefusedUnreadable { schema_version },
            "{label}"
        );
        assert_eq!(
            supervisor.remove_master_if_stale().expect("sync path"),
            MasterReclaim::RefusedUnreadable { schema_version },
            "{label}: the synchronous path must agree"
        );
        assert_eq!(
            std::fs::read_to_string(tendril_home.join(".master")).expect("still there"),
            content,
            "{label}: the file must be untouched, not merely present"
        );
    }
}

/// The recovery that must keep working: a file that is not a JSON document at all is a truncated or
/// half-finished write. It carries no information about anybody, and it blocks every future claim, so
/// it is still cleared — otherwise a crashed daemon would leave a home no daemon could ever claim.
#[tokio::test]
async fn repair_still_clears_a_truncated_registration() {
    for (label, content) in [
        ("empty", ""),
        ("truncated", "{\"port\": 50"),
        ("not json", "nope"),
    ] {
        let temp = tempdir().expect("tempdir");
        let tendril_home = temp.path().to_path_buf();
        std::fs::write(tendril_home.join(".master"), content).expect("write master");

        let supervisor = ServiceSupervisor::new(tendril_home.clone(), None);
        assert_eq!(
            supervisor.repair_master().await.expect("repair"),
            MasterReclaim::Removed { pid: None },
            "{label}"
        );
        assert!(!tendril_home.join(".master").exists(), "{label}");
    }
}

/// And the app refuses to spawn over a registration it cannot read, rather than launching a daemon
/// whose own `MasterGuard::acquire` will refuse the same file into a log nobody opens.
#[tokio::test]
async fn starting_a_managed_daemon_refuses_a_registration_it_cannot_read() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();
    let content = json!({ "port": 5010, "pid": 1, "schemaVersion": 99 }).to_string();
    std::fs::write(tendril_home.join(".master"), &content).expect("write master");

    let mock_bin = temp.path().join("mock_daemon.sh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut f = File::create(&mock_bin).expect("create mock daemon");
        writeln!(f, "#!/bin/sh\nsleep 5").expect("write script");
        let mut perms = f.metadata().expect("meta").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&mock_bin, perms).expect("chmod");
    }

    let mut supervisor = ServiceSupervisor::new(tendril_home.clone(), Some(mock_bin.clone()));
    let err = supervisor
        .start_managed_service(&mock_bin, &[])
        .expect_err("must refuse to start over a claim it cannot read");
    assert!(
        err.contains("not a registration this build can read"),
        "got: {err}"
    );
    assert!(err.contains("schemaVersion 99"), "got: {err}");
    assert_eq!(
        std::fs::read_to_string(tendril_home.join(".master")).expect("still there"),
        content
    );
    assert!(!tendril_home.join(".managed_service.lock").exists());
}

/// A claim naming a pid that has been recycled — alive, but a different process than the one that
/// wrote the claim — is still reclaimable, which is what `MasterClaim::owner_is_running` adds over a
/// bare `kill(pid, 0)`.
#[cfg(unix)]
#[tokio::test]
async fn repair_clears_a_claim_whose_pid_was_recycled() {
    let temp = tempdir().expect("tempdir");
    let tendril_home = temp.path().to_path_buf();

    // This very process, stamped with a start token that cannot be ours.
    let content = json!({
        "port": 5010,
        "pid": std::process::id(),
        "secret": "s",
        "startedAt": "2026-09-06T12:00:00Z",
        "host": "127.0.0.1",
        "scheme": "http",
        "version": "0.1.0",
        "apiVersion": 1,
        "capabilities": [],
        "schemaVersion": 2,
        "pidStartedAt": "Thu Jan  1 00:00:00 1970"
    })
    .to_string();
    std::fs::write(tendril_home.join(".master"), content).expect("write master");

    let supervisor = ServiceSupervisor::new(tendril_home.clone(), None);
    assert_eq!(
        supervisor.remove_master_if_stale().expect("reclaim"),
        MasterReclaim::Removed {
            pid: Some(std::process::id())
        }
    );
    assert!(!tendril_home.join(".master").exists());
}
