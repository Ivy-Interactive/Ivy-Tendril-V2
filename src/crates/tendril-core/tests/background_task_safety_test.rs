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
        None,
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
        None,
    )
    .await;

    let map = jobs_map.read().await;
    let saved_job = map.get(job_id).expect("job should be recorded");
    assert_eq!(saved_job.status, JobStatus::Completed);
    assert!(saved_job.reported_failure_reason.is_none());
}

// ── Authorship regressions ──────────────────────────────────────────────────────────────────────
//
// The guard reads prose, so the question "who said this?" is the whole of its soundness. Job 00007
// was asked to work on this very file, `sed`-ed it into a tool result, and the fixture on line 14
// above matched — the run was failed for quoting the guard's own test data, after it had already
// written plan 00004. These tests pin both halves: a tool result cannot accuse, and the agent's own
// words still can.

/// The literal string that failed job 00007, verbatim from the fixture on line 14 of this file.
const MARKER: &str = "The command was moved to the background (ID: task-101)";

#[test]
fn tool_result_output_does_not_accuse_the_agent_that_read_it() {
    // Exactly the shape found in `00007.eventwire.jsonl`: a `tool_result` whose `output` is the
    // source of this file. Reading a test fixture is not starting a background task.
    let eventwire = serde_json::json!({
        "kind": "tool_result",
        "tool_use_id": "toolu_vrtx_01TLE9LoQkD1yMfzSscjr2H8",
        "is_error": false,
        "output": format!("    let lines1 = vec![\"{}\".to_string()];\n", MARKER),
    })
    .to_string();

    // And the provider's own form of the same thing, from `00007.raw.jsonl`: the marker sits in a
    // `tool_result` content block of a *user* message, which is the transcript's word for "this came
    // back from a tool", not for anything a human or the agent typed.
    let raw = serde_json::json!({
        "type": "user",
        "message": {"content": [{
            "type": "tool_result",
            "tool_use_id": "toolu_vrtx_01TLE9LoQkD1yMfzSscjr2H8",
            "content": format!("let lines1 = vec![\"{}\".to_string()];", MARKER),
        }]},
    })
    .to_string();

    assert!(
        find_abandoned_background_tasks(&[eventwire]).is_empty(),
        "a tool result must never accuse the agent that read it"
    );
    assert!(
        find_abandoned_background_tasks(&[raw]).is_empty(),
        "the provider's own tool-result shape must be scoped out too"
    );
}

#[test]
fn agent_text_still_accuses() {
    // The guard's reason for existing: the agent itself saying it parked work and moved on. Both
    // wire shapes, because the merged log carries both.
    let eventwire = serde_json::json!({"kind": "text", "text": MARKER, "delta": false}).to_string();
    assert_eq!(
        find_abandoned_background_tasks(&[eventwire]),
        vec!["task-101"],
        "the agent's own words must still flag an abandoned task"
    );

    let assistant = serde_json::json!({
        "type": "assistant",
        "message": {"content": [{"type": "text", "text": "Kicked the suite off — task-101 runs on. The command was moved to the background (ID: task-101)"}]},
    })
    .to_string();
    assert_eq!(
        find_abandoned_background_tasks(&[assistant]),
        vec!["task-101"]
    );

    // The terminal result's own response is the agent talking too.
    let result = serde_json::json!({
        "kind": "result",
        "is_success": true,
        "response": "Command running in background with ID: task909",
    })
    .to_string();
    assert_eq!(find_abandoned_background_tasks(&[result]), vec!["task909"]);

    // A bare stdout line has no authorship marking at all, and `EventWireNormalizer` already rules
    // that such a line is the agent's prose — so the guard agrees with it rather than going silent.
    assert_eq!(
        find_abandoned_background_tasks(&[MARKER.to_string()]),
        vec!["task-101"]
    );
}

#[test]
fn a_tool_result_can_still_clear_a_task_the_agent_started() {
    // Asymmetric on purpose: an accusation has to know who spoke, a retraction only has to be true.
    // The agent says it backgrounded something; the shell's own output says it finished.
    let lines = vec![
        serde_json::json!({"kind": "text", "text": MARKER, "delta": false}).to_string(),
        serde_json::json!({
            "kind": "tool_result",
            "tool_use_id": "t2",
            "is_error": false,
            "output": "Task task-101 finished with exit code 0",
        })
        .to_string(),
    ];
    assert!(find_abandoned_background_tasks(&lines).is_empty());
}

/// Job 00007, end to end: a `CreatePlan` that wrote its plan, then had its own reading of this
/// file's fixture read back as proof it had abandoned a task.
///
/// Two independent bugs had to both be fixed for this to pass — the scan is now scoped to what the
/// agent said, *and* the guard runs after `verify_deliverable` instead of before it. The second is
/// what this test is really for: with the check running first, the status was already `Failed` by the
/// time anything asked what the job had produced, because `verify_deliverable` is gated on the status
/// still being `Completed`.
#[tokio::test]
async fn a_job_that_produced_its_plan_is_not_failed_by_a_quoted_marker() {
    let home = HomeFixture::new("bg-safety-00007");
    let job_id = "07703";

    // The plan the run actually delivered, with a revision in it — the thing that made the user's
    // "7 completed but 8 plans" contradiction visible.
    let plan = plan_with(PlanStatus::Draft, &[]);
    let plan_folder = home.write_plan("00704-FixWireframeUsingStatements", &plan);
    std::fs::create_dir_all(plan_folder.join("Revisions")).expect("revisions dir");
    std::fs::write(plan_folder.join("Revisions").join("001.md"), "# Plan\n").expect("revision");

    // The agent says it created the plan, and a tool result carries this file's source back.
    append_to_eventwire(
        &home.path,
        job_id,
        &serde_json::json!({
            "kind": "text",
            "text": "### Plan Created: Fix Wireframe Using Statements\n\nPlanId: 00704\n",
            "delta": false,
        })
        .to_string(),
    )
    .unwrap();
    append_to_eventwire(
        &home.path,
        job_id,
        &serde_json::json!({
            "kind": "tool_result",
            "tool_use_id": "toolu_vrtx_01TLE9LoQkD1yMfzSscjr2H8",
            "is_error": false,
            "output": format!("    let lines1 = vec![\"{}\".to_string()];\n", MARKER),
        })
        .to_string(),
    )
    .unwrap();

    let job = JobItem::new(
        job_id.to_string(),
        "CreatePlan".to_string(),
        String::new(),
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
        None,
    )
    .await;

    let map = jobs_map.read().await;
    let saved_job = map.get(job_id).expect("job should be recorded");
    assert_eq!(
        saved_job.status,
        JobStatus::Completed,
        "a job that produced its plan must not be failed for quoting a marker: {:?}",
        saved_job.status_message
    );
    assert!(saved_job.reported_failure_reason.is_none());
    // The plan is still on disk and still linked — the half of the old behaviour that was correct.
    assert!(plan_folder.join("Revisions").join("001.md").is_file());
    assert_eq!(saved_job.plan_file, plan_folder.to_string_lossy());
}

/// The ordering rule stated on its own terms: a genuinely abandoned task, admitted by the agent, on a
/// run that still delivered. It stays `Completed` — the loose end is reported, not punished — which
/// is the precedence `finish_job` now spells out.
#[tokio::test]
async fn a_delivered_job_reports_a_real_abandoned_task_without_failing() {
    let home = HomeFixture::new("bg-safety-delivered");
    let job_id = "07704";

    let mut plan = plan_with(
        PlanStatus::Executing,
        &[("RustTest", VerificationStatus::Pass)],
    );
    plan.commits = vec!["abc1234".to_string()];
    let plan_folder = home.write_plan("00705-Delivered", &plan);

    append_to_eventwire(
        &home.path,
        job_id,
        &serde_json::json!({
            "kind": "text",
            "text": "Tests are slow, so: Command running in background with ID: task-real. Moving on.",
            "delta": false,
        })
        .to_string(),
    )
    .unwrap();

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
        None,
    )
    .await;

    let map = jobs_map.read().await;
    let saved_job = map.get(job_id).expect("job should be recorded");
    assert_eq!(saved_job.status, JobStatus::Completed);
    let message = saved_job.status_message.as_deref().unwrap_or_default();
    assert!(
        message.contains("Background task(s) still running when the turn ended (task-real)."),
        "the dangling task must still be surfaced: {}",
        message
    );
}
