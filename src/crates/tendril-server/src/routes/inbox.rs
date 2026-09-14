use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::load_config;
use tendril_core::db::{get_proposal, list_proposals, open_database, set_proposal_state};
use tendril_core::error::TendrilError;
use tendril_core::inbox::{
    accept_proposal, run_assigned_issues_sweep, ProposalState, SweepOutcome,
};
use tendril_core::models::{CreatePlanArgs, JobArgs};

#[derive(Debug, Deserialize)]
pub struct CreatePlanRequest {
    pub description: String,
    pub project: Option<String>,
    #[serde(rename = "sourcePath")]
    pub source_path: Option<String>,
    /// "Yes, create another plan for this same description." Without it, resubmitting an identical
    /// body is a 409 naming the `CreatePlan` job already in flight, not a second plan. It also feeds
    /// the `Force` firmware header, which is what makes the promptware skip its own plan-level
    /// duplicate detection.
    #[serde(default)]
    pub force: bool,
}

pub async fn post_inbox(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePlanRequest>,
) -> impl IntoResponse {
    if req.description.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Description is required" })),
        );
    }

    let project = req.project.unwrap_or_else(|| "Auto".to_string());
    let args = JobArgs::CreatePlan(CreatePlanArgs {
        description: req.description,
        project,
        priority: 0,
        force: req.force,
        source_path: req.source_path,
        upload_session_id: None,
    });

    match state.job_manager.start_job(args).await {
        Ok(job_id) => (
            StatusCode::OK,
            Json(json!({
                "jobId": job_id,
                "status": "Started",
                "message": "Plan creation job started successfully"
            })),
        ),
        // The same description already being planned is a repeat submission, not a server fault.
        Err(TendrilError::DuplicateJob(msg)) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": msg, "status": "Conflict" })),
        ),
        Err(TendrilError::Conflict(msg)) => (
            StatusCode::CONFLICT,
            Json(json!({ "error": msg, "status": "Conflict" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to start plan creation: {}", e) })),
        ),
    }
}

/// Forces an assigned-issue sweep now, the equivalent of the original's `TriggerManualCheckAsync`.
///
/// A sweep already in flight is not an error — it answers `200` with `outcome: "AlreadyRunning"`,
/// because the caller's intent (a sweep is happening) is satisfied either way. Not being the master
/// *is* a `409`: this daemon cannot do the work and the user should be told rather than shown an
/// empty report.
pub async fn post_inbox_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    let report =
        run_assigned_issues_sweep(&state.tendril_home, &settings, &state.job_manager).await;

    let status = match report.outcome {
        SweepOutcome::NotMaster => StatusCode::CONFLICT,
        SweepOutcome::Ran | SweepOutcome::AlreadyRunning => StatusCode::OK,
    };
    (
        status,
        Json(serde_json::to_value(&report).unwrap_or_default()),
    )
}

#[derive(Debug, Deserialize)]
pub struct ListProposalsQuery {
    pub state: Option<String>,
}

/// Swept issues awaiting a decision. Defaults to `Pending`, which is what the UI panel wants;
/// `?state=all` returns every state for anyone auditing what the importer has seen.
pub async fn list_proposals_handler(
    State(state): State<Arc<AppState>>,
    Query(query): Query<ListProposalsQuery>,
) -> impl IntoResponse {
    let filter = match query.state.as_deref().map(str::trim) {
        None | Some("") => Some(ProposalState::Pending),
        Some(s) if s.eq_ignore_ascii_case("all") => None,
        Some(s) => match ProposalState::from_str_loose(s) {
            Some(parsed) => Some(parsed),
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": format!("Unknown proposal state '{}'", s) })),
                )
            }
        },
    };

    let conn = match open_database(&state.db_path) {
        Ok(conn) => conn,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to open database: {}", e) })),
            )
        }
    };

    match list_proposals(&conn, filter) {
        Ok(proposals) => (
            StatusCode::OK,
            Json(serde_json::to_value(&proposals).unwrap_or_default()),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to list inbox proposals: {}", e) })),
        ),
    }
}

/// Turns a pending proposal into a `CreatePlan` job. Goes through the same
/// [`accept_proposal`] the sweep's auto-accept branch uses, so a hand-accepted issue produces
/// exactly the job an auto-accepted one would.
pub async fn accept_proposal_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    // Scoped, and read before the await: `rusqlite::Connection` is not `Send`, so it cannot be alive
    // when this handler suspends.
    let lookup = open_database(&state.db_path).and_then(|conn| get_proposal(&conn, id));

    let proposal = match lookup {
        Ok(Some(proposal)) => proposal,
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Inbox proposal {} not found", id) })),
            )
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read inbox proposal: {}", e) })),
            )
        }
    };

    // Accepting twice would start a second plan for one issue, so a decided proposal is a conflict
    // rather than an idempotent no-op.
    if proposal.state != ProposalState::Pending {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "error": format!(
                    "Inbox proposal {} is already {}",
                    id, proposal.state
                ),
                "state": proposal.state,
                "jobId": proposal.job_id,
            })),
        );
    }

    match accept_proposal(&state.db_path, &state.job_manager, &proposal).await {
        Ok(job_id) => (
            StatusCode::OK,
            Json(json!({
                "jobId": job_id,
                "state": ProposalState::Accepted,
                "message": "Plan creation job started successfully"
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to start plan creation: {}", e) })),
        ),
    }
}

/// Marks a proposal `Dismissed`. The row stays: that record is what stops the next sweep from
/// re-importing an issue the user said no to.
pub async fn dismiss_proposal_handler(
    State(state): State<Arc<AppState>>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    let conn = match open_database(&state.db_path) {
        Ok(conn) => conn,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to open database: {}", e) })),
            )
        }
    };

    match get_proposal(&conn, id) {
        Ok(Some(proposal)) => {
            // Dismissing an accepted proposal would leave a running job with nothing pointing at it.
            if proposal.state == ProposalState::Accepted {
                return (
                    StatusCode::CONFLICT,
                    Json(json!({
                        "error": format!("Inbox proposal {} was already accepted", id),
                        "jobId": proposal.job_id,
                    })),
                );
            }
        }
        Ok(None) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Inbox proposal {} not found", id) })),
            )
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to read inbox proposal: {}", e) })),
            )
        }
    }

    match set_proposal_state(&conn, id, ProposalState::Dismissed, None) {
        Ok(()) => (
            StatusCode::OK,
            Json(json!({ "state": ProposalState::Dismissed })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to dismiss inbox proposal: {}", e) })),
        ),
    }
}
