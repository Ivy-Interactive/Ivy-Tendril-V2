//! `JobManager`'s lifecycle event channel: the thing whose absence left `job-event` never firing.
//!
//! Before this existed nothing in the manager published a job transition, so the WebSocket surface
//! carried no job events at all and the app could only poll. These tests drive a real job through a
//! script "agent" and assert on what a subscriber actually receives, including the wire names — the
//! desktop bridge routes by prefix, so the names are part of the contract, not a detail.

mod common;

use common::{plan_with, HomeFixture};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::agents::providers::AgentProcessSpec;
use tendril_core::config::TendrilSettings;
use tendril_core::jobs::manager::{
    JobEvent, JobManager, SpecBuilder, JOB_EVENT_COMPLETED, JOB_EVENT_FAILED,
    JOB_EVENT_STATUS_CHANGED,
};
use tendril_core::models::{ExecutePlanArgs, JobArgs, JobStatus, PlanStatus, VerificationStatus};
use tokio::sync::broadcast::error::RecvError;

fn settings() -> TendrilSettings {
    TendrilSettings {
        max_concurrent_jobs: 2,
        ..Default::default()
    }
}

#[cfg(unix)]
fn script_spec_builder(script: PathBuf, workdir: PathBuf) -> SpecBuilder {
    Arc::new(move |_provider, _config| AgentProcessSpec {
        command: "/bin/sh".to_string(),
        args: vec![script.to_string_lossy().to_string()],
        environment: Default::default(),
        working_directory: workdir.clone(),
        stdin_content: None,
        redirect_stdin: false,
        temp_files: vec![],
    })
}

/// Drains events until one of `types` arrives, returning everything seen including it.
async fn collect_until(
    rx: &mut tokio::sync::broadcast::Receiver<JobEvent>,
    types: &[&str],
    timeout: Duration,
) -> Vec<JobEvent> {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut seen = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        assert!(
            !remaining.is_zero(),
            "no {:?} event arrived; saw {:?}",
            types,
            seen.iter()
                .map(|e: &JobEvent| &e.event_type)
                .collect::<Vec<_>>()
        );
        match tokio::time::timeout(remaining, rx.recv()).await {
            Ok(Ok(evt)) => {
                let done = types.contains(&evt.event_type.as_str());
                seen.push(evt);
                if done {
                    return seen;
                }
            }
            // A lagged subscriber is not this test's subject; a closed channel means the manager went
            // away, which would be a bug in the fixture.
            Ok(Err(RecvError::Lagged(_))) => continue,
            Ok(Err(RecvError::Closed)) => panic!("the manager's event channel closed"),
            Err(_) => panic!(
                "no {:?} event arrived within the budget; saw {:?}",
                types,
                seen.iter()
                    .map(|e: &JobEvent| e.event_type.clone())
                    .collect::<Vec<_>>()
            ),
        }
    }
}

/// A successful run publishes the transition into `Running` and then the outcome.
#[cfg(unix)]
#[tokio::test]
async fn a_successful_run_publishes_status_changed_then_completed() {
    let home = HomeFixture::new("job-events-ok");
    home.write_promptware("ExecutePlan");

    let mut plan = plan_with(
        PlanStatus::Draft,
        &[
            ("Build", VerificationStatus::Pass),
            ("Test", VerificationStatus::Pass),
        ],
    );
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Events", &plan);

    let script = home.path.join("agent.sh");
    std::fs::write(&script, "echo working\nexit 0\n").expect("write script");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));
    // Subscribed before the job starts: a broadcast receiver only sees what is published after it.
    let mut rx = manager.subscribe_events();

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .expect("start_job");

    let events = collect_until(&mut rx, &[JOB_EVENT_COMPLETED], Duration::from_secs(20)).await;

    assert!(
        events.iter().all(|e| e.job_id == job_id),
        "every event must name the job it is about"
    );

    // The dispatch path's announcement: a job that started is news even with no job view open.
    let running = events
        .iter()
        .find(|e| e.event_type == JOB_EVENT_STATUS_CHANGED && e.status == JobStatus::Running)
        .expect("the transition into Running must be published");
    assert_eq!(running.job_type, "ExecutePlan");
    assert_eq!(running.plan_folder.as_deref(), Some("00001-Events"));

    // And the outcome, which is what the Jobs area waits on.
    let completed = events
        .iter()
        .find(|e| e.event_type == JOB_EVENT_COMPLETED)
        .expect("a completion must be published");
    assert_eq!(completed.status, JobStatus::Completed);
    // The generic transition is published alongside the outcome, so a client that only listens for
    // one of the two is never left behind.
    assert!(
        events
            .iter()
            .any(|e| e.event_type == JOB_EVENT_STATUS_CHANGED && e.status == JobStatus::Completed),
        "a terminal status must publish the transition as well as the outcome"
    );
}

/// A failure publishes `job.failed`, whichever of the failure statuses it settled on.
#[cfg(unix)]
#[tokio::test]
async fn a_failing_run_publishes_job_failed() {
    let home = HomeFixture::new("job-events-fail");
    home.write_promptware("ExecutePlan");
    let plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    let folder = home.write_plan("00001-Failing", &plan);

    let script = home.path.join("agent.sh");
    std::fs::write(&script, "echo trying\nexit 3\n").expect("write script");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));
    let mut rx = manager.subscribe_events();

    manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .expect("start_job");

    let events = collect_until(&mut rx, &[JOB_EVENT_FAILED], Duration::from_secs(20)).await;
    let failed = events
        .iter()
        .find(|e| e.event_type == JOB_EVENT_FAILED)
        .expect("a failure must be published");
    assert!(
        matches!(
            failed.status,
            JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped
        ),
        "{:?}",
        failed.status
    );
    assert!(
        failed.status_message.is_some(),
        "a failure event carries the reason the Jobs list would show"
    );
}

/// A cancellation is a transition too, and it never goes through `finish_job`.
#[cfg(unix)]
#[tokio::test]
async fn cancelling_a_job_publishes_a_failure_event() {
    let home = HomeFixture::new("job-events-cancel");
    home.write_promptware("ExecutePlan");
    let plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    let folder = home.write_plan("00001-Cancel", &plan);

    let script = home.path.join("agent.sh");
    std::fs::write(&script, "echo working\nsleep 30\n").expect("write script");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));
    let mut rx = manager.subscribe_events();

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .expect("start_job");

    // Wait for the job to be running, so the cancellation has a process to stop.
    collect_until(
        &mut rx,
        &[JOB_EVENT_STATUS_CHANGED],
        Duration::from_secs(10),
    )
    .await;
    assert!(manager
        .cancel_job(&job_id, Some("Cancelled"))
        .await
        .unwrap());

    let events = collect_until(&mut rx, &[JOB_EVENT_FAILED], Duration::from_secs(20)).await;
    assert!(events
        .iter()
        .any(|e| e.event_type == JOB_EVENT_FAILED && e.status == JobStatus::Stopped));
}

/// The wire names are the contract with the desktop bridge, which routes by prefix.
///
/// `ws_bridge.rs::route_ws_message` sends `chat.`, `plan.`, `state` and `status` to their own
/// channels and *everything else* to `job-event`. A job event must therefore be `job.`-prefixed: not
/// to be routed — it would fall through either way — but so that it is routed on purpose, and so that
/// a future `plan.`-shaped name cannot quietly steal it.
#[test]
fn job_event_names_are_job_prefixed_and_serialise_camel_case() {
    for name in [
        JOB_EVENT_STATUS_CHANGED,
        JOB_EVENT_COMPLETED,
        JOB_EVENT_FAILED,
    ] {
        assert!(name.starts_with("job."), "{name} must be job.-prefixed");
        assert!(
            !name.starts_with("chat.") && !name.starts_with("plan."),
            "{name} must not land on another bridge channel"
        );
        assert!(
            name != "state" && name != "status",
            "{name} is claimed by plan-event"
        );
    }

    let mut job = tendril_core::models::JobItem::new(
        "00042".to_string(),
        "ExecutePlan".to_string(),
        "/tmp/Plans/00042-Thing".to_string(),
        "FixtureProject".to_string(),
    );
    job.status = JobStatus::Completed;
    job.status_message = Some("Done".to_string());
    let json = serde_json::to_value(JobEvent::status_changed(&job)).expect("serialise");
    assert_eq!(json["type"], JOB_EVENT_STATUS_CHANGED);
    assert_eq!(json["jobId"], "00042");
    assert_eq!(json["jobType"], "ExecutePlan");
    assert_eq!(json["status"], "Completed");
    assert_eq!(json["planFolder"], "00042-Thing");

    let terminal = JobEvent::terminal(&job).expect("a Completed job has an outcome event");
    assert_eq!(terminal.event_type, JOB_EVENT_COMPLETED);
    let mut running = job.clone();
    running.status = JobStatus::Running;
    assert!(
        JobEvent::terminal(&running).is_none(),
        "a live job has no outcome yet"
    );
}
