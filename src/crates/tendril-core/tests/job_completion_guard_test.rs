mod common;

use common::{plan_state, plan_with, HomeFixture};
use tendril_core::jobs::manager::{apply_plan_state, revert_plan_state};
use tendril_core::models::{JobItem, JobStatus, PlanStatus, VerificationStatus};

#[test]
fn test_revert_plan_state_ignores_completed_plan() {
    let home = HomeFixture::new("guard-completed");
    let folder = home.write_plan(
        "00001-CompletedPlan",
        &plan_with(
            PlanStatus::Completed,
            &[("Build", VerificationStatus::Pass)],
        ),
    );

    let mut job = JobItem::new(
        "00001".to_string(),
        "ExecutePlan".to_string(),
        folder.to_string_lossy().to_string(),
        "FixtureProject".to_string(),
    );
    job.status = JobStatus::Failed;
    job.previous_plan_state = Some("Draft".to_string());

    revert_plan_state(&job);

    assert_eq!(
        plan_state(&folder),
        "Completed",
        "revert_plan_state must not revert a Completed plan"
    );
}

#[test]
fn test_revert_plan_state_ignores_skipped_plan() {
    let home = HomeFixture::new("guard-skipped");
    let folder = home.write_plan("00002-SkippedPlan", &plan_with(PlanStatus::Skipped, &[]));

    let mut job = JobItem::new(
        "00002".to_string(),
        "ExecutePlan".to_string(),
        folder.to_string_lossy().to_string(),
        "FixtureProject".to_string(),
    );
    job.status = JobStatus::Failed;
    job.previous_plan_state = Some("Draft".to_string());

    revert_plan_state(&job);

    assert_eq!(
        plan_state(&folder),
        "Skipped",
        "revert_plan_state must not revert a Skipped plan"
    );
}

#[test]
fn test_revert_plan_state_protects_review_and_failed_plans() {
    let home = HomeFixture::new("guard-review-failed");

    // Case 1: Review plan must not be reverted to Draft
    let review_folder = home.write_plan(
        "00003-ReviewPlan",
        &plan_with(PlanStatus::Review, &[("Build", VerificationStatus::Pass)]),
    );

    let mut review_job = JobItem::new(
        "00003".to_string(),
        "ExecutePlan".to_string(),
        review_folder.to_string_lossy().to_string(),
        "FixtureProject".to_string(),
    );
    review_job.status = JobStatus::Failed;
    review_job.previous_plan_state = Some("Draft".to_string());

    revert_plan_state(&review_job);

    assert_eq!(
        plan_state(&review_folder),
        "Review",
        "revert_plan_state must not revert a Review plan to Draft"
    );

    // Case 2: Failed plan must not be reverted to Draft
    let failed_folder = home.write_plan(
        "00004-FailedPlan",
        &plan_with(PlanStatus::Failed, &[("Build", VerificationStatus::Fail)]),
    );

    let mut failed_job = JobItem::new(
        "00004".to_string(),
        "ExecutePlan".to_string(),
        failed_folder.to_string_lossy().to_string(),
        "FixtureProject".to_string(),
    );
    failed_job.status = JobStatus::Failed;
    failed_job.previous_plan_state = Some("Draft".to_string());

    revert_plan_state(&failed_job);

    assert_eq!(
        plan_state(&failed_folder),
        "Failed",
        "revert_plan_state must not revert a Failed plan to Draft"
    );
}

#[test]
fn test_apply_plan_state_terminal_immutability() {
    let home = HomeFixture::new("guard-apply-terminal");

    let completed_folder = home.write_plan(
        "00005-CompletedPlan",
        &plan_with(
            PlanStatus::Completed,
            &[("Build", VerificationStatus::Pass)],
        ),
    );

    // Attempt to transition Completed to Draft, Executing, Review, Failed
    apply_plan_state(&completed_folder, PlanStatus::Draft);
    assert_eq!(plan_state(&completed_folder), "Completed");

    apply_plan_state(&completed_folder, PlanStatus::Executing);
    assert_eq!(plan_state(&completed_folder), "Completed");

    apply_plan_state(&completed_folder, PlanStatus::Review);
    assert_eq!(plan_state(&completed_folder), "Completed");

    let skipped_folder = home.write_plan("00006-SkippedPlan", &plan_with(PlanStatus::Skipped, &[]));

    // Attempt to transition Skipped to Draft or Executing
    apply_plan_state(&skipped_folder, PlanStatus::Draft);
    assert_eq!(plan_state(&skipped_folder), "Skipped");

    apply_plan_state(&skipped_folder, PlanStatus::Executing);
    assert_eq!(plan_state(&skipped_folder), "Skipped");
}

#[cfg(unix)]
async fn wait_until<F>(timeout: std::time::Duration, mut predicate: F) -> bool
where
    F: FnMut() -> bool,
{
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if predicate() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}

#[cfg(unix)]
#[tokio::test]
async fn test_post_result_grace_period_completes_with_result_outcome() {
    use std::sync::Arc;
    use std::time::Duration;
    use tendril_core::agents::providers::AgentProcessSpec;
    use tendril_core::config::TendrilSettings;
    use tendril_core::jobs::manager::{JobManager, SpecBuilder};
    use tendril_core::models::{ExecutePlanArgs, JobArgs};

    let home = HomeFixture::new("guard-grace");
    home.write_promptware("ExecutePlan");
    // A recorded commit, so this test still tests only the grace period: an ExecutePlan job that
    // produced nothing is failed by the deliverable check whatever its process did afterwards.
    let mut plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00007-GracePlan", &plan);

    // Script emits a terminal result event, then sleeps
    let script_body = "#!/bin/sh\necho '{\"kind\":\"result\",\"is_success\":true}'\nsleep 30\n";
    let script_path = home.path.join("agent_grace.sh");
    std::fs::write(&script_path, script_body).expect("write script");

    let script = script_path.clone();
    let workdir = home.path.clone();
    let spec_builder: SpecBuilder = Arc::new(move |_provider, _config| AgentProcessSpec {
        command: "/bin/sh".to_string(),
        args: vec![script.to_string_lossy().to_string()],
        environment: Default::default(),
        working_directory: workdir.clone(),
        stdin_content: None,
        redirect_stdin: false,
        temp_files: vec![],
    });

    let settings = TendrilSettings {
        max_concurrent_jobs: 1,
        ..Default::default()
    };

    // Override post-result grace to 200ms so the test executes quickly
    let manager = JobManager::new(home.path.clone(), settings)
        .with_spec_builder(spec_builder)
        .with_job_timeout(Some(Duration::from_secs(10)))
        .with_post_result_grace(Some(Duration::from_millis(200)));

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    // Wait for the job to finish
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let final_status = loop {
        let job = manager.get_job(&job_id).await.unwrap().unwrap();
        if matches!(
            job.status,
            JobStatus::Completed | JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped
        ) {
            break job.status;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "job {} never reached terminal status",
            job_id
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    };

    assert_eq!(
        final_status,
        JobStatus::Completed,
        "Job should complete successfully with result event outcome even though process lingered"
    );

    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    if let Some(pid) = job.process_id {
        let gone = wait_until(Duration::from_secs(5), || {
            !tendril_core::config::is_process_running(pid)
        })
        .await;
        assert!(
            gone,
            "Process {} should have been killed after grace period",
            pid
        );
    }

    assert_eq!(
        plan_state(&folder),
        "Review",
        "Plan should transition to Review after successful completion"
    );
}
