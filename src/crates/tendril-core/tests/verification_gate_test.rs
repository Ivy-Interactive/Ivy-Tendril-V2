mod common;

use common::{plan_with, write_verification_report, HomeFixture};
use tendril_core::jobs::{
    fallback_previous_state, in_flight_plan_state, plan_state_on_success, revert_target,
};
use tendril_core::models::{PlanStatus, VerificationStatus};
use tendril_core::plans::verification_gate::{
    incomplete_verifications, parse_verification_result, read_pre_execution_result,
    resolve_post_execution_state,
};

#[test]
fn all_passing_verifications_reach_review() {
    let home = HomeFixture::new("gate-pass");
    let plan = plan_with(
        PlanStatus::Executing,
        &[
            ("Build", VerificationStatus::Pass),
            ("Test", VerificationStatus::Pass),
        ],
    );
    let folder = home.write_plan("00001-Pass", &plan);

    assert!(incomplete_verifications(&plan).is_empty());
    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Review
    );
}

#[test]
fn a_pending_verification_fails_the_plan() {
    let home = HomeFixture::new("gate-pending");
    let plan = plan_with(
        PlanStatus::Executing,
        &[
            ("Build", VerificationStatus::Pass),
            ("Test", VerificationStatus::Pending),
        ],
    );
    let folder = home.write_plan("00001-Pending", &plan);

    assert_eq!(incomplete_verifications(&plan), vec!["Test".to_string()]);
    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Failed
    );
}

#[test]
fn a_failed_verification_fails_the_plan() {
    let home = HomeFixture::new("gate-fail");
    let plan = plan_with(
        PlanStatus::Executing,
        &[
            ("Build", VerificationStatus::Pass),
            ("Test", VerificationStatus::Fail),
        ],
    );
    let folder = home.write_plan("00001-Fail", &plan);

    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Failed
    );
}

#[test]
fn all_skipped_verifications_reach_review() {
    let home = HomeFixture::new("gate-skipped");
    let plan = plan_with(
        PlanStatus::Executing,
        &[
            ("Build", VerificationStatus::Skipped),
            ("Test", VerificationStatus::Skipped),
        ],
    );
    let folder = home.write_plan("00001-Skipped", &plan);

    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Review
    );
}

#[test]
fn no_verifications_at_all_reaches_review() {
    let home = HomeFixture::new("gate-empty");
    let plan = plan_with(PlanStatus::Executing, &[]);
    let folder = home.write_plan("00001-Empty", &plan);

    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Review
    );
}

/// `plan.yaml` verification rows carry no `required` flag, and the gate deliberately does not consult
/// the project config for one: a row left `Pending` is a row the operator asked to have run.
#[test]
fn a_pending_row_is_not_excused_for_being_optional() {
    let home = HomeFixture::new("gate-optional");
    let plan = plan_with(
        PlanStatus::Executing,
        &[
            ("RequiredCheck", VerificationStatus::Pass),
            ("OptionalCheck", VerificationStatus::Pending),
        ],
    );
    let folder = home.write_plan("00001-Optional", &plan);

    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Failed
    );
}

#[test]
fn a_failing_pre_execution_report_fails_an_otherwise_passing_plan() {
    let home = HomeFixture::new("gate-preexec");
    let plan = plan_with(
        PlanStatus::Executing,
        &[("Build", VerificationStatus::Pass)],
    );
    let folder = home.write_plan("00001-PreExec", &plan);

    write_verification_report(
        &folder,
        "PreExecution",
        "---\nresult: Fail\n---\n\nThe plan's code blocks no longer match the repo.\n",
    );

    assert_eq!(
        read_pre_execution_result(&folder),
        Some(VerificationStatus::Fail)
    );
    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Failed
    );
}

#[test]
fn a_passing_pre_execution_report_does_not_block_review() {
    let home = HomeFixture::new("gate-preexec-pass");
    let plan = plan_with(
        PlanStatus::Executing,
        &[("Build", VerificationStatus::Pass)],
    );
    let folder = home.write_plan("00001-PreExecPass", &plan);

    write_verification_report(
        &folder,
        "PreExecution",
        "---\nname: PreExecution\nresult: Pass\n---\n\nAll blocks matched.\n",
    );

    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Review
    );
}

#[test]
fn an_absent_or_unparseable_pre_execution_report_decides_on_rows_alone() {
    let home = HomeFixture::new("gate-preexec-garbage");
    let plan = plan_with(
        PlanStatus::Executing,
        &[("Build", VerificationStatus::Pass)],
    );
    let folder = home.write_plan("00001-Garbage", &plan);

    // Absent.
    assert_eq!(read_pre_execution_result(&folder), None);
    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Review
    );

    // Present but says nothing a machine can act on.
    write_verification_report(
        &folder,
        "PreExecution",
        "I checked it and it seemed fine.\n",
    );
    assert_eq!(read_pre_execution_result(&folder), None);
    assert_eq!(
        resolve_post_execution_state(&plan, &folder),
        PlanStatus::Review
    );
}

#[test]
fn the_legacy_result_line_is_still_parsed() {
    assert_eq!(
        parse_verification_result("# Report\n\n- **Result:** Fail\n"),
        Some(VerificationStatus::Fail)
    );
    assert_eq!(
        parse_verification_result("# Report\n\n- **result:** pass\n"),
        Some(VerificationStatus::Pass)
    );
    // Frontmatter wins when both are present.
    assert_eq!(
        parse_verification_result("---\nresult: Pass\n---\n\n- **Result:** Fail\n"),
        Some(VerificationStatus::Pass)
    );
    // Quoted frontmatter values.
    assert_eq!(
        parse_verification_result("---\nresult: \"Skipped\"\n---\n"),
        Some(VerificationStatus::Skipped)
    );
}

#[test]
fn in_flight_states_cover_every_plan_scoped_job_type() {
    assert_eq!(
        in_flight_plan_state("ExecutePlan"),
        Some(PlanStatus::Executing)
    );
    assert_eq!(
        in_flight_plan_state("RetryPlan"),
        Some(PlanStatus::Executing)
    );
    assert_eq!(
        in_flight_plan_state("CreatePlan"),
        Some(PlanStatus::Creating)
    );
    assert_eq!(
        in_flight_plan_state("ExpandPlan"),
        Some(PlanStatus::Creating)
    );
    assert_eq!(
        in_flight_plan_state("UpdatePlan"),
        Some(PlanStatus::Updating)
    );
    assert_eq!(
        in_flight_plan_state("SplitPlan"),
        Some(PlanStatus::Updating)
    );
    // Jobs that do not own a plan's lifecycle leave its state alone.
    assert_eq!(in_flight_plan_state("CreatePr"), None);
    assert_eq!(in_flight_plan_state("CreateIssue"), None);
    assert_eq!(in_flight_plan_state("SyncRepo"), None);
    assert_eq!(in_flight_plan_state("SetupProject"), None);
    assert_eq!(in_flight_plan_state("AddProject"), None);
}

#[test]
fn success_states_route_execution_jobs_through_the_gate() {
    let home = HomeFixture::new("gate-success-table");

    let passing = plan_with(
        PlanStatus::Executing,
        &[("Build", VerificationStatus::Pass)],
    );
    let passing_folder = home.write_plan("00001-Passing", &passing);
    let pending = plan_with(
        PlanStatus::Executing,
        &[("Build", VerificationStatus::Pending)],
    );
    let pending_folder = home.write_plan("00002-Pending", &pending);

    for job_type in ["ExecutePlan", "RetryPlan"] {
        assert_eq!(
            plan_state_on_success(job_type, &passing, &passing_folder),
            Some(PlanStatus::Review),
            "{} with all rows passing",
            job_type
        );
        assert_eq!(
            plan_state_on_success(job_type, &pending, &pending_folder),
            Some(PlanStatus::Failed),
            "{} with a pending row",
            job_type
        );
    }

    for job_type in ["CreatePlan", "UpdatePlan", "ExpandPlan"] {
        assert_eq!(
            plan_state_on_success(job_type, &pending, &pending_folder),
            Some(PlanStatus::Draft),
            "{} leaves the plan a draft regardless of rows",
            job_type
        );
    }

    assert_eq!(
        plan_state_on_success("SplitPlan", &passing, &passing_folder),
        Some(PlanStatus::Skipped)
    );
    assert_eq!(
        plan_state_on_success("CreateIssue", &passing, &passing_folder),
        Some(PlanStatus::Completed)
    );
    // CreatePr sets Completed itself, from inside the promptware.
    assert_eq!(
        plan_state_on_success("CreatePr", &passing, &passing_folder),
        None
    );
    assert_eq!(
        plan_state_on_success("SyncRepo", &passing, &passing_folder),
        None
    );
}

#[test]
fn a_failed_job_reverts_the_plan_to_its_captured_state() {
    assert_eq!(
        revert_target(Some("Review"), "RetryPlan"),
        Some(PlanStatus::Review)
    );
    assert_eq!(
        revert_target(Some("Draft"), "ExecutePlan"),
        Some(PlanStatus::Draft)
    );
    assert_eq!(
        revert_target(Some("Icebox"), "ExecutePlan"),
        Some(PlanStatus::Icebox)
    );

    // Re-entering Blocked without re-running the dependency gate would strand the plan.
    assert_eq!(
        revert_target(Some("Blocked"), "ExecutePlan"),
        Some(PlanStatus::Draft)
    );

    // No captured state (a pre-00058 row, or a restart) falls back per job type.
    assert_eq!(revert_target(None, "ExecutePlan"), Some(PlanStatus::Draft));
    assert_eq!(revert_target(None, "RetryPlan"), Some(PlanStatus::Review));
    assert_eq!(revert_target(None, "CreatePr"), None);
    assert_eq!(
        revert_target(Some("nonsense"), "RetryPlan"),
        Some(PlanStatus::Review)
    );

    assert_eq!(
        fallback_previous_state("SplitPlan"),
        Some(PlanStatus::Draft)
    );
    assert_eq!(fallback_previous_state("SyncRepo"), None);
}
