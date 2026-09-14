//! When the CLI is allowed to apply a mutation locally after the daemon call fails.
//!
//! The local fallback exists so `tendril project add` still works with no daemon running. It is only
//! safe when the connection never established: a mutation that timed out may already have been
//! applied by the daemon, and applying it to `config.yaml` too would apply it twice — against a
//! daemon that holds the config in memory and rewrites it, silently losing whichever write lands
//! second.

use axum::routing::any;
use axum::{Json, Router};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tendril_cli::commands::project::{handle_project_command, ProjectCommands};
use tendril_cli::commands::verification::{handle_verification_command, VerificationCommands};
use tendril_core::config::{get_config_path, load_config, save_config, write_master};
use tendril_core::models::{ProjectConfig, VerificationConfig};

/// Longer than the 1s budget the fixtures configure, short enough to fail rather than hang.
const STALL: Duration = Duration::from_secs(20);

struct Fixture {
    tendril_home: PathBuf,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        assert!(
            self.tendril_home.starts_with(std::env::temp_dir()),
            "refusing to delete a fixture outside the temp dir: {}",
            self.tendril_home.display()
        );
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

fn temp_home(label: &str) -> PathBuf {
    let home = std::env::temp_dir().join(format!(
        "tendril-daemon-fallback-{}-{}",
        label,
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&home).unwrap();
    // A seeded config, so "the fallback wrote to it" and "the fallback did not" are both observable.
    let settings = tendril_core::config::TendrilSettings {
        daemon_request_timeout: 1,
        projects: vec![ProjectConfig {
            name: "Seeded".to_string(),
            color: "Blue".to_string(),
            ..Default::default()
        }],
        verifications: vec![VerificationConfig {
            name: "RustBuild".to_string(),
            prompt: "Original prompt".to_string(),
        }],
        ..Default::default()
    };
    save_config(&get_config_path(&home), &settings).unwrap();
    home
}

/// A daemon that accepts every request and answers none of them.
async fn stalled_daemon(label: &str) -> Fixture {
    let tendril_home = temp_home(label);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    write_master(&tendril_home, port, "test-secret", "127.0.0.1", "http").unwrap();

    let app = Router::new().fallback(any(|| async {
        tokio::time::sleep(STALL).await;
        Json(serde_json::json!({ "ok": true }))
    }));

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    Fixture {
        tendril_home,
        shutdown_tx: Some(shutdown_tx),
    }
}

/// A daemon that answers every request with a 500 — reachable, and refusing the work.
async fn erroring_daemon(label: &str) -> Fixture {
    let tendril_home = temp_home(label);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    write_master(&tendril_home, port, "test-secret", "127.0.0.1", "http").unwrap();

    let app = Router::new().fallback(any(|| async {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "database is locked",
        )
    }));

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    Fixture {
        tendril_home,
        shutdown_tx: Some(shutdown_tx),
    }
}

/// A `.master` file pointing at a port nothing is listening on.
fn home_with_dead_master(label: &str) -> PathBuf {
    let tendril_home = temp_home(label);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    write_master(&tendril_home, port, "test-secret", "127.0.0.1", "http").unwrap();
    tendril_home
}

fn config_bytes(tendril_home: &Path) -> Vec<u8> {
    std::fs::read(get_config_path(tendril_home)).unwrap()
}

#[tokio::test]
async fn refused_daemon_falls_back_to_local_config() {
    // The behaviour the fallback exists for: a stale `.master` file must not stop the CLI working.
    let tendril_home = home_with_dead_master("refused");

    handle_project_command(
        ProjectCommands::Add {
            name: "FallbackProj".to_string(),
        },
        &tendril_home,
    )
    .await
    .expect("an offline daemon should fall back to the filesystem");

    let cfg = load_config(&get_config_path(&tendril_home)).unwrap();
    assert!(
        cfg.projects.iter().any(|p| p.name == "FallbackProj"),
        "the project should have been written locally"
    );

    let _ = std::fs::remove_dir_all(&tendril_home);
}

#[tokio::test]
async fn timed_out_mutation_does_not_fall_back() {
    // The daemon took the mutation and may well have applied it. Writing it locally as well is how
    // one `project add` becomes two conflicting writers of the same file.
    let fixture = stalled_daemon("timeout-mutation").await;
    let before = config_bytes(&fixture.tendril_home);

    let err = handle_project_command(
        ProjectCommands::Add {
            name: "DoubleApplied".to_string(),
        },
        &fixture.tendril_home,
    )
    .await
    .expect_err("a timed-out mutation must be reported, not silently retried locally");

    let message = err.to_string();
    assert!(
        message.contains("did not respond within 1s"),
        "the error should say the daemon did not answer: {}",
        message
    );
    assert!(
        message.contains("may already"),
        "the operator must be warned the mutation may have landed: {}",
        message
    );

    assert_eq!(
        before,
        config_bytes(&fixture.tendril_home),
        "config.yaml must be byte-identical: the fallback must not have run"
    );
}

#[tokio::test]
async fn timed_out_project_set_does_not_fall_back() {
    // `project set` is the `PUT /api/projects/:name` arm — an in-place edit rather than an insert, so
    // a double apply here overwrites whatever the daemon wrote instead of merely duplicating it.
    let fixture = stalled_daemon("timeout-project-set").await;
    let before = config_bytes(&fixture.tendril_home);

    let err = handle_project_command(
        ProjectCommands::Set {
            name: "Seeded".to_string(),
            field: "color".to_string(),
            value: "Red".to_string(),
        },
        &fixture.tendril_home,
    )
    .await
    .expect_err("a timed-out mutation must be reported, not silently retried locally");

    assert!(
        err.to_string().contains("did not respond within 1s"),
        "the error should say the daemon did not answer: {}",
        err
    );
    assert_eq!(
        before,
        config_bytes(&fixture.tendril_home),
        "config.yaml must be byte-identical: the fallback must not have run"
    );

    let cfg = load_config(&get_config_path(&fixture.tendril_home)).unwrap();
    assert_eq!(
        cfg.projects[0].color, "Blue",
        "the local copy must be untouched"
    );
}

#[tokio::test]
async fn timed_out_verification_set_does_not_fall_back() {
    // The same rule in the other file that got the guard. `verification set` rewrites a shared
    // definition, so a double apply here silently reverts whatever the daemon wrote.
    let fixture = stalled_daemon("timeout-verification").await;
    let before = config_bytes(&fixture.tendril_home);

    let err = handle_verification_command(
        VerificationCommands::Set {
            name: "RustBuild".to_string(),
            new_name: None,
            prompt: Some("Rewritten prompt".to_string()),
        },
        &fixture.tendril_home,
    )
    .await
    .expect_err("a timed-out mutation must be reported, not silently retried locally");

    assert!(
        err.to_string().contains("did not respond within 1s"),
        "the error should say the daemon did not answer: {}",
        err
    );
    assert_eq!(
        before,
        config_bytes(&fixture.tendril_home),
        "config.yaml must be byte-identical: the fallback must not have run"
    );

    let cfg = load_config(&get_config_path(&fixture.tendril_home)).unwrap();
    assert_eq!(
        cfg.verifications[0].prompt, "Original prompt",
        "the local copy must be untouched"
    );
}

#[tokio::test]
async fn http_error_status_does_not_fall_back() {
    // A daemon that answered with a 500 was reached; its refusal is the answer, and quietly applying
    // the mutation locally instead would contradict it.
    let fixture = erroring_daemon("error-status").await;
    let before = config_bytes(&fixture.tendril_home);

    let result = handle_project_command(
        ProjectCommands::Add {
            name: "ShouldNotExist".to_string(),
        },
        &fixture.tendril_home,
    )
    .await;

    assert!(
        result.is_err(),
        "a 500 from the daemon must surface, not be papered over by the fallback"
    );
    assert_eq!(
        before,
        config_bytes(&fixture.tendril_home),
        "config.yaml must be byte-identical: the fallback must not have run"
    );
}
