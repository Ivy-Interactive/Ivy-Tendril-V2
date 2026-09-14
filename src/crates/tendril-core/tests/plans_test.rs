use std::path::Path;
use tendril_core::db::get_plans_limited;
use tendril_core::models::{
    PlanStatus, PlanVerificationEntry, PlanYaml, RecommendationStatus, VerificationStatus,
};
use tendril_core::plans::{
    accept_recommendation, add_plan_verification, add_recommendation, allocate_plan_id,
    create_plan, decline_recommendation, get_revision, list_plan_verifications,
    list_recommendations, read_plan_file, remove_plan_verification, remove_recommendation,
    rename_project_in_plans, rename_verification_in_plans, set_plan_verification_status,
    set_recommendation_field, set_recommendation_state, to_safe_title, write_revision,
    CreatePlanOptions, PlanCompletionGuard,
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
        chat_session_id: None,
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
    let rev1_num = write_revision(plan_folder, "# Dark Mode Design\nFirst draft.", true)
        .expect("Failed to write rev 1");
    assert_eq!(rev1_num, 1);
    assert_eq!(
        get_revision(plan_folder, Some(1)).unwrap(),
        "# Dark Mode Design\nFirst draft."
    );

    let rev2_num = write_revision(
        plan_folder,
        "# Dark Mode Design\nSecond draft with feedback.",
        true,
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
        chat_session_id: None,
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

    // Remove recommendation
    remove_recommendation(plan_folder, "Add Index").expect("Failed to remove recommendation");
    let recs_after_remove = list_recommendations(plan_folder).unwrap();
    assert_eq!(recs_after_remove.len(), 0);

    // Removing again should error
    assert!(remove_recommendation(plan_folder, "Add Index").is_err());

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_plan_verifications() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-verifs-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let opts = CreatePlanOptions {
        title: "Test Plan Verifications".to_string(),
        project: "TestProject".to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: None,
        repos: vec![],
        verifications: vec![PlanVerificationEntry {
            name: "RustBuild".to_string(),
            status: VerificationStatus::Pending,
        }],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    };

    let plan = create_plan(&test_dir, opts).unwrap();
    let plan_folder = Path::new(&plan.folder_path);

    // List seeded verifications
    let verifs = list_plan_verifications(plan_folder).unwrap();
    assert_eq!(verifs.len(), 1);
    assert_eq!(verifs[0].name, "RustBuild");
    assert_eq!(verifs[0].status, VerificationStatus::Pending);

    // Add new verification
    let added = add_plan_verification(plan_folder, "RustTest", Some(VerificationStatus::Pending))
        .expect("Failed to add verification");
    assert_eq!(added.name, "RustTest");
    assert_eq!(added.status, VerificationStatus::Pending);

    // Duplicate add should fail
    assert!(add_plan_verification(plan_folder, "RustTest", None).is_err());

    // Update status
    let updated = set_plan_verification_status(plan_folder, "RustTest", VerificationStatus::Pass)
        .expect("Failed to set verification status");
    assert_eq!(updated.status, VerificationStatus::Pass);

    let verifs_after_update = list_plan_verifications(plan_folder).unwrap();
    assert_eq!(verifs_after_update.len(), 2);
    assert_eq!(verifs_after_update[1].status, VerificationStatus::Pass);

    // Remove verification
    remove_plan_verification(plan_folder, "RustBuild").expect("Failed to remove verification");
    let verifs_after_remove = list_plan_verifications(plan_folder).unwrap();
    assert_eq!(verifs_after_remove.len(), 1);
    assert_eq!(verifs_after_remove[0].name, "RustTest");

    // Remove nonexistent verification should fail
    assert!(remove_plan_verification(plan_folder, "NonExistent").is_err());

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
        worktrees: None,
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
        chat_session_id: None,
        allocated_ports: None,
        extra: std::collections::BTreeMap::new(),
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

/// The job engine now routes every plan state write through the guard, so the Completed-over-Fail
/// rule has to hold from `Review` as well, not only from `Executing`.
#[test]
fn test_plan_completion_guard_refuses_completed_from_review_while_a_row_failed() {
    let mut plan = PlanYaml {
        schema_version: 3,
        state: PlanStatus::Review.to_string(),
        project: "Test".to_string(),
        level: "Feature".to_string(),
        title: "Review With Failure".to_string(),
        repos: vec![],
        created: chrono::Utc::now(),
        updated: chrono::Utc::now(),
        prs: vec![],
        commits: vec![],
        worktrees: None,
        verifications: vec![
            PlanVerificationEntry {
                name: "Build".to_string(),
                status: VerificationStatus::Pass,
            },
            PlanVerificationEntry {
                name: "UnitTests".to_string(),
                status: VerificationStatus::Fail,
            },
        ],
        related_plans: vec![],
        depends_on: vec![],
        priority: 0,
        partial_delivery: false,
        execution_profile: None,
        initial_prompt: None,
        source_url: None,
        recommendations: None,
        chat_session_id: None,
        allocated_ports: None,
        extra: std::collections::BTreeMap::new(),
    };

    assert_eq!(
        PlanCompletionGuard::failed_verifications(&plan),
        vec!["UnitTests".to_string()]
    );

    let refused =
        PlanCompletionGuard::apply_state(&mut plan, PlanStatus::Completed, false, "00002");
    assert!(refused.is_err(), "Completed must still be refused");
    assert_eq!(
        plan.state,
        PlanStatus::Review.to_string(),
        "a refused transition must not mutate the plan"
    );
    assert!(!plan.partial_delivery);

    // Every other target state is unaffected by the rule.
    assert!(
        PlanCompletionGuard::apply_state(&mut plan, PlanStatus::Failed, false, "00002").is_ok()
    );
    assert_eq!(plan.state, PlanStatus::Failed.to_string());
    assert!(PlanCompletionGuard::apply_state(&mut plan, PlanStatus::Draft, false, "00002").is_ok());
    assert_eq!(plan.state, PlanStatus::Draft.to_string());
}

#[test]
fn test_rename_verification_in_plans() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-rename-ver-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    let opts = CreatePlanOptions {
        title: "Test Verification Rename".to_string(),
        project: "TestProj".to_string(),
        level: None,
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: None,
        repos: vec![],
        verifications: vec![PlanVerificationEntry {
            name: "OldVer".to_string(),
            status: VerificationStatus::Pending,
        }],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    };
    let plan = create_plan(&test_dir, opts).unwrap();
    let plan_folder = Path::new(&plan.folder_path);

    let count = rename_verification_in_plans(&test_dir, "OldVer", "NewVer").unwrap();
    assert_eq!(count, 1);

    let verifs = list_plan_verifications(plan_folder).unwrap();
    assert_eq!(verifs[0].name, "NewVer");

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_rename_project_in_plans() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-rename-proj-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    let opts = CreatePlanOptions {
        title: "Test Project Rename".to_string(),
        project: "OldProject".to_string(),
        level: None,
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: None,
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    };
    let plan = create_plan(&test_dir, opts).unwrap();
    let plan_folder = Path::new(&plan.folder_path);

    let count = rename_project_in_plans(&test_dir, "OldProject", "NewProject").unwrap();
    assert_eq!(count, 1);

    let plan_file = read_plan_file(plan_folder).unwrap();
    assert_eq!(plan_file.metadata.project, "NewProject");

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_get_plans_limited_honours_limit() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-plans-limited-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();
    let db_path = test_dir.join("tendril.db");
    let conn = tendril_core::db::open_database(&db_path).unwrap();

    for id in 1..=3 {
        conn.execute(
            "INSERT INTO Plans (Id, Title, Project, Level, State, FolderPath, FolderName, YamlRaw, Created, Updated) VALUES (?1, ?2, 'LimitProj', 'Feature', 'Draft', ?3, ?4, '', '2026-01-01', '2026-01-01')",
            rusqlite::params![
                id,
                format!("Plan {}", id),
                format!("/p{}", id),
                format!("{:05}-Plan", id)
            ],
        )
        .unwrap();
    }

    let unlimited = get_plans_limited(&conn, None, Some("LimitProj"), None, None).unwrap();
    assert_eq!(unlimited.len(), 3);

    let limited_one = get_plans_limited(&conn, None, Some("LimitProj"), None, Some(1)).unwrap();
    assert_eq!(limited_one.len(), 1);
    assert_eq!(limited_one[0].metadata.id, 3, "ORDER BY Id DESC then LIMIT 1 keeps the newest");

    let limited_zero = get_plans_limited(&conn, None, Some("LimitProj"), None, Some(0)).unwrap();
    assert!(limited_zero.is_empty());

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_db_cascading_renames() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-db-rename-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();
    let db_path = test_dir.join("tendril.db");
    let conn = tendril_core::db::open_database(&db_path).unwrap();

    conn.execute(
        "INSERT INTO Plans (Id, Title, Project, Level, State, FolderPath, FolderName, YamlRaw, Created, Updated) VALUES (1, 'Plan 1', 'OldProj', 'Feature', 'Draft', '/p1', '00001-Plan1', '', '2026-01-01', '2026-01-01')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO Verifications (PlanId, Name, Status) VALUES (1, 'OldCheck', 'Pending')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO Jobs (Id, Type, PlanFile, Project, Status) VALUES ('J1', 'Test', '', 'OldProj', 'Completed')",
        [],
    ).unwrap();
    conn.execute(
        "INSERT INTO Recommendations (PlanId, Title, Description, Project, Date) VALUES (1, 'Rec', 'Desc', 'OldProj', '2026-01-01')",
        [],
    ).unwrap();

    let ver_count = tendril_core::db::rename_verification(&conn, "OldCheck", "NewCheck").unwrap();
    assert_eq!(ver_count, 1);
    let ver_name: String = conn
        .query_row("SELECT Name FROM Verifications WHERE PlanId = 1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(ver_name, "NewCheck");

    let proj_count = tendril_core::db::rename_project(&conn, "OldProj", "NewProj").unwrap();
    assert_eq!(proj_count, 1);
    let plan_proj: String = conn
        .query_row("SELECT Project FROM Plans WHERE Id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(plan_proj, "NewProj");
    let job_proj: String = conn
        .query_row("SELECT Project FROM Jobs WHERE Id = 'J1'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(job_proj, "NewProj");
    let rec_proj: String = conn
        .query_row(
            "SELECT Project FROM Recommendations WHERE PlanId = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rec_proj, "NewProj");

    let _ = std::fs::remove_dir_all(test_dir);
}

/// A plan folder with one `Pending` recommendation, for the field-edit and
/// accept/decline tests below. The folder is left for the caller to remove.
fn plan_with_one_recommendation(prefix: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let test_dir =
        std::env::temp_dir().join(format!("{}-{}", prefix, uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let opts = CreatePlanOptions {
        title: "Tune The Scheduler".to_string(),
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
        chat_session_id: None,
    };

    let plan = create_plan(&test_dir, opts).expect("Failed to create plan");
    let folder = std::path::PathBuf::from(&plan.folder_path);
    add_recommendation(&folder, "Add Index", "Index the jobs table", Some("High"))
        .expect("Failed to add recommendation");

    (test_dir, folder)
}

fn only_recommendation(folder: &Path) -> tendril_core::models::Recommendation {
    let mut recs = list_recommendations(folder).expect("Failed to list recommendations");
    assert_eq!(recs.len(), 1, "expected exactly one recommendation");
    recs.remove(0)
}

#[test]
fn set_recommendation_field_edits_content_not_just_state() {
    let (test_dir, folder) = plan_with_one_recommendation("tendril-rec-field-test");

    set_recommendation_field(&folder, "Add Index", "description", "Index Jobs(Status)")
        .expect("Failed to set description");
    assert_eq!(
        only_recommendation(&folder).description,
        "Index Jobs(Status)"
    );

    // Impact is canonicalized, so a lowercase value is accepted and stored in the
    // one spelling every consumer matches on.
    set_recommendation_field(&folder, "Add Index", "impact", "medium")
        .expect("Failed to set impact");
    assert_eq!(
        only_recommendation(&folder).impact.as_deref(),
        Some("Medium")
    );

    // Clearing an optional field is a set to empty rather than a separate verb.
    set_recommendation_field(&folder, "Add Index", "impact", "").expect("Failed to clear impact");
    assert_eq!(only_recommendation(&folder).impact, None);

    // The field name itself is matched case-insensitively.
    set_recommendation_field(
        &folder,
        "Add Index",
        "DESCRIPTION",
        "Case insensitive field",
    )
    .expect("Failed to set description via a differently cased field name");
    assert_eq!(
        only_recommendation(&folder).description,
        "Case insensitive field"
    );

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn renaming_a_recommendation_moves_it_and_refuses_a_collision() {
    let (test_dir, folder) = plan_with_one_recommendation("tendril-rec-rename-test");
    add_recommendation(&folder, "Cache Results", "Memoize the hot query", None)
        .expect("Failed to add second recommendation");

    // The title is the key every route and projection row looks the entry up by,
    // so a rename onto a sibling has to fail rather than produce two of one key.
    let collision = set_recommendation_field(&folder, "Add Index", "title", "Cache Results");
    assert!(collision.is_err(), "a rename onto a sibling must fail");
    assert!(
        collision
            .unwrap_err()
            .to_string()
            .contains("already exists"),
        "the error has to be distinguishable from a not-found, so HTTP can map it to 409"
    );

    set_recommendation_field(&folder, "Add Index", "title", "Add Jobs Index")
        .expect("Failed to rename recommendation");

    let recs = list_recommendations(&folder).unwrap();
    assert!(recs.iter().any(|r| r.title == "Add Jobs Index"));
    assert!(
        !recs.iter().any(|r| r.title == "Add Index"),
        "the entry must be findable under the new title only"
    );
    // Renaming keeps the rest of the entry: it is a rename, not a replace.
    let renamed = recs
        .iter()
        .find(|r| r.title == "Add Jobs Index")
        .expect("the renamed entry");
    assert_eq!(renamed.description, "Index the jobs table");
    assert_eq!(renamed.impact.as_deref(), Some("High"));

    // An empty title would leave the entry unaddressable.
    assert!(set_recommendation_field(&folder, "Add Jobs Index", "title", "   ").is_err());

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn set_recommendation_field_rejects_unknown_fields_and_values() {
    let (test_dir, folder) = plan_with_one_recommendation("tendril-rec-invalid-test");

    let unknown_field = set_recommendation_field(&folder, "Add Index", "priority", "1");
    assert!(unknown_field.is_err());
    assert!(
        unknown_field
            .unwrap_err()
            .to_string()
            .contains("declineReason"),
        "the error names the fields that are valid, so a typo is self-correcting"
    );

    assert!(set_recommendation_field(&folder, "Add Index", "state", "Approved").is_err());
    assert!(set_recommendation_field(&folder, "Add Index", "impact", "Enormous").is_err());
    assert!(set_recommendation_field(&folder, "No Such Rec", "description", "x").is_err());

    // A rejected write leaves the plan exactly as it was.
    let rec = only_recommendation(&folder);
    assert_eq!(rec.state, RecommendationStatus::PENDING);
    assert_eq!(rec.description, "Index the jobs table");
    assert_eq!(rec.impact.as_deref(), Some("High"));

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn accepting_with_notes_lands_in_accepted_with_notes() {
    let (test_dir, folder) = plan_with_one_recommendation("tendril-rec-accept-test");

    let state = accept_recommendation(&folder, "Add Index", None).expect("Failed to accept");
    assert_eq!(state, RecommendationStatus::ACCEPTED);
    let rec = only_recommendation(&folder);
    assert_eq!(rec.state, RecommendationStatus::ACCEPTED);
    assert_eq!(rec.notes, None, "a bare accept has nothing to note");

    let state = accept_recommendation(
        &folder,
        "Add Index",
        Some("Do it after the index migration"),
    )
    .expect("Failed to accept with notes");
    assert_eq!(state, RecommendationStatus::ACCEPTED_WITH_NOTES);
    let rec = only_recommendation(&folder);
    assert_eq!(rec.state, RecommendationStatus::ACCEPTED_WITH_NOTES);
    assert_eq!(
        rec.notes.as_deref(),
        Some("Do it after the index migration")
    );

    // Whitespace is not a note: `AcceptedWithNotes` with an empty note would show
    // an empty "Notes:" line in the app and read as a lost note in the CLI.
    let state = accept_recommendation(&folder, "Add Index", Some("   ")).expect("Failed to accept");
    assert_eq!(state, RecommendationStatus::ACCEPTED);
    assert_eq!(only_recommendation(&folder).notes, None);

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn a_decline_reason_and_an_accept_note_never_coexist() {
    let (test_dir, folder) = plan_with_one_recommendation("tendril-rec-exclusive-test");

    accept_recommendation(&folder, "Add Index", Some("Worth doing")).expect("Failed to accept");
    decline_recommendation(&folder, "Add Index", Some("Superseded by partitioning"))
        .expect("Failed to decline");

    let rec = only_recommendation(&folder);
    assert_eq!(rec.state, RecommendationStatus::DECLINED);
    assert_eq!(
        rec.decline_reason.as_deref(),
        Some("Superseded by partitioning")
    );
    assert_eq!(
        rec.notes, None,
        "the accept note must not survive a decline: it would read as the reason"
    );

    accept_recommendation(&folder, "Add Index", Some("Reinstated")).expect("Failed to re-accept");
    let rec = only_recommendation(&folder);
    assert_eq!(rec.notes.as_deref(), Some("Reinstated"));
    assert_eq!(rec.decline_reason, None);

    // Moving back to Pending drops both: an untriaged recommendation has neither.
    set_recommendation_field(&folder, "Add Index", "state", RecommendationStatus::PENDING)
        .expect("Failed to reset state");
    let rec = only_recommendation(&folder);
    assert_eq!(rec.notes, None);
    assert_eq!(rec.decline_reason, None);

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn notes_round_trip_through_plan_yaml_and_are_omitted_when_absent() {
    let (test_dir, folder) = plan_with_one_recommendation("tendril-rec-yaml-test");

    accept_recommendation(&folder, "Add Index", Some("Ship with the 0.2 migration"))
        .expect("Failed to accept with notes");

    // Read back through the file, not through an in-memory value: `notes` has to
    // actually be serialized, or the app reads it back empty after a restart.
    let raw = std::fs::read_to_string(folder.join("plan.yaml")).expect("read plan.yaml");
    assert!(
        raw.contains("notes: Ship with the 0.2 migration"),
        "plan.yaml should carry the note verbatim:\n{raw}"
    );
    assert_eq!(
        only_recommendation(&folder).notes.as_deref(),
        Some("Ship with the 0.2 migration")
    );

    decline_recommendation(&folder, "Add Index", Some("Not this quarter"))
        .expect("Failed to decline");
    let raw = std::fs::read_to_string(folder.join("plan.yaml")).expect("read plan.yaml");
    assert!(
        !raw.contains("notes:"),
        "an absent note must be omitted rather than written as null:\n{raw}"
    );

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn set_recommendation_state_keeps_the_notes_rules_for_the_http_contract() {
    let (test_dir, folder) = plan_with_one_recommendation("tendril-rec-state-test");

    // The desktop app's existing `{state, declineReason}` shape reaches this
    // function, so an AcceptedWithNotes arriving with no text has to degrade to a
    // plain Accepted rather than claiming notes it does not have.
    set_recommendation_state(
        &folder,
        "Add Index",
        RecommendationStatus::ACCEPTED_WITH_NOTES,
        None,
    )
    .expect("Failed to set state");
    let rec = only_recommendation(&folder);
    assert_eq!(rec.state, RecommendationStatus::ACCEPTED);
    assert_eq!(rec.notes, None);

    set_recommendation_state(
        &folder,
        RecommendationStatus::ACCEPTED_WITH_NOTES,
        RecommendationStatus::ACCEPTED_WITH_NOTES,
        Some("ignored"),
    )
    .expect_err("an unknown title is not silently created");

    // Case-insensitive on the state as well as on the title, matching every other
    // loose parse in the plan model.
    set_recommendation_state(&folder, "add index", "declined", Some("Later"))
        .expect("Failed to decline");
    let rec = only_recommendation(&folder);
    assert_eq!(rec.state, RecommendationStatus::DECLINED);
    assert_eq!(rec.decline_reason.as_deref(), Some("Later"));

    assert!(set_recommendation_state(&folder, "Add Index", "Approved", None).is_err());

    let _ = std::fs::remove_dir_all(test_dir);
}

// --- Doctor: PR health (`tendril plan doctor --prs`) -------------------------------------------
//
// The resolver is injected, so these cases never invoke `gh`. `check_all_plans_health` stays offline
// and free; only this opt-in pass resolves anything.

mod common;

use common::{plan_with, HomeFixture};
use tendril_core::error::{Result as CoreResult, TendrilError};
use tendril_core::git::github::PrInfo;
use tendril_core::models::PrState;
use tendril_core::plans::doctor::check_pr_health_with;

const DOCTOR_PR: &str = "https://github.com/acme/widgets/pull/7";

fn resolver_for(status: PrState) -> impl Fn(&str) -> CoreResult<PrInfo> {
    move |_url: &str| {
        Ok(PrInfo {
            status,
            branch: Some("tendril/00010".to_string()),
        })
    }
}

fn resolver_failing_with(message: &'static str) -> impl Fn(&str) -> CoreResult<PrInfo> {
    move |_url: &str| Err(TendrilError::Git(message.to_string()))
}

fn never_called_head_resolver(url: &str) -> CoreResult<PrInfo> {
    panic!("the PR resolver must not be called, but was asked about {url}");
}

#[test]
fn doctor_reports_a_merged_pr_on_an_unfinished_plan() {
    let home = HomeFixture::new("doctor-merged");
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![DOCTOR_PR.to_string()];
    home.write_plan("00010-Unfinished", &plan);

    let issues = check_pr_health_with(&home.plans_dir(), &resolver_for(PrState::Merged))
        .expect("pr health check");

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "Warning");
    assert!(
        issues[0].message.contains("is merged but plan state is"),
        "{}",
        issues[0].message
    );
}

#[test]
fn doctor_is_quiet_about_a_merged_pr_on_a_completed_plan() {
    let home = HomeFixture::new("doctor-merged-completed");
    let mut plan = plan_with(PlanStatus::Completed, &[]);
    plan.prs = vec![DOCTOR_PR.to_string()];
    home.write_plan("00011-Done", &plan);

    let issues =
        check_pr_health_with(&home.plans_dir(), &resolver_for(PrState::Merged)).expect("check");

    assert!(issues.is_empty(), "{:?}", issues);
}

#[test]
fn doctor_flags_a_malformed_pr_url_without_resolving_it() {
    let home = HomeFixture::new("doctor-malformed");
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec!["https://github.com/acme/widgets/issues/7".to_string()];
    home.write_plan("00012-Malformed", &plan);

    let issues = check_pr_health_with(&home.plans_dir(), &never_called_head_resolver)
        .expect("a malformed URL is not a failure");

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "Warning");
    assert!(
        issues[0].message.contains("Malformed PR URL"),
        "{:?}",
        issues
    );
}

#[test]
fn doctor_flags_the_same_pr_recorded_on_two_plans() {
    let home = HomeFixture::new("doctor-duplicate");
    let mut first = plan_with(PlanStatus::Completed, &[]);
    first.prs = vec![DOCTOR_PR.to_string()];
    home.write_plan("00013-First", &first);

    let mut second = plan_with(PlanStatus::Completed, &[]);
    // A different spelling of the same PR still counts as a duplicate.
    second.prs = vec![format!("{}/files", DOCTOR_PR)];
    home.write_plan("00014-Second", &second);

    let issues =
        check_pr_health_with(&home.plans_dir(), &resolver_for(PrState::Merged)).expect("check");

    let duplicates: Vec<_> = issues
        .iter()
        .filter(|i| i.message.contains("is also recorded on plan"))
        .collect();
    assert_eq!(duplicates.len(), 2, "each plan hears about the other");
}

#[test]
fn doctor_calls_a_vanished_pr_an_error() {
    let home = HomeFixture::new("doctor-vanished");
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![DOCTOR_PR.to_string()];
    home.write_plan("00015-Vanished", &plan);

    let issues = check_pr_health_with(
        &home.plans_dir(),
        &resolver_failing_with("GraphQL: Could not resolve to a PullRequest with the number of 7."),
    )
    .expect("check");

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "Error");
    assert!(
        issues[0].message.contains("no longer resolvable"),
        "{}",
        issues[0].message
    );
}

/// An offline run must not report every healthy PR as vanished.
#[test]
fn doctor_calls_an_unreachable_github_a_warning() {
    let home = HomeFixture::new("doctor-offline");
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![DOCTOR_PR.to_string()];
    home.write_plan("00016-Offline", &plan);

    let issues = check_pr_health_with(
        &home.plans_dir(),
        &resolver_failing_with("gh: could not resolve host github.com"),
    )
    .expect("check");

    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, "Warning");
    assert!(
        issues[0].message.contains("Could not verify PR"),
        "{}",
        issues[0].message
    );
}

#[test]
fn doctor_says_nothing_about_an_open_pr() {
    let home = HomeFixture::new("doctor-open");
    let mut plan = plan_with(PlanStatus::Review, &[]);
    plan.prs = vec![DOCTOR_PR.to_string()];
    home.write_plan("00017-Open", &plan);

    let issues =
        check_pr_health_with(&home.plans_dir(), &resolver_for(PrState::Open)).expect("check");

    assert!(issues.is_empty(), "{:?}", issues);
}

/// A plan with no PRs must not cost a resolution.
#[test]
fn doctor_resolves_nothing_when_no_plan_records_a_pr() {
    let home = HomeFixture::new("doctor-no-prs");
    home.write_plan("00018-NoPrs", &plan_with(PlanStatus::Draft, &[]));

    let issues =
        check_pr_health_with(&home.plans_dir(), &never_called_head_resolver).expect("check");

    assert!(issues.is_empty());
}
