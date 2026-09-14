mod common;

use common::{plan_state, plan_with, HomeFixture};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tendril_core::agents::providers::AgentProcessSpec;
use tendril_core::config::TendrilSettings;
use tendril_core::jobs::hooks::{HookCommandResult, HookCommandSpec, HookExecutor, HookFuture};
use tendril_core::jobs::manager::{JobManager, SpecBuilder};
use tendril_core::models::{
    ExecutePlanArgs, JobArgs, JobStatus, PlanStatus, ProjectConfig, PromptwareHookConfig,
    RetryPlanArgs, VerificationStatus,
};

/// Settings that keep a test job on a short leash and out of the operator's config.
fn settings() -> TendrilSettings {
    TendrilSettings {
        max_concurrent_jobs: 2,
        ..Default::default()
    }
}

/// A spec builder that runs a throwaway shell script instead of a real agent CLI.
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

/// A spec builder that fails the test if the launch path ever reaches it.
fn panicking_spec_builder() -> SpecBuilder {
    Arc::new(|_provider, _config| panic!("no agent process may be spawned for this job"))
}

#[cfg(unix)]
fn write_script(home: &HomeFixture, name: &str, body: &str) -> PathBuf {
    let path = home.path.join(name);
    std::fs::write(&path, body).expect("write script");
    path
}

/// Polls until `predicate` holds or the deadline passes; returns whether it held.
async fn wait_until<F>(timeout: Duration, mut predicate: F) -> bool
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
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn wait_for_status(manager: &JobManager, id: &str, timeout: Duration) -> JobStatus {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let job = manager
            .get_job(id)
            .await
            .unwrap()
            .expect("job should exist");
        if matches!(
            job.status,
            JobStatus::Completed
                | JobStatus::Failed
                | JobStatus::Timeout
                | JobStatus::Stopped
                | JobStatus::Blocked
        ) {
            return job.status;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "job {} never reached a terminal status (last: {})",
            id,
            job.status
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// (1) A plan whose dependencies are unsatisfied is recorded `Blocked` and nothing is spawned.
#[tokio::test]
async fn a_blocked_execute_plan_records_blocked_and_spawns_nothing() {
    let home = HomeFixture::new("life-blocked");
    home.write_promptware("ExecutePlan");
    home.write_plan("00002-Upstream", &plan_with(PlanStatus::Draft, &[]));

    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.depends_on = vec!["00002-Upstream".to_string()];
    let folder = home.write_plan("00001-Dependent", &plan);

    let manager =
        JobManager::new(home.path.clone(), settings()).with_spec_builder(panicking_spec_builder());

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .expect("start_job should succeed even when the plan is blocked");

    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(job.status, JobStatus::Blocked);
    assert!(
        job.status_message
            .as_deref()
            .unwrap()
            .contains("00002-Upstream"),
        "{:?}",
        job.status_message
    );
    assert_eq!(plan_state(&folder), "Blocked");

    // Give a stray runner task a chance to reach the panicking spec builder.
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        manager.get_job(&job_id).await.unwrap().unwrap().status,
        JobStatus::Blocked
    );
}

/// (2) A clean agent exit is not enough: a `Pending` verification row fails both the plan and the
/// job that left it behind.
#[cfg(unix)]
#[tokio::test]
async fn a_successful_run_with_a_pending_verification_ends_failed() {
    let home = HomeFixture::new("life-pending");
    home.write_promptware("ExecutePlan");
    // A recorded commit, so the unsettled verification row is the only shortfall in play.
    let mut plan = plan_with(
        PlanStatus::Draft,
        &[
            ("Build", VerificationStatus::Pass),
            ("Test", VerificationStatus::Pending),
        ],
    );
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Pending", &plan);
    let script = write_script(&home, "agent.sh", "echo working\nexit 0\n");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    assert_eq!(
        wait_for_status(&manager, &job_id, Duration::from_secs(15)).await,
        JobStatus::Failed,
        "the agent exited 0, but leaving a verification Pending is not a delivered plan"
    );
    assert_eq!(
        plan_state(&folder),
        "Failed",
        "an incomplete verification must not reach Review"
    );
}

/// (3) The same run reaches `Review` once every row has passed and a commit is recorded.
#[cfg(unix)]
#[tokio::test]
async fn a_successful_run_with_all_verifications_passing_reaches_review() {
    let home = HomeFixture::new("life-review");
    home.write_promptware("ExecutePlan");
    // Passing rows alone are not a deliverable: an ExecutePlan run also has to have committed
    // something.
    let mut plan = plan_with(
        PlanStatus::Draft,
        &[
            ("Build", VerificationStatus::Pass),
            ("Test", VerificationStatus::Pass),
        ],
    );
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Passing", &plan);
    let script = write_script(&home, "agent.sh", "echo working\nexit 0\n");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    assert_eq!(
        wait_for_status(&manager, &job_id, Duration::from_secs(15)).await,
        JobStatus::Completed
    );
    assert_eq!(plan_state(&folder), "Review");

    // The compiled prompt is kept so a completed or killed run can be inspected.
    assert!(home
        .path
        .join("Logs")
        .join("Jobs")
        .join(format!("{}.prompt.md", job_id))
        .exists());
}

/// A non-zero exit fails the job and puts the plan back where it started.
#[cfg(unix)]
#[tokio::test]
async fn a_failing_agent_reverts_the_plan_to_its_previous_state() {
    let home = HomeFixture::new("life-agent-fail");
    home.write_promptware("RetryPlan");
    let folder = home.write_plan(
        "00001-Retry",
        &plan_with(PlanStatus::Review, &[("Build", VerificationStatus::Pass)]),
    );
    let script = write_script(&home, "agent.sh", "echo giving up >&2\nexit 3\n");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));

    let job_id = manager
        .start_job(JobArgs::RetryPlan(RetryPlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            change_request: "try again".to_string(),
        }))
        .await
        .unwrap();

    assert_eq!(
        wait_for_status(&manager, &job_id, Duration::from_secs(15)).await,
        JobStatus::Failed
    );
    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    assert!(
        job.status_message.as_deref().unwrap().contains("code 3"),
        "{:?}",
        job.status_message
    );
    assert_eq!(
        plan_state(&folder),
        "Review",
        "the plan should be back at its pre-job state"
    );
}

/// (4) A missing promptware folder fails the job with a message naming the path.
#[tokio::test]
async fn a_missing_promptware_folder_fails_the_job_instead_of_launching() {
    let home = HomeFixture::new("life-no-promptware");
    // Deliberately no Promptwares/ExecutePlan.
    let folder = home.write_plan("00001-NoPromptware", &plan_with(PlanStatus::Draft, &[]));

    let manager =
        JobManager::new(home.path.clone(), settings()).with_spec_builder(panicking_spec_builder());

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    assert_eq!(
        wait_for_status(&manager, &job_id, Duration::from_secs(15)).await,
        JobStatus::Failed
    );
    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    let msg = job.status_message.unwrap();
    assert!(msg.contains("Promptware folder not found"), "{}", msg);
    assert!(
        msg.contains(
            &home
                .path
                .join("Promptwares")
                .join("ExecutePlan")
                .display()
                .to_string()
        ),
        "{}",
        msg
    );
    assert_eq!(plan_state(&folder), "Draft");
}

/// (5) Cancellation kills the agent's grandchildren too, not just the process Tendril spawned.
#[cfg(unix)]
#[tokio::test]
async fn cancelling_a_job_kills_the_whole_process_tree() {
    let home = HomeFixture::new("life-cancel-tree");
    home.write_promptware("ExecutePlan");
    let folder = home.write_plan("00001-Cancel", &plan_with(PlanStatus::Draft, &[]));

    let heartbeat = home.path.join("heartbeat.txt");
    let grandchild_pid_file = home.path.join("grandchild.pid");
    let script = write_script(
        &home,
        "agent.sh",
        &format!(
            r#"
# A grandchild that outlives a naive kill of its parent.
(
  echo $$ > {pid_file}
  while true; do
    echo tick >> {heartbeat}
    sleep 0.1
  done
) &
echo spawned grandchild
wait
"#,
            pid_file = grandchild_pid_file.display(),
            heartbeat = heartbeat.display()
        ),
    );

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    // Wait until the grandchild is genuinely running and writing.
    let hb = heartbeat.clone();
    assert!(
        wait_until(Duration::from_secs(10), || hb.exists()
            && std::fs::metadata(&hb).map(|m| m.len()).unwrap_or(0) > 0)
        .await,
        "the fake agent never started its grandchild"
    );
    let agent_pid = manager
        .get_job(&job_id)
        .await
        .unwrap()
        .unwrap()
        .process_id
        .expect("the agent PID should be recorded as soon as it spawns");
    let grandchild_pid: u32 = std::fs::read_to_string(&grandchild_pid_file)
        .expect("grandchild pid file")
        .trim()
        .parse()
        .expect("grandchild pid");

    assert!(manager
        .cancel_job(&job_id, Some("Cancelled by test"))
        .await
        .unwrap());

    let both_gone = wait_until(Duration::from_secs(10), || {
        !tendril_core::config::is_process_running(agent_pid)
            && !tendril_core::config::is_process_running(grandchild_pid)
    })
    .await;
    assert!(
        both_gone,
        "agent {} and/or grandchild {} survived cancellation",
        agent_pid, grandchild_pid
    );

    // And the grandchild really stopped writing, rather than merely being unreapable.
    let size_after_kill = std::fs::metadata(&heartbeat).unwrap().len();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(
        std::fs::metadata(&heartbeat).unwrap().len(),
        size_after_kill,
        "the grandchild is still writing after cancellation"
    );

    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(job.status, JobStatus::Stopped);
    assert_eq!(plan_state(&folder), "Draft");
}

/// (6) A completion that lands just after a cancel must not overwrite the cancelled state.
#[cfg(unix)]
#[tokio::test]
async fn a_completion_arriving_after_a_cancel_does_not_reach_review() {
    let home = HomeFixture::new("life-cancel-race");
    home.write_promptware("ExecutePlan");
    let folder = home.write_plan(
        "00001-Race",
        &plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]),
    );
    // The agent exits successfully very shortly after it starts, so the cancel and the exit race.
    let script = write_script(&home, "agent.sh", "sleep 0.2\nexit 0\n");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    // Cancel while the agent is still inside its sleep, so its exit lands moments later.
    let spawned = {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let job = manager.get_job(&job_id).await.unwrap().unwrap();
            if job.process_id.is_some() {
                break true;
            }
            if std::time::Instant::now() >= deadline {
                break false;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    };
    assert!(spawned, "the fake agent never spawned");
    assert!(manager.cancel_job(&job_id, None).await.unwrap());

    // Let the agent's own exit path run to completion.
    tokio::time::sleep(Duration::from_millis(600)).await;

    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    assert_eq!(
        job.status,
        JobStatus::Stopped,
        "the cancellation must win the race"
    );
    assert_eq!(
        plan_state(&folder),
        "Draft",
        "a cancelled job must not flip the plan to Review"
    );
}

/// (7) A job cancelled before it gets a concurrency permit never spawns anything.
#[cfg(unix)]
#[tokio::test]
async fn a_queued_job_cancelled_before_its_permit_never_spawns() {
    let home = HomeFixture::new("life-queued-cancel");
    home.write_promptware("ExecutePlan");
    let blocker_folder = home.write_plan("00001-Blocker", &plan_with(PlanStatus::Draft, &[]));
    let queued_folder = home.write_plan("00002-Queued", &plan_with(PlanStatus::Draft, &[]));

    let long_running = write_script(&home, "long.sh", "sleep 30\n");
    let spawn_marker = home.path.join("second-job-spawned");

    // One permit, so the second job cannot start until the first finishes. The builder records any
    // launch of the second script, which must never happen.
    let marker = spawn_marker.clone();
    let script = long_running.clone();
    let workdir = home.path.clone();
    let builder: SpecBuilder = Arc::new(move |_provider, config| {
        if config.prompt.contains("00002-Queued") {
            std::fs::write(&marker, "spawned").unwrap();
        }
        AgentProcessSpec {
            command: "/bin/sh".to_string(),
            args: vec![script.to_string_lossy().to_string()],
            environment: Default::default(),
            working_directory: workdir.clone(),
            stdin_content: None,
            redirect_stdin: false,
            temp_files: vec![],
        }
    });

    let manager = JobManager::new(
        home.path.clone(),
        TendrilSettings {
            max_concurrent_jobs: 1,
            ..Default::default()
        },
    )
    .with_spec_builder(builder);

    let first = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: blocker_folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();
    let second = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: queued_folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    // The second job is waiting on the permit. Cancel it there.
    assert!(manager
        .cancel_job(&second, Some("Cancelled while queued"))
        .await
        .unwrap());
    assert_eq!(
        manager.get_job(&second).await.unwrap().unwrap().status,
        JobStatus::Stopped
    );

    // Release the permit and give the queued runner every chance to spawn.
    assert!(manager.cancel_job(&first, None).await.unwrap());
    tokio::time::sleep(Duration::from_millis(500)).await;

    assert!(
        !spawn_marker.exists(),
        "a job cancelled while queued must never launch an agent"
    );
    assert_eq!(
        manager.get_job(&second).await.unwrap().unwrap().status,
        JobStatus::Stopped
    );
    assert_eq!(plan_state(&queued_folder), "Draft");
}

/// (8) A job that outruns its timeout is recorded `Timeout` and its process is killed.
#[cfg(unix)]
#[tokio::test]
async fn a_job_that_exceeds_its_timeout_is_killed_and_recorded_as_timeout() {
    let home = HomeFixture::new("life-timeout");
    home.write_promptware("ExecutePlan");
    let folder = home.write_plan(
        "00001-Timeout",
        &plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]),
    );
    let script = write_script(&home, "agent.sh", "sleep 60\n");

    // `jobTimeout` is expressed in whole minutes, so the override exists for exactly this case.
    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()))
        .with_job_timeout(Some(Duration::from_millis(500)));

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    assert_eq!(
        wait_for_status(&manager, &job_id, Duration::from_secs(20)).await,
        JobStatus::Timeout
    );

    let job = manager.get_job(&job_id).await.unwrap().unwrap();
    assert!(
        job.status_message.as_deref().unwrap().contains("timed out"),
        "{:?}",
        job.status_message
    );
    if let Some(pid) = job.process_id {
        assert!(
            wait_until(Duration::from_secs(5), || {
                !tendril_core::config::is_process_running(pid)
            })
            .await,
            "the timed-out agent {} is still running",
            pid
        );
    }
    assert_eq!(
        plan_state(&folder),
        "Draft",
        "a timed-out job must not leave the plan Executing"
    );
}

/// (5, Windows) The same guarantee via `taskkill /T`, which walks the tree rather than the group.
#[cfg(windows)]
#[tokio::test]
async fn cancelling_a_job_kills_the_whole_process_tree_on_windows() {
    let home = HomeFixture::new("life-cancel-tree-win");
    home.write_promptware("ExecutePlan");
    let folder = home.write_plan("00001-Cancel", &plan_with(PlanStatus::Draft, &[]));

    let marker = home.path.join("grandchild.txt");
    let script = home.path.join("agent.cmd");
    std::fs::write(
        &script,
        format!(
            "@echo off\r\nstart /b cmd /c \"for /l %%i in (1,0,2) do (echo tick >> {} & timeout /t 1 >nul)\"\r\ntimeout /t 60 >nul\r\n",
            marker.display()
        ),
    )
    .unwrap();

    let workdir = home.path.clone();
    let cmd_path = script.clone();
    let builder: SpecBuilder = Arc::new(move |_provider, _config| AgentProcessSpec {
        command: "cmd".to_string(),
        args: vec!["/c".to_string(), cmd_path.to_string_lossy().to_string()],
        environment: Default::default(),
        working_directory: workdir.clone(),
        stdin_content: None,
        redirect_stdin: false,
        temp_files: vec![],
    });

    let manager = JobManager::new(home.path.clone(), settings()).with_spec_builder(builder);

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    let m = marker.clone();
    assert!(
        wait_until(Duration::from_secs(15), || m.exists()).await,
        "the fake agent never started its grandchild"
    );
    let agent_pid = manager
        .get_job(&job_id)
        .await
        .unwrap()
        .unwrap()
        .process_id
        .expect("agent PID");

    assert!(manager.cancel_job(&job_id, None).await.unwrap());
    assert!(
        wait_until(Duration::from_secs(15), || {
            !tendril_core::config::is_process_running(agent_pid)
        })
        .await,
        "agent {} survived cancellation",
        agent_pid
    );

    let size_after_kill = std::fs::metadata(&marker).unwrap().len();
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(
        std::fs::metadata(&marker).unwrap().len(),
        size_after_kill,
        "the grandchild is still writing after cancellation"
    );
    assert_eq!(
        manager.get_job(&job_id).await.unwrap().unwrap().status,
        JobStatus::Stopped
    );
}

/// Concurrent starts must not hand out the same job ID.
#[tokio::test]
async fn concurrent_starts_allocate_distinct_job_ids() {
    let home = HomeFixture::new("life-ids");
    // No promptware folder: every job fails immediately, which is all this test needs.
    let manager = Arc::new(
        JobManager::new(home.path.clone(), settings()).with_spec_builder(panicking_spec_builder()),
    );

    let mut tasks = Vec::new();
    for i in 0..8 {
        let manager = manager.clone();
        let plan_dir = home.plans_dir().join(format!("0000{}-Plan", i));
        tasks.push(tokio::spawn(async move {
            manager
                .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
                    folder_path: plan_dir.to_string_lossy().to_string(),
                    note: None,
                }))
                .await
                .unwrap()
        }));
    }

    let mut ids = Vec::new();
    for task in tasks {
        ids.push(task.await.unwrap());
    }
    let unique: std::collections::HashSet<_> = ids.iter().collect();
    assert_eq!(
        unique.len(),
        ids.len(),
        "duplicate job IDs allocated: {:?}",
        ids
    );
}

/// Cancelling something that does not exist, or that already finished, reports `false`.
#[tokio::test]
async fn cancelling_an_unknown_or_finished_job_reports_false() {
    let home = HomeFixture::new("life-cancel-unknown");
    let manager = JobManager::new(home.path.clone(), settings());

    assert!(!manager.cancel_job("99999", None).await.unwrap());

    let folder = home.write_plan("00001-Plan", &plan_with(PlanStatus::Draft, &[]));
    let manager = manager.with_spec_builder(panicking_spec_builder());
    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    // No promptware folder, so the job fails on its own before any cancel arrives.
    assert_eq!(
        wait_for_status(&manager, &job_id, Duration::from_secs(15)).await,
        JobStatus::Failed
    );
    assert!(
        !manager.cancel_job(&job_id, None).await.unwrap(),
        "a finished job cannot be cancelled"
    );
    assert_eq!(
        manager.get_job(&job_id).await.unwrap().unwrap().status,
        JobStatus::Failed,
        "the terminal status must stand"
    );
}

/// Jobs survive a round trip through SQLite with their args, PID and captured plan state intact.
#[cfg(unix)]
#[tokio::test]
async fn a_finished_job_is_readable_from_the_database() {
    let home = HomeFixture::new("life-persist");
    home.write_promptware("ExecutePlan");
    // A recorded commit, so this test stays on its own subject: an ExecutePlan job that produced
    // nothing is failed by the deliverable check before it ever reaches SQLite as `Completed`.
    let mut plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00007-Persist", &plan);
    let script = write_script(&home, "agent.sh", "exit 0\n");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));
    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: Some("persist me".to_string()),
        }))
        .await
        .unwrap();
    assert_eq!(
        wait_for_status(&manager, &job_id, Duration::from_secs(15)).await,
        JobStatus::Completed
    );

    // A fresh manager over the same home reads only what SQLite holds.
    let reloaded = JobManager::new(home.path.clone(), settings());
    let job = reloaded.get_job(&job_id).await.unwrap().expect("job row");
    assert_eq!(job.status, JobStatus::Completed);
    assert_eq!(job.project, "FixtureProject");
    assert_eq!(job.previous_plan_state.as_deref(), Some("Draft"));
    assert!(
        job.process_id.is_some(),
        "the agent PID should be persisted"
    );
    match job.typed_args {
        Some(JobArgs::ExecutePlan(args)) => {
            assert_eq!(args.note.as_deref(), Some("persist me"));
            assert_eq!(Path::new(&args.folder_path), folder.as_path());
        }
        other => panic!("expected rehydrated ExecutePlan args, got {:?}", other),
    }

    let listed = reloaded
        .list_jobs(Some(JobStatus::Completed), 10)
        .await
        .unwrap();
    assert!(listed.iter().any(|j| j.id == job_id));
    assert!(
        reloaded.list_non_terminal_jobs().await.unwrap().is_empty(),
        "a completed job is not pending work"
    );
}

/// A project hook whose `action` is `command`, firing in `when` for every promptware.
#[cfg(unix)]
fn hook(name: &str, when: &str, command: &str) -> PromptwareHookConfig {
    PromptwareHookConfig {
        name: name.to_string(),
        when: when.to_string(),
        promptwares: vec![],
        condition: String::new(),
        action: command.to_string(),
    }
}

/// The job path fires a project's `before` hook before the agent runs and its `after` hook once the
/// terminal status is written — the whole point of the port, asserted end to end.
///
/// Nothing is spawned for the hooks themselves: the injected executor records each spec and reports
/// success, and whether the agent had already left its marker is how "before" and "after" are told
/// apart independently of the order they were recorded in.
#[cfg(unix)]
#[tokio::test]
async fn a_projects_hooks_fire_before_and_after_the_agent_run() {
    let home = HomeFixture::new("life-hooks");
    home.write_promptware("ExecutePlan");
    // A recorded commit keeps the run `Completed`: the after hook's whole job here is to report the
    // status `finish_job` settled on.
    let mut plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Hooked", &plan);

    let marker = home.path.join("agent.ran");
    let script = write_script(
        &home,
        "agent.sh",
        &format!("echo working\ntouch {}\nexit 0\n", marker.display()),
    );

    let mut settings = settings();
    settings.projects = vec![ProjectConfig {
        name: "FixtureProject".to_string(),
        hooks: vec![
            hook("notify-start", "before", "echo starting"),
            hook("notify-done", "after", "echo done"),
        ],
        ..Default::default()
    }];

    let recorded: Arc<Mutex<Vec<(HookCommandSpec, bool)>>> = Arc::new(Mutex::new(Vec::new()));
    let executor: HookExecutor = {
        let recorded = recorded.clone();
        let marker = marker.clone();
        Arc::new(move |spec: HookCommandSpec| {
            recorded.lock().unwrap().push((spec, marker.exists()));
            Box::pin(async move {
                HookCommandResult {
                    exit_code: Some(0),
                    ..Default::default()
                }
            }) as HookFuture
        })
    };

    let manager = JobManager::new(home.path.clone(), settings)
        .with_spec_builder(script_spec_builder(script, home.path.clone()))
        .with_hook_executor(executor);

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .unwrap();

    assert_eq!(
        wait_for_status(&manager, &job_id, Duration::from_secs(15)).await,
        JobStatus::Completed
    );
    // The after hook is awaited after the terminal status is persisted, so the status the test waited
    // for does not yet imply the hook has run.
    assert!(
        wait_until(Duration::from_secs(5), || recorded.lock().unwrap().len()
            >= 2)
        .await,
        "both hooks should have run, saw {:?}",
        recorded.lock().unwrap()
    );

    let recorded = recorded.lock().unwrap();
    assert_eq!(recorded.len(), 2, "{:?}", recorded);

    let (before, agent_had_run_before) = &recorded[0];
    assert_eq!(before.hook_name, "notify-start");
    assert_eq!(before.command, "echo starting");
    assert!(
        !agent_had_run_before,
        "the before hook ran after the agent did"
    );

    let (after, agent_had_run_after) = &recorded[1];
    assert_eq!(after.hook_name, "notify-done");
    assert_eq!(after.command, "echo done");
    assert!(
        agent_had_run_after,
        "the after hook ran before the agent did"
    );

    let env_of = |spec: &HookCommandSpec, key: &str| {
        spec.env
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_else(|| panic!("{} should be in the hook environment", key))
    };
    for spec in [before, after] {
        assert_eq!(env_of(spec, "TENDRIL_JOB_ID"), job_id);
        assert_eq!(env_of(spec, "TENDRIL_JOB_TYPE"), "ExecutePlan");
        assert_eq!(
            Path::new(&env_of(spec, "TENDRIL_PLAN_FOLDER")),
            folder.as_path()
        );
    }
    // The status is the live one, and the after hook sees what the job actually ended as.
    assert_eq!(env_of(before, "TENDRIL_JOB_STATUS"), "Running");
    assert_eq!(env_of(after, "TENDRIL_JOB_STATUS"), "Completed");
}
