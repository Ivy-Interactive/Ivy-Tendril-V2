use tendril_core::plans::reader::read_plan_file;
use tendril_core::plans::writer::write_plan_yaml;

const PLAN_WITH_CHAT_SESSION_AND_EXTRA: &str = r#"schemaVersion: 3
state: Draft
project: ParityProject
level: Feature
title: Plan With Chat Session
repos: []
created: 2026-09-07T12:00:00Z
updated: 2026-09-07T12:00:00Z
prs: []
commits: []
verifications: []
relatedPlans: []
dependsOn: []
priority: 0
partialDelivery: false
chatSessionId: sess-abc-123
customTag: special-tag
futureObject:
  featureFlag: true
  retries: 5
"#;

#[test]
fn test_plan_chatsession_and_unknown_keys_roundtrip() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-chatsession-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let plan_folder = temp_dir.join("00099-PlanWithChatSession");
    std::fs::create_dir_all(&plan_folder).unwrap();

    let plan_yaml_path = plan_folder.join("plan.yaml");
    std::fs::write(&plan_yaml_path, PLAN_WITH_CHAT_SESSION_AND_EXTRA).unwrap();

    // Create minimal revision
    let rev_dir = plan_folder.join("Revisions");
    std::fs::create_dir_all(&rev_dir).unwrap();
    std::fs::write(
        rev_dir.join("001.md"),
        "# Plan With Chat Session\n\n## Problem",
    )
    .unwrap();

    // Read plan via read_plan_file
    let plan_file = read_plan_file(&plan_folder).expect("read_plan_file should succeed");
    assert_eq!(
        plan_file.metadata.chat_session_id.as_deref(),
        Some("sess-abc-123")
    );
    assert_eq!(plan_file.chat_session_id(), Some("sess-abc-123"));

    // Deserialize directly into PlanYaml to inspect extra
    let (mut plan_yaml, _) =
        tendril_core::plans::reader::read_plan_yaml(&plan_folder).expect("read_plan_yaml");
    assert_eq!(plan_yaml.chat_session_id.as_deref(), Some("sess-abc-123"));
    assert!(plan_yaml.extra.contains_key("customTag"));
    assert!(plan_yaml.extra.contains_key("futureObject"));

    // Modify a standard field and write back
    plan_yaml.title = "Plan With Chat Session Updated".to_string();
    write_plan_yaml(&plan_folder, &plan_yaml).expect("write_plan_yaml should succeed");

    // Read raw back and assert chatSessionId and extra fields survived
    let raw_after = std::fs::read_to_string(&plan_yaml_path).unwrap();
    assert!(raw_after.contains("chatSessionId: sess-abc-123"));
    assert!(raw_after.contains("customTag: special-tag"));
    assert!(raw_after.contains("futureObject:"));
    assert!(raw_after.contains("featureFlag: true"));

    let (reloaded, _) =
        tendril_core::plans::reader::read_plan_yaml(&plan_folder).expect("reloaded read_plan_yaml");
    assert_eq!(reloaded.chat_session_id.as_deref(), Some("sess-abc-123"));
    assert_eq!(reloaded.title, "Plan With Chat Session Updated");
    assert_eq!(
        reloaded.extra.get("customTag"),
        plan_yaml.extra.get("customTag")
    );
    assert_eq!(
        reloaded.extra.get("futureObject"),
        plan_yaml.extra.get("futureObject")
    );

    let _ = std::fs::remove_dir_all(&temp_dir);
}
