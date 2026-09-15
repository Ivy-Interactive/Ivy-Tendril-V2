//! `plan verification list` promises the prompts a run-ordered list, and run order is the
//! project config's order. These tests pin that ordering and the exact JSON shape, so a change to
//! either breaks a test rather than an ExecutePlan job.

use tendril_core::config::{
    insert_project_verification, move_project_verification, VerificationPlacement,
};
use tendril_core::models::{
    PlanVerificationEntry, ProjectConfig, ProjectVerificationRef, VerificationStatus,
};
use tendril_core::plans::order_by_project_config;

fn plan_entries(names: &[&str]) -> Vec<PlanVerificationEntry> {
    names
        .iter()
        .map(|n| PlanVerificationEntry {
            name: n.to_string(),
            status: VerificationStatus::Pending,
        })
        .collect()
}

fn project_refs(names: &[&str]) -> Vec<ProjectVerificationRef> {
    names
        .iter()
        .map(|n| ProjectVerificationRef {
            name: n.to_string(),
            required: true,
            extra: Default::default(),
        })
        .collect()
}

fn names_of(entries: &[PlanVerificationEntry]) -> Vec<&str> {
    entries.iter().map(|e| e.name.as_str()).collect()
}

fn project_with(names: &[&str]) -> ProjectConfig {
    ProjectConfig {
        name: "TestProj".to_string(),
        color: "Blue".to_string(),
        verifications: project_refs(names),
        ..Default::default()
    }
}

fn project_names(project: &ProjectConfig) -> Vec<&str> {
    project
        .verifications
        .iter()
        .map(|v| v.name.as_str())
        .collect()
}

#[test]
fn order_by_project_config_uses_project_order() {
    let plan = plan_entries(&["RustTest", "NpmLint", "RustBuild"]);
    let project = project_refs(&["NpmLint", "RustBuild", "RustTest"]);

    let ordered = order_by_project_config(&plan, Some(&project));
    assert_eq!(names_of(&ordered), vec!["NpmLint", "RustBuild", "RustTest"]);
}

#[test]
fn check_result_stays_last() {
    let plan = plan_entries(&["CheckResult", "NpmLint", "RustTest"]);
    let project = project_refs(&["NpmLint", "RustTest", "CheckResult"]);

    let ordered = order_by_project_config(&plan, Some(&project));
    assert_eq!(
        ordered.last().map(|e| e.name.as_str()),
        Some("CheckResult"),
        "CheckResult has to run last: {:?}",
        names_of(&ordered)
    );
}

#[test]
fn entries_absent_from_project_config_sort_last_stably() {
    let plan = plan_entries(&["Zebra", "RustTest", "Alpha", "NpmLint"]);
    let project = project_refs(&["NpmLint", "RustTest"]);

    let ordered = order_by_project_config(&plan, Some(&project));
    // The two unknown names keep their plan-order relationship rather than being sorted.
    assert_eq!(
        names_of(&ordered),
        vec!["NpmLint", "RustTest", "Zebra", "Alpha"]
    );
}

#[test]
fn order_is_plan_order_when_the_project_is_unknown() {
    let plan = plan_entries(&["RustTest", "NpmLint"]);

    let ordered = order_by_project_config(&plan, None);
    assert_eq!(names_of(&ordered), vec!["RustTest", "NpmLint"]);
}

#[test]
fn order_matching_ignores_name_case() {
    let plan = plan_entries(&["rusttest", "NPMLINT"]);
    let project = project_refs(&["NpmLint", "RustTest"]);

    let ordered = order_by_project_config(&plan, Some(&project));
    assert_eq!(names_of(&ordered), vec!["NPMLINT", "rusttest"]);
}

#[test]
fn list_json_shape_is_name_status_in_run_order() {
    let plan = vec![
        PlanVerificationEntry {
            name: "CheckResult".to_string(),
            status: VerificationStatus::Pending,
        },
        PlanVerificationEntry {
            name: "NpmLint".to_string(),
            status: VerificationStatus::Pass,
        },
    ];
    let project = project_refs(&["NpmLint", "CheckResult"]);
    let ordered = order_by_project_config(&plan, Some(&project));

    // This is the literal string the prompts parse. Asserting it exactly means a shape change
    // fails here instead of silently breaking ExecutePlan's run-set parsing.
    let payload: Vec<serde_json::Value> = ordered
        .iter()
        .map(|e| serde_json::json!({ "name": e.name, "status": e.status.as_str() }))
        .collect();
    assert_eq!(
        serde_json::to_string(&payload).unwrap(),
        r#"[{"name":"NpmLint","status":"Pass"},{"name":"CheckResult","status":"Pending"}]"#
    );
}

#[test]
fn move_verification_resolves_placement_against_the_shortened_list() {
    // Moving an entry forward is the case that exposes a wrong insert index: resolving `--after`
    // against the original list would land NpmLint one slot too far right.
    let mut project = project_with(&["NpmLint", "RustBuild", "RustTest", "CheckResult"]);

    let index = move_project_verification(
        &mut project,
        "NpmLint",
        &VerificationPlacement::After("RustBuild".to_string()),
    )
    .expect("move NpmLint after RustBuild");

    assert_eq!(index, 1);
    assert_eq!(
        project_names(&project),
        vec!["RustBuild", "NpmLint", "RustTest", "CheckResult"]
    );
}

#[test]
fn move_verification_position_and_after_agree_on_last_place() {
    for placement in [
        VerificationPlacement::Position(3),
        VerificationPlacement::After("RustTest".to_string()),
    ] {
        let mut project = project_with(&["CheckResult", "NpmLint", "RustBuild", "RustTest"]);
        move_project_verification(&mut project, "CheckResult", &placement)
            .expect("move CheckResult last");
        assert_eq!(
            project_names(&project).last(),
            Some(&"CheckResult"),
            "placement {:?} should put CheckResult last",
            placement
        );
    }
}

#[test]
fn move_verification_clamps_an_out_of_range_position() {
    let mut project = project_with(&["NpmLint", "RustBuild"]);
    let index = move_project_verification(
        &mut project,
        "NpmLint",
        &VerificationPlacement::Position(99),
    )
    .expect("clamped position");

    assert_eq!(index, 1);
    assert_eq!(project_names(&project), vec!["RustBuild", "NpmLint"]);
}

#[test]
fn move_verification_unknown_target_leaves_order_unchanged() {
    let mut project = project_with(&["NpmLint", "RustBuild", "CheckResult"]);

    let err = move_project_verification(
        &mut project,
        "NpmLint",
        &VerificationPlacement::Before("Nope".to_string()),
    )
    .expect_err("unknown --before target should error");
    assert!(
        err.to_string().contains("--before"),
        "error should name the failing option: {}",
        err
    );
    assert_eq!(
        project_names(&project),
        vec!["NpmLint", "RustBuild", "CheckResult"],
        "a failed move must not reorder anything"
    );
}

#[test]
fn move_verification_unknown_verification_errors() {
    let mut project = project_with(&["NpmLint"]);
    let err = move_project_verification(&mut project, "Nope", &VerificationPlacement::Position(0))
        .expect_err("unknown verification should error");
    assert!(
        err.to_string().contains("Verification not found"),
        "{}",
        err
    );
}

#[test]
fn insert_verification_after_places_it_behind_the_target() {
    let mut project = project_with(&["NpmLint", "RustBuild", "CheckResult"]);

    let index = insert_project_verification(
        &mut project,
        ProjectVerificationRef {
            name: "RustClippy".to_string(),
            required: true,
            extra: Default::default(),
        },
        Some("NpmLint"),
    )
    .expect("insert after NpmLint");

    assert_eq!(index, 1);
    assert_eq!(
        project_names(&project),
        vec!["NpmLint", "RustClippy", "RustBuild", "CheckResult"]
    );
}

#[test]
fn insert_verification_without_after_appends() {
    let mut project = project_with(&["NpmLint"]);
    let index = insert_project_verification(
        &mut project,
        ProjectVerificationRef {
            name: "CheckResult".to_string(),
            required: false,
            extra: Default::default(),
        },
        None,
    )
    .expect("append");

    assert_eq!(index, 1);
    assert!(!project.verifications[1].required);
}

#[test]
fn insert_verification_rejects_a_duplicate() {
    let mut project = project_with(&["NpmLint"]);
    let err = insert_project_verification(
        &mut project,
        ProjectVerificationRef {
            name: "npmlint".to_string(),
            required: true,
            extra: Default::default(),
        },
        None,
    )
    .expect_err("duplicate should error");
    assert!(err.to_string().contains("already exists"), "{}", err);
    assert_eq!(project.verifications.len(), 1);
}
