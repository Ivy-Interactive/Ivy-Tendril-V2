pub mod agents;
pub mod attachments;
pub mod auth;
pub mod changes;
pub mod chat;
pub mod config;
pub mod costs;
pub mod dashboard;
pub mod health;
pub mod inbox;
pub mod jobs;
pub mod local_file;
pub mod models;
pub mod newsletter;
pub mod onboarding;
pub mod ping;
pub mod plans;
pub mod projects;
pub mod pull_requests;
pub mod recommendations;
pub mod tables;
pub mod tunnel;
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
        .route("/api/plans/:id/git", get(plans::plan_git_handler))
        .route(
            "/api/plans/:id/revisions",
            get(plans::get_revision_handler).post(plans::write_revision_handler),
        )
        // In place, keeping the revision number — what answering a question needs. See the handler.
        .route(
            "/api/plans/:id/revisions/latest",
            put(plans::update_latest_revision_handler),
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
        // The server-side query API over the Jobs table: sort, filter, window and total count are
        // SQLite's, so a jobs table costs one page per view however long the history is.
        .route("/api/jobs/query", post(jobs::query_jobs_handler))
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
        // Tables — the generic form of the query API above. A table listed in
        // `tables::queryable_tables` is server-paged, sortable and filterable with no DTO of its own.
        .route("/api/tables", get(tables::list_tables))
        .route("/api/tables/:table/schema", get(tables::table_schema))
        .route(
            "/api/tables/:table/query",
            post(tables::query_table_handler),
        )
        .route(
            "/api/tables/:table/values",
            post(tables::table_values_handler),
        )
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
        // Fast-forwards the project's repos and returns a per-repo escalation for the refusals; see
        // `projects::sync_project_repos` for why a diverged repo is reported rather than reconciled.
        .route(
            "/api/projects/:name/sync",
            post(projects::sync_project_repos),
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
        // The action runs in a pty, so it is interactive: these carry the client's keystrokes and
        // window size back to it, keyed by the session id its `meta` frame announced.
        .route(
            "/api/projects/:name/review-actions/:action/input",
            post(projects::review_action_input),
        )
        .route(
            "/api/projects/:name/review-actions/:action/resize",
            post(projects::review_action_resize),
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
        // Live model discovery for a bring-your-own-LLM endpoint. A POST because it takes a body and
        // reaches a third party; the key it uses is read from config here rather than sent by the
        // webview whenever the operator has already saved one.
        .route(
            "/api/agents/models",
            post(agents::fetch_provider_models_handler),
        )
        // V1's Test Agent dialog: install, then auth, then one validation per model. A POST because
        // it launches real processes and spends real provider quota - this is not a safe GET.
        .route("/api/agents/:agent/test", post(agents::test_agent_handler))
        // The rate-limit windows behind the settings pane's usage strip. Cached for a minute in
        // core, so the pane's own poll does not become the thing that rate-limits the account.
        .route(
            "/api/agents/:agent/usage",
            get(agents::get_agent_usage_handler),
        )
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
        // Newsletter
        .route(
            "/api/newsletter/subscribe",
            post(newsletter::subscribe_handler),
        )
        // Pull requests
        .route("/api/pull-requests", get(pull_requests::list_pull_requests))
        .route(
            "/api/pull-requests/sync",
            post(pull_requests::sync_pull_requests),
        )
        // Costs
        .route("/api/costs/summary", get(costs::get_costs_summary))
        .route("/api/costs/series", get(costs::get_costs_series))
        .route("/api/dashboard/activity", get(dashboard::get_activity))
        .route(
            "/api/dashboard/shipped-features",
            get(dashboard::get_shipped_features),
        )
        .route("/api/dashboard/merged-prs", get(dashboard::get_merged_prs))
        .route("/api/dashboard/plan-costs", get(dashboard::get_plan_costs))
        .route(
            "/api/dashboard/agent-costs",
            get(dashboard::get_agent_costs),
        )
        // Share tunnel. Owner-only: starting, stopping and reading a share are bearer-credentialled
        // operations, and the GET returns the visitor's capability token. The static `install` segment
        // is declared alongside so it can never be read as anything else.
        .route(
            "/api/tunnel/share",
            get(tunnel::get_share_tunnel)
                .post(tunnel::start_share_tunnel)
                .delete(tunnel::stop_share_tunnel),
        )
        .route(
            "/api/tunnel/share/install",
            get(tunnel::get_cloudflared_install_state),
        )
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
        // The terminal half of V1's chat modes: the session's agent, interactive, under a pty. The
        // session id is what authorises the spawn, so these sit under the session rather than in a
        // namespace of their own.
        .route(
            "/api/chat/sessions/:id/terminal",
            post(chat::start_terminal_handler).delete(chat::terminal_close_handler),
        )
        .route(
            "/api/chat/sessions/:id/terminal/input",
            post(chat::terminal_input_handler),
        )
        .route(
            "/api/chat/sessions/:id/terminal/resize",
            post(chat::terminal_resize_handler),
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
        // REST counterpart to `?since=<seq>` WS resume — same ring buffer, for a client that would
        // rather poll (or top up before opening a socket) than hold one open.
        .route("/api/events/backfill", get(ws::events_backfill_handler))
        .route("/api/events", get(ws::events_backfill_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth::auth_middleware,
        ))
        // Outside `auth_middleware`, so a configured `api.apiKey` is checked *before* it and a request
        // must clear both — the same order as `ApiKeyAuthMiddleware` ahead of session auth in the
        // original. A no-op when no key is configured.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth::api_key_middleware,
        ));

    // Password login: no bearer credential (that is what it issues), but a configured `api.apiKey`
    // still applies, since it applies to every `/api` path in the original.
    let password_auth = Router::new()
        .route("/api/auth/login", post(auth::login_handler))
        .route("/api/auth/status", get(auth::status_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth::api_key_middleware,
        ));

    // Owner-only *and* local-only: the full-access tunnel's switch, the password that gates it, and
    // attachment staging.
    //
    // Bearer-credentialled like the share routes, plus refused when the request arrived over either
    // tunnel. `/api/tunnel/full` publishes the whole daemon and `/api/auth/password` is the credential
    // that makes doing so defensible; neither is something to be able to reach from the internet the
    // tunnel exposes. A session token from `/api/auth/login` satisfies `auth_middleware`, so without the
    // host fence a remote caller holding the password could rotate it. See `crate::share_exposure`.
    //
    // Its own router rather than three more routes on `protected`, because `protected` must *not* gain
    // this fence: a share visitor's capability token is checked inside `auth_middleware` and reaches its
    // allow-listed reads over exactly the host this refuses.
    let owner_local = Router::new()
        .route(
            "/api/auth/password",
            put(auth::set_password_handler).delete(auth::clear_password_handler),
        )
        .route(
            "/api/tunnel/full",
            get(tunnel::get_full_tunnel)
                .post(tunnel::start_full_tunnel)
                .delete(tunnel::stop_full_tunnel),
        )
        // Writes a file the user attached into `<TendrilHome>/Attachments/<session>/`, which is what
        // makes it previewable at all. Here rather than on `protected` because it writes to the
        // daemon's home: see `attachments`. The body limit is the route's own, since the default 2 MB
        // would refuse most screenshots before the handler's 16 MiB cap could answer for them.
        .route(
            "/api/attachments/:session_id",
            post(attachments::upload_attachment).layer(axum::extract::DefaultBodyLimit::max(
                tendril_core::jobs::attachments::MAX_ATTACHMENT_BYTES + 1024,
            )),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::share_exposure::refuse_on_any_tunnel_host,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth::auth_middleware,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth::api_key_middleware,
        ));

    // `GET /ivy/local-file`, outside the bearer layer because an `<img src>` navigation carries no
    // `Authorization` header. Its own guard supplies the credential check (`?token=`) plus host,
    // origin, extension and root-confinement enforcement — see crate::local_file_guard.
    let local_file = Router::new()
        .route("/ivy/local-file", get(local_file::get_local_file))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::local_file_guard::local_file_guard,
        ));

    Router::new()
        // Diagnostics (unauthenticated readiness probe and ping)
        .route("/api/ping", get(ping::ping_handler))
        .route("/api/health", get(health::health_handler))
        // Refused over a share: a visitor has no business logging in, and exposing a credential
        // check to the internet buys the operator nothing. See `crate::share_exposure`.
        .merge(password_auth.layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::share_exposure::refuse_on_tunnel_host,
        )))
        .merge(local_file)
        // Alias for the original Tendril's GET /api/jobs/health, same handler/payload. Kept
        // unauthenticated to match /api/health (the original guards it, but a peer that hasn't
        // read the secret yet still needs to probe it) and registered on this router so the
        // static segment wins over the protected router's /api/jobs/:id.
        .route("/api/jobs/health", get(health::health_handler))
        // WebViewer proxy. Outside /api and outside auth_middleware on purpose: an <iframe src>
        // navigation carries no Authorization header, and neither do the subresource requests the
        // service worker reissues from inside the proxied page. A loopback-only target allow-list is
        // what keeps these from being an open relay — see crate::webviewer.
        // ...and that allow-list is exactly why this has to be refused over *either* tunnel: confined
        // to loopback targets, a publicly reachable proxy lets an anonymous visitor reach services
        // bound to the daemon host's localhost. See `crate::share_exposure`.
        .merge(
            crate::webviewer::routes().layer(axum::middleware::from_fn_with_state(
                state.clone(),
                crate::share_exposure::refuse_on_any_tunnel_host,
            )),
        )
        .merge(owner_local)
        .merge(protected)
        .layer(cors)
        .with_state(state)
}
