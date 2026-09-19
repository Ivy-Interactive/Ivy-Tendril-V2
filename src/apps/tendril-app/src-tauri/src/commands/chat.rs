use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{
    ChatQueuedItemDto, ChatSessionDto, CreateSessionDto, EnqueueItemDto, ExecuteTurnDto,
    PostMessageDto,
};
use crate::service::agent_terminal_bridge::{self, StartedAgentTerminal};
use std::collections::HashMap;

#[tauri::command]
pub async fn cmd_list_chat_sessions() -> Result<Vec<ChatSessionDto>, BridgeError> {
    get_client_from_master()?.list_chat_sessions().await
}

#[tauri::command]
pub async fn cmd_create_chat_session(
    req: Option<CreateSessionDto>,
) -> Result<ChatSessionDto, BridgeError> {
    get_client_from_master()?
        .create_chat_session(req.unwrap_or_default())
        .await
}

#[tauri::command]
pub async fn cmd_get_chat_session(id: String) -> Result<ChatSessionDto, BridgeError> {
    get_client_from_master()?.get_chat_session(&id).await
}

#[tauri::command]
pub async fn cmd_update_chat_session(
    id: String,
    title: String,
) -> Result<ChatSessionDto, BridgeError> {
    get_client_from_master()?
        .update_chat_session(&id, &title)
        .await
}

#[tauri::command]
pub async fn cmd_delete_chat_session(id: String) -> Result<(), BridgeError> {
    get_client_from_master()?.delete_chat_session(&id).await
}

#[tauri::command]
pub async fn cmd_post_chat_message(
    id: String,
    req: PostMessageDto,
) -> Result<serde_json::Value, BridgeError> {
    get_client_from_master()?.post_chat_message(&id, req).await
}

#[tauri::command]
pub async fn cmd_execute_chat_turn(
    id: String,
    req: Option<ExecuteTurnDto>,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .execute_chat_turn(&id, req.unwrap_or_default())
        .await
}

#[tauri::command]
pub async fn cmd_cancel_chat_turn(id: String) -> Result<bool, BridgeError> {
    get_client_from_master()?.cancel_chat_turn(&id).await
}

#[tauri::command]
pub async fn cmd_answer_chat_questions(
    session_id: String,
    message_id: String,
    answers: HashMap<String, Vec<String>>,
) -> Result<ChatSessionDto, BridgeError> {
    get_client_from_master()?
        .answer_chat_questions(&session_id, &message_id, answers)
        .await
}

#[tauri::command]
pub async fn cmd_get_chat_queue(id: String) -> Result<Vec<ChatQueuedItemDto>, BridgeError> {
    get_client_from_master()?.get_chat_queue(&id).await
}

#[tauri::command]
pub async fn cmd_enqueue_chat_message(
    id: String,
    req: EnqueueItemDto,
) -> Result<ChatQueuedItemDto, BridgeError> {
    get_client_from_master()?
        .enqueue_chat_message(&id, req)
        .await
}

#[tauri::command]
pub async fn cmd_clear_chat_queue(id: String) -> Result<(), BridgeError> {
    get_client_from_master()?.clear_chat_queue(&id).await
}

#[tauri::command]
pub async fn cmd_delete_queued_chat_item(
    session_id: String,
    item_id: String,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .delete_queued_chat_item(&session_id, &item_id)
        .await
}

#[tauri::command]
pub async fn cmd_update_queued_chat_item(
    session_id: String,
    item_id: String,
    prompt: String,
) -> Result<ChatQueuedItemDto, BridgeError> {
    get_client_from_master()?
        .update_queued_chat_item(&session_id, &item_id, &prompt)
        .await
}

/// Starts the session's coding agent interactively under a pseudo-terminal and begins re-emitting its
/// output as Tauri events.
///
/// The chat session id is the whole of the authorisation: the daemon resolves which agent to run from
/// the session and refuses an id it does not know, so this command cannot be used to spawn something
/// of the caller's choosing — the same discipline `cmd_query_table` applies to its path.
///
/// Subscribe to `agent-terminal-event` **before** invoking: the agent can write before this call's
/// return value has crossed back over the boundary.
#[tauri::command]
pub async fn cmd_execute_agent_terminal<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    session_id: String,
    prompt: Option<String>,
    agent_id: Option<String>,
    model_id: Option<String>,
) -> Result<StartedAgentTerminal, BridgeError> {
    let response = get_client_from_master()?
        .start_chat_terminal(
            &session_id,
            prompt.as_deref(),
            agent_id.as_deref(),
            model_id.as_deref(),
        )
        .await?;

    agent_terminal_bridge::start(app_handle, session_id, response).await
}

/// Forwards keystrokes to a chat session's terminal. `data` is base64 of the raw bytes.
#[tauri::command]
pub async fn cmd_send_agent_terminal_input(
    session_id: String,
    pty_session_id: String,
    data: String,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .chat_terminal_input(&session_id, &pty_session_id, &data)
        .await
}

/// Reports the terminal's size, so the agent redraws its interface to fit.
#[tauri::command]
pub async fn cmd_resize_agent_terminal(
    session_id: String,
    pty_session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), BridgeError> {
    get_client_from_master()?
        .chat_terminal_resize(&session_id, &pty_session_id, rows, cols)
        .await
}

/// Stops reading a pane's stream **and ends its agent**: an interactive session has nothing to serve
/// once its pane is gone, unlike a review action's dev server.
///
/// Returns whether anything was running, so closing twice is not an error. A failed kill is logged
/// rather than raised — the pane is already gone, and the reader has stopped either way.
#[tauri::command]
pub async fn cmd_close_agent_terminal(session_id: String) -> Result<bool, BridgeError> {
    let Some(pty_session_id) = agent_terminal_bridge::close(&session_id) else {
        return Ok(false);
    };
    if let Err(e) = get_client_from_master()?
        .chat_terminal_close(&session_id, &pty_session_id)
        .await
    {
        tracing::warn!("Failed to end the agent behind chat terminal {session_id}: {e:?}");
    }
    Ok(true)
}
