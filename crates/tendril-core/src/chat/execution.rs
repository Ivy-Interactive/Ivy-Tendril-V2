use crate::agents::providers::{build_agent_spec, AgentLaunchConfig, AgentProcessSpec};
use crate::agents::runner::{run_agent_process, AgentOutputEvent};
use crate::chat::models::{ChatMessage, ChatQueuedItem, ChatSession};
use crate::chat::storage::{
    delete_session as storage_delete, load_all_sessions, load_session,
    rename_session as storage_rename, sanitize_title, save_session,
};
use crate::error::{Result, TendrilError};
use crate::questions::apply_question_answers;
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, watch, Mutex, RwLock};
use uuid::Uuid;

pub type SpecBuilder = Arc<dyn Fn(&str, &AgentLaunchConfig) -> AgentProcessSpec + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ChatEvent {
    #[serde(rename = "chat.message_added")]
    MessageAdded {
        #[serde(rename = "sessionId")]
        session_id: String,
        message: ChatMessage,
    },
    #[serde(rename = "chat.stream_delta")]
    StreamDelta {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        delta: String,
    },
    #[serde(rename = "chat.generating_state")]
    GeneratingState {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "isGenerating")]
        is_generating: bool,
    },
    #[serde(rename = "chat.question_answered")]
    QuestionAnswered {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        answers: HashMap<String, Vec<String>>,
    },
    #[serde(rename = "chat.job_spawned")]
    JobSpawned {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "jobId")]
        job_id: String,
    },
}

#[derive(Debug, Clone, Default)]
pub struct ChatTurnOptions {
    pub agent_id: Option<String>,
    pub model_id: Option<String>,
    pub effort: Option<String>,
    pub working_directory: Option<PathBuf>,
}

pub struct ChatExecutionManager {
    tendril_home: PathBuf,
    sessions: Arc<RwLock<HashMap<String, ChatSession>>>,
    generating_sessions: Arc<RwLock<HashSet<String>>>,
    queued_messages: Arc<RwLock<HashMap<String, Vec<ChatQueuedItem>>>>,
    active_cancellations: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    spec_builder: SpecBuilder,
    event_tx: broadcast::Sender<ChatEvent>,
    persist_interval: Duration,
}

impl ChatExecutionManager {
    pub fn new(tendril_home: PathBuf) -> Self {
        let (event_tx, _) = broadcast::channel(1000);
        Self {
            tendril_home,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            generating_sessions: Arc::new(RwLock::new(HashSet::new())),
            queued_messages: Arc::new(RwLock::new(HashMap::new())),
            active_cancellations: Arc::new(Mutex::new(HashMap::new())),
            spec_builder: Arc::new(build_agent_spec),
            event_tx,
            persist_interval: Duration::from_secs(1),
        }
    }

    pub fn with_spec_builder(mut self, builder: SpecBuilder) -> Self {
        self.spec_builder = builder;
        self
    }

    pub fn with_persist_interval(mut self, interval: Duration) -> Self {
        self.persist_interval = interval;
        self
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<ChatEvent> {
        self.event_tx.subscribe()
    }

    pub async fn list_sessions(&self) -> Result<Vec<ChatSession>> {
        let mut list = load_all_sessions(&self.tendril_home)?;
        let mut sessions_map = self.sessions.write().await;
        for s in &list {
            sessions_map.insert(s.id.clone(), s.clone());
        }
        list.sort_by_key(|a| std::cmp::Reverse(a.updated_at));
        Ok(list)
    }

    pub async fn get_session(&self, id: &str) -> Result<ChatSession> {
        {
            let map = self.sessions.read().await;
            if let Some(s) = map.get(id) {
                return Ok(s.clone());
            }
        }
        let s = load_session(&self.tendril_home, id)?;
        self.sessions
            .write()
            .await
            .insert(id.to_string(), s.clone());
        Ok(s)
    }

    pub async fn create_session(
        &self,
        title: Option<String>,
        agent_id: Option<String>,
        model_id: Option<String>,
        effort: Option<String>,
    ) -> Result<ChatSession> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let raw_title = title.unwrap_or_else(|| "New Chat".to_string());
        let session = ChatSession {
            id: id.clone(),
            title: sanitize_title(&raw_title),
            created_at: now,
            updated_at: now,
            agent_id: agent_id.unwrap_or_else(|| "claude".to_string()),
            model_id: model_id.unwrap_or_else(|| "default".to_string()),
            messages: Vec::new(),
            effort,
            spawned_job_ids: Vec::new(),
        };

        save_session(&self.tendril_home, &session)?;
        self.sessions.write().await.insert(id, session.clone());
        Ok(session)
    }

    pub async fn rename_session(&self, id: &str, new_title: &str) -> Result<ChatSession> {
        let updated = storage_rename(&self.tendril_home, id, new_title)?;
        self.sessions
            .write()
            .await
            .insert(id.to_string(), updated.clone());
        Ok(updated)
    }

    pub async fn delete_session(&self, id: &str) -> Result<()> {
        self.cancel_session(id).await;
        storage_delete(&self.tendril_home, id)?;
        self.sessions.write().await.remove(id);
        self.queued_messages.write().await.remove(id);
        Ok(())
    }

    pub async fn is_generating(&self, id: &str) -> bool {
        self.generating_sessions.read().await.contains(id)
    }

    pub async fn add_message(&self, session_id: &str, message: ChatMessage) -> Result<()> {
        let mut session = self.get_session(session_id).await?;
        session.messages.push(message.clone());
        session.updated_at = Utc::now();
        save_session(&self.tendril_home, &session)?;
        self.sessions
            .write()
            .await
            .insert(session_id.to_string(), session.clone());
        let _ = self.event_tx.send(ChatEvent::MessageAdded {
            session_id: session_id.to_string(),
            message,
        });
        Ok(())
    }

    // Queue management
    pub async fn enqueue_message(&self, session_id: &str, item: ChatQueuedItem) {
        let mut map = self.queued_messages.write().await;
        map.entry(session_id.to_string()).or_default().push(item);
    }

    pub async fn dequeue_message(&self, session_id: &str) -> Option<ChatQueuedItem> {
        let mut map = self.queued_messages.write().await;
        if let Some(queue) = map.get_mut(session_id) {
            if !queue.is_empty() {
                return Some(queue.remove(0));
            }
        }
        None
    }

    pub async fn get_queued_messages(&self, session_id: &str) -> Vec<ChatQueuedItem> {
        let map = self.queued_messages.read().await;
        map.get(session_id).cloned().unwrap_or_default()
    }

    pub async fn remove_queued_message(&self, session_id: &str, item_id: &str) -> bool {
        let mut map = self.queued_messages.write().await;
        if let Some(queue) = map.get_mut(session_id) {
            let before = queue.len();
            queue.retain(|i| i.id != item_id);
            return queue.len() < before;
        }
        false
    }

    pub async fn clear_queued_messages(&self, session_id: &str) {
        let mut map = self.queued_messages.write().await;
        map.remove(session_id);
    }

    // Cancellation
    pub async fn cancel_session(&self, session_id: &str) -> bool {
        let mut active = self.active_cancellations.lock().await;
        if let Some(tx) = active.remove(session_id) {
            let _ = tx.send(true);
            true
        } else {
            false
        }
    }

    // Apply answers
    pub async fn apply_answers(
        &self,
        session_id: &str,
        message_id: &str,
        answers: &HashMap<String, Vec<String>>,
    ) -> Result<ChatSession> {
        let mut session = self.get_session(session_id).await?;
        let mut found = false;

        for msg in &mut session.messages {
            if msg.id == message_id {
                let updated_content = apply_question_answers(&msg.content, answers)?;
                msg.content = updated_content;
                if let Some(ref raw) = msg.raw_stream {
                    if let Ok(updated_raw) = apply_question_answers(raw, answers) {
                        msg.raw_stream = Some(updated_raw);
                    }
                }
                found = true;
                break;
            }
        }

        if !found {
            return Err(TendrilError::Chat(format!(
                "Message '{}' not found in session '{}'",
                message_id, session_id
            )));
        }

        session.updated_at = Utc::now();
        save_session(&self.tendril_home, &session)?;
        self.sessions
            .write()
            .await
            .insert(session_id.to_string(), session.clone());

        let _ = self.event_tx.send(ChatEvent::QuestionAnswered {
            session_id: session_id.to_string(),
            message_id: message_id.to_string(),
            answers: answers.clone(),
        });

        Ok(session)
    }

    // Execution Turn
    pub async fn start_session_turn(
        self: &Arc<Self>,
        session_id: &str,
        user_prompt: &str,
        options: ChatTurnOptions,
    ) -> Result<()> {
        if self.is_generating(session_id).await {
            return Err(TendrilError::Chat(format!(
                "Session '{}' is already generating",
                session_id
            )));
        }

        let mut session = self.get_session(session_id).await?;
        let now = Utc::now();

        // If title is "New Chat", auto-generate from prompt
        if session.title == "New Chat" && !user_prompt.trim().is_empty() {
            let snippet: String = user_prompt.trim().chars().take(40).collect();
            session.title = sanitize_title(&snippet);
        }

        // Add user message
        let user_msg = ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: "user".to_string(),
            content: user_prompt.to_string(),
            timestamp: now,
            agent_id: None,
            model_id: None,
            raw_stream: None,
            effort: None,
        };
        session.messages.push(user_msg.clone());

        // Add stub assistant message
        let assistant_msg_id = Uuid::new_v4().to_string();
        let agent_to_use = options
            .agent_id
            .clone()
            .unwrap_or_else(|| session.agent_id.clone());
        let model_to_use = options
            .model_id
            .clone()
            .unwrap_or_else(|| session.model_id.clone());
        let effort_to_use = options.effort.clone().or_else(|| session.effort.clone());

        let assistant_msg = ChatMessage {
            id: assistant_msg_id.clone(),
            role: "assistant".to_string(),
            content: String::new(),
            timestamp: Utc::now(),
            agent_id: Some(agent_to_use.clone()),
            model_id: Some(model_to_use.clone()),
            raw_stream: Some(String::new()),
            effort: effort_to_use.clone(),
        };
        session.messages.push(assistant_msg.clone());
        session.updated_at = Utc::now();

        // Save session state to disk and cache
        save_session(&self.tendril_home, &session)?;
        self.sessions
            .write()
            .await
            .insert(session_id.to_string(), session.clone());

        // Mark as generating
        self.generating_sessions
            .write()
            .await
            .insert(session_id.to_string());

        // Emit events
        let _ = self.event_tx.send(ChatEvent::GeneratingState {
            session_id: session_id.to_string(),
            is_generating: true,
        });
        let _ = self.event_tx.send(ChatEvent::MessageAdded {
            session_id: session_id.to_string(),
            message: user_msg,
        });
        let _ = self.event_tx.send(ChatEvent::MessageAdded {
            session_id: session_id.to_string(),
            message: assistant_msg,
        });

        // Set up cancellation channel
        let (cancel_tx, cancel_rx) = watch::channel(false);
        self.active_cancellations
            .lock()
            .await
            .insert(session_id.to_string(), cancel_tx);

        let agent_to_use_clone = agent_to_use.clone();
        let mgr = Arc::clone(self);
        let s_id = session_id.to_string();
        let persist_interval = self.persist_interval;
        let initial_prompt = user_prompt.to_string();
        let initial_assistant_msg_id = assistant_msg_id.clone();

        // Spawn async runner task
        tokio::spawn(async move {
            let mut current_prompt = initial_prompt;
            let mut current_assistant_msg_id = initial_assistant_msg_id;
            let current_options = options;
            let mut is_first_turn = true;
            let job_regex = Regex::new(
                r"(?i)(?:job started:\s*(?:id\s*)?|tendril job start\s+\w+\s+)([0-9a-zA-Z_-]+)",
            )
            .ok();

            loop {
                let this_cancel_rx = if is_first_turn {
                    is_first_turn = false;
                    cancel_rx.clone()
                } else {
                    let (new_cancel_tx, new_cancel_rx) = watch::channel(false);
                    mgr.active_cancellations
                        .lock()
                        .await
                        .insert(s_id.clone(), new_cancel_tx);
                    new_cancel_rx
                };

                let launch_config = AgentLaunchConfig {
                    prompt: current_prompt.clone(),
                    working_directory: current_options
                        .working_directory
                        .clone()
                        .unwrap_or_else(|| mgr.tendril_home.clone()),
                    model: current_options.model_id.clone(),
                    effort: current_options.effort.clone(),
                    session_id: Some(s_id.clone()),
                    ..Default::default()
                };

                let spec = (mgr.spec_builder)(&agent_to_use_clone, &launch_config);
                let (line_tx, mut line_rx) =
                    tokio::sync::mpsc::unbounded_channel::<AgentOutputEvent>();

                let run_handle = tokio::spawn(async move {
                    run_agent_process(
                        spec,
                        move |evt| {
                            let _ = line_tx.send(evt);
                        },
                        |_pid| {},
                        this_cancel_rx,
                        None,
                    )
                    .await
                });

                let mut accumulated_text = String::new();
                let mut raw_stream_lines = Vec::new();
                let mut is_dirty = false;
                let mut persist_ticker = tokio::time::interval(persist_interval);
                persist_ticker.tick().await; // consume initial tick

                loop {
                    tokio::select! {
                        opt_evt = line_rx.recv() => {
                            match opt_evt {
                                Some(evt) => {
                                    raw_stream_lines.push(evt.raw_line.clone());

                                    // Check for spawned job IDs
                                    if let Some(ref re) = job_regex {
                                        if let Some(caps) = re.captures(&evt.raw_line) {
                                            if let Some(m) = caps.get(1) {
                                                let job_id = m.as_str().to_string();
                                                let mut sessions_map = mgr.sessions.write().await;
                                                if let Some(s) = sessions_map.get_mut(&s_id) {
                                                    if !s.spawned_job_ids.contains(&job_id) {
                                                        s.spawned_job_ids.push(job_id.clone());
                                                        let _ = mgr.event_tx.send(ChatEvent::JobSpawned {
                                                            session_id: s_id.clone(),
                                                            job_id,
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    // Extract delta text
                                    let delta = extract_delta(&evt.raw_line, evt.is_stderr);
                                    if !delta.is_empty() {
                                        accumulated_text.push_str(&delta);
                                        is_dirty = true;

                                        let _ = mgr.event_tx.send(ChatEvent::StreamDelta {
                                            session_id: s_id.clone(),
                                            message_id: current_assistant_msg_id.clone(),
                                            delta,
                                        });
                                    }
                                }
                                None => {
                                    break;
                                }
                            }
                        }
                        _ = persist_ticker.tick() => {
                            if is_dirty {
                                mgr.persist_in_flight_message(
                                    &s_id,
                                    &current_assistant_msg_id,
                                    &accumulated_text,
                                    &raw_stream_lines,
                                )
                                .await;
                                is_dirty = false;
                            }
                        }
                    }
                }

                let _ = run_handle.await;

                // Final message update & persistence
                mgr.finalize_message(
                    &s_id,
                    &current_assistant_msg_id,
                    accumulated_text,
                    raw_stream_lines,
                )
                .await;

                // Clean up active cancellation
                mgr.active_cancellations.lock().await.remove(&s_id);

                // Check if there are queued messages to dequeue
                if let Some(next_item) = mgr.dequeue_message(&s_id).await {
                    current_prompt = next_item.prompt;
                    let next_a_id = Uuid::new_v4().to_string();
                    current_assistant_msg_id = next_a_id.clone();
                    let now = Utc::now();
                    let next_user_msg = ChatMessage {
                        id: Uuid::new_v4().to_string(),
                        role: "user".to_string(),
                        content: current_prompt.clone(),
                        timestamp: now,
                        agent_id: None,
                        model_id: None,
                        raw_stream: None,
                        effort: None,
                    };
                    let next_assistant_msg = ChatMessage {
                        id: next_a_id.clone(),
                        role: "assistant".to_string(),
                        content: String::new(),
                        timestamp: Utc::now(),
                        agent_id: Some(agent_to_use_clone.clone()),
                        model_id: current_options.model_id.clone(),
                        raw_stream: Some(String::new()),
                        effort: current_options.effort.clone(),
                    };

                    {
                        let mut sessions_map = mgr.sessions.write().await;
                        if let Some(s) = sessions_map.get_mut(&s_id) {
                            s.messages.push(next_user_msg.clone());
                            s.messages.push(next_assistant_msg.clone());
                            s.updated_at = Utc::now();
                            let _ = save_session(&mgr.tendril_home, s);
                        }
                    }

                    let _ = mgr.event_tx.send(ChatEvent::MessageAdded {
                        session_id: s_id.clone(),
                        message: next_user_msg,
                    });
                    let _ = mgr.event_tx.send(ChatEvent::MessageAdded {
                        session_id: s_id.clone(),
                        message: next_assistant_msg,
                    });
                } else {
                    break;
                }
            }

            // Clean up generating state
            mgr.generating_sessions.write().await.remove(&s_id);
            let _ = mgr.event_tx.send(ChatEvent::GeneratingState {
                session_id: s_id.clone(),
                is_generating: false,
            });
        });

        Ok(())
    }

    async fn persist_in_flight_message(
        &self,
        session_id: &str,
        message_id: &str,
        content: &str,
        raw_lines: &[String],
    ) {
        let mut sessions_map = self.sessions.write().await;
        if let Some(s) = sessions_map.get_mut(session_id) {
            for m in &mut s.messages {
                if m.id == message_id {
                    m.content = content.to_string();
                    m.raw_stream = Some(raw_lines.join("\n"));
                    break;
                }
            }
            s.updated_at = Utc::now();
            let _ = save_session(&self.tendril_home, s);
        }
    }

    async fn finalize_message(
        &self,
        session_id: &str,
        message_id: &str,
        content: String,
        raw_lines: Vec<String>,
    ) {
        let mut sessions_map = self.sessions.write().await;
        if let Some(s) = sessions_map.get_mut(session_id) {
            for m in &mut s.messages {
                if m.id == message_id {
                    m.content = content.clone();
                    m.raw_stream = Some(raw_lines.join("\n"));
                    break;
                }
            }
            s.updated_at = Utc::now();
            let _ = save_session(&self.tendril_home, s);
        }
    }
}

fn extract_delta(line: &str, is_stderr: bool) -> String {
    if is_stderr {
        return String::new();
    }

    let trimmed = line.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            // Claude stream-json format
            if let Some(delta_obj) = val.get("delta") {
                if let Some(t) = delta_obj.get("text").and_then(|v| v.as_str()) {
                    return t.to_string();
                }
                if let Some(s) = delta_obj.as_str() {
                    return s.to_string();
                }
            }
            if let Some(t) = val.get("text").and_then(|v| v.as_str()) {
                return t.to_string();
            }
            if let Some(c) = val.get("content").and_then(|v| v.as_str()) {
                return c.to_string();
            }
            if let Some(m) = val.get("message").and_then(|v| v.as_str()) {
                return m.to_string();
            }
            return String::new();
        }
    }

    format!("{}\n", line)
}
