//! Interactive PTY sessions — review actions and chat terminals — and the keystroke,
//! resize and close control messages that drive them.

use super::{path_segment, TendrilClient};
use crate::error::BridgeError;
use serde_json::json;

impl TendrilClient {
    /// Starts a review action and hands back the still-open response.
    ///
    /// The body is an SSE stream that lives as long as the process does, so it is deliberately not
    /// consumed here: reading it as JSON would block until the process exited and then throw away
    /// everything it had said. [`super::review_action_bridge`] owns the stream from here.
    pub async fn execute_review_action(
        &self,
        project_name: &str,
        action_name: &str,
        plan_id: Option<&str>,
        worktree: Option<&str>,
    ) -> Result<reqwest::Response, BridgeError> {
        let url = format!(
            "{}/api/projects/{}/review-actions/{}/execute",
            self.base_url,
            path_segment(project_name),
            path_segment(action_name)
        );
        let body = json!({
            "planId": plan_id,
            "worktree": worktree,
        });

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "EXECUTE_REVIEW_ACTION_FAILED",
                format!("Failed to execute review action '{action_name}' ({status}): {text}"),
            ));
        }

        Ok(resp)
    }

    /// Sends keystrokes to a running review action. `data` is base64 of the raw bytes, because a
    /// control character is most of what a terminal sends.
    pub async fn review_action_input(
        &self,
        project_name: &str,
        action_name: &str,
        session_id: &str,
        data: &str,
    ) -> Result<(), BridgeError> {
        self.post_review_action_control(
            project_name,
            action_name,
            "input",
            json!({ "sessionId": session_id, "data": data }),
        )
        .await
    }

    /// Reports the terminal's size to a running review action.
    pub async fn review_action_resize(
        &self,
        project_name: &str,
        action_name: &str,
        session_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<(), BridgeError> {
        self.post_review_action_control(
            project_name,
            action_name,
            "resize",
            json!({ "sessionId": session_id, "rows": rows, "cols": cols }),
        )
        .await
    }

    async fn post_review_action_control(
        &self,
        project_name: &str,
        action_name: &str,
        endpoint: &str,
        body: serde_json::Value,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/projects/{}/review-actions/{}/{}",
            self.base_url,
            path_segment(project_name),
            path_segment(action_name),
            endpoint
        );

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        // A `404` means the process has already exited, which a client racing the `end` frame cannot
        // avoid; it is reported rather than retried.
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "REVIEW_ACTION_CONTROL_FAILED",
                format!("Review action {endpoint} failed ({status}): {text}"),
            ));
        }

        Ok(())
    }

    /// Starts an interactive agent for a chat session and returns its SSE stream, unread.
    ///
    /// The chat session id is the only thing that decides what runs: the daemon resolves the agent
    /// from the session and refuses an id it does not know, so this cannot start an arbitrary process
    /// even though it carries the daemon's credential.
    pub async fn start_chat_terminal(
        &self,
        session_id: &str,
        prompt: Option<&str>,
        agent_id: Option<&str>,
        model_id: Option<&str>,
    ) -> Result<reqwest::Response, BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/terminal",
            self.base_url,
            path_segment(session_id)
        );
        let body = json!({
            "prompt": prompt,
            "agentId": agent_id,
            "modelId": model_id,
        });

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "START_CHAT_TERMINAL_FAILED",
                format!("Failed to start a terminal for chat '{session_id}' ({status}): {text}"),
            ));
        }

        Ok(resp)
    }

    /// Sends keystrokes to a chat session's terminal. `data` is base64 of the raw bytes, because a
    /// control character is most of what a terminal sends.
    pub async fn chat_terminal_input(
        &self,
        chat_session_id: &str,
        pty_session_id: &str,
        data: &str,
    ) -> Result<(), BridgeError> {
        self.post_chat_terminal_control(
            chat_session_id,
            "terminal/input",
            json!({ "sessionId": pty_session_id, "data": data }),
        )
        .await
    }

    /// Reports the terminal's size, so the agent redraws its interface to fit.
    pub async fn chat_terminal_resize(
        &self,
        chat_session_id: &str,
        pty_session_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<(), BridgeError> {
        self.post_chat_terminal_control(
            chat_session_id,
            "terminal/resize",
            json!({ "sessionId": pty_session_id, "rows": rows, "cols": cols }),
        )
        .await
    }

    /// Ends the agent behind a chat terminal. Unlike a review action, whose process has to outlive its
    /// pane, an interactive agent belongs to the pane that opened it.
    pub async fn chat_terminal_close(
        &self,
        chat_session_id: &str,
        pty_session_id: &str,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/terminal",
            self.base_url,
            path_segment(chat_session_id)
        );
        let resp = self
            .client
            .delete(&url)
            .headers(self.headers())
            .json(&json!({ "sessionId": pty_session_id }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CHAT_TERMINAL_CONTROL_FAILED",
                format!("Chat terminal close failed ({status}): {text}"),
            ));
        }
        Ok(())
    }

    async fn post_chat_terminal_control(
        &self,
        chat_session_id: &str,
        endpoint: &str,
        body: serde_json::Value,
    ) -> Result<(), BridgeError> {
        let url = format!(
            "{}/api/chat/sessions/{}/{}",
            self.base_url,
            path_segment(chat_session_id),
            endpoint
        );

        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .json(&body)
            .send()
            .await?;

        // A `404` means the agent has already exited, which a client racing the `end` frame cannot
        // avoid; it is reported rather than retried.
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CHAT_TERMINAL_CONTROL_FAILED",
                format!("Chat terminal {endpoint} failed ({status}): {text}"),
            ));
        }

        Ok(())
    }
}
