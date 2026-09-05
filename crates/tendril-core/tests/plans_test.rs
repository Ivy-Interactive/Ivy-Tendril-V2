use std::path::Path;
use tendril_core::models::{
    PlanStatus, PlanVerificationEntry, PlanYaml, RecommendationStatus, VerificationStatus,
};
use tendril_core::plans::{
    add_recommendation, allocate_plan_id, create_plan, get_revision, list_recommendations,
    read_plan_file, set_recommendation_state, to_safe_title, write_revision, CreatePlanOptions,
    PlanCompletionGuard,
};

#[test]
fn test_helpers_allocate_id_and_safe_title() {
    assert_eq!(
        to_safe_title("Fix Login & Auth / Flow!"),
        "FixLoginAuthFlow"
    );
    assert_eq!(
        to_safe_title("   Spaces   Everywhere   "),
        "SpacesEverywhere"
    );

    let test_dir = std::env::temp_dir().join(format!(
        "tendril-alloc-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    // Initially should allocate 00001
    let id1 = allocate_plan_id(&test_dir).expect("Failed to allocate ID");
    assert_eq!(id1, "00001");

    // Create folder 00001-Foo and 00042-Bar
    std::fs::create_dir_all(test_dir.join("00001-Foo")).unwrap();
    std::fs::create_dir_all(test_dir.join("00042-Bar")).unwrap();

    let id2 = allocate_plan_id(&test_dir).expect("Failed to allocate ID");
    assert_eq!(id2, "00043");

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_create_plan_and_revisions_lifecycle() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-plan-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let opts = CreatePlanOptions {
        title: "Implement Dark Mode".to_string(),
        project: "TendrilService".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: Some("User requested dark mode".to_string()),
        source_url: None,
        execution_profile: None,
        priority: Some(1),
        repos: vec!["D:/repos/tendril-service".to_string()],
        verifications: vec![PlanVerificationEntry {
            name: "CargoCheck".to_string(),
            status: VerificationStatus::Pending,
        }],
        depends_on: vec![],
        related_plans: vec![],
    };

    let plan_file = create_plan(&test_dir, opts).expect("Failed to create plan");
    assert_eq!(plan_file.metadata.id, 1);
    assert_eq!(plan_file.metadata.title, "Implement Dark Mode");
    assert_eq!(plan_file.metadata.project, "TendrilService");
    assert_eq!(plan_file.metadata.state, PlanStatus::Draft);
    assert_eq!(plan_file.revision_count, 0);

    let plan_folder = Path::new(&plan_file.folder_path);
    assert!(plan_folder.join("plan.yaml").exists());
    assert!(plan_folder.join("Revisions").exists());
    assert!(plan_folder.join("Worktrees").exists());
    assert!(plan_folder.join("Artifacts").exists());

    // Write revisions
    let rev1_num = write_revision(plan_folder, "# Dark Mode Design\nFirst draft.")
        .expect("Failed to write rev 1");
    assert_eq!(rev1_num, 1);
    assert_eq!(
        get_revision(plan_folder, Some(1)).unwrap(),
        "# Dark Mode Design\nFirst draft."
    );

    let rev2_num = write_revision(
        plan_folder,
        "# Dark Mode Design\nSecond draft with feedback.",
    )
    .expect("Failed to write rev 2");
    assert_eq!(rev2_num, 2);

    // Latest revision should return rev 2
    let latest_content = get_revision(plan_folder, None).expect("Failed to get latest revision");
    assert_eq!(
        latest_content,
        "# Dark Mode Design\nSecond draft with feedback."
    );

    // Reading plan file should now show 2 revisions and the latest content
    let reloaded = read_plan_file(plan_folder).expect("Failed to reload plan");
    assert_eq!(reloaded.revision_count, 2);
    assert_eq!(reloaded.latest_revision_content, latest_content);

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_plan_recommendations() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-rec-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let opts = CreatePlanOptions {
        title: "Optimize Query".to_string(),
        project: "TendrilService".to_string(),
        level: Some("Chore".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: None,
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
    };

    let plan = create_plan(&test_dir, opts).unwrap();
    let plan_folder = Path::new(&plan.folder_path);

    // Add recommendation
    add_recommendation(
        plan_folder,
        "Add Index",
        "Add an index to the jobs table for fast filtering",
        Some("High"),
    )
    .expect("Failed to add recommendation");

    let recs = list_recommendations(plan_folder).unwrap();
    assert_eq!(recs.len(), 1);
    assert_eq!(recs[0].title, "Add Index");
    assert_eq!(recs[0].state, RecommendationStatus::PENDING);

    // Duplicate title should error
    assert!(add_recommendation(plan_folder, "Add Index", "Duplicate title", None,).is_err());

    // Accept recommendation
    set_recommendation_state(
        plan_folder,
        "Add Index",
        RecommendationStatus::ACCEPTED,
        None,
    )
    .expect("Failed to set recommendation state");

    let recs_accepted = list_recommendations(plan_folder).unwrap();
    assert_eq!(recs_accepted[0].state, RecommendationStatus::ACCEPTED);

    // Decline recommendation
    set_recommendation_state(
        plan_folder,
        "Add Index",
        RecommendationStatus::DECLINED,
        Some("Not needed right now"),
    )
    .expect("Failed to decline recommendation");

    let recs_declined = list_recommendations(plan_folder).unwrap();
    assert_eq!(recs_declined[0].state, RecommendationStatus::DECLINED);
    assert_eq!(
        recs_declined[0].decline_reason.as_deref(),
        Some("Not needed right now")
    );

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_plan_completion_guard() {
    let mut plan = PlanYaml {
        schema_version: 1,
        state: PlanStatus::Executing.to_string(),
        project: "Test".to_string(),
        level: "Feature".to_string(),
        title: "Test Guard".to_string(),
        repos: vec![],
        created: chrono::Utc::now(),
        updated: chrono::Utc::now(),
        prs: vec![],
        commits: vec![],
        verifications: vec![PlanVerificationEntry {
            name: "UnitTests".to_string(),
            status: VerificationStatus::Fail,
        }],
        related_plans: vec![],
        depends_on: vec![],
        priority: 0,
        partial_delivery: false,
        execution_profile: None,
        initial_prompt: None,
        source_url: None,
        recommendations: None,
    };

    // Transitioning to Completed with failed verification should fail when allow_failed_verifications is false
    let res = PlanCompletionGuard::apply_state(&mut plan, PlanStatus::Completed, false, "00001");
    assert!(res.is_err());

    // Transitioning to Completed with allow_failed_verifications=true should succeed with a warning and set partial_delivery
    let res_allowed =
        PlanCompletionGuard::apply_state(&mut plan, PlanStatus::Completed, true, "00001");
    assert!(res_allowed.is_ok());
    let warning = res_allowed.unwrap();
    assert!(warning.is_some());
    assert!(plan.partial_delivery);
    assert_eq!(plan.state, PlanStatus::Completed.to_string());
}
