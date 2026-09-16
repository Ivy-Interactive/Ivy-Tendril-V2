use crate::agents::providers::AgentProcessSpec;
use crate::error::{Result, TendrilError};
use crate::jobs::process_tree::{kill_tree, DEFAULT_KILL_GRACE};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::watch;

pub struct AgentOutputEvent {
    pub raw_line: String,
    pub is_stderr: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalResultOutcome {
    pub is_success: bool,
    pub exit_code: Option<i32>,
}

/// Why an agent process stopped. Callers need to tell these apart rather than infer them from an
/// exit code: a killed agent and an agent that failed on its own mean different things for the plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminationReason {
    /// The process ran to completion on its own.
    Exited,
    /// The cancel signal fired and the process tree was killed.
    Cancelled,
    /// The job timeout elapsed and the process tree was killed.
    TimedOut,
    /// The agent emitted a terminal result event but did not exit within the grace period.
    PostResultGraceExceeded,
}

#[derive(Debug, Clone)]
pub struct AgentRunOutcome {
    /// `None` when the process was killed, or died from a signal without reporting a code.
    pub exit_code: Option<i32>,
    pub terminated: TerminationReason,
    pub result_outcome: Option<TerminalResultOutcome>,
}

/// How long to wait for output draining and reaping after a kill, so a wedged pipe cannot hang the
/// completion path.
const POST_KILL_TIMEOUT: Duration = Duration::from_secs(5);

/// Default grace period granted to an agent process after emitting a terminal result event.
pub const DEFAULT_POST_RESULT_GRACE: Duration = Duration::from_secs(20);

/// Runs an agent process, streaming its output line by line.
///
/// `on_spawn` receives the child's PID as soon as it exists, so the caller can publish a handle for
/// cancellation before any output arrives. The run ends on whichever of these happens first: the
/// process exits, `cancel` turns true, or `timeout` elapses: the last two kill the whole process
/// tree.
pub async fn run_agent_process<F, S>(
    spec: AgentProcessSpec,
    on_output_line: F,
    on_spawn: S,
    cancel: watch::Receiver<bool>,
    timeout: Option<Duration>,
) -> Result<AgentRunOutcome>
where
    F: FnMut(AgentOutputEvent) + Send + 'static,
    S: FnOnce(u32),
{
    run_agent_process_with_grace(
        spec,
        on_output_line,
        on_spawn,
        cancel,
        timeout,
        DEFAULT_POST_RESULT_GRACE,
    )
    .await
}

/// Runs an agent process with a custom post-result grace period.
pub async fn run_agent_process_with_grace<F, S>(
    spec: AgentProcessSpec,
    on_output_line: F,
    on_spawn: S,
    cancel: watch::Receiver<bool>,
    timeout: Option<Duration>,
    post_result_grace: Duration,
) -> Result<AgentRunOutcome>
where
    F: FnMut(AgentOutputEvent) + Send + 'static,
    S: FnOnce(u32),
{
    let temp_files = spec.temp_files.clone();
    let res = run_agent_process_inner(
        spec,
        on_output_line,
        on_spawn,
        cancel,
        timeout,
        post_result_grace,
    )
    .await;

    // Clean up temporary files on exit
    for file in temp_files {
        let _ = std::fs::remove_file(file);
    }

    res
}

async fn run_agent_process_inner<F, S>(
    spec: AgentProcessSpec,
    on_output_line: F,
    on_spawn: S,
    mut cancel: watch::Receiver<bool>,
    timeout: Option<Duration>,
    post_result_grace: Duration,
) -> Result<AgentRunOutcome>
where
    F: FnMut(AgentOutputEvent) + Send + 'static,
    S: FnOnce(u32),
{
    let mut cmd = Command::new(&spec.command);
    cmd.args(&spec.args)
        .current_dir(&spec.working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if spec.redirect_stdin {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }

    for (k, v) in &spec.environment {
        cmd.env(k, v);
    }

    // Give the agent its own process group so cancellation can signal the whole tree, not just the
    // process we spawned. Windows has no equivalent; `taskkill /T` walks the tree instead.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.as_std_mut().process_group(0);
    }

    let mut child = cmd.spawn().map_err(|e| {
        TendrilError::Agent(format!("Failed to spawn agent '{}': {}", spec.command, e))
    })?;

    let pid = child.id().unwrap_or(0);
    on_spawn(pid);

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    if let (Some(mut stdin_pipe), Some(content)) = (stdin, spec.stdin_content) {
        tokio::spawn(async move {
            let _ = stdin_pipe.write_all(content.as_bytes()).await;
            let _ = stdin_pipe.flush().await;
            drop(stdin_pipe);
        });
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentOutputEvent>(100);

    if let Some(stdout) = stdout {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx
                    .send(AgentOutputEvent {
                        raw_line: line,
                        is_stderr: false,
                    })
                    .await;
            }
        });
    }

    if let Some(stderr) = stderr {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx
                    .send(AgentOutputEvent {
                        raw_line: line,
                        is_stderr: true,
                    })
                    .await;
            }
        });
    }

    drop(tx);

    let (terminal_result_tx, mut terminal_result_rx) =
        tokio::sync::mpsc::channel::<TerminalResultOutcome>(10);

    let drain = tokio::spawn(async move {
        let mut on_output_line = on_output_line;
        while let Some(evt) = rx.recv().await {
            if let Some(outcome) = parse_terminal_result_event(&evt.raw_line) {
                let _ = terminal_result_tx.try_send(outcome);
            }
            on_output_line(evt);
        }
    });

    let deadline = async {
        match timeout {
            Some(d) => tokio::time::sleep(d).await,
            None => std::future::pending::<()>().await,
        }
    };
    tokio::pin!(deadline);

    let mut terminal_result: Option<TerminalResultOutcome> = None;
    let mut grace_timer: Option<std::pin::Pin<Box<tokio::time::Sleep>>> = None;

    let outcome = loop {
        tokio::select! {
            status = child.wait() => {
                let code = status
                    .map_err(|e| TendrilError::Agent(format!("Error waiting for agent child: {}", e)))?
                    .code();
                let _ = tokio::task::spawn_blocking(move || kill_tree(pid, DEFAULT_KILL_GRACE)).await;
                break AgentRunOutcome {
                    exit_code: code,
                    terminated: TerminationReason::Exited,
                    result_outcome: terminal_result,
                };
            }
            // `wait_for` rather than `changed`, so a cancel that arrived before this select is observed.
            // The borrow guard it yields is dropped inside the block: holding it across the kill below
            // would make this future non-`Send`.
            _ = async {
                // A dropped sender is not a cancellation: park forever instead of killing the agent.
                if cancel.wait_for(|c| *c).await.is_err() {
                    std::future::pending::<()>().await;
                }
            } => {
                reap_killed(pid, &mut child).await;
                break AgentRunOutcome {
                    exit_code: None,
                    terminated: TerminationReason::Cancelled,
                    result_outcome: terminal_result,
                };
            }
            _ = &mut deadline => {
                reap_killed(pid, &mut child).await;
                if let Some(ref tr) = terminal_result {
                    let code = if tr.is_success {
                        tr.exit_code.unwrap_or(0)
                    } else {
                        tr.exit_code.unwrap_or(1)
                    };
                    break AgentRunOutcome {
                        exit_code: Some(code),
                        terminated: TerminationReason::PostResultGraceExceeded,
                        result_outcome: terminal_result,
                    };
                } else {
                    break AgentRunOutcome {
                        exit_code: None,
                        terminated: TerminationReason::TimedOut,
                        result_outcome: None,
                    };
                }
            }
            _ = async {
                match &mut grace_timer {
                    Some(timer) => timer.as_mut().await,
                    None => std::future::pending::<()>().await,
                }
            }, if grace_timer.is_some() => {
                reap_killed(pid, &mut child).await;
                let code = if let Some(ref tr) = terminal_result {
                    if tr.is_success {
                        tr.exit_code.unwrap_or(0)
                    } else {
                        tr.exit_code.unwrap_or(1)
                    }
                } else {
                    0
                };
                break AgentRunOutcome {
                    exit_code: Some(code),
                    terminated: TerminationReason::PostResultGraceExceeded,
                    result_outcome: terminal_result,
                };
            }
            Some(outcome) = terminal_result_rx.recv(), if grace_timer.is_none() => {
                terminal_result = Some(outcome);
                grace_timer = Some(Box::pin(tokio::time::sleep(post_result_grace)));
            }
        }
    };

    // Flush whatever the agent already wrote. The senders close when the pipes do, so this ends on
    // its own; the timeout is only a guard against a pipe held open by a surviving process.
    let _ = tokio::time::timeout(POST_KILL_TIMEOUT, drain).await;

    Ok(outcome)
}

async fn reap_killed(pid: u32, child: &mut tokio::process::Child) {
    let _ = tokio::task::spawn_blocking(move || kill_tree(pid, DEFAULT_KILL_GRACE)).await;
    let _ = tokio::time::timeout(POST_KILL_TIMEOUT, child.wait()).await;
}

pub fn parse_terminal_result_event(line: &str) -> Option<TerminalResultOutcome> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let is_result = v.get("kind").and_then(|k| k.as_str()) == Some("result")
        || v.get("type").and_then(|t| t.as_str()) == Some("result")
        || v.get("type").and_then(|t| t.as_str()) == Some("turn.completed");

    // Antigravity nests its terminal event: `{"event":"result","result":{"status":"SUCCESS",…}}`.
    // Without this its runs had no terminal result at all, so the post-result grace period never
    // started and a turn's success was inferred from the exit code alone.
    if !is_result {
        if v.get("event").and_then(|e| e.as_str()) == Some("result") {
            let result = v.get("result")?;
            let status = result
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("SUCCESS");
            let has_response = result
                .get("response")
                .and_then(|r| r.as_str())
                .is_some_and(|r| !r.trim().is_empty());
            // A recovered mid-turn tool error is reported as `ERROR` on a turn that did answer, so a
            // response outranks the status — the same rule `AntigravityEventParser.ParseResult` uses.
            let is_success = !status.eq_ignore_ascii_case("ERROR") || has_response;
            return Some(TerminalResultOutcome {
                is_success,
                exit_code: None,
            });
        }
        return None;
    }

    let is_error = v
        .get("is_error")
        .or_else(|| v.get("isError"))
        .and_then(|b| b.as_bool())
        .unwrap_or(false);

    let has_error =
        v.get("error").is_some() && !v.get("error").map(|e| e.is_null()).unwrap_or(false);

    let explicit_success = v
        .get("is_success")
        .or_else(|| v.get("isSuccess"))
        .and_then(|b| b.as_bool());

    let is_success = match explicit_success {
        Some(s) => s,
        None => !is_error && !has_error,
    };

    let exit_code = v
        .get("exit_code")
        .or_else(|| v.get("exitCode"))
        .and_then(|c| c.as_i64())
        .map(|c| c as i32);

    Some(TerminalResultOutcome {
        is_success,
        exit_code,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_terminal_result_event_variants() {
        let line1 = r#"{"kind":"result","usage":{"input_tokens":100}}"#;
        let res1 = parse_terminal_result_event(line1).expect("parse line1");
        assert!(res1.is_success);
        assert_eq!(res1.exit_code, None);

        let line2 = r#"{"type":"result","is_success":true,"exit_code":0}"#;
        let res2 = parse_terminal_result_event(line2).expect("parse line2");
        assert!(res2.is_success);
        assert_eq!(res2.exit_code, Some(0));

        let line3 = r#"{"type":"turn.completed"}"#;
        let res3 = parse_terminal_result_event(line3).expect("parse line3");
        assert!(res3.is_success);
        assert_eq!(res3.exit_code, None);

        let line4 = r#"{"type":"result","is_error":true,"exitCode":2}"#;
        let res4 = parse_terminal_result_event(line4).expect("parse line4");
        assert!(!res4.is_success);
        assert_eq!(res4.exit_code, Some(2));

        let line5 = r#"{"type":"result","error":"fatal error"}"#;
        let res5 = parse_terminal_result_event(line5).expect("parse line5");
        assert!(!res5.is_success);
        assert_eq!(res5.exit_code, None);

        // Antigravity's nested shape, captured from a real `agy` run.
        let agy_ok = r#"{"event":"result","result":{"status":"SUCCESS","response":"Yes, I'm alive","duration_seconds":3.88,"num_turns":1}}"#;
        let res_agy = parse_terminal_result_event(agy_ok).expect("parse antigravity result");
        assert!(res_agy.is_success);
        let agy_err = r#"{"event":"result","result":{"status":"ERROR","error":"tool loop"}}"#;
        assert!(
            !parse_terminal_result_event(agy_err)
                .expect("parse antigravity error")
                .is_success
        );
        // An `ERROR` status on a turn that answered is a recovered mid-turn tool failure.
        let agy_recovered =
            r#"{"event":"result","result":{"status":"ERROR","error":"x","response":"here"}}"#;
        assert!(
            parse_terminal_result_event(agy_recovered)
                .expect("parse recovered")
                .is_success
        );
        // Antigravity's other events are not terminal.
        assert_eq!(
            parse_terminal_result_event(r#"{"event":"step_update","step_update":{}}"#),
            None
        );

        let non_result = r#"{"type":"text","text":"hello"}"#;
        assert_eq!(parse_terminal_result_event(non_result), None);

        let invalid = "not a json string";
        assert_eq!(parse_terminal_result_event(invalid), None);
    }
}
