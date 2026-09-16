//! The job engine's plan-state transitions have to reach SQLite, not just `plan.yaml`.
//!
//! `Plans.State` is what the plan list, the Kanban columns and every `?status=` filter read, and only
//! `sync_plan` writes it. The job engine used to write `plan.yaml` and stop, so a plan it moved stayed
//! at its old state in the list until something else rewrote it — and refetching did not help,
//! because the row itself was wrong. The watcher cannot cover the gap either: `write_plan_yaml` marks
//! the write as ours and the watcher skips self-writes.
//!
//! Every fixture here is a throwaway `TENDRIL_HOME` under the temp dir, and no test launches a real
//! agent: the "agent" is a shell script.

mod common;

use common::{plan_state, plan_with, HomeFixture};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tendril_core::agents::providers::AgentProcessSpec;
use tendril_core::config::TendrilSettings;
use tendril_core::db::{get_plan_by_id, open_database, sync_plan};
use tendril_core::jobs::manager::{JobManager, SpecBuilder};
use tendril_core::models::{ExecutePlanArgs, JobArgs, JobStatus, PlanStatus, VerificationStatus};
use tendril_core::plans::reader::read_plan_file;

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

/// Mirrors the plan as it is on disk *now*, so a test starts from a row that agrees with `plan.yaml`.
/// The bug then shows up as a row left behind, not as a row that never existed.
fn seed_row(home: &HomeFixture, folder: &Path) {
    let conn = open_database(&tendril_core::config::get_database_path(&home.path))
        .expect("open fixture database");
    let plan = read_plan_file(folder).expect("read seeded plan");
    sync_plan(&conn, &plan).expect("seed the Plans row");
}

/// `Plans.State` for plan 1, or `None` when there is no row.
fn row_state(home: &HomeFixture) -> Option<String> {
    let conn = open_database(&tendril_core::config::get_database_path(&home.path))
        .expect("open fixture database");
    get_plan_by_id(&conn, 1)
        .expect("query the Plans row")
        .map(|p| p.metadata.state.as_str().to_string())
}

/// Polls the row until it reads `expected`, so an assertion never races the write it is about.
async fn wait_for_row_state(home: &HomeFixture, expected: &str, timeout: Duration) -> String {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let state = row_state(home).unwrap_or_default();
        if state == expected || std::time::Instant::now() >= deadline {
            return state;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// The whole point of #144: both ends of a run — the plan being claimed and the plan being released
/// — have to land in the database.
#[cfg(unix)]
#[tokio::test]
async fn a_job_driven_plan_transition_reaches_the_plans_row() {
    let home = HomeFixture::new("plan-mirror-run");
    home.write_promptware("ExecutePlan");

    let mut plan = plan_with(
        PlanStatus::Draft,
        &[
            ("Build", VerificationStatus::Pass),
            ("Test", VerificationStatus::Pass),
        ],
    );
    plan.commits = vec!["abc1234".to_string()];
    let folder = home.write_plan("00001-Mirrored", &plan);
    seed_row(&home, &folder);
    assert_eq!(row_state(&home).as_deref(), Some("Draft"));

    // Slow enough that the in-flight state is observable, fast enough to keep the suite quick.
    let script = home.path.join("agent.sh");
    std::fs::write(&script, "echo working\nsleep 1\nexit 0\n").expect("write script");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .expect("start_job");

    // Claiming the plan is a transition like any other: the row must move with `plan.yaml`, or the
    // list shows `Draft` for a plan that is executing.
    assert_eq!(plan_state(&folder), "Executing");
    assert_eq!(
        wait_for_row_state(&home, "Executing", Duration::from_secs(5)).await,
        "Executing",
        "the in-flight transition never reached Plans.State"
    );

    // And the terminal transition, which is the one a user is actually waiting on.
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        let job = manager.get_job(&job_id).await.unwrap().expect("job exists");
        if matches!(
            job.status,
            JobStatus::Completed | JobStatus::Failed | JobStatus::Timeout | JobStatus::Stopped
        ) {
            assert_eq!(job.status, JobStatus::Completed, "{:?}", job.status_message);
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "job never finished (last status: {})",
            job.status
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }

    assert_eq!(plan_state(&folder), "Review");
    assert_eq!(
        wait_for_row_state(&home, "Review", Duration::from_secs(5)).await,
        "Review",
        "plan.yaml reached Review but Plans.State did not, so the list stays stale"
    );
}

/// A cancellation reverts the plan on disk and must revert the row too — this path never reaches
/// `finish_job`, so it needs its own mirror.
#[cfg(unix)]
#[tokio::test]
async fn cancelling_a_job_reverts_the_plans_row_too() {
    let home = HomeFixture::new("plan-mirror-cancel");
    home.write_promptware("ExecutePlan");

    let plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pass)]);
    let folder = home.write_plan("00001-Cancelled", &plan);
    seed_row(&home, &folder);

    let script = home.path.join("agent.sh");
    std::fs::write(&script, "echo working\nsleep 30\n").expect("write script");

    let manager = JobManager::new(home.path.clone(), settings())
        .with_spec_builder(script_spec_builder(script, home.path.clone()));

    let job_id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: None,
        }))
        .await
        .expect("start_job");

    assert_eq!(
        wait_for_row_state(&home, "Executing", Duration::from_secs(5)).await,
        "Executing"
    );

    assert!(manager
        .cancel_job(&job_id, Some("Cancelled"))
        .await
        .unwrap());

    assert_eq!(plan_state(&folder), "Draft");
    assert_eq!(
        wait_for_row_state(&home, "Draft", Duration::from_secs(5)).await,
        "Draft",
        "a cancelled job left the row claiming the plan is still executing"
    );
}
