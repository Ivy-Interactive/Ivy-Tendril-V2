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
}

#[derive(Debug, Clone)]
pub struct AgentRunOutcome {
    /// `None` when the process was killed, or died from a signal without reporting a code.
    pub exit_code: Option<i32>,
    pub terminated: TerminationReason,
}

/// How long to wait for output draining and reaping after a kill, so a wedged pipe cannot hang the
/// completion path.
const POST_KILL_TIMEOUT: Duration = Duration::from_secs(5);

/// Runs an agent process, streaming its output line by line.
///
/// `on_spawn` receives the child's PID as soon as it exists, so the caller can publish a handle for
/// cancellation before any output arrives. The run ends on whichever of these happens first: the
/// process exits, `cancel` turns true, or `timeout` elapses — the last two kill the whole process
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
    let temp_files = spec.temp_files.clone();
    let res = run_agent_process_inner(spec, on_output_line, on_spawn, cancel, timeout).await;

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

    let drain = tokio::spawn(async move {
        let mut on_output_line = on_output_line;
        while let Some(evt) = rx.recv().await {
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

    let outcome = tokio::select! {
        status = child.wait() => {
            let code = status
                .map_err(|e| TendrilError::Agent(format!("Error waiting for agent child: {}", e)))?
                .code();
            AgentRunOutcome { exit_code: code, terminated: TerminationReason::Exited }
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
            AgentRunOutcome { exit_code: None, terminated: TerminationReason::Cancelled }
        }
        _ = &mut deadline => {
            reap_killed(pid, &mut child).await;
            AgentRunOutcome { exit_code: None, terminated: TerminationReason::TimedOut }
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
