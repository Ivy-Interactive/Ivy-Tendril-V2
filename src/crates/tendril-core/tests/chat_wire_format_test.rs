//! The chat wire format is camelCase, and old snake_case files still load.
//!
//! These models used to serialize snake_case while every consumer expected camelCase: the Tauri host's
//! `ChatSessionDto` declares `rename_all = "camelCase"` with a required `createdAt`, so every chat
//! command failed to deserialize and the UI showed an error and no sessions. The bug survived because
//! the only fixture covering it (`src-tauri/tests/chat_bridge_test.rs`) stubs the daemon with
//! `createdAt`, agreeing with the DTO rather than with the real producer. These tests assert against
//! the producer itself so the two cannot drift apart again.
use chrono::{TimeZone, Utc};
use tendril_core::chat::models::{ChatAttachment, ChatMessage, ChatQueuedItem, ChatSession};

fn session() -> ChatSession {
    ChatSession {
        id: "s1".to_string(),
        title: "Session".to_string(),
        created_at: Utc.with_ymd_and_hms(2026, 9, 15, 12, 0, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2026, 9, 15, 13, 0, 0).unwrap(),
        agent_id: "claude".to_string(),
        model_id: "opus".to_string(),
        messages: vec![ChatMessage {
            id: "m1".to_string(),
            role: "assistant".to_string(),
            content: "hi".to_string(),
            timestamp: Utc.with_ymd_and_hms(2026, 9, 15, 12, 30, 0).unwrap(),
            agent_id: Some("claude".to_string()),
            model_id: Some("opus".to_string()),
            raw_stream: Some("raw".to_string()),
            effort: None,
        }],
        effort: None,
        spawned_job_ids: vec!["j1".to_string()],
        plan_folder_name: Some("00021-Thing".to_string()),
    }
}

#[test]
fn session_serializes_camel_case() {
    let json = serde_json::to_value(session()).unwrap();

    // The exact keys `ChatSessionDto` and `types/chat.ts` require.
    for key in [
        "createdAt",
        "updatedAt",
        "agentId",
        "modelId",
        "spawnedJobIds",
        "planFolderName",
    ] {
        assert!(json.get(key).is_some(), "missing `{key}` in {json}");
    }

    for key in [
        "created_at",
        "updated_at",
        "agent_id",
        "model_id",
        "spawned_job_ids",
    ] {
        assert!(json.get(key).is_none(), "unexpected snake_case `{key}`");
    }
}

#[test]
fn message_serializes_camel_case() {
    let json = serde_json::to_value(&session().messages[0]).unwrap();

    // `chat.message_added` embeds this struct verbatim, so the WS path depends on it too.
    assert!(json.get("agentId").is_some(), "missing `agentId` in {json}");
    assert!(json.get("modelId").is_some());
    assert!(json.get("rawStream").is_some());
    assert!(json.get("agent_id").is_none());
}

#[test]
fn snake_case_history_still_loads() {
    // A `Chats/*.json` file written before the rename. `storage::load_all_sessions` skips anything it
    // cannot parse, so without the aliases this history would silently disappear rather than error.
    let legacy = serde_json::json!({
        "id": "s1",
        "title": "Old session",
        "created_at": "2026-09-15T12:00:00Z",
        "updated_at": "2026-09-15T13:00:00Z",
        "agent_id": "claude",
        "model_id": "opus",
        "spawned_job_ids": ["j1"],
        "plan_folder_name": "00021-Thing",
        "messages": [{
            "id": "m1",
            "role": "assistant",
            "content": "hi",
            "timestamp": "2026-09-15T12:30:00Z",
            "agent_id": "claude",
            "model_id": "opus",
            "raw_stream": "raw"
        }]
    });

    let loaded: ChatSession = serde_json::from_value(legacy).unwrap();

    assert_eq!(loaded.agent_id, "claude");
    assert_eq!(loaded.spawned_job_ids, vec!["j1".to_string()]);
    assert_eq!(loaded.plan_folder_name.as_deref(), Some("00021-Thing"));
    assert_eq!(loaded.messages[0].raw_stream.as_deref(), Some("raw"));
}

#[test]
fn camel_case_round_trips() {
    let original = session();
    let json = serde_json::to_string(&original).unwrap();

    assert_eq!(
        serde_json::from_str::<ChatSession>(&json).unwrap(),
        original
    );
}

#[test]
fn queued_item_and_attachment_serialize_camel_case() {
    let item = ChatQueuedItem {
        id: "q1".to_string(),
        prompt: "do the thing".to_string(),
        attachments: Some(vec![ChatAttachment {
            name: "shot.png".to_string(),
            path: "/tmp/shot.png".to_string(),
            mime_type: Some("image/png".to_string()),
        }]),
        created_at: Utc.with_ymd_and_hms(2026, 9, 15, 12, 0, 0).unwrap(),
        // The composer's items carry no role; only an event Tendril queued behind a running turn does.
        role: None,
    };

    let json = serde_json::to_value(&item).unwrap();
    assert!(
        json.get("createdAt").is_some(),
        "missing `createdAt` in {json}"
    );
    assert!(json.get("created_at").is_none());
    assert!(json["attachments"][0].get("mimeType").is_some());

    // And the snake_case forms of both still deserialize.
    let legacy = serde_json::json!({
        "id": "q1",
        "prompt": "do the thing",
        "created_at": "2026-09-15T12:00:00Z",
        "attachments": [{ "name": "shot.png", "path": "/tmp/shot.png", "mime_type": "image/png" }]
    });
    let loaded: ChatQueuedItem = serde_json::from_value(legacy).unwrap();
    assert_eq!(
        loaded.attachments.unwrap()[0].mime_type.as_deref(),
        Some("image/png")
    );
}
