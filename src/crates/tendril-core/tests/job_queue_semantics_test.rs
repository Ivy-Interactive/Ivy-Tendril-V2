//! The queue semantics restored from legacy: the stale-output watchdog, priority dispatch, conflict
//! rejection, wait-for-jobs dependencies, the periodic maintenance pass and the queue management
//! operations.
//!
//! Every manager built here gets `with_plans_dir` pointed at its own fixture. The maintenance pass
//! rewrites plan states, and `TENDRIL_PLANS` on a developer machine points at the operator's real
//! Plans folder — a pass that resolved it would edit real plans.

mod common;

use common::{plan_state, plan_with, HomeFixture};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::agents::providers::AgentProcessSpec;
use tendril_core::config::{get_database_path, TendrilSettings};
use tendril_core::db::jobs::{
    delete_job, get_job as get_job_row, insert_job, list_job_ids_by_status,
};
use tendril_core::db::open_database;
use tendril_core::error::{Result, TendrilError};
use tendril_core::jobs::manager::{
    conflict_group, describe_wait_dependency, stale_eviction_candidates, JobManager, SpecBuilder,
    StartOptions, CLEARABLE_STATUSES,
};
use tendril_core::jobs::recovery::reconcile_jobs_with;
use tendril_core::models::{
    CreatePlanArgs, CreatePrArgs, ExecutePlanArgs, JobArgs, JobItem, JobStatus, PlanStatus,
    SyncRepoArgs, VerificationStatus,
};

/// Settings with the concurrency budget a test needs and nothing else changed.
fn settings(max_concurrent: i32) -> TendrilSettings {
    TendrilSettings {
        max_concurrent_jobs: max_concurrent,
        ..Default::default()
    }
}

/// A manager wired to a fixture: throwaway agent script, fixture plans directory.
fn manager_for(home: &HomeFixture, max_concurrent: i32, script: Option<PathBuf>) -> JobManager {
    let builder = match script {
        Some(script) => script_spec_builder(script, home.path.clone()),
        None => panicking_spec_builder(),
    };
    JobManager::new(home.path.clone(), settings(max_concurrent))
        .with_spec_builder(builder)
        .with_plans_dir(Some(home.plans_dir()))
}

/// A spec builder that runs a throwaway shell script instead of a real agent CLI.
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

/// A spec builder that fails the test if the launch path ever reaches it.
fn panicking_spec_builder() -> SpecBuilder {
    Arc::new(|_provider, _config| panic!("no agent process may be spawned for this job"))
}

fn write_script(home: &HomeFixture, name: &str, body: &str) -> PathBuf {
    let path = home.path.join(name);
    std::fs::write(&path, body).expect("write script");
    path
}

fn execute(folder: &std::path::Path) -> JobArgs {
    JobArgs::ExecutePlan(ExecutePlanArgs {
        folder_path: folder.to_string_lossy().to_string(),
        note: None,
    })
}

fn create_pr(folder: &std::path::Path) -> JobArgs {
    JobArgs::CreatePr(CreatePrArgs {
        folder_path: folder.to_string_lossy().to_string(),
        solve_merge_conflicts: false,
        merge: false,
        delete_branch: false,
        include_artifacts: false,
        reviewers: None,
        comment: None,
        draft: false,
    })
}

/// Stub PR-state resolver: no `gh`, no network.
fn resolver_returning(state: &'static str) -> impl Fn(&str) -> Result<String> + Sync {
    move |_url: &str| Ok(state.to_string())
}

fn never_called_resolver(url: &str) -> Result<String> {
    panic!("PR state resolver must not be called, but was asked about {url}");
}

fn is_terminal(status: JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Completed | JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped
    )
}

async fn status_of(manager: &JobManager, id: &str) -> JobStatus {
    manager
        .get_job(id)
        .await
        .unwrap()
        .expect("job should exist")
        .status
}

/// Waits for a terminal status. `Blocked` is deliberately not terminal here: a job released from
/// `Blocked` has to be followed all the way to its real outcome.
async fn wait_for_terminal(manager: &JobManager, id: &str, timeout: Duration) -> JobStatus {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let status = status_of(manager, id).await;
        if is_terminal(status) {
            return status;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "job {} never reached a terminal status (last: {})",
            id,
            status
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn wait_for_status(manager: &JobManager, id: &str, want: JobStatus, timeout: Duration) {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let status = status_of(manager, id).await;
        if status == want {
            return;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "job {} is {}, expected {}",
            id,
            status,
            want
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// A job in the given status, launched five minutes ago and reverting to `Draft`. Not yet persisted.
fn job_in(id: &str, plan_folder: &std::path::Path, job_type: &str, status: JobStatus) -> JobItem {
    let mut job = JobItem::new(
        id.to_string(),
        job_type.to_string(),
        plan_folder.to_string_lossy().to_string(),
        "FixtureProject".to_string(),
    );
    job.status = status;
    job.previous_plan_state = Some(PlanStatus::Draft.to_string());
    job.started_at = Some(chrono::Utc::now() - chrono::Duration::minutes(5));
    job.completed_at = is_terminal(status).then(chrono::Utc::now);
    job
}

/// Writes a job row straight to SQLite, for the paths that read the database rather than the
/// in-memory map — a job left behind by a previous daemon, or history to be cleared.
fn write_job_row(home: &HomeFixture, job: &JobItem) {
    let conn = open_database(&get_database_path(&home.path)).expect("open db");
    insert_job(&conn, job).expect("insert job row");
}

fn write_terminal_job(
    home: &HomeFixture,
    id: &str,
    plan_folder: &std::path::Path,
    status: JobStatus,
) {
    write_job_row(home, &job_in(id, plan_folder, "ExecutePlan", status));
}

/// A non-terminal `ExecutePlan` row as an interrupted daemon would have left it: both `args` and
/// `typed_args` populated, since the launch and recovery paths read the typed copy and a row with
/// only one of the two is silently ignored.
fn seed_live_job(
    home: &HomeFixture,
    id: &str,
    plan_folder: &std::path::Path,
    status: JobStatus,
    process_id: Option<u32>,
) -> JobItem {
    let args = execute(plan_folder);
    let mut job = job_in(id, plan_folder, "ExecutePlan", status);
    job.process_id = process_id;
    job.typed_args = Some(args.clone());
    job.args = serde_json::to_string(&args).ok();
    write_job_row(home, &job);
    job
}

/// This process's own PID. Alive by definition, which is what makes a seeded `Running` row read as a
/// job that survived the daemon rather than as an interrupted one to be reaped.
fn alive_pid() -> u32 {
    std::process::id()
}

/// `StartOptions` carrying nothing but a client-supplied idempotency key.
fn keyed(key: &str) -> StartOptions {
    StartOptions {
        idempotency_key: Some(key.to_string()),
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Stale-output watchdog
// ---------------------------------------------------------------------------

/// An agent that prints once and then goes quiet is killed on the stale window, not on `jobTimeout`.
#[cfg(unix)]
#[tokio::test]
async fn the_watchdog_fails_a_stalled_job_well_before_the_job_timeout() {
    let home = HomeFixture::new("queue-watchdog-stall");
    home.write_promptware("ExecutePlan");
    let folder = home.write_plan("00001-Stalled", &plan_with(PlanStatus::Draft, &[]));
    let script = write_script(&home, "agent.sh", "echo starting up\nsleep 30\n");

    let manager = manager_for(&home, 2, Some(script))
        .with_stale_output_timeout(Some(Duration::from_secs(1)))
        .with_job_timeout(Some(Duration::from_secs(120)));

    let started = std::time::Instant::now();
    let job_id = manager.start_job(execute(&folder)).await.unwrap();

    assert_eq!(
        wait_for_terminal(&manager, &job_id, Duration::from_secs(20)).await,
        JobStatus::Timeout
    );
    assert!(
        started.elapsed() < Duration::from_secs(60),
        "the stale window, not the job timeout, should have ended this job"
    );

    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    let msg = job.status_message.unwrap();
    assert!(msg.contains("stale output timeout"), "{}", msg);
    assert_eq!(
        plan_state(&folder),
        "Draft",
        "a stale kill reverts the plan like any other failure"
    );
}

/// A job that keeps reporting is alive, even when each step takes longer than the stale window would
/// allow on its own. This is the long-verification case.
#[cfg(unix)]
#[tokio::test]
async fn the_watchdog_tolerates_a_slow_but_talking_job() {
    let home = HomeFixture::new("queue-watchdog-alive");
    home.write_promptware("ExecutePlan");
    let mut plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Talking", &plan);
    let script = write_script(
        &home,
        "agent.sh",
        "i=0\nwhile [ $i -lt 10 ]; do echo tick $i; sleep 0.3; i=$((i+1)); done\nexit 0\n",
    );

    let manager = manager_for(&home, 2, Some(script))
        .with_stale_output_timeout(Some(Duration::from_secs(2)))
        .with_job_timeout(Some(Duration::from_secs(120)));

    let job_id = manager.start_job(execute(&folder)).await.unwrap();

    assert_eq!(
        wait_for_terminal(&manager, &job_id, Duration::from_secs(30)).await,
        JobStatus::Completed,
        "a job whose run outlasts the stale window while still emitting must not be killed"
    );
}

/// Once the agent has reported its result the watchdog stands down: the post-result grace window owns
/// the wind-down, and killing the job there would throw away finished work.
#[cfg(unix)]
#[tokio::test]
async fn the_watchdog_stands_down_after_the_result_event() {
    let home = HomeFixture::new("queue-watchdog-result");
    home.write_promptware("ExecutePlan");
    let mut plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Result", &plan);
    let script = write_script(
        &home,
        "agent.sh",
        "echo '{\"type\":\"result\",\"is_success\":true}'\nsleep 20\n",
    );

    let manager = manager_for(&home, 2, Some(script))
        .with_stale_output_timeout(Some(Duration::from_secs(1)))
        .with_post_result_grace(Some(Duration::from_secs(3)))
        .with_job_timeout(Some(Duration::from_secs(120)));

    let job_id = manager.start_job(execute(&folder)).await.unwrap();

    assert_eq!(
        wait_for_terminal(&manager, &job_id, Duration::from_secs(30)).await,
        JobStatus::Completed
    );
    let msg = manager
        .get_job(&job_id)
        .await
        .unwrap()
        .unwrap()
        .status_message
        .unwrap();
    assert!(
        !msg.contains("stale output"),
        "the watchdog fired after the result event: {}",
        msg
    );
}

// ---------------------------------------------------------------------------
// Priority dispatch
// ---------------------------------------------------------------------------

/// With one slot taken, the higher-priority waiter is the one promoted when the slot frees.
#[cfg(unix)]
#[tokio::test]
async fn dispatch_promotes_the_highest_priority_waiter() {
    let home = HomeFixture::new("queue-priority");
    home.write_promptware("ExecutePlan");
    let occupier = home.write_plan("00001-Occupier", &plan_with(PlanStatus::Draft, &[]));
    let low = home.write_plan("00002-Low", &plan_with(PlanStatus::Draft, &[]));
    let high = home.write_plan("00003-High", &plan_with(PlanStatus::Draft, &[]));
    let script = write_script(&home, "agent.sh", "echo working\nsleep 30\n");

    // One slot, so the two waiters must queue behind the occupier.
    let manager = manager_for(&home, 1, Some(script));

    let occupier_id = manager.start_job(execute(&occupier)).await.unwrap();
    wait_for_status(
        &manager,
        &occupier_id,
        JobStatus::Running,
        Duration::from_secs(15),
    )
    .await;

    let low_id = manager
        .start_job_with(
            execute(&low),
            StartOptions {
                priority: Some(0),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let high_id = manager
        .start_job_with(
            execute(&high),
            StartOptions {
                priority: Some(10),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(
        manager.queue_order().await,
        vec![high_id.clone(), low_id.clone()],
        "the priority-10 job should be ahead of the priority-0 job enqueued before it"
    );
    assert_eq!(
        manager.queue_snapshot().await,
        vec![(high_id.clone(), 10), (low_id.clone(), 0)]
    );

    // Freeing the slot must promote the high-priority job, not the one that queued first.
    assert!(manager.cancel_job(&occupier_id, None).await.unwrap());
    wait_for_status(
        &manager,
        &high_id,
        JobStatus::Running,
        Duration::from_secs(15),
    )
    .await;
    assert_eq!(status_of(&manager, &low_id).await, JobStatus::Queued);

    manager.stop_all_jobs().await.unwrap();
}

/// A plan's own `plan.yaml` priority is what a job inherits when nothing overrides it.
#[tokio::test]
async fn a_job_inherits_the_priority_of_its_plan() {
    let home = HomeFixture::new("queue-plan-priority");
    home.write_promptware("ExecutePlan");

    // A plan whose dependency is missing stays Blocked, so no agent launches and the priority can be
    // read straight off the job row.
    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.priority = 7;
    plan.depends_on = vec!["00099-DoesNotExist".to_string()];
    let folder = home.write_plan("00001-Urgent", &plan);

    let manager = manager_for(&home, 2, None);
    let job_id = manager.start_job(execute(&folder)).await.unwrap();

    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(job.status, JobStatus::Blocked);
    assert_eq!(job.priority, 7);
}

// ---------------------------------------------------------------------------
// Conflict rejection
// ---------------------------------------------------------------------------

/// A second `ExecutePlan` on a plan already being executed is refused, naming the job that holds it.
#[cfg(unix)]
#[tokio::test]
async fn a_conflicting_execute_plan_is_refused_and_names_the_existing_job() {
    let home = HomeFixture::new("queue-conflict-execute");
    home.write_promptware("ExecutePlan");
    let folder = home.write_plan("00001-Busy", &plan_with(PlanStatus::Draft, &[]));
    let script = write_script(&home, "agent.sh", "echo working\nsleep 30\n");

    let manager = manager_for(&home, 2, Some(script));
    let first = manager.start_job(execute(&folder)).await.unwrap();
    wait_for_status(
        &manager,
        &first,
        JobStatus::Running,
        Duration::from_secs(15),
    )
    .await;
    assert_eq!(plan_state(&folder), "Executing");

    let err = manager
        .start_job(execute(&folder))
        .await
        .expect_err("the second ExecutePlan should be refused");
    assert!(matches!(err, TendrilError::Conflict(_)), "{:?}", err);
    let msg = err.to_string();
    assert!(msg.contains(&first), "{}", msg);
    assert!(msg.contains("ExecutePlan"), "{}", msg);

    assert_eq!(
        plan_state(&folder),
        "Executing",
        "a refused start must not touch the plan"
    );
    assert_eq!(
        manager.list_jobs(None, 100).await.unwrap().len(),
        1,
        "a refused start must not write a job row"
    );

    manager.stop_all_jobs().await.unwrap();
}

/// `CreatePr` is in the plan-mutating group too — the omission that let duplicate `CreatePr` jobs
/// run on one plan in legacy.
#[cfg(unix)]
#[tokio::test]
async fn an_in_flight_execute_plan_refuses_a_create_pr_on_the_same_plan() {
    let home = HomeFixture::new("queue-conflict-createpr");
    home.write_promptware("ExecutePlan");
    let folder = home.write_plan("00001-Busy", &plan_with(PlanStatus::Draft, &[]));
    let script = write_script(&home, "agent.sh", "echo working\nsleep 30\n");

    let manager = manager_for(&home, 2, Some(script));
    let first = manager.start_job(execute(&folder)).await.unwrap();
    wait_for_status(
        &manager,
        &first,
        JobStatus::Running,
        Duration::from_secs(15),
    )
    .await;

    let err = manager
        .start_job(create_pr(&folder))
        .await
        .expect_err("CreatePr should be refused while the plan is being executed");
    assert!(err.to_string().contains(&first), "{}", err);

    // And the reverse of the same rule: a second CreatePr is refused too.
    manager.stop_all_jobs().await.unwrap();
    home.write_promptware("CreatePr");
    let pr_job = manager.start_job(create_pr(&folder)).await.unwrap();
    let err = manager
        .start_job(create_pr(&folder))
        .await
        .expect_err("a duplicate CreatePr should be refused");
    assert!(err.to_string().contains(&pr_job), "{}", err);

    manager.stop_all_jobs().await.unwrap();
}

/// Only jobs in the same group fight over a plan; a job type that touches no plan is in no group.
#[test]
fn the_conflict_groups_separate_mutating_authoring_and_unrelated_job_types() {
    for job_type in ["ExecutePlan", "RetryPlan", "CreatePr"] {
        assert_eq!(
            conflict_group(job_type),
            Some("plan-mutating"),
            "{} mutates a plan's worktree or plan.yaml",
            job_type
        );
    }
    for job_type in ["UpdatePlan", "ExpandPlan", "SplitPlan"] {
        assert_eq!(conflict_group(job_type), Some("plan-authoring"));
    }
    for job_type in ["SetupProject", "AddProject", "SyncRepo", "CreatePlan"] {
        assert_eq!(
            conflict_group(job_type),
            None,
            "{} is not scoped to one plan",
            job_type
        );
    }
    assert_ne!(
        conflict_group("ExecutePlan"),
        conflict_group("UpdatePlan"),
        "authoring a plan and executing it are not the same fight"
    );
}

/// A plan nothing is working on has no conflict, and a job with no plan folder can never conflict.
#[tokio::test]
async fn an_idle_plan_and_a_planless_job_never_conflict() {
    let home = HomeFixture::new("queue-conflict-idle");
    let folder = home.write_plan("00001-Plan", &plan_with(PlanStatus::Draft, &[]));
    let manager = manager_for(&home, 2, None);

    assert!(manager
        .find_conflicting_job("ExecutePlan", &folder.to_string_lossy())
        .await
        .unwrap()
        .is_none());
    assert!(manager
        .find_conflicting_job("SyncRepo", "")
        .await
        .unwrap()
        .is_none());
    // Normalization must not invent a conflict either: an idle plan spelled with a trailing
    // separator is still idle.
    assert!(manager
        .find_conflicting_job("ExecutePlan", &format!("{}/", folder.to_string_lossy()))
        .await
        .unwrap()
        .is_none());
}

/// Two spellings of one folder are one folder. Legacy compared the strings raw, so `--folder plan/`
/// and `--folder plan` were two different plans as far as the guard was concerned.
#[tokio::test]
async fn a_trailing_separator_spelling_of_the_same_folder_still_collides() {
    let home = HomeFixture::new("queue-conflict-spelling");
    let folder = home.write_plan("00001-Busy", &plan_with(PlanStatus::Executing, &[]));
    seed_live_job(
        &home,
        "00001",
        &folder,
        JobStatus::Running,
        Some(alive_pid()),
    );

    let manager = manager_for(&home, 2, None);
    let exact = folder.to_string_lossy().to_string();
    for spelling in [
        exact.clone(),
        format!("{}/", exact),
        format!("{}//", exact),
        format!(" {} ", exact),
        exact.to_uppercase(),
    ] {
        assert_eq!(
            manager
                .find_conflicting_job("ExecutePlan", &spelling)
                .await
                .unwrap()
                .as_deref(),
            Some("00001"),
            "{:?} names the plan job 00001 already holds",
            spelling
        );
    }
}

/// Simultaneous starts on one plan, fired from several tasks released together. Before the critical
/// section was widened the conflict check sat ~90 lines and several `.await` points before the insert,
/// so submissions that overlapped in that window all passed it and the plan got several jobs, several
/// worktrees and several agents.
///
/// A [`tokio::sync::Barrier`] is what makes the overlap real: without it the first task runs its whole
/// start — including the insert — before the second is polled, and the pre-lock fast path alone is
/// enough to refuse the rest. That version of this test passed against a deliberately broken guard.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_concurrent_starts_on_one_plan_produce_one_job_and_one_conflict() {
    assert_one_concurrent_start_wins("queue-race-same-type", execute, "Executing").await;
    // The guard is per conflict group, not per job type: `CreatePr` is in the plan-mutating group
    // too, so it has to lose the same race. It leaves the plan state alone when it wins — that
    // promptware sets its own — so the plan is still `Draft` in that half. This half is also the one
    // the dedupe key cannot cover: keys are derived per job type, so two types never share one.
    assert_one_concurrent_start_wins("queue-race-cross-type", create_pr, "Draft").await;
}

/// Races `ExecutePlan` submissions against `second` submissions on one plan, all released at once, and
/// asserts exactly one job came out of it. `second_plan_state` is where the plan lands when `second`
/// wins.
#[cfg(unix)]
async fn assert_one_concurrent_start_wins(
    label: &str,
    second: fn(&std::path::Path) -> JobArgs,
    second_plan_state: &str,
) {
    /// More than two, because whether any given pair truly overlaps is up to the scheduler. Every
    /// extra racer is another chance for two of them to be inside the window at once.
    const RACERS: usize = 6;

    let home = HomeFixture::new(label);
    home.write_promptware("ExecutePlan");
    home.write_promptware("CreatePr");
    let folder = home.write_plan("00001-Contested", &plan_with(PlanStatus::Draft, &[]));
    let script = write_script(&home, "agent.sh", "echo working\nsleep 30\n");

    let manager = manager_for(&home, 2, Some(script)).share();
    let barrier = Arc::new(tokio::sync::Barrier::new(RACERS));
    let mut tasks = Vec::new();
    for index in 0..RACERS {
        let manager = manager.clone();
        let barrier = barrier.clone();
        // Alternating, so the two job types are interleaved rather than one type going first.
        let args = if index % 2 == 0 {
            execute(&folder)
        } else {
            second(&folder)
        };
        tasks.push(tokio::spawn(async move {
            barrier.wait().await;
            (index, manager.start_job(args).await)
        }));
    }

    let mut winners: Vec<(usize, String)> = Vec::new();
    let mut refusals: Vec<TendrilError> = Vec::new();
    for task in tasks {
        match task.await.expect("a start task should not panic") {
            (index, Ok(id)) => winners.push((index, id)),
            (_, Err(e)) => refusals.push(e),
        }
    }

    assert_eq!(
        winners.len(),
        1,
        "exactly one of {} simultaneous starts may create a job, got {:?}",
        RACERS,
        winners
    );
    let (winner_index, winner) = winners.remove(0);
    for refusal in &refusals {
        // Either refusal is correct, and which one a given loser gets is a race: the dedupe key gate
        // runs first inside the lock and answers a loser of the winner's own type, while the conflict
        // check answers one of the other type. Both are 409 on the wire, and both name the winner —
        // which is what the assertion below, the one that matters, pins.
        assert!(
            matches!(
                refusal,
                TendrilError::Conflict(_) | TendrilError::DuplicateJob(_)
            ),
            "a loser must be refused as a conflict or a duplicate, got {:?}",
            refusal
        );
        assert!(
            refusal.to_string().contains(&winner),
            "every refusal must name the job that won ({}): {}",
            winner,
            refusal
        );
    }
    assert_eq!(
        manager.list_jobs(None, 100).await.unwrap().len(),
        1,
        "the losing starts must not have written job rows"
    );
    assert_eq!(
        plan_state(&folder),
        if winner_index % 2 == 0 {
            "Executing"
        } else {
            second_plan_state
        },
        "only the winner may move the plan"
    );

    manager.stop_all_jobs().await.unwrap();
}

/// The conflict guard has to answer out of SQLite rather than out of the in-memory map. These cases
/// reconcile with no `JobManager`, so nothing rehydrates the map at all and the row is the only trace
/// of the job left — which is what a memory-only guard went blind on, admitting a second job onto a
/// plan an agent was still working on.
#[tokio::test]
async fn a_persisted_conflicting_job_is_detected_after_a_restart() {
    // A live PID: recovery reads the row as a job that survived the daemon and leaves it running.
    assert_persisted_job_blocks_a_start(
        "queue-restart-running",
        JobStatus::Running,
        Some(alive_pid()),
    )
    .await;
    // And a queued row with no process at all. Given a manager, recovery would put this one back on
    // the queue; the row still owns the plan either way, which is all the guard is being asked about.
    assert_persisted_job_blocks_a_start("queue-restart-queued", JobStatus::Queued, None).await;
    // `Blocked` counts too, and the group gate is the only gate that says so: a blocked job is a
    // standing intention to mutate this plan, and the way to replace one is the delete-then-start
    // claim in `dependents.rs`, not a second submission that leaves two rows racing for the worktree.
    assert_persisted_job_blocks_a_start("queue-restart-blocked", JobStatus::Blocked, None).await;
}

async fn assert_persisted_job_blocks_a_start(
    label: &str,
    status: JobStatus,
    process_id: Option<u32>,
) {
    let home = HomeFixture::new(label);
    let folder = home.write_plan("00001-Survivor", &plan_with(PlanStatus::Executing, &[]));
    seed_live_job(&home, "00001", &folder, status, process_id);

    // A manager built fresh over the same home *is* the restart: nothing ever populated its map.
    let manager = manager_for(&home, 2, None);
    reconcile_jobs_with(
        &home.path,
        &home.plans_dir(),
        &settings(2),
        &never_called_resolver,
        None,
    )
    .await
    .expect("reconciliation should not error");

    assert_eq!(
        manager
            .find_conflicting_job("ExecutePlan", &folder.to_string_lossy())
            .await
            .unwrap()
            .as_deref(),
        Some("00001"),
        "the guard must see the row recovery left behind"
    );

    let err = manager
        .start_job(execute(&folder))
        .await
        .expect_err("a start must be refused while the persisted job holds the plan");
    assert!(matches!(err, TendrilError::Conflict(_)), "{:?}", err);
    assert!(err.to_string().contains("00001"), "{}", err);
    assert_eq!(
        manager.list_jobs(None, 100).await.unwrap().len(),
        1,
        "the refused start must not have written a job row"
    );
    assert_eq!(
        plan_state(&folder),
        "Executing",
        "neither recovery nor a refused start may move the plan"
    );

    // Proof the answer came from the database and not from a rehydrated map: with the row gone,
    // there is nothing left to find.
    let conn = open_database(&get_database_path(&home.path)).expect("open db");
    assert!(delete_job(&conn, "00001").expect("delete row"));
    assert!(
        manager
            .find_conflicting_job("ExecutePlan", &folder.to_string_lossy())
            .await
            .unwrap()
            .is_none(),
        "the in-memory map was never rehydrated, so the database was the only source"
    );
}

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------

/// A client that retries a start it never got an answer for gets the original job back, not a second
/// one. The replay is checked before the conflict gate, so the retry reads as success rather than as
/// the conflict its own first attempt caused.
#[cfg(unix)]
#[tokio::test]
async fn resubmitting_an_idempotency_key_returns_the_original_job() {
    let home = HomeFixture::new("queue-idempotency-replay");
    home.write_promptware("ExecutePlan");
    let folder = home.write_plan("00001-Keyed", &plan_with(PlanStatus::Draft, &[]));
    let other = home.write_plan("00002-Other", &plan_with(PlanStatus::Draft, &[]));
    let script = write_script(&home, "agent.sh", "echo working\nsleep 30\n");
    let manager = manager_for(&home, 2, Some(script));

    let first = manager
        .start_job_with(execute(&folder), keyed("k1"))
        .await
        .unwrap();
    wait_for_status(
        &manager,
        &first,
        JobStatus::Running,
        Duration::from_secs(15),
    )
    .await;
    assert_eq!(plan_state(&folder), "Executing");

    // A distinctive state the replay must not overwrite. Only the winner of a start moves the plan,
    // and a replay creates nothing, so it is not a winner.
    home.write_plan("00001-Keyed", &plan_with(PlanStatus::Review, &[]));

    let replay = manager
        .start_job_with(execute(&folder), keyed("k1"))
        .await
        .expect("a replayed key is the same request, not a conflict");
    assert_eq!(replay, first, "a replayed key must return the original job");
    assert_eq!(
        manager.list_jobs(None, 100).await.unwrap().len(),
        1,
        "a replay must not write a second job row"
    );
    assert_eq!(
        plan_state(&folder),
        "Review",
        "a replay must not flip the plan state a second time"
    );

    // The key is on the row, not just in the request: after a restart the replay check reads it back
    // from SQLite.
    let conn = open_database(&get_database_path(&home.path)).expect("open db");
    assert_eq!(
        get_job_row(&conn, &first)
            .unwrap()
            .expect("job row")
            .idempotency_key,
        Some("k1".to_string()),
        "the key must survive the round trip through the database"
    );

    // A different key is a different request. On a different plan, so the conflict gate is not what
    // is being measured here.
    let second = manager
        .start_job_with(execute(&other), keyed("k2"))
        .await
        .unwrap();
    assert_ne!(second, first, "a fresh key must create a fresh job");
    assert_eq!(manager.list_jobs(None, 100).await.unwrap().len(), 2);

    // Keys are retained for every status, not only in-flight ones: a retry that arrives after the
    // job already finished must still be told about that job rather than starting the work again.
    manager.stop_all_jobs().await.unwrap();
    let final_status = wait_for_terminal(&manager, &first, Duration::from_secs(15)).await;
    assert!(is_terminal(final_status), "{}", final_status);
    assert_eq!(
        manager
            .start_job_with(execute(&folder), keyed("k1"))
            .await
            .expect("a terminal job still answers its key"),
        first
    );
    assert_eq!(
        manager.list_jobs(None, 100).await.unwrap().len(),
        2,
        "replaying a terminal job must not write a third row"
    );
}

/// A plan-scoped job with no plan folder has nothing to key a conflict on, so accepting it would hand
/// out unlimited concurrency on the one path that most needs the guard. Only `POST /api/jobs` can
/// express it — the CLI and MCP both resolve a folder first — and `Validation` is its 400.
#[cfg(unix)]
#[tokio::test]
async fn a_plan_scoped_job_without_a_plan_folder_is_refused() {
    let home = HomeFixture::new("queue-conflict-no-folder");
    for job_type in ["CreatePlan", "SyncRepo"] {
        home.write_promptware(job_type);
    }
    let script = write_script(&home, "agent.sh", "echo done\n");
    let manager = manager_for(&home, 2, Some(script));

    let blank = std::path::Path::new("");
    for args in [
        execute(blank),
        create_pr(blank),
        // Whitespace and a bare separator are empty folders too, not folder named " ".
        execute(std::path::Path::new("   ")),
        execute(std::path::Path::new("/")),
    ] {
        let job_type = args.job_type().to_string();
        let err = manager.start_job(args).await.unwrap_err();
        assert!(
            matches!(err, TendrilError::Validation(_)),
            "{} with no folder should be a validation error, got {:?}",
            job_type,
            err
        );
        assert!(err.to_string().contains("plan folder"), "{}", err);
    }
    assert!(
        manager.list_jobs(None, 100).await.unwrap().is_empty(),
        "a refused start must not write a job row"
    );

    // The rule is about plan-scoped types only. A job type in no conflict group has no plan to fight
    // over, so no folder is the normal case for it and it still starts.
    for args in [
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "Do a thing".to_string(),
            project: "FixtureProject".to_string(),
            priority: 0,
            force: true,
            source_path: None,
            upload_session_id: None,
        }),
        JobArgs::SyncRepo(SyncRepoArgs {
            repo_path: home.path.to_string_lossy().to_string(),
            base_branch: "main".to_string(),
            plan_folder_path: None,
            untracked_changes_policy: "Stash".to_string(),
        }),
    ] {
        let job_type = args.job_type().to_string();
        assert!(
            manager.start_job(args).await.is_ok(),
            "{} is in no conflict group and needs no plan folder",
            job_type
        );
    }

    manager.stop_all_jobs().await.unwrap();
}

// ---------------------------------------------------------------------------
// Wait-for-jobs dependencies
// ---------------------------------------------------------------------------

/// A job waiting on another is `Blocked` with a readable reason, and runs once that job completes.
#[cfg(unix)]
#[tokio::test]
async fn a_job_waiting_on_another_is_blocked_then_released() {
    let home = HomeFixture::new("queue-waitfor-release");
    home.write_promptware("ExecutePlan");
    let mut first_plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    first_plan.commits = vec!["abc1234".to_string()];
    let first_folder = home.write_plan("00001-First", &first_plan);
    let mut second_plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    second_plan.commits = vec!["abc1234".to_string()];
    let second_folder = home.write_plan("00002-Second", &second_plan);

    // The first job finishes only when the test opens the gate, so the wait is observable.
    let gate = home.path.join("gate");
    let script = write_script(
        &home,
        "agent.sh",
        &format!(
            "echo waiting\nwhile [ ! -f {gate} ]; do sleep 0.05; done\necho released\nexit 0\n",
            gate = gate.display()
        ),
    );

    let manager = manager_for(&home, 3, Some(script));
    let first = manager.start_job(execute(&first_folder)).await.unwrap();
    wait_for_status(
        &manager,
        &first,
        JobStatus::Running,
        Duration::from_secs(15),
    )
    .await;

    let second = manager
        .start_job_with(
            execute(&second_folder),
            StartOptions {
                wait_for_jobs: vec![first.clone()],
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let job = manager.get_job(&second).await.unwrap().unwrap();
    assert_eq!(job.status, JobStatus::Blocked);
    assert_eq!(
        job.status_message.as_deref(),
        Some(
            format!(
                "Waiting for ExecutePlan of plan 00001 (job {})",
                first.clone()
            )
            .as_str()
        )
    );
    assert_eq!(job.wait_for_job_ids, vec![first.clone()]);
    assert_eq!(
        plan_state(&second_folder),
        "Draft",
        "waiting on a job says nothing about the plan, so its state must be left alone"
    );

    std::fs::write(&gate, "go").unwrap();
    assert_eq!(
        wait_for_terminal(&manager, &first, Duration::from_secs(20)).await,
        JobStatus::Completed
    );
    assert_eq!(
        wait_for_terminal(&manager, &second, Duration::from_secs(20)).await,
        JobStatus::Completed,
        "the dependent job should have been released by the first one finishing"
    );
}

/// A dependency that has already failed cannot ever release its waiter, so the waiter fails too.
#[cfg(unix)]
#[tokio::test]
async fn a_job_waiting_on_a_failed_job_fails_immediately() {
    let home = HomeFixture::new("queue-waitfor-cascade");
    home.write_promptware("ExecutePlan");
    let first_folder = home.write_plan("00001-First", &plan_with(PlanStatus::Draft, &[]));
    let second_folder = home.write_plan("00002-Second", &plan_with(PlanStatus::Draft, &[]));
    let script = write_script(&home, "agent.sh", "echo giving up >&2\nexit 3\n");

    let manager = manager_for(&home, 3, Some(script));
    let first = manager.start_job(execute(&first_folder)).await.unwrap();
    assert_eq!(
        wait_for_terminal(&manager, &first, Duration::from_secs(20)).await,
        JobStatus::Failed
    );

    let second = manager
        .start_job_with(
            execute(&second_folder),
            StartOptions {
                wait_for_jobs: vec![first.clone()],
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let job = manager.get_job(&second).await.unwrap().unwrap();
    assert_eq!(job.status, JobStatus::Failed);
    assert_eq!(
        job.status_message.as_deref(),
        Some(format!("Blocked job {} failed", first).as_str())
    );
    assert_eq!(plan_state(&second_folder), "Draft");
}

/// An unknown dependency id names a job that no longer exists. Stranding the waiter forever would be
/// worse than letting it run.
#[cfg(unix)]
#[tokio::test]
async fn a_job_waiting_on_an_unknown_id_is_not_stranded() {
    let home = HomeFixture::new("queue-waitfor-unknown");
    home.write_promptware("ExecutePlan");
    let mut plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Only", &plan);
    let script = write_script(&home, "agent.sh", "echo working\nexit 0\n");

    let manager = manager_for(&home, 2, Some(script));
    let job_id = manager
        .start_job_with(
            execute(&folder),
            StartOptions {
                wait_for_jobs: vec!["99999".to_string()],
                ..Default::default()
            },
        )
        .await
        .unwrap();

    assert_eq!(
        wait_for_terminal(&manager, &job_id, Duration::from_secs(20)).await,
        JobStatus::Completed
    );
}

#[test]
fn a_wait_dependency_reads_as_a_job_type_a_plan_and_an_id() {
    let with_plan = JobItem::new(
        "00456".to_string(),
        "ExecutePlan".to_string(),
        "/plans/00123-SomePlan".to_string(),
        "P".to_string(),
    );
    assert_eq!(
        describe_wait_dependency(&with_plan),
        "ExecutePlan of plan 00123 (job 00456)"
    );

    let without_plan = JobItem::new(
        "00456".to_string(),
        "CreatePr".to_string(),
        String::new(),
        "P".to_string(),
    );
    assert_eq!(
        describe_wait_dependency(&without_plan),
        "CreatePr (job 00456)"
    );
}

// ---------------------------------------------------------------------------
// Periodic maintenance
// ---------------------------------------------------------------------------

/// The blocked-plan recheck used to run only at startup, so a dependency satisfied afterwards left
/// the plan blocked until someone restarted the daemon.
#[tokio::test]
async fn maintenance_unblocks_a_plan_whose_dependency_was_satisfied_after_startup() {
    let home = HomeFixture::new("queue-maint-unblock");
    let mut upstream = plan_with(
        PlanStatus::Completed,
        &[("Build", VerificationStatus::Pass)],
    );
    upstream.prs = vec!["https://github.com/acme/widgets/pull/7".to_string()];
    home.write_plan("00002-Upstream", &upstream);

    let mut dependent = plan_with(PlanStatus::Blocked, &[]);
    dependent.depends_on = vec!["00002-Upstream".to_string()];
    let folder = home.write_plan("00001-Dependent", &dependent);

    let manager = manager_for(&home, 2, None);
    let report = manager
        .run_maintenance_pass_with(&resolver_returning("MERGED"))
        .await;

    assert_eq!(report.unblocked_plans, vec!["00001-Dependent".to_string()]);
    assert_eq!(plan_state(&folder), "Draft");
    assert!(!report.is_empty());
}

/// A `Blocked` job whose plan dependency is now satisfied is enqueued by the same pass.
#[cfg(unix)]
#[tokio::test]
async fn maintenance_releases_a_job_blocked_on_a_plan_dependency() {
    let home = HomeFixture::new("queue-maint-release");
    home.write_promptware("ExecutePlan");
    let mut upstream = plan_with(PlanStatus::Draft, &[]);
    upstream.prs = vec![];
    home.write_plan("00002-Upstream", &upstream);

    let mut dependent = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    dependent.depends_on = vec!["00002-Upstream".to_string()];
    dependent.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Dependent", &dependent);

    let script = write_script(&home, "agent.sh", "echo working\nexit 0\n");
    let manager = manager_for(&home, 2, Some(script));

    let job_id = manager.start_job(execute(&folder)).await.unwrap();
    assert_eq!(status_of(&manager, &job_id).await, JobStatus::Blocked);
    assert_eq!(plan_state(&folder), "Blocked");

    // The upstream plan is completed after the job was blocked, exactly the case the startup-only
    // pass could not see.
    let mut done = plan_with(
        PlanStatus::Completed,
        &[("Build", VerificationStatus::Pass)],
    );
    done.prs = vec![];
    home.write_plan("00002-Upstream", &done);

    let report = manager
        .run_maintenance_pass_with(&never_called_resolver)
        .await;
    assert!(
        report.released_jobs.contains(&job_id),
        "{:?}",
        report.released_jobs
    );
    assert_eq!(
        wait_for_terminal(&manager, &job_id, Duration::from_secs(20)).await,
        JobStatus::Completed
    );
}

/// The restart-shaped version of the test above, and the case the wait-for sweep exists for: its
/// comment calls itself belt and braces against a release notification missed because the daemon
/// restarted, so a row left `Blocked` by the daemon that died has to be released here.
///
/// The row is the only trace of the job a new daemon has. Startup reconciliation leaves `Blocked`
/// alone and so never puts it in the in-memory map, and the conflict guard reads the row as in-flight
/// and refuses every resubmission — so a waiter this pass cannot see never runs and never fails.
#[cfg(unix)]
#[tokio::test]
async fn maintenance_releases_a_job_left_blocked_on_a_finished_job_by_a_restart() {
    let home = HomeFixture::new("queue-maint-release-restart");
    home.write_promptware("ExecutePlan");
    let upstream_folder = home.write_plan("00002-Upstream", &plan_with(PlanStatus::Completed, &[]));
    // Passing verification plus a commit is what the post-execution gate reads as delivered work, so
    // the released job's own outcome is `Completed` and not a gate failure that would mask it.
    let mut dependent = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    dependent.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Dependent", &dependent);

    // The dependency finished before the daemon died, so the waiter's release notification was
    // never delivered: on a live daemon `release_wait_dependents` would have fired on 00002.
    write_terminal_job(&home, "00002", &upstream_folder, JobStatus::Completed);
    let mut waiter = seed_live_job(&home, "00001", &folder, JobStatus::Blocked, None);
    waiter.wait_for_job_ids = vec!["00002".to_string()];
    waiter.status_message = Some(format!(
        "Waiting for {}",
        describe_wait_dependency(&job_in(
            "00002",
            &upstream_folder,
            "ExecutePlan",
            JobStatus::Completed
        ))
    ));
    write_job_row(&home, &waiter);

    // A manager built fresh over the same home *is* the restart: nothing ever populated its map.
    let script = write_script(&home, "agent.sh", "echo working\nexit 0\n");
    let manager = manager_for(&home, 2, Some(script)).share();
    reconcile_jobs_with(
        &home.path,
        &home.plans_dir(),
        &settings(2),
        &never_called_resolver,
        Some(&manager),
    )
    .await
    .expect("reconciliation should not error");

    let report = manager
        .run_maintenance_pass_with(&never_called_resolver)
        .await;
    assert!(
        report.released_jobs.contains(&"00001".to_string()),
        "the sweep must find the blocked row the restart left behind, released: {:?}",
        report.released_jobs
    );
    assert_eq!(
        wait_for_terminal(&manager, "00001", Duration::from_secs(20)).await,
        JobStatus::Completed
    );
}

/// The stuck-job check catches a `Running` row whose own watchdog never armed, e.g. a job left behind
/// by a daemon that died.
#[tokio::test]
async fn maintenance_reaps_a_running_job_whose_watchdog_never_armed() {
    let home = HomeFixture::new("queue-maint-stuck");
    let folder = home.write_plan("00001-Stuck", &plan_with(PlanStatus::Executing, &[]));

    // Twenty minutes of silence, well past a 1s stale window plus the two-minute reap grace.
    let mut job = job_in("00001", &folder, "ExecutePlan", JobStatus::Running);
    job.started_at = Some(chrono::Utc::now() - chrono::Duration::minutes(30));
    job.last_output_at = Some(chrono::Utc::now() - chrono::Duration::minutes(20));
    write_job_row(&home, &job);

    let manager =
        manager_for(&home, 2, None).with_stale_output_timeout(Some(Duration::from_secs(1)));
    let report = manager
        .run_maintenance_pass_with(&never_called_resolver)
        .await;

    assert_eq!(report.reaped_jobs, vec!["00001".to_string()]);
    let reaped = manager.get_job("00001").await.unwrap().unwrap();
    assert_eq!(reaped.status, JobStatus::Stopped);
    assert!(
        reaped
            .status_message
            .as_deref()
            .unwrap()
            .contains("stuck job check"),
        "{:?}",
        reaped.status_message
    );
    assert_eq!(
        plan_state(&folder),
        "Draft",
        "reaping goes through the normal cancel path, so the plan is reverted"
    );
}

/// A `Running` job that is still reporting is left alone, grace included.
#[tokio::test]
async fn maintenance_leaves_a_recently_active_running_job_alone() {
    let home = HomeFixture::new("queue-maint-live");
    let folder = home.write_plan("00001-Live", &plan_with(PlanStatus::Executing, &[]));

    // Long-running, but it reported a moment ago, so only the hard cap could touch it — and it is
    // nowhere near that either.
    let mut job = job_in("00001", &folder, "ExecutePlan", JobStatus::Running);
    job.started_at = Some(chrono::Utc::now() - chrono::Duration::minutes(30));
    job.last_output_at = Some(chrono::Utc::now());
    write_job_row(&home, &job);

    let manager = manager_for(&home, 2, None)
        .with_stale_output_timeout(Some(Duration::from_secs(1)))
        .with_job_timeout(Some(Duration::from_secs(60 * 60)));
    let report = manager
        .run_maintenance_pass_with(&never_called_resolver)
        .await;

    assert!(report.reaped_jobs.is_empty(), "{:?}", report.reaped_jobs);
    assert_eq!(plan_state(&folder), "Executing");
}

/// Eviction bounds memory only: the oldest terminal jobs beyond the keep-window are dropped, and the
/// keep-window survives however old it is.
#[test]
fn eviction_drops_the_oldest_terminal_jobs_beyond_the_keep_window() {
    let now = chrono::Utc::now();
    let jobs: Vec<JobItem> = (1..=25)
        .map(|i| {
            let mut job = JobItem::new(
                format!("{:05}", i),
                "ExecutePlan".to_string(),
                String::new(),
                "P".to_string(),
            );
            job.status = JobStatus::Completed;
            // Two hours ago, staggered so "newest" is unambiguous. Every one is past the hour.
            job.completed_at =
                Some(now - chrono::Duration::hours(2) + chrono::Duration::minutes(i));
            job
        })
        .collect();

    let evicted = stale_eviction_candidates(&jobs, now, Duration::from_secs(3600), 20);
    assert_eq!(
        evicted,
        vec!["00001", "00002", "00003", "00004", "00005"],
        "only the five oldest, and only because the twenty newest are kept"
    );

    let recent: Vec<JobItem> = jobs
        .iter()
        .cloned()
        .map(|mut j| {
            j.completed_at = Some(now);
            j
        })
        .collect();
    assert!(
        stale_eviction_candidates(&recent, now, Duration::from_secs(3600), 20).is_empty(),
        "nothing finished within the age window may be evicted"
    );

    let mut running = jobs.clone();
    for job in &mut running {
        job.status = JobStatus::Running;
    }
    assert!(
        stale_eviction_candidates(&running, now, Duration::from_secs(3600), 0).is_empty(),
        "a job that has not finished is never evicted"
    );
}

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------

/// `stop-all` reaches the queued jobs too, and freeing a slot must not promote one of them.
#[cfg(unix)]
#[tokio::test]
async fn stop_all_stops_the_running_job_and_every_queued_one() {
    let home = HomeFixture::new("queue-stop-all");
    home.write_promptware("ExecutePlan");
    let folders: Vec<PathBuf> = (1..=3)
        .map(|i| {
            home.write_plan(
                &format!("{:05}-Job{}", i, i),
                &plan_with(PlanStatus::Draft, &[]),
            )
        })
        .collect();
    let script = write_script(&home, "agent.sh", "echo working\nsleep 30\n");

    // One slot: one job runs, two queue.
    let manager = manager_for(&home, 1, Some(script));
    let mut ids = Vec::new();
    for folder in &folders {
        ids.push(manager.start_job(execute(folder)).await.unwrap());
    }
    wait_for_status(
        &manager,
        &ids[0],
        JobStatus::Running,
        Duration::from_secs(15),
    )
    .await;
    assert_eq!(manager.queue_order().await.len(), 2);

    let mut stopped = manager.stop_all_jobs().await.unwrap();
    stopped.sort();
    let mut expected = ids.clone();
    expected.sort();
    assert_eq!(stopped, expected);

    assert!(manager.queue_order().await.is_empty());
    for id in &ids {
        assert_eq!(status_of(&manager, id).await, JobStatus::Stopped);
    }

    // And no queued job sneaks in on the slot the sweep freed.
    tokio::time::sleep(Duration::from_millis(500)).await;
    for id in &ids {
        assert_eq!(status_of(&manager, id).await, JobStatus::Stopped);
    }
    for folder in &folders {
        assert_eq!(plan_state(folder), "Draft");
    }
}

/// `stop-all` overlaps the kill grace periods instead of summing them.
///
/// `cancel_job` pays `DEFAULT_KILL_GRACE` (3s of SIGTERM-then-poll in `kill_tree`) for every agent
/// that does not die on SIGTERM, and awaiting the cancellations one at a time made that cost
/// linear: "Stop All" on 15 running jobs took ~45s in the UI. These five agents all ignore SIGTERM,
/// so each one costs the full grace -- serially that is 15s, concurrently ~3s. The bound below sits
/// between the two with room on both sides rather than near either, so it fails on a regression to
/// sequential cancellation and not on a slow machine.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stop_all_overlaps_the_kill_grace_periods_instead_of_summing_them() {
    const JOBS: usize = 5;
    // Serial would be JOBS * 3s = 15s; concurrent is one grace, ~3s.
    const BOUND: Duration = Duration::from_secs(9);

    let home = HomeFixture::new("queue-stop-all-concurrent");
    home.write_promptware("ExecutePlan");
    let folders: Vec<PathBuf> = (1..=JOBS)
        .map(|i| {
            home.write_plan(
                &format!("{:05}-Job{}", i, i),
                &plan_with(PlanStatus::Draft, &[]),
            )
        })
        .collect();

    // `trap '' TERM` is the whole point: an agent that ignores SIGTERM is what makes `kill_tree`
    // spend its full grace before escalating to SIGKILL. The inner sleeps are short so the shell
    // keeps looping rather than sitting in one uninterruptible wait.
    let script = write_script(
        &home,
        "stubborn.sh",
        "trap '' TERM\necho working\nwhile true; do sleep 0.2; done\n",
    );

    // Every job has to be Running: only a live PID reaches `kill_tree` at all.
    let manager = manager_for(&home, JOBS as i32, Some(script));
    let mut ids = Vec::new();
    for folder in &folders {
        ids.push(manager.start_job(execute(folder)).await.unwrap());
    }
    for id in &ids {
        wait_for_status(&manager, id, JobStatus::Running, Duration::from_secs(30)).await;
    }

    let started = std::time::Instant::now();
    let mut stopped = manager.stop_all_jobs().await.unwrap();
    let elapsed = started.elapsed();

    stopped.sort();
    let mut expected = ids.clone();
    expected.sort();
    assert_eq!(stopped, expected, "every running job must be reported");
    for id in &ids {
        assert_eq!(status_of(&manager, id).await, JobStatus::Stopped);
    }

    assert!(
        elapsed < BOUND,
        "stop-all of {} SIGTERM-ignoring jobs took {:?}; the kill graces are being summed rather \
         than overlapped",
        JOBS,
        elapsed
    );
}

/// A `CreatePlan` stopped between `plan create` and `plan write-revision` leaves a plan that says so,
/// and a job that names it.
///
/// This is the corruption the stop-all sweep was actually causing, reproduced from the two real cases:
/// plans 00003 and 00004 sit on the operator's disk as folders whose `Revisions/` is empty, and jobs
/// 00010 and 00013 -- both `Stopped by stop-all` -- carry an empty `PlanFile` and no `ReportedPlanId`,
/// so nothing on either side points at the other. A `CreatePlan` builds its deliverable in two steps
/// and a stop lands between them, and `finish_job`, which is what normally records the folder and
/// disposes of an empty one, is never reached on a cancellation.
///
/// Both halves are asserted because either alone still leaves the operator stuck: a plan marked
/// `Failed` that no job admits to, or a job pointing at a folder that still reads as a `Draft` waiting
/// to be executed. Nothing here is timing-dependent -- the fixture is the post-`plan create` state on
/// disk, written directly -- so this fails on a regression rather than on a slow machine.
#[tokio::test]
async fn stopping_a_create_plan_before_its_revision_marks_the_plan_and_names_the_job() {
    let home = HomeFixture::new("queue-stop-all-plan-husk");

    // Exactly what `tendril plan create` leaves behind: folder, plan.yaml in Draft, empty Revisions/.
    let folder = home.write_plan("00003-HuskPlan", &plan_with(PlanStatus::Draft, &[]));
    std::fs::create_dir_all(folder.join("Revisions")).expect("create empty Revisions dir");

    // The only surviving link between job and plan on a cancelled run: the `PlanId:` marker the
    // `plan create` tool call printed into the run's own log.
    std::fs::write(
        home.path.join("Logs").join("Jobs").join("00010.raw.jsonl"),
        "{\"type\":\"tool_result\",\"content\":\"Created plan. PlanId: 00003\"}\n",
    )
    .expect("write raw log");

    // `Running` with no PID and no handle: the job as the daemon sees it when the sweep arrives, and
    // the shape that takes `cancel_job` straight past the kill to the bookkeeping under test.
    let mut job = job_in(
        "00010",
        std::path::Path::new(""),
        "CreatePlan",
        JobStatus::Running,
    );
    job.plan_file = String::new();
    job.completed_at = None;
    write_job_row(&home, &job);

    let manager = manager_for(&home, 2, None);
    assert!(manager
        .cancel_job("00010", Some("Stopped by stop-all"))
        .await
        .unwrap());

    let stored = manager.get_job("00010").await.unwrap().expect("job row");
    assert_eq!(stored.status, JobStatus::Stopped);
    assert_eq!(
        std::path::PathBuf::from(&stored.plan_file),
        folder,
        "a stopped CreatePlan must record the folder it had already made"
    );
    assert_eq!(
        stored.reported_plan_id.as_deref(),
        Some("00003"),
        "the plan id must survive on the job row, not only in the log"
    );

    assert_eq!(
        plan_state(&folder),
        PlanStatus::Failed.to_string(),
        "a plan whose only writer was killed before it wrote a revision must not sit in Drafts \
         looking like work that is merely unread"
    );
    assert!(
        folder.is_dir(),
        "the folder must survive: a stop is not a delete, and attachments or a half-written \
         plan.yaml may be in there"
    );
}

/// Force-starting a blocked job runs it under its original id, gates skipped.
#[cfg(unix)]
#[tokio::test]
async fn force_start_promotes_a_blocked_job_and_keeps_its_id() {
    let home = HomeFixture::new("queue-force-start");
    home.write_promptware("ExecutePlan");
    let mut plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    plan.depends_on = vec!["00099-DoesNotExist".to_string()];
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Blocked", &plan);
    let script = write_script(&home, "agent.sh", "echo working\nexit 0\n");

    let manager = manager_for(&home, 2, Some(script));
    let job_id = manager.start_job(execute(&folder)).await.unwrap();
    assert_eq!(status_of(&manager, &job_id).await, JobStatus::Blocked);

    manager.force_start_job(&job_id).await.unwrap();
    assert_eq!(
        wait_for_terminal(&manager, &job_id, Duration::from_secs(20)).await,
        JobStatus::Completed
    );

    let err = manager
        .force_start_job(&job_id)
        .await
        .expect_err("a finished job cannot be force-started");
    assert!(err.to_string().contains("Completed"), "{}", err);
    assert!(manager.force_start_job("99999").await.is_err());
}

/// Deleting a job reverts its plan through the guarded path, so a terminal plan is left alone.
#[tokio::test]
async fn delete_job_reverts_a_live_plan_but_not_a_terminal_one() {
    let home = HomeFixture::new("queue-delete");
    let live = home.write_plan("00001-Live", &plan_with(PlanStatus::Executing, &[]));
    let done = home.write_plan(
        "00002-Done",
        &plan_with(
            PlanStatus::Completed,
            &[("Build", VerificationStatus::Pass)],
        ),
    );

    write_terminal_job(&home, "00001", &live, JobStatus::Failed);
    write_terminal_job(&home, "00002", &done, JobStatus::Completed);

    let manager = manager_for(&home, 2, None);

    assert!(manager.delete_job("00001").await.unwrap());
    assert_eq!(plan_state(&live), "Draft");
    assert!(manager.get_job("00001").await.unwrap().is_none());

    assert!(manager.delete_job("00002").await.unwrap());
    assert_eq!(
        plan_state(&done),
        "Completed",
        "a completed plan is immutable, even when its job is deleted"
    );

    assert!(
        !manager.delete_job("00001").await.unwrap(),
        "deleting a job twice is not an error, it just does nothing"
    );
}

/// `clear all` removes the history and leaves both terminal plans and pending work untouched.
#[tokio::test]
async fn clear_all_removes_terminal_jobs_and_leaves_plan_state_alone() {
    let home = HomeFixture::new("queue-clear-all");
    let completed_plan = home.write_plan(
        "00001-Done",
        &plan_with(
            PlanStatus::Completed,
            &[("Build", VerificationStatus::Pass)],
        ),
    );
    let skipped_plan = home.write_plan("00002-Skipped", &plan_with(PlanStatus::Skipped, &[]));
    let review_plan = home.write_plan("00003-Review", &plan_with(PlanStatus::Review, &[]));

    write_terminal_job(&home, "00001", &completed_plan, JobStatus::Completed);
    write_terminal_job(&home, "00002", &skipped_plan, JobStatus::Failed);
    write_terminal_job(&home, "00003", &review_plan, JobStatus::Timeout);

    let manager = manager_for(&home, 2, None);
    assert_eq!(manager.clear_all_jobs().await.unwrap(), 3);

    assert_eq!(plan_state(&completed_plan), "Completed");
    assert_eq!(plan_state(&skipped_plan), "Skipped");
    assert_eq!(
        plan_state(&review_plan),
        "Review",
        "Review must not be pushed back to Draft"
    );
    assert!(manager.list_jobs(None, 100).await.unwrap().is_empty());
}

/// The targeted variants clear only their own status.
#[tokio::test]
async fn clear_completed_and_clear_failed_only_touch_their_own_status() {
    let home = HomeFixture::new("queue-clear-scoped");
    let folder = home.write_plan("00001-Plan", &plan_with(PlanStatus::Draft, &[]));
    write_terminal_job(&home, "00001", &folder, JobStatus::Completed);
    write_terminal_job(&home, "00002", &folder, JobStatus::Failed);
    write_terminal_job(&home, "00003", &folder, JobStatus::Timeout);

    let manager = manager_for(&home, 2, None);

    assert_eq!(manager.clear_completed_jobs().await.unwrap(), 1);
    assert!(manager.get_job("00001").await.unwrap().is_none());
    assert!(manager.get_job("00002").await.unwrap().is_some());

    assert_eq!(manager.clear_failed_jobs().await.unwrap(), 1);
    assert!(manager.get_job("00002").await.unwrap().is_none());
    assert!(
        manager.get_job("00003").await.unwrap().is_some(),
        "a timed-out job is not a failed one"
    );
}

/// A `Blocked` job is pending work, not history, so bulk clearing leaves it in place.
#[tokio::test]
async fn clear_all_leaves_a_blocked_job_in_place() {
    let home = HomeFixture::new("queue-clear-blocked");
    let folder = home.write_plan("00001-Plan", &plan_with(PlanStatus::Blocked, &[]));
    write_terminal_job(&home, "00001", &folder, JobStatus::Blocked);
    write_terminal_job(&home, "00002", &folder, JobStatus::Completed);

    let manager = manager_for(&home, 2, None);
    assert_eq!(manager.clear_all_jobs().await.unwrap(), 1);
    assert!(manager.get_job("00001").await.unwrap().is_some());
    assert!(manager.get_job("00002").await.unwrap().is_none());
}

/// The safety property of every bulk clear: it removes finished work and nothing else.
///
/// Enforced in [`JobManager::clear_jobs`] rather than at its callers, so the CLI's `tendril job clear`,
/// the app's header menu and whatever asks next all inherit it. Asking for `Running` explicitly is the
/// test worth having — the exposed scopes cannot express it today, and the point is that they could not
/// do damage even if one did.
#[tokio::test]
async fn a_clear_never_touches_a_running_or_queued_job_however_it_is_asked() {
    let home = HomeFixture::new("queue-clear-safety");
    let folder = home.write_plan("00001-Plan", &plan_with(PlanStatus::Executing, &[]));

    write_job_row(
        &home,
        &job_in("00001", &folder, "ExecutePlan", JobStatus::Running),
    );
    write_job_row(
        &home,
        &job_in("00002", &folder, "ExecutePlan", JobStatus::Queued),
    );
    write_job_row(
        &home,
        &job_in("00003", &folder, "ExecutePlan", JobStatus::Pending),
    );
    // History, and on a plan of its own: deleting a job reverts the plan it was mid-flight on, so
    // sharing a folder would make the plan assertion below a statement about `delete_job` instead.
    let history = home.write_plan("00009-Done", &plan_with(PlanStatus::Completed, &[]));
    write_terminal_job(&home, "00004", &history, JobStatus::Completed);

    let manager = manager_for(&home, 2, None);

    // Named directly, and refused.
    for status in [JobStatus::Running, JobStatus::Queued, JobStatus::Pending] {
        assert_eq!(
            manager.clear_jobs(&[status]).await.unwrap(),
            0,
            "clearing {status} must remove nothing"
        );
    }
    // And mixed in with a status that *is* clearable, the clearable one still goes and the others stay.
    assert_eq!(
        manager
            .clear_jobs(&[JobStatus::Running, JobStatus::Completed, JobStatus::Queued])
            .await
            .unwrap(),
        1
    );

    for surviving in ["00001", "00002", "00003"] {
        assert!(
            manager.get_job(surviving).await.unwrap().is_some(),
            "{surviving} is work in flight, not history"
        );
    }
    assert!(manager.get_job("00004").await.unwrap().is_none());
    // The plan its running job owns is untouched too — nothing went through the cancel path.
    assert_eq!(plan_state(&folder), "Executing");
}

/// An empty scope clears nothing, rather than falling through to an `IN ()` predicate.
#[tokio::test]
async fn an_empty_clear_scope_removes_nothing() {
    let home = HomeFixture::new("queue-clear-empty");
    let folder = home.write_plan("00001-Plan", &plan_with(PlanStatus::Draft, &[]));
    write_terminal_job(&home, "00001", &folder, JobStatus::Completed);

    let manager = manager_for(&home, 2, None);
    assert_eq!(manager.clear_jobs(&[]).await.unwrap(), 0);
    assert!(manager.get_job("00001").await.unwrap().is_some());
}

/// Every terminal status is clearable on its own, which is what lets the app offer one menu item per
/// status instead of V1's two. `CLEARABLE_STATUSES` is the list, and it is the same list `clear all`
/// sweeps.
#[tokio::test]
async fn each_terminal_status_can_be_cleared_on_its_own() {
    let home = HomeFixture::new("queue-clear-per-status");
    let folder = home.write_plan("00001-Plan", &plan_with(PlanStatus::Draft, &[]));

    let ids = ["00001", "00002", "00003", "00004"];
    for (id, status) in ids.iter().zip(CLEARABLE_STATUSES) {
        write_terminal_job(&home, id, &folder, *status);
    }

    let manager = manager_for(&home, 2, None);
    for (index, status) in CLEARABLE_STATUSES.iter().enumerate() {
        assert_eq!(
            manager.clear_jobs(&[*status]).await.unwrap(),
            1,
            "clearing {status} takes exactly its own row"
        );
        assert!(manager.get_job(ids[index]).await.unwrap().is_none());
        // ...and leaves every status it was not asked about.
        for later in &ids[index + 1..] {
            assert!(manager.get_job(later).await.unwrap().is_some());
        }
    }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/// The three new columns survive a round trip, and a deleted row is really gone.
#[test]
fn priority_last_output_and_wait_for_ids_survive_a_round_trip() {
    let home = HomeFixture::new("queue-db-roundtrip");
    let conn = open_database(&get_database_path(&home.path)).expect("open db");

    let mut job = JobItem::new(
        "00042".to_string(),
        "ExecutePlan".to_string(),
        "/plans/00001-Plan".to_string(),
        "FixtureProject".to_string(),
    );
    job.status = JobStatus::Queued;
    job.priority = 7;
    job.last_output_at = Some(chrono::Utc::now());
    job.wait_for_job_ids = vec!["00009".to_string(), "00010".to_string()];
    insert_job(&conn, &job).expect("insert");

    let read = get_job_row(&conn, "00042").expect("read").expect("row");
    assert_eq!(read.priority, 7);
    assert_eq!(
        read.last_output_at.map(|t| t.timestamp_millis()),
        job.last_output_at.map(|t| t.timestamp_millis())
    );
    assert_eq!(read.wait_for_job_ids, vec!["00009", "00010"]);

    assert_eq!(
        list_job_ids_by_status(&conn, &[JobStatus::Queued]).unwrap(),
        vec!["00042".to_string()]
    );
    assert!(list_job_ids_by_status(&conn, &[JobStatus::Completed])
        .unwrap()
        .is_empty());

    assert!(tendril_core::db::jobs::delete_job(&conn, "00042").unwrap());
    assert!(get_job_row(&conn, "00042").unwrap().is_none());
    assert!(
        !tendril_core::db::jobs::delete_job(&conn, "00042").unwrap(),
        "deleting a row that is already gone reports no deletion"
    );
}

/// A job with no output yet anchors the round trip on `started_at`, and defaults stay defaults.
#[test]
fn a_fresh_job_row_defaults_to_priority_zero_and_no_wait_dependencies() {
    let home = HomeFixture::new("queue-db-defaults");
    let conn = open_database(&get_database_path(&home.path)).expect("open db");

    let mut job = JobItem::new(
        "00001".to_string(),
        "CreatePr".to_string(),
        String::new(),
        "FixtureProject".to_string(),
    );
    job.status = JobStatus::Pending;
    insert_job(&conn, &job).expect("insert");

    let read = get_job_row(&conn, "00001").unwrap().unwrap();
    assert_eq!(read.priority, 0);
    assert!(read.last_output_at.is_none());
    assert!(read.wait_for_job_ids.is_empty());
}
