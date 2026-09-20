//! Why a turn's agent process stopped, and what the finished message therefore says.

use crate::agents::runner::{AgentRunOutcome, TerminationReason};
use crate::error::Result;

/// How many trailing stderr lines a turn keeps to explain a failure with.
pub(super) const STDERR_TAIL_LINES: usize = 5;

/// Why a turn's agent process stopped, in the terms the finished message needs.
///
/// V1 reads the same three things off `AgentRunResult` (`Response`, `IsSuccess`, `Error`) before it
/// decides what to persist; the stderr tail is added because a CLI that refuses to start writes its
/// reason there and nowhere else.
#[derive(Debug, Default)]
pub(super) struct TurnOutcome {
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
    pub(super) fn from_run(
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
    pub(super) fn synthetic_tool_output(&self) -> &'static str {
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
pub(super) fn compose_turn_content(
    text: &str,
    raw_lines: &[String],
    outcome: &TurnOutcome,
) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
