//! Chat sessions, their messages and turns, and the queue of work waiting behind a running turn.

use super::{path_segment, TendrilClient};
use crate::error::BridgeError;
use crate::models::{
    ChatQueuedItemDto, ChatSessionDto, CreateSessionDto, EnqueueItemDto, ExecuteTurnDto,
    PostMessageDto,
};
use serde_json::json;

impl TendrilClient {
    pub async fn list_chat_sessions(&self) -> Result<Vec<ChatSessionDto>, BridgeError> {
        let url = format!("{}/api/chat/sessions", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "LIST_CHAT_SESSIONS_FAILED",
                format!("Failed to list chat sessions ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn create_chat_session(
        &self,
        req: CreateSessionDto,
    ) -> Result<ChatSessionDto, BridgeError> {
        let url = format!("{}/api/chat/sessions", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CREATE_CHAT_SESSION_FAILED",
                format!("Failed to create chat session ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_chat_session(&self, id: &str) -> Result<ChatSessionDto, BridgeError> {
        let url = format!("{}/api/chat/sessions/{}", self.base_url, path_segment(id));
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_CHAT_SESSION_FAILED",
                format!("Failed to get chat session '{id}' ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn update_chat_session(
        &self,
        id: &str,
        title: &str,
    ) -> Result<ChatSessionDto, BridgeError> {
        let url = format!("{}/api/chat/sessions/{}", self.base_url, path_segment(id));
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&json!({ "title": title }))
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPDATE_CHAT_SESSION_FAILED",
                format!("Failed to update chat session '{id}' ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn delete_chat_session(&self, id: &str) -> Result<(), BridgeError> {
        let url = format!("{}/api/chat/sessions/{}", self.base_url, path_segment(id));
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "DELETE_CHAT_SESSION_FAILED",
                format!("Failed to delete chat session '{id}' ({status}): {text}"),
            ));
        }
        Ok(())
    }

    pub async fn post_chat_message(
        &self,
        id: &str,
        req: PostMessageDto,
    ) -> Result<serde_json::Value, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/messages",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "POST_CHAT_MESSAGE_FAILED",
                format!("Failed to post chat message ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn execute_chat_turn(
        &self,
        id: &str,
        req: ExecuteTurnDto,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/execute",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "EXECUTE_CHAT_TURN_FAILED",
                format!("Failed to execute chat turn ({status}): {text}"),
            ));
        }
        Ok(())
    }

    pub async fn cancel_chat_turn(&self, id: &str) -> Result<bool, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/cancel",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CANCEL_CHAT_TURN_FAILED",
                format!("Failed to cancel chat turn ({status}): {text}"),
            ));
        }
        let val: serde_json::Value = resp.json().await?;
        Ok(val
            .get("cancelled")
            .and_then(|v| v.as_bool())
            .unwrap_or(true))
    }

    pub async fn answer_chat_questions(
        &self,
        session_id: &str,
        message_id: &str,
        answers: std::collections::HashMap<String, Vec<String>>,
    ) -> Result<ChatSessionDto, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/messages/{}/answers",
            self.base_url,
            path_segment(session_id),
            path_segment(message_id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&json!({ "answers": answers }))
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "ANSWER_CHAT_QUESTIONS_FAILED",
                format!("Failed to answer chat questions ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn get_chat_queue(&self, id: &str) -> Result<Vec<ChatQueuedItemDto>, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue",
            self.base_url,
            path_segment(id)
        );
        let resp = self.client.get(&url).headers(self.headers()).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_CHAT_QUEUE_FAILED",
                format!("Failed to get chat queue ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn enqueue_chat_message(
        &self,
        id: &str,
        req: EnqueueItemDto,
    ) -> Result<ChatQueuedItemDto, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "ENQUEUE_CHAT_MESSAGE_FAILED",
                format!("Failed to enqueue chat message ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }

    pub async fn clear_chat_queue(&self, id: &str) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue",
            self.base_url,
            path_segment(id)
        );
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CLEAR_CHAT_QUEUE_FAILED",
                format!("Failed to clear chat queue ({status}): {text}"),
            ));
        }
        Ok(())
    }

    pub async fn delete_queued_chat_item(
        &self,
        session_id: &str,
        item_id: &str,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue/{}",
            self.base_url,
            path_segment(session_id),
            path_segment(item_id)
        );
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "DELETE_QUEUED_CHAT_ITEM_FAILED",
                format!("Failed to delete queued chat item ({status}): {text}"),
            ));
        }
        Ok(())
    }

    pub async fn update_queued_chat_item(
        &self,
        session_id: &str,
        item_id: &str,
        prompt: &str,
    ) -> Result<ChatQueuedItemDto, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/queue/{}",
            self.base_url,
            path_segment(session_id),
            path_segment(item_id)
        );
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&serde_json::json!({ "prompt": prompt }))
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "UPDATE_QUEUED_CHAT_ITEM_FAILED",
                format!("Failed to update queued chat item ({status}): {text}"),
            ));
        }
        Ok(resp.json().await?)
    }
}
