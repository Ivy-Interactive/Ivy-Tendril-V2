use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use crate::agents::providers::AgentProcessSpec;
use crate::error::{Result, TendrilError};

pub struct AgentOutputEvent {
    pub raw_line: String,
    pub is_stderr: bool,
}

pub async fn run_agent_process<F>(
    spec: AgentProcessSpec,
    mut on_output_line: F,
) -> Result<i32>
where
    F: FnMut(AgentOutputEvent) + Send + 'static,
{
    let mut cmd = Command::new(&spec.command);
    cmd.args(&spec.args)
        .current_dir(&spec.working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (k, v) in &spec.environment {
        cmd.env(k, v);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| TendrilError::Agent(format!("Failed to spawn agent '{}': {}", spec.command, e)))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentOutputEvent>(100);

    if let Some(stdout) = stdout {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx.send(AgentOutputEvent { raw_line: line, is_stderr: false }).await;
            }
        });
    }

    if let Some(stderr) = stderr {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = tx.send(AgentOutputEvent { raw_line: line, is_stderr: true }).await;
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
