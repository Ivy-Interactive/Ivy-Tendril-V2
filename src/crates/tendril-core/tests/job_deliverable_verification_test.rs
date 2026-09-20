//! A job that exits zero is only recorded `Completed` if it produced something.
//!
//! The failure mode these tests exist for is the expensive one: job 02643 exited 0 after 1278s, its
//! plan was flipped to a terminal state with zero commits and every verification still `Pending`, and
//! the worktree was later cleaned. Every assertion below is a guard against that shape of loss, so
//! each one checks the *preservation* side too — that a downgraded job leaves the worktree and the
//! plan folder alone.

mod common;

use common::{plan_state, plan_with, HomeFixture};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tendril_core::config::get_database_path;
use tendril_core::db::jobs::{get_job, insert_new_job};
use tendril_core::db::open_database;
use tendril_core::db::plans::{get_plan_by_id, sync_plan};
use tendril_core::jobs::logger::{append_agent_log, append_to_eventwire, read_job_log};
use tendril_core::jobs::manager::finish_job;
use tendril_core::models::{JobItem, JobStatus, PlanStatus, PlanYaml, VerificationStatus};
use tendril_core::plans::reader::read_plan_file;
use tendril_core::plans::writer::write_plan_yaml;
use tokio::sync::RwLock;

/// Runs `finish_job` claiming `claimed` and hands back the job as it was persisted.
async fn run_finish(home: &HomeFixture, job: JobItem, claimed: JobStatus) -> JobItem {
    let id = job.id.clone();
    let jobs_map = Arc::new(RwLock::new(HashMap::from([(id.clone(), job.clone())])));
    let handles = Arc::new(RwLock::new(HashMap::new()));
    let completion_claimed = AtomicBool::new(false);

    finish_job(
        &home.path,
        &home.plans_dir(),
        &jobs_map,
        &handles,
        &completion_claimed,
        job,
        claimed,
        "Process exited with code 0".to_string(),
        Some(12),
        None,
    )
    .await;

    let finished = jobs_map.read().await.get(&id).cloned();
    finished.expect("job stays in the map")
}

fn job_of(job_type: &str, id: &str, plan_file: &str) -> JobItem {
    JobItem::new(
        id.to_string(),
        job_type.to_string(),
        plan_file.to_string(),
        "FixtureProject".to_string(),
    )
}

/// A plan folder with a `Revisions/001.md` in it, i.e. what a real CreatePlan run leaves behind.
fn write_revision(plan_folder: &Path) {
    let dir = plan_folder.join("Revisions");
    std::fs::create_dir_all(&dir).expect("create Revisions dir");
    std::fs::write(dir.join("001.md"), "# Fixture Plan\n").expect("write revision");
}

/// Seeds the `Plans` row for a folder, so a test can assert the row is deleted with the folder.
fn seed_plan_row(home: &HomeFixture, plan_folder: &Path) {
    let db_path = get_database_path(&home.path);
    let conn = open_database(&db_path).expect("open fixture database");
    let plan_file = read_plan_file(plan_folder).expect("read plan file");
    sync_plan(&conn, &plan_file).expect("sync plan row");
}

fn plan_row_exists(home: &HomeFixture, id: i32) -> bool {
    let db_path = get_database_path(&home.path);
    let conn = open_database(&db_path).expect("open fixture database");
    get_plan_by_id(&conn, id).expect("query plan row").is_some()
}

/// An `ExecutePlan`-shaped plan: executing, one verification row, commits set by the caller.
fn executing_plan(commits: &[&str], verification: (&str, VerificationStatus)) -> PlanYaml {
    let mut plan = plan_with(PlanStatus::Executing, &[verification]);
    plan.commits = commits.iter().map(|c| (*c).to_string()).collect();
    plan
}

// ---------------------------------------------------------------------------------------------
// CreatePlan
// ---------------------------------------------------------------------------------------------

/// (1) The plan-00551 shape: a folder with a `plan.yaml` and no revision at all.
#[tokio::test]
async fn create_plan_exiting_zero_with_no_revision_is_failed() {
    let home = HomeFixture::new("deliv-create-empty");
    let plan_folder = home.write_plan("00701-NoRevision", &plan_with(PlanStatus::Draft, &[]));
    seed_plan_row(&home, &plan_folder);
    assert!(plan_row_exists(&home, 701), "row seeded");

    let mut job = job_of("CreatePlan", "00801", "");
    job.reported_plan_id = Some("00701".to_string());

    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Failed);
    let msg = finished.status_message.unwrap_or_default();
    assert!(
        msg.contains("no plan revision was written"),
        "the reason must name the missing revision, got: {}",
        msg
    );
    assert!(
        !plan_folder.exists(),
        "the orphan folder must be removed from disk"
    );
    assert!(
        !plan_row_exists(&home, 701),
        "the Plans row must be deleted"
    );
    assert!(
        finished.plan_file.is_empty(),
        "plan_file must be cleared: there is nothing to link to"
    );
}

/// (5) The same run, done right: one revision is enough, and the folder is left alone.
#[tokio::test]
async fn create_plan_with_a_revision_completes() {
    let home = HomeFixture::new("deliv-create-ok");
    let plan_folder = home.write_plan("00702-HasRevision", &plan_with(PlanStatus::Draft, &[]));
    write_revision(&plan_folder);

    let mut job = job_of("CreatePlan", "00802", "");
    job.reported_plan_id = Some("702".to_string());

    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Completed);
    assert_eq!(
        PathBuf::from(&finished.plan_file),
        plan_folder,
        "plan_file must point at the plan the run created"
    );
    assert!(plan_folder.is_dir(), "the plan folder must be untouched");
    assert_eq!(revisions_on_disk(&plan_folder), 1);
}

fn revisions_on_disk(plan_folder: &Path) -> usize {
    std::fs::read_dir(plan_folder.join("Revisions"))
        .map(|d| d.filter_map(|e| e.ok()).count())
        .unwrap_or(0)
}

/// (7a) A deliberate duplicate rejection is a success, not an empty run.
#[tokio::test]
async fn duplicate_marker_in_agent_text_completes_without_a_plan() {
    let home = HomeFixture::new("deliv-dup-text");
    home.write_plan("00001-ExistingPlan", &plan_with(PlanStatus::Draft, &[]));

    let job = job_of("CreatePlan", "00803", "");
    append_to_eventwire(
        &home.path,
        &job.id,
        r#"{"kind":"text","text":"identified as duplicate: 00001-ExistingPlan"}"#,
    )
    .unwrap();

    let finished = run_finish(&home, job, JobStatus::Completed).await;
    assert_eq!(
        finished.status,
        JobStatus::Completed,
        "a declined duplicate produced the right answer, which is a deliverable"
    );
}

/// (7b) The same marker read out of a tool result must not suppress a real failure — `Program.md`
/// documents the marker, so a run that merely reads that file would otherwise always pass.
#[tokio::test]
async fn duplicate_marker_in_a_tool_result_is_failed() {
    let home = HomeFixture::new("deliv-dup-tool");
    home.write_plan("00001-ExistingPlan", &plan_with(PlanStatus::Draft, &[]));

    let job = job_of("CreatePlan", "00804", "");
    append_to_eventwire(
        &home.path,
        &job.id,
        r#"{"kind":"tool_result","tool_use_id":"t1","output":"identified as duplicate: 00001-ExistingPlan","is_error":false}"#,
    )
    .unwrap();

    let finished = run_finish(&home, job, JobStatus::Completed).await;
    assert_eq!(finished.status, JobStatus::Failed);
}

// ---------------------------------------------------------------------------------------------
// ExecutePlan / RetryPlan
// ---------------------------------------------------------------------------------------------

/// (2) The job 02643 shape exactly: exit 0, verifications all `Pass`, and no commits.
#[tokio::test]
async fn execute_plan_exiting_zero_with_no_commits_is_failed_and_worktree_preserved() {
    let home = HomeFixture::new("deliv-exec-nocommits");
    let plan_folder = home.write_plan(
        "00703-NoCommits",
        &executing_plan(&[], ("RustTest", VerificationStatus::Pass)),
    );
    let worktree_git = plan_folder.join("Worktrees/acme/repo/.git");
    std::fs::create_dir_all(worktree_git.parent().unwrap()).unwrap();
    std::fs::write(&worktree_git, "gitdir: elsewhere\n").unwrap();

    let job = job_of(
        "ExecutePlan",
        "00805",
        plan_folder.to_string_lossy().as_ref(),
    );
    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Failed);
    let msg = finished.status_message.unwrap_or_default();
    assert!(
        msg.contains("no commits recorded"),
        "the reason must name the shortfall, got: {}",
        msg
    );
    assert!(
        worktree_git.exists(),
        "the worktree is the recovery material and must be preserved"
    );
    assert!(plan_folder.is_dir(), "the plan folder must be preserved");
    assert_eq!(
        plan_state(&plan_folder),
        PlanStatus::Failed.to_string(),
        "the plan goes to Failed, not back to Draft: a worktree is sitting there"
    );
}

/// (3) The background-verification backstop: commits landed, but a verification was never read.
#[tokio::test]
async fn execute_plan_with_commits_but_pending_verifications_is_failed() {
    let home = HomeFixture::new("deliv-exec-pending");
    let mut plan = executing_plan(&["abc1234"], ("NpmTest", VerificationStatus::Pass));
    plan.verifications.push(
        plan_with(
            PlanStatus::Executing,
            &[("RustTest", VerificationStatus::Pending)],
        )
        .verifications
        .remove(0),
    );
    let plan_folder = home.write_plan("00704-PendingVerification", &plan);

    let job = job_of(
        "ExecutePlan",
        "00806",
        plan_folder.to_string_lossy().as_ref(),
    );
    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Failed);
    let msg = finished.status_message.unwrap_or_default();
    assert!(
        msg.contains("RustTest"),
        "the reason must name the unsettled verification, got: {}",
        msg
    );
    assert!(
        !msg.contains("no commits"),
        "the commit half was satisfied, got: {}",
        msg
    );
}

/// (4) The happy path still completes and still moves the plan on.
#[tokio::test]
async fn execute_plan_with_commits_and_passing_verifications_completes() {
    let home = HomeFixture::new("deliv-exec-ok");
    let plan_folder = home.write_plan(
        "00705-Delivered",
        &executing_plan(&["abc1234"], ("RustTest", VerificationStatus::Pass)),
    );

    let job = job_of(
        "ExecutePlan",
        "00807",
        plan_folder.to_string_lossy().as_ref(),
    );
    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Completed);
    assert_eq!(plan_state(&plan_folder), PlanStatus::Review.to_string());
}

/// A `RetryPlan` job is held to the same bar as the `ExecutePlan` it resumes.
#[tokio::test]
async fn retry_plan_is_held_to_the_same_bar() {
    let home = HomeFixture::new("deliv-retry");
    let plan_folder = home.write_plan(
        "00706-RetryNoCommits",
        &executing_plan(&[], ("RustTest", VerificationStatus::Pass)),
    );

    let job = job_of("RetryPlan", "00808", plan_folder.to_string_lossy().as_ref());
    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Failed);
}

/// An unreadable plan is an ambiguous signal, and every ambiguous signal resolves to `Failed`.
#[tokio::test]
async fn execute_plan_with_an_unreadable_plan_is_failed() {
    let home = HomeFixture::new("deliv-exec-unreadable");
    let job = job_of("ExecutePlan", "00809", "");

    let finished = run_finish(&home, job, JobStatus::Completed).await;
    assert_eq!(finished.status, JobStatus::Failed);
    assert!(finished
        .status_message
        .unwrap_or_default()
        .contains("plan.yaml could not be read"));
}

// ---------------------------------------------------------------------------------------------
// CreatePr
// ---------------------------------------------------------------------------------------------

/// (6a) A recorded PR URL is the deliverable.
#[tokio::test]
async fn create_pr_with_recorded_pr_url_completes() {
    let home = HomeFixture::new("deliv-pr-ok");
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec!["https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/7".to_string()];
    let plan_folder = home.write_plan("00707-HasPr", &plan);

    let job = job_of("CreatePr", "00810", plan_folder.to_string_lossy().as_ref());
    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Completed);
}

/// (6b) No URL anywhere — neither on the plan nor in the output — is a failure.
#[tokio::test]
async fn create_pr_without_pr_url_is_failed() {
    let home = HomeFixture::new("deliv-pr-missing");
    let plan_folder = home.write_plan("00708-NoPr", &plan_with(PlanStatus::Review, &[]));

    let job = job_of("CreatePr", "00811", plan_folder.to_string_lossy().as_ref());
    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Failed);
    assert!(finished
        .status_message
        .unwrap_or_default()
        .contains("no pull request URL"));
    assert!(plan_folder.is_dir(), "the plan folder must be preserved");
}

/// An agent that opened the PR but never ran `tendril plan add-pr` is reconciled from its own output
/// rather than failed on a bookkeeping slip.
#[tokio::test]
async fn create_pr_reconciles_a_url_from_the_output() {
    let home = HomeFixture::new("deliv-pr-reconcile");
    let plan_folder = home.write_plan("00709-ReconcilePr", &plan_with(PlanStatus::Review, &[]));

    let job = job_of("CreatePr", "00812", plan_folder.to_string_lossy().as_ref());
    append_to_eventwire(
        &home.path,
        &job.id,
        r#"{"kind":"tool_result","output":"https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/99"}"#,
    )
    .unwrap();

    let finished = run_finish(&home, job, JobStatus::Completed).await;

    assert_eq!(finished.status, JobStatus::Completed);
    let (plan, _) = tendril_core::plans::reader::read_plan_yaml(&plan_folder).unwrap();
    assert_eq!(
        plan.prs,
        vec!["https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/99".to_string()],
        "the reconciled URL must be recorded on the plan"
    );
}

// ---------------------------------------------------------------------------------------------
// Denials, outcome log, regression guard
// ---------------------------------------------------------------------------------------------

/// (8) Denials are recorded on the job, summarised into the status message, and survive SQLite.
#[tokio::test]
async fn permission_denials_are_recorded_on_the_job() {
    let home = HomeFixture::new("deliv-denials");
    let plan_folder = home.write_plan(
        "00710-Denials",
        &executing_plan(&["abc1234"], ("RustTest", VerificationStatus::Pass)),
    );

    let job = job_of(
        "ExecutePlan",
        "00813",
        plan_folder.to_string_lossy().as_ref(),
    );
    append_to_eventwire(
        &home.path,
        &job.id,
        r#"{"type":"result","subtype":"success","is_error":false,"permission_denials":[{"tool_name":"Bash","tool_use_id":"a","tool_input":{"command":"rm -rf /"}},{"tool_name":"Write","tool_use_id":"b","tool_input":{"file_path":"/etc/hosts"}}]}"#,
    )
    .unwrap();

    let finished = run_finish(&home, job, JobStatus::Completed).await;

    let denials = finished
        .permission_denials
        .clone()
        .expect("denials must be recorded");
    assert_eq!(denials.len(), 2);
    assert!(denials.iter().any(|d| d.contains("Bash")));
    assert!(denials.iter().any(|d| d.contains("Write")));

    let msg = finished.status_message.clone().unwrap_or_default();
    assert!(
        msg.contains("Permission denied: Bash, Write (2 calls)"),
        "the summary must reach the Jobs UI through the status message, got: {}",
        msg
    );
    assert_eq!(
        finished.status,
        JobStatus::Completed,
        "denials explain a job; they never fail one"
    );

    let db_path = get_database_path(&home.path);
    let conn = open_database(&db_path).expect("open fixture database");
    let reloaded = get_job(&conn, "00813")
        .expect("query job")
        .expect("job row exists");
    assert_eq!(
        reloaded.permission_denials, finished.permission_denials,
        "the PermissionDenials column must round-trip"
    );
}

/// (9) The outcome log carries the evidence, and does not eat the agent log already in the file.
#[tokio::test]
async fn outcome_summary_is_written_to_the_job_log() {
    let home = HomeFixture::new("deliv-outcome");
    let plan_folder = home.write_plan(
        "00711-Outcome",
        &executing_plan(
            &["abc1234", "def5678"],
            ("RustTest", VerificationStatus::Pass),
        ),
    );

    let job = job_of(
        "ExecutePlan",
        "00814",
        plan_folder.to_string_lossy().as_ref(),
    );
    append_agent_log(&home.path, &job.id, "Implementing", Some("did the thing")).unwrap();

    run_finish(&home, job, JobStatus::Completed).await;

    let log = read_job_log(&home.path, "00814")
        .expect("read job log")
        .expect("log exists");

    assert!(log.contains("## Agent Log"), "the prior log must survive");
    assert!(log.contains("## Job Outcome"));
    assert!(log.contains("**Commits:** 2"));
    assert!(log.contains("- abc1234"));
    assert!(log.contains("- def5678"));
    assert!(log.contains("- RustTest: Pass"));
    assert!(
        log.contains(&format!("**Final State:** {}", PlanStatus::Review)),
        "the log must record where the plan ended up, got:\n{}",
        log
    );
}

/// (12) Regression guard: a job type outside the verified set still completes on exit 0 with a plan
/// that has neither commits nor settled verifications — exactly the shape that now fails an
/// `ExecutePlan` — and its plan lands where it always did.
#[tokio::test]
async fn unverified_job_types_still_complete_with_no_plan_changes() {
    // The state each of these has always moved its plan to on success, per `plan_state_on_success`.
    let cases = [
        ("ExpandPlan", PlanStatus::Draft),
        ("UpdatePlan", PlanStatus::Draft),
        ("SplitPlan", PlanStatus::Skipped),
        ("CreateIssue", PlanStatus::Completed),
    ];

    for (job_type, expected_state) in cases {
        let home = HomeFixture::new("deliv-passthrough");
        let plan_folder = home.write_plan(
            "00712-Passthrough",
            &plan_with(
                PlanStatus::Draft,
                &[("RustTest", VerificationStatus::Pending)],
            ),
        );

        let job = job_of(job_type, "00815", plan_folder.to_string_lossy().as_ref());
        let finished = run_finish(&home, job, JobStatus::Completed).await;

        assert_eq!(
            finished.status,
            JobStatus::Completed,
            "{} has no deliverable check and must be unaffected",
            job_type
        );
        // `updated` is refreshed by the existing success path, so compare the state rather than the
        // whole file: what must not change is where the plan ended up.
        assert_eq!(
            plan_state(&plan_folder),
            expected_state.to_string(),
            "{} must still land its plan in {}",
            job_type,
            expected_state
        );
        assert_eq!(
            finished.plan_file,
            plan_folder.to_string_lossy().to_string(),
            "{} must not have its plan_file rewritten",
            job_type
        );
    }
}

/// A `Blocked` job row whose plan is still blocked stays put: nothing here may start work the
/// dependency gate would refuse.
#[tokio::test]
async fn a_still_blocked_job_row_is_not_restarted() {
    let home = HomeFixture::new("deliv-blocked");
    let upstream = home.write_plan("00713-Upstream", &plan_with(PlanStatus::Draft, &[]));

    let mut dependent = plan_with(PlanStatus::Blocked, &[]);
    dependent.depends_on = vec!["00713-Upstream".to_string()];
    let dependent_folder = home.write_plan("00714-Dependent", &dependent);

    let mut blocked = job_of(
        "ExecutePlan",
        "00816",
        dependent_folder.to_string_lossy().as_ref(),
    );
    blocked.status = JobStatus::Blocked;
    let db_path = get_database_path(&home.path);
    {
        let conn = open_database(&db_path).expect("open fixture database");
        insert_new_job(&conn, &blocked).expect("insert blocked row");
    }

    // A completion for an unrelated plan, so the release pass runs with the upstream still in Draft.
    let done_folder = home.write_plan(
        "00715-Unrelated",
        &executing_plan(&["abc1234"], ("RustTest", VerificationStatus::Pass)),
    );
    let job = job_of(
        "ExecutePlan",
        "00817",
        done_folder.to_string_lossy().as_ref(),
    );
    let jobs_map = Arc::new(RwLock::new(HashMap::new()));
    let finished = run_finish(&home, job, JobStatus::Completed).await;
    assert_eq!(finished.status, JobStatus::Completed);

    tendril_core::jobs::dependents::release_dependents(
        &home.path,
        &home.plans_dir(),
        &jobs_map,
        None,
        &finished,
    )
    .await;

    let conn = open_database(&db_path).expect("open fixture database");
    let row = get_job(&conn, "00816")
        .expect("query job")
        .expect("blocked row survives");
    assert_eq!(
        row.status,
        JobStatus::Blocked,
        "an unsatisfied dependency must keep the row blocked"
    );
    assert_eq!(
        plan_state(&dependent_folder),
        PlanStatus::Blocked.to_string()
    );
    assert!(upstream.is_dir());
}

/// (10) Once the blocker is done, the dependent plan leaves `Blocked` on the next release pass.
#[tokio::test]
async fn dependents_are_released_on_completion() {
    let home = HomeFixture::new("deliv-release");

    // The blocker: a completed plan with a merged PR is what `check_dependencies` wants.
    let mut upstream = plan_with(PlanStatus::Completed, &[]);
    upstream.commits = vec!["abc1234".to_string()];
    home.write_plan("00716-Blocker", &upstream);

    let mut dependent = plan_with(PlanStatus::Blocked, &[]);
    dependent.depends_on = vec!["00716-Blocker".to_string()];
    let dependent_folder = home.write_plan("00717-Waiting", &dependent);

    let done_folder = home.write_plan(
        "00718-Finished",
        &executing_plan(&["abc1234"], ("RustTest", VerificationStatus::Pass)),
    );
    let job = job_of(
        "ExecutePlan",
        "00818",
        done_folder.to_string_lossy().as_ref(),
    );
    let jobs_map = Arc::new(RwLock::new(HashMap::new()));
    let finished = run_finish(&home, job, JobStatus::Completed).await;

    let report = tendril_core::jobs::dependents::release_dependents(
        &home.path,
        &home.plans_dir(),
        &jobs_map,
        None,
        &finished,
    )
    .await;

    assert!(
        report.unblocked_plans.iter().any(|p| p.contains("00717")),
        "the satisfied dependent must be reported, got: {:?}",
        report.unblocked_plans
    );
    assert_eq!(
        plan_state(&dependent_folder),
        PlanStatus::Draft.to_string(),
        "a satisfied dependent goes back to Draft"
    );
}

/// A `CreatePlan` that failed outright must not leave an empty folder behind either — it would read
/// as a real plan nobody ever wrote.
#[tokio::test]
async fn a_failed_create_plan_cleans_up_its_empty_folder() {
    let home = HomeFixture::new("deliv-create-failed");
    let plan_folder = home.write_plan("00719-Abandoned", &plan_with(PlanStatus::Draft, &[]));

    let mut job = job_of("CreatePlan", "00819", "");
    job.reported_plan_id = Some("00719".to_string());

    let finished = run_finish(&home, job, JobStatus::Failed).await;

    assert_eq!(finished.status, JobStatus::Failed);
    assert!(
        !plan_folder.exists(),
        "a killed CreatePlan leaves no empty folder behind"
    );
}

/// The same run, but it did write a revision before dying: that is real work and must be kept.
#[tokio::test]
async fn a_failed_create_plan_keeps_a_folder_that_has_a_revision() {
    let home = HomeFixture::new("deliv-create-failed-kept");
    let plan_folder = home.write_plan("00720-PartlyWritten", &plan_with(PlanStatus::Draft, &[]));
    write_revision(&plan_folder);

    let mut job = job_of("CreatePlan", "00820", "");
    job.reported_plan_id = Some("00720".to_string());

    run_finish(&home, job, JobStatus::Failed).await;

    assert!(
        plan_folder.is_dir(),
        "a folder with a revision in it is real work"
    );
}

/// Belt and braces on the destructive path: the cleanup guard refuses anything that is not a
/// `NNNNN-` folder directly under the plans directory.
#[test]
fn cleanup_refuses_a_folder_outside_the_plans_dir() {
    let home = HomeFixture::new("deliv-cleanup-guard");
    let outside = home.path.join("00001-NotAPlan");
    std::fs::create_dir_all(&outside).unwrap();

    assert!(
        !tendril_core::jobs::deliverable::cleanup_plan_folder_and_database(
            &home.path,
            &home.plans_dir(),
            &outside
        )
    );
    assert!(outside.is_dir(), "the folder must be left alone");
}

/// A plan folder written straight into the plans dir keeps `write_plan_yaml` honest for the fixtures
/// above: every one of them relies on the state it reads back being the state the code wrote.
#[test]
fn fixture_plans_round_trip_their_state() {
    let home = HomeFixture::new("deliv-roundtrip");
    let folder = home.write_plan("00721-RoundTrip", &plan_with(PlanStatus::Executing, &[]));
    let (mut plan, _) = tendril_core::plans::reader::read_plan_yaml(&folder).unwrap();
    plan.state = PlanStatus::Failed.to_string();
    write_plan_yaml(&folder, &plan).unwrap();
    assert_eq!(plan_state(&folder), PlanStatus::Failed.to_string());
}

// ---------------------------------------------------------------------------
// Husk plans: a CreatePlan killed between `plan create` and `write-revision`
// ---------------------------------------------------------------------------
//
// The operator's plans 00003 and 00004. Eighteen `CreatePlan` jobs were started within 200ms of each
// other and then stopped all at once; two of them had already run `tendril plan create` but had not
// yet run `tendril job status --plan-id`, so their rows carried an empty `PlanFile`, an empty
// `ReportedPlanId`, and their logs held no `PlanId:` marker. Every strategy
// `resolve_created_plan_folder` had was a way of asking the job which plan was its own, and the job
// did not know — so the cleanup found nothing to clean and the folders stayed on disk, rendering in
// the plan list as plans with nothing in them.
//
// The fix is to stop asking the job. `tendril plan create` stamps `createdByJob` into `plan.yaml`
// from `TENDRIL_JOB_ID`, so the association is written by the command that makes the folder, before
// anything can be killed.

use tendril_core::plans::orphans::CREATED_BY_JOB_KEY;
use tendril_core::plans::writer::{create_plan, create_plan_for_job, CreatePlanOptions};

/// Creates a plan the way a job's `tendril plan create` would, breadcrumb and all.
fn create_plan_as_job(home: &HomeFixture, title: &str, job_id: &str) -> PathBuf {
    let opts = CreatePlanOptions::new(title, "FixtureProject");
    let plan_file =
        create_plan_for_job(&home.plans_dir(), opts, Some(job_id)).expect("create plan");
    PathBuf::from(plan_file.folder_path)
}

/// **The reported bug.** A stopped `CreatePlan` that never reported its plan id must still leave no
/// revision-less husk behind.
///
/// Every input here is set to the value the real jobs carried: no `plan_file`, no `reported_plan_id`,
/// and an output stream with no `PlanId:` line in it. Before the breadcrumb, this folder survived.
#[tokio::test]
async fn a_create_plan_stopped_before_it_reported_its_id_leaves_no_husk() {
    let home = HomeFixture::new("husk-stopped-unreported");
    let folder = create_plan_as_job(&home, "Ship The VSCode Extension", "00013");
    seed_plan_row(&home, &folder);
    let plan_id = 1;
    assert!(folder.is_dir() && plan_row_exists(&home, plan_id));

    // The job as the database held it: it never learned which plan it had made.
    let mut job = job_of("CreatePlan", "00013", "");
    job.reported_plan_id = None;
    assert!(job.plan_file.is_empty());

    // Not a single `PlanId:` marker — the agent died before printing one.
    append_agent_log(&home.path, &job.id, "Researching codebase", None).unwrap();

    let finished = run_finish(&home, job, JobStatus::Stopped).await;

    assert!(
        !folder.exists(),
        "a stopped CreatePlan must not leave a revision-less husk at {}",
        folder.display()
    );
    assert!(
        !plan_row_exists(&home, plan_id),
        "the husk's database row must go with the folder"
    );
    assert!(
        finished.plan_file.is_empty(),
        "nothing left to link to: {}",
        finished.plan_file
    );
}

/// The same kill, but the run had got as far as writing the revision. That is a real plan and an
/// interrupted job, not a husk — the folder is the operator's recovery material.
#[tokio::test]
async fn a_stopped_create_plan_that_wrote_its_revision_keeps_the_plan() {
    let home = HomeFixture::new("husk-stopped-with-revision");
    let folder = create_plan_as_job(&home, "Real Plan", "00014");
    write_revision(&folder);
    seed_plan_row(&home, &folder);

    let mut job = job_of("CreatePlan", "00014", "");
    job.reported_plan_id = None;
    let finished = run_finish(&home, job, JobStatus::Stopped).await;

    assert!(folder.is_dir(), "a plan with a revision is real work");
    assert!(plan_row_exists(&home, 1), "its row stays too");
    assert_eq!(
        PathBuf::from(&finished.plan_file),
        folder,
        "and the job is linked to it, so the operator can find it"
    );
}

/// **The safety valve, and the reason 00003 could not simply be deleted.** A revision-less plan that
/// holds work the agent produced is reported, never removed: the breadcrumb makes this folder
/// resolvable for the first time, and the cost of getting the judgement wrong is an agent's output.
#[tokio::test]
async fn a_stopped_create_plan_holding_work_is_kept_even_though_it_has_no_revision() {
    let home = HomeFixture::new("husk-has-wireframes");
    let folder = create_plan_as_job(&home, "Ship The VSCode Extension", "00010");
    std::fs::create_dir_all(folder.join("Wireframes").join("editor")).unwrap();
    std::fs::write(folder.join("Wireframes/editor/App.tsx"), b"export {}").unwrap();
    seed_plan_row(&home, &folder);

    let mut job = job_of("CreatePlan", "00010", "");
    job.reported_plan_id = None;
    run_finish(&home, job, JobStatus::Stopped).await;

    assert!(
        folder.join("Wireframes/editor/App.tsx").is_file(),
        "a wireframe the agent built is not ours to delete"
    );
    assert!(plan_row_exists(&home, 1), "and its row stays with it");
}

/// The breadcrumb resolves by exact job id, so a plan the operator created by hand — which carries no
/// breadcrumb at all — can never be selected as some job's orphan.
#[tokio::test]
async fn a_handmade_plan_is_never_attributed_to_a_stopped_job() {
    let home = HomeFixture::new("husk-handmade");
    // No `created_by_job`: this is `tendril plan create` run by a person, or the New Plan dialog.
    let handmade = create_plan(
        &home.plans_dir(),
        CreatePlanOptions::new("My Own Plan", "FixtureProject"),
    )
    .expect("create plan");
    let folder = PathBuf::from(handmade.folder_path);
    seed_plan_row(&home, &folder);

    let mut job = job_of("CreatePlan", "00013", "");
    job.reported_plan_id = None;
    run_finish(&home, job, JobStatus::Stopped).await;

    assert!(
        folder.is_dir(),
        "a plan nobody's job created must survive that job being stopped"
    );
    assert!(plan_row_exists(&home, 1));
}

/// The breadcrumb is a fallback, not a replacement: the cheap strategies still win, and a job that
/// did report its id resolves through that as before.
#[tokio::test]
async fn the_reported_id_still_resolves_without_a_breadcrumb() {
    let home = HomeFixture::new("husk-reported-id");
    let folder = home.write_plan("00021-Reported", &plan_with(PlanStatus::Draft, &[]));
    seed_plan_row(&home, &folder);

    let mut job = job_of("CreatePlan", "00055", "");
    job.reported_plan_id = Some("00021".to_string());
    let finished = run_finish(&home, job, JobStatus::Stopped).await;

    assert!(
        !folder.exists(),
        "an empty reported folder is still cleaned"
    );
    assert!(finished.plan_file.is_empty());
}

/// `create_plan` records the breadcrumb only when a job asked for the plan, and it survives a
/// read-modify-write of `plan.yaml` (it rides in the flattened `extra` map).
#[test]
fn the_breadcrumb_round_trips_and_is_absent_for_a_handmade_plan() {
    let home = HomeFixture::new("husk-breadcrumb-roundtrip");
    let folder = create_plan_as_job(&home, "Stamped", "00013");

    let (mut plan, _) = tendril_core::plans::reader::read_plan_yaml(&folder).unwrap();
    assert_eq!(
        plan.extra.get(CREATED_BY_JOB_KEY).and_then(|v| v.as_str()),
        Some("00013")
    );

    // A later write of the plan must not drop it: the cleanup runs after the agent has edited it.
    plan.state = PlanStatus::Executing.to_string();
    write_plan_yaml(&folder, &plan).unwrap();
    let (reread, _) = tendril_core::plans::reader::read_plan_yaml(&folder).unwrap();
    assert_eq!(
        reread
            .extra
            .get(CREATED_BY_JOB_KEY)
            .and_then(|v| v.as_str()),
        Some("00013"),
        "the breadcrumb must survive a read-modify-write"
    );

    let handmade = create_plan(
        &home.plans_dir(),
        CreatePlanOptions::new("Unstamped", "FixtureProject"),
    )
    .unwrap();
    let (plain, raw) =
        tendril_core::plans::reader::read_plan_yaml(Path::new(&handmade.folder_path)).unwrap();
    assert!(!plain.extra.contains_key(CREATED_BY_JOB_KEY));
    assert!(
        !raw.contains(CREATED_BY_JOB_KEY),
        "a handmade plan's yaml gains no new key: {}",
        raw
    );
}
