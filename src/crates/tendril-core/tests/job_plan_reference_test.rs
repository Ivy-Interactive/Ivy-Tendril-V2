//! A submission may name a plan by its bare id, and everything downstream reads that string as a path.
//!
//! `POST /api/jobs` deserializes raw `JobArgs`, so it is the one front end that can express it — and it
//! is the one the desktop app uses (`folderPath: plan.id`). The CLI and the MCP dispatcher both resolve
//! a folder before submitting, so nothing else ever saw the difference, and five separate things read
//! the reference as a directory:
//!
//! * `resolve_project` reads `plan.yaml` at it, so the job was recorded under the `Auto` sentinel — and
//!   with it went the project's skills, its job hooks, its terminal allowlist and its `RepoConfigs`.
//! * `add_plan_scoped_values` bails when it is not a directory, so the firmware header lost its whole
//!   plan block: no `TendrilPlanFolder`, no `TendrilPlanId`, no `Note`/`UpdateInstructions`.
//! * `verify_execute_plan` reads `plan.yaml` at it, so an execution that exited 0 was recorded
//!   `Failed` — "exited 0 but its plan.yaml could not be read at 00681".
//! * `finish_job`'s success block is gated on the folder existing, so the plan never moved to `Review`
//!   and was reverted to `Draft` instead — it reappeared in the Plans queue as though nothing had run.
//! * the dedupe and conflict keys compare the string, so an id and a path were two different keys.
//!
//! Nothing here launches an agent: the spec builder panics if the launch path is reached.

mod common;

use common::{plan_with, HomeFixture};
use std::sync::Arc;
use tendril_core::config::{get_database_path, TendrilSettings};
use tendril_core::db::jobs::{get_job, insert_job};
use tendril_core::db::open_database;
use tendril_core::jobs::firmware_values::{is_auto_project, resolve_project};
use tendril_core::jobs::manager::{JobManager, SpecBuilder};
use tendril_core::models::{
    ExecutePlanArgs, JobArgs, JobItem, JobStatus, PlanStatus, PlanYaml, VerificationStatus,
};

fn panicking_spec_builder() -> SpecBuilder {
    Arc::new(|_provider, _config| panic!("no agent process may be spawned for this job"))
}

fn manager_for(home: &HomeFixture) -> JobManager {
    JobManager::new(
        home.path.clone(),
        TendrilSettings {
            max_concurrent_jobs: 2,
            ..Default::default()
        },
    )
    .with_spec_builder(panicking_spec_builder())
    .with_plans_dir(Some(home.plans_dir()))
}

/// A plan on disk belonging to a real project, as `tendril plan create` writes one.
fn plan_owned_by(project: &str) -> PlanYaml {
    let mut plan = plan_with(PlanStatus::Draft, &[("RustTest", VerificationStatus::Pass)]);
    plan.project = project.to_string();
    plan
}

fn row_of(home: &HomeFixture, id: &str) -> JobItem {
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    get_job(&conn, id)
        .expect("query job row")
        .expect("job row exists")
}

/// The bug the operator hit, at the point it enters the system.
#[tokio::test]
async fn a_bare_plan_id_is_resolved_to_its_folder_and_project() {
    let home = HomeFixture::new("plan-reference-bare-id");
    let folder = home.write_plan("00681-AddTestCoverage", &plan_owned_by("namecheap-cli"));
    let manager = manager_for(&home);

    // Exactly what the app posts: `{"type":"ExecutePlan","folderPath":"00681"}`.
    let id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: "00681".to_string(),
            note: None,
        }))
        .await
        .expect("start ExecutePlan naming the plan by its id");

    let row = row_of(&home, &id);
    assert_eq!(
        row.plan_file,
        folder.to_string_lossy(),
        "the row must record the folder, not the id it was named by — everything downstream reads \
         this as a path"
    );
    assert_eq!(
        row.project, "namecheap-cli",
        "the project comes from the plan's own `plan.yaml`, which is only readable once the \
         reference is a folder"
    );
    // The stored args are rewritten too, not just the row: `resolve_project` and the firmware header
    // both read them back, and a restart replays them.
    assert_eq!(
        row.typed_args.as_ref().and_then(|a| a.plan_folder()),
        Some(folder.to_string_lossy().as_ref())
    );
}

/// The same reference in every spelling the operator, the app and the CLI each use.
#[tokio::test]
async fn every_spelling_of_a_plan_reference_resolves_to_the_same_folder() {
    let home = HomeFixture::new("plan-reference-spellings");
    let folder = home.write_plan("00042-SomePlan", &plan_owned_by("widgets"));
    let expected = folder.to_string_lossy().to_string();

    for (label, reference) in [
        ("bare id", "42"),
        ("padded id", "00042"),
        ("folder name", "00042-SomePlan"),
        ("absolute path", expected.as_str()),
    ] {
        let manager = manager_for(&home);
        let id = manager
            .start_job_forced(
                JobArgs::ExecutePlan(ExecutePlanArgs {
                    folder_path: reference.to_string(),
                    note: None,
                }),
                true,
            )
            .await
            .unwrap_or_else(|e| panic!("start ExecutePlan by {label}: {e}"));

        let row = row_of(&home, &id);
        assert_eq!(row.plan_file, expected, "by {label}");
        assert_eq!(row.project, "widgets", "by {label}");
    }
}

/// A reference that resolves to nothing is still accepted, and still recorded — it is the caller's
/// error to report, and turning it into a rejection here would change the one shape the route already
/// guards (no reference at all).
#[tokio::test]
async fn an_unresolvable_reference_is_kept_rather_than_becoming_an_error() {
    let home = HomeFixture::new("plan-reference-unresolvable");
    let manager = manager_for(&home);

    let id = manager
        .start_job(JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: "09999".to_string(),
            note: None,
        }))
        .await
        .expect("a reference to a plan that does not exist is not a submission error");

    let row = row_of(&home, &id);
    assert_eq!(row.plan_file, "09999");
    assert!(
        is_auto_project(&row.project),
        "no plan means no project to take, got {:?}",
        row.project
    );
}

/// `Auto` means "not known yet", so it must lose to a project that is known — in either direction.
#[test]
fn the_auto_sentinel_never_wins_over_a_real_project() {
    assert!(is_auto_project("Auto"));
    assert!(is_auto_project("auto"));
    assert!(is_auto_project(""));
    assert!(is_auto_project("   "));
    assert!(!is_auto_project("namecheap-cli"));

    let home = HomeFixture::new("plan-reference-auto-sentinel");
    let folder = home.write_plan("00007-PortTheChat", &plan_owned_by("namecheap-cli"));
    let settings = TendrilSettings::default();

    // A `CreatePlan` submitted with no project carries the sentinel in its args — which is how the app
    // sends it when the operator picks none. Once the plan it produced is on the job, that is the
    // answer, and the args must not keep reporting `Auto` over it.
    let mut job = JobItem::new(
        "00042".to_string(),
        "CreatePlan".to_string(),
        folder.to_string_lossy().to_string(),
        "Auto".to_string(),
    );
    job.typed_args = Some(JobArgs::CreatePlan(tendril_core::models::CreatePlanArgs {
        description: "add tests".to_string(),
        project: "Auto".to_string(),
        priority: 0,
        force: false,
        source_path: None,
        upload_session_id: None,
    }));
    job.args = serde_json::to_string(&job.typed_args).ok();

    assert_eq!(resolve_project(&job, &settings), "namecheap-cli");

    // An explicit project still wins: the operator naming one is not a guess.
    if let Some(JobArgs::CreatePlan(args)) = job.typed_args.as_mut() {
        args.project = "widgets".to_string();
    }
    job.args = serde_json::to_string(&job.typed_args).ok();
    assert_eq!(resolve_project(&job, &settings), "widgets");
}

/// The persistence half. `finish_job` writes a record taken before the run, so a project learned during
/// it would be undone by the terminal write unless the column refuses to go back to the sentinel.
#[tokio::test]
async fn a_terminal_write_cannot_reset_a_learned_project_to_auto() {
    let home = HomeFixture::new("plan-reference-project-preserved");
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");

    let mut job = JobItem::new(
        "00042".to_string(),
        "CreatePlan".to_string(),
        String::new(),
        "Auto".to_string(),
    );
    job.status = JobStatus::Running;
    insert_job(&conn, &job).expect("insert the running row");

    // Mid-run: the promptware reported its plan, so the project became known.
    let mut learned = job.clone();
    learned.project = "namecheap-cli".to_string();
    insert_job(&conn, &learned).expect("persist the learned project");

    // The terminal write, from the pre-run snapshot that still says `Auto`.
    let mut finishing = job.clone();
    finishing.status = JobStatus::Completed;
    insert_job(&conn, &finishing).expect("persist the completion");

    assert_eq!(
        get_job(&conn, "00042")
            .expect("query job row")
            .expect("job row exists")
            .project,
        "namecheap-cli",
        "a write carrying the sentinel must leave a known project alone"
    );
}

/// `tendril job status --plan-id` is the first moment a `CreatePlan`'s project can be known, and the
/// moment the Jobs list and the chat come to read the row.
#[tokio::test]
async fn reporting_a_plan_id_teaches_the_job_its_project() {
    let home = HomeFixture::new("plan-reference-reported-id");
    home.write_plan("00681-AddTestCoverage", &plan_owned_by("namecheap-cli"));
    let manager = manager_for(&home);

    let id = manager
        .start_job(JobArgs::CreatePlan(tendril_core::models::CreatePlanArgs {
            description: "add tests".to_string(),
            project: "Auto".to_string(),
            priority: 0,
            force: false,
            source_path: None,
            upload_session_id: None,
        }))
        .await
        .expect("start CreatePlan with no project");

    assert!(is_auto_project(&row_of(&home, &id).project));

    manager
        .update_job_status(
            &id,
            "wrote the plan",
            Some("00681"),
            Some("Add Test Coverage"),
        )
        .await
        .expect("report the plan the job produced");

    assert_eq!(
        row_of(&home, &id).project,
        "namecheap-cli",
        "the reported plan names the project, so the row should stop saying Auto while it still runs"
    );
}
