use chrono::Utc;
use tendril_core::chat::models::{ChatMessage, ChatSession};
use tendril_core::chat::storage::{
    delete_session, load_all_sessions, load_session, rename_session, sanitize_title, save_session,
};

#[test]
fn test_title_sanitization() {
    assert_eq!(sanitize_title("Fix user login..."), "Fix user login");
    assert_eq!(sanitize_title("Add settings page…"), "Add settings page");
    assert_eq!(sanitize_title("Nested ellipsis......"), "Nested ellipsis");
    assert_eq!(
        sanitize_title("   Spaces and dots...   "),
        "Spaces and dots"
    );
    assert_eq!(sanitize_title("..."), "New Chat");
    assert_eq!(sanitize_title("…"), "New Chat");
    assert_eq!(sanitize_title("   "), "New Chat");
    assert_eq!(sanitize_title(""), "New Chat");
    assert_eq!(sanitize_title("Ordinary Title"), "Ordinary Title");
}

#[test]
fn test_crud_and_atomic_writes() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-storage-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let now = Utc::now();
    let session = ChatSession {
        id: "test-session-1".to_string(),
        title: "Test Session 1".to_string(),
        created_at: now,
        updated_at: now,
        agent_id: "claude".to_string(),
        model_id: "sonnet".to_string(),
        messages: vec![ChatMessage {
            id: "msg-1".to_string(),
            role: "user".to_string(),
            content: "Hello Tendril".to_string(),
            timestamp: now,
            agent_id: None,
            model_id: None,
            raw_stream: None,
            effort: None,
        }],
        effort: Some("high".to_string()),
        spawned_job_ids: vec![],
        plan_folder_name: None,
    };

    // Save session
    save_session(&test_dir, &session).expect("Failed to save session");

    // Load session
    let loaded = load_session(&test_dir, "test-session-1").expect("Failed to load session");
    assert_eq!(loaded.id, "test-session-1");
    assert_eq!(loaded.title, "Test Session 1");
    assert_eq!(loaded.messages.len(), 1);
    assert_eq!(loaded.messages[0].content, "Hello Tendril");

    // Verify atomic file existence and valid JSON on disk
    let session_file = test_dir.join("Chats").join("test-session-1.json");
    assert!(session_file.exists());
    let raw_content = std::fs::read_to_string(&session_file).expect("Failed to read raw json");
    let parsed: serde_json::Value =
        serde_json::from_str(&raw_content).expect("Disk file must be valid JSON");
    assert_eq!(parsed["title"], "Test Session 1");

    // Rename session
    let renamed =
        rename_session(&test_dir, "test-session-1", "Updated Title...").expect("Failed to rename");
    assert_eq!(renamed.title, "Updated Title");

    let loaded_renamed =
        load_session(&test_dir, "test-session-1").expect("Failed to reload session");
    assert_eq!(loaded_renamed.title, "Updated Title");

    // Load all sessions
    let all = load_all_sessions(&test_dir).expect("Failed to load all");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, "test-session-1");

    // Delete session
    delete_session(&test_dir, "test-session-1").expect("Failed to delete session");
    assert!(!session_file.exists());

    let res_after_delete = load_session(&test_dir, "test-session-1");
    assert!(res_after_delete.is_err());

    let all_after_delete = load_all_sessions(&test_dir).expect("Failed to load all");
    assert_eq!(all_after_delete.len(), 0);

    let _ = std::fs::remove_dir_all(&test_dir);
}
