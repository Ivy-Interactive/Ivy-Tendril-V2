mod common;

use common::{plan_state, plan_with, HomeFixture};
use std::path::Path;
use tendril_core::config::{get_database_path, TendrilSettings};
use tendril_core::db::jobs::{get_job, insert_job};
use tendril_core::db::open_database;
use tendril_core::error::Result;
use tendril_core::jobs::recovery::{reconcile_jobs_with, ReconcileReport, RESTART_MESSAGE};
use tendril_core::models::{
    ExecutePlanArgs, JobArgs, JobItem, JobStatus, PlanStatus, VerificationStatus,
};

/// No test may reach GitHub; nothing here records a PR, so the resolver must never be consulted.
fn never_called_resolver(url: &str) -> Result<String> {
    panic!("PR state resolver must not be called, but was asked about {url}");
}

/// Writes a job row straight into the fixture's SQLite, as an interrupted daemon would have left it.
fn seed_job(
    home: &HomeFixture,
    id: &str,
    job_type: &str,
    plan_folder: &Path,
    status: JobStatus,
    process_id: Option<u32>,
    previous_plan_state: Option<&str>,
) -> JobItem {
    let args = JobArgs::ExecutePlan(ExecutePlanArgs {
        folder_path: plan_folder.to_string_lossy().to_string(),
        note: None,
    });

    let mut job = JobItem::new(
        id.to_string(),
        job_type.to_string(),
        plan_folder.to_string_lossy().to_string(),
        "FixtureProject".to_string(),
    );
    job.status = status;
    job.process_id = process_id;
    job.previous_plan_state = previous_plan_state.map(str::to_string);
    job.started_at = Some(chrono::Utc::now());
    job.typed_args = Some(args.clone());
    job.args = serde_json::to_string(&args).ok();

    let conn = open_database(&get_database_path(&home.path)).expect("open fixture db");
    insert_job(&conn, &job).expect("seed job row");
    job
}

fn reload(home: &HomeFixture, id: &str) -> JobItem {
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture db");
    get_job(&conn, id).expect("read job").expect("job row")
}

async fn reconcile(home: &HomeFixture) -> ReconcileReport {
    reconcile_jobs_with(
        &home.path,
        &home.plans_dir(),
        &TendrilSettings::default(),
        &never_called_resolver,
    )
    .await
    .expect("reconciliation should not error")
}

/// A dead PID with unfinished verification work is an interrupted job.
#[tokio::test]
async fn an_interrupted_job_with_a_pending_verification_fails_and_reverts_its_plan() {
    let home = HomeFixture::new("rec-interrupted");
    let folder = home.write_plan(
        "00001-Interrupted",
        &plan_with(
            PlanStatus::Executing,
            &[("Build", VerificationStatus::Pending)],
        ),
    );
    // PID 0 is never a live user process, so this row reads as dead whatever else is running.
    seed_job(
        &home,
        "00001",
        "ExecutePlan",
        &folder,
        JobStatus::Running,
        Some(0),
        Some("Draft"),
    );

    let report = reconcile(&home).await;
    assert_eq!(report.failed_jobs, vec!["00001".to_string()]);
    assert!(report.completed_jobs.is_empty());

    let job = reload(&home, "00001");
    assert_eq!(job.status, JobStatus::Failed);
    assert_eq!(job.status_message.as_deref(), Some(RESTART_MESSAGE));
    assert!(job.completed_at.is_some());
    assert_eq!(plan_state(&folder), "Draft");
}

/// Work that was already finished when the daemon died must not be thrown away.
#[tokio::test]
async fn an_interrupted_job_whose_work_was_complete_is_completed_and_moves_to_review() {
    let home = HomeFixture::new("rec-complete");
    let folder = home.write_plan(
        "00001-Complete",
        &plan_with(
            PlanStatus::Executing,
            &[
                ("Build", VerificationStatus::Pass),
                ("Test", VerificationStatus::Pass),
            ],
        ),
    );
    seed_job(
        &home,
        "00001",
        "ExecutePlan",
        &folder,
        JobStatus::Running,
        Some(0),
        Some("Draft"),
    );

    let report = reconcile(&home).await;
    assert_eq!(report.completed_jobs, vec!["00001".to_string()]);
    assert!(report.failed_jobs.is_empty());

    let job = reload(&home, "00001");
    assert_eq!(job.status, JobStatus::Completed);
    assert!(
        job.status_message
            .as_deref()
            .unwrap()
            .contains(RESTART_MESSAGE),
        "{:?}",
        job.status_message
    );
    assert_eq!(plan_state(&folder), "Review");
}

/// A `PreExecution` rejection outranks all-passing rows, exactly as on the live completion path.
#[tokio::test]
async fn an_interrupted_job_rejected_before_execution_still_fails() {
    let home = HomeFixture::new("rec-preexec");
    let folder = home.write_plan(
        "00001-PreExecFail",
        &plan_with(
            PlanStatus::Executing,
            &[("Build", VerificationStatus::Pass)],
        ),
    );
    common::write_verification_report(
        &folder,
        "PreExecution",
        "---\nresult: Fail\n---\n\nThe plan no longer matches the repo.\n",
    );
    seed_job(
        &home,
        "00001",
        "ExecutePlan",
        &folder,
        JobStatus::Running,
        Some(0),
        Some("Draft"),
    );

    let report = reconcile(&home).await;
    assert_eq!(report.failed_jobs, vec!["00001".to_string()]);
    assert_eq!(reload(&home, "00001").status, JobStatus::Failed);
    assert_eq!(plan_state(&folder), "Draft");
}

/// An interrupted `CreatePlan` has produced no revision, so all-passing rows say nothing about it.
#[tokio::test]
async fn a_non_execution_job_is_never_completed_by_reconciliation() {
    let home = HomeFixture::new("rec-createplan");
    let folder = home.write_plan(
        "00001-Creating",
        &plan_with(PlanStatus::Creating, &[("Build", VerificationStatus::Pass)]),
    );
    seed_job(
        &home,
        "00001",
        "CreatePlan",
        &folder,
        JobStatus::Running,
        Some(0),
        Some("Draft"),
    );

    let report = reconcile(&home).await;
    assert_eq!(report.failed_jobs, vec!["00001".to_string()]);
    assert!(report.completed_jobs.is_empty());
    assert_eq!(reload(&home, "00001").status, JobStatus::Failed);
    assert_eq!(plan_state(&folder), "Draft");
}

/// A `RetryPlan` reverts to `Review`, not `Draft`, when no previous state was captured.
#[tokio::test]
async fn an_interrupted_retry_reverts_to_review_without_a_captured_state() {
    let home = HomeFixture::new("rec-retry");
    let folder = home.write_plan(
        "00001-Retry",
        &plan_with(
            PlanStatus::Executing,
            &[("Build", VerificationStatus::Pending)],
        ),
    );
    seed_job(
        &home,
        "00001",
        "RetryPlan",
        &folder,
        JobStatus::Running,
        Some(0),
        None,
    );

    reconcile(&home).await;
    assert_eq!(reload(&home, "00001").status, JobStatus::Failed);
    assert_eq!(plan_state(&folder), "Review");
}

/// A detached agent that survived the restart must be left strictly alone.
#[cfg(unix)]
#[tokio::test]
async fn a_job_whose_process_is_still_alive_is_left_untouched() {
    let home = HomeFixture::new("rec-alive");
    let folder = home.write_plan(
        "00001-Alive",
        &plan_with(
            PlanStatus::Executing,
            &[("Build", VerificationStatus::Pending)],
        ),
    );

    let mut child = tokio::process::Command::new("sleep")
        .arg("30")
        .spawn()
        .expect("spawn a live process to stand in for a detached agent");
    let live_pid = child.id().expect("child pid");

    seed_job(
        &home,
        "00001",
        "ExecutePlan",
        &folder,
        JobStatus::Running,
        Some(live_pid),
        Some("Draft"),
    );

    let report = reconcile(&home).await;
    assert_eq!(report.live_jobs, vec!["00001".to_string()]);
    assert!(report.failed_jobs.is_empty());
    assert!(
        report.reverted_plans.is_empty(),
        "a live job's plan must stay Executing: {:?}",
        report.reverted_plans
    );

    assert_eq!(reload(&home, "00001").status, JobStatus::Running);
    assert_eq!(plan_state(&folder), "Executing");
    assert!(
        tendril_core::config::is_process_running(live_pid),
        "reconciliation must not kill a surviving agent"
    );

    let _ = child.kill().await;
}

/// A job that never got a process is not an interrupted job.
#[tokio::test]
async fn a_queued_job_stays_queued() {
    let home = HomeFixture::new("rec-queued");
    let folder = home.write_plan("00001-Queued", &plan_with(PlanStatus::Executing, &[]));
    seed_job(
        &home,
        "00001",
        "ExecutePlan",
        &folder,
        JobStatus::Queued,
        None,
        Some("Draft"),
    );

    let report = reconcile(&home).await;
    assert_eq!(report.queued_jobs, vec!["00001".to_string()]);
    assert_eq!(reload(&home, "00001").status, JobStatus::Queued);
    assert_eq!(
        plan_state(&folder),
        "Executing",
        "a queued job still owns its plan's state"
    );
}

/// A plan left mid-flight with no job at all cannot be left stranded there.
#[tokio::test]
async fn a_plan_left_mid_flight_with_no_job_reverts_to_draft() {
    let home = HomeFixture::new("rec-orphan");
    let executing = home.write_plan("00001-Executing", &plan_with(PlanStatus::Executing, &[]));
    let creating = home.write_plan("00002-Creating", &plan_with(PlanStatus::Creating, &[]));
    let updating = home.write_plan("00003-Updating", &plan_with(PlanStatus::Updating, &[]));
    // States that are not mid-flight must be left exactly as they are.
    let review = home.write_plan("00004-Review", &plan_with(PlanStatus::Review, &[]));
    let completed = home.write_plan("00005-Completed", &plan_with(PlanStatus::Completed, &[]));
    let icebox = home.write_plan("00006-Icebox", &plan_with(PlanStatus::Icebox, &[]));

    let report = reconcile(&home).await;
    assert_eq!(
        report.reverted_plans,
        vec![
            "00001-Executing".to_string(),
            "00002-Creating".to_string(),
            "00003-Updating".to_string()
        ]
    );
    assert_eq!(plan_state(&executing), "Draft");
    assert_eq!(plan_state(&creating), "Draft");
    assert_eq!(plan_state(&updating), "Draft");
    assert_eq!(plan_state(&review), "Review");
    assert_eq!(plan_state(&completed), "Completed");
    assert_eq!(plan_state(&icebox), "Icebox");
}

/// Blocked plans get their dependency gate re-run, so a dependency that completed while the daemon
/// was down does not leave the plan stuck.
#[tokio::test]
async fn reconciliation_unblocks_plans_whose_dependencies_are_now_satisfied() {
    let home = HomeFixture::new("rec-unblock");
    home.write_plan("00002-Upstream", &plan_with(PlanStatus::Completed, &[]));

    let mut satisfied = plan_with(PlanStatus::Blocked, &[]);
    satisfied.depends_on = vec!["00002-Upstream".to_string()];
    let satisfied_folder = home.write_plan("00010-Satisfied", &satisfied);

    let mut unsatisfied = plan_with(PlanStatus::Blocked, &[]);
    unsatisfied.depends_on = vec!["00099-Missing".to_string()];
    let unsatisfied_folder = home.write_plan("00011-Unsatisfied", &unsatisfied);

    let report = reconcile(&home).await;
    assert_eq!(report.unblocked_plans, vec!["00010-Satisfied".to_string()]);
    assert_eq!(plan_state(&satisfied_folder), "Draft");
    assert_eq!(plan_state(&unsatisfied_folder), "Blocked");
}

/// Reconciliation must be safe to run repeatedly: a crash loop must not walk plans backwards.
#[tokio::test]
async fn running_reconciliation_twice_changes_nothing_the_second_time() {
    let home = HomeFixture::new("rec-idempotent");
    let interrupted = home.write_plan(
        "00001-Interrupted",
        &plan_with(
            PlanStatus::Executing,
            &[("Build", VerificationStatus::Pending)],
        ),
    );
    let finished = home.write_plan(
        "00002-Finished",
        &plan_with(
            PlanStatus::Executing,
            &[("Build", VerificationStatus::Pass)],
        ),
    );
    seed_job(
        &home,
        "00001",
        "ExecutePlan",
        &interrupted,
        JobStatus::Running,
        Some(0),
        Some("Draft"),
    );
    seed_job(
        &home,
        "00002",
        "ExecutePlan",
        &finished,
        JobStatus::Running,
        Some(0),
        Some("Draft"),
    );

    let first = reconcile(&home).await;
    assert_eq!(first.failed_jobs, vec!["00001".to_string()]);
    assert_eq!(first.completed_jobs, vec!["00002".to_string()]);
    let states_after_first = (plan_state(&interrupted), plan_state(&finished));
    assert_eq!(
        states_after_first,
        ("Draft".to_string(), "Review".to_string())
    );

    let second = reconcile(&home).await;
    assert!(second.failed_jobs.is_empty());
    assert!(second.completed_jobs.is_empty());
    assert!(second.live_jobs.is_empty());
    assert!(second.queued_jobs.is_empty());
    assert!(second.unblocked_plans.is_empty());
    assert!(
        second.reverted_plans.is_empty(),
        "a Review plan must not be dragged back to Draft: {:?}",
        second.reverted_plans
    );
    assert_eq!(
        (plan_state(&interrupted), plan_state(&finished)),
        states_after_first
    );
    assert_eq!(reload(&home, "00001").status, JobStatus::Failed);
    assert_eq!(reload(&home, "00002").status, JobStatus::Completed);
}

/// An empty home reconciles to an empty report rather than failing.
#[tokio::test]
async fn reconciling_a_fresh_home_is_a_no_op() {
    let home = HomeFixture::new("rec-empty");
    let report = reconcile(&home).await;
    assert!(report.live_jobs.is_empty());
    assert!(report.failed_jobs.is_empty());
    assert!(report.completed_jobs.is_empty());
    assert!(report.queued_jobs.is_empty());
    assert!(report.unblocked_plans.is_empty());
    assert!(report.reverted_plans.is_empty());
}

/// A job row whose plan folder was deleted must fail cleanly rather than panic.
#[tokio::test]
async fn an_interrupted_job_with_a_missing_plan_folder_fails_cleanly() {
    let home = HomeFixture::new("rec-missing-plan");
    let missing = home.plans_dir().join("00001-Deleted");
    seed_job(
        &home,
        "00001",
        "ExecutePlan",
        &missing,
        JobStatus::Running,
        Some(0),
        Some("Draft"),
    );

    let report = reconcile(&home).await;
    assert_eq!(report.failed_jobs, vec!["00001".to_string()]);
    assert_eq!(reload(&home, "00001").status, JobStatus::Failed);
}
