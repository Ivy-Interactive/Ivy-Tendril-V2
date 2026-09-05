pub mod config;
pub mod health;
pub mod inbox;
pub mod jobs;
pub mod ping;
pub mod plans;
pub mod projects;
pub mod verifications;
pub mod ws;

use std::sync::Arc;
use axum::routing::{get, post, put};
use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use crate::state::AppState;

pub fn create_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Diagnostics
        .route("/api/ping", get(ping::ping_handler))
        .route("/api/health", get(health::health_handler))
        // Plans
        .route("/api/plans", get(plans::list_plans).post(plans::create_plan_handler))
        .route("/api/plans/:id", get(plans::get_plan).put(plans::update_plan_field))
        .route("/api/plans/:id/revisions", get(plans::get_revision_handler).post(plans::write_revision_handler))
        // Inbox
        .route("/api/inbox", post(inbox::post_inbox))
        // Jobs
        .route("/api/jobs", get(jobs::list_jobs).post(jobs::start_job))
        .route("/api/jobs/:id", get(jobs::get_job))
        .route("/api/jobs/:id/status", put(jobs::update_job_status))
        .route("/api/jobs/:id/fail", put(jobs::report_job_failure))
        .route("/api/jobs/:id/cancel", post(jobs::cancel_job))
        .route("/api/jobs/:id/logs", post(jobs::add_log))
        // Projects & Verifications
        .route("/api/projects", get(projects::list_projects))
        .route("/api/projects/:name", get(projects::get_project))
        .route("/api/verifications", get(verifications::list_verifications))
        // Config
        .route("/api/config", get(config::get_config_handler).put(config::put_config_handler))
        // WebSocket
        .route("/api/ws", get(ws::ws_handler))
        .layer(cors)
        .with_state(state)
}
