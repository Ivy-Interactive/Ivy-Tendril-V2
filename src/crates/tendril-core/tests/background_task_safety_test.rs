mod common;

use common::{plan_with, HomeFixture};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tendril_core::jobs::logger::{append_to_eventwire, append_to_raw_log};
use tendril_core::jobs::manager::{find_abandoned_background_tasks, finish_job};
use tendril_core::models::{JobItem, JobStatus, PlanStatus, VerificationStatus};
use tokio::sync::RwLock;

#[test]
fn test_find_abandoned_background_tasks_regex() {
    // 1. Single started task
    let lines1 = vec!["The command was moved to the background (ID: task-101)".to_string()];
    let abandoned1 = find_abandoned_background_tasks(&lines1);
    assert_eq!(abandoned1, vec!["task-101"]);

    // 2. Task with ID syntax variations
    let lines2 = vec!["Command running in background with ID: task202".to_string()];
    let abandoned2 = find_abandoned_background_tasks(&lines2);
    assert_eq!(abandoned2, vec!["task202"]);

    // 3. Started and completed task
    let lines3 = vec![
        "was moved to the background ID: task303".to_string(),
        "Background task task303 has completed".to_string(),
    ];
    let abandoned3 = find_abandoned_background_tasks(&lines3);
    assert!(abandoned3.is_empty());

    // 4. Multiple tasks, one finished, one abandoned
    let lines4 = vec![
        "running in background with ID: alpha".to_string(),
        "was moved to the background (ID: beta)".to_string(),
        "Task alpha finished with exit code 0".to_string(),
    ];
    let abandoned4 = find_abandoned_background_tasks(&lines4);
    assert_eq!(abandoned4, vec!["beta"]);
}

#[tokio::test]
async fn test_exit_zero_job_with_dangling_tasks_transitions_to_failed() {
    let home = HomeFixture::new("bg-safety-fail");
    let job_id = "07701";

    // Write log with an abandoned background task
    append_to_raw_log(
        &home.path,
        job_id,
        "Command was moved to the background (ID: task-orphaned)",
    )
    .unwrap();
    append_to_eventwire(
        &home.path,
        job_id,
        "{\"type\":\"status\",\"message\":\"completed step\"}",
    )
    .unwrap();

    let job = JobItem::new(
        job_id.to_string(),
        "ExecutePlan".to_string(),
        String::new(),
        "TestProject".to_string(),
    );

    let jobs_map = Arc::new(RwLock::new(std::collections::HashMap::new()));
    let handles = Arc::new(RwLock::new(std::collections::HashMap::new()));
    let completion_claimed = AtomicBool::new(false);

    // Call finish_job claiming Completed
    finish_job(
        &home.path,
        &home.plans_dir(),
        &jobs_map,
        &handles,
        &completion_claimed,
        job,
        JobStatus::Completed,
        "Finished normally".to_string(),
        Some(10),
    )
    .await;

    let map = jobs_map.read().await;
    let saved_job = map.get(job_id).expect("job should be recorded");
    assert_eq!(saved_job.status, JobStatus::Failed);
    let reason = saved_job
        .reported_failure_reason
        .as_deref()
        .unwrap_or_default();
    assert!(
        reason.contains("Background task(s) still running when the turn ended (task-orphaned)."),
        "Unexpected reason: {}",
        reason
    );
}

#[tokio::test]
async fn test_exit_zero_job_with_completed_tasks_succeeds() {
    let home = HomeFixture::new("bg-safety-pass");
    let job_id = "07702";

    // Write log with a task that finished
    append_to_raw_log(
        &home.path,
        job_id,
        "Command was moved to the background (ID: task-clean)",
    )
    .unwrap();
    append_to_raw_log(&home.path, job_id, "Task task-clean finished").unwrap();

    // A real deliverable, so this test still tests only the background-task guard: an ExecutePlan job
    // that produced nothing is failed by the deliverable check regardless of its background tasks.
    let mut plan = plan_with(
        PlanStatus::Executing,
        &[("RustTest", VerificationStatus::Pass)],
    );
    plan.commits = vec!["abc1234".to_string()];
    let plan_folder = home.write_plan("00701-CleanTasks", &plan);

    let job = JobItem::new(
        job_id.to_string(),
        "ExecutePlan".to_string(),
        plan_folder.to_string_lossy().to_string(),
        "TestProject".to_string(),
    );

    let jobs_map = Arc::new(RwLock::new(std::collections::HashMap::new()));
    let handles = Arc::new(RwLock::new(std::collections::HashMap::new()));
    let completion_claimed = AtomicBool::new(false);

    finish_job(
        &home.path,
        &home.plans_dir(),
        &jobs_map,
        &handles,
        &completion_claimed,
        job,
        JobStatus::Completed,
        "Finished normally".to_string(),
        Some(10),
    )
    .await;

    let map = jobs_map.read().await;
    let saved_job = map.get(job_id).expect("job should be recorded");
    assert_eq!(saved_job.status, JobStatus::Completed);
    assert!(saved_job.reported_failure_reason.is_none());
}
