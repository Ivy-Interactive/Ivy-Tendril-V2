pub mod chat;
pub mod config;
pub mod health;
pub mod inbox;
pub mod jobs;
pub mod ping;
pub mod plans;
pub mod projects;
pub mod verifications;
pub mod ws;

use crate::state::AppState;
use axum::http::{HeaderValue, Method};
use axum::routing::{delete, get, post, put};
use axum::Router;
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};

pub fn create_router(state: Arc<AppState>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            if let Ok(s) = origin.to_str() {
                s == "tauri://localhost"
                    || s == "http://localhost"
                    || s == "http://127.0.0.1"
                    || s.starts_with("http://localhost:")
                    || s.starts_with("http://127.0.0.1:")
            } else {
                false
            }
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
            axum::http::header::UPGRADE,
            axum::http::header::CONNECTION,
        ]);

    let protected = Router::new()
        // Plans
        .route(
            "/api/plans",
            get(plans::list_plans).post(plans::create_plan_handler),
        )
        .route(
            "/api/plans/:id",
            get(plans::get_plan).put(plans::update_plan_field),
        )
        .route(
            "/api/plans/:id/revisions",
            get(plans::get_revision_handler).post(plans::write_revision_handler),
        )
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
        .route(
            "/api/config",
            get(config::get_config_handler).put(config::put_config_handler),
        )
        // Chat
        .route(
            "/api/chat/sessions",
            get(chat::list_sessions_handler).post(chat::create_session_handler),
        )
        .route(
            "/api/chat/sessions/:id",
            get(chat::get_session_handler)
                .put(chat::update_session_handler)
                .delete(chat::delete_session_handler),
        )
        .route(
            "/api/chat/sessions/:id/messages",
            post(chat::post_message_handler),
        )
        .route(
            "/api/chat/sessions/:id/execute",
            post(chat::execute_turn_handler),
        )
        .route(
            "/api/chat/sessions/:id/cancel",
            post(chat::cancel_turn_handler),
        )
        .route(
            "/api/chat/sessions/:id/messages/:msg_id/answers",
            post(chat::answer_questions_handler),
        )
        .route(
            "/api/chat/sessions/:id/queue",
            get(chat::get_queue_handler)
                .post(chat::enqueue_handler)
                .delete(chat::clear_queue_handler),
        )
        .route(
            "/api/chat/sessions/:id/queue/:item_id",
            delete(chat::delete_queued_item_handler),
        )
        // WebSocket
        .route("/api/ws", get(ws::ws_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth::auth_middleware,
        ));

    Router::new()
        // Diagnostics (unauthenticated readiness probe and ping)
        .route("/api/ping", get(ping::ping_handler))
        .route("/api/health", get(health::health_handler))
        .merge(protected)
        .layer(cors)
        .with_state(state)
}
