use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tendril_core::agents::providers::{AgentLaunchConfig, AgentProcessSpec};
use tendril_core::chat::execution::{
    build_title_prompt, clean_generated_title, ChatEvent, ChatExecutionManager, ChatTurnOptions,
};
use tendril_core::chat::models::ChatQueuedItem;
use tendril_core::chat::storage::load_session;

/// Whether a launch is the background title-naming run rather than the turn itself. Naming is the
/// only chat launch that asks for `Plan` mode, so a mock spec builder can branch on it and keep the
/// two runs' output apart. (It used to branch on `session_id`, which no chat launch sets any more:
/// Claude Code refuses a `--session-id` it has already opened, so a chat turn cannot reuse the chat
/// session's id.)
fn is_naming_call(config: &AgentLaunchConfig) -> bool {
    config.permission_mode.as_deref() == Some("Plan")
}

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
        role: None,
    };
    let item2 = ChatQueuedItem {
        id: "q-2".to_string(),
        prompt: "Second prompt".to_string(),
        attachments: None,
        created_at: chrono::Utc::now(),
        role: None,
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

    // The naming task reuses this same spec builder but always asks for `Plan` mode, so branch on
    // that to keep it deterministic and out of this test's assertions rather than racing the turn's
    // own session rename against a second background rename.
    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone())
            .with_spec_builder(Arc::new(|_agent, config| {
                if is_naming_call(config) {
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
    let mut finalized_contents = Vec::new();
    while let Ok(evt) = rx.recv().await {
        match evt {
            ChatEvent::StreamDelta { delta, .. } => deltas.push(delta),
            ChatEvent::MessageAdded { message, .. } if message.role == "assistant" => {
                finalized_contents.push(message.content);
            }
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
    // The message no longer inventories the calls. It used to, because nothing else surfaced them;
    // now the stream carries a renderable pair per tool and restating them in prose was a second,
    // longer copy of what the cards already show — which is what buried the reason that mattered.
    assert!(
        !assistant_msg.content.contains("Bash")
            && !assistant_msg.content.contains("Summary of Actions"),
        "the turn must not restate its tool calls, got: {}",
        assistant_msg.content
    );
    // The agent reported no failure of its own and exited zero, so this is V1's wording for a run
    // that succeeded without saying anything. What it *did*, including the tool that errored, is on
    // the stream below.
    assert_eq!(assistant_msg.content, "Task completed successfully.");

    // The tool's failure is not lost — it is on the stream, as the event a card renders red.
    let raw_stream = assistant_msg
        .raw_stream
        .as_deref()
        .expect("Assistant message must carry a raw stream");
    let errored = raw_stream
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .find(|v| v.get("kind").and_then(|k| k.as_str()) == Some("tool_result"))
        .expect("the tool result must be on the stream");
    assert_eq!(
        errored.get("is_error").and_then(|e| e.as_bool()),
        Some(true)
    );
    assert_eq!(
        errored.get("output").and_then(|o| o.as_str()),
        Some("command not found")
    );
    // The finished turn is republished as an upsert of the whole message, not as a delta appended to
    // whatever the client had: a delta is only correct if it is applied exactly once, and applying
    // the report twice is what showed the same sentence twice in the UI.
    assert!(
        finalized_contents.contains(&assistant_msg.content),
        "the finished turn must be republished as a MessageAdded carrying its final content, got: {:?}",
        finalized_contents
    );
    assert!(
        !deltas.iter().any(|d| d == &assistant_msg.content),
        "the synthesized report must not also arrive as an appendable StreamDelta"
    );

    let _ = std::fs::remove_dir_all(&test_dir);
}

#[tokio::test]
async fn test_chat_turn_succeeds_silently_reports_completion() {
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
    // `ChatExecutionService`'s wording for a run that succeeded without saying anything.
    assert_eq!(assistant_msg.content, "Task completed successfully.");

    let _ = std::fs::remove_dir_all(&test_dir);
}

/// The bug this covers: the report for a failed turn used to read "The agent exited without producing
/// a response, and no failure reason was found in its output" even when the process had written the
/// reason to stderr and exited non-zero. The reason is now the whole of the message, not a detail
/// introduced by an exit code that may well be zero.
#[tokio::test]
async fn test_chat_turn_failure_reports_the_reason_it_was_given() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-failure-reason-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| AgentProcessSpec {
                command: "sh".to_string(),
                args: vec![
                    "-c".to_string(),
                    "echo 'Error: Session ID abc is already in use.' 1>&2; exit 1".to_string(),
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
            Some("Failure Reason Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(&session.id, "do the thing", ChatTurnOptions::default())
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
        assistant_msg
            .content
            .contains("Session ID abc is already in use"),
        "the failure must carry the agent's own stderr, got: {}",
        assistant_msg.content
    );
    assert!(
        !assistant_msg.content.contains("no failure reason"),
        "a turn with a knowable reason must never claim none was found, got: {}",
        assistant_msg.content
    );
    // The reason is the explanation, so it leads. A turn whose provider answered 503 on a process
    // that exited 0 read "completed with status code 0: API error …", as though the clean exit were
    // the reason for a turn that plainly failed.
    assert!(
        !assistant_msg
            .content
            .starts_with("Agent execution completed"),
        "the reason must lead rather than be introduced by an exit code, got: {}",
        assistant_msg.content
    );

    let _ = std::fs::remove_dir_all(&test_dir);
}

/// A missing agent binary produces no output stream at all, so the spawn error is the only thing that
/// can explain the turn.
#[tokio::test]
async fn test_chat_turn_missing_agent_binary_is_reported() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-missing-binary-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            |_agent, config| AgentProcessSpec {
                command: "tendril-no-such-agent-binary".to_string(),
                args: vec![],
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
            Some("Missing Binary Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(&session.id, "do the thing", ChatTurnOptions::default())
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
        assistant_msg
            .content
            .contains("tendril-no-such-agent-binary"),
        "the failure must name the binary that could not be launched, got: {}",
        assistant_msg.content
    );

    let _ = std::fs::remove_dir_all(&test_dir);
}

/// Claude Code's `stream-json` shape, end to end: the assistant text has to reach the message, and
/// the terminal `result` line (which repeats it) must not be appended a second time.
#[tokio::test]
async fn test_chat_turn_reads_claude_stream_json() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-claude-stream-test-{}",
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
                        r#"echo '{"type":"system","subtype":"init","session_id":"s","tools":["Bash"]}'; "#,
                        r#"echo '{"type":"assistant","message":{"content":[{"type":"text","text":"All good."}]},"session_id":"s"}'; "#,
                        r#"echo '{"type":"result","subtype":"success","is_error":false,"result":"All good.","num_turns":1}'"#
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
            Some("Claude Stream Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(&session.id, "say something", ChatTurnOptions::default())
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

    assert_eq!(
        deltas,
        vec!["All good.".to_string()],
        "the assistant text block must stream exactly once"
    );

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    let assistant_msg = loaded
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .expect("Must have an assistant message");
    assert_eq!(assistant_msg.content, "All good.");

    let _ = std::fs::remove_dir_all(&test_dir);
}

/// Antigravity's real wire format, end to end. Captured from `agy 1.2.4` answering "bro are you
/// alive?": it is `{"event":…}`, not `{"type":…}`, so nothing recognised its prose (the turn read
/// "Task completed successfully.") and nothing recognised its tool steps (the thread showed no
/// activity at all). The turn must now carry the answer *and* leave renderable tool events on the
/// stream, published live rather than only discoverable after the turn ended.
#[tokio::test]
async fn test_chat_turn_reads_antigravity_stream() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-agy-stream-test-{}",
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
                        r#"echo '{"event":"init","conversation_id":"c1","init":{"cwd":"/tmp","tools":["view_file"]}}'; "#,
                        r#"echo '{"event":"step_update","step_update":{"step_index":0,"state":"DONE","step_type":"user_input"}}'; "#,
                        r#"echo '{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/tmp/p.md"}}}}'; "#,
                        r#"echo '{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","output":"1 lines, 18 bytes"}}}'; "#,
                        r#"echo '{"event":"step_update","step_update":{"step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"Yes, I am alive."}}'; "#,
                        r#"echo '{"event":"result","result":{"status":"SUCCESS","response":"Yes, I am alive.","duration_seconds":3.88,"num_turns":1}}'"#
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
            Some("Antigravity Stream Test".to_string()),
            Some("antigravity".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(
        &session.id,
        "bro are you alive?",
        ChatTurnOptions::default(),
    )
    .await
    .expect("Failed to start session turn");

    let mut deltas = Vec::new();
    let mut streamed_kinds = Vec::new();
    while let Ok(evt) = rx.recv().await {
        match evt {
            ChatEvent::StreamDelta { delta, .. } => deltas.push(delta),
            ChatEvent::StreamEvent { line, .. } => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    if let Some(kind) = v.get("kind").and_then(|k| k.as_str()) {
                        streamed_kinds.push(kind.to_string());
                    }
                }
            }
            ChatEvent::GeneratingState {
                is_generating: false,
                ..
            } => break,
            _ => {}
        }
    }

    // The answer, exactly once — the terminal result repeats it and must not be appended again.
    assert_eq!(deltas, vec!["Yes, I am alive.".to_string()]);

    // Tool calls reach the client *during* the turn, which is what makes the activity live.
    assert_eq!(
        streamed_kinds,
        vec![
            "session_init".to_string(),
            "tool_call".to_string(),
            "tool_result".to_string(),
            "text".to_string(),
            "result".to_string(),
        ]
    );

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    let assistant_msg = loaded
        .messages
        .iter()
        .find(|m| m.role == "assistant")
        .expect("Must have an assistant message");
    assert_eq!(assistant_msg.content, "Yes, I am alive.");

    // The persisted stream is eventwire, which is the only shape `parseEventWireStream` renders, and
    // the tool call is closed so its card is not left spinning.
    let raw_stream = assistant_msg
        .raw_stream
        .as_deref()
        .expect("Assistant message must carry a raw stream");
    let mut call_id = None;
    let mut closed_id = None;
    for line in raw_stream.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            panic!("every persisted line must be JSON, got: {}", line);
        };
        match v.get("kind").and_then(|k| k.as_str()) {
            Some("tool_call") => {
                call_id = v
                    .get("tool_use_id")
                    .and_then(|i| i.as_str())
                    .map(str::to_string);
                assert_eq!(
                    v.get("tool_name").and_then(|n| n.as_str()),
                    Some("view_file")
                );
            }
            Some("tool_result") => {
                closed_id = v
                    .get("tool_use_id")
                    .and_then(|i| i.as_str())
                    .map(str::to_string);
            }
            Some(_) => {}
            None => panic!("every persisted line must be eventwire, got: {}", line),
        }
    }
    assert!(
        call_id.is_some(),
        "the turn's tool call must be on the stream"
    );
    assert_eq!(
        closed_id, call_id,
        "the tool call must be closed by a result with the same id"
    );

    let _ = std::fs::remove_dir_all(&test_dir);
}

/// A chat turn must not hand the agent a session id: Claude Code refuses one it has already opened,
/// which killed every turn after the first. The conversation is carried in the prompt instead.
#[tokio::test]
async fn test_chat_turn_replays_history_and_sets_no_session_id() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-history-prompt-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let captured: Arc<Mutex<Vec<AgentLaunchConfig>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_clone = captured.clone();

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            move |_agent, config| {
                if !is_naming_call(config) {
                    captured_clone.lock().unwrap().push(config.clone());
                }
                AgentProcessSpec {
                    command: "sh".to_string(),
                    args: vec![
                        "-c".to_string(),
                        r#"echo '{"kind":"text","text":"answered"}'"#.to_string(),
                    ],
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

    let session = mgr
        .create_session(
            Some("History Prompt Test".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    for prompt in ["first question", "second question"] {
        mgr.start_session_turn(&session.id, prompt, ChatTurnOptions::default())
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
    }

    let calls = captured.lock().unwrap();
    assert_eq!(calls.len(), 2, "two turns should mean two agent launches");

    for call in calls.iter() {
        assert!(
            call.session_id.is_none(),
            "no chat turn may reuse an agent session id"
        );
        assert_eq!(
            call.environment_variables
                .get("TENDRIL_CHAT_SESSION_ID")
                .map(String::as_str),
            Some(session.id.as_str()),
            "the chat session id reaches the agent as an environment variable"
        );
        assert!(
            call.prompt.contains(&session.id),
            "the prompt must name the chat session so `tendril job start --chat-session` works"
        );
    }

    assert!(
        !calls[0].prompt.contains("Previous Conversation"),
        "the first turn has no history to replay, got: {}",
        calls[0].prompt
    );
    assert!(
        calls[1].prompt.contains("first question"),
        "the second turn must replay the first question, got: {}",
        calls[1].prompt
    );
    assert!(
        calls[1].prompt.contains("answered"),
        "the second turn must replay the first answer, got: {}",
        calls[1].prompt
    );
    assert!(
        calls[1].prompt.contains("second question"),
        "the second turn must carry the current request, got: {}",
        calls[1].prompt
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
                if is_naming_call(config) {
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
                if is_naming_call(config) {
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
                if is_naming_call(config) {
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
                if is_naming_call(config) {
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
                if is_naming_call(config) {
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

/// An event Tendril injects is not a user turn. V1's `SendMessageAsync(..., role: "system")` decides
/// three things at once, and all three are checked here: the role it is stored under, the prompt
/// section the agent is given, and whether the session may be named from it.
#[tokio::test]
async fn test_injected_event_is_framed_as_an_event_and_never_names_the_session() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-event-inject-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let captured: Arc<Mutex<Vec<AgentLaunchConfig>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_clone = captured.clone();

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            move |_agent, config| {
                if !is_naming_call(config) {
                    captured_clone.lock().unwrap().push(config.clone());
                }
                AgentProcessSpec {
                    command: "sh".to_string(),
                    args: vec![
                        "-c".to_string(),
                        r#"echo '{"kind":"text","text":"The plan is ready to review."}'"#
                            .to_string(),
                    ],
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

    // A session still on its placeholder title, so the naming guard is actually under test.
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

    let event =
        "[System Event] Job 00042 (ExecutePlan) completed for plan 'Port the chat' (#00007).";
    let ran = mgr
        .notify_event(&session.id, event)
        .await
        .expect("Failed to inject the event");
    assert!(ran, "an idle session runs a turn for the event");

    while let Ok(evt) = rx.recv().await {
        if let ChatEvent::GeneratingState {
            is_generating: false,
            ..
        } = evt
        {
            break;
        }
    }
    // Past the naming task's window, so a rename would have landed if one were going to.
    tokio::time::sleep(Duration::from_millis(200)).await;

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");

    // Stored as `system`, so the thread renders it as a timeline note rather than as a user bubble.
    assert_eq!(loaded.messages[0].role, "system");
    assert_eq!(loaded.messages[0].content, event);
    assert_eq!(loaded.messages[1].role, "assistant");
    assert_eq!(loaded.messages[1].content, "The plan is ready to review.");

    // An injected event must never become the session's name — V1 names a session from its first
    // *user* message only, and a chat called "[System Event] Job 00042 …" is the failure mode.
    assert_eq!(loaded.title, "New Chat");

    // And the agent was told it was reacting to an event, not answering a request.
    let calls = captured.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(
        calls[0].prompt.contains("# Current Event Notification"),
        "got: {}",
        calls[0].prompt
    );
    assert!(!calls[0].prompt.contains("# Current User Request"));
    assert!(calls[0]
        .prompt
        .contains("Evaluate this completed job event."));
    assert!(calls[0].prompt.contains(event));

    let _ = std::fs::remove_dir_all(&test_dir);
}

/// An event arriving while a turn is running does not interrupt it — the running turn's answer is what
/// the user is waiting for — but it is still *reacted to*, on the next turn, as an event.
///
/// It queues rather than merely being written into the transcript. Storing it and stopping there left
/// the agent no reason to run again, so a job that finished while the user was still typing got a line
/// in the thread and no reaction to it until the user happened to say something else. V1 runs a turn.
#[tokio::test]
async fn test_injected_event_during_a_turn_is_answered_after_it_rather_than_interrupting_it() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-chat-event-busy-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");

    let captured: Arc<Mutex<Vec<AgentLaunchConfig>>> = Arc::new(Mutex::new(Vec::new()));
    let captured_clone = captured.clone();

    let mgr = Arc::new(
        ChatExecutionManager::new(test_dir.clone()).with_spec_builder(Arc::new(
            move |_agent, config| {
                if !is_naming_call(config) {
                    captured_clone.lock().unwrap().push(config.clone());
                }
                AgentProcessSpec {
                    command: "sh".to_string(),
                    args: vec![
                        "-c".to_string(),
                        r#"sleep 0.4; echo '{"kind":"text","text":"done"}'"#.to_string(),
                    ],
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
    let session = mgr
        .create_session(
            Some("Busy".to_string()),
            Some("mock".to_string()),
            Some("default".to_string()),
            None,
            None,
        )
        .await
        .expect("Failed to create session");

    mgr.start_session_turn(&session.id, "do the thing", ChatTurnOptions::default())
        .await
        .expect("Failed to start session turn");

    let event = "[System Event] Job 1 completed.";
    let ran = mgr
        .notify_event(&session.id, event)
        .await
        .expect("Failed to inject the event");
    assert!(
        !ran,
        "a busy session must not have a second turn started under it"
    );

    // One settle, not two: the turn loop dequeues inside itself and reports `is_generating: false` once
    // the queue is empty, so this single wait already covers the user's turn *and* the event's.
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

    let loaded = load_session(&test_dir, &session.id).expect("Failed to load session from disk");
    let roles: Vec<&str> = loaded.messages.iter().map(|m| m.role.as_str()).collect();
    assert!(
        roles.contains(&"system"),
        "the event must still be recorded, got roles: {:?}",
        roles
    );
    // The user's turn answered, then the event's — and the event is stored as `system`, so it renders
    // as a timeline note rather than as something the user said.
    assert_eq!(
        roles.iter().filter(|r| **r == "assistant").count(),
        2,
        "got roles: {:?}",
        roles
    );
    assert_eq!(
        loaded
            .messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.as_str()),
        Some(event)
    );

    // And the second turn was framed as an event, not as a request the user made.
    let calls = captured.lock().unwrap();
    assert_eq!(calls.len(), 2, "expected the user's turn and the event's");
    assert!(
        calls[1].prompt.contains("# Current Event Notification"),
        "got: {}",
        calls[1].prompt
    );
    assert!(!calls[1].prompt.contains("# Current User Request"));
    assert!(calls[1].prompt.contains(event));

    let _ = std::fs::remove_dir_all(&test_dir);
}
