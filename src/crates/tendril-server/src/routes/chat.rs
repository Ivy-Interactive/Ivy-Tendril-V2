use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use base64::Engine;
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tendril_core::agents::providers::{build_agent_pty_spec, AgentPtyConfig};
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
    /// `user` (the default) or `system` for an event Tendril is injecting. V1's
    /// `SendMessageAsync(..., role)`, and until now it was accepted and then dropped on the floor: the
    /// turn always ran as a user request, so an injected event was framed as something the user typed.
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
    /// `user` or `system`, as on [`PostMessageRequest`].
    pub role: Option<String>,
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
        let options = ChatTurnOptions {
            role: body.role,
            ..Default::default()
        };
        match state
            .chat_manager
            .start_session_turn(&id, &body.prompt, options)
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
        role: body.role,
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

/// The body of `POST /api/chat/sessions/:id/terminal`.
#[derive(Debug, Deserialize, Default)]
pub struct StartTerminalRequest {
    /// A task typed for the agent on launch, the way `AgentAppArgs.Prompt` is.
    pub prompt: Option<String>,
    #[serde(rename = "agentId", alias = "agent_id")]
    pub agent_id: Option<String>,
    #[serde(rename = "modelId", alias = "model_id")]
    pub model_id: Option<String>,
}

/// Runs the session's coding agent **interactively** under a pseudo-terminal and streams its bytes.
///
/// This is the other half of V1's chat modes: `ChatLauncher.TargetFor` sends a new session either to
/// the chat view or to `AgentApp`, whose whole body is an xterm fed by `Context.UsePty`. The agent
/// draws its own interface here — there is no `--output-format`, nothing is parsed, and no messages
/// are written to the session (V1's terminal sessions hold at most the one prompt that named them,
/// `TendrilAppShell.EnsureTerminalSession`).
///
/// **The session id in the path is the authority for what may be spawned.** It is required to name a
/// session that exists, so this route cannot be used to start an arbitrary process: the only thing it
/// will ever launch is the agent that session is configured with, resolved through
/// [`build_agent_pty_spec`]. Nothing from the request reaches a shell — the argv is executed
/// directly.
///
/// [`build_agent_pty_spec`]: tendril_core::agents::providers::build_agent_pty_spec
pub async fn start_terminal_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    body_bytes: axum::body::Bytes,
) -> impl IntoResponse {
    let body: StartTerminalRequest = if body_bytes.is_empty() {
        StartTerminalRequest::default()
    } else {
        match serde_json::from_slice(&body_bytes) {
            Ok(body) => body,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("Invalid request body: {}", e) })),
                )
                    .into_response();
            }
        }
    };

    // A terminal is only ever opened for a session that exists. This is the check that keeps a route
    // carrying the daemon's authority from becoming a way to run anything: an unknown id is a 404,
    // never a spawn.
    let session = match state.chat_manager.get_session(&id).await {
        Ok(session) => session,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Session '{}' not found", id) })),
            )
                .into_response();
        }
    };

    let agent_id = body
        .agent_id
        .filter(|a| !a.trim().is_empty())
        .unwrap_or(session.agent_id);
    let model_id = body.model_id.or(Some(session.model_id));

    let spec = build_agent_pty_spec(
        &agent_id,
        &AgentPtyConfig {
            model: model_id,
            initial_prompt: body.prompt,
            // The same variable the chat path exports, so an agent in either mode can start a job
            // that is tracked against this conversation.
            environment_variables: HashMap::from([(
                "TENDRIL_CHAT_SESSION_ID".to_string(),
                id.clone(),
            )]),
            extra_arguments: Vec::new(),
        },
    );

    let env: Vec<(String, String)> = spec.environment.into_iter().collect();
    let stream =
        match crate::pty::spawn_pty_argv(&spec.argv, Some(state.tendril_home.as_path()), &env) {
            Ok(stream) => stream,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e })),
                )
                    .into_response();
            }
        };

    let mut frames = stream.frames;
    let body = futures_util::stream::poll_fn(move |cx| frames.poll_recv(cx));
    axum::response::sse::Sse::new(body).into_response()
}

/// Keystrokes for a running terminal session, addressed by the id from its `meta` frame.
///
/// The chat session in the path is not what identifies the target — the pty session id is, so two
/// panes on the same conversation never write into each other.
pub async fn terminal_input_handler(
    Path(_id): Path<String>,
    Json(request): Json<TerminalInputRequest>,
) -> impl IntoResponse {
    let Some(session) = crate::pty::session(&request.session_id) else {
        return terminal_session_not_found(&request.session_id);
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(request.data.as_bytes()) {
        Ok(bytes) => bytes,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Input data is not valid base64: {}", e) })),
            )
                .into_response();
        }
    };

    match session.write_input(&bytes) {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ok" }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write to the terminal: {}", e) })),
        )
            .into_response(),
    }
}

/// Tells the pty how big the client's terminal is, which is what makes the agent redraw to fit.
pub async fn terminal_resize_handler(
    Path(_id): Path<String>,
    Json(request): Json<TerminalResizeRequest>,
) -> impl IntoResponse {
    let Some(session) = crate::pty::session(&request.session_id) else {
        return terminal_session_not_found(&request.session_id);
    };

    // A zero dimension is what a client sends before its terminal has been laid out; applying it
    // would tell the agent it has no window at all.
    if request.rows == 0 || request.cols == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Terminal size must be at least 1x1" })),
        )
            .into_response();
    }

    match session.resize(request.rows, request.cols) {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ok" }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to resize the terminal: {}", e) })),
        )
            .into_response(),
    }
}

/// Ends a terminal session's agent, and everything it started.
///
/// Unlike a review action — whose dev server has to outlive the pane so the preview it serves keeps
/// working — an interactive agent belongs to its pane. V1 makes the same call the other way round:
/// the shell deletes a terminal chat session when its tab closes
/// (`ChatHistoryService.PruneEmptySessions` skips terminal sessions and says so).
pub async fn terminal_close_handler(
    Path(_id): Path<String>,
    Json(request): Json<TerminalCloseRequest>,
) -> impl IntoResponse {
    let Some(session) = crate::pty::session(&request.session_id) else {
        // Already gone, which is what closing twice looks like, and not an error.
        return (StatusCode::OK, Json(json!({ "closed": false }))).into_response();
    };
    let closed = session.kill();
    (StatusCode::OK, Json(json!({ "closed": closed }))).into_response()
}

#[derive(Debug, Deserialize)]
pub struct TerminalCloseRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
}

/// `data` is base64 for the same reason the `log` frames are: an arrow key or a Ctrl-C is a control
/// byte, and round-tripping those through JSON as text loses them.
#[derive(Debug, Deserialize)]
pub struct TerminalInputRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(default)]
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct TerminalResizeRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    pub rows: u16,
    pub cols: u16,
}

/// A pty that has exited is indistinguishable from one that never existed, and both are a `404`
/// rather than an error: a client racing the `end` frame has done nothing wrong.
fn terminal_session_not_found(session_id: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": format!("Terminal session '{}' is not running", session_id)
        })),
    )
        .into_response()
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
