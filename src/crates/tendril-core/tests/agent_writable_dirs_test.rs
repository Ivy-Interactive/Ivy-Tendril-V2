//! The directories a launch widens an agent's write access to.

mod common;

use common::HomeFixture;
use std::collections::HashMap;
use std::path::Path;
use tendril_core::config::TendrilSettings;
use tendril_core::jobs::firmware_values::resolve_writable_directories_with_env;

/// An environment with nothing in it. The operator's own `TENDRIL_PLANS` would otherwise override
/// the fixture home's plans dir and make every assertion below about the wrong machine.
fn no_env() -> HashMap<String, String> {
    HashMap::new()
}

/// Whether one of the granted roots covers `path` — the property that actually matters, since the
/// flags widen access transitively.
fn covers(dirs: &[String], path: &Path) -> bool {
    let candidate = path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    dirs.iter().any(|d| {
        let root = d.replace('\\', "/").to_ascii_lowercase();
        candidate == root || candidate.starts_with(&format!("{}/", root))
    })
}

fn home_str(home: &HomeFixture) -> String {
    home.path.to_string_lossy().to_string()
}

#[test]
fn a_plan_folder_inside_the_home_collapses_to_just_the_home() {
    let home = HomeFixture::new("wd-inside");
    let promptware = home.path.join("Promptwares").join("ExecutePlan");
    let plan_folder = home.plans_dir().join("00553-WireAgentLaunchConfigAll");

    let dirs = resolve_writable_directories_with_env(
        "ExecutePlan",
        &promptware,
        &plan_folder,
        &home.path,
        &TendrilSettings::default(),
        &no_env(),
    );

    // The plans dir, the promptware's Memory and Tools and the plan folder all live under the home,
    // so one flag is enough and the rest would be noise.
    assert_eq!(dirs, vec![home_str(&home)]);
    assert!(covers(&dirs, &plan_folder.join("Verification")));
    assert!(covers(&dirs, &plan_folder.join("Artifacts")));
    assert!(covers(&dirs, &promptware.join("Memory")));
}

#[test]
fn a_plan_folder_outside_the_home_is_granted_as_well() {
    let home = HomeFixture::new("wd-outside");
    let elsewhere = HomeFixture::new("wd-outside-plans");
    let promptware = home.path.join("Promptwares").join("ExecutePlan");
    let plan_folder = elsewhere.path.join("00553-Somewhere-Else");

    let dirs = resolve_writable_directories_with_env(
        "ExecutePlan",
        &promptware,
        &plan_folder,
        &home.path,
        &TendrilSettings::default(),
        &no_env(),
    );

    assert_eq!(
        dirs,
        vec![home_str(&home), plan_folder.to_string_lossy().to_string()]
    );
    assert!(covers(&dirs, &plan_folder.join("Artifacts")));
}

#[test]
fn retry_plan_gets_the_plan_folder_too() {
    let home = HomeFixture::new("wd-retry");
    let elsewhere = HomeFixture::new("wd-retry-plans");
    let promptware = home.path.join("Promptwares").join("RetryPlan");
    let plan_folder = elsewhere.path.join("00553-Somewhere-Else");

    let dirs = resolve_writable_directories_with_env(
        "RetryPlan",
        &promptware,
        &plan_folder,
        &home.path,
        &TendrilSettings::default(),
        &no_env(),
    );

    assert!(covers(&dirs, &plan_folder.join("Verification")));
}

#[test]
fn promptwares_without_a_plan_folder_get_no_plan_grant() {
    let home = HomeFixture::new("wd-createplan");
    let elsewhere = HomeFixture::new("wd-createplan-plans");
    let promptware = home.path.join("Promptwares").join("CreatePlan");
    let plan_folder = elsewhere.path.join("00553-Somewhere-Else");

    let dirs = resolve_writable_directories_with_env(
        "CreatePlan",
        &promptware,
        &plan_folder,
        &home.path,
        &TendrilSettings::default(),
        &no_env(),
    );

    assert_eq!(dirs, vec![home_str(&home)]);
    assert!(!covers(&dirs, &plan_folder));
}

#[test]
fn an_empty_plan_folder_adds_nothing() {
    let home = HomeFixture::new("wd-empty-plan");
    let promptware = home.path.join("Promptwares").join("ExecutePlan");

    let dirs = resolve_writable_directories_with_env(
        "ExecutePlan",
        &promptware,
        Path::new(""),
        &home.path,
        &TendrilSettings::default(),
        &no_env(),
    );

    assert_eq!(dirs, vec![home_str(&home)]);
}

#[test]
fn a_promptware_outside_the_home_gets_its_memory_and_tools_granted() {
    let home = HomeFixture::new("wd-pw-outside");
    let elsewhere = HomeFixture::new("wd-pw-outside-src");
    let promptware = elsewhere.path.join("ExecutePlan");
    let plan_folder = home.plans_dir().join("00553-Thing");

    let dirs = resolve_writable_directories_with_env(
        "ExecutePlan",
        &promptware,
        &plan_folder,
        &home.path,
        &TendrilSettings::default(),
        &no_env(),
    );

    assert_eq!(
        dirs,
        vec![
            home_str(&home),
            promptware.join("Memory").to_string_lossy().to_string(),
            promptware.join("Tools").to_string_lossy().to_string(),
        ]
    );
    // Nothing wider than the two subfolders is handed over.
    assert!(!covers(&dirs, &promptware.join("Program.md")));
}

#[test]
fn a_relocated_plans_folder_is_granted_separately() {
    let home = HomeFixture::new("wd-relocated");
    let elsewhere = HomeFixture::new("wd-relocated-plans");
    let promptware = home.path.join("Promptwares").join("ExecutePlan");
    let plans_dir = elsewhere.path.join("Plans");
    let plan_folder = plans_dir.join("00553-Thing");

    let settings = TendrilSettings {
        plan_folder: Some(plans_dir.to_string_lossy().to_string()),
        ..Default::default()
    };

    let dirs = resolve_writable_directories_with_env(
        "ExecutePlan",
        &promptware,
        &plan_folder,
        &home.path,
        &settings,
        &no_env(),
    );

    assert_eq!(
        dirs,
        vec![home_str(&home), plans_dir.to_string_lossy().to_string()]
    );
    // The plan folder is covered by the relocated plans dir, so it is not repeated.
    assert!(covers(&dirs, &plan_folder.join("Verification")));
}
