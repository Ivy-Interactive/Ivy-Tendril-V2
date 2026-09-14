use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{
    insert_project_verification, load_config, move_project_verification, save_config,
    VerificationPlacement,
};
use tendril_core::db::open_database;
use tendril_core::git::{query_project_issues, resolve_project_github_repos, IssueQueryParams};
use tendril_core::models::{
    ProjectConfig, ProjectVerificationRef, PromptwareHookConfig, RepoRef, ReviewActionConfig,
};
use tendril_core::plans::helpers::resolve_plan_folder;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RepoInput {
    String(String),
    Object(RepoRef),
}

impl From<RepoInput> for RepoRef {
    fn from(input: RepoInput) -> Self {
        match input {
            RepoInput::String(path) => RepoRef {
                path,
                base_branch: None,
            },
            RepoInput::Object(r) => r,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VerificationInput {
    String(String),
    Object(VerificationObjectInput),
}

/// A verification in a request body. `after` is a placement hint, not part of the stored
/// verification: it names the verification this one goes behind, and only the add endpoint reads
/// it — requests that supply the whole list already carry their own order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationObjectInput {
    pub name: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

impl VerificationInput {
    pub fn after(&self) -> Option<&str> {
        match self {
            VerificationInput::String(_) => None,
            VerificationInput::Object(v) => v.after.as_deref(),
        }
    }
}

impl From<VerificationInput> for ProjectVerificationRef {
    fn from(input: VerificationInput) -> Self {
        match input {
            VerificationInput::String(name) => ProjectVerificationRef {
                name,
                required: true,
            },
            VerificationInput::Object(v) => ProjectVerificationRef {
                name: v.name,
                required: v.required,
            },
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(default = "default_project_color")]
    pub color: String,
    #[serde(default)]
    pub repos: Vec<RepoInput>,
    #[serde(default)]
    pub verifications: Vec<VerificationInput>,
    #[serde(default)]
    pub context: String,
    #[serde(rename = "stackHash", alias = "stack_hash")]
    pub stack_hash: Option<String>,
    #[serde(rename = "reviewActions", alias = "review_actions", default)]
    pub review_actions: Vec<ReviewActionConfig>,
    #[serde(default)]
    pub hooks: Vec<PromptwareHookConfig>,
    #[serde(rename = "buildDependencies", alias = "build_dependencies", default)]
    pub build_dependencies: Vec<String>,
}

fn default_project_color() -> String {
    "Blue".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectRequest {
    pub name: Option<String>,
    #[serde(rename = "newName", alias = "new_name")]
    pub new_name: Option<String>,
    pub color: Option<String>,
    pub repos: Option<Vec<RepoInput>>,
    pub verifications: Option<Vec<VerificationInput>>,
    pub context: Option<String>,
    #[serde(default, rename = "stackHash", alias = "stack_hash")]
    pub stack_hash: Option<Option<String>>,
    #[serde(rename = "reviewActions", alias = "review_actions")]
    pub review_actions: Option<Vec<ReviewActionConfig>>,
    pub hooks: Option<Vec<PromptwareHookConfig>>,
    #[serde(rename = "buildDependencies", alias = "build_dependencies")]
    pub build_dependencies: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum StringOrInt {
    String(String),
    Int(i64),
}

impl StringOrInt {
    pub fn to_string_val(&self) -> String {
        match self {
            StringOrInt::String(s) => s.clone(),
            StringOrInt::Int(i) => i.to_string(),
        }
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct ExecuteReviewActionParams {
    #[serde(alias = "planId", alias = "plan")]
    pub plan_id: Option<StringOrInt>,
    #[serde(alias = "worktreeDir", alias = "worktree_dir")]
    pub worktree: Option<String>,
}

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
        (StatusCode::OK, Json(json!(proj))).into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", name) })),
        )
            .into_response()
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
pub async fn create_project(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateProjectRequest>,
) -> impl IntoResponse {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Project name cannot be empty" })),
        )
            .into_response();
    }

    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    if settings
        .projects
        .iter()
        .any(|p| p.name.eq_ignore_ascii_case(&name))
    {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": format!("Project '{}' already exists", name) })),
        )
            .into_response();
    }

    let color = if req.color.trim().is_empty() {
        "Blue".to_string()
    } else {
        req.color.trim().to_string()
    };

    let repos: Vec<RepoRef> = req.repos.into_iter().map(Into::into).collect();
    let verifications: Vec<ProjectVerificationRef> =
        req.verifications.into_iter().map(Into::into).collect();

    let project = ProjectConfig {
        name,
        color,
        repos,
        verifications,
        context: req.context,
        stack_hash: req.stack_hash,
        review_actions: req.review_actions,
        hooks: req.hooks,
        build_dependencies: req.build_dependencies,
        ..Default::default()
    };

    settings.projects.push(project.clone());
    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(json!(project))).into_response()
}

pub async fn update_project(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<UpdateProjectRequest>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let rename_target = req.new_name.or(req.name);
    let mut renamed_to: Option<String> = None;
    if let Some(target) = rename_target {
        let trimmed = target.trim().to_string();
        if trimmed.is_empty() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Project name cannot be empty" })),
            )
                .into_response();
        }
        if !trimmed.eq_ignore_ascii_case(&name)
            && settings
                .projects
                .iter()
                .any(|p| p.name.eq_ignore_ascii_case(&trimmed))
        {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": format!("Project '{}' already exists", trimmed) })),
            )
                .into_response();
        }
        if !trimmed.eq_ignore_ascii_case(&name) {
            renamed_to = Some(trimmed.clone());
        }
        settings.projects[proj_idx].name = trimmed;
    }

    if let Some(color) = req.color {
        let trimmed = color.trim().to_string();
        if !trimmed.is_empty() {
            settings.projects[proj_idx].color = trimmed;
        }
    }

    if let Some(repos) = req.repos {
        settings.projects[proj_idx].repos = repos.into_iter().map(Into::into).collect();
    }

    if let Some(verifications) = req.verifications {
        settings.projects[proj_idx].verifications =
            verifications.into_iter().map(Into::into).collect();
    }

    if let Some(context) = req.context {
        settings.projects[proj_idx].context = context;
    }

    if let Some(stack_hash_opt) = req.stack_hash {
        settings.projects[proj_idx].stack_hash = stack_hash_opt;
    }

    if let Some(review_actions) = req.review_actions {
        settings.projects[proj_idx].review_actions = review_actions;
    }

    if let Some(hooks) = req.hooks {
        settings.projects[proj_idx].hooks = hooks;
    }

    if let Some(build_dependencies) = req.build_dependencies {
        settings.projects[proj_idx].build_dependencies = build_dependencies;
    }

    let updated_project = settings.projects[proj_idx].clone();
    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    if let Some(new_name) = renamed_to {
        let _ = tendril_core::plans::rename_project_in_plans(&state.plans_dir, &name, &new_name);
        if let Ok(conn) = open_database(&state.db_path) {
            let _ = tendril_core::db::rename_project(&conn, &name, &new_name);
        }
    }

    (StatusCode::OK, Json(json!(updated_project))).into_response()
}

pub async fn delete_project(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let removed = settings.projects.remove(proj_idx);
    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({ "message": format!("Project '{}' removed", removed.name) })),
    )
        .into_response()
}

#[derive(Debug, Deserialize, Default)]
pub struct RemoveRepoParams {
    pub path: Option<String>,
}

pub async fn add_project_repo(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(input): Json<RepoInput>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let repo_ref: RepoRef = input.into();
    if repo_ref.path.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Repo path cannot be empty" })),
        )
            .into_response();
    }

    if let Some(existing) = settings.projects[proj_idx]
        .repos
        .iter()
        .find(|r| r.path.eq_ignore_ascii_case(&repo_ref.path))
    {
        return (StatusCode::OK, Json(json!(existing))).into_response();
    }

    settings.projects[proj_idx].repos.push(repo_ref.clone());
    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(json!(repo_ref))).into_response()
}

pub async fn remove_project_repo(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Query(query): Query<RemoveRepoParams>,
    body_bytes: axum::body::Bytes,
) -> impl IntoResponse {
    let target_path = if let Some(p) = query.path.filter(|s| !s.trim().is_empty()) {
        p
    } else if !body_bytes.is_empty() {
        if let Ok(input) = serde_json::from_slice::<RepoInput>(&body_bytes) {
            let r: RepoRef = input.into();
            r.path
        } else if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body_bytes) {
            val.get("path")
                .and_then(|p| p.as_str())
                .unwrap_or_default()
                .to_string()
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    if target_path.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Repo path is required" })),
        )
            .into_response();
    }

    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    settings.projects[proj_idx]
        .repos
        .retain(|r| !r.path.eq_ignore_ascii_case(&target_path));

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Repo '{}' removed from project '{}'", target_path, name)
        })),
    )
        .into_response()
}

pub async fn add_project_verification(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(input): Json<VerificationInput>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let after = input.after().map(|s| s.to_string());
    let ver_ref: ProjectVerificationRef = input.into();
    if ver_ref.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Verification name cannot be empty" })),
        )
            .into_response();
    }

    if let Some(existing) = settings.projects[proj_idx]
        .verifications
        .iter_mut()
        .find(|v| v.name.eq_ignore_ascii_case(&ver_ref.name))
    {
        existing.required = ver_ref.required;
        let updated = existing.clone();
        if let Err(e) = save_config(&state.config_path, &settings) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to save config: {}", e) })),
            )
                .into_response();
        }
        return (StatusCode::OK, Json(json!(updated))).into_response();
    }

    if let Err(e) = insert_project_verification(
        &mut settings.projects[proj_idx],
        ver_ref.clone(),
        after.as_deref(),
    ) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        )
            .into_response();
    }

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (StatusCode::CREATED, Json(json!(ver_ref))).into_response()
}

#[derive(Debug, Deserialize)]
pub struct MoveVerificationRequest {
    pub name: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub position: Option<usize>,
}

/// Reorders a project's verifications. Verifications run in configured order, so this is how a
/// caller says "this one runs before that one".
pub async fn move_project_verification_route(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<MoveVerificationRequest>,
) -> impl IntoResponse {
    let placement = match (&req.before, &req.after, req.position) {
        (Some(target), None, None) => VerificationPlacement::Before(target.clone()),
        (None, Some(target), None) => VerificationPlacement::After(target.clone()),
        (None, None, Some(pos)) => VerificationPlacement::Position(pos),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Specify exactly one of before, after, or position" })),
            )
                .into_response();
        }
    };

    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let index =
        match move_project_verification(&mut settings.projects[proj_idx], &req.name, &placement) {
            Ok(idx) => idx,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": e.to_string() })),
                )
                    .into_response();
            }
        };

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "name": req.name,
            "position": index,
            "verifications": settings.projects[proj_idx].verifications,
        })),
    )
        .into_response()
}

pub async fn remove_project_verification(
    State(state): State<Arc<AppState>>,
    Path((name, verification)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    settings.projects[proj_idx]
        .verifications
        .retain(|v| !v.name.eq_ignore_ascii_case(&verification));

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Verification '{}' removed from project '{}'", verification, name)
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct AddReviewActionRequest {
    pub name: String,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub before: Option<String>,
    #[serde(default)]
    pub after: Option<String>,
}

pub async fn add_project_review_action(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<AddReviewActionRequest>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let action_name = req.name.trim().to_string();
    if action_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Review action name cannot be empty" })),
        )
            .into_response();
    }

    settings.projects[proj_idx]
        .review_actions
        .retain(|a| !a.name.eq_ignore_ascii_case(&action_name));

    let review_actions = &settings.projects[proj_idx].review_actions;
    let insert_idx = if let Some(target) = req.before.as_deref() {
        match review_actions
            .iter()
            .position(|a| a.name.eq_ignore_ascii_case(target))
        {
            Some(idx) => idx,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!(
                            "Review action '{}' not found in project '{}'. Available: {}",
                            target,
                            name,
                            review_actions.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
                        )
                    })),
                )
                    .into_response();
            }
        }
    } else if let Some(target) = req.after.as_deref() {
        match review_actions
            .iter()
            .position(|a| a.name.eq_ignore_ascii_case(target))
        {
            Some(idx) => idx + 1,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!(
                            "Review action '{}' not found in project '{}'. Available: {}",
                            target,
                            name,
                            review_actions.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ")
                        )
                    })),
                )
                    .into_response();
            }
        }
    } else {
        review_actions.len()
    };

    settings.projects[proj_idx].review_actions.insert(
        insert_idx,
        ReviewActionConfig {
            name: action_name.clone(),
            condition: req.condition,
            command: req.command,
            paths: req.paths,
        },
    );

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Review action '{}' added to project '{}'", action_name, name)
        })),
    )
        .into_response()
}

pub async fn remove_project_review_action(
    State(state): State<Arc<AppState>>,
    Path((name, action)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let before = settings.projects[proj_idx].review_actions.len();
    settings.projects[proj_idx]
        .review_actions
        .retain(|a| !a.name.eq_ignore_ascii_case(&action));

    if settings.projects[proj_idx].review_actions.len() == before {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": format!("Review action '{}' not found in project '{}'", action, name)
            })),
        )
            .into_response();
    }

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Review action '{}' removed from project '{}'", action, name)
        })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
pub struct AddHookRequest {
    pub name: String,
    #[serde(default = "default_hook_when")]
    pub when: String,
    #[serde(default)]
    pub promptwares: Vec<String>,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub action: String,
}

fn default_hook_when() -> String {
    "before".to_string()
}

/// Adds or replaces a project hook, keyed by name — the same upsert as
/// [`add_project_review_action`], so re-running the request does not accumulate duplicates.
///
/// An unrecognised `when` is rejected here rather than stored: the config model treats it as
/// matching no phase, which would leave the caller with a hook that silently never fires.
pub async fn add_project_hook(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(req): Json<AddHookRequest>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let hook_name = req.name.trim().to_string();
    if hook_name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Hook name cannot be empty" })),
        )
            .into_response();
    }

    let when = req.when.trim().to_ascii_lowercase();
    if when != "before" && when != "after" {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Hook 'when' must be 'before' or 'after', got '{}'", req.when)
            })),
        )
            .into_response();
    }

    let hooks = &mut settings.projects[proj_idx].hooks;
    hooks.retain(|h| !h.name.eq_ignore_ascii_case(&hook_name));
    hooks.push(PromptwareHookConfig {
        name: hook_name.clone(),
        when,
        promptwares: req.promptwares,
        condition: req.condition,
        action: req.action,
    });

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Hook '{}' added to project '{}'", hook_name, name)
        })),
    )
        .into_response()
}

pub async fn remove_project_hook(
    State(state): State<Arc<AppState>>,
    Path((name, hook)): Path<(String, String)>,
) -> impl IntoResponse {
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let proj_idx = match settings
        .projects
        .iter()
        .position(|p| p.name.eq_ignore_ascii_case(&name))
    {
        Some(idx) => idx,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    let before = settings.projects[proj_idx].hooks.len();
    settings.projects[proj_idx]
        .hooks
        .retain(|h| !h.name.eq_ignore_ascii_case(&hook));

    if settings.projects[proj_idx].hooks.len() == before {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": format!("Hook '{}' not found in project '{}'", hook, name)
            })),
        )
            .into_response();
    }

    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(json!({
            "message": format!("Hook '{}' removed from project '{}'", hook, name)
        })),
    )
        .into_response()
}

pub async fn execute_review_action(
    State(state): State<Arc<AppState>>,
    Path((project_name, action_name)): Path<(String, String)>,
    Query(query): Query<ExecuteReviewActionParams>,
    body_bytes: axum::body::Bytes,
) -> impl IntoResponse {
    let body_params: Option<ExecuteReviewActionParams> = if !body_bytes.is_empty() {
        serde_json::from_slice(&body_bytes).ok()
    } else {
        None
    };

    let plan_id = body_params
        .as_ref()
        .and_then(|b| b.plan_id.as_ref())
        .or(query.plan_id.as_ref())
        .map(|p| p.to_string_val())
        .filter(|s| !s.trim().is_empty());

    let worktree = body_params
        .as_ref()
        .and_then(|b| b.worktree.clone())
        .or(query.worktree)
        .filter(|s| !s.trim().is_empty());

    let settings = load_config(&state.config_path).unwrap_or_default();
    let project = match settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&project_name))
    {
        Some(p) => p,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", project_name) })),
            )
                .into_response();
        }
    };

    let action = match project
        .review_actions
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case(&action_name))
    {
        Some(a) => a,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({
                    "error": format!(
                        "Review action '{}' not found for project '{}'",
                        action_name, project_name
                    )
                })),
            )
                .into_response();
        }
    };

    if action.command.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!("Review action '{}' has no command configured", action.name)
            })),
        )
            .into_response();
    }

    let working_dir: PathBuf = if let Some(ref pid) = plan_id {
        let plan_folder = match resolve_plan_folder(pid, &state.plans_dir) {
            Ok(f) => f,
            Err(_) => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(json!({ "error": format!("Plan '{}' not found", pid) })),
                )
                    .into_response();
            }
        };

        if action.command.contains("Worktrees/") || action.command.contains("cd Worktrees") {
            plan_folder
        } else if let Some(ref wt) = worktree {
            let candidate1 = plan_folder.join("Worktrees").join(wt);
            if candidate1.exists() {
                candidate1
            } else {
                let candidate2 = plan_folder.join(wt);
                if candidate2.exists() {
                    candidate2
                } else {
                    candidate1
                }
            }
        } else {
            let worktrees_dir = plan_folder.join("Worktrees");
            let mut resolved = plan_folder.clone();
            if worktrees_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&worktrees_dir) {
                    let mut subdirs: Vec<_> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| p.is_dir())
                        .collect();
                    subdirs.sort();
                    if subdirs.len() == 1 {
                        let single = &subdirs[0];
                        if let Ok(sub_entries) = std::fs::read_dir(single) {
                            let mut nested: Vec<_> = sub_entries
                                .filter_map(|e| e.ok())
                                .map(|e| e.path())
                                .filter(|p| {
                                    p.is_dir() && !p.file_name().is_some_and(|n| n == ".git")
                                })
                                .collect();
                            nested.sort();
                            if nested.len() == 1 {
                                resolved = nested[0].clone();
                            } else {
                                resolved = single.clone();
                            }
                        } else {
                            resolved = single.clone();
                        }
                    } else if !subdirs.is_empty() {
                        resolved = subdirs[0].clone();
                    }
                }
            }
            resolved
        }
    } else if let Some(first_repo) = project.repos.first() {
        let expanded = tendril_core::config::expand_variables(
            &first_repo.path,
            &state.tendril_home.to_string_lossy(),
        );
        PathBuf::from(expanded)
    } else {
        state.tendril_home.clone()
    };

    let mut cmd = if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", &action.command]);
        c
    } else {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", &action.command]);
        c
    };

    if working_dir.exists() {
        cmd.current_dir(&working_dir);
    }
    cmd.env("TENDRIL_HOME", &state.tendril_home);

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to spawn command: {}", e) })),
            )
                .into_response();
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (tx, mut rx) = tokio::sync::mpsc::channel::<
        Result<axum::response::sse::Event, std::convert::Infallible>,
    >(128);

    let stdout_handle = stdout.map(|out| {
        let tx_out = tx.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut lines = tokio::io::BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let evt = axum::response::sse::Event::default()
                    .event("log")
                    .data(line);
                if tx_out.send(Ok(evt)).await.is_err() {
                    break;
                }
            }
        })
    });

    let stderr_handle = stderr.map(|err| {
        let tx_err = tx.clone();
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut lines = tokio::io::BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let evt = axum::response::sse::Event::default()
                    .event("log")
                    .data(line);
                if tx_err.send(Ok(evt)).await.is_err() {
                    break;
                }
            }
        })
    });

    tokio::spawn(async move {
        if let Some(h) = stdout_handle {
            let _ = h.await;
        }
        if let Some(h) = stderr_handle {
            let _ = h.await;
        }
        let status = child.wait().await;
        let exit_msg = match status {
            Ok(s) => {
                if let Some(code) = s.code() {
                    format!("Process exited with code {}", code)
                } else {
                    "Process terminated by signal".to_string()
                }
            }
            Err(e) => format!("Process wait failed: {}", e),
        };
        let end_event = axum::response::sse::Event::default()
            .event("end")
            .data(exit_msg);
        let _ = tx.send(Ok(end_event)).await;
    });

    let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx));
    axum::response::sse::Sse::new(stream).into_response()
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
