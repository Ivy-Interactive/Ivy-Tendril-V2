use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tendril_core::chat::execution::ChatTurnOptions;
use tendril_core::chat::models::{ChatAttachment, ChatQueuedItem};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreateSessionRequest {
    pub title: Option<String>,
    #[serde(rename = "agentId", alias = "agent_id")]
    pub agent_id: Option<String>,
    #[serde(rename = "modelId", alias = "model_id")]
    pub model_id: Option<String>,
    pub effort: Option<String>,
    #[serde(rename = "planFolderName", alias = "plan_folder_name", default)]
    pub plan_folder_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateSessionRequest {
    pub title: String,
}

#[derive(Debug, Deserialize)]
pub struct PostMessageRequest {
    pub prompt: String,
    pub attachments: Option<Vec<ChatAttachment>>,
    #[serde(default)]
    pub enqueue: bool,
    pub role: Option<String>,
}

/// The body of `POST /api/chat/sessions/:id/execute`.
///
/// Both spellings are accepted, as `CreateSessionRequest` already does: the desktop app's
/// `ExecuteTurnDto` posts camelCase and `tendril chat send` posts snake_case. Without the aliases the
/// CLI's `--agent` / `--model` / `--effort` were silently dropped and the turn ran on the session's
/// defaults instead.
#[derive(Debug, Deserialize, Default)]
pub struct ExecuteTurnRequest {
    pub prompt: Option<String>,
    #[serde(rename = "agentId", alias = "agent_id")]
    pub agent_id: Option<String>,
    #[serde(rename = "modelId", alias = "model_id")]
    pub model_id: Option<String>,
    pub effort: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AnswerQuestionsRequest {
    pub answers: HashMap<String, Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct EnqueueItemRequest {
    pub prompt: String,
    pub attachments: Option<Vec<ChatAttachment>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateQueuedItemRequest {
    pub prompt: String,
}

// Handlers

pub async fn list_sessions_handler(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.chat_manager.list_sessions().await {
        Ok(sessions) => (StatusCode::OK, Json(json!(sessions))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

pub async fn create_session_handler(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateSessionRequest>,
) -> impl IntoResponse {
    match state
        .chat_manager
        .create_session(
            body.title,
            body.agent_id,
            body.model_id,
            body.effort,
            body.plan_folder_name,
        )
        .await
    {
        Ok(session) => (StatusCode::CREATED, Json(json!(session))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

pub async fn get_session_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.chat_manager.get_session(&id).await {
        Ok(session) => (StatusCode::OK, Json(json!(session))),
        Err(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Session '{}' not found", id) })),
        ),
    }
}

pub async fn update_session_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<UpdateSessionRequest>,
) -> impl IntoResponse {
    match state.chat_manager.rename_session(&id, &body.title).await {
        Ok(session) => (StatusCode::OK, Json(json!(session))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

pub async fn delete_session_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.chat_manager.delete_session(&id).await {
        Ok(_) => (StatusCode::OK, Json(json!({ "deleted": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

pub async fn post_message_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<PostMessageRequest>,
) -> impl IntoResponse {
    if body.enqueue {
        let item = ChatQueuedItem {
            id: Uuid::new_v4().to_string(),
            prompt: body.prompt,
            attachments: body.attachments,
            created_at: Utc::now(),
        };
        state.chat_manager.enqueue_message(&id, item.clone()).await;
        (
            StatusCode::ACCEPTED,
            Json(json!({ "queued": true, "id": item.id })),
        )
    } else {
        match state
            .chat_manager
            .start_session_turn(&id, &body.prompt, ChatTurnOptions::default())
            .await
        {
            Ok(_) => (StatusCode::OK, Json(json!({ "started": true }))),
            Err(e) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": e.to_string() })),
            ),
        }
    }
}

pub async fn execute_turn_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<ExecuteTurnRequest>,
) -> impl IntoResponse {
    let prompt = if let Some(p) = body.prompt {
        p
    } else if let Some(queued) = state.chat_manager.dequeue_message(&id).await {
        queued.prompt
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No prompt provided and queue is empty" })),
        );
    };

    let options = ChatTurnOptions {
        agent_id: body.agent_id,
        model_id: body.model_id,
        effort: body.effort,
        working_directory: None,
    };

    match state
        .chat_manager
        .start_session_turn(&id, &prompt, options)
        .await
    {
        Ok(_) => (StatusCode::OK, Json(json!({ "started": true }))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

pub async fn cancel_turn_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let cancelled = state.chat_manager.cancel_session(&id).await;
    (StatusCode::OK, Json(json!({ "cancelled": cancelled })))
}

pub async fn answer_questions_handler(
    State(state): State<Arc<AppState>>,
    Path((session_id, msg_id)): Path<(String, String)>,
    Json(body): Json<AnswerQuestionsRequest>,
) -> impl IntoResponse {
    match state
        .chat_manager
        .apply_answers(&session_id, &msg_id, &body.answers)
        .await
    {
        Ok(session) => (StatusCode::OK, Json(json!(session))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

pub async fn get_queue_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let queue = state.chat_manager.get_queued_messages(&id).await;
    (StatusCode::OK, Json(json!(queue)))
}

pub async fn enqueue_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(body): Json<EnqueueItemRequest>,
) -> impl IntoResponse {
    let item = ChatQueuedItem {
        id: Uuid::new_v4().to_string(),
        prompt: body.prompt,
        attachments: body.attachments,
        created_at: Utc::now(),
    };
    state.chat_manager.enqueue_message(&id, item.clone()).await;
    (StatusCode::CREATED, Json(json!(item)))
}

pub async fn clear_queue_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    state.chat_manager.clear_queued_messages(&id).await;
    (StatusCode::NO_CONTENT, ())
}

pub async fn update_queued_item_handler(
    State(state): State<Arc<AppState>>,
    Path((session_id, item_id)): Path<(String, String)>,
    Json(body): Json<UpdateQueuedItemRequest>,
) -> impl IntoResponse {
    match state
        .chat_manager
        .update_queued_message(&session_id, &item_id, &body.prompt)
        .await
    {
        Some(item) => (StatusCode::OK, Json(json!(item))),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "Queued item not found" })),
        ),
    }
}

pub async fn delete_queued_item_handler(
    State(state): State<Arc<AppState>>,
    Path((session_id, item_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let deleted = state
        .chat_manager
        .remove_queued_message(&session_id, &item_id)
        .await;
    (StatusCode::OK, Json(json!({ "deleted": deleted })))
}

#[cfg(test)]
mod tests {
    use super::ExecuteTurnRequest;

    /// Both clients' spellings have to reach the turn: the app posts camelCase, `tendril chat send`
    /// posts snake_case, and a body whose keys do not match is dropped field by field rather than
    /// rejected — so the selected agent and model were silently ignored.
    #[test]
    fn test_execute_turn_request_accepts_both_spellings() {
        let camel: ExecuteTurnRequest = serde_json::from_str(
            r#"{"prompt":"hi","agentId":"codex","modelId":"gpt-5.6-sol","effort":"high"}"#,
        )
        .expect("camelCase body");
        assert_eq!(camel.agent_id.as_deref(), Some("codex"));
        assert_eq!(camel.model_id.as_deref(), Some("gpt-5.6-sol"));

        let snake: ExecuteTurnRequest = serde_json::from_str(
            r#"{"prompt":"hi","agent_id":"codex","model_id":"gpt-5.6-sol","effort":"high"}"#,
        )
        .expect("snake_case body");
        assert_eq!(snake.agent_id.as_deref(), Some("codex"));
        assert_eq!(snake.model_id.as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(snake.effort.as_deref(), Some("high"));

        // An omitted body is still a valid turn on the session's own defaults.
        let bare: ExecuteTurnRequest = serde_json::from_str("{}").expect("empty body");
        assert!(bare.prompt.is_none() && bare.agent_id.is_none() && bare.model_id.is_none());
    }
}
