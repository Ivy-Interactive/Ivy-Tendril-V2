//! Idempotency at the submission door: the same work already in flight is a conflict, not a second
//! job, worktree and agent.
//!
//! The failure these tests exist for is the C# job-duplication storm (Ivy-Tendril#2710): identical
//! submissions each yielded a live job on one worktree, and the agents fought over the same files.
//!
//! Every predecessor here is written straight to SQLite rather than started through the manager.
//! That is deliberate: the in-memory conflict check restored by plan 00551 already refuses a second
//! `ExecutePlan` in the *same* process (covered in `job_queue_semantics_test`), and what the dedupe
//! key adds on top is the row nobody's memory holds — another daemon's, or this one's before a
//! restart — plus the job types that check cannot see at all, `CreatePlan` first among them.
//!
//! Nothing here launches an agent: the spec builder panics if reached, and no `Promptwares` folder
//! exists for the types whose submissions are accepted, so an accepted job stops at the promptware
//! gate before any process is spawned.

mod common;

use common::{plan_state, plan_with, HomeFixture};
use std::path::Path;
use std::sync::Arc;
use tendril_core::config::{get_database_path, TendrilSettings};
use tendril_core::db::jobs::{delete_job, get_job, insert_job, list_jobs};
use tendril_core::db::open_database;
use tendril_core::error::TendrilError;
use tendril_core::jobs::manager::{JobManager, SpecBuilder};
use tendril_core::models::{
    CreateIssueArgs, CreatePlanArgs, ExecutePlanArgs, JobArgs, JobItem, JobStatus, PlanStatus,
};

fn settings() -> TendrilSettings {
    TendrilSettings {
        max_concurrent_jobs: 2,
        ..Default::default()
    }
}

/// A spec builder that fails the test if the launch path ever reaches it.
fn panicking_spec_builder() -> SpecBuilder {
    Arc::new(|_provider, _config| panic!("no agent process may be spawned for this job"))
}

/// A manager wired to a fixture: no agent, fixture plans directory.
fn manager_for(home: &HomeFixture) -> JobManager {
    JobManager::new(home.path.clone(), settings())
        .with_spec_builder(panicking_spec_builder())
        .with_plans_dir(Some(home.plans_dir()))
}

fn execute(folder: &Path) -> JobArgs {
    JobArgs::ExecutePlan(ExecutePlanArgs {
        folder_path: folder.to_string_lossy().to_string(),
        note: None,
    })
}

fn create_plan(project: &str, description: &str) -> JobArgs {
    JobArgs::CreatePlan(CreatePlanArgs {
        description: description.to_string(),
        project: project.to_string(),
        priority: 0,
        force: false,
        source_path: None,
        upload_session_id: None,
    })
}

/// Writes a job row straight to SQLite, keyed exactly as the submission path would have keyed it.
/// This is the predecessor no in-memory check can see.
/// A `CreateIssue` about the plan itself: no subject of its own.
fn create_issue(folder: &Path) -> JobArgs {
    JobArgs::CreateIssue(CreateIssueArgs {
        folder_path: folder.to_string_lossy().to_string(),
        repo: "/repos/widgets".to_string(),
        assignee: None,
        comment: None,
        labels: None,
        title_override: None,
        body_override: None,
        issue_source: None,
    })
}

/// A `CreateIssue` filed for a recommendation stored in `folder`'s plan, identified the way
/// `RecommendationsView` identifies one: `planId::title`.
fn create_issue_for_recommendation(folder: &Path, source: &str, title: &str) -> JobArgs {
    JobArgs::CreateIssue(CreateIssueArgs {
        folder_path: folder.to_string_lossy().to_string(),
        repo: "/repos/widgets".to_string(),
        assignee: None,
        comment: None,
        labels: None,
        title_override: Some(title.to_string()),
        body_override: Some("Because the cache never expires.".to_string()),
        issue_source: Some(source.to_string()),
    })
}

fn seed_row(home: &HomeFixture, id: &str, args: &JobArgs, status: JobStatus) {
    let mut job = JobItem::new(
        id.to_string(),
        args.job_type().to_string(),
        args.plan_folder().unwrap_or("").to_string(),
        "FixtureProject".to_string(),
    );
    job.status = status;
    // `typed_args` is rehydrated from the Args JSON, so a realistic row carries both.
    job.args = Some(serde_json::to_string(args).expect("serialize job args"));
    job.typed_args = Some(args.clone());
    job.dedupe_key = args.dedupe_key();
    assert!(
        job.dedupe_key.is_some(),
        "{} should have a dedupe key to seed",
        args.job_type()
    );

    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    insert_job(&conn, &job).expect("insert seeded job row");
}

fn all_rows(home: &HomeFixture) -> Vec<JobItem> {
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    list_jobs(&conn, None, 500).expect("list job rows")
}

fn rows_for(home: &HomeFixture, folder: &Path) -> Vec<JobItem> {
    let target = folder.to_string_lossy().to_string();
    all_rows(home)
        .into_iter()
        .filter(|j| j.plan_file == target)
        .collect()
}

fn row_of(home: &HomeFixture, id: &str) -> JobItem {
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");
    get_job(&conn, id)
        .expect("query job row")
        .expect("job row exists")
}

// ---------------------------------------------------------------------------
// The delete-as-claim primitive
// ---------------------------------------------------------------------------

/// `delete_job` is used as a claim by `restart_unblocked_jobs`, so it has to report whether it was
/// this caller who removed the row.
///
/// The plan specified `Ok(0)` / `Ok(1)`; the signature plan 00551 landed is `Result<bool>`, which
/// carries the same answer for a primary-key delete (0 or 1 rows, never more), so the assertions are
/// on `false` / `true`.
#[test]
fn delete_job_reports_rows_removed() {
    let home = HomeFixture::new("dedupe-delete-claim");
    let conn = open_database(&get_database_path(&home.path)).expect("open fixture database");

    assert!(
        !delete_job(&conn, "00404").expect("delete a nonexistent row"),
        "a row that never existed cannot be claimed"
    );

    let job = JobItem::new(
        "00001".to_string(),
        "ExecutePlan".to_string(),
        String::new(),
        "FixtureProject".to_string(),
    );
    insert_job(&conn, &job).expect("insert job row");

    assert!(
        delete_job(&conn, "00001").expect("first delete"),
        "the first delete removed the row, so this caller holds the claim"
    );
    assert!(
        !delete_job(&conn, "00001").expect("second delete"),
        "the second delete removed nothing, so this caller must not act on the row"
    );
}

// ---------------------------------------------------------------------------
// The key itself
// ---------------------------------------------------------------------------

/// The key identifies the *work*, so it must survive the ways one request can be spelled — and must
/// not merge two requests that only look alike.
#[test]
fn the_dedupe_key_identifies_the_work_and_not_the_spelling() {
    let plain = create_plan("Widgets", "Add a login form");
    let messy = create_plan("  widgets ", "  Add   a   LOGIN form  ");
    assert_eq!(
        plain.dedupe_key(),
        messy.dedupe_key(),
        "whitespace and case are how a request was typed, not what it asks for"
    );
    assert_ne!(
        plain.dedupe_key(),
        create_plan("Gadgets", "Add a login form").dedupe_key(),
        "the same description against another project is other work"
    );
    assert_ne!(
        plain.dedupe_key(),
        create_plan("Widgets", "Add a logout form").dedupe_key(),
        "a materially different description is other work"
    );

    let folder = Path::new("/tmp/Plans/00001-Thing");
    assert_eq!(
        execute(folder).dedupe_key(),
        execute(Path::new("/tmp/Plans/00001-Thing/")).dedupe_key(),
        "a trailing separator is not a different plan"
    );
    assert_ne!(
        execute(folder).dedupe_key(),
        execute(Path::new("/tmp/Plans/00001-thing")).dedupe_key(),
        "Linux paths are case-sensitive, so two spellings may be two plans"
    );
    assert_ne!(
        execute(folder).dedupe_key(),
        JobArgs::ExpandPlan(tendril_core::models::ExpandPlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
        })
        .dedupe_key(),
        "expanding a plan and executing it are not the same work"
    );
}

/// `CreateIssue` is the one plan-scoped type that may legitimately run twice against one plan.
///
/// A completed plan routinely carries several recommendations, and they live inside that plan's
/// `plan.yaml`, so filing two of them keys on the same folder. On a folder-only key the second
/// submission is refused as duplicate work, which the operator sees as a button that stops
/// responding after the first click.
#[test]
fn two_recommendations_from_one_plan_are_two_issues() {
    let folder = Path::new("/tmp/Plans/00001-Thing");

    let first = create_issue_for_recommendation(folder, "00001::Cache the model list", "Cache it");
    let second = create_issue_for_recommendation(folder, "00001::Retry the fetch", "Retry it");

    assert_ne!(
        first.dedupe_key(),
        second.dedupe_key(),
        "two recommendations in one plan are two pieces of work"
    );

    assert_eq!(
        first.dedupe_key(),
        create_issue_for_recommendation(
            folder,
            "  00001::Cache   the MODEL list ",
            "Something else entirely",
        )
        .dedupe_key(),
        "the source identifies the work, normalized like a description, and outranks the title"
    );

    assert_ne!(
        first.dedupe_key(),
        create_issue(folder).dedupe_key(),
        "an issue about the plan is not an issue about one of its recommendations"
    );

    assert_eq!(
        create_issue(folder).dedupe_key(),
        create_issue(Path::new("/tmp/Plans/00001-Thing/")).dedupe_key(),
        "with no subject the key is still the folder, so one plan still gets one issue"
    );
}

/// With only a title to go on, that title is the identity. Covers a caller that supplies a subject
/// but no stable id for it.
#[test]
fn an_issue_title_identifies_the_work_when_there_is_no_source() {
    let folder = Path::new("/tmp/Plans/00001-Thing");
    let titled = |title: &str| {
        JobArgs::CreateIssue(CreateIssueArgs {
            folder_path: folder.to_string_lossy().to_string(),
            repo: "/repos/widgets".to_string(),
            assignee: None,
            comment: None,
            labels: None,
            title_override: Some(title.to_string()),
            body_override: None,
            issue_source: None,
        })
    };

    assert_eq!(
        titled("Cache the model list").dedupe_key(),
        titled("  cache   the Model List  ").dedupe_key(),
        "whitespace and case are how a title was typed, not what it asks for"
    );
    assert_ne!(
        titled("Cache the model list").dedupe_key(),
        titled("Retry the fetch").dedupe_key(),
        "a different title is different work"
    );
    assert_ne!(
        titled("Cache the model list").dedupe_key(),
        create_issue(folder).dedupe_key(),
        "a titled issue is not the plan's own issue"
    );
}

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

/// An `ExecutePlan` whose twin is already in flight in a row this process never saw is refused, and
/// the refusal names the job that is doing the work.
#[tokio::test]
async fn an_identical_inflight_execute_plan_is_rejected() {
    let home = HomeFixture::new("dedupe-execute");
    let folder = home.write_plan("00001-Busy", &plan_with(PlanStatus::Draft, &[]));
    seed_row(&home, "00900", &execute(&folder), JobStatus::Running);

    let manager = manager_for(&home);
    let err = manager
        .start_job(execute(&folder))
        .await
        .expect_err("the second ExecutePlan should be refused");

    assert!(matches!(err, TendrilError::DuplicateJob(_)), "{:?}", err);
    let msg = err.to_string();
    assert!(msg.contains("00900"), "{}", msg);
    assert!(msg.contains("ExecutePlan"), "{}", msg);
    assert!(
        msg.to_lowercase().contains("force"),
        "the message should say how to override it: {}",
        msg
    );

    assert_eq!(
        rows_for(&home, &folder).len(),
        1,
        "a refused submission must not write a job row"
    );
}

/// `CreatePlan` has no plan folder to key on and is in no conflict group, so the dedupe key is the
/// only thing standing between two identical inbox submissions and two plans.
#[tokio::test]
async fn an_identical_inflight_create_plan_is_rejected() {
    let home = HomeFixture::new("dedupe-create");
    seed_row(
        &home,
        "00900",
        &create_plan("Widgets", "Add a login form"),
        JobStatus::Running,
    );

    let manager = manager_for(&home);

    let err = manager
        .start_job(create_plan("  widgets ", "  Add   a   LOGIN form  "))
        .await
        .expect_err("a description that differs only in typing is the same request");
    assert!(matches!(err, TendrilError::DuplicateJob(_)), "{:?}", err);
    assert!(err.to_string().contains("00900"), "{}", err);

    manager
        .start_job(create_plan("Widgets", "Add a logout form"))
        .await
        .expect("a materially different description is other work");
    manager
        .start_job(create_plan("Gadgets", "Add a login form"))
        .await
        .expect("the same description against another project is other work");

    assert_eq!(
        all_rows(&home).len(),
        3,
        "the seeded row plus the two accepted submissions, and nothing for the refused one"
    );
}

/// The plan is only moved once a row is actually written, so a refusal must leave it where it was
/// rather than flipping it to `Executing` with no job behind it.
#[tokio::test]
async fn a_rejected_duplicate_leaves_the_plan_state_untouched() {
    let home = HomeFixture::new("dedupe-plan-state");
    let folder = home.write_plan("00001-Untouched", &plan_with(PlanStatus::Draft, &[]));
    seed_row(&home, "00900", &execute(&folder), JobStatus::Running);

    let manager = manager_for(&home);
    let err = manager
        .start_job(execute(&folder))
        .await
        .expect_err("the duplicate should be refused");
    assert!(matches!(err, TendrilError::DuplicateJob(_)), "{:?}", err);

    assert_eq!(
        plan_state(&folder),
        PlanStatus::Draft.to_string(),
        "a refused submission must not mark the plan as being executed"
    );
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

/// `force` is the operator saying "yes, again". It skips the duplicate gates and stores no key, so
/// the forced job neither is blocked nor blocks the next submission — and it is not a licence to
/// skip the dependency gate.
#[tokio::test]
async fn force_bypasses_the_duplicate_check() {
    let home = HomeFixture::new("dedupe-force");

    // The missing dependency is what keeps the accepted job Blocked, so the override is observable
    // without an agent ever being launched.
    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.depends_on = vec!["00099-DoesNotExist".to_string()];
    let folder = home.write_plan("00001-Forced", &plan);
    seed_row(&home, "00900", &execute(&folder), JobStatus::Running);

    let manager = manager_for(&home);
    let err = manager
        .start_job(execute(&folder))
        .await
        .expect_err("the unforced submission is still refused");
    assert!(matches!(err, TendrilError::DuplicateJob(_)), "{:?}", err);

    let forced = manager
        .start_job_forced(execute(&folder), true)
        .await
        .expect("force should override the duplicate check");
    let job = manager.get_job(&forced).await.unwrap().unwrap();
    assert_eq!(
        job.status,
        JobStatus::Blocked,
        "force overrides the duplicate gates, never the dependency gate"
    );
    assert!(
        row_of(&home, &forced).dedupe_key.is_none(),
        "a forced job stores no key, so it can neither be blocked nor block"
    );

    let second = manager
        .start_job_forced(execute(&folder), true)
        .await
        .expect("a forced submission is never refused as a duplicate of another forced one");
    assert_ne!(second, forced);
}

/// A predecessor that has stopped working is no reason to refuse the work again.
///
/// `Blocked` is absent from this list even though the dedupe gate exempts it, because a `Blocked`
/// `ExecutePlan` is now refused a step earlier by 00620's conflict check, which counts every
/// non-terminal row on the plan. The dedupe gate's own `Blocked` exemption is pinned by
/// [`a_blocked_predecessor_does_not_deduplicate_away_its_replacement`], on a job type in no conflict
/// group where nothing else can answer first.
#[tokio::test]
async fn a_duplicate_of_a_terminal_predecessor_is_accepted() {
    for status in [
        JobStatus::Completed,
        JobStatus::Failed,
        JobStatus::Timeout,
        JobStatus::Stopped,
    ] {
        let home = HomeFixture::new("dedupe-terminal");

        // Blocked again, so the accepted resubmission launches nothing.
        let mut plan = plan_with(PlanStatus::Draft, &[]);
        plan.depends_on = vec!["00099-DoesNotExist".to_string()];
        let folder = home.write_plan("00001-Again", &plan);
        seed_row(&home, "00900", &execute(&folder), status);

        let manager = manager_for(&home);
        let id = manager
            .start_job(execute(&folder))
            .await
            .unwrap_or_else(|e| {
                panic!(
                    "a {} predecessor must not block a resubmission: {}",
                    status, e
                )
            });

        assert_ne!(id, "00900");
        assert_eq!(
            rows_for(&home, &folder).len(),
            2,
            "the {} predecessor is kept as history alongside the new job",
            status
        );
    }
}

/// `Blocked` is not in flight as far as this gate is concerned: a blocked row was never spawned, so it
/// holds no worktree and no agent, and `dependents.rs` deletes it before submitting its replacement.
/// Deduplicating against it would let a queued intention block the very job meant to replace it.
///
/// `CreatePlan` rather than `ExecutePlan`, because `CreatePlan` is in no conflict group: it isolates
/// the dedupe key as the only gate that could refuse the resubmission, so a pass here is about the
/// `Blocked` exemption and nothing else. (`ExecutePlan` is the other story — 00620's conflict check
/// counts a `Blocked` row on the plan, and refusing there is correct: a plan-mutating job may only be
/// resubmitted through the delete-then-start claim in `dependents.rs`.)
#[tokio::test]
async fn a_blocked_predecessor_does_not_deduplicate_away_its_replacement() {
    let home = HomeFixture::new("dedupe-blocked-replacement");
    let args = create_plan("Widgets", "Add a login form");
    seed_row(&home, "00900", &args, JobStatus::Blocked);

    let manager = manager_for(&home);
    let id = manager
        .start_job(args)
        .await
        .expect("a Blocked predecessor holds nothing, so its replacement must be accepted");

    assert_ne!(id, "00900");
    assert_eq!(
        all_rows(&home).len(),
        2,
        "the Blocked predecessor is kept alongside its replacement"
    );
}

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

/// The storm shape at the door: two identical submissions arriving together must not both win. The
/// check runs under the same lock as the ID allocation and the insert, so exactly one gets through.
///
/// `CreatePlan` is used because it is in no conflict group: the only thing that can decide this is
/// the dedupe key, so the outcome does not depend on which future ran first.
#[tokio::test]
async fn two_concurrent_identical_submissions_yield_one_job() {
    let home = HomeFixture::new("dedupe-concurrent");
    let manager = manager_for(&home).share();
    let args = create_plan("Widgets", "Add a login form");

    let (first, second) = tokio::join!(
        manager.start_job(args.clone()),
        manager.start_job(args.clone())
    );

    let err = match (first, second) {
        (Ok(_), Err(e)) | (Err(e), Ok(_)) => e,
        (Ok(a), Ok(b)) => panic!("both submissions were accepted, as jobs {} and {}", a, b),
        (Err(a), Err(b)) => panic!("both submissions were refused: {} / {}", a, b),
    };
    assert!(matches!(err, TendrilError::DuplicateJob(_)), "{:?}", err);

    assert_eq!(
        all_rows(&home).len(),
        1,
        "one submission, one job row — the whole point of the gate"
    );
}
