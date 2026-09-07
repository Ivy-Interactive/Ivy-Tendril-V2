mod common;

use common::{plan_state, plan_with, HomeFixture};
use tendril_core::error::{Result, TendrilError};
use tendril_core::models::{PlanStatus, VerificationStatus};
use tendril_core::plans::dependencies::{check_dependencies_with, unblock_satisfied_plans_with};

/// Stub PR-state resolver: no `gh`, no network. Panics if asked about a URL the test did not set up,
/// so a test can never silently fall through to a default.
fn resolver_returning(state: &'static str) -> impl Fn(&str) -> Result<String> {
    move |_url: &str| Ok(state.to_string())
}

fn failing_resolver(_url: &str) -> Result<String> {
    Err(TendrilError::Git("gh: could not resolve host".to_string()))
}

fn never_called_resolver(url: &str) -> Result<String> {
    panic!("PR state resolver must not be called, but was asked about {url}");
}

#[test]
fn a_missing_dependency_folder_blocks() {
    let home = HomeFixture::new("dep-missing");
    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.depends_on = vec!["00099-DoesNotExist".to_string()];
    let folder = home.write_plan("00001-Dependent", &plan);

    let res = check_dependencies_with(&folder, &home.plans_dir(), &never_called_resolver)
        .expect("gate should not error");
    assert!(!res.ok);
    assert!(
        res.block_reason
            .as_deref()
            .unwrap()
            .contains("00099-DoesNotExist"),
        "reason should name the missing dependency: {:?}",
        res.block_reason
    );
}

#[test]
fn a_dependency_that_is_not_completed_blocks() {
    let home = HomeFixture::new("dep-draft");
    home.write_plan("00002-Upstream", &plan_with(PlanStatus::Draft, &[]));

    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.depends_on = vec!["00002-Upstream".to_string()];
    let folder = home.write_plan("00001-Dependent", &plan);

    let res = check_dependencies_with(&folder, &home.plans_dir(), &never_called_resolver).unwrap();
    assert!(!res.ok);
    let reason = res.block_reason.unwrap();
    assert!(reason.contains("00002-Upstream"), "{}", reason);
    assert!(reason.contains("Draft"), "{}", reason);
}

#[test]
fn a_completed_dependency_with_an_open_pr_blocks() {
    let home = HomeFixture::new("dep-open-pr");
    let mut upstream = plan_with(
        PlanStatus::Completed,
        &[("Build", VerificationStatus::Pass)],
    );
    upstream.prs = vec!["https://github.com/acme/widgets/pull/7".to_string()];
    home.write_plan("00002-Upstream", &upstream);

    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.depends_on = vec!["00002-Upstream".to_string()];
    let folder = home.write_plan("00001-Dependent", &plan);

    let res =
        check_dependencies_with(&folder, &home.plans_dir(), &resolver_returning("OPEN")).unwrap();
    assert!(!res.ok);
    let reason = res.block_reason.unwrap();
    assert!(reason.contains("pull/7"), "{}", reason);
    assert!(reason.contains("OPEN"), "{}", reason);
}

#[test]
fn a_completed_dependency_with_a_merged_pr_passes() {
    let home = HomeFixture::new("dep-merged-pr");
    let mut upstream = plan_with(PlanStatus::Completed, &[]);
    upstream.prs = vec!["https://github.com/acme/widgets/pull/7".to_string()];
    home.write_plan("00002-Upstream", &upstream);

    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.depends_on = vec!["00002-Upstream".to_string()];
    let folder = home.write_plan("00001-Dependent", &plan);

    let res =
        check_dependencies_with(&folder, &home.plans_dir(), &resolver_returning("MERGED")).unwrap();
    assert!(res.ok, "block reason: {:?}", res.block_reason);
}

#[test]
fn a_completed_dependency_with_no_prs_passes() {
    let home = HomeFixture::new("dep-no-prs");
    home.write_plan("00002-Upstream", &plan_with(PlanStatus::Completed, &[]));

    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.depends_on = vec!["00002-Upstream".to_string()];
    let folder = home.write_plan("00001-Dependent", &plan);

    // The resolver must never be consulted: commit-only plans record no PRs.
    let res = check_dependencies_with(&folder, &home.plans_dir(), &never_called_resolver).unwrap();
    assert!(res.ok, "block reason: {:?}", res.block_reason);
}

#[test]
fn no_dependencies_passes_without_consulting_the_resolver() {
    let home = HomeFixture::new("dep-none");
    let folder = home.write_plan("00001-Independent", &plan_with(PlanStatus::Draft, &[]));

    let res = check_dependencies_with(&folder, &home.plans_dir(), &never_called_resolver).unwrap();
    assert!(res.ok);
    assert!(res.block_reason.is_none());
}

/// GitHub being unreachable must read as "cannot start yet", not as "starting the job failed".
#[test]
fn a_resolver_error_blocks_with_a_reason_instead_of_erroring() {
    let home = HomeFixture::new("dep-resolver-err");
    let mut upstream = plan_with(PlanStatus::Completed, &[]);
    upstream.prs = vec!["https://github.com/acme/widgets/pull/7".to_string()];
    home.write_plan("00002-Upstream", &upstream);

    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.depends_on = vec!["00002-Upstream".to_string()];
    let folder = home.write_plan("00001-Dependent", &plan);

    let res = check_dependencies_with(&folder, &home.plans_dir(), &failing_resolver)
        .expect("a resolver failure must not surface as Err");
    assert!(!res.ok);
    assert!(
        res.block_reason
            .as_deref()
            .unwrap()
            .contains("Could not determine PR state"),
        "{:?}",
        res.block_reason
    );
}

#[test]
fn a_dependency_cycle_blocks_instead_of_recursing() {
    let home = HomeFixture::new("dep-cycle");

    let mut a = plan_with(PlanStatus::Draft, &[]);
    a.depends_on = vec!["00002-B".to_string()];
    let a_folder = home.write_plan("00001-A", &a);

    let mut b = plan_with(PlanStatus::Draft, &[]);
    b.depends_on = vec!["00001-A".to_string()];
    home.write_plan("00002-B", &b);

    let res =
        check_dependencies_with(&a_folder, &home.plans_dir(), &never_called_resolver).unwrap();
    assert!(!res.ok);
    let reason = res.block_reason.unwrap();
    assert!(
        reason.starts_with("Dependency cycle detected:"),
        "expected a cycle report, got: {}",
        reason
    );
    assert_eq!(
        reason,
        "Dependency cycle detected: 00001-A -> 00002-B -> 00001-A"
    );
}

/// A diamond (`A → B`, `A → C`, `B → D`, `C → D`) revisits D but is not a cycle.
#[test]
fn a_diamond_dependency_graph_is_not_a_cycle() {
    let home = HomeFixture::new("dep-diamond");

    let mut d = plan_with(PlanStatus::Completed, &[]);
    d.depends_on = vec![];
    home.write_plan("00004-D", &d);

    for (name, deps) in [("00002-B", "00004-D"), ("00003-C", "00004-D")] {
        let mut p = plan_with(PlanStatus::Completed, &[]);
        p.depends_on = vec![deps.to_string()];
        home.write_plan(name, &p);
    }

    let mut a = plan_with(PlanStatus::Draft, &[]);
    a.depends_on = vec!["00002-B".to_string(), "00003-C".to_string()];
    let a_folder = home.write_plan("00001-A", &a);

    let res =
        check_dependencies_with(&a_folder, &home.plans_dir(), &never_called_resolver).unwrap();
    assert!(res.ok, "block reason: {:?}", res.block_reason);
}

#[test]
fn unblocking_moves_satisfied_plans_to_draft_and_leaves_the_rest() {
    let home = HomeFixture::new("dep-unblock");

    home.write_plan("00002-Done", &plan_with(PlanStatus::Completed, &[]));
    home.write_plan("00003-Pending", &plan_with(PlanStatus::Draft, &[]));

    let mut satisfied = plan_with(PlanStatus::Blocked, &[]);
    satisfied.depends_on = vec!["00002-Done".to_string()];
    let satisfied_folder = home.write_plan("00010-Satisfied", &satisfied);

    let mut unsatisfied = plan_with(PlanStatus::Blocked, &[]);
    unsatisfied.depends_on = vec!["00003-Pending".to_string()];
    let unsatisfied_folder = home.write_plan("00011-Unsatisfied", &unsatisfied);

    // A plan that is not Blocked must be left alone even though its dependencies are satisfied.
    let mut already_executing = plan_with(PlanStatus::Executing, &[]);
    already_executing.depends_on = vec!["00002-Done".to_string()];
    let executing_folder = home.write_plan("00012-Executing", &already_executing);

    let unblocked =
        unblock_satisfied_plans_with(&home.plans_dir(), &never_called_resolver).unwrap();
    assert_eq!(unblocked, vec!["00010-Satisfied".to_string()]);
    assert_eq!(plan_state(&satisfied_folder), "Draft");
    assert_eq!(plan_state(&unsatisfied_folder), "Blocked");
    assert_eq!(plan_state(&executing_folder), "Executing");

    // Idempotent: nothing is left to unblock on a second pass.
    let again = unblock_satisfied_plans_with(&home.plans_dir(), &never_called_resolver).unwrap();
    assert!(again.is_empty());
}

#[test]
fn unblocking_an_empty_or_missing_plans_dir_is_a_no_op() {
    let home = HomeFixture::new("dep-unblock-empty");
    assert!(
        unblock_satisfied_plans_with(&home.plans_dir(), &never_called_resolver)
            .unwrap()
            .is_empty()
    );
    assert!(
        unblock_satisfied_plans_with(&home.path.join("NoSuchDir"), &never_called_resolver)
            .unwrap()
            .is_empty()
    );
}
