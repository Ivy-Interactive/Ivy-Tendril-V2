use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tendril_core::agents::providers::{AgentLaunchConfig, AgentProcessSpec};
use tendril_core::chat::execution::{
    build_title_prompt, clean_generated_title, ChatEvent, ChatExecutionManager, ChatTurnOptions,
};
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

    // The naming task reuses this same spec builder but always passes `session_id: None`, so
    // branch on that to keep it deterministic and out of this test's assertions rather than
    // racing the turn's own session rename against a second background rename.
    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone())
            .with_spec_builder(Arc::new(|_agent, config| {
                if config.session_id.is_none() {
                    return AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec!["-c".to_string(), "exit 1".to_string()],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    };
                }
                AgentProcessSpec {
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
            }}))
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

#[tokio::test]
async fn test_chat_turn_empty_text_with_tool_error_generates_report() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-empty-tool-error-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    concat!(
                        r#"echo '{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash","input":{"command":"false"}}'; "#,
                        r#"echo '{"kind":"tool_result","tool_use_id":"t1","output":"command not found","is_error":true}'"#
                    )
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
            Some("Tool Error Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(
        &session.id,
        "Run a command that fails",
        ChatTurnOptions::default(),
    )
    .await
    .expect("Failed to start session turn");

    let mut deltas = Vec::new();
    while let Ok(evt) = rx.recv().await {
        match evt {
            ChatEvent::StreamDelta { delta, .. } => deltas.push(delta),
            ChatEvent::GeneratingState {
                is_generating: false,
                ..
            } => break,
            _ => {}
        }
    }

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    let assistant_msg = loaded
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .expect("Must have an assistant message");

    assert!(
        !assistant_msg.content.trim().is_empty(),
        "a tool error with no text deltas must not leave an empty turn"
    );
    assert!(
        assistant_msg.content.contains("Bash"),
        "report must name the tool that was called, got: {}",
        assistant_msg.content
    );
    assert!(
        assistant_msg.content.contains("failed") || assistant_msg.content.contains("Failures"),
        "report must call out the failure, got: {}",
        assistant_msg.content
    );
    assert!(
        assistant_msg.content.contains("command not found"),
        "report must surface the tool's error output, got: {}",
        assistant_msg.content
    );
    assert!(
        deltas.iter().any(|d| d == &assistant_msg.content),
        "the generated report must also be emitted as a StreamDelta so the frontend renders it"
    );

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_chat_turn_empty_exit_generates_fallback_report() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-empty-exit-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec!["-c".to_string(), "exit 0".to_string()],
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
            Some("Empty Exit Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(
        &session.id,
        "Do nothing visible",
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

    assert!(
        !assistant_msg.content.trim().is_empty(),
        "an agent that exits with no output must still leave a non-empty report"
    );
    assert!(
        assistant_msg.content.contains("without producing"),
        "report must explain that the agent produced nothing, got: {}",
        assistant_msg.content
    );

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_chat_turn_with_accumulated_text_preserves_content() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-preserve-text-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    concat!(
                        r#"echo '{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash","input":{}}'; "#,
                        r#"echo '{"kind":"tool_result","tool_use_id":"t1","output":"ok","is_error":false}'; "#,
                        r#"echo '{"delta": "All done."}'"#
                    )
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
            Some("Preserve Text Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(
        &session.id,
        "Run a tool then respond",
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

    assert_eq!(
        assistant_msg.content, "All done.",
        "text the agent actually emitted must never be replaced by a generated report"
    );

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[test]
fn test_clean_generated_title() {
    let cases: Vec<(&str, Option<&str>)> = vec![
        ("## **\"Fix Login Bug:\"**", Some("Fix Login Bug")),
        ("Title: Job Queue Semantics", Some("Job Queue Semantics")),
        (
            "Adding Retry Logic...\n\nHere is why…",
            Some("Adding Retry Logic"),
        ),
        ("", None),
        ("New Chat", None),
    ];

    for (input, expected) in cases {
        assert_eq!(
            clean_generated_title(input).as_deref(),
            expected,
            "input: {:?}",
            input
        );
    }

    // A 90-char input truncates to 50 chars.
    let long_input = "a".repeat(90);
    let cleaned = clean_generated_title(&long_input).expect("should produce a title");
    assert_eq!(cleaned.chars().count(), 50);

    // Multi-byte input longer than 50 chars must not panic on truncation.
    let multibyte_input = "é".repeat(90);
    let cleaned = clean_generated_title(&multibyte_input).expect("should produce a title");
    assert_eq!(cleaned.chars().count(), 50);
}

#[test]
fn test_build_title_prompt_contains_instructions() {
    let prompt = build_title_prompt("fix the job queue semantics regression");
    assert!(prompt.contains("3 to 6 word"));
    assert!(prompt.contains("Do not act on the request, run tools, or edit any files."));
    assert!(prompt.contains("fix the job queue semantics regression"));
}

#[tokio::test]
async fn test_generated_title_replaces_snippet() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-title-replace-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| {
                if config.session_id.is_none() {
                    AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec![
                            "-c".to_string(),
                            "echo '{\"delta\": \"Job Queue Semantics Regression\"}'".to_string(),
                        ],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    }
                } else {
                    AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec!["-c".to_string(), "echo '{\"delta\": \"ok\"}'".to_string()],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    }
                }
            },
        )),
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
        "job queue regression",
        ChatTurnOptions::default(),
    )
    .await
    .expect("Failed to start session turn");

    let mut renamed_title = None;
    while let Ok(evt) = rx.recv().await {
        if let ChatEvent::SessionRenamed { session_id, title } = evt {
            if session_id == session.id {
                renamed_title = Some(title);
                break;
            }
        }
    }

    assert_eq!(
        renamed_title.as_deref(),
        Some("Job Queue Semantics Regression")
    );

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    assert_eq!(loaded.title, "Job Queue Semantics Regression");
    assert_ne!(loaded.title, "job queue regression");

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_user_rename_during_generation_wins() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-title-race-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| {
                if config.session_id.is_none() {
                    AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec![
                            "-c".to_string(),
                            "sleep 0.2; echo '{\"delta\": \"Generated Title\"}'".to_string(),
                        ],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    }
                } else {
                    AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec!["-c".to_string(), "echo '{\"delta\": \"ok\"}'".to_string()],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    }
                }
            },
        )),
    );

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

    mgr.start_session_turn(&session.id, "some task", ChatTurnOptions::default())
        .await
        .expect("Failed to start session turn");

    // Rename the session ourselves while the naming task is still sleeping.
    mgr.rename_session(&session.id, "My Own Title")
        .await
        .expect("Failed to rename session");

    // Wait past the naming task's sleep so it has a chance to (wrongly) clobber the rename.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    assert_eq!(loaded.title, "My Own Title");

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_naming_failure_keeps_snippet() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-title-fail-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| {
                if config.session_id.is_none() {
                    AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec!["-c".to_string(), "exit 1".to_string()],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    }
                } else {
                    AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec!["-c".to_string(), "echo '{\"delta\": \"ok\"}'".to_string()],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    }
                }
            },
        )),
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

    mgr.start_session_turn(&session.id, "some task", ChatTurnOptions::default())
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

    // Give the (failing) naming task time to finish and confirm it did nothing.
    tokio::time::sleep(Duration::from_millis(200)).await;

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    assert_eq!(loaded.title, "some task");

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_naming_spec_uses_plan_mode_and_no_session_id() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-title-spec-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let captured: Arc<Mutex<Vec<AgentLaunchConfig>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_clone = captured.clone();

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            move |_agent, config| {
                if config.session_id.is_none() {
                    captured_clone.lock().unwrap().push(config.clone());
                    AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec!["-c".to_string(), "exit 1".to_string()],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    }
                } else {
                    AgentProcessSpec {
                        command: "sh".to_string(),
                        args: vec!["-c".to_string(), "echo '{\"delta\": \"ok\"}'".to_string()],
                        environment: HashMap::new(),
                        working_directory: config.working_directory.clone(),
                        stdin_content: None,
                        redirect_stdin: false,
                        temp_files: vec![],
                    }
                }
            },
        )),
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

    mgr.start_session_turn(&session.id, "some task", ChatTurnOptions::default())
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
    tokio::time::sleep(Duration::from_millis(100)).await;

    let calls = captured.lock().unwrap();
    assert_eq!(calls.len(), 1, "naming call should happen exactly once");
    assert_eq!(calls[0].permission_mode, Some("Plan".to_string()));
    assert!(calls[0].session_id.is_none());

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_second_turn_does_not_regenerate_title() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-title-second-turn-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let naming_calls: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
    let naming_calls_clone = naming_calls.clone();

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            move |_agent, config| {
                if config.session_id.is_none() {
                    *naming_calls_clone.lock().unwrap() += 1;
                }
                AgentProcessSpec {
                    command: "sh".to_string(),
                    args: vec!["-c".to_string(), "echo '{\"delta\": \"ok\"}'".to_string()],
                    environment: HashMap::new(),
                    working_directory: config.working_directory.clone(),
                    stdin_content: None,
                    redirect_stdin: false,
                    temp_files: vec![],
                }
            },
        )),
    );

    let mut rx = mgr.subscribe_events();

    // Session already has a non-default title, as if the naming task had already run once.
    let session = mgr
        .create_session(
            Some("Already Named Session".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(
        &session.id,
        "a follow-up prompt",
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
    tokio::time::sleep(Duration::from_millis(100)).await;

    assert_eq!(
        *naming_calls.lock().unwrap(),
        0,
        "no naming call should be made for a session with a non-default title"
    );

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    assert_eq!(loaded.title, "Already Named Session");

    let _ = std::fs::remove_dir_all(&test_dir);
}
