//! The manager itself: the session cache, the queue, cancellation, and answering a question block.
//!
//! The turn loop that fills a session lives in [`super::turn`], and the naming run in
//! [`super::titles`]; both are further `impl ChatExecutionManager` blocks over the state declared
//! here, which is why so much of it is `pub(super)`.

use super::answers::patch_answers_into_wire_lines;
use super::events::ChatEvent;
use super::prompt::ChatSpawnedJob;
use crate::agents::providers::{build_agent_spec, AgentLaunchConfig, AgentProcessSpec};
use crate::chat::models::{ChatMessage, ChatQueuedItem, ChatSession};
use crate::chat::storage::{
    delete_session as storage_delete, load_all_sessions, load_session,
    rename_session as storage_rename, sanitize_title, save_session,
};
use crate::error::{Result, TendrilError};
use crate::questions::apply_question_answers;
use chrono::Utc;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, watch, Mutex, RwLock};
use uuid::Uuid;

pub type SpecBuilder = Arc<dyn Fn(&str, &AgentLaunchConfig) -> AgentProcessSpec + Send + Sync>;

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

/// The output of one turn while it is still being produced.
///
/// The turn task appends to this as the agent streams, and flushes a copy of it over the stored
/// message on every persist tick and once more when the turn ends. Anything that wants to change a
/// message the turn is still writing has to change this too, or the next flush puts the old text
/// back - which is what {@link ChatExecutionManager::apply_answers} does for a question block the
/// agent asked mid-turn. The port of V1's `ActiveExecution.LastText` / `ActiveExecution.RawLines`.
#[derive(Debug, Default)]
pub(super) struct LiveTurn {
    /// The assistant message this turn is streaming into. Held so an answer to some *earlier*
    /// message of the same session - a question block from a turn that has already finished - does
    /// not get written into the one being produced now.
    pub(super) message_id: String,
    /// The prose so far, as `content` will be composed from.
    pub(super) text: String,
    /// The eventwire lines so far, as `raw_stream` will be joined from.
    pub(super) lines: Vec<String>,
}

pub struct ChatExecutionManager {
    pub(super) tendril_home: PathBuf,
    pub(super) sessions: Arc<RwLock<HashMap<String, ChatSession>>>,
    pub(super) generating_sessions: Arc<RwLock<HashSet<String>>>,
    queued_messages: Arc<RwLock<HashMap<String, Vec<ChatQueuedItem>>>>,
    pub(super) active_cancellations: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    /// The output buffers of every turn currently in flight, keyed by session id.
    ///
    /// They live here rather than in the spawned turn task because an answer submitted *while* the
    /// turn runs has to reach them: the task flushes its buffers over the stored message on every
    /// persist tick and again when the turn ends, so an answer written only to the stored message
    /// was reverted by the next flush. V1 keeps the same two buffers on its `ActiveExecution`
    /// (`exec.LastText` / `exec.RawLines`) and patches them under `exec.Lock` for this reason.
    pub(super) live_turns: Arc<Mutex<HashMap<String, Arc<Mutex<LiveTurn>>>>>,
    pub(super) spec_builder: SpecBuilder,
    pub(super) event_tx: broadcast::Sender<ChatEvent>,
    pub(super) persist_interval: Duration,
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
            live_turns: Arc::new(Mutex::new(HashMap::new())),
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
    /// A session that is mid-turn is not interrupted — it is queued behind the turn that is running, as
    /// a `system` item, so the agent reacts to the event as soon as it is free. Storing the message and
    /// stopping there was not equivalent: nothing runs a turn afterwards, so a job that finished while
    /// the user was still talking got a line in the transcript and no reaction to it ever — the agent
    /// only ever saw it as replayed history the next time the user happened to type something.
    ///
    /// Returns whether a turn was started immediately.
    pub async fn notify_event(self: &Arc<Self>, session_id: &str, content: &str) -> Result<bool> {
        if self.is_generating(session_id).await {
            self.enqueue_message(
                session_id,
                ChatQueuedItem {
                    id: Uuid::new_v4().to_string(),
                    prompt: content.to_string(),
                    attachments: None,
                    created_at: Utc::now(),
                    role: Some("system".to_string()),
                },
            )
            .await;
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

    /// Rewrites a question block's answers into a turn that is still being produced.
    ///
    /// The port of `ChatExecutionService.ApplyQuestionAnswers(sessionId, answers)`: the prose buffer
    /// is patched whole, the eventwire lines through {@link patch_answers_into_wire_lines}.
    ///
    /// Returns the patched buffer when `message_id` is the message a turn is currently streaming
    /// into, and `None` otherwise - for a session with no turn in flight, or for an answer to some
    /// earlier message of a session that does have one. The absence of a {@link LiveTurn} entry *is*
    /// the "is it generating" test, and a better one than the flag, because it is the buffer itself
    /// that would otherwise overwrite the answer.
    async fn patch_live_turn(
        &self,
        session_id: &str,
        message_id: &str,
        answers: &HashMap<String, Vec<String>>,
    ) -> Option<(String, Vec<String>)> {
        let handle = {
            let map = self.live_turns.lock().await;
            Arc::clone(map.get(session_id)?)
        };

        let mut live = handle.lock().await;
        // An answer to a question block from an *earlier* turn of the same session must not be
        // written into the message being streamed now.
        if live.message_id != message_id {
            return None;
        }

        if !live.text.is_empty() {
            if let Ok(updated) = apply_question_answers(&live.text, answers) {
                live.text = updated;
            }
        }

        let answered_text = live.text.clone();
        patch_answers_into_wire_lines(&mut live.lines, answers, &answered_text);

        Some((live.text.clone(), live.lines.clone()))
    }

    // Apply answers
    pub async fn apply_answers(
        &self,
        session_id: &str,
        message_id: &str,
        answers: &HashMap<String, Vec<String>>,
    ) -> Result<ChatSession> {
        // Before the stored message, not after. A turn still in flight flushes its buffers over the
        // stored message on its next persist tick and once more when it ends, so an answer written
        // only to the stored copy was reverted by that flush - the agent asked, you answered, and
        // the block came back unanswered a second later. V1 calls the two the other way round
        // (`ContentView.OnAnswerQuestion`: chat service, then execution service), which leaves a
        // window where a flush landing between them does exactly that.
        let live_snapshot = self.patch_live_turn(session_id, message_id, answers).await;

        let mut session = self.get_session(session_id).await?;
        let mut found = false;

        for msg in &mut session.messages {
            if msg.id == message_id {
                if let Some((text, lines)) = &live_snapshot {
                    // The turn is still writing this message and its buffer has just been patched,
                    // so take the buffer whole instead of patching the stored copy. The stored copy
                    // is only as recent as the last persist tick: patching it would answer a block
                    // as it looked a tick ago, drop whatever the agent has said since, and be
                    // overwritten by the next tick regardless.
                    msg.content = text.clone();
                    msg.raw_stream = Some(lines.join("\n"));
                } else {
                    msg.content = apply_question_answers(&msg.content, answers)?;
                    if let Some(ref raw) = msg.raw_stream {
                        let mut lines: Vec<String> = raw.split('\n').map(str::to_string).collect();
                        if patch_answers_into_wire_lines(&mut lines, answers, &msg.content) {
                            msg.raw_stream = Some(lines.join("\n"));
                        } else if let Ok(updated_raw) = apply_question_answers(raw, answers) {
                            // Nothing here is eventwire - a stream imported from V1, or one stored
                            // as plain prose. A fence spans lines, so it can only be found by
                            // reading the whole thing at once.
                            msg.raw_stream = Some(updated_raw);
                        }
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
}
