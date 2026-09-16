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
