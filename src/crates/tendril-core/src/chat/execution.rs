use crate::agents::eventwire::{event_wire_text, EventWireNormalizer};
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
    /// One eventwire line of a turn in flight — a tool call, its result, thinking, or prose.
    ///
    /// The port of V1's `ChatExecutionService.StreamLineEmitted`, which is what makes a turn's tool
    /// calls appear *as they happen*: the client appends the line to the message's `rawStream`, which
    /// is what `TurnActivity` renders. Without it the activity existed only on the copy re-read from
    /// the daemon once the turn had already finished.
    #[serde(rename = "chat.stream_event")]
    StreamEvent {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        line: String,
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
    /// Who the turn's message is from: `user` (the default) or `system` for an event Tendril injected
    /// — a job finishing, a plan moving, a pull request opening.
    ///
    /// It decides three things, all of them V1's (`ChatExecutionService.SendMessageAsync`): the role the
    /// message is stored under, which prompt section the agent is given (`# Current Event Notification`
    /// rather than `# Current User Request`), and whether the session may be auto-named from it.
    pub role: Option<String>,
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

    /// The jobs this session set running, as the prompt describes them.
    ///
    /// Read straight from SQLite rather than through [`crate::jobs::manager::JobManager`]: the chat
    /// manager has no handle on it and does not need one — this is a read of six columns, and going
    /// through the manager would couple the two lifecycles for nothing. A job that cannot be read is
    /// skipped rather than guessed at: a prompt claiming a job is `Pending` when the row is gone would
    /// be worse than not mentioning it.
    ///
    /// Two sources, unioned, the same pair the app's header unions. `Jobs.ChatSessionId` is the durable
    /// one and the only one that knows about a job the stream never announced — started through the MCP
    /// tool, started from the interactive terminal, inherited from the plan, or submitted on a request
    /// whose confirmation was lost. The cached session's `spawned_job_ids` then adds the job started
    /// moments ago in this same turn, which the stream reports before the row is queryable.
    pub async fn spawned_jobs(&self, session_id: &str) -> Vec<ChatSpawnedJob> {
        let cached_ids = match self.sessions.read().await.get(session_id) {
            Some(session) => session.spawned_job_ids.clone(),
            None => Vec::new(),
        };

        let db_path = crate::config::get_database_path(&self.tendril_home);
        let Ok(conn) = crate::db::open_database(&db_path) else {
            return Vec::new();
        };

        let mut jobs =
            crate::db::jobs::list_jobs_for_chat_session(&conn, session_id).unwrap_or_default();
        for id in cached_ids {
            if !jobs.iter().any(|job| job.id == id) {
                if let Ok(Some(job)) = crate::db::jobs::get_job(&conn, &id) {
                    jobs.push(job);
                }
            }
        }

        jobs.into_iter()
            .map(|job| ChatSpawnedJob {
                id: job.id,
                job_type: job.job_type,
                status: format!("{:?}", job.status),
                plan_id: job.reported_plan_id,
                plan_title: job.reported_plan_title,
                status_message: job.status_message,
            })
            .collect()
    }

    /// Injects an event into a session and lets the agent react to it — V1's
    /// `SendMessageAsync(sessionId, content, role: "system")`.
    ///
    /// This is the half that was missing: the daemon could already *store* a system message into a
    /// plan's chats (`storage::broadcast_system_message_to_plan_sessions`), but nothing ran a turn
    /// afterwards, so the agent never saw the event and never advised on it.
    ///
    /// A session that is mid-turn is left alone rather than interrupted: the event is stored so the
    /// thread and the *next* turn's replayed history both carry it, which is where V1's queue would
    /// have put it anyway.
    pub async fn notify_event(self: &Arc<Self>, session_id: &str, content: &str) -> Result<bool> {
        if self.is_generating(session_id).await {
            let message = ChatMessage {
                id: Uuid::new_v4().to_string(),
                role: "system".to_string(),
                content: content.to_string(),
                timestamp: Utc::now(),
                agent_id: None,
                model_id: None,
                raw_stream: None,
                effort: None,
            };
            self.add_message(session_id, message).await?;
            return Ok(false);
        }

        self.start_session_turn(
            session_id,
            content,
            ChatTurnOptions {
                role: Some("system".to_string()),
                ..Default::default()
            },
        )
        .await?;
        Ok(true)
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

        let role = options.role.clone().unwrap_or_else(|| "user".to_string());
        let is_event = is_event_role(&role);

        // If title is still default, write a synchronous snippet immediately (so the sidebar
        // never flashes "New Chat") and remember it so the naming task below can tell an
        // auto-generated title apart from a user rename that lands during its 30s budget.
        //
        // Only a *user* turn may name a session, which is V1's `isFirstUserMessage`. An injected job
        // event arriving before the user has said anything would otherwise become the session's name —
        // a chat called "[System Event] Pull request for plan …".
        let mut auto_title_snippet: Option<String> = None;
        if !is_event && is_default_chat_title(&session.title) && !user_prompt.trim().is_empty() {
            let snippet: String = user_prompt.trim().chars().take(40).collect();
            let snippet = sanitize_title(&snippet);
            session.title = snippet.clone();
            auto_title_snippet = Some(snippet);
        }

        // Add user message
        let user_msg = ChatMessage {
            id: Uuid::new_v4().to_string(),
            // An injected event is stored as `system`, so the thread renders it as a one-line timeline
            // note rather than as something the user said (`ChatMessageRow`'s `formatSystemEvent`).
            role: role.clone(),
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
            // Only the turn that was injected is an event: a prompt dequeued afterwards is the user's.
            let mut current_role = role;
            let mut current_history = history_before;
            let mut current_assistant_msg_id = initial_assistant_msg_id;
            let current_options = options;
            let mut is_first_turn = true;
            // Anchored on the CLI's own confirmation (`StartOutcome::render`) and nothing else, which
            // is V1's `JobStartedRegex` rule. It used to also match `tendril job start <type> <next
            // token>`, i.e. the *command* rather than its result — so it captured whatever followed the
            // job type: `--chat-session` and `--description` for a `CreatePlan`, and the plan id for an
            // `ExecutePlan`. Each of those was recorded as a spawned job, resolved against no real job,
            // and then silently dropped by the header, which is why the header stayed empty.
            let job_regex = Regex::new(r"(?i)\bjob started:\s*(?:id\s+)?([0-9a-zA-Z_-]+)").ok();

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
                    prompt: build_chat_agent_prompt(
                        &current_history,
                        &current_prompt,
                        &s_id,
                        &current_role,
                        &mgr.spawned_jobs(&s_id).await,
                    ),
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
                // One per run: Antigravity identifies a tool step by `step_index`, so tying its
                // `ACTIVE` and `DONE` halves together is state that lives for the length of the turn.
                let mut normalizer = EventWireNormalizer::new();
                let mut is_dirty = false;
                let mut persist_ticker = tokio::time::interval(persist_interval);
                persist_ticker.tick().await; // consume initial tick

                loop {
                    tokio::select! {
                        opt_evt = line_rx.recv() => {
                            match opt_evt {
                                Some(evt) => {
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
                                                // Written to disk here rather than left for the turn's
                                                // final save: `list_sessions` reloads this map from disk,
                                                // and the app calls it whenever the chat view mounts, so
                                                // an id held only in memory was lost by any session list
                                                // that landed mid-turn — and then written back out empty.
                                                let saved = {
                                                    let mut sessions_map = mgr.sessions.write().await;
                                                    match sessions_map.get_mut(&s_id) {
                                                        Some(s) if !s.spawned_job_ids.contains(&job_id) => {
                                                            s.spawned_job_ids.push(job_id.clone());
                                                            Some(s.clone())
                                                        }
                                                        _ => None,
                                                    }
                                                };
                                                if let Some(session) = saved {
                                                    let _ = crate::chat::storage::save_session(
                                                        &mgr.tendril_home,
                                                        &session,
                                                    );
                                                    let _ = mgr.event_tx.send(ChatEvent::JobSpawned {
                                                        session_id: s_id.clone(),
                                                        job_id,
                                                    });
                                                }
                                            }
                                        }
                                    }

                                    // The provider's line becomes one or more eventwire events, which
                                    // is the only shape `TurnActivity`/`AgentViewer` can render, and
                                    // the only place a turn's prose can be read from uniformly.
                                    for wire_line in normalizer.normalize(&evt.raw_line, evt.is_stderr) {
                                        raw_stream_lines.push(wire_line.clone());
                                        is_dirty = true;

                                        // Published per event so tool calls appear *while* the turn
                                        // runs, as V1's `StreamLineEmitted` does. Without this the
                                        // activity only existed on the message re-read at the end.
                                        let _ = mgr.event_tx.send(ChatEvent::StreamEvent {
                                            session_id: s_id.clone(),
                                            message_id: current_assistant_msg_id.clone(),
                                            line: wire_line.clone(),
                                        });

                                        if let Some(delta) =
                                            next_text_delta(&accumulated_text, &wire_line)
                                        {
                                            accumulated_text.push_str(&delta);
                                            let _ = mgr.event_tx.send(ChatEvent::StreamDelta {
                                                session_id: s_id.clone(),
                                                message_id: current_assistant_msg_id.clone(),
                                                delta,
                                            });
                                        }
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
                    current_role = "user".to_string();
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

        // The same normalisation the turn itself uses, so the naming agent's answer is read out of
        // whatever shape its provider emits rather than only the one shape a guess covered.
        let mut normalizer = EventWireNormalizer::new();
        let mut accumulated_text = String::new();
        while let Some(evt) = line_rx.recv().await {
            for wire_line in normalizer.normalize(&evt.raw_line, evt.is_stderr) {
                if let Some(delta) = next_text_delta(&accumulated_text, &wire_line) {
                    accumulated_text.push_str(&delta);
                }
            }
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

    /// Why the turn failed, and the part of it the agent may already have said itself.
    ///
    /// Most specific source first: the spawn failure, the reason we stopped it, the agent's own
    /// structured error event, then its stderr. Only when none of those exist does the exit code
    /// become the answer — V1's `result.Error ?? "Agent execution completed with status code N"`
    /// floor, and in that order for the same reason.
    ///
    /// A reason **stands alone**: it is not introduced by the exit code. A provider that answers
    /// `503 No capacity available` on a process that exits 0 produced
    /// "Agent execution completed with status code 0: API error …", which reads as though a clean exit
    /// were the explanation for a turn that plainly failed. The code is only mentioned when it is the
    /// only thing known.
    ///
    /// The second element is the reason on its own, so a caller can tell whether the agent's own
    /// output already contains it.
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

        if let Some(reason) = crate::jobs::try_extract_error_event(raw_lines) {
            return (reason.clone(), Some(reason));
        }

        let tail = self
            .stderr_tail
            .iter()
            .map(|line| crate::jobs::sanitize_for_display(line))
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join(" | ");
        if !tail.is_empty() {
            return (tail.clone(), Some(tail));
        }

        let status = match self.exit_code {
            Some(code) => format!("Agent execution completed with status code {}", code),
            None => "Agent execution completed with an unknown status code".to_string(),
        };
        (status, None)
    }

    fn failure_text(&self, raw_lines: &[String]) -> String {
        self.failure_parts(raw_lines).0
    }
}

/// What a finished turn's message says: the agent's own words when it produced any, and why there are
/// none when it did not.
///
/// It is deliberately **not** an inventory of what the turn did. The eventwire stream carries a
/// `tool_call` / `tool_result` pair per tool, which `TurnActivity` renders as cards above this text and
/// which `tendril chat send` prints as it happens — so a prose summary of the same calls is a second,
/// longer disclosure of something the reader can already see, and it pushed the one line that mattered
/// (the failure reason) off the bottom of a wall of `run_command` entries.
fn compose_turn_content(text: &str, raw_lines: &[String], outcome: &TurnOutcome) -> String {
    let success = outcome.is_success();
    let with_failure = |body: String| -> String {
        if success {
            return body;
        }
        let (reason, detail) = outcome.failure_parts(raw_lines);
        if body.trim().is_empty() {
            return reason;
        }
        // An agent that printed its own error (a bad model, an auth failure, a 503) has already said
        // it; appending the same sentence underneath reads as the message twice.
        let already_said = detail
            .as_deref()
            .is_some_and(|detail| body.contains(detail.trim()));
        if already_said {
            return body;
        }
        format!("{}\n\n{}", body, reason)
    };

    if !text.trim().is_empty() {
        return with_failure(text.to_string());
    }

    // A provider that streams nothing but a terminal result event (and Claude's `--print` result
    // event always repeats the final answer) still answered the question.
    if let Some(response) = terminal_result_response(raw_lines) {
        return with_failure(response);
    }

    if success {
        // V1's wording for a run that succeeded without saying anything. What it *did* is in the cards.
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

/// The text one eventwire line adds to the answer being built, or `None` when it adds nothing.
///
/// A `delta` event is a chunk and is appended verbatim. A non-delta event is a whole message (how
/// Claude, Codex and Gemini send prose), and gets a blank line in front of it so consecutive messages
/// read as paragraphs instead of running together.
///
/// V1 *replaces* the accumulated text on a non-delta event (`ChatExecutionService`:
/// `LastText = IsDelta ? LastText + text : text`) because its `ChatWidget` renders the whole turn
/// from the raw stream and only falls back to `content`. V2's row renders prose from `content` and
/// only the tool activity from the stream, so dropping earlier messages would lose them from the
/// thread entirely — they are appended instead.
fn next_text_delta(accumulated: &str, wire_line: &str) -> Option<String> {
    let (text, is_delta) = event_wire_text(wire_line)?;
    if text.is_empty() {
        return None;
    }
    if is_delta || accumulated.is_empty() || accumulated.ends_with('\n') {
        return Some(text);
    }
    Some(format!("\n\n{}", text))
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
pub fn build_chat_agent_prompt(
    history: &[ChatMessage],
    prompt: &str,
    session_id: &str,
    role: &str,
    spawned_jobs: &[ChatSpawnedJob],
) -> String {
    let mut out = String::new();

    // V1 puts this first, before the history: what the session has already set running is context for
    // everything below it, and for a turn that *is* a job event it is the subject.
    if !spawned_jobs.is_empty() {
        out.push_str("# Jobs Spawned in this Chat Session\n");
        out.push_str("The following jobs were spawned in this chat session:\n\n");
        for job in spawned_jobs {
            out.push_str(&job.prompt_line());
        }
        out.push('\n');
        out.push_str(match JobRollup::of(spawned_jobs) {
            JobRollup::AllDone => "All spawned jobs have completed. Proactively guide the user through the next steps (e.g. ask if they want you to review the plan or implementation, inspect results, or proceed to creating PRs).\n",
            JobRollup::AnyFailed => "Some spawned jobs failed or encountered issues. Guide the user through the failures and offer to diagnose, retry, or adjust the plan.\n",
            JobRollup::StillRunning => "Some spawned jobs are still running or pending. Inform the user of their progress as appropriate.\n",
        });
        out.push_str("---\n\n");
    }

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
    // The whole command, in one code span, rather than the subcommand and the flag in two. That is what
    // the agent copies, and it is also what `promptware_contract_test` can hand to clap — the split
    // form named a flag the CLI did not have for as long as it took someone to notice the chat's jobs
    // menu was always empty, because neither half was a command anything could check.
    out.push_str(&format!(
        "When starting jobs, always pass `--chat-session {session_id}` so the job is tracked in \
         this chat session, e.g. `tendril job start ExecutePlan 00042 --chat-session {session_id}`.\n"
    ));
    out.push_str("---\n\n");

    if is_event_role(role) {
        // The framing is the whole point of the system role: without it an injected event reads as
        // something the user typed, and the agent answers it instead of reacting to it.
        out.push_str("# Current Event Notification\n");
        out.push_str(prompt);
        out.push_str("\n\n");
        out.push_str("Evaluate this completed job event. Proactively inspect the job outcomes/artifacts if needed, determine whether any action is needed, and advise the user with a concise summary and suggested next steps.\n");
    } else {
        out.push_str("# Current User Request\n");
        out.push_str(prompt);
        out.push('\n');
    }

    out
}

/// One job this chat session set running, as the prompt describes it. The fields are the ones V1 lists
/// (`ChatExecutionService`'s spawned-jobs block); everything else on a job is noise in a prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatSpawnedJob {
    pub id: String,
    pub job_type: String,
    pub status: String,
    pub plan_id: Option<String>,
    pub plan_title: Option<String>,
    pub status_message: Option<String>,
}

impl ChatSpawnedJob {
    fn prompt_line(&self) -> String {
        let plan = match (&self.plan_id, &self.plan_title) {
            (Some(id), Some(title)) if !id.is_empty() => format!(" | Plan: {} ({})", id, title),
            (Some(id), None) if !id.is_empty() => format!(" | Plan: {}", id),
            _ => String::new(),
        };
        let message = match &self.status_message {
            Some(message) if !message.trim().is_empty() => format!(" | Message: {}", message),
            _ => String::new(),
        };
        format!(
            "- Job {}: {} | Status: {}{}{}\n",
            self.id, self.job_type, self.status, plan, message
        )
    }

    fn is_completed(&self) -> bool {
        self.status.eq_ignore_ascii_case("Completed")
    }

    fn is_failed(&self) -> bool {
        ["Failed", "Timeout", "Stopped"]
            .iter()
            .any(|s| self.status.eq_ignore_ascii_case(s))
    }
}

/// Which of V1's three closing sentences the jobs section ends with.
enum JobRollup {
    AllDone,
    AnyFailed,
    StillRunning,
}

impl JobRollup {
    fn of(jobs: &[ChatSpawnedJob]) -> Self {
        if jobs.iter().all(ChatSpawnedJob::is_completed) {
            // V1 checks "all done" before "any failed", so a set that finished with failures in it is
            // reported as finished — a failed job *is* done, and the failure is on its own line above.
            return Self::AllDone;
        }
        if jobs.iter().any(ChatSpawnedJob::is_failed) {
            return Self::AnyFailed;
        }
        Self::StillRunning
    }
}

/// Whether a turn's message is an event Tendril injected rather than something the user typed.
/// `ChatExecutionService` compares the role to `"system"` case-insensitively, and so does this.
pub fn is_event_role(role: &str) -> bool {
    role.trim().eq_ignore_ascii_case("system")
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

    /// How the eventwire text events a turn receives accumulate into the message body.
    ///
    /// Which shapes yield a text event at all is covered by
    /// [`crate::agents::eventwire`]'s own tests, against streams captured from real CLI runs.
    #[test]
    fn test_next_text_delta_accumulation() {
        let chunk = |text: &str| crate::agents::eventwire::text_event(text, true);
        let whole = |text: &str| crate::agents::eventwire::text_event(text, false);

        // Chunks append verbatim: Antigravity's `text_delta`, and any provider streaming partials.
        assert_eq!(
            next_text_delta("", &chunk("Yes, ")).as_deref(),
            Some("Yes, ")
        );
        assert_eq!(
            next_text_delta("Yes, ", &chunk("I am alive.")).as_deref(),
            Some("I am alive.")
        );

        // Whole messages become paragraphs rather than running into the previous one.
        assert_eq!(
            next_text_delta("", &whole("Reading it.")).as_deref(),
            Some("Reading it.")
        );
        assert_eq!(
            next_text_delta("Reading it.", &whole("It says X.")).as_deref(),
            Some("\n\nIt says X.")
        );
        // ...unless the text so far already ended a line.
        assert_eq!(
            next_text_delta("Reading it.\n", &whole("It says X.")).as_deref(),
            Some("It says X.")
        );

        // Nothing else contributes to the body: tool traffic, thinking, the result echo, stderr.
        for line in [
            r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}"#.to_string(),
            r#"{"kind":"tool_result","tool_use_id":"t1","output":"ok","is_error":false}"#
                .to_string(),
            r#"{"kind":"thinking","content":"hmm"}"#.to_string(),
            r#"{"kind":"result","response":"Yes, I am alive.","is_success":true}"#.to_string(),
            crate::agents::eventwire::text_event("[stderr] boom", true),
            crate::agents::eventwire::text_event("", true),
            "not json".to_string(),
        ] {
            assert_eq!(
                next_text_delta("Yes, I am alive.", &line),
                None,
                "line: {}",
                line
            );
        }
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
        // The reason stands alone: it is the explanation, so it is not introduced by an exit code.
        let mut failed = outcome(Some(1), TerminationReason::Exited);
        failed.stderr_tail = vec!["Error: Session ID abc is already in use.".to_string()];
        assert_eq!(
            compose_turn_content("", &[], &failed),
            "Error: Session ID abc is already in use."
        );

        // Partial prose is kept and the reason appended, rather than one replacing the other.
        assert_eq!(
            compose_turn_content("got partway", &[], &failed),
            "got partway\n\nError: Session ID abc is already in use."
        );

        // An agent that already printed the reason is left alone rather than made to say it twice.
        let echoed = "Error: Session ID abc is already in use.";
        assert_eq!(compose_turn_content(echoed, &[], &failed), echoed);

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

        // The reported shape: a provider 503 on a process that exited 0. The reason is the whole of
        // the answer — "completed with status code 0: API error …" read as though a clean exit were
        // the explanation for a turn that plainly failed.
        let mut unavailable = outcome(Some(0), TerminationReason::Exited);
        unavailable.result_success = Some(false);
        let result_line = vec![
            r#"{"kind":"result","is_success":false,"error":"API error (attempt 2): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high"}"#
                .to_string(),
        ];
        assert_eq!(
            compose_turn_content("", &result_line, &unavailable),
            "API error (attempt 2): UNAVAILABLE (code 503): No capacity available for model gemini-3.8-flash-high"
        );

        // And a turn that called tools but said nothing carries no inventory of them: the cards and
        // `tendril chat send`'s own lines are where that belongs.
        let tool_lines = vec![
            r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"run_command","input":{"CommandLine":"tendril doctor"}}"#.to_string(),
            r#"{"kind":"tool_result","tool_use_id":"t1","output":"ok","is_error":false}"#.to_string(),
        ];
        assert_eq!(
            compose_turn_content(
                "",
                &tool_lines,
                &outcome(Some(0), TerminationReason::Exited)
            ),
            "Task completed successfully."
        );
        assert!(!compose_turn_content("", &tool_lines, &failed).contains("run_command"));

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

    /// An injected event is framed as one, and a session's jobs are context for whatever it is asked.
    /// The framing is the point: without it the agent answers the event as though the user had typed it.
    #[test]
    fn test_build_chat_agent_prompt_frames_events_and_lists_jobs() {
        let event = "[System Event] Job 00042 (ExecutePlan) completed.";
        let injected = build_chat_agent_prompt(&[], event, "sess-1", "system", &[]);
        assert!(
            injected.contains("# Current Event Notification"),
            "got: {}",
            injected
        );
        assert!(!injected.contains("# Current User Request"));
        assert!(injected.contains(event));
        // The instruction is what turns a notification into something to act on.
        assert!(injected.contains("Evaluate this completed job event."));
        assert!(
            injected.contains("advise the user with a concise summary and suggested next steps")
        );

        // The role check is case-insensitive, as `ChatExecutionService`'s is, and anything else is a
        // user request.
        assert!(is_event_role("system") && is_event_role("System") && is_event_role(" SYSTEM "));
        for role in ["user", "", "assistant", "systemic"] {
            assert!(!is_event_role(role), "role: {}", role);
        }
        assert!(build_chat_agent_prompt(&[], "hi", "s", "assistant", &[])
            .contains("# Current User Request"));

        let job = |id: &str, status: &str| ChatSpawnedJob {
            id: id.to_string(),
            job_type: "ExecutePlan".to_string(),
            status: status.to_string(),
            plan_id: Some("00042".to_string()),
            plan_title: Some("Port the chat".to_string()),
            status_message: None,
        };

        // Every job is listed with its plan, and the closing sentence reads the set as a whole.
        let all_done =
            build_chat_agent_prompt(&[], "now what?", "s", "user", &[job("1", "Completed")]);
        assert!(all_done.contains("# Jobs Spawned in this Chat Session"));
        assert!(all_done
            .contains("- Job 1: ExecutePlan | Status: Completed | Plan: 00042 (Port the chat)"));
        assert!(all_done.contains("All spawned jobs have completed."));

        let failed = build_chat_agent_prompt(
            &[],
            "now what?",
            "s",
            "user",
            &[job("1", "Completed"), job("2", "Failed")],
        );
        assert!(
            failed.contains("Some spawned jobs failed"),
            "got: {}",
            failed
        );

        let running =
            build_chat_agent_prompt(&[], "now what?", "s", "user", &[job("1", "Running")]);
        assert!(
            running.contains("still running or pending"),
            "got: {}",
            running
        );

        // A status message is carried; no jobs means no section at all.
        let mut with_message = job("3", "Failed");
        with_message.status_message = Some("verification failed".to_string());
        let detailed = build_chat_agent_prompt(&[], "?", "s", "user", &[with_message]);
        assert!(
            detailed.contains("| Message: verification failed"),
            "got: {}",
            detailed
        );
        assert!(!build_chat_agent_prompt(&[], "?", "s", "user", &[])
            .contains("Jobs Spawned in this Chat Session"));
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

        let first = build_chat_agent_prompt(&[], "what is broken?", "sess-1", "user", &[]);
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
        let second = build_chat_agent_prompt(&history, "fix it", "sess-1", "user", &[]);
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
