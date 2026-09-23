use super::get_client_from_master;
use crate::error::BridgeError;
use crate::models::{JobDetailDto, JobDto, StartJobResponseDto};
use crate::service::{job_events_bridge, MasterDiscovery};

#[tauri::command]
pub async fn cmd_list_jobs(
    status: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<JobDto>, BridgeError> {
    get_client_from_master()?
        .list_jobs(status.as_deref(), limit)
        .await
}

#[tauri::command]
pub async fn cmd_get_job(id: String) -> Result<JobDetailDto, BridgeError> {
    get_client_from_master()?.get_job(&id).await
}

#[tauri::command]
pub async fn cmd_start_job(args: serde_json::Value) -> Result<StartJobResponseDto, BridgeError> {
    get_client_from_master()?.start_job(args).await
}

#[tauri::command]
pub async fn cmd_cancel_job(id: String, message: Option<String>) -> Result<(), BridgeError> {
    get_client_from_master()?
        .cancel_job(&id, message.as_deref())
        .await
}

#[tauri::command]
pub async fn cmd_delete_job(id: String) -> Result<(), BridgeError> {
    get_client_from_master()?.delete_job(&id).await
}

#[tauri::command]
pub async fn cmd_force_start_job(id: String) -> Result<(), BridgeError> {
    get_client_from_master()?.force_start_job(&id).await
}

/// Bulk-clear finished jobs by scope, answering how many rows went.
///
/// `status` names the scope (`completed`, `failed`, `timeout`, `stopped`, `finished`) and is forwarded
/// as it arrives. The daemon is what decides which scopes are clearable — it filters to the terminal
/// statuses before reading a row, so no caller can clear a Running or Queued job — and it answers `400`
/// naming the acceptable scopes. That sentence is carried through rather than replaced, because it is
/// the whole content of the refusal.
#[tauri::command]
pub async fn cmd_clear_jobs(status: String) -> Result<usize, BridgeError> {
    get_client_from_master()?.clear_jobs(&status).await
}

/// Starts streaming a job's agent output, re-emitted as `job-stream-event`.
///
/// The stream is consumed natively — `invoke` cannot stream, and `/api/jobs/:id/events` is
/// bearer-authenticated with a secret the webview never sees, which is why reading it from the
/// webview only ever produced a 401. The caller should already be listening: a job that has been
/// running for a while has a backlog, and the daemon sends it immediately.
///
/// `since_line` is the log line to resume from, so a remounted view is not sent the run it already
/// has. Errors here are real: a refused credential or a missing daemon reaches the webview instead of
/// leaving a view waiting on frames that will never come.
#[tauri::command]
pub async fn cmd_subscribe_job_events(
    app_handle: tauri::AppHandle,
    job_id: String,
    kinds: Option<String>,
    since_line: Option<usize>,
) -> Result<(), BridgeError> {
    job_events_bridge::subscribe(
        app_handle,
        MasterDiscovery::new(),
        job_id,
        kinds,
        since_line,
    )
    .await
}

/// Stops streaming a job's output. Returns whether a stream was running, so a view that unmounts
/// after the job already ended is not an error.
#[tauri::command]
pub async fn cmd_unsubscribe_job_events(job_id: String) -> Result<bool, BridgeError> {
    Ok(job_events_bridge::unsubscribe(&job_id))
}

/// V1's Rerun (`Apps/Jobs/Dialogs/RerunJobDialog.cs`): deletes a finished job and starts it again
/// from its original args, with the operator's optional feedback folded in. The daemon does the
/// work (`POST /api/jobs/:id/rerun`) because the args, and the plan folder a `CreatePlan` now has,
/// are its to read.
#[tauri::command]
pub async fn cmd_rerun_job(
    id: String,
    feedback: Option<String>,
) -> Result<StartJobResponseDto, BridgeError> {
    let feedback = feedback
        .as_deref()
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .map(str::to_string);
    get_client_from_master()?
        .rerun_job(&id, feedback.as_deref())
        .await
}

/// V1's Report Bug (`Apps/Jobs/Dialogs/ReportBugDialog.cs` over `BugReportService`): bundles the
/// job's logs, its plan and a sanitized config, uploads them as a **public** GitHub issue, and
/// answers the issue's URL.
///
/// Not reimplemented here: `tendril report-bug` already is V1's `BugReportService` - the same
/// collection, the same redaction and the same upload - and a second copy of the redaction is the
/// one thing a bug reporter must never have. So this runs the CLI the app ships with
/// (`<home>/bin`, else the bundled sidecar) with `--submit --yes`; the dialog is the confirmation
/// `--yes` stands for, since it says what is uploaded and where.
#[tauri::command]
pub async fn cmd_report_job_bug(
    id: String,
    description: String,
    github_user: Option<String>,
) -> Result<String, BridgeError> {
    use crate::daemon::resolve_tendril_home;
    use crate::service::provision::{sidecar_dir, CLI_BINARY};

    let description = description.trim().to_string();
    if description.is_empty() {
        return Err(BridgeError::new(
            "INVALID_INPUT",
            "A bug report needs a description",
        ));
    }

    let home = resolve_tendril_home();
    let binary = [Some(home.join("bin")), sidecar_dir()]
        .into_iter()
        .flatten()
        .map(|dir| dir.join(CLI_BINARY))
        .find(|path| path.is_file())
        .ok_or_else(|| {
            BridgeError::new(
                "NOT_FOUND",
                format!(
                    "The Tendril CLI ({CLI_BINARY}) was not found, so the report cannot be sent"
                ),
            )
        })?;

    // Written to a temp file and removed afterwards: the CLI's default is a zip in the Tendril home,
    // which is right for `report-bug` run by hand and clutter for one sent from the app.
    let out = std::env::temp_dir().join(format!(
        "tendril-bug-report-{}.zip",
        chrono::Utc::now().format("%Y%m%d%H%M%S%3f")
    ));

    let mut cmd = tokio::process::Command::new(&binary);
    cmd.arg("report-bug")
        .args(["--job", &id])
        .args(["--description", &description])
        .arg("--out")
        .arg(&out)
        .args(["--submit", "--yes"])
        .env("TENDRIL_HOME", &home);
    if let Some(user) = github_user
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        cmd.args(["--github-user", user]);
    }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: a console flashing up behind the app is not part of sending a report.
        cmd.creation_flags(0x0800_0000);
    }

    let output = cmd.output().await.map_err(|e| {
        BridgeError::with_details(
            "IO_ERROR",
            format!("Failed to run the Tendril CLI: {e}"),
            e.to_string(),
        )
    });
    let _ = std::fs::remove_file(&out);
    let output = output?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let reason = stderr
            .lines()
            .chain(stdout.lines())
            .map(str::trim)
            .rfind(|line| !line.is_empty())
            .unwrap_or("the CLI exited without saying why")
            .to_string();
        return Err(BridgeError::new(
            "REPORT_BUG_FAILED",
            format!("Failed to submit bug report: {reason}"),
        ));
    }

    // The CLI's last line on success is the issue URL.
    stdout
        .lines()
        .map(str::trim)
        .rfind(|line| line.starts_with("http://") || line.starts_with("https://"))
        .map(str::to_string)
        .ok_or_else(|| {
            BridgeError::new(
                "REPORT_BUG_FAILED",
                "The bug report was sent but no issue URL came back",
            )
        })
}
