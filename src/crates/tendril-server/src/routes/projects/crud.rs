//! The project record itself: list, read, create, update and delete.

use super::cloning::{clone_error_response, materialize_repos, remove_cloned_repos};
use super::payloads::{CreateProjectRequest, UpdateProjectRequest};
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_project_root_dir, load_config, sanitize_project_name, save_config};
use tendril_core::db::open_database;
use tendril_core::git::{query_project_issues, resolve_project_github_repos, IssueQueryParams};
use tendril_core::models::{ProjectConfig, ProjectVerificationRef, RepoRef};
use tendril_core::plans::delete_project_plans;

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

/// `DELETE /api/projects/:name` — **forget** the project, keeping everything it owns.
///
/// The config entry and nothing else: no `fs::` call, no database write. The clones under
/// `<TENDRIL_HOME>/Projects/<name>/`, the plan folders, and the rows in `Plans`, `Jobs` and
/// `Recommendations` all survive, which is why the reply says *removed* rather than *deleted*.
///
/// This route exists at all because `PUT /api/config` cannot express it: the merge reads an omitted
/// project as unchanged, never as deleted.
///
/// For the destructive one, see [`purge_project`].
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

/// `DELETE /api/projects/:name/data` — remove the project **and** what it owns on disk.
///
/// The destructive half of the Danger Zone, and the reason [`delete_project`] was renamed to
/// "Remove" in the UI rather than given a flag: they are different operations with different
/// consequences, and a boolean on one route makes the safe one a keystroke from the unsafe one.
///
/// What goes, in this order — filesystem first, config entry last:
///
/// 1. Every plan folder whose `plan.yaml` names the project, worktrees cleaned before each folder
///    ([`delete_project_plans`]).
/// 2. `<TENDRIL_HOME>/Projects/<sanitized name>/`, which is where the daemon's clones, skills, MCP
///    definitions and memories live.
/// 3. The rows in `Plans`, `Jobs` and `Recommendations` ([`tendril_core::db::delete_project`]).
/// 4. The `config.yaml` entry.
///
/// Config last is deliberate. If the process dies partway, a project still listed with some of its
/// data gone is recoverable — the operator can see it and ask again. A config entry removed first
/// would leave orphaned directories nothing in the UI can name, which is the state
/// `delete_plan_handler` orders its own steps to avoid.
///
/// **What stays:** the job logs under `<TENDRIL_HOME>/Logs/Jobs/`. They are keyed by job id, not by
/// project, and the codebase already keeps them when a job row is deleted — a job's log "is not the
/// forensic record of what it did" only while the row exists. Deleting a project should not quietly
/// change that rule, so the dialog says they stay rather than this route removing them.
///
/// **Guards**, modelled on `delete_plan_handler`:
/// - 404 when no project of that name is in `config.yaml`, so this cannot be used to delete a
///   directory that is not a project's.
/// - 400 on a name that sanitizes to nothing. `get_project_root_dir` returns the bare `Projects`
///   directory for an empty name, so without this a project named `"  "` or `"///"` would take
///   every project's data with it.
/// - 400 unless the resolved directory is strictly inside `<TENDRIL_HOME>/Projects`, the same
///   canonicalize-and-contain check, for the same reason: this is the call site of a
///   `remove_dir_all`.
/// - 409 while a non-terminal job names the project. Deleting the worktrees out from under a
///   running agent is the one failure that is not merely destructive but confusing, and the plan
///   route already refuses its own version of it.
///
/// A step that fails after an earlier one succeeded is reported, not rolled back — nothing here can
/// be un-deleted. The reply names what was removed so a partial result is visible rather than read
/// as a clean sweep.
pub async fn purge_project(
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

    // The stored spelling, not the caller's: the path is derived from it, and the lookup above is
    // case-insensitive.
    let stored_name = settings.projects[proj_idx].name.clone();

    if sanitize_project_name(&stored_name).is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": format!(
                    "Refusing to delete the data of project '{}': its name contains no character that maps to a directory, so it has no data directory of its own",
                    stored_name
                )
            })),
        )
            .into_response();
    }

    match state.job_manager.list_non_terminal_jobs().await {
        Ok(jobs) => {
            let holders: Vec<String> = jobs
                .iter()
                .filter(|j| j.project.eq_ignore_ascii_case(&stored_name))
                .map(|j| j.id.clone())
                .collect();
            if !holders.is_empty() {
                return (
                    StatusCode::CONFLICT,
                    Json(json!({
                        "error": format!(
                            "Project '{}' has {} job(s) still running ({}): cancel them before deleting its data",
                            stored_name,
                            holders.len(),
                            holders.join(", ")
                        )
                    })),
                )
                    .into_response();
            }
        }
        Err(e) => {
            // Not fatal on its own, but it is the guard against deleting a running agent's
            // worktrees, so it is refused rather than skipped.
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": format!("Could not check for running jobs before deleting: {}", e)
                })),
            )
                .into_response();
        }
    }

    let projects_root = state.tendril_home.join("Projects");
    let project_dir = get_project_root_dir(&state.tendril_home, &stored_name);

    // Canonicalize both before comparing, as `delete_plan_handler` does: a symlinked TENDRIL_HOME
    // otherwise compares a resolved path against an unresolved root and fails a containment check
    // it should pass. `starts_with` on `Path` compares whole components, so a sibling sharing a name
    // prefix cannot satisfy it.
    if project_dir.exists() {
        let resolved_root =
            std::fs::canonicalize(&projects_root).unwrap_or_else(|_| projects_root.clone());
        let resolved_dir =
            std::fs::canonicalize(&project_dir).unwrap_or_else(|_| project_dir.clone());
        if !resolved_dir.starts_with(&resolved_root) || resolved_dir == resolved_root {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": format!(
                        "Refusing to delete '{}': it is not a project directory inside {}",
                        resolved_dir.display(),
                        resolved_root.display()
                    )
                })),
            )
                .into_response();
        }
    }

    let mut warnings: Vec<String> = Vec::new();

    let plans_deleted = match delete_project_plans(&state.plans_dir, &stored_name) {
        Ok(outcome) => {
            if outcome.is_partial() {
                warnings.push(outcome.failure_summary());
            }
            outcome.deleted
        }
        Err(e) => {
            warnings.push(format!(
                "could not enumerate the plans directory {}: {e}",
                state.plans_dir.display()
            ));
            0
        }
    };

    let mut directory_removed = false;
    if project_dir.exists() {
        match std::fs::remove_dir_all(&project_dir) {
            Ok(()) => directory_removed = true,
            Err(e) => warnings.push(format!(
                "could not remove the project directory {}: {e}",
                project_dir.display()
            )),
        }
    }

    match open_database(&state.db_path) {
        Ok(conn) => {
            if let Err(e) = tendril_core::db::delete_project(&conn, &stored_name) {
                warnings.push(format!("could not remove the database rows: {e}"));
            }
        }
        Err(e) => warnings.push(format!("could not open the database: {e}")),
    }

    settings.projects.remove(proj_idx);
    if let Err(e) = save_config(&state.config_path, &settings) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": format!(
                    "Removed the data of project '{}' but failed to save config: {}",
                    stored_name, e
                )
            })),
        )
            .into_response();
    }

    let message = if warnings.is_empty() {
        format!("Project '{}' and its data were deleted", stored_name)
    } else {
        format!(
            "Project '{}' was deleted, but some of its data could not be removed: {}",
            stored_name,
            warnings.join("; ")
        )
    };

    (
        StatusCode::OK,
        Json(json!({
            "message": message,
            "plansDeleted": plans_deleted,
            "directoryRemoved": directory_removed,
            "warnings": warnings,
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
