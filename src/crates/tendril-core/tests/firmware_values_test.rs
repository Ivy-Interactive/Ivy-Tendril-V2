mod common;

use common::{plan_with, HomeFixture};
use std::collections::HashMap;
use std::path::Path;
use tendril_core::config::TendrilSettings;
use tendril_core::jobs::firmware_values::{
    build_firmware_values, build_firmware_values_with, build_repo_configs_yaml,
    execution_profile_override, extract_plan_id_from_folder, resolve_project,
    resolve_working_directory,
};
use tendril_core::models::{
    AddProjectArgs, CreateIssueArgs, CreatePlanArgs, CreatePrArgs, ExecutePlanArgs, ExpandPlanArgs,
    JobArgs, JobItem, PlanStatus, ProjectConfig, RepoRef, RetryPlanArgs, SetupProjectArgs,
    SplitPlanArgs, SyncRepoArgs, UpdatePlanArgs, VerificationStatus,
};

fn job_for(args: JobArgs, plan_folder: &str) -> JobItem {
    let mut job = JobItem::new(
        "00042".to_string(),
        args.job_type().to_string(),
        plan_folder.to_string(),
        "Auto".to_string(),
    );
    job.typed_args = Some(args.clone());
    job.args = serde_json::to_string(&args).ok();
    job
}

fn values(job: &JobItem, home: &HomeFixture) -> HashMap<String, String> {
    build_firmware_values_with(
        job,
        &home.path,
        &TendrilSettings::default(),
        &home.plans_dir(),
    )
}

/// The three values every promptware receives, regardless of job type.
fn assert_always_present(values: &HashMap<String, String>, home: &HomeFixture, project: &str) {
    assert_eq!(values.get("TendrilJobId").unwrap(), "00042");
    assert_eq!(
        values.get("TendrilHome").unwrap(),
        &home.path.to_string_lossy().to_string()
    );
    assert_eq!(values.get("TendrilProject").unwrap(), project);
}

#[test]
fn create_plan_emits_its_task_description_and_omits_force_when_false() {
    let home = HomeFixture::new("fw-createplan");
    let job = job_for(
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "Add dark mode".to_string(),
            project: "Widgets".to_string(),
            priority: 0,
            force: false,
            source_path: None,
            upload_session_id: None,
        }),
        "",
    );

    let v = values(&job, &home);
    assert_always_present(&v, &home, "Widgets");
    assert_eq!(v.get("TaskDescription").unwrap(), "Add dark mode");
    assert_eq!(
        v.get("TendrilPlansFolder").unwrap(),
        &home.plans_dir().to_string_lossy().to_string()
    );
    assert!(!v.contains_key("Force"), "Force must be omitted when false");
    assert!(!v.contains_key("SourcePath"));
    assert!(!v.contains_key("TendrilPlanFolder"));
}

#[test]
fn create_plan_reflects_explicit_plan_folder_setting() {
    let home = HomeFixture::new("fw-createplan-custom-folder");
    let job = job_for(
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "Custom plan folder".to_string(),
            project: "Widgets".to_string(),
            priority: 0,
            force: false,
            source_path: None,
            upload_session_id: None,
        }),
        "",
    );

    let custom_plans = home.path.join("CustomPlans");
    let v =
        build_firmware_values_with(&job, &home.path, &TendrilSettings::default(), &custom_plans);
    assert_eq!(
        v.get("TendrilPlansFolder").unwrap(),
        &custom_plans.to_string_lossy().to_string()
    );
}

#[test]
fn build_firmware_values_with_isolates_plans_folder_from_ambient_env() {
    let home = HomeFixture::new("fw-createplan-seam");
    let job = job_for(
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "Isolated plan folder".to_string(),
            project: "Widgets".to_string(),
            priority: 0,
            force: false,
            source_path: None,
            upload_session_id: None,
        }),
        "",
    );

    let explicit_plans = home.path.join("ExplicitPlans");
    let v = build_firmware_values_with(
        &job,
        &home.path,
        &TendrilSettings::default(),
        &explicit_plans,
    );
    assert_eq!(
        v.get("TendrilPlansFolder").unwrap(),
        &explicit_plans.to_string_lossy().to_string()
    );
}

#[test]
fn build_firmware_values_default_entrypoint_emits_expected_keys() {
    let home = HomeFixture::new("fw-default-entrypoint");
    let job = job_for(
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "Default entrypoint".to_string(),
            project: "Widgets".to_string(),
            priority: 0,
            force: false,
            source_path: None,
            upload_session_id: None,
        }),
        "",
    );

    let v = build_firmware_values(&job, &home.path, &TendrilSettings::default());
    assert_eq!(v.get("TaskDescription").unwrap(), "Default entrypoint");
    assert_eq!(v.get("TendrilProject").unwrap(), "Widgets");
    assert!(v.contains_key("TendrilPlansFolder"));
}

#[test]
fn create_plan_emits_force_and_source_path_when_set() {
    let home = HomeFixture::new("fw-createplan-force");
    let job = job_for(
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "Port the thing".to_string(),
            project: "Widgets".to_string(),
            priority: 3,
            force: true,
            source_path: Some("/tmp/spec.md".to_string()),
            upload_session_id: None,
        }),
        "",
    );

    let v = values(&job, &home);
    assert_eq!(v.get("Force").unwrap(), "true");
    assert_eq!(v.get("SourcePath").unwrap(), "/tmp/spec.md");
}

#[test]
fn execute_plan_emits_the_plan_block_note_and_repo_configs() {
    let home = HomeFixture::new("fw-execute");
    let mut plan = plan_with(PlanStatus::Draft, &[("Build", VerificationStatus::Pending)]);
    plan.repos = vec!["/repos/widgets".to_string()];
    plan.source_url = Some("https://github.com/acme/widgets/issues/12".to_string());
    let folder = home.write_plan("00058-HardenThings", &plan);

    let job = job_for(
        JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: Some("Watch the migration".to_string()),
        }),
        &folder.to_string_lossy(),
    );

    let v = values(&job, &home);
    assert_always_present(&v, &home, "FixtureProject");
    assert_eq!(v.get("TendrilPlanId").unwrap(), "00058");
    assert_eq!(
        v.get("TendrilPlanFolder").unwrap(),
        &folder.to_string_lossy().to_string()
    );
    assert_eq!(
        v.get("TendrilPlansFolder").unwrap(),
        &home.plans_dir().to_string_lossy().to_string()
    );
    assert_eq!(
        v.get("SourceUrl").unwrap(),
        "https://github.com/acme/widgets/issues/12"
    );
    assert_eq!(v.get("Note").unwrap(), "Watch the migration");
    assert_eq!(
        v.get("RepoConfigs").unwrap(),
        "- path: /repos/widgets\n  baseBranch: main"
    );
}

#[test]
fn execute_plan_omits_an_empty_note() {
    let home = HomeFixture::new("fw-execute-nonote");
    let folder = home.write_plan("00058-Thing", &plan_with(PlanStatus::Draft, &[]));
    let job = job_for(
        JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            note: Some(String::new()),
        }),
        &folder.to_string_lossy(),
    );

    let v = values(&job, &home);
    assert!(!v.contains_key("Note"));
    // No repos on the plan, so there is nothing to describe.
    assert!(!v.contains_key("RepoConfigs"));
    assert!(!v.contains_key("SourceUrl"));
}

#[test]
fn retry_plan_always_emits_its_change_request() {
    let home = HomeFixture::new("fw-retry");
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.repos = vec!["/repos/widgets".to_string()];
    let folder = home.write_plan("00058-Thing", &plan);

    let job = job_for(
        JobArgs::RetryPlan(RetryPlanArgs {
            folder_path: folder.to_string_lossy().to_string(),
            change_request: "The migration is missing an index".to_string(),
        }),
        &folder.to_string_lossy(),
    );

    let v = values(&job, &home);
    assert_eq!(
        v.get("ChangeRequest").unwrap(),
        "The migration is missing an index"
    );
    assert!(v.contains_key("RepoConfigs"));
}

#[test]
fn update_plan_emits_instructions_only_when_given() {
    let home = HomeFixture::new("fw-update");
    let folder = home.write_plan("00058-Thing", &plan_with(PlanStatus::Draft, &[]));
    let path = folder.to_string_lossy().to_string();

    let with_instructions = job_for(
        JobArgs::UpdatePlan(UpdatePlanArgs {
            folder_path: path.clone(),
            instructions: Some("Split out the CLI work".to_string()),
            upload_session_id: None,
        }),
        &path,
    );
    let v = values(&with_instructions, &home);
    assert_eq!(
        v.get("UpdateInstructions").unwrap(),
        "Split out the CLI work"
    );
    // UpdatePlan does not build code, so it gets no repo configs.
    assert!(!v.contains_key("RepoConfigs"));

    let without = job_for(
        JobArgs::UpdatePlan(UpdatePlanArgs {
            folder_path: path.clone(),
            instructions: None,
            upload_session_id: None,
        }),
        &path,
    );
    assert!(!values(&without, &home).contains_key("UpdateInstructions"));
}

#[test]
fn expand_and_split_plan_get_the_plan_block_and_nothing_else() {
    let home = HomeFixture::new("fw-expand-split");
    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.repos = vec!["/repos/widgets".to_string()];
    let folder = home.write_plan("00058-Thing", &plan);
    let path = folder.to_string_lossy().to_string();

    for args in [
        JobArgs::ExpandPlan(ExpandPlanArgs {
            folder_path: path.clone(),
        }),
        JobArgs::SplitPlan(SplitPlanArgs {
            folder_path: path.clone(),
        }),
    ] {
        let job_type = args.job_type();
        let v = values(&job_for(args, &path), &home);
        assert_eq!(v.get("TendrilPlanId").unwrap(), "00058", "{}", job_type);
        assert!(v.contains_key("TendrilPlanFolder"), "{}", job_type);
        assert!(
            !v.contains_key("RepoConfigs"),
            "{} must not receive repo configs",
            job_type
        );
    }
}

#[test]
fn create_pr_emits_lowercase_flags_and_joined_reviewers() {
    let home = HomeFixture::new("fw-createpr");
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.repos = vec!["/repos/widgets".to_string()];
    let folder = home.write_plan("00058-Thing", &plan);
    let path = folder.to_string_lossy().to_string();

    let job = job_for(
        JobArgs::CreatePr(CreatePrArgs {
            folder_path: path.clone(),
            solve_merge_conflicts: true,
            merge: false,
            delete_branch: true,
            include_artifacts: false,
            reviewers: Some(vec!["alice".to_string(), "bob".to_string()]),
            comment: Some("Ready for review".to_string()),
            draft: false,
        }),
        &path,
    );

    let v = values(&job, &home);
    assert_eq!(v.get("PrSolveMergeConflicts").unwrap(), "true");
    assert_eq!(v.get("PrMerge").unwrap(), "false");
    assert_eq!(v.get("PrDeleteBranch").unwrap(), "true");
    assert_eq!(v.get("PrIncludeArtifacts").unwrap(), "false");
    assert_eq!(v.get("PrDraft").unwrap(), "false");
    assert_eq!(v.get("PrReviewer").unwrap(), "alice,bob");
    assert_eq!(v.get("PrComment").unwrap(), "Ready for review");
    assert!(v.contains_key("RepoConfigs"));
}

#[test]
fn create_pr_omits_reviewers_when_the_list_is_empty() {
    let home = HomeFixture::new("fw-createpr-noreviewers");
    let folder = home.write_plan("00058-Thing", &plan_with(PlanStatus::Review, &[]));
    let path = folder.to_string_lossy().to_string();

    for reviewers in [None, Some(vec![]), Some(vec!["   ".to_string()])] {
        let job = job_for(
            JobArgs::CreatePr(CreatePrArgs {
                folder_path: path.clone(),
                solve_merge_conflicts: true,
                merge: true,
                delete_branch: true,
                include_artifacts: true,
                reviewers: reviewers.clone(),
                comment: None,
                draft: true,
            }),
            &path,
        );
        let v = values(&job, &home);
        assert!(
            !v.contains_key("PrReviewer"),
            "PrReviewer must be omitted for {:?}",
            reviewers
        );
        assert!(!v.contains_key("PrComment"));
        assert_eq!(v.get("PrDraft").unwrap(), "true");
    }
}

#[test]
fn create_issue_emits_only_the_fields_that_are_set() {
    let home = HomeFixture::new("fw-createissue");
    let folder = home.write_plan("00058-Thing", &plan_with(PlanStatus::Draft, &[]));
    let path = folder.to_string_lossy().to_string();

    let full = job_for(
        JobArgs::CreateIssue(CreateIssueArgs {
            folder_path: path.clone(),
            repo: "acme/widgets".to_string(),
            assignee: Some("alice".to_string()),
            comment: Some("Found while porting".to_string()),
            labels: Some("bug,port".to_string()),
        }),
        &path,
    );
    let v = values(&full, &home);
    assert_eq!(v.get("Repo").unwrap(), "acme/widgets");
    assert_eq!(v.get("Assignee").unwrap(), "alice");
    assert_eq!(v.get("Comment").unwrap(), "Found while porting");
    assert_eq!(v.get("Labels").unwrap(), "bug,port");
    // CreateIssue does not check out code.
    assert!(!v.contains_key("RepoConfigs"));

    let sparse = job_for(
        JobArgs::CreateIssue(CreateIssueArgs {
            folder_path: path.clone(),
            repo: "acme/widgets".to_string(),
            assignee: None,
            comment: None,
            labels: None,
        }),
        &path,
    );
    let v = values(&sparse, &home);
    assert!(v.contains_key("Repo"));
    assert!(!v.contains_key("Assignee"));
    assert!(!v.contains_key("Comment"));
    assert!(!v.contains_key("Labels"));
}

/// `SetupProject` reuses the `folderPath` arg to carry a project name, so it must emit `ProjectName`
/// and no plan block. See `tendril job start setupproject`.
#[test]
fn setup_project_emits_a_project_name_not_a_plan_folder() {
    let home = HomeFixture::new("fw-setupproject");
    let job = job_for(
        JobArgs::SetupProject(SetupProjectArgs {
            folder_path: "Widgets".to_string(),
        }),
        "Widgets",
    );

    let v = values(&job, &home);
    assert_always_present(&v, &home, "Widgets");
    assert_eq!(v.get("ProjectName").unwrap(), "Widgets");
    assert_eq!(
        v.get("Instructions").unwrap(),
        "Setup verifications and review actions for this project."
    );
    assert!(!v.contains_key("TendrilPlanFolder"));
    assert!(!v.contains_key("TendrilPlanId"));
}

#[test]
fn add_project_emits_its_repos_as_json() {
    let home = HomeFixture::new("fw-addproject");
    let job = job_for(
        JobArgs::AddProject(AddProjectArgs {
            project_name: "Widgets".to_string(),
            repos: vec![RepoRef {
                path: "/repos/widgets".to_string(),
                base_branch: Some("develop".to_string()),
                extra: Default::default(),
            }],
        }),
        "",
    );

    let v = values(&job, &home);
    assert_always_present(&v, &home, "Widgets");
    assert_eq!(v.get("ProjectName").unwrap(), "Widgets");
    assert_eq!(
        v.get("ReposJson").unwrap(),
        r#"[{"path":"/repos/widgets","baseBranch":"develop"}]"#
    );
    assert_eq!(
        v.get("Instructions").unwrap(),
        "Setup verifications and review actions for this project."
    );
}

#[test]
fn sync_repo_emits_its_repo_branch_and_policy() {
    let home = HomeFixture::new("fw-syncrepo");
    let job = job_for(
        JobArgs::SyncRepo(SyncRepoArgs {
            repo_path: "/repos/widgets".to_string(),
            base_branch: "main".to_string(),
            plan_folder_path: None,
            untracked_changes_policy: "Stash".to_string(),
        }),
        "",
    );

    let v = values(&job, &home);
    assert_always_present(&v, &home, "Auto");
    assert_eq!(v.get("RepoPath").unwrap(), "/repos/widgets");
    assert_eq!(v.get("BaseBranch").unwrap(), "main");
    assert_eq!(v.get("UntrackedChangesPolicy").unwrap(), "Stash");
}

/// A plan folder that has been deleted must not take the launch path down with it.
#[test]
fn a_nonexistent_plan_folder_yields_no_plan_keys() {
    let home = HomeFixture::new("fw-missing-plan");
    let missing = home.plans_dir().join("00058-Deleted");
    let job = job_for(
        JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: missing.to_string_lossy().to_string(),
            note: Some("still here".to_string()),
        }),
        &missing.to_string_lossy(),
    );

    let v = values(&job, &home);
    assert_always_present(&v, &home, "Auto");
    assert!(!v.contains_key("TendrilPlanFolder"));
    assert!(!v.contains_key("TendrilPlanId"));
    assert!(!v.contains_key("Note"));
    assert!(!v.contains_key("RepoConfigs"));
}

/// Args are rehydrated from the persisted JSON, which is all a job loaded back from SQLite has.
#[test]
fn values_are_built_from_persisted_json_when_typed_args_are_absent() {
    let home = HomeFixture::new("fw-rehydrate");
    let folder = home.write_plan("00058-Thing", &plan_with(PlanStatus::Draft, &[]));
    let path = folder.to_string_lossy().to_string();

    let mut job = job_for(
        JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: path.clone(),
            note: Some("from json".to_string()),
        }),
        &path,
    );
    job.typed_args = None;

    let v = values(&job, &home);
    assert_eq!(v.get("TendrilPlanId").unwrap(), "00058");
    assert_eq!(v.get("Note").unwrap(), "from json");
}

#[test]
fn a_job_with_no_args_at_all_still_gets_the_always_present_values() {
    let home = HomeFixture::new("fw-noargs");
    let job = JobItem::new(
        "00042".to_string(),
        "ExecutePlan".to_string(),
        String::new(),
        "Auto".to_string(),
    );

    let v = values(&job, &home);
    assert_always_present(&v, &home, "Auto");
    assert_eq!(v.len(), 3);
}

#[test]
fn project_resolution_prefers_the_plan_then_the_args() {
    let home = HomeFixture::new("fw-project");
    let settings = TendrilSettings::default();

    let folder = home.write_plan("00058-Thing", &plan_with(PlanStatus::Draft, &[]));
    let path = folder.to_string_lossy().to_string();

    let execute = job_for(
        JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: path.clone(),
            note: None,
        }),
        &path,
    );
    assert_eq!(resolve_project(&execute, &settings), "FixtureProject");

    let create = job_for(
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "x".to_string(),
            project: "Widgets".to_string(),
            priority: 0,
            force: false,
            source_path: None,
            upload_session_id: None,
        }),
        "",
    );
    assert_eq!(resolve_project(&create, &settings), "Widgets");

    // A plan folder that no longer exists falls back to Auto rather than failing.
    let orphan = job_for(
        JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: home
                .plans_dir()
                .join("00099-Gone")
                .to_string_lossy()
                .to_string(),
            note: None,
        }),
        "",
    );
    assert_eq!(resolve_project(&orphan, &settings), "Auto");
}

#[test]
fn the_working_directory_is_the_projects_first_existing_repo() {
    let home = HomeFixture::new("fw-workdir");
    let repo = home.path.join("repos").join("widgets");
    std::fs::create_dir_all(&repo).unwrap();

    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.project = "Widgets".to_string();
    let folder = home.write_plan("00058-Thing", &plan);
    let path = folder.to_string_lossy().to_string();

    let settings = TendrilSettings {
        projects: vec![ProjectConfig {
            name: "Widgets".to_string(),
            color: String::new(),
            repos: vec![
                RepoRef {
                    path: home
                        .path
                        .join("repos")
                        .join("does-not-exist")
                        .to_string_lossy()
                        .to_string(),
                    base_branch: None,
                    extra: Default::default(),
                },
                RepoRef {
                    path: repo.to_string_lossy().to_string(),
                    base_branch: Some("develop".to_string()),
                    extra: Default::default(),
                },
            ],
            verifications: vec![],
            context: String::new(),
            stack_hash: None,
            review_actions: vec![],
            build_dependencies: vec![],
            ..Default::default()
        }],
        ..Default::default()
    };

    let job = job_for(
        JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: path.clone(),
            note: None,
        }),
        &path,
    );
    let promptware = home.write_promptware("ExecutePlan");

    assert_eq!(
        resolve_working_directory(&job, &settings, &home.path, &promptware),
        repo
    );
}

#[test]
fn the_working_directory_falls_back_to_the_promptware_then_the_home() {
    let home = HomeFixture::new("fw-workdir-fallback");
    let settings = TendrilSettings::default();
    let job = job_for(
        JobArgs::CreatePlan(CreatePlanArgs {
            description: "x".to_string(),
            project: "Unconfigured".to_string(),
            priority: 0,
            force: false,
            source_path: None,
            upload_session_id: None,
        }),
        "",
    );

    let promptware = home.write_promptware("CreatePlan");
    assert_eq!(
        resolve_working_directory(&job, &settings, &home.path, &promptware),
        promptware
    );

    let missing = home.path.join("Promptwares").join("NoSuchPromptware");
    assert_eq!(
        resolve_working_directory(&job, &settings, &home.path, &missing),
        home.path
    );
}

#[test]
fn sync_repo_runs_in_the_repo_it_syncs() {
    let home = HomeFixture::new("fw-workdir-sync");
    let settings = TendrilSettings::default();
    let job = job_for(
        JobArgs::SyncRepo(SyncRepoArgs {
            repo_path: "/repos/widgets".to_string(),
            base_branch: "main".to_string(),
            plan_folder_path: None,
            untracked_changes_policy: "Stash".to_string(),
        }),
        "",
    );

    assert_eq!(
        resolve_working_directory(&job, &settings, &home.path, &home.path),
        Path::new("/repos/widgets")
    );
}

#[test]
fn repo_configs_list_plan_repos_then_read_only_build_dependencies() {
    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.repos = vec!["/repos/widgets".to_string(), "/repos/gadgets".to_string()];

    let config = ProjectConfig {
        name: "Widgets".to_string(),
        color: String::new(),
        repos: vec![RepoRef {
            path: "/repos/widgets".to_string(),
            base_branch: Some("develop".to_string()),
            extra: Default::default(),
        }],
        verifications: vec![],
        context: String::new(),
        stack_hash: None,
        review_actions: vec![],
        // The first is already a plan repo and must not be listed twice.
        build_dependencies: vec!["/repos/widgets".to_string(), "/repos/shared".to_string()],
        ..Default::default()
    };

    let yaml = build_repo_configs_yaml(&plan, Some(&config)).expect("expected repo configs");
    assert_eq!(
        yaml,
        "- path: /repos/widgets\n  baseBranch: develop\n\
         - path: /repos/gadgets\n  baseBranch: main\n\
         - path: /repos/shared\n  baseBranch: main\n  readOnly: true"
    );

    // No repos on the plan means nothing to describe.
    let empty = plan_with(PlanStatus::Draft, &[]);
    assert!(build_repo_configs_yaml(&empty, Some(&config)).is_none());
    assert!(build_repo_configs_yaml(&empty, None).is_none());
}

#[test]
fn the_execution_profile_override_applies_only_to_execution_jobs() {
    let home = HomeFixture::new("fw-profile");
    let mut plan = plan_with(PlanStatus::Draft, &[]);
    plan.execution_profile = Some("deep".to_string());
    let folder = home.write_plan("00058-Thing", &plan);
    let path = folder.to_string_lossy().to_string();

    let execute = job_for(
        JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: path.clone(),
            note: None,
        }),
        &path,
    );
    assert_eq!(
        execution_profile_override(&execute, &plan),
        Some("deep".to_string())
    );

    let retry = job_for(
        JobArgs::RetryPlan(RetryPlanArgs {
            folder_path: path.clone(),
            change_request: "again".to_string(),
        }),
        &path,
    );
    assert_eq!(
        execution_profile_override(&retry, &plan),
        Some("deep".to_string())
    );

    let expand = job_for(
        JobArgs::ExpandPlan(ExpandPlanArgs {
            folder_path: path.clone(),
        }),
        &path,
    );
    assert_eq!(execution_profile_override(&expand, &plan), None);

    // An empty profile is not a profile.
    let mut blank = plan.clone();
    blank.execution_profile = Some(String::new());
    assert_eq!(execution_profile_override(&execute, &blank), None);
}

#[test]
fn plan_ids_come_from_the_folder_name_prefix() {
    assert_eq!(
        extract_plan_id_from_folder(Path::new("/plans/00058-HardenCoreJob")).as_deref(),
        Some("00058")
    );
    assert_eq!(
        extract_plan_id_from_folder(Path::new("/plans/00001")).as_deref(),
        Some("00001")
    );
    assert_eq!(
        extract_plan_id_from_folder(Path::new("/plans/NotAPlan")),
        None
    );
    assert_eq!(
        extract_plan_id_from_folder(Path::new("/plans/007-Short")),
        None
    );
}
