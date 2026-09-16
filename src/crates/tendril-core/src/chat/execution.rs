use crate::agents::providers::{build_agent_spec, AgentLaunchConfig, AgentProcessSpec};
use crate::agents::reconcile::build_missing_result_lines;
use crate::agents::runner::{
    run_agent_process, AgentOutputEvent, AgentRunOutcome, TerminationReason,
};
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
    #[serde(rename = "chat.session_renamed")]
    SessionRenamed {
        #[serde(rename = "sessionId")]
        session_id: String,
        title: String,
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
        plan_folder_name: Option<String>,
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
            plan_folder_name,
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
        let _ = self.event_tx.send(ChatEvent::SessionRenamed {
            session_id: id.to_string(),
            title: updated.title.clone(),
        });
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

    pub async fn broadcast_plan_system_message(
        &self,
        folder_name: &str,
        plan_chat_session_id: Option<&str>,
        source_chat_session_id: Option<&str>,
        content: &str,
    ) -> Result<Vec<String>> {
        let sessions = self.list_sessions().await?;
        let mut recipient_ids = Vec::new();
        for session in sessions {
            let matches_folder = session.plan_folder_name.as_deref() == Some(folder_name);
            let matches_plan_chat = plan_chat_session_id == Some(&session.id);
            if matches_folder || matches_plan_chat {
                recipient_ids.push(session.id);
            }
        }
        recipient_ids.sort();
        recipient_ids.dedup();
        if let Some(src) = source_chat_session_id {
            recipient_ids.retain(|id| id != src);
        }

        for id in &recipient_ids {
            let msg = ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "system".to_string(),
                content: content.to_string(),
                timestamp: Utc::now(),
                agent_id: None,
                model_id: None,
                raw_stream: None,
                effort: None,
            };
            self.add_message(id, msg).await?;
        }

        Ok(recipient_ids)
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

    /// Rewrites a queued item's prompt in place, keeping its position in the queue. Returns the
    /// updated item, or `None` when the session has no item with that id.
    pub async fn update_queued_message(
        &self,
        session_id: &str,
        item_id: &str,
        prompt: &str,
    ) -> Option<ChatQueuedItem> {
        let mut map = self.queued_messages.write().await;
        let queue = map.get_mut(session_id)?;
        let item = queue.iter_mut().find(|i| i.id == item_id)?;
        item.prompt = prompt.to_string();
        Some(item.clone())
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

        // Snapshotted before this turn's own messages are appended: the agent prompt replays the
        // conversation *so far*, exactly as `ChatExecutionService` builds it, and the current
        // request is added separately below.
        let history_before = session.messages.clone();

        // If title is still default, write a synchronous snippet immediately (so the sidebar
        // never flashes "New Chat") and remember it so the naming task below can tell an
        // auto-generated title apart from a user rename that lands during its 30s budget.
        let mut auto_title_snippet: Option<String> = None;
        if is_default_chat_title(&session.title) && !user_prompt.trim().is_empty() {
            let snippet: String = user_prompt.trim().chars().take(40).collect();
            let snippet = sanitize_title(&snippet);
            session.title = snippet.clone();
            auto_title_snippet = Some(snippet);
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
        let working_dir_for_naming = options
            .working_directory
            .clone()
            .unwrap_or_else(|| self.tendril_home.clone());

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
            let mut current_history = history_before;
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

                // No `session_id`: it renders as `claude --session-id <uuid>`, and Claude Code
                // refuses an id it has already opened ("Error: Session ID <uuid> is already in
                // use."), so reusing the chat session's id killed every turn after the first —
                // on stderr, which is not part of the response stream, so the turn surfaced as a
                // response that never arrived. V1's chat launch leaves `SessionId` unset for the
                // same reason and carries the conversation in the prompt instead
                // (`AgentLaunchHelper.PrepareResolutionContext`). The chat session's id still
                // reaches the agent, as the environment variable V1 sets, so `tendril job start
                // --chat-session $TENDRIL_CHAT_SESSION_ID` keeps working.
                let launch_config = AgentLaunchConfig {
                    prompt: build_chat_agent_prompt(&current_history, &current_prompt, &s_id),
                    working_directory: current_options
                        .working_directory
                        .clone()
                        .unwrap_or_else(|| mgr.tendril_home.clone()),
                    model: current_options.model_id.clone(),
                    effort: current_options.effort.clone(),
                    environment_variables: HashMap::from([(
                        "TENDRIL_CHAT_SESSION_ID".to_string(),
                        s_id.clone(),
                    )]),
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
                let mut stderr_tail: Vec<String> = Vec::new();
                let mut is_dirty = false;
                let mut persist_ticker = tokio::time::interval(persist_interval);
                persist_ticker.tick().await; // consume initial tick

                loop {
                    tokio::select! {
                        opt_evt = line_rx.recv() => {
                            match opt_evt {
                                Some(evt) => {
                                    raw_stream_lines.push(evt.raw_line.clone());

                                    // Where a CLI writes its own refusals ("Session ID … is
                                    // already in use", an auth failure, an unknown flag). Kept so
                                    // a turn that produced no response can say why instead of
                                    // reporting that no reason was found.
                                    if evt.is_stderr {
                                        let text = evt.raw_line.trim();
                                        if !text.is_empty() {
                                            if stderr_tail.len() == STDERR_TAIL_LINES {
                                                stderr_tail.remove(0);
                                            }
                                            stderr_tail.push(text.to_string());
                                        }
                                    }

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

                // The join result also tells us why the stream ended, so any tool_call that never
                // got a matching tool_result can be closed out with a reason-appropriate output
                // before the message is persisted. This runs only here, after the loop: the
                // periodic `persist_in_flight_message` tick above must never reconcile, since a
                // tool that is genuinely still running would get a fake result written over it.
                let outcome = TurnOutcome::from_run(run_handle.await, stderr_tail);
                raw_stream_lines.extend(build_missing_result_lines(
                    &raw_stream_lines,
                    outcome.synthetic_tool_output(),
                    true,
                ));

                // Final message update & persistence
                mgr.finalize_message(
                    &s_id,
                    &current_assistant_msg_id,
                    accumulated_text,
                    raw_stream_lines,
                    &outcome,
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
                            // The turn that just finished is part of the history this one replays,
                            // which is the only thing carrying the conversation forward now that a
                            // chat turn no longer reuses an agent session id.
                            current_history = s.messages.clone();
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

        // Spawn the title-naming task, independent of the turn's lifecycle above: it is bounded
        // by its own 30s timeout and is not reachable from `cancel_session`.
        if let Some(snippet) = auto_title_snippet {
            let mgr = Arc::clone(self);
            let s_id = session_id.to_string();
            let prompt_for_title = user_prompt.to_string();
            tokio::spawn(async move {
                mgr.generate_title(
                    &s_id,
                    &prompt_for_title,
                    &snippet,
                    &agent_to_use,
                    model_to_use,
                    working_dir_for_naming,
                )
                .await;
            });
        }

        Ok(())
    }

    /// Runs the naming agent in Plan mode against `user_prompt` and renames the session if the
    /// result is usable and the title has not been changed since `snippet` was written (a user
    /// rename during the 30s budget always wins).
    async fn generate_title(
        self: Arc<Self>,
        session_id: &str,
        user_prompt: &str,
        snippet: &str,
        agent_id: &str,
        model_id: String,
        working_directory: PathBuf,
    ) {
        let launch_config = AgentLaunchConfig {
            prompt: build_title_prompt(user_prompt),
            working_directory,
            model: Some(model_id),
            effort: None,
            permission_mode: Some("Plan".to_string()),
            session_id: None,
            ..Default::default()
        };

        let spec = (self.spec_builder)(agent_id, &launch_config);
        let (line_tx, mut line_rx) = tokio::sync::mpsc::unbounded_channel::<AgentOutputEvent>();
        let (_cancel_tx, cancel_rx) = watch::channel(false);

        let run_handle = tokio::spawn(async move {
            run_agent_process(
                spec,
                move |evt| {
                    let _ = line_tx.send(evt);
                },
                |_pid| {},
                cancel_rx,
                Some(Duration::from_secs(30)),
            )
            .await
        });

        let mut accumulated_text = String::new();
        while let Some(evt) = line_rx.recv().await {
            accumulated_text.push_str(&extract_delta(&evt.raw_line, evt.is_stderr));
        }

        let outcome = match run_handle.await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(err)) => {
                tracing::warn!(
                    "Title generation failed for chat session {}: {}",
                    session_id,
                    err
                );
                return;
            }
            Err(err) => {
                tracing::warn!(
                    "Title generation task panicked for chat session {}: {}",
                    session_id,
                    err
                );
                return;
            }
        };

        if outcome.terminated != TerminationReason::Exited || outcome.exit_code != Some(0) {
            tracing::warn!(
                "Title generation for chat session {} did not complete successfully: {:?}",
                session_id,
                outcome.terminated
            );
            return;
        }

        let cleaned = match clean_generated_title(&accumulated_text) {
            Some(t) if !is_default_chat_title(&t) => t,
            _ => {
                tracing::debug!(
                    "Generated title for chat session {} was empty or default after cleaning",
                    session_id
                );
                return;
            }
        };

        let latest = match self.get_session(session_id).await {
            Ok(s) => s,
            Err(_) => return,
        };
        if latest.title == snippet {
            if let Err(err) = self.rename_session(session_id, &cleaned).await {
                tracing::warn!(
                    "Failed to persist generated title for chat session {}: {}",
                    session_id,
                    err
                );
            }
        }
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

    /// Persists the turn's final content and republishes the finished message.
    ///
    /// The content is composed by [`compose_turn_content`], so a turn is never an empty bubble and
    /// never claims that no failure reason was found when the process told us one.
    ///
    /// The finished message goes out as a [`ChatEvent::MessageAdded`] rather than as a synthetic
    /// `StreamDelta`. A delta is *appended* to whatever the client already has, so delivering the
    /// final text that way is only correct exactly once — and any client that had already seen the
    /// persisted content (or that received the frame twice) ended up rendering the same sentence
    /// twice. `MessageAdded` replaces the message by id, which is idempotent, and is the same
    /// "re-read the finished message" shape V1's `UpdateMessage` + `StreamUpdated` pair has.
    async fn finalize_message(
        &self,
        session_id: &str,
        message_id: &str,
        content: String,
        raw_lines: Vec<String>,
        outcome: &TurnOutcome,
    ) {
        let final_content = compose_turn_content(&content, &raw_lines, outcome);

        let mut finalized: Option<ChatMessage> = None;
        {
            let mut sessions_map = self.sessions.write().await;
            if let Some(s) = sessions_map.get_mut(session_id) {
                for m in &mut s.messages {
                    if m.id == message_id {
                        m.content = final_content.clone();
                        m.raw_stream = Some(raw_lines.join("\n"));
                        finalized = Some(m.clone());
                        break;
                    }
                }
                s.updated_at = Utc::now();
                let _ = save_session(&self.tendril_home, s);
            }
        }

        if let Some(mut message) = finalized {
            // The raw stream is a whole run's worth of JSON and every subscriber re-reads the
            // session as soon as the turn ends anyway, so it is left off the broadcast frame.
            message.raw_stream = None;
            let _ = self.event_tx.send(ChatEvent::MessageAdded {
                session_id: session_id.to_string(),
                message,
            });
        }
    }
}

/// How many trailing stderr lines a turn keeps to explain a failure with.
const STDERR_TAIL_LINES: usize = 5;

/// Why a turn's agent process stopped, in the terms the finished message needs.
///
/// V1 reads the same three things off `AgentRunResult` (`Response`, `IsSuccess`, `Error`) before it
/// decides what to persist; the stderr tail is added because a CLI that refuses to start writes its
/// reason there and nowhere else.
#[derive(Debug, Default)]
struct TurnOutcome {
    /// Set when the process could not be spawned or waited on at all — a missing agent binary is
    /// the common case, and it is invisible in the output stream because there is no stream.
    launch_error: Option<String>,
    terminated: Option<TerminationReason>,
    exit_code: Option<i32>,
    /// `false` when the agent's own terminal result event reported failure, whatever it exited with.
    result_success: Option<bool>,
    stderr_tail: Vec<String>,
}

impl TurnOutcome {
    fn from_run(
        run_result: std::result::Result<Result<AgentRunOutcome>, tokio::task::JoinError>,
        stderr_tail: Vec<String>,
    ) -> Self {
        match run_result {
            Ok(Ok(outcome)) => Self {
                launch_error: None,
                terminated: Some(outcome.terminated),
                exit_code: outcome.exit_code,
                result_success: outcome.result_outcome.map(|r| r.is_success),
                stderr_tail,
            },
            Ok(Err(err)) => Self {
                launch_error: Some(err.to_string()),
                stderr_tail,
                ..Default::default()
            },
            Err(err) => Self {
                launch_error: Some(format!("The agent task did not complete: {}", err)),
                stderr_tail,
                ..Default::default()
            },
        }
    }

    /// Whether the turn is one the user should be shown a failure reason for.
    ///
    /// A process that never started, or that we killed, always failed. Otherwise the agent's own
    /// terminal result event decides, as it does in V1 (`ClaudeEventParser.BuildResult` takes
    /// `IsSuccess` from the event and only borrows the exit code); the exit code is the answer only
    /// when the agent emitted no such event. `Some(0)` specifically, not "not an error": a `None`
    /// code means the process died from a signal, which is not a success.
    fn is_success(&self) -> bool {
        if self.launch_error.is_some() {
            return false;
        }
        if !matches!(
            self.terminated,
            Some(TerminationReason::Exited) | Some(TerminationReason::PostResultGraceExceeded)
        ) {
            return false;
        }
        match self.result_success {
            Some(success) => success,
            None => self.exit_code == Some(0),
        }
    }

    /// The output written into a `tool_result` the stream never closed.
    fn synthetic_tool_output(&self) -> &'static str {
        match self.terminated {
            Some(TerminationReason::Cancelled) => "[Cancelled]",
            Some(TerminationReason::TimedOut) => "[Timed out]",
            _ => "[No output received]",
        }
    }

    /// What to tell the user went wrong, as a headline and the detail behind it.
    ///
    /// Most specific source first: the spawn failure, then the reason we stopped it, then the agent's
    /// own structured error event, then its stderr, and only then the bare exit code (V1's
    /// `"Agent execution completed with status code …"` floor). The detail is returned separately so a
    /// caller can drop it when the agent already said the same thing out loud.
    fn failure_parts(&self, raw_lines: &[String]) -> (String, Option<String>) {
        if let Some(err) = &self.launch_error {
            return (err.clone(), None);
        }

        match self.terminated {
            Some(TerminationReason::Cancelled) => {
                return ("Execution was cancelled.".to_string(), None)
            }
            Some(TerminationReason::TimedOut) => {
                return (
                    "Agent execution timed out before it produced a response.".to_string(),
                    None,
                )
            }
            _ => {}
        }

        let status = match self.exit_code {
            Some(code) => format!("Agent execution completed with status code {}", code),
            None => "Agent execution completed with an unknown status code".to_string(),
        };

        if let Some(reason) = crate::jobs::try_extract_error_event(raw_lines) {
            return (status, Some(reason));
        }

        let tail = self
            .stderr_tail
            .iter()
            .map(|line| crate::jobs::sanitize_for_display(line))
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join(" | ");
        if !tail.is_empty() {
            return (status, Some(tail));
        }

        (status, None)
    }

    fn failure_text(&self, raw_lines: &[String]) -> String {
        match self.failure_parts(raw_lines) {
            (headline, Some(detail)) => format!("{}: {}", headline, detail),
            (headline, None) => headline,
        }
    }
}

/// What a finished turn's message says, following `ChatExecutionService`'s order: the agent's own
/// text if it produced any, then the terminal result's response, then a summary of what the turn
/// actually did, and a failure reason appended (or standing alone) whenever the run failed.
fn compose_turn_content(text: &str, raw_lines: &[String], outcome: &TurnOutcome) -> String {
    let success = outcome.is_success();
    let with_failure = |body: String| -> String {
        if success {
            return body;
        }
        let (headline, detail) = outcome.failure_parts(raw_lines);
        if body.trim().is_empty() {
            return match detail {
                Some(detail) => format!("{}: {}", headline, detail),
                None => headline,
            };
        }
        // An agent that printed its own error (a bad model, an auth failure) has already said the
        // detail; repeating it under the headline reads as the same message twice.
        let already_said = detail
            .as_deref()
            .is_some_and(|detail| body.contains(detail.trim()));
        match detail {
            Some(detail) if !already_said => format!("{}\n\n{}: {}", body, headline, detail),
            _ => format!("{}\n\n{}", body, headline),
        }
    };

    if !text.trim().is_empty() {
        return with_failure(text.to_string());
    }

    // A provider that streams nothing but a terminal result event (and Claude's `--print` result
    // event always repeats the final answer) still answered the question.
    if let Some(response) = terminal_result_response(raw_lines) {
        return with_failure(response);
    }

    if let Some(report) = summarize_tool_calls(raw_lines) {
        return with_failure(report);
    }

    if success {
        // V1's wording for a run that succeeded without saying anything.
        "Task completed successfully.".to_string()
    } else {
        outcome.failure_text(raw_lines)
    }
}

/// The response text carried by the last terminal result event in the stream, in either wire shape.
fn terminal_result_response(raw_lines: &[String]) -> Option<String> {
    for line in raw_lines.iter().rev() {
        let Some(v) = crate::jobs::failure_analysis::parse_json_object(line) else {
            continue;
        };
        let is_result = matches!(
            v.get("kind").and_then(|k| k.as_str()),
            Some("result") | Some("turn.completed")
        ) || matches!(
            v.get("type").and_then(|t| t.as_str()),
            Some("result") | Some("turn.completed")
        );
        if !is_result {
            continue;
        }
        for field in ["response", "result"] {
            if let Some(text) = v.get(field).and_then(|t| t.as_str()) {
                if !text.trim().is_empty() {
                    return Some(text.to_string());
                }
            }
        }
    }
    None
}

/// The assistant prose carried by one output line, or `""` for a line that carries none.
///
/// Every provider Tendril launches streams structured JSON, and the text is nested differently in
/// each — so the shapes have to be read by name. Guessing from top-level `text` / `content` /
/// `message` keys (which is all this used to do) reaches none of them: Claude Code's `stream-json`
/// puts a turn's prose at `message.content[].text` of a `{"type":"assistant"}` line, so *every*
/// chat turn accumulated an empty response and fell through to the "no response" report, however
/// well the agent had actually answered.
///
/// The shapes, and where each is defined: the eventwire form Tendril's own logs use
/// (`{"kind":"text","text":…}`), Claude / Antigravity (`ClaudeEventParser.ParseAssistant`), Codex
/// (`CodexEventParser.ParseAgentMessage`) and Gemini (`GeminiEventParser.ParseMessage`). A line that
/// is not JSON at all is prose from a provider that streams plain text, and is passed through.
fn extract_delta(line: &str, is_stderr: bool) -> String {
    if is_stderr {
        return String::new();
    }

    let trimmed = line.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            return extract_json_delta(&val);
        }
    }

    format!("{}\n", line)
}

fn extract_json_delta(val: &serde_json::Value) -> String {
    // The eventwire form, which is authoritative when present: any other `kind` (`tool_call`,
    // `tool_result`, `result`, `error`, …) is deliberately not prose.
    if let Some(kind) = val.get("kind").and_then(|k| k.as_str()) {
        if kind == "text" {
            return val
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string();
        }
        return String::new();
    }

    match val.get("type").and_then(|t| t.as_str()) {
        // Claude / Antigravity: text and thinking blocks of an assistant message. `tool_use` blocks
        // on the same line are not prose and are reported by `TurnActivity` from the raw stream.
        Some("assistant") => {
            let Some(blocks) = val
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            else {
                return String::new();
            };
            return blocks
                .iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("");
        }
        // Gemini: one assistant message per line. A `user` role is the CLI echoing the prompt back.
        Some("message") => {
            if val.get("role").and_then(|r| r.as_str()) == Some("user") {
                return String::new();
            }
            return val
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .to_string();
        }
        // Codex: prose arrives as a completed `agent_message` item.
        Some("item.completed") | Some("item.updated") => {
            let Some(item) = val.get("item") else {
                return String::new();
            };
            if item.get("type").and_then(|t| t.as_str()) != Some("agent_message") {
                return String::new();
            }
            return item
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string();
        }
        // `user` lines carry tool results, `system` lines carry session metadata, and a terminal
        // `result` repeats prose that has already been streamed — appending it would double the
        // answer. `compose_turn_content` reads the result line for its response only when nothing
        // was streamed at all.
        Some("user") | Some("system") | Some("result") | Some("turn.completed") | Some("error") => {
            return String::new()
        }
        _ => {}
    }

    // Simple `{"delta": …}` / `{"text": …}` shapes, which is what a wrapper or a test harness emits.
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
    String::new()
}

/// Synthesizes a markdown summary of the tools a turn called, for a turn that did the work but never
/// said anything about it — so `finalize_message` never leaves a turn empty. `None` when the turn
/// called no tools, which leaves the caller free to say *why* there was nothing to report rather
/// than asserting that no reason could be found.
///
/// Reads both wire shapes emitted onto `raw_lines`: the normalised eventwire form
/// (`{"kind":"tool_call",…}` / `{"kind":"tool_result",…}`) and the provider's own form
/// (`{"type":"assistant",…}` / `{"type":"user",…}` with `tool_use` / `tool_result` content blocks) —
/// same two shapes [`crate::agents::reconcile`] and [`crate::jobs::failure_analysis`] read.
fn summarize_tool_calls(raw_lines: &[String]) -> Option<String> {
    let mut call_order: Vec<String> = Vec::new();
    let mut call_names: HashMap<String, String> = HashMap::new();
    let mut call_inputs: HashMap<String, String> = HashMap::new();
    let mut call_results: HashMap<String, (bool, String)> = HashMap::new();

    for line in raw_lines {
        let Some(v) = crate::jobs::failure_analysis::parse_json_object(line) else {
            continue;
        };
        record_report_call(&v, &mut call_order, &mut call_names, &mut call_inputs);
        record_report_result(&v, &mut call_results);
    }

    if call_order.is_empty() {
        return None;
    }

    let mut actions = String::new();
    let mut failures = String::new();
    for id in &call_order {
        let name = call_names.get(id).map(String::as_str).unwrap_or("unknown");
        let label = match call_inputs.get(id) {
            Some(input) if !input.is_empty() => format!("{} ({})", name, input),
            _ => name.to_string(),
        };

        match call_results.get(id) {
            Some((is_error, output)) if is_failed_tool_output(*is_error, output) => {
                actions.push_str(&format!("- **{}** — failed\n", label));
                let detail = if output.trim().is_empty() {
                    "(no output)".to_string()
                } else {
                    crate::jobs::sanitize_for_display(output)
                };
                failures.push_str(&format!("- **{}**: {}\n", label, detail));
            }
            Some(_) => {
                actions.push_str(&format!("- **{}** — completed\n", label));
            }
            None => {
                actions.push_str(&format!("- **{}** — no result recorded\n", label));
            }
        }
    }

    let mut report = String::from("### Summary of Actions\n\n");
    report.push_str(&actions);

    if !failures.is_empty() {
        report.push_str("\n### Failures\n\n");
        report.push_str(&failures);
    }

    Some(report)
}

/// True for an explicit `is_error`, and for the synthetic outputs
/// [`crate::agents::reconcile::build_missing_result_lines`] writes for a tool call the stream never
/// closed — those already carry `is_error: true`, but a provider could in principle emit the same
/// marker text itself without the flag, so the text is checked either way.
fn is_failed_tool_output(is_error: bool, output: &str) -> bool {
    is_error
        || matches!(
            output.trim(),
            "[Cancelled]" | "[Timed out]" | "[No output received]"
        )
}

fn record_report_call(
    v: &serde_json::Value,
    order: &mut Vec<String>,
    names: &mut HashMap<String, String>,
    inputs: &mut HashMap<String, String>,
) {
    // Eventwire form.
    if v.get("kind").and_then(|k| k.as_str()) == Some("tool_call") {
        if let Some(id) = v.get("tool_use_id").and_then(|i| i.as_str()) {
            note_report_call(
                id,
                v.get("tool_name"),
                v.get("input").or_else(|| v.get("arguments")),
                order,
                names,
                inputs,
            );
        }
        return;
    }

    // Provider form: an assistant message with tool_use content blocks.
    if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
        let Some(blocks) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            return;
        };
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                continue;
            }
            if let Some(id) = block.get("id").and_then(|i| i.as_str()) {
                note_report_call(
                    id,
                    block.get("name"),
                    block.get("input"),
                    order,
                    names,
                    inputs,
                );
            }
        }
    }
}

fn note_report_call(
    id: &str,
    name: Option<&serde_json::Value>,
    input: Option<&serde_json::Value>,
    order: &mut Vec<String>,
    names: &mut HashMap<String, String>,
    inputs: &mut HashMap<String, String>,
) {
    if !names.contains_key(id) {
        order.push(id.to_string());
    }
    names.insert(
        id.to_string(),
        name.and_then(|n| n.as_str())
            .unwrap_or("unknown")
            .to_string(),
    );
    if let Some(input) = input {
        let summary = summarize_tool_input(input);
        if !summary.is_empty() {
            inputs.insert(id.to_string(), summary);
        }
    }
}

/// A short human-readable rendering of a tool call's arguments for the "Summary of Actions" line —
/// the first few keys of an object input, or the string itself for a bare-string input.
fn summarize_tool_input(input: &serde_json::Value) -> String {
    match input {
        serde_json::Value::Object(map) if !map.is_empty() => {
            let mut parts: Vec<String> = map
                .iter()
                .take(3)
                .map(|(k, v)| {
                    let rendered = match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    format!("{}: {}", k, rendered)
                })
                .collect();
            parts.sort();
            parts.join(", ")
        }
        serde_json::Value::String(s) => s.clone(),
        _ => String::new(),
    }
}

fn record_report_result(v: &serde_json::Value, results: &mut HashMap<String, (bool, String)>) {
    // Eventwire form.
    if v.get("kind").and_then(|k| k.as_str()) == Some("tool_result") {
        if let Some(id) = v.get("tool_use_id").and_then(|i| i.as_str()) {
            let is_error = v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
            let output = v
                .get("output")
                .and_then(|o| o.as_str())
                .unwrap_or("")
                .to_string();
            results.insert(id.to_string(), (is_error, output));
        }
        return;
    }

    // Provider form: a user message whose content blocks are tool results.
    if v.get("type").and_then(|t| t.as_str()) == Some("user") {
        let Some(blocks) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            return;
        };
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                continue;
            }
            let Some(id) = block.get("tool_use_id").and_then(|i| i.as_str()) else {
                continue;
            };
            let is_error = block
                .get("is_error")
                .and_then(|b| b.as_bool())
                .unwrap_or(false);
            let output = match block.get("content") {
                Some(serde_json::Value::String(s)) => s.clone(),
                Some(serde_json::Value::Array(items)) => items
                    .iter()
                    .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join(" "),
                _ => String::new(),
            };
            results.insert(id.to_string(), (is_error, output));
        }
    }
}

/// True for the placeholder title a session is created with, and for anything blank —
/// the guard `start_session_turn` and `generate_title` use to decide whether a title is still
/// eligible for auto-generation.
pub fn is_default_chat_title(title: &str) -> bool {
    let trimmed = title.trim();
    trimmed.is_empty() || trimmed.eq_ignore_ascii_case("New Chat")
}

/// The prompt one chat turn hands the agent: the conversation so far, the chat session's id, and the
/// current request. Port of `ChatExecutionService.SendMessageAsync`'s `agentPromptBuilder`.
///
/// `history` is the session's messages *before* this turn's own user message and assistant stub were
/// appended, which is the same slice V1 replays (`history.Take(history.Count - 1)`).
///
/// Replaying the conversation is what carries it forward: a chat turn is a fresh agent session, so
/// nothing else remembers the previous turns. Empty messages are skipped, because an assistant stub
/// that a turn never filled in has nothing to contribute.
pub fn build_chat_agent_prompt(history: &[ChatMessage], prompt: &str, session_id: &str) -> String {
    let mut out = String::new();

    let prior: Vec<&ChatMessage> = history
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .collect();
    if !prior.is_empty() {
        out.push_str("# Previous Conversation Discussion History\n");
        out.push_str(
            "The following is the previous conversation history in this chat session:\n\n",
        );
        for msg in prior {
            let label = match msg.role.to_ascii_lowercase().as_str() {
                "user" => "User",
                "system" => "System Event",
                _ => "Assistant",
            };
            out.push_str(&format!("### {}\n{}\n\n", label, msg.content));
        }
        out.push_str("---\n\n");
    }

    out.push_str("# Current Chat Session\n");
    out.push_str(&format!("Chat Session ID: {}\n", session_id));
    out.push_str(&format!(
        "When starting jobs using `tendril job start`, always include `--chat-session {}` so the job is tracked in this chat session.\n",
        session_id
    ));
    out.push_str("---\n\n");

    out.push_str("# Current User Request\n");
    out.push_str(prompt);
    out.push('\n');

    out
}

/// Verbatim port of `ChatSessionNamingService.BuildPrompt` (legacy C#).
pub fn build_title_prompt(user_prompt: &str) -> String {
    format!(
        "Generate a short 3 to 6 word title describing the topic of the following user request.\n\
Output ONLY the title text. Do not include quotes, markdown headings, prefixes like \"Title:\", or trailing punctuation.\n\
Do not act on the request, run tools, or edit any files.\n\
\n\
User:\n\
{}",
        user_prompt
    )
}

fn strip_wrapping_title_formatting(text: &str) -> String {
    let result = text.trim();
    let char_count = result.chars().count();
    if result.starts_with("**") && result.ends_with("**") && char_count >= 4 {
        result[2..result.len() - 2].trim().to_string()
    } else if ((result.starts_with('*') && result.ends_with('*'))
        || (result.starts_with('`') && result.ends_with('`')))
        && char_count >= 2
    {
        result[1..result.len() - 1].trim().to_string()
    } else {
        result.to_string()
    }
}

const TITLE_QUOTE_CHARS: [char; 7] = [
    '"', '\'', '`', '\u{201C}', '\u{201D}', '\u{00AB}', '\u{00BB}',
];

/// Port of `ChatSessionNamingService.CleanGeneratedTitle` (legacy C#): first non-empty line, then
/// a fixpoint loop stripping heading markers, bold/italic/code wrapping, `Title:`-style prefixes,
/// surrounding quotes and trailing punctuation, capped at 50 **chars** (not bytes — the C#
/// `title[..50]` is a UTF-16 index and a byte slice in Rust would panic on multi-byte input).
/// Unlike the legacy split between this method and the caller's own `IsDefaultTitle` check, a
/// cleaned result that is still the default title is folded in here and returned as `None`, so
/// every caller gets one signal for "no usable title" rather than two to check separately.
pub fn clean_generated_title(raw: &str) -> Option<String> {
    let first_line = raw
        .split(['\r', '\n'])
        .map(|l| l.trim())
        .find(|l| !l.is_empty())?;

    let mut title = first_line.to_string();
    let prefixes = ["Title:", "Topic:", "Subject:", "Name:"];

    loop {
        let previous = title.clone();

        while title.starts_with('#') {
            title = title.trim_start_matches('#').trim_start().to_string();
        }

        title = strip_wrapping_title_formatting(&title);

        for prefix in prefixes {
            let plen = prefix.chars().count();
            let candidate: String = title.chars().take(plen).collect();
            if candidate.eq_ignore_ascii_case(prefix) {
                title = title
                    .chars()
                    .skip(plen)
                    .collect::<String>()
                    .trim()
                    .to_string();
                break;
            }
        }

        title = title
            .trim_matches(|c| TITLE_QUOTE_CHARS.contains(&c))
            .to_string();

        while title.ends_with("...") || title.ends_with('…') {
            if title.ends_with("...") {
                title = title[..title.len() - 3].trim_end().to_string();
            } else {
                let new_len = title.len() - '…'.len_utf8();
                title = title[..new_len].trim_end().to_string();
            }
        }
        title = title
            .trim_end_matches(['.', '!', '?', ':', ';', ','])
            .to_string();

        title = title
            .trim_matches(|c| TITLE_QUOTE_CHARS.contains(&c))
            .to_string();
        title = title.trim().to_string();

        if title == previous || title.is_empty() {
            break;
        }
    }

    if title.is_empty() {
        return None;
    }

    if title.chars().count() > 50 {
        title = title
            .chars()
            .take(50)
            .collect::<String>()
            .trim()
            .to_string();
    }

    if title.is_empty() || is_default_chat_title(&title) {
        None
    } else {
        Some(title)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape that was silently dropped: Claude Code's `--output-format stream-json` puts a
    /// turn's prose at `message.content[].text`, and the terminal `result` line repeats it.
    #[test]
    fn test_extract_delta_reads_claude_stream_json() {
        let assistant = r#"{"type":"assistant","message":{"model":"claude-opus-5","content":[{"type":"text","text":"Hello"},{"type":"text","text":" world"}]},"session_id":"s"}"#;
        assert_eq!(extract_delta(assistant, false), "Hello world");

        // Metadata, tool traffic and the result echo carry no new prose.
        for line in [
            r#"{"type":"system","subtype":"init","session_id":"s","tools":["Bash"]}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Hello world"}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{}}]}}"#,
        ] {
            assert_eq!(extract_delta(line, false), "", "line: {}", line);
        }
    }

    #[test]
    fn test_extract_delta_reads_other_provider_shapes() {
        // Tendril's own eventwire form.
        assert_eq!(
            extract_delta(r#"{"kind":"text","text":"eventwire"}"#, false),
            "eventwire"
        );
        assert_eq!(
            extract_delta(
                r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}"#,
                false
            ),
            ""
        );
        // Codex.
        assert_eq!(
            extract_delta(
                r#"{"type":"item.completed","item":{"type":"agent_message","id":"i1","text":"codex says"}}"#,
                false
            ),
            "codex says"
        );
        assert_eq!(
            extract_delta(
                r#"{"type":"item.completed","item":{"type":"command_execution","id":"i1","command":"ls"}}"#,
                false
            ),
            ""
        );
        // Gemini, whose user lines are the CLI echoing the prompt back.
        assert_eq!(
            extract_delta(
                r#"{"type":"message","role":"assistant","content":"gemini says"}"#,
                false
            ),
            "gemini says"
        );
        assert_eq!(
            extract_delta(
                r#"{"type":"message","role":"user","content":"my prompt"}"#,
                false
            ),
            ""
        );
        // A plain-text line is prose, and stderr never is.
        assert_eq!(extract_delta("just words", false), "just words\n");
        assert_eq!(extract_delta("Error: boom", true), "");
    }

    fn outcome(exit_code: Option<i32>, terminated: TerminationReason) -> TurnOutcome {
        TurnOutcome {
            launch_error: None,
            terminated: Some(terminated),
            exit_code,
            result_success: None,
            stderr_tail: Vec::new(),
        }
    }

    #[test]
    fn test_compose_turn_content_prefers_the_agents_own_words() {
        let ok = outcome(Some(0), TerminationReason::Exited);
        assert_eq!(compose_turn_content("the answer", &[], &ok), "the answer");

        // Nothing streamed, but the terminal result carried the answer.
        let result_line = vec![
            r#"{"type":"result","subtype":"success","is_error":false,"result":"from the result"}"#
                .to_string(),
        ];
        assert_eq!(
            compose_turn_content("", &result_line, &ok),
            "from the result"
        );

        // Nothing at all, and the run succeeded: V1's wording, not a failure report.
        assert_eq!(
            compose_turn_content("", &[], &ok),
            "Task completed successfully."
        );
    }

    #[test]
    fn test_compose_turn_content_always_explains_a_failure() {
        let mut failed = outcome(Some(1), TerminationReason::Exited);
        failed.stderr_tail = vec!["Error: Session ID abc is already in use.".to_string()];
        let reported = compose_turn_content("", &[], &failed);
        assert!(reported.contains("status code 1"), "got: {}", reported);
        assert!(
            reported.contains("Session ID abc is already in use"),
            "got: {}",
            reported
        );

        // Partial prose is kept and the reason appended, rather than one replacing the other.
        let with_text = compose_turn_content("got partway", &[], &failed);
        assert!(with_text.starts_with("got partway"), "got: {}", with_text);
        assert!(with_text.contains("status code 1"), "got: {}", with_text);
        assert!(
            with_text.contains("Session ID abc is already in use"),
            "got: {}",
            with_text
        );

        // An agent that already printed the reason itself gets the headline only, not the same
        // sentence a second time — the shape the duplicated report in the UI had.
        let echoed = compose_turn_content("Error: Session ID abc is already in use.", &[], &failed);
        assert_eq!(
            echoed,
            "Error: Session ID abc is already in use.\n\nAgent execution completed with status code 1"
        );

        // A signal death reports no exit code, and is not a success.
        let signalled = compose_turn_content("", &[], &outcome(None, TerminationReason::Exited));
        assert!(
            signalled.contains("unknown status code"),
            "got: {}",
            signalled
        );

        // The agent's own result event outranks the exit code, in both directions.
        let mut said_ok = outcome(Some(1), TerminationReason::Exited);
        said_ok.result_success = Some(true);
        assert_eq!(compose_turn_content("fine", &[], &said_ok), "fine");
        let mut said_failed = outcome(Some(0), TerminationReason::Exited);
        said_failed.result_success = Some(false);
        assert!(compose_turn_content("hmm", &[], &said_failed).contains("status code 0"));

        let cancelled = compose_turn_content("", &[], &outcome(None, TerminationReason::Cancelled));
        assert_eq!(cancelled, "Execution was cancelled.");

        let timed_out = compose_turn_content("", &[], &outcome(None, TerminationReason::TimedOut));
        assert!(timed_out.contains("timed out"), "got: {}", timed_out);

        let unlaunchable = TurnOutcome {
            launch_error: Some("Failed to spawn agent 'claude': No such file or directory".into()),
            ..Default::default()
        };
        assert!(compose_turn_content("", &[], &unlaunchable).contains("Failed to spawn agent"));
    }

    #[test]
    fn test_build_chat_agent_prompt_replays_history() {
        let msg = |role: &str, content: &str| ChatMessage {
            id: Uuid::new_v4().to_string(),
            role: role.to_string(),
            content: content.to_string(),
            timestamp: Utc::now(),
            agent_id: None,
            model_id: None,
            raw_stream: None,
            effort: None,
        };

        let first = build_chat_agent_prompt(&[], "what is broken?", "sess-1");
        assert!(!first.contains("Previous Conversation"));
        assert!(first.contains("Chat Session ID: sess-1"));
        assert!(first.contains("--chat-session sess-1"));
        assert!(first.contains("what is broken?"));

        let history = vec![
            msg("user", "what is broken?"),
            msg("assistant", "the chat path"),
            // An assistant stub a turn never filled in has nothing to replay.
            msg("assistant", "   "),
        ];
        let second = build_chat_agent_prompt(&history, "fix it", "sess-1");
        assert!(second.contains("# Previous Conversation Discussion History"));
        assert!(second.contains("### User\nwhat is broken?"));
        assert!(second.contains("### Assistant\nthe chat path"));
        assert!(second.contains("fix it"));
        assert_eq!(
            second.matches("### Assistant").count(),
            1,
            "an empty message must not be replayed"
        );
    }
}
