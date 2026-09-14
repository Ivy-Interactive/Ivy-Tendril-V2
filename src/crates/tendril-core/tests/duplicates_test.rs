use tendril_core::models::PlanYaml;
use tendril_core::plans::{write_plan_yaml, DuplicateCandidate, DuplicateCandidateFinder};

#[test]
fn test_tokenize_and_stopwords() {
    let title = "The Quick Brown Fox Jumps Over a Lazy Dog with 00042 in Database";
    let tokens = DuplicateCandidateFinder::tokenize(title);

    // Stopwords should be removed
    assert!(!tokens.contains("the"));
    assert!(!tokens.contains("a"));
    assert!(!tokens.contains("with"));
    assert!(!tokens.contains("in"));

    // Normal tokens should be preserved in lowercase
    assert!(tokens.contains("quick"));
    assert!(tokens.contains("brown"));
    assert!(tokens.contains("fox"));
    assert!(tokens.contains("jumps"));
    assert!(tokens.contains("over"));
    assert!(tokens.contains("lazy"));
    assert!(tokens.contains("dog"));
    assert!(tokens.contains("00042"));
    assert!(tokens.contains("database"));
}

#[test]
fn test_format_block() {
    let candidates = vec![
        DuplicateCandidate {
            folder_name: "00010-FixLogin".to_string(),
            title: "Fix Login".to_string(),
            state: "Completed".to_string(),
        },
        DuplicateCandidate {
            folder_name: "00015-LoginFix".to_string(),
            title: "Login Fix".to_string(),
            state: "Draft".to_string(),
        },
    ];

    let block = DuplicateCandidateFinder::format_block(&candidates);
    assert!(block.starts_with("DuplicateCandidates:"));
    assert!(block.contains("00010-FixLogin|Fix Login|Completed"));
    assert!(block.contains("00015-LoginFix|Login Fix|Draft"));

    assert_eq!(DuplicateCandidateFinder::format_block(&[]), "");
}

#[test]
fn test_find_duplicate_candidates() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-dup-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    // Create 3 plans:
    // 1. "Authentication service login timeout" in project "Alpha"
    // 2. "Authentication service database failure" in project "Alpha"
    // 3. "Authentication service login timeout" in project "Beta" (different project)
    // 4. "Unrelated cache eviction mechanism" in project "Alpha"

    let make_plan = |folder: &str, title: &str, project: &str, state: &str| {
        let p_folder = test_dir.join(folder);
        std::fs::create_dir_all(&p_folder).unwrap();
        let plan_yaml = PlanYaml {
            schema_version: 1,
            state: state.to_string(),
            project: project.to_string(),
            level: "Bug".to_string(),
            title: title.to_string(),
            repos: vec![],
            created: chrono::Utc::now(),
            updated: chrono::Utc::now(),
            prs: vec![],
            commits: vec![],
            worktrees: None,
            verifications: vec![],
            related_plans: vec![],
            depends_on: vec![],
            priority: 0,
            partial_delivery: false,
            execution_profile: None,
            initial_prompt: None,
            source_url: None,
            recommendations: None,
            chat_session_id: None,
            extra: std::collections::BTreeMap::new(),
        };
        write_plan_yaml(&p_folder, &plan_yaml).unwrap();
    };

    make_plan(
        "00001-AuthServiceLoginTimeout",
        "Authentication service login timeout",
        "Alpha",
        "Completed",
    );
    make_plan(
        "00002-AuthServiceDbFail",
        "Authentication service database failure",
        "Alpha",
        "Draft",
    );
    make_plan(
        "00003-AuthBeta",
        "Authentication service login timeout",
        "Beta",
        "Draft",
    );
    make_plan(
        "00004-CacheEviction",
        "Unrelated cache eviction mechanism",
        "Alpha",
        "Draft",
    );

    // Search for duplicate of "Authentication service login issue" in project "Alpha"
    let candidates = DuplicateCandidateFinder::find(
        &test_dir,
        "Authentication service login issue",
        "Alpha",
        None,
    );

    assert_eq!(candidates.len(), 2);
    let folders: Vec<String> = candidates.into_iter().map(|c| c.folder_name).collect();
    assert!(folders.contains(&"00001-AuthServiceLoginTimeout".to_string()));
    assert!(folders.contains(&"00002-AuthServiceDbFail".to_string()));

    // Test with exclude_folder_name
    let candidates_ex = DuplicateCandidateFinder::find(
        &test_dir,
        "Authentication service login issue",
        "Alpha",
        Some("00001-AuthServiceLoginTimeout"),
    );
    assert_eq!(candidates_ex.len(), 1);
    assert_eq!(candidates_ex[0].folder_name, "00002-AuthServiceDbFail");

    // Test plan ID direct match
    make_plan("00005-Ref", "Followup for 00001", "Alpha", "Draft");
    let candidates_id =
        DuplicateCandidateFinder::find(&test_dir, "Discussion of 00001", "Alpha", None);
    assert_eq!(candidates_id.len(), 1);
    assert_eq!(candidates_id[0].folder_name, "00005-Ref");

    let _ = std::fs::remove_dir_all(test_dir);
}
