//! The turn loop: building the launch, streaming the agent's output into the live buffers, flushing
//! them over the stored message, and dequeuing whatever was queued behind the turn.

use super::events::ChatEvent;
use super::manager::{ChatExecutionManager, ChatTurnOptions, LiveTurn};
use super::outcome::{compose_turn_content, TurnOutcome, STDERR_TAIL_LINES};
use super::prompt::{build_chat_agent_prompt, is_event_role};
use super::streaming::next_text_delta;
use super::titles::is_default_chat_title;
use crate::agents::eventwire::EventWireNormalizer;
use crate::agents::providers::AgentLaunchConfig;
use crate::agents::reconcile::build_missing_result_lines;
use crate::agents::runner::{run_agent_process, AgentOutputEvent};
use crate::chat::models::ChatMessage;
use crate::chat::storage::{sanitize_title, save_session};
use crate::error::{Result, TendrilError};
use chrono::Utc;
use regex::Regex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

impl ChatExecutionManager {
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
        let model_to_use_for_runner = model_to_use.clone();
        let mgr = Arc::clone(self);
        let s_id = session_id.to_string();
        let persist_interval = self.persist_interval;
        let initial_prompt = user_prompt.to_string();
        let initial_assistant_msg_id = assistant_msg_id.clone();

        // Spawn async runner task
        tokio::spawn(async move {
            let mut current_prompt = initial_prompt;
            let current_model = model_to_use_for_runner;
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

                // Shared rather than task-local so `apply_answers` can reach them: an answer to a
                // question the agent asked mid-turn has to land in the buffers the flushes below
                // are composed from, or the next flush writes the unanswered block back over it.
                let live = Arc::new(Mutex::new(LiveTurn {
                    message_id: current_assistant_msg_id.clone(),
                    text: String::new(),
                    lines: Vec::new(),
                }));
                mgr.live_turns
                    .lock()
                    .await
                    .insert(s_id.clone(), Arc::clone(&live));

                let mut stderr_tail: Vec<String> = Vec::new();
                // One per run: Antigravity identifies a tool step by `step_index`, so tying its
                // `ACTIVE` and `DONE` halves together is state that lives for the length of the turn.
                let mut normalizer = EventWireNormalizer::new();
                normalizer.remember_model(Some(&current_model));
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
                                    //
                                    // Locked once for the whole batch: an answer arriving mid-batch
                                    // would otherwise see half of one provider line applied.
                                    let wire_lines = normalizer.normalize(&evt.raw_line, evt.is_stderr);
                                    let mut buf = live.lock().await;
                                    for wire_line in wire_lines {
                                        buf.lines.push(wire_line.clone());
                                        is_dirty = true;

                                        // Published per event so tool calls appear *while* the turn
                                        // runs, as V1's `StreamLineEmitted` does. Without this the
                                        // activity only existed on the message re-read at the end.
                                        let _ = mgr.event_tx.send(ChatEvent::StreamEvent {
                                            session_id: s_id.clone(),
                                            message_id: current_assistant_msg_id.clone(),
                                            line: wire_line.clone(),
                                        });

                                        if let Some(delta) = next_text_delta(&buf.text, &wire_line)
                                        {
                                            buf.text.push_str(&delta);
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
                                // Held across the write, not just the read: an answer that patched
                                // the buffer and saved the stored message in between would be
                                // undone by a snapshot taken before it. Nothing waits on this but
                                // `apply_answers` - the reader loop is this same task - so the cost
                                // is that a submission waits out one session save.
                                let buf = live.lock().await;
                                mgr.persist_in_flight_message(
                                    &s_id,
                                    &current_assistant_msg_id,
                                    &buf.text,
                                    &buf.lines,
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

                // The turn is over, so its buffer stops being live. The lock is held across the
                // whole handover - deregister, snapshot, write - because this is the one flush an
                // answer cannot be re-applied after: a patch that read the buffer just before the
                // snapshot and saved the stored message just after it would be overwritten here and
                // have nothing left to correct it. Blocked on the lock, that patch instead runs
                // afterwards, finds no live turn, and writes the answer into the final message.
                {
                    let buf = live.lock().await;
                    mgr.live_turns.lock().await.remove(&s_id);

                    let mut raw_stream_lines = buf.lines.clone();
                    raw_stream_lines.extend(build_missing_result_lines(
                        &raw_stream_lines,
                        outcome.synthetic_tool_output(),
                        true,
                    ));

                    let has_result = raw_stream_lines.iter().any(|line| {
                        serde_json::from_str::<serde_json::Value>(line.trim())
                            .ok()
                            .and_then(|v| {
                                v.get("kind")
                                    .and_then(|k| k.as_str())
                                    .map(|k| k == "result")
                            })
                            .unwrap_or(false)
                    });

                    if !has_result {
                        let estimated_tokens = (buf.text.len() as f64 / 4.0).round() as i64;
                        let (estimated_cost, cost_source) = if current_model == "apple/system" {
                            (0.0, "agent")
                        } else if let Some(spec) = crate::agents::model_specs::find(&current_model)
                        {
                            if crate::agents::model_specs::is_priced(&spec) {
                                (spec.calculate_cost(0, estimated_tokens, 0, 0), "estimated")
                            } else {
                                (0.0, "agent")
                            }
                        } else {
                            (
                                crate::agents::pricing::calculate_cost(
                                    &current_model,
                                    0,
                                    estimated_tokens,
                                    0,
                                    0,
                                ),
                                "estimated",
                            )
                        };

                        let synthetic_result = serde_json::json!({
                            "kind": "result",
                            "timestamp": Utc::now().to_rfc3339(),
                            "is_success": outcome.is_success(),
                            "usage": {
                                "input_tokens": 0,
                                "output_tokens": estimated_tokens,
                                "cache_read_tokens": 0,
                                "cache_write_tokens": 0,
                                "reasoning_tokens": 0,
                                "cost_usd": estimated_cost,
                                "cost_source": cost_source,
                                "model": current_model,
                            }
                        });
                        let synthetic_line = synthetic_result.to_string();
                        raw_stream_lines.push(synthetic_line.clone());
                        let _ = mgr.event_tx.send(ChatEvent::StreamEvent {
                            session_id: s_id.clone(),
                            message_id: current_assistant_msg_id.clone(),
                            line: synthetic_line,
                        });
                    }

                    // Final message update & persistence
                    mgr.finalize_message(
                        &s_id,
                        &current_assistant_msg_id,
                        buf.text.clone(),
                        raw_stream_lines,
                        &outcome,
                    )
                    .await;
                }

                // Clean up active cancellation
                mgr.active_cancellations.lock().await.remove(&s_id);

                // Check if there are queued messages to dequeue
                if let Some(next_item) = mgr.dequeue_message(&s_id).await {
                    current_prompt = next_item.prompt;
                    // Almost always the user's, but not necessarily: a job that finished while this turn
                    // was running is queued behind it as a `system` item, and replaying that as a user
                    // prompt is what made the agent answer the event rather than react to it.
                    current_role = next_item.role.unwrap_or_else(|| "user".to_string());
                    let next_a_id = Uuid::new_v4().to_string();
                    current_assistant_msg_id = next_a_id.clone();
                    let now = Utc::now();
                    let next_user_msg = ChatMessage {
                        id: Uuid::new_v4().to_string(),
                        role: current_role.clone(),
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
