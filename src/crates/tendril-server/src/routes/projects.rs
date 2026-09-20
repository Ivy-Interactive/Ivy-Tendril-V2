use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{
    expand_variables, insert_project_verification, load_config, move_project_verification,
    save_config, VerificationPlacement,
};
use tendril_core::db::open_database;
use tendril_core::git::clone::{
    import_remote_repo, is_remote_url, redact_credentials, CloneError, CloneFailure,
};
use tendril_core::git::sync::{diagnostic_prompt, sync_project, ProjectSyncResult};
use tendril_core::git::{query_project_issues, resolve_project_github_repos, IssueQueryParams};
use tendril_core::models::{
    AgentSecurityConfig, ExtraKeys, FileAccessRuleConfig, NetworkAccessRuleConfig,
    OutsideFileAccessPolicy, ProjectConfig, ProjectMcpServerRef, ProjectSkillRef,
    ProjectVerificationRef, PromptwareHookConfig, RepoRef, ReviewActionConfig, SandboxMode,
    SecurityPreset, TerminalAutoExecution,
};
use tendril_core::plans::helpers::resolve_plan_folder;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
                extra: Default::default(),
            },
            RepoInput::Object(r) => r,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum VerificationInput {
    String(String),
    Object(VerificationObjectInput),
}

/// A verification in a request body. `after` is a placement hint, not part of the stored
/// verification: it names the verification this one goes behind, and only the add endpoint reads
/// it — requests that supply the whole list already carry their own order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VerificationObjectInput {
    pub name: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    /// Unmodeled keys, carried onto the stored `ProjectVerificationRef`. A request that replaces the
    /// whole `verifications` list would otherwise drop any key this DTO does not name. `after` is
    /// modeled, so it stays a placement hint and never leaks into the persisted extras.
    #[serde(flatten)]
    pub extra: ExtraKeys,
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
                extra: Default::default(),
            },
            VerificationInput::Object(v) => ProjectVerificationRef {
                name: v.name,
                required: v.required,
                extra: v.extra,
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
    #[serde(rename = "mcpServers", alias = "mcp_servers", default)]
    pub mcp_servers: Vec<ProjectMcpServerRef>,
    #[serde(default)]
    pub skills: Vec<ProjectSkillRef>,
    /// The seven agent security controls. Flattened rather than nested, matching
    /// `ProjectConfig::security`'s own shape — a create payload sends `sandboxMode`,
    /// `securityPreset`, etc. as top-level keys, not under a `security` object.
    #[serde(flatten)]
    pub security: AgentSecurityConfig,
    /// Project keys this DTO does not name, persisted onto the new `ProjectConfig`.
    #[serde(flatten)]
    pub extra: ExtraKeys,
}

fn default_project_color() -> String {
    "Blue".to_string()
}

/// A partial update to a project's [`AgentSecurityConfig`]: every field is `Option`, and only the
/// ones a request body actually names get applied — see [`update_project`]. Flattened directly onto
/// [`UpdateProjectRequest`], the same shape as [`CreateProjectRequest::security`].
#[derive(Debug, Deserialize, Default)]
pub struct AgentSecurityPatch {
    #[serde(rename = "sandboxMode", alias = "sandbox_mode", default)]
    pub sandbox_mode: Option<SandboxMode>,
    #[serde(rename = "securityPreset", alias = "security_preset", default)]
    pub security_preset: Option<SecurityPreset>,
    #[serde(
        rename = "outsideFileAccessPolicy",
        alias = "outside_file_access_policy",
        default
    )]
    pub outside_file_access_policy: Option<OutsideFileAccessPolicy>,
    #[serde(rename = "filePermissions", alias = "file_permissions", default)]
    pub file_permissions: Option<Vec<FileAccessRuleConfig>>,
    #[serde(rename = "networkAccessRules", alias = "network_access_rules", default)]
    pub network_access_rules: Option<Vec<NetworkAccessRuleConfig>>,
    #[serde(
        rename = "allowedTerminalCommands",
        alias = "allowed_terminal_commands",
        default
    )]
    pub allowed_terminal_commands: Option<Vec<String>>,
    #[serde(
        rename = "terminalAutoExecution",
        alias = "terminal_auto_execution",
        default
    )]
    pub terminal_auto_execution: Option<TerminalAutoExecution>,
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
    #[serde(rename = "mcpServers", alias = "mcp_servers")]
    pub mcp_servers: Option<Vec<ProjectMcpServerRef>>,
    pub skills: Option<Vec<ProjectSkillRef>>,
    #[serde(flatten)]
    pub security: AgentSecurityPatch,
    /// Project keys this DTO does not name. These are **merged** key-by-key into the stored
    /// project's `extra` rather than replacing the map — that is what makes a partial PUT safe: a
    /// payload naming one key must not clear the others. Keys this DTO does name (`name`, `newName`,
    /// `color`, `repos`, the security fields, …) never land here.
    #[serde(flatten)]
    pub extra: ExtraKeys,
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
/// Turns every remote URL among `repos` into the local clone it now points at, leaving local paths
/// exactly as written.
///
/// This is V1's `OnboardingRepoHelper.ResolveReposAsync`, and the reason it exists is the same: a
/// URL in `config.yaml` is a project nothing downstream can use, because `resolve_working_directory`
/// only ever picks a repo path that `is_dir()`. The clone happens before `save_config`, so a
/// failure leaves no half-written project behind.
///
/// `base_branch` is filled in from the clone's own HEAD when the caller did not supply one — the
/// same fact V1 gets from a pre-clone `ls-remote --symref`, without the extra round trip.
///
/// Cloning shells out to `git clone`, which can run for minutes on a large repository, so the whole
/// pass runs off the async runtime — the precedent [`sync_project_repos`] sets for `git fetch`.
async fn materialize_repos(
    tendril_home: PathBuf,
    project_name: String,
    repos: Vec<RepoRef>,
) -> Result<MaterializedRepos, CloneError> {
    // A path git would read as an option is refused whether or not it looks like a remote: it has
    // no scheme, so it reaches here as a "local path", and nothing downstream would treat it as one.
    if let Some(repo) = repos.iter().find(|r| r.path.trim().starts_with('-')) {
        return Err(CloneError {
            kind: CloneFailure::InvalidUrl,
            message: format!(
                "'{}' is not a valid repository path: it starts with a dash, which git would read as an option.",
                redact_credentials(repo.path.trim())
            ),
        });
    }

    // A relative local path is refused rather than stored, because nothing downstream can turn it
    // back into the directory the caller meant. Every consumer -- `resolve_working_directory`,
    // `resolve_project_github_repos` -- expands the stored string and then asks `is_dir()`, and
    // `is_dir()` resolves a relative path against *this process's* working directory: wherever the
    // daemon happened to be started, which is neither the client's directory nor TENDRIL_HOME. A
    // daemon launched from a checkout resolves a stored `..` to that checkout's parent, so the
    // project silently points at a directory nobody chose and the mistake only surfaces later, as
    // jobs running in the wrong tree.
    //
    // V1 never had the hole: `RepoPathValidator.IsLocalPath` accepts only an absolute path, a `~`
    // one, or a drive letter, and the app still enforces that port of it in
    // `views/onboarding/validation.ts`. This closes the same gap for the callers the app does not
    // own -- the HTTP API, the CLI's daemon path and MCP -- which reach these routes directly.
    //
    // Checked *after* expansion, the same expansion the consumers run before they resolve, so
    // `~/repos/x` and `%TENDRIL_HOME%/Projects/...` stay exactly as acceptable here as they are
    // there. An empty path is left to the per-route emptiness checks, so this guard's message is
    // only ever shown for a path that really does name something relative.
    let home_str = tendril_home.to_string_lossy().to_string();
    if let Some(repo) = repos.iter().find(|r| {
        let raw = r.path.trim();
        !raw.is_empty()
            && !is_remote_url(raw)
            && !std::path::Path::new(&expand_variables(raw, &home_str)).is_absolute()
    }) {
        return Err(CloneError {
            kind: CloneFailure::InvalidUrl,
            message: format!(
                "'{}' is not a valid repository path: it is relative, so it would resolve against the daemon's own working directory rather than against anything you chose. Use an absolute path.",
                redact_credentials(repo.path.trim())
            ),
        });
    }

    if !repos.iter().any(|r| is_remote_url(&r.path)) {
        return Ok(MaterializedRepos {
            repos,
            created: Vec::new(),
        });
    }

    let joined = tokio::task::spawn_blocking(move || {
        let mut resolved = Vec::with_capacity(repos.len());
        let mut created = Vec::new();
        for repo in repos {
            if !is_remote_url(&repo.path) {
                resolved.push(repo);
                continue;
            }
            let cloned = match import_remote_repo(&tendril_home, &project_name, &repo.path) {
                Ok(cloned) => cloned,
                // One remote in a list of three failing still leaves the first two on disk with
                // nothing about to reference them, so the partial pass rolls itself back before it
                // reports — the same rule the handlers below apply to their own later failures.
                Err(e) => {
                    remove_cloned_repos(&created);
                    return Err(e);
                }
            };
            if !cloned.refreshed {
                created.push(cloned.path.clone());
            }
            resolved.push(RepoRef {
                path: cloned.path.to_string_lossy().to_string(),
                base_branch: repo.base_branch.or(cloned.default_branch),
                extra: repo.extra,
            });
        }
        Ok(MaterializedRepos {
            repos: resolved,
            created,
        })
    })
    .await;

    match joined {
        Ok(result) => result,
        Err(e) => Err(CloneError {
            kind: CloneFailure::GitFailed,
            // The join error carries the panic payload, never a URL, so there is nothing to redact.
            message: format!("The repository clone task failed: {e}"),
        }),
    }
}

/// What [`materialize_repos`] resolved, and what it had to create on disk to do it.
///
/// `created` is the rollback list, and it holds only the clones this pass *made*. A remote that was
/// already there was refreshed rather than cloned (V1's pull-instead-of-clone), and that directory
/// belongs to whoever imported it first — deleting it because a later, unrelated step failed would
/// destroy a repository the operator is using. `ClonedRepo::refreshed` is the only thing that can
/// tell the two apart, which is why the flag is threaded out to here.
struct MaterializedRepos {
    repos: Vec<RepoRef>,
    /// Clone directories this pass created, in the order it created them.
    created: Vec<PathBuf>,
}

/// Deletes the clones a request created, for a request that is about to fail.
///
/// The failure paths below all end with a handler returning an error status and writing nothing, so
/// without this the clone tree stays under `<TendrilHome>/Projects/<name>/Repos/` with nothing in
/// `config.yaml` naming it: invisible to the app, counted by nothing, and re-cloned on the next
/// attempt. The sequence that makes it two trees rather than one is the app's own 600s clone
/// timeout firing on a create the daemon then completes — the wizard reports failure, the operator
/// presses Create Project again, and the second attempt hits the post-clone duplicate check.
///
/// Best-effort by design: a clone that cannot be removed is logged and the original failure is
/// still what the caller reports, because the operator needs to hear why their request failed, not
/// why the cleanup after it did.
fn remove_cloned_repos(created: &[PathBuf]) {
    for path in created {
        if let Err(e) = std::fs::remove_dir_all(path) {
            // `NotFound` is the expected case when a previous cleanup already ran, not a problem.
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(
                    "Could not remove the clone at {} after a failed request: {}",
                    path.display(),
                    e
                );
            }
        }
    }
}

/// The status each failure deserves: the request was wrong (400), the disk is already occupied
/// (409), the remote took too long (504), or it would not cooperate (502). The message is already
/// redacted.
fn clone_error_response(err: CloneError) -> axum::response::Response {
    let status = match err.kind {
        CloneFailure::InvalidUrl => StatusCode::BAD_REQUEST,
        CloneFailure::DestinationConflict => StatusCode::CONFLICT,
        // 504 rather than 502: the upstream answered, it just never finished. Split out because
        // "try again" is reasonable advice for this one and is not for a 502.
        CloneFailure::TimedOut => StatusCode::GATEWAY_TIMEOUT,
        CloneFailure::Unreachable | CloneFailure::AuthRequired | CloneFailure::GitFailed => {
            StatusCode::BAD_GATEWAY
        }
    };
    (status, Json(json!({ "error": err.message }))).into_response()
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

    // The duplicate check runs twice on purpose. Once here, so a clone that can take minutes is
    // never started for a name that is already taken, and again after it, because the file this
    // handler is about to rewrite may have moved on while the clone ran.
    let settings = match load_config(&state.config_path) {
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
    // Everything past this point can fail with clones already on disk, so every error return below
    // rolls them back first. Without that, the failure leaves a repository tree under
    // `Projects/<name>/Repos/` that no `config.yaml` entry names and nothing will ever clean up.
    let materialized =
        match materialize_repos(state.tendril_home.clone(), name.clone(), repos).await {
            Ok(materialized) => materialized,
            // `materialize_repos` already rolled back whatever it created before it failed.
            Err(e) => return clone_error_response(e),
        };
    let created = materialized.created;

    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            remove_cloned_repos(&created);
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
        // The project appeared while the clone ran — most often this same request retried after the
        // app's 600s clone timeout fired on a create the daemon went on to finish. The clone this
        // attempt made is a second copy of a repository the winning attempt already has, so it goes.
        remove_cloned_repos(&created);
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": format!("Project '{}' already exists", name) })),
        )
            .into_response();
    }

    let verifications: Vec<ProjectVerificationRef> =
        req.verifications.into_iter().map(Into::into).collect();

    let project = ProjectConfig {
        name,
        color,
        repos: materialized.repos,
        verifications,
        context: req.context,
        stack_hash: req.stack_hash,
        review_actions: req.review_actions,
        hooks: req.hooks,
        build_dependencies: req.build_dependencies,
        mcp_servers: req.mcp_servers,
        skills: req.skills,
        security: req.security,
        extra: req.extra,
        ..Default::default()
    };

    settings.projects.push(project.clone());
    if let Err(e) = save_config(&state.config_path, &settings) {
        remove_cloned_repos(&created);
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
    let settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    if !settings
        .projects
        .iter()
        .any(|p| p.name.eq_ignore_ascii_case(&name))
    {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", name) })),
        )
            .into_response();
    }

    // Validated against the pre-clone snapshot so an empty or already-taken name is refused before
    // a clone that can take minutes is started, and validated again after it against the file this
    // handler will actually write.
    let rename_target = req.new_name.or(req.name);
    let mut renamed_to: Option<String> = None;
    if let Some(target) = rename_target.as_deref() {
        let trimmed = target.trim();
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
                .any(|p| p.name.eq_ignore_ascii_case(trimmed))
        {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": format!("Project '{}' already exists", trimmed) })),
            )
                .into_response();
        }
        if !trimmed.eq_ignore_ascii_case(&name) {
            renamed_to = Some(trimmed.to_string());
        }
    }

    // A PUT replaces the repository list wholesale, so it is a way into `config.yaml` for a URL
    // just as much as the create and add-repo routes are. Resolved against the project's *new* name
    // when this same request renames it, so the clone does not land under a directory that is about
    // to stop existing. Entries already local short-circuit, which is every PUT after the first.
    //
    // It runs here, against nothing but the snapshot above, because the settings this handler saves
    // have to be read *after* it. The clone can take minutes, `config.yaml` is written by the
    // `tendril` CLI too — which is how an `AddProject` run records the verifications and review
    // actions it derives — and a handler that mutated a pre-clone copy and saved it afterwards
    // erased every one of those writes. [`create_project`] and [`add_project_repo`] re-read for the
    // same reason; this one is the third.
    let materialized = match req.repos {
        Some(repos) => {
            let repos: Vec<RepoRef> = repos.into_iter().map(Into::into).collect();
            let project_name = renamed_to.clone().unwrap_or_else(|| name.clone());
            match materialize_repos(state.tendril_home.clone(), project_name, repos).await {
                Ok(materialized) => Some(materialized),
                Err(e) => return clone_error_response(e),
            }
        }
        None => None,
    };
    let created: Vec<PathBuf> = materialized
        .as_ref()
        .map(|m| m.created.clone())
        .unwrap_or_default();

    // The re-read. Everything from here down applies this request's fields to what is on disk now,
    // not to the copy loaded above.
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            remove_cloned_repos(&created);
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
            // 409, not 404: the project was there when the request was accepted and is not now, so
            // this is a conflict with whatever deleted or renamed it rather than a bad URL. Writing
            // the project back under its old name would resurrect one the operator just removed.
            remove_cloned_repos(&created);
            return (
                StatusCode::CONFLICT,
                Json(json!({
                    "error": format!(
                        "Project '{}' was deleted or renamed while its repositories were being cloned. Nothing was changed.",
                        name
                    )
                })),
            )
                .into_response();
        }
    };

    if let Some(new_name) = renamed_to.as_deref() {
        // Re-checked against the re-read file: the name this request wants may have been taken by
        // something else while the clone ran.
        if settings
            .projects
            .iter()
            .enumerate()
            .any(|(idx, p)| idx != proj_idx && p.name.eq_ignore_ascii_case(new_name))
        {
            remove_cloned_repos(&created);
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": format!("Project '{}' already exists", new_name) })),
            )
                .into_response();
        }
    }

    if let Some(target) = rename_target {
        settings.projects[proj_idx].name = target.trim().to_string();
    }

    if let Some(color) = req.color {
        let trimmed = color.trim().to_string();
        if !trimmed.is_empty() {
            settings.projects[proj_idx].color = trimmed;
        }
    }

    if let Some(materialized) = materialized {
        settings.projects[proj_idx].repos = materialized.repos;
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

    if let Some(mcp_servers) = req.mcp_servers {
        settings.projects[proj_idx].mcp_servers = mcp_servers;
    }

    if let Some(skills) = req.skills {
        settings.projects[proj_idx].skills = skills;
    }

    // Applied one field at a time, same reasoning as every other `Option` field above: a payload
    // naming one security setting must not reset the others to default.
    if let Some(sandbox_mode) = req.security.sandbox_mode {
        settings.projects[proj_idx].security.sandbox_mode = sandbox_mode;
    }
    if let Some(security_preset) = req.security.security_preset {
        settings.projects[proj_idx].security.security_preset = security_preset;
    }
    if let Some(outside_file_access_policy) = req.security.outside_file_access_policy {
        settings.projects[proj_idx]
            .security
            .outside_file_access_policy = outside_file_access_policy;
    }
    if let Some(file_permissions) = req.security.file_permissions {
        settings.projects[proj_idx].security.file_permissions = file_permissions;
    }
    if let Some(network_access_rules) = req.security.network_access_rules {
        settings.projects[proj_idx].security.network_access_rules = network_access_rules;
    }
    if let Some(allowed_terminal_commands) = req.security.allowed_terminal_commands {
        settings.projects[proj_idx]
            .security
            .allowed_terminal_commands = allowed_terminal_commands;
    }
    if let Some(terminal_auto_execution) = req.security.terminal_auto_execution {
        settings.projects[proj_idx].security.terminal_auto_execution = terminal_auto_execution;
    }

    // Merged, not assigned: a payload naming one unmodeled key must not clear the ones it omits.
    // An empty map is therefore a no-op rather than a wipe.
    if !req.extra.is_empty() {
        settings.projects[proj_idx].extra.extend(req.extra);
    }

    let updated_project = settings.projects[proj_idx].clone();
    if let Err(e) = save_config(&state.config_path, &settings) {
        // Nothing on disk now points at the clone this request made, so it goes with the request.
        remove_cloned_repos(&created);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to save config: {}", e) })),
        )
            .into_response();
    }

    // The rename is already committed to `config.yaml` at this point, so both cascades are
    // best-effort in the same sense as `remove_cloned_repos`: the operator's request succeeded and
    // a 200 is the honest status. What they are *not* is silent. Every failure here leaves plans,
    // jobs or recommendations naming a project `config.yaml` no longer has, and a retry cannot
    // repair it — the second rename finds the old name gone, computes `renamed_to = None`, and
    // skips this block entirely. A log line is the only record that the orphan exists.
    //
    // It has to be a log line rather than a field on the response: `UpdateProjectRequest` flattens
    // unrecognised keys into `extra`, so a `warning` key handed to a client that PUTs the project
    // back would be written into `config.yaml` as a project setting.
    if let Some(new_name) = renamed_to {
        match tendril_core::plans::rename_project_in_plans(&state.plans_dir, &name, &new_name) {
            Ok(outcome) if outcome.is_partial() => {
                tracing::warn!(
                    "Renamed project '{}' to '{}' but {}: {}",
                    name,
                    new_name,
                    outcome.failure_summary(),
                    outcome
                        .failed
                        .iter()
                        .map(|(folder, why)| format!("{folder}: {why}"))
                        .collect::<Vec<_>>()
                        .join("; ")
                );
            }
            Ok(_) => {}
            Err(e) => {
                tracing::warn!(
                    "Renamed project '{}' to '{}' but could not sweep the plans directory {}: {}. Plans still name the old project.",
                    name,
                    new_name,
                    state.plans_dir.display(),
                    e
                );
            }
        }

        match open_database(&state.db_path) {
            Ok(conn) => {
                if let Err(e) = tendril_core::db::rename_project(&conn, &name, &new_name) {
                    tracing::warn!(
                        "Renamed project '{}' to '{}' but could not update the database: {}. Plans, jobs and recommendations still name the old project.",
                        name,
                        new_name,
                        e
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    "Renamed project '{}' to '{}' but could not open the database: {}. Plans, jobs and recommendations still name the old project.",
                    name,
                    new_name,
                    e
                );
            }
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

/// `POST /api/projects/:name/repos` — adds one repository, cloning it first when it is a URL.
///
/// Same contract as [`create_project`]: what is stored is a path on disk, never a URL.
pub async fn add_project_repo(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Json(input): Json<RepoInput>,
) -> impl IntoResponse {
    let settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Failed to load config: {}", e) })),
            )
                .into_response();
        }
    };

    let Some(project) = settings
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
    let project_name = project.name.clone();

    let repo_ref: RepoRef = input.into();
    if repo_ref.path.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Repo path cannot be empty" })),
        )
            .into_response();
    }

    // The URL is deduped before the clone as well as the path after it, so pasting the same remote
    // twice answers from config instead of going back to the network.
    if let Some(existing) = project
        .repos
        .iter()
        .find(|r| r.path.eq_ignore_ascii_case(&repo_ref.path))
    {
        return (StatusCode::OK, Json(json!(existing))).into_response();
    }

    let mut materialized = match materialize_repos(
        state.tendril_home.clone(),
        project_name.clone(),
        vec![repo_ref],
    )
    .await
    {
        Ok(materialized) => materialized,
        Err(e) => return clone_error_response(e),
    };
    let created = std::mem::take(&mut materialized.created);
    let repo_ref = materialized.repos.remove(0);

    // Re-read: the clone may have run for minutes, and this handler is about to rewrite the file.
    let mut settings = match load_config(&state.config_path) {
        Ok(s) => s,
        Err(e) => {
            remove_cloned_repos(&created);
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
            remove_cloned_repos(&created);
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": format!("Project '{}' not found", name) })),
            )
                .into_response();
        }
    };

    if let Some(existing) = settings.projects[proj_idx]
        .repos
        .iter()
        .find(|r| r.path.eq_ignore_ascii_case(&repo_ref.path))
    {
        // The same remote was added by something else while this clone ran, and it resolved to the
        // same directory. The clone is kept: it *is* the repository the config now points at, and
        // it was a refresh of that directory rather than a second copy.
        return (StatusCode::OK, Json(json!(existing))).into_response();
    }

    settings.projects[proj_idx].repos.push(repo_ref.clone());
    if let Err(e) = save_config(&state.config_path, &settings) {
        remove_cloned_repos(&created);
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

#[derive(Debug, Deserialize, Default)]
pub struct SyncReposParams {
    /// Narrows the pass to one repo, matched the way `tendril project sync --repo` matches: by
    /// configured path, expanded path, or final path segment.
    pub repo: Option<String>,
}

/// One repository's outcome. `diagnosticPrompt` is present exactly when `canFixWithAgent` is set,
/// so a client can offer "Fix with Agent" without composing the prompt itself — the wording is a
/// contract shared with the CLI and must not be re-derived per client.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSyncResultDto {
    pub repo_path: String,
    pub base_branch: Option<String>,
    pub success: bool,
    pub message: String,
    pub git_error_details: Option<String>,
    pub can_fix_with_agent: bool,
    pub diagnostic_prompt: Option<String>,
    /// Commit counts on each side, set only when the refusal was a genuine divergence.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub diverged: bool,
}

impl From<&ProjectSyncResult> for RepoSyncResultDto {
    fn from(result: &ProjectSyncResult) -> Self {
        Self {
            repo_path: result.repo_path.clone(),
            base_branch: result.base_branch.clone(),
            success: result.success,
            message: result.message.clone(),
            git_error_details: result.git_error_details.clone(),
            can_fix_with_agent: result.can_fix_with_agent,
            diagnostic_prompt: result.can_fix_with_agent.then(|| diagnostic_prompt(result)),
            ahead: result.divergence.map(|d| d.ahead),
            behind: result.divergence.map(|d| d.behind),
            diverged: result.divergence.is_some(),
        }
    }
}

/// `POST /api/projects/:name/sync` — fast-forwards each of a project's repos onto its base branch,
/// and hands back the escalation for the ones it refused.
///
/// The refusals are the point. A dirty tree, a feature branch, a detached HEAD or a diverged history
/// all stop the pass for that repo with `canFixWithAgent` and a ready-made `diagnosticPrompt`; the
/// daemon never reconciles any of them, because a divergence has no safe automatic answer. Nothing
/// in this path force-pushes, resets, deletes a branch, or discards uncommitted work.
///
/// A repo that failed is reported in the body, not as an HTTP error: the caller asked about every
/// repo, and a 500 would throw away the results for the ones that succeeded. `success` is the
/// whole-pass verdict.
pub async fn sync_project_repos(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Query(params): Query<SyncReposParams>,
) -> impl IntoResponse {
    let settings = load_config(&state.config_path).unwrap_or_default();
    let Some(project) = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&name))
        .cloned()
    else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("Project '{}' not found", name) })),
        )
            .into_response();
    };

    if project.repos.is_empty() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "No repositories found in project.",
                "total": 0,
                "failed": 0,
                "results": Vec::<RepoSyncResultDto>::new(),
            })),
        )
            .into_response();
    }

    // `sync_project` shells out to `git fetch`, which can take tens of seconds per repo, so it runs
    // off the async runtime rather than blocking a worker thread for the whole pass.
    let repo_filter = params.repo.clone();
    let tendril_home = state.tendril_home.clone();
    let joined = tokio::task::spawn_blocking(move || {
        sync_project(&project, repo_filter.as_deref(), &tendril_home)
    })
    .await;

    let results = match joined {
        Ok(results) => results,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Repository sync task panicked: {}", e) })),
            )
                .into_response();
        }
    };

    if results.is_empty() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "No matching repositories found to sync.",
                "total": 0,
                "failed": 0,
                "results": Vec::<RepoSyncResultDto>::new(),
            })),
        )
            .into_response();
    }

    let dtos: Vec<RepoSyncResultDto> = results.iter().map(RepoSyncResultDto::from).collect();
    let failed = dtos.iter().filter(|r| !r.success).count();

    (
        StatusCode::OK,
        Json(json!({
            "success": failed == 0,
            "total": dtos.len(),
            "failed": failed,
            "results": dtos,
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
            extra: Default::default(),
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
        extra: Default::default(),
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

    // Everything from here on is the plan's ports and environment, then the pty. The resolution
    // above — project, action, working directory — is all this route still does itself.
    let plan_folder = plan_id
        .as_deref()
        .and_then(|pid| resolve_plan_folder(pid, &state.plans_dir).ok());
    let plan_yaml = plan_folder
        .as_deref()
        .and_then(|folder| tendril_core::plans::reader::read_plan_yaml(folder).ok())
        .map(|(plan, _)| plan);

    let ports = crate::pty::resolve_ports(
        Some(project),
        plan_yaml.as_ref().and_then(|p| p.allocated_ports.as_ref()),
    );
    // `sh` will not expand `%PORT%`, so the command has to carry the resolved values before it is
    // handed over; the injected environment covers only what the command reads itself.
    let command = crate::pty::interpolate_command(&action.command, &ports);

    // `PLAN_ID` is the padded form a plan is known by everywhere else, so a review action can build
    // a path out of it.
    let padded_plan_id = plan_id.as_deref().map(|pid| {
        let trimmed = pid.trim();
        trimmed
            .parse::<u32>()
            .map(|n| format!("{n:05}"))
            .unwrap_or_else(|_| trimmed.to_string())
    });
    let plan_context = match (
        padded_plan_id.as_deref(),
        plan_folder.as_deref(),
        plan_yaml.as_ref(),
    ) {
        (Some(id), Some(folder), Some(plan)) => Some(crate::pty::PlanEnvContext {
            plan_id: id,
            plan_folder: folder,
            project: &project.name,
            repos: &plan.repos,
        }),
        _ => None,
    };

    let mut env = vec![(
        "TENDRIL_HOME".to_string(),
        state.tendril_home.to_string_lossy().to_string(),
    )];
    env.extend(crate::pty::build_environment(
        &ports,
        plan_context.as_ref(),
        Some(&project.name),
    ));

    let stream = match crate::pty::spawn_review_action(
        &command,
        working_dir.exists().then_some(working_dir.as_path()),
        &env,
    ) {
        Ok(stream) => stream,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e })),
            )
                .into_response();
        }
    };

    let mut frames = stream.frames;
    let body = futures_util::stream::poll_fn(move |cx| frames.poll_recv(cx));
    axum::response::sse::Sse::new(body).into_response()
}

/// Keystrokes for a running review action, addressed by the session id from its `meta` frame.
///
/// `data` is base64 for the same reason the `log` frames are: an arrow key or a Ctrl-C is a control
/// byte, and round-tripping those through JSON as text loses them.
#[derive(Debug, Deserialize)]
pub struct ReviewActionInputRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(default)]
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct ReviewActionResizeRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    pub rows: u16,
    pub cols: u16,
}

/// Writes the client's keystrokes into the action's pty.
///
/// The project and action in the path are not what identifies the target — the session id is, so two
/// runs of the same action never write into each other. They stay in the path so this sits beside
/// `execute` rather than in a namespace of its own.
pub async fn review_action_input(
    Path((_project_name, _action_name)): Path<(String, String)>,
    Json(request): Json<ReviewActionInputRequest>,
) -> impl IntoResponse {
    let Some(session) = crate::pty::session(&request.session_id) else {
        return session_not_found(&request.session_id);
    };

    let bytes = match base64::engine::general_purpose::STANDARD.decode(request.data.as_bytes()) {
        Ok(bytes) => bytes,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("Input data is not valid base64: {}", e) })),
            )
                .into_response();
        }
    };

    match session.write_input(&bytes) {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ok" }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to write to the terminal: {}", e) })),
        )
            .into_response(),
    }
}

/// Tells the action's pty how big the client's terminal is, which is what makes a process that
/// wraps its own output redraw to fit.
pub async fn review_action_resize(
    Path((_project_name, _action_name)): Path<(String, String)>,
    Json(request): Json<ReviewActionResizeRequest>,
) -> impl IntoResponse {
    let Some(session) = crate::pty::session(&request.session_id) else {
        return session_not_found(&request.session_id);
    };

    // A zero dimension is what a client sends before its terminal has been laid out; applying it
    // would tell the process it has no window at all.
    if request.rows == 0 || request.cols == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Terminal size must be at least 1x1" })),
        )
            .into_response();
    }

    match session.resize(request.rows, request.cols) {
        Ok(()) => (StatusCode::OK, Json(json!({ "status": "ok" }))).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Failed to resize the terminal: {}", e) })),
        )
            .into_response(),
    }
}

/// A session that has exited is indistinguishable from one that never existed, and both are a `404`
/// rather than an error: a client racing the `end` frame has done nothing wrong.
fn session_not_found(session_id: &str) -> axum::response::Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": format!("Review action session '{}' is not running", session_id)
        })),
    )
        .into_response()
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
