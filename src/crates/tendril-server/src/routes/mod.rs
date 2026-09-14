pub mod agents;
pub mod changes;
pub mod chat;
pub mod config;
pub mod costs;
pub mod health;
pub mod inbox;
pub mod jobs;
pub mod models;
pub mod onboarding;
pub mod ping;
pub mod plans;
pub mod projects;
pub mod pull_requests;
pub mod recommendations;
pub mod vault;
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
            get(plans::get_plan)
                .put(plans::update_plan_field)
                .delete(plans::delete_plan_handler),
        )
        .route("/api/plans/:id/reset", post(plans::reset_plan_handler))
        .route(
            "/api/plans/:id/repo-status",
            get(plans::repo_status_handler),
        )
        .route(
            "/api/plans/:id/revisions",
            get(plans::get_revision_handler).post(plans::write_revision_handler),
        )
        .route(
            "/api/plans/:id/diff-comments",
            get(plans::list_diff_comments_handler)
                .post(plans::upsert_diff_comment_handler)
                .put(plans::replace_diff_comments_handler)
                .delete(plans::delete_diff_comments_handler),
        )
        .route(
            "/api/plans/:id/annotations",
            get(plans::list_annotations_handler)
                .post(plans::upsert_annotation_handler)
                .put(plans::replace_annotations_handler)
                .delete(plans::delete_annotations_handler),
        )
        .route(
            "/api/plans/:id/recommendations",
            get(plans::list_recommendations_handler).post(plans::add_recommendation_handler),
        )
        .route(
            "/api/plans/:id/recommendations/:title",
            put(plans::update_recommendation_handler).delete(plans::delete_recommendation_handler),
        )
        .route(
            "/api/plans/:id/recommendations/:title/accept",
            put(plans::accept_recommendation_handler),
        )
        .route(
            "/api/plans/:id/recommendations/:title/decline",
            put(plans::decline_recommendation_handler),
        )
        // Recommendations across every plan, read from the denormalised projection
        .route(
            "/api/recommendations",
            get(recommendations::list_recommendations),
        )
        .route(
            "/api/recommendations/rebuild",
            post(recommendations::rebuild_recommendations),
        )
        .route(
            "/api/plans/:id/verifications",
            get(plans::list_plan_verifications_handler).post(plans::add_plan_verification_handler),
        )
        .route(
            "/api/plans/:id/verifications/:name",
            put(plans::update_plan_verification_handler)
                .delete(plans::delete_plan_verification_handler),
        )
        .route(
            "/api/plans/:id/events",
            post(plans::post_plan_event_handler),
        )
        .route(
            "/api/plans/:id/repos",
            post(plans::add_plan_repo).delete(plans::remove_plan_repo),
        )
        .route("/api/plans/:id/prs", post(plans::add_plan_pr))
        .route("/api/plans/:id/commits", post(plans::add_plan_commit))
        .route(
            "/api/plans/:id/depends-on",
            post(plans::add_plan_depends_on).delete(plans::remove_plan_depends_on),
        )
        .route(
            "/api/plans/:id/related-plans",
            post(plans::add_plan_related).delete(plans::remove_plan_related),
        )
        .route(
            "/api/plans/:id/validate",
            post(plans::validate_plan_handler),
        )
        // Inbox. Static segments before `:id`, so `check` and `proposals` can never be read as a
        // proposal id.
        .route("/api/inbox", post(inbox::post_inbox))
        .route("/api/inbox/check", post(inbox::post_inbox_check))
        .route("/api/inbox/proposals", get(inbox::list_proposals_handler))
        .route(
            "/api/inbox/proposals/:id/accept",
            post(inbox::accept_proposal_handler),
        )
        .route(
            "/api/inbox/proposals/:id/dismiss",
            post(inbox::dismiss_proposal_handler),
        )
        // Jobs
        .route("/api/jobs", get(jobs::list_jobs).post(jobs::start_job))
        // Static segments before `:id`, so a literal path can never be read as a job id. Axum
        // matches static segments first; keeping them adjacent makes the intent obvious.
        .route("/api/jobs/queue", get(jobs::job_queue))
        .route("/api/jobs/stop-all", post(jobs::stop_all_jobs))
        .route("/api/jobs/clear", post(jobs::clear_jobs))
        .route("/api/jobs/maintenance", post(jobs::run_maintenance))
        .route("/api/jobs/:id", get(jobs::get_job).delete(jobs::delete_job))
        .route("/api/jobs/:id/force-start", post(jobs::force_start_job))
        .route("/api/jobs/:id/status", put(jobs::update_job_status))
        .route("/api/jobs/:id/fail", put(jobs::report_job_failure))
        .route("/api/jobs/:id/cancel", post(jobs::cancel_job))
        .route(
            "/api/jobs/:id/logs",
            get(jobs::get_job_logs).post(jobs::add_log),
        )
        .route("/api/jobs/:id/logs/stream", get(jobs::stream_job_logs))
        .route("/api/jobs/:id/events", get(jobs::stream_job_events))
        // Filesystem changes
        .route("/api/changes/events", get(changes::stream_changes))
        // Projects & Verifications
        .route(
            "/api/projects",
            get(projects::list_projects).post(projects::create_project),
        )
        .route(
            "/api/projects/:name",
            get(projects::get_project)
                .put(projects::update_project)
                .delete(projects::delete_project),
        )
        .route(
            "/api/projects/:name/issues",
            get(projects::get_project_issues),
        )
        .route(
            "/api/projects/:name/issues/metadata",
            get(projects::get_project_issues_metadata),
        )
        .route(
            "/api/projects/:name/repos",
            post(projects::add_project_repo).delete(projects::remove_project_repo),
        )
        .route(
            "/api/projects/:name/verifications",
            post(projects::add_project_verification).put(projects::move_project_verification_route),
        )
        .route(
            "/api/projects/:name/verifications/:verification",
            delete(projects::remove_project_verification),
        )
        .route(
            "/api/projects/:name/review-actions",
            post(projects::add_project_review_action),
        )
        .route(
            "/api/projects/:name/review-actions/:action",
            delete(projects::remove_project_review_action),
        )
        .route(
            "/api/projects/:name/review-actions/:action/execute",
            post(projects::execute_review_action),
        )
        .route(
            "/api/projects/:name/hooks",
            post(projects::add_project_hook),
        )
        .route(
            "/api/projects/:name/hooks/:hook",
            delete(projects::remove_project_hook),
        )
        // Vaults. `:id` accepts the literal `default` for the primary vault, so the static
        // `discover` and `accounts` segments are declared alongside it rather than under it.
        .route(
            "/api/vaults",
            get(vault::list_vaults).post(vault::connect_vault),
        )
        .route("/api/vaults/create", post(vault::create_vault_repo))
        .route("/api/vaults/discover", get(vault::discover_vaults))
        .route("/api/vaults/accounts", get(vault::github_accounts))
        .route(
            "/api/vaults/project-assets/:name",
            get(vault::project_assets),
        )
        .route(
            "/api/vaults/:id",
            get(vault::get_vault_status)
                .put(vault::set_always_up_to_date)
                .delete(vault::disconnect_vault),
        )
        .route("/api/vaults/:id/catalog", get(vault::get_catalog))
        .route("/api/vaults/:id/pull", post(vault::pull_latest))
        .route("/api/vaults/:id/push", post(vault::push_and_create_pr))
        .route("/api/vaults/:id/projects", post(vault::import_project))
        .route(
            "/api/vaults/:id/projects/:project",
            delete(vault::delete_project_from_vault),
        )
        .route(
            "/api/verifications",
            get(verifications::list_verifications).post(verifications::add_verification),
        )
        .route(
            "/api/verifications/:name",
            get(verifications::get_verification)
                .put(verifications::update_verification)
                .delete(verifications::delete_verification),
        )
        // Agents
        .route("/api/agents", get(agents::get_agents_handler))
        // Config
        .route(
            "/api/config",
            get(config::get_config_handler).put(config::put_config_handler),
        )
        // Version check
        .route("/api/version", get(health::get_version_handler))
        .route(
            "/api/version/check",
            post(health::check_version_now_handler),
        )
        // Onboarding
        .route("/api/onboarding", get(onboarding::get_status_handler))
        .route(
            "/api/onboarding/complete",
            post(onboarding::complete_handler),
        )
        .route("/api/onboarding/dismiss", post(onboarding::dismiss_handler))
        .route("/api/doctor", get(health::doctor_handler))
        // Pull requests
        .route("/api/pull-requests", get(pull_requests::list_pull_requests))
        .route(
            "/api/pull-requests/sync",
            post(pull_requests::sync_pull_requests),
        )
        // Costs
        .route("/api/costs/summary", get(costs::get_costs_summary))
        .route("/api/costs/series", get(costs::get_costs_series))
        // Models
        .route("/api/models", get(models::list_models))
        .route("/api/models/status", get(models::models_status))
        .route("/api/models/refresh", post(models::refresh_models))
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
            put(chat::update_queued_item_handler).delete(chat::delete_queued_item_handler),
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
        // Alias for the original Tendril's GET /api/jobs/health, same handler/payload. Kept
        // unauthenticated to match /api/health (the original guards it, but a peer that hasn't
        // read the secret yet still needs to probe it) and registered on this router so the
        // static segment wins over the protected router's /api/jobs/:id.
        .route("/api/jobs/health", get(health::health_handler))
        // WebViewer proxy. Outside /api and outside auth_middleware on purpose: an <iframe src>
        // navigation carries no Authorization header, and neither do the subresource requests the
        // service worker reissues from inside the proxied page. A loopback-only target allow-list is
        // what keeps these from being an open relay — see crate::webviewer.
        .merge(crate::webviewer::routes())
        .merge(protected)
        .layer(cors)
        .with_state(state)
}
