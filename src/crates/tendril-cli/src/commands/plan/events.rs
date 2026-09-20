//! Reporting a plan edit back to the other chat sessions watching the plan, and the database
//! re-projection every YAML edit needs afterwards.
//!
//! Every mutating subcommand ends by telling the daemon what it just did, so a second agent on the
//! same plan learns about the edit rather than discovering it. All of that goes through this one
//! module: the notification is best-effort by design — a plan edit is not rolled back because the
//! daemon is offline — so the "warning, could not report" wording lives in exactly one place.

use super::cli::PlanEditReasonArgs;
use tendril_core::config::read_master;
use tendril_core::db::{open_database, sync_plan};
use tendril_core::http::daemon_client;
use tendril_core::plans::read_plan_file;

pub fn resolve_source_chat_session(chat_session: Option<&str>) -> Option<String> {
    // An explicit empty `--chat-session ""` falls through to the environment rather than counting as
    // "no session", which is why the argument is filtered before it is offered.
    tendril_core::mcp::dispatch::resolve_chat_session_id(
        chat_session.map(str::trim).filter(|s| !s.is_empty()),
    )
}

/// The plan edit to report to the plan's other chat sessions. `event_kind` defaults to `edit`;
/// `pr-created` routes the notification to the server's PR announcer instead, and requires `pr_url`.
#[derive(Default)]
pub(super) struct PlanEditEvent<'a> {
    pub(super) summary: &'a str,
    pub(super) reason: Option<&'a str>,
    pub(super) source_chat_session_id: Option<&'a str>,
    pub(super) revision_file: Option<&'a str>,
    pub(super) event_kind: Option<&'a str>,
    pub(super) pr_url: Option<&'a str>,
}

pub(super) async fn report_plan_edit_event(
    tendril_home: &std::path::Path,
    plan_id: &str,
    event: PlanEditEvent<'_>,
) {
    let PlanEditEvent {
        summary,
        reason,
        source_chat_session_id,
        revision_file,
        event_kind,
        pr_url,
    } = event;
    let master = match read_master(tendril_home) {
        Some(m) => m,
        None => {
            eprintln!(
                "Warning: could not report the edit to plan {}: server is offline",
                plan_id
            );
            return;
        }
    };

    let client = daemon_client(tendril_home);
    let url = format!("{}/api/plans/{}/events", master.base_url(), plan_id);

    let payload = serde_json::json!({
        "summary": summary,
        "reason": reason,
        "sourceChatSessionId": source_chat_session_id,
        "revisionFile": revision_file,
        "eventKind": event_kind,
        "prUrl": pr_url,
    });

    match client
        .post(&url)
        .bearer_auth(&master.secret)
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                eprintln!(
                    "Warning: could not report the edit to plan {}: status {} - {}",
                    plan_id, status, text
                );
            }
        }
        Err(e) => {
            eprintln!(
                "Warning: could not report the edit to plan {}: {}",
                plan_id, e
            );
        }
    }
}

/// Projects a plan folder into the database after a YAML edit, best-effort.
///
/// The recommendation subcommands did none of this before, which is why a CLI edit could leave the
/// `Recommendations` table behind while the server's own routes kept it current.
pub(super) fn sync_plan_folder(folder: &std::path::Path, db_path: &std::path::Path) {
    if let Ok(pf) = read_plan_file(folder) {
        if let Ok(conn) = open_database(db_path) {
            let _ = sync_plan(&conn, &pf);
        }
    }
}

/// Reports a plan edit to the other chat sessions watching the plan, the same way
/// `plan set` and `plan set-verification` report theirs.
pub(super) async fn report_edit_with_reason(
    tendril_home: &std::path::Path,
    plan_id: &str,
    summary: &str,
    edit: &PlanEditReasonArgs,
) {
    let source_chat = resolve_source_chat_session(edit.chat_session.as_deref());
    report_plan_edit_event(
        tendril_home,
        plan_id,
        PlanEditEvent {
            summary,
            reason: edit.reason.as_deref(),
            source_chat_session_id: source_chat.as_deref(),
            ..Default::default()
        },
    )
    .await;
}
