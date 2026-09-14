use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tendril_core::agents::providers::AgentProcessSpec;
use tendril_core::chat::execution::{ChatEvent, ChatExecutionManager, ChatTurnOptions};
use tendril_core::chat::models::ChatQueuedItem;
use tendril_core::chat::storage::load_session;

#[tokio::test]
async fn test_chat_queue_management() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-queue-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = ChatExecutionManager::new(test_dir.clone());
    let session_id = "test-queue-session";

    let item1 = ChatQueuedItem {
        id: "q-1".to_string(),
        prompt: "First prompt".to_string(),
        attachments: None,
        created_at: chrono::Utc::now(),
    };
    let item2 = ChatQueuedItem {
        id: "q-2".to_string(),
        prompt: "Second prompt".to_string(),
        attachments: None,
        created_at: chrono::Utc::now(),
    };

    mgr.enqueue_message(session_id, item1.clone()).await;
    mgr.enqueue_message(session_id, item2.clone()).await;

    let queued = mgr.get_queued_messages(session_id).await;
    assert_eq!(queued.len(), 2);
    assert_eq!(queued[0].id, "q-1");
    assert_eq!(queued[1].id, "q-2");

    // Dequeue in FIFO order
    let popped1 = mgr
        .dequeue_message(session_id)
        .await
        .expect("Must pop item 1");
    assert_eq!(popped1.id, "q-1");
    assert_eq!(popped1.prompt, "First prompt");

    // Remove remaining
    let removed = mgr.remove_queued_message(session_id, "q-2").await;
    assert!(removed);
    assert_eq!(mgr.get_queued_messages(session_id).await.len(), 0);

    // Clear
    mgr.enqueue_message(session_id, item1).await;
    mgr.clear_queued_messages(session_id).await;
    assert_eq!(mgr.get_queued_messages(session_id).await.len(), 0);

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_chat_execution_turn_and_job_tracking() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-exec-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone())
            .with_spec_builder(Arc::new(|_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    "echo '{\"delta\": \"Hello \"}'; sleep 0.05; echo '{\"delta\": \"World!\"}'; echo 'Job started: 00123'".to_string(),
                ],
                environment: HashMap::new(),
                working_directory: config.working_directory.clone(),
                stdin_content: None,
                redirect_stdin: false,
                temp_files: vec![],
            }))
            .with_persist_interval(Duration::from_millis(20)),
    );

    let mut rx = mgr.subscribe_events();

    let session = mgr
        .create_session(
            Some("New Chat".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(
        &session.id,
        "Implement something cool",
        ChatTurnOptions::default(),
    )
    .await
    .expect("Failed to start session turn");

    let mut deltas = Vec::new();
    let mut job_spawned_received = false;
    let mut finished = false;

    // Receive events
    while let Ok(evt) = rx.recv().await {
        match evt {
            ChatEvent::StreamDelta { delta, .. } => {
                deltas.push(delta);
            }
            ChatEvent::JobSpawned { job_id, .. } => {
                assert_eq!(job_id, "00123");
                job_spawned_received = true;
            }
            ChatEvent::GeneratingState {
                is_generating: false,
                ..
            } => {
                finished = true;
                break;
            }
            _ => {}
        }
    }

    assert!(finished, "Turn should have finished");
    assert!(job_spawned_received, "JobSpawned event should be received");
    assert!(deltas.contains(&"Hello ".to_string()));
    assert!(deltas.contains(&"World!".to_string()));

    // Verify session persisted to disk
    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    assert_eq!(loaded.messages.len(), 2);
    assert_eq!(loaded.messages[0].role, "user");
    assert_eq!(loaded.messages[0].content, "Implement something cool");
    assert_eq!(loaded.messages[1].role, "assistant");
    assert!(loaded.messages[1].content.contains("Hello World!"));
    assert!(loaded.spawned_job_ids.contains(&"00123".to_string()));

    // Title was updated from "New Chat" to snippet of prompt
    assert_eq!(loaded.title, "Implement something cool");

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_chat_execution_cancellation() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-cancel-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    "echo '{\"delta\": \"Starting...\"}'; sleep 10; echo '{\"delta\": \"Finished\"}'"
                        .to_string(),
                ],
                environment: HashMap::new(),
                working_directory: config.working_directory.clone(),
                stdin_content: None,
                redirect_stdin: false,
                temp_files: vec![],
            },
        )),
    );

    let mut rx = mgr.subscribe_events();

    let session = mgr
        .create_session(
            Some("Cancel Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(&session.id, "Long running task", ChatTurnOptions::default())
        .await
        .expect("Failed to start session turn");

    // Wait until started generating
    while let Ok(evt) = rx.recv().await {
        if let ChatEvent::GeneratingState {
            is_generating: true,
            ..
        } = evt
        {
            break;
        }
    }

    assert!(mgr.is_generating(&session.id).await);

    // Cancel session
    let start_cancel = tokio::time::Instant::now();
    let cancelled = mgr.cancel_session(&session.id).await;
    assert!(cancelled);

    // Wait for generating state to turn false
    while let Ok(evt) = rx.recv().await {
        if let ChatEvent::GeneratingState {
            is_generating: false,
            ..
        } = evt
        {
            break;
        }
    }

    assert!(
        start_cancel.elapsed() < Duration::from_secs(6),
        "Cancellation should terminate quickly without waiting for full command sleep"
    );
    assert!(!mgr.is_generating(&session.id).await);

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_throttled_persistence() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-persist-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone())
            .with_spec_builder(Arc::new(|_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    "echo '{\"delta\": \"IntermediateChunk\"}'; sleep 0.25; echo '{\"delta\": \"FinalChunk\"}'"
                        .to_string(),
                ],
                environment: HashMap::new(),
                working_directory: config.working_directory.clone(),
                stdin_content: None,
                redirect_stdin: false,
                temp_files: vec![],
            }))
            .with_persist_interval(Duration::from_millis(50)),
    );

    let mut rx = mgr.subscribe_events();

    let session = mgr
        .create_session(
            Some("Persist Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(&session.id, "Test prompt", ChatTurnOptions::default())
        .await
        .expect("Failed to start session turn");

    // Wait for first delta
    while let Ok(evt) = rx.recv().await {
        if let ChatEvent::StreamDelta { delta, .. } = evt {
            if delta.contains("IntermediateChunk") {
                break;
            }
        }
    }

    // Wait a bit for persist interval (50ms) to trigger disk write while process is still sleeping (0.25s)
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Load from disk: intermediate content must already be persisted!
    let on_disk = load_session(&test_dir, &session.id).expect("Session must be on disk");
    assert_eq!(on_disk.messages.len(), 2);
    assert!(
        on_disk.messages[1].content.contains("IntermediateChunk"),
        "Intermediate streaming content should be persisted to disk before final completion"
    );

    // Wait for completion
    while let Ok(evt) = rx.recv().await {
        if let ChatEvent::GeneratingState {
            is_generating: false,
            ..
        } = evt
        {
            break;
        }
    }

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_chat_turn_closes_unclosed_tool_calls() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-reconcile-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    r#"echo '{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}'"#
                        .to_string(),
                ],
                environment: HashMap::new(),
                working_directory: config.working_directory.clone(),
                stdin_content: None,
                redirect_stdin: false,
                temp_files: vec![],
            },
        )),
    );

    let mut rx = mgr.subscribe_events();

    let session = mgr
        .create_session(
            Some("Reconcile Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(
        &session.id,
        "Run a tool that never closes",
        ChatTurnOptions::default(),
    )
    .await
    .expect("Failed to start session turn");

    while let Ok(evt) = rx.recv().await {
        if let ChatEvent::GeneratingState {
            is_generating: false,
            ..
        } = evt
        {
            break;
        }
    }

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    let assistant_msg = loaded
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .expect("Must have an assistant message");
    let raw_stream = assistant_msg
        .raw_stream
        .as_deref()
        .expect("Assistant message must carry a raw stream");

    let mut called_ids: Vec<String> = Vec::new();
    let mut closed_ids: Vec<String> = Vec::new();
    for line in raw_stream.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        match v.get("kind").and_then(|k| k.as_str()) {
            Some("tool_call") => {
                if let Some(id) = v.get("tool_use_id").and_then(|i| i.as_str()) {
                    called_ids.push(id.to_string());
                }
            }
            Some("tool_result") => {
                if let Some(id) = v.get("tool_use_id").and_then(|i| i.as_str()) {
                    closed_ids.push(id.to_string());
                }
            }
            _ => {}
        }
    }

    assert_eq!(called_ids, vec!["t1"]);
    assert_eq!(
        closed_ids, called_ids,
        "every tool_call id must have a terminal tool_result"
    );

    let _ = std::fs::remove_dir_all(&test_dir);
}
