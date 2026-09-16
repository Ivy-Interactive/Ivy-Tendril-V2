use chrono::Utc;
use tendril_core::chat::models::{ChatMessage, ChatSession};
use tendril_core::chat::storage::{
    delete_session, load_all_sessions, load_session, plan_session_recipients, rename_session,
    sanitize_title, save_session,
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

/// Which chats a plan's events reach: every session attached to its folder, plus the plan's own chat.
/// The daemon's job notifier runs a turn per recipient, so the rule has to be the same one the existing
/// pull-request broadcast uses — hence one function, tested here.
#[test]
fn test_plan_session_recipients() {
    let dir = std::env::temp_dir().join(format!(
        "tendril-chat-recipients-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).expect("create test dir");

    let session = |id: &str, folder: Option<&str>| ChatSession {
        id: id.to_string(),
        title: id.to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        agent_id: "claude".to_string(),
        model_id: "default".to_string(),
        messages: Vec::new(),
        effort: None,
        spawned_job_ids: Vec::new(),
        plan_folder_name: folder.map(str::to_string),
    };

    for s in [
        session("attached-a", Some("00007-PortTheChat")),
        session("attached-b", Some("00007-PortTheChat")),
        session("other-plan", Some("00008-Something")),
        session("free-standing", None),
        // The plan's own chat, which is named by `plan.yaml` rather than by a folder on the session.
        session("plan-chat", None),
    ] {
        save_session(&dir, &s).expect("save");
    }

    let recipients =
        plan_session_recipients(&dir, "00007-PortTheChat", Some("plan-chat")).expect("recipients");
    assert_eq!(recipients, vec!["attached-a", "attached-b", "plan-chat"]);

    // Without the plan's own chat id, only the attached sessions qualify.
    let attached_only =
        plan_session_recipients(&dir, "00007-PortTheChat", None).expect("recipients");
    assert_eq!(attached_only, vec!["attached-a", "attached-b"]);

    // A plan nothing is watching reaches nobody, rather than everybody.
    assert!(plan_session_recipients(&dir, "00099-Nothing", None)
        .expect("recipients")
        .is_empty());

    let _ = std::fs::remove_dir_all(&dir);
}
