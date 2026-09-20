//! `/api/plans` — the plan folders the app, the CLI and the agents all read and write.
//!
//! One module per sub-resource, mirroring the route tree in [`super::router`]: [`crud`] for the
//! plan record and its field updates, then [`revisions`], [`diff_comments`], [`annotations`],
//! [`recommendations`], [`verifications`] and [`references`] for what hangs off it. [`events`]
//! holds the chat-session announcements a write produces, and [`lifecycle`] the folder-level
//! operations — repo status, git data, reset and delete.
//!
//! The response and id helpers below are shared by several of those modules, so they stay here
//! rather than in any one of them. Every handler is re-exported, so the router keeps naming them
//! `plans::<handler>`.

mod annotations;
mod crud;
mod diff_comments;
mod events;
mod lifecycle;
mod recommendations;
mod references;
mod revisions;
mod verifications;

pub use annotations::{
    delete_annotations_handler, list_annotations_handler, replace_annotations_handler,
    upsert_annotation_handler, AnnotationQuery, ReplaceAnnotationsBody,
};
pub use crud::{
    create_plan_handler, get_plan, list_plans, update_plan_field, validate_plan_handler,
    CreatePlanBody, PlanQuery, UpdateFieldBody,
};
pub use diff_comments::{
    delete_diff_comments_handler, list_diff_comments_handler, replace_diff_comments_handler,
    upsert_diff_comment_handler, DiffCommentQuery, ReplaceDiffCommentsBody,
};
pub use events::{
    broadcast_pr_created, broadcast_pr_merged, post_plan_event_handler, PlanEventRequest,
};
pub use lifecycle::{
    delete_plan_handler, plan_git_handler, repo_status_handler, reset_plan_handler,
};
pub use recommendations::{
    accept_recommendation_handler, add_recommendation_handler, decline_recommendation_handler,
    delete_recommendation_handler, list_recommendations_handler, update_recommendation_handler,
    AcceptRecommendationBody, AddRecommendationBody, DeclineRecommendationBody,
    UpdateRecommendationBody,
};
pub use references::{
    add_plan_commit, add_plan_depends_on, add_plan_pr, add_plan_related, add_plan_repo,
    remove_plan_depends_on, remove_plan_related, remove_plan_repo, PlanCommitBody,
    PlanDependsOnBody, PlanPrBody, PlanRelatedPlanBody, PlanRepoBody,
};
pub use revisions::{
    get_revision_handler, update_latest_revision_handler, write_revision_handler, RevisionQuery,
    UpdateLatestRevisionBody, WriteRevisionBody,
};
pub use verifications::{
    add_plan_verification_handler, delete_plan_verification_handler,
    list_plan_verifications_handler, update_plan_verification_handler, AddVerificationBody,
    UpdateVerificationBody,
};

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;

/// `plan.yaml` does not carry the plan id — it lives in the folder name (`00042-FixLoginBug`).
fn plan_id_from_folder_name(folder_name: &str) -> i32 {
    folder_name
        .split('-')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn error_response(code: StatusCode, message: String) -> axum::response::Response {
    (code, Json(json!({ "error": message }))).into_response()
}

fn message_response(message: &str) -> axum::response::Response {
    (StatusCode::OK, Json(json!({ "message": message }))).into_response()
}

fn folder_name_of(folder: &std::path::Path) -> String {
    folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string()
}
