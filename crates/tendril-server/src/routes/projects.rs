use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::sync::Arc;
use tendril_core::config::load_config;
use tendril_core::git::{query_project_issues, resolve_project_github_repos, IssueQueryParams};

pub async fn list_projects(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    Json(settings.projects)
}

pub async fn get_project(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    if let Some(proj) = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&name))
    {
        (StatusCode::OK, Json(json!(proj)))
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", name) })),
        )
    }
}

pub async fn get_project_issues(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Query(query): Query<IssueQueryParams>,
) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    let Some(proj) = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&name))
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", name) })),
        )
            .into_response();
    };

    let repos = resolve_project_github_repos(proj, &state.tendril_home);
    match query_project_issues(&repos, &query).await {
        Ok(res) => (StatusCode::OK, Json(json!(res))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to query project issues: {}", e) })),
        )
            .into_response(),
    }
}

pub async fn get_project_issues_metadata(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    let Some(proj) = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&name))
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", name) })),
        )
            .into_response();
    };

    let repos = resolve_project_github_repos(proj, &state.tendril_home);
    match tendril_core::git::get_project_issues_metadata(&repos).await {
        Ok(res) => (StatusCode::OK, Json(json!(res))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to fetch issue metadata: {}", e) })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Uri;
    use tendril_core::git::IssueCategory;

    #[test]
    fn test_issue_query_params_deserialization_defaults() {
        let uri = Uri::from_static("http://localhost/api/projects/Tendril-Service/issues");
        let Query(params) = Query::<IssueQueryParams>::try_from_uri(&uri).unwrap();
        assert_eq!(params.category, None);
        assert_eq!(params.assignee, None);
        assert_eq!(params.label, None);
        assert_eq!(params.query, None);
        assert_eq!(params.page, None);
        assert_eq!(params.limit, None);
    }

    #[test]
    fn test_issue_query_params_deserialization_populated() {
        let uri = Uri::from_static("http://localhost/api/projects/Tendril-Service/issues?category=MyIssues&assignee=alice&label=bug&query=crash&page=2&limit=25");
        let Query(params) = Query::<IssueQueryParams>::try_from_uri(&uri).unwrap();
        assert_eq!(params.category, Some(IssueCategory::MyIssues));
        assert_eq!(params.assignee.as_deref(), Some("alice"));
        assert_eq!(params.label.as_deref(), Some("bug"));
        assert_eq!(params.query.as_deref(), Some("crash"));
        assert_eq!(params.page, Some(2));
        assert_eq!(params.limit, Some(25));
    }
}
