//! What `tendril job start` reports when the daemon's reply is lost.
//!
//! A timeout is not a failure: the daemon may already have created the job. Claiming "failed" makes
//! the operator retry and get two jobs, so the CLI reconciles against the daemon's own job list and
//! only ever reports ambiguity when it genuinely cannot tell.
//!
//! The daemon here is a hand-rolled router rather than `tendril_server::create_router`, because the
//! point is a `POST /api/jobs` that never answers while `GET /api/jobs` still does — behaviour the
//! real router has no way to produce.

use axum::routing::get;
use axum::{Json, Router};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tendril_cli::commands::job::{start_job_via_daemon, JobStartArgs, StartOutcome};
use tendril_core::config::{get_config_path, read_master, write_master, MasterInfo};
use tendril_core::http::daemon_client;

/// How long the stalled `POST /api/jobs` holds the connection. Comfortably past the 1s timeout the
/// fixtures configure, but short enough that a broken timeout fails the test rather than hanging it.
const POST_STALL: Duration = Duration::from_secs(20);

struct Fixture {
    tendril_home: PathBuf,
    plan_folder: PathBuf,
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

impl Fixture {
    fn master(&self) -> MasterInfo {
        read_master(&self.tendril_home).expect("the fixture wrote a .master file")
    }

    /// An `ExecutePlan` submission naming the fixture's plan by absolute path.
    ///
    /// The path form matters: `resolve_plan_folder` short-circuits on an existing absolute path, so
    /// the test never depends on the ambient `TENDRIL_PLANS`.
    fn execute_plan_args(&self) -> JobStartArgs {
        job_start_args("ExecutePlan", self.plan_folder.to_string_lossy().as_ref())
    }
}

fn job_start_args(job_type: &str, plan_id: &str) -> JobStartArgs {
    JobStartArgs {
        job_type: job_type.to_string(),
        plan_id: Some(plan_id.to_string()),
        description: None,
        project: None,
        priority: None,
        wait_for: Vec::new(),
        force: false,
        source_path: None,
        change_request: None,
        note: None,
        instructions: None,
        repo: None,
        assignee: None,
        reviewer: Vec::new(),
        comment: None,
        labels: None,
        no_merge: false,
        no_delete_branch: false,
        no_artifacts: false,
        draft: false,
        repo_path: None,
        base_branch: None,
        untracked_policy: None,
        // Unkeyed, which is the case reconciliation exists for: with no `--idempotency-key` the
        // helper still mints one per submission, so the POST it makes is safe to replay, but the
        // caller has no key to retry with — hence the job-list scan.
        idempotency_key: None,
    }
}

fn temp_home(label: &str) -> PathBuf {
    let home = std::env::temp_dir().join(format!(
        "tendril-start-reconcile-{}-{}",
        label,
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&home).unwrap();
    // A 1s budget so the stalled POST fails fast; the reconciliation GET is capped at the same
    // value, and the fixture answers it immediately.
    std::fs::write(get_config_path(&home), "daemonRequestTimeout: 1\n").unwrap();
    home
}

/// Creates the plan folder an `ExecutePlan` submission needs to resolve.
fn write_plan_folder(tendril_home: &Path) -> PathBuf {
    let folder = tendril_home.join("Plans").join("09990-ReconcileFixture");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(
        folder.join("plan.yaml"),
        "id: \"09990\"\ntitle: Reconcile Fixture\nstate: Approved\n",
    )
    .unwrap();
    folder
}

/// A daemon whose job-start endpoint never answers, and whose job list returns whatever
/// `job_list` builds from the fixture's plan folder — the folder path is only known once the
/// temp home exists, which is why this takes a closure rather than a value.
async fn stalled_start_daemon(
    label: &str,
    job_list: impl FnOnce(&Path) -> serde_json::Value,
) -> Fixture {
    let tendril_home = temp_home(label);
    let plan_folder = write_plan_folder(&tendril_home);
    let jobs = Arc::new(job_list(&plan_folder));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    write_master(&tendril_home, port, "test-secret", "127.0.0.1", "http").unwrap();

    let app = Router::new().route(
        "/api/jobs",
        get(move || {
            let jobs = Arc::clone(&jobs);
            async move { Json((*jobs).clone()) }
        })
        .post(|| async {
            // Accepted, being worked on, and never answered — the case the CLI must not call a
            // failure. Sleeping rather than dropping keeps the connection open, so the client's own
            // timeout is what fires.
            tokio::time::sleep(POST_STALL).await;
            Json(serde_json::json!({ "jobId": "should-never-be-read" }))
        }),
    );

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
        plan_folder,
        shutdown_tx: Some(shutdown_tx),
    }
}

/// One entry shaped like the daemon's `JobItem`, as the reconciler deserializes it.
fn job_list_entry(id: &str, job_type: &str, plan_file: &str, status: &str) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "type": job_type,
        "planFile": plan_file,
        "project": "Ivy-Interactive",
        "status": status,
        "provider": "claude",
    })
}

#[tokio::test]
async fn lost_confirmation_reconciles_to_the_real_job_id() {
    // The daemon did create the job; only the reply was lost. The id must come from the daemon's own
    // list, never be invented.
    let fixture = stalled_start_daemon("reconciled", |plan_folder| {
        serde_json::json!([
            job_list_entry("04101", "CreatePlan", "", "Completed"),
            job_list_entry(
                "04102",
                "ExecutePlan",
                plan_folder.to_string_lossy().as_ref(),
                "Queued"
            ),
        ])
    })
    .await;
    let master = fixture.master();
    let client = daemon_client(&fixture.tendril_home);

    let outcome = start_job_via_daemon(
        &fixture.tendril_home,
        &master,
        &client,
        fixture.execute_plan_args(),
    )
    .await
    .expect("a job that exists is not an error");

    assert_eq!(
        outcome,
        StartOutcome::Reconciled("04102".to_string()),
        "the lost confirmation should have been recovered from the job list"
    );
    let rendered = outcome.render();
    assert!(rendered.contains("04102"), "{}", rendered);
    assert!(
        rendered.contains("confirmation was lost"),
        "the operator should know the id was recovered rather than confirmed: {}",
        rendered
    );
}

#[tokio::test]
async fn unreconcilable_start_reports_ambiguity_not_failure() {
    // The daemon answers the job-list query and the job is not there — yet "not in the list" is not
    // proof it was never created, so this is ambiguity, not failure.
    let fixture = stalled_start_daemon("unreconcilable", |_| serde_json::json!([])).await;
    let master = fixture.master();
    let client = daemon_client(&fixture.tendril_home);

    let outcome = start_job_via_daemon(
        &fixture.tendril_home,
        &master,
        &client,
        fixture.execute_plan_args(),
    )
    .await
    .expect("an unanswered start is not an error");

    match &outcome {
        StartOutcome::Unconfirmed(reason) => assert!(
            reason.contains("no reply within 1s"),
            "the reason should name the configured budget: {}",
            reason
        ),
        other => panic!("expected Unconfirmed, got {:?}", other),
    }

    let rendered = outcome.render();
    assert!(
        rendered.contains("may or may not have been created"),
        "the operator must not be told the job failed: {}",
        rendered
    );
    assert!(
        rendered.contains("tendril job list"),
        "the operator needs to be told how to check: {}",
        rendered
    );
    assert!(
        !rendered.contains("should-never-be-read"),
        "no job id may be printed that was not read back from the daemon: {}",
        rendered
    );
}

#[tokio::test]
async fn reconcile_ignores_a_job_for_a_different_plan() {
    // Guards against the reconciler simply taking the newest job: a concurrent, unrelated job must
    // not be reported as this submission's id.
    let fixture = stalled_start_daemon("wrong-plan", |_| {
        serde_json::json!([
            job_list_entry("04201", "ExecutePlan", "/tmp/some-other-plan", "Running"),
            job_list_entry("04202", "CreatePlan", "", "Queued"),
        ])
    })
    .await;
    let master = fixture.master();
    let client = daemon_client(&fixture.tendril_home);

    let outcome = start_job_via_daemon(
        &fixture.tendril_home,
        &master,
        &client,
        fixture.execute_plan_args(),
    )
    .await
    .expect("an unanswered start is not an error");

    assert!(
        matches!(outcome, StartOutcome::Unconfirmed(_)),
        "another plan's job is not this submission: {:?}",
        outcome
    );
}

#[tokio::test]
async fn unreachable_daemon_still_reports_plain_failure() {
    // The unambiguous case must keep its unambiguous message: a refused connection proves the daemon
    // never saw the request, so this really is a failure and reconciliation is pointless.
    let tendril_home = temp_home("unreachable");
    let plan_folder = write_plan_folder(&tendril_home);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    write_master(&tendril_home, port, "test-secret", "127.0.0.1", "http").unwrap();

    let master = read_master(&tendril_home).unwrap();
    let client = daemon_client(&tendril_home);
    let args = job_start_args("ExecutePlan", plan_folder.to_string_lossy().as_ref());

    let err = start_job_via_daemon(&tendril_home, &master, &client, args)
        .await
        .expect_err("a refused daemon is a real failure");
    let message = err.to_string();
    assert!(
        message.contains("Could not reach the Tendril daemon"),
        "an offline daemon must not be reported as ambiguous: {}",
        message
    );

    let _ = std::fs::remove_dir_all(&tendril_home);
}
