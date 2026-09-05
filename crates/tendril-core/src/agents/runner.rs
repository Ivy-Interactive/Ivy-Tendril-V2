use crate::agents::providers::AgentProcessSpec;
use crate::error::{Result, TendrilError};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

pub struct AgentOutputEvent {
    pub raw_line: String,
    pub is_stderr: bool,
}

pub async fn run_agent_process<F>(spec: AgentProcessSpec, mut on_output_line: F) -> Result<i32>
where
    F: FnMut(AgentOutputEvent) + Send + 'static,
{
    let temp_files = spec.temp_files.clone();
    let res = run_agent_process_inner(spec, &mut on_output_line).await;

    // Clean up temporary files on exit
    for file in temp_files {
        let _ = std::fs::remove_file(file);
    }

    res
}

async fn run_agent_process_inner<F>(spec: AgentProcessSpec, on_output_line: &mut F) -> Result<i32>
where
    F: FnMut(AgentOutputEvent) + Send + 'static,
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

    let mut child = cmd.spawn().map_err(|e| {
        TendrilError::Agent(format!("Failed to spawn agent '{}': {}", spec.command, e))
    })?;

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

    while let Some(evt) = rx.recv().await {
        on_output_line(evt);
    }

    let status = child
        .wait()
        .await
        .map_err(|e| TendrilError::Agent(format!("Error waiting for agent child: {}", e)))?;

    Ok(status.code().unwrap_or(-1))
}
