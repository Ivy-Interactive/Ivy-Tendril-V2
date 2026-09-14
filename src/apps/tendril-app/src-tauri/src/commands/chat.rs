use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{
    ChatQueuedItemDto, ChatSessionDto, CreateSessionDto, EnqueueItemDto, ExecuteTurnDto,
    PostMessageDto,
};
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
