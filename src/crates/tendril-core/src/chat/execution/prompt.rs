//! The prompt one chat turn hands the agent, and the spawned-job block that opens it.

use crate::chat::models::ChatMessage;

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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use uuid::Uuid;

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
