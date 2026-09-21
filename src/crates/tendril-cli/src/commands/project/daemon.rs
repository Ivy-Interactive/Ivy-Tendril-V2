//! The daemon path: every subcommand the running daemon can serve, sent over HTTP.
//!
//! This is tried first so a running daemon stays the single writer of `config.yaml`. A subcommand
//! the daemon cannot serve, or an unreachable daemon, returns [`DaemonOutcome::Fallback`] and
//! [`super::handle_project_command`] re-runs it against the filesystem instead.

use super::edits::{
    add_build_dependency, add_mcp_server, add_project_skill, print_mcp_servers, print_project,
    print_project_skills, remove_build_dependency, remove_mcp_server, remove_project_skill,
    resolve_placement,
};
use super::print_hooks;
use super::ProjectCommands;
use std::path::Path;
use std::time::Duration;
use tendril_core::config::{MasterInfo, VerificationPlacement};
use tendril_core::git::clone::redact_credentials;
use tendril_core::http::{
    classify_transport_error, daemon_client_with_timeout_and_master, daemon_request_timeout_for,
    describe_transport_error, DaemonTransportFailure,
};
use tendril_core::models::ProjectConfig;

pub(super) enum DaemonOutcome {
    Handled,
    Fallback,
}

/// A daemon call that failed at the transport level.
///
/// Only an unreachable daemon may fall back to `config.yaml`: a timed-out mutation may already have
/// been applied by the daemon, and applying it locally too would apply it twice.
fn fallback_or_fail(
    err: reqwest::Error,
    master: &MasterInfo,
    timeout: Option<Duration>,
) -> anyhow::Result<DaemonOutcome> {
    match classify_transport_error(&err) {
        DaemonTransportFailure::Unreachable => Ok(DaemonOutcome::Fallback),
        _ => Err(anyhow::anyhow!(describe_transport_error(
            &err, master, timeout
        ))),
    }
}

/// `GET /api/projects/:name` for the read-modify-write verbs.
///
/// `Ok(None)` means the daemon could not be reached and the caller should fall back to the
/// filesystem; `Err` is a real failure the user must see.
async fn get_project_via_daemon(
    client: &reqwest::Client,
    base_url: &str,
    master: &MasterInfo,
    name: &str,
    timeout: Option<Duration>,
) -> anyhow::Result<Option<ProjectConfig>> {
    let resp = match client
        .get(format!("{}/api/projects/{}", base_url, name))
        .bearer_auth(&master.secret)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return option_or_fail(e, master, timeout),
    };

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        anyhow::bail!("Project '{}' not found", name);
    }
    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        anyhow::bail!("Failed to get project '{}': {}", name, err);
    }

    Ok(Some(resp.json().await?))
}

/// `PUT /api/projects/:name` with just the field the verb changed. Not atomic against a concurrent
/// editor — the same read-modify-write the `add-verification` / `add-review-action` daemon calls
/// already do.
async fn put_project_via_daemon(
    client: &reqwest::Client,
    base_url: &str,
    master: &MasterInfo,
    name: &str,
    body: serde_json::Value,
    action: &str,
    timeout: Option<Duration>,
) -> anyhow::Result<Option<()>> {
    let resp = match client
        .put(format!("{}/api/projects/{}", base_url, name))
        .bearer_auth(&master.secret)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return option_or_fail(e, master, timeout),
    };

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        anyhow::bail!("Project '{}' not found", name);
    }
    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        anyhow::bail!("Failed to {} in project '{}': {}", action, name, err);
    }

    Ok(Some(()))
}

/// Same "unreachable falls back, anything else fails" rule as `fallback_or_fail`, for helpers that
/// report absence with `Option` rather than `DaemonOutcome`.
fn option_or_fail<T>(
    err: reqwest::Error,
    master: &MasterInfo,
    timeout: Option<Duration>,
) -> anyhow::Result<Option<T>> {
    match classify_transport_error(&err) {
        DaemonTransportFailure::Unreachable => Ok(None),
        _ => Err(anyhow::anyhow!(describe_transport_error(
            &err, master, timeout
        ))),
    }
}

pub(super) async fn handle_project_command_daemon(
    tendril_home: &Path,
    cmd: &ProjectCommands,
    master: &MasterInfo,
) -> anyhow::Result<DaemonOutcome> {
    let timeout = daemon_request_timeout_for(tendril_home);
    let client = daemon_client_with_timeout_and_master(timeout, master);
    let base_url = master.base_url();

    match cmd {
        ProjectCommands::List => {
            let resp = match client
                .get(format!("{}/api/projects", base_url))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if !resp.status().is_success() {
                anyhow::bail!("Failed to list projects: HTTP {}", resp.status());
            }

            let projects: Vec<ProjectConfig> = resp.json().await?;
            for p in &projects {
                println!("{}", p.name);
            }
        }
        ProjectCommands::Get { name } => {
            let Some(p) = get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            print_project(&p);
            print_hooks(&p);
        }
        ProjectCommands::Add { name } => {
            let resp = match client
                .post(format!("{}/api/projects", base_url))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "name": name,
                    "color": "Blue",
                    "repos": [],
                    "verifications": [],
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::CONFLICT {
                anyhow::bail!("Project '{}' already exists", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add project '{}': {}", name, err);
            }

            println!("Project '{}' added.", name);
        }
        ProjectCommands::Remove { name } => {
            let resp = match client
                .delete(format!("{}/api/projects/{}", base_url, name))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to remove project '{}': {}", name, err);
            }

            println!("Project '{}' removed.", name);
        }
        ProjectCommands::Rename { name, new_name } => {
            let resp = match client
                .put(format!("{}/api/projects/{}", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "newName": new_name,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if resp.status() == reqwest::StatusCode::CONFLICT {
                anyhow::bail!("Project '{}' already exists", new_name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to rename project '{}': {}", name, err);
            }

            println!("Project '{}' renamed to '{}'.", name, new_name);
        }
        ProjectCommands::AddRepo { name, path } => {
            let resp = match client
                .post(format!("{}/api/projects/{}/repos", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "path": path,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add repo to project '{}': {}", name, err);
            }

            // Redacted for the same reason the offline arm redacts: `path` is whatever the operator
            // pasted, and a `https://user:token@host/...` remote is a legitimate thing to paste.
            // The daemon has already stored the clone's directory rather than this URL.
            println!(
                "Repo '{}' added to project '{}'.",
                redact_credentials(path),
                name
            );
        }
        ProjectCommands::RemoveRepo { name, path } => {
            let resp = match client
                .delete(format!("{}/api/projects/{}/repos", base_url, name))
                .bearer_auth(&master.secret)
                .query(&[("path", path.as_str())])
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to remove repo from project '{}': {}", name, err);
            }

            println!(
                "Repo '{}' removed from project '{}'.",
                redact_credentials(path),
                name
            );
        }
        ProjectCommands::AddVerification {
            name,
            verification,
            // `--required` restates the default, so only `--optional` changes the outcome.
            required: _,
            optional,
            after,
        } => {
            let mut body = serde_json::json!({
                "name": verification,
                "required": !optional,
            });
            if let Some(after) = after {
                body["after"] = serde_json::json!(after);
            }

            let resp = match client
                .post(format!("{}/api/projects/{}/verifications", base_url, name))
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add verification to project '{}': {}", name, err);
            }

            println!(
                "Verification '{}' added to project '{}'.",
                verification, name
            );
        }
        ProjectCommands::MoveVerification {
            name,
            verification,
            before,
            after,
            position,
        } => {
            // Resolve the placement before the request so an invalid combination fails the same
            // way whether or not a daemon is up.
            let placement = resolve_placement(before.clone(), after.clone(), *position)?;
            let mut body = serde_json::json!({ "name": verification });
            match &placement {
                VerificationPlacement::Before(target) => {
                    body["before"] = serde_json::json!(target);
                }
                VerificationPlacement::After(target) => {
                    body["after"] = serde_json::json!(target);
                }
                VerificationPlacement::Position(pos) => {
                    body["position"] = serde_json::json!(pos);
                }
            }

            let resp = match client
                .put(format!("{}/api/projects/{}/verifications", base_url, name))
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to move verification in project '{}': {}", name, err);
            }

            let payload: serde_json::Value = resp.json().await.unwrap_or_default();
            let index = payload
                .get("position")
                .and_then(|v| v.as_u64())
                .unwrap_or_default();
            println!(
                "Moved verification '{}' to position {}",
                verification, index
            );
        }
        ProjectCommands::RemoveVerification { name, verification } => {
            let resp = match client
                .delete(format!(
                    "{}/api/projects/{}/verifications/{}",
                    base_url, name, verification
                ))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!(
                    "Failed to remove verification from project '{}': {}",
                    name,
                    err
                );
            }

            println!(
                "Verification '{}' removed from project '{}'.",
                verification, name
            );
        }
        ProjectCommands::AddReviewAction {
            name,
            action,
            command,
            condition,
            paths,
            before,
            after,
        } => {
            let resp = match client
                .post(format!("{}/api/projects/{}/review-actions", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "name": action,
                    "command": command,
                    "condition": condition,
                    "paths": paths,
                    "before": before,
                    "after": after,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add review action to project '{}': {}", name, err);
            }

            println!("Review action '{}' added to project '{}'.", action, name);
        }
        ProjectCommands::RemoveReviewAction { name, action } => {
            let resp = match client
                .delete(format!(
                    "{}/api/projects/{}/review-actions/{}",
                    base_url, name, action
                ))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!(
                    "Failed to remove review action from project '{}': {}",
                    name,
                    err
                );
            }

            println!(
                "Review action '{}' removed from project '{}'.",
                action, name
            );
        }
        ProjectCommands::AddBuildDep { name, dependency } => {
            let Some(mut proj) =
                get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            add_build_dependency(&mut proj, dependency)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "buildDependencies": proj.build_dependencies }),
                "add build dependency",
                timeout,
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Added build dependency: {}", dependency);
        }
        ProjectCommands::RemoveBuildDep { name, dependency } => {
            let Some(mut proj) =
                get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            remove_build_dependency(&mut proj, dependency)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "buildDependencies": proj.build_dependencies }),
                "remove build dependency",
                timeout,
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Removed build dependency: {}", dependency);
        }
        ProjectCommands::ListMcp { name } => {
            let Some(proj) =
                get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            print_mcp_servers(&proj);
        }
        ProjectCommands::AddMcp {
            name,
            server,
            command,
            arguments,
            environment,
        } => {
            let Some(mut proj) =
                get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            add_mcp_server(&mut proj, server, command, arguments, environment)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "mcpServers": proj.mcp_servers }),
                "add MCP server",
                timeout,
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Added MCP server: {}", server);
        }
        ProjectCommands::RemoveMcp { name, server } => {
            let Some(mut proj) =
                get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            remove_mcp_server(&mut proj, server)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "mcpServers": proj.mcp_servers }),
                "remove MCP server",
                timeout,
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Removed MCP server: {}", server);
        }
        ProjectCommands::ListSkills { name } => {
            let Some(proj) =
                get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            print_project_skills(&proj);
        }
        ProjectCommands::AddSkill {
            name,
            skill,
            description,
            path,
            instructions,
        } => {
            let Some(mut proj) =
                get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            add_project_skill(
                &mut proj,
                skill,
                description.as_deref(),
                path.as_deref(),
                instructions.as_deref(),
            )?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "skills": proj.skills }),
                "add custom skill",
                timeout,
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Added custom skill: {}", skill);
        }
        ProjectCommands::RemoveSkill { name, skill } => {
            let Some(mut proj) =
                get_project_via_daemon(&client, &base_url, master, name, timeout).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            remove_project_skill(&mut proj, skill)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "skills": proj.skills }),
                "remove custom skill",
                timeout,
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Removed custom skill: {}", skill);
        }
        ProjectCommands::AddHook {
            name,
            hook,
            when,
            promptwares,
            action,
            condition,
        } => {
            let resp = match client
                .post(format!("{}/api/projects/{}/hooks", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "name": hook,
                    "when": when,
                    "promptwares": promptwares,
                    "action": action,
                    "condition": condition,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add hook to project '{}': {}", name, err);
            }

            println!("Hook '{}' added to project '{}'.", hook, name);
        }
        ProjectCommands::RemoveHook { name, hook } => {
            let resp = match client
                .delete(format!("{}/api/projects/{}/hooks/{}", base_url, name, hook))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            // The server answers 404 for an unknown project and for an unknown hook alike, so its
            // message is passed through rather than guessed at.
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!(
                    "Failed to remove hook '{}' from project '{}': {}",
                    hook,
                    name,
                    err
                );
            }

            println!("Hook '{}' removed from project '{}'.", hook, name);
        }
        ProjectCommands::ReviewActions { .. } => {
            // Read-only ranking over the config file — no daemon round-trip needed.
            return Ok(DaemonOutcome::Fallback);
        }
        ProjectCommands::Set { name, field, value } => {
            let body = match field.as_str() {
                "color" => serde_json::json!({ "color": value }),
                "context" => serde_json::json!({ "context": value }),
                "stackHash" | "stack_hash" => {
                    if value.trim().is_empty() {
                        serde_json::json!({ "stackHash": null })
                    } else {
                        serde_json::json!({ "stackHash": value })
                    }
                }
                _ => {
                    anyhow::bail!(
                        "Unsupported project field '{}'. Supported fields: color, context, stackHash",
                        field
                    );
                }
            };

            let resp = match client
                .put(format!("{}/api/projects/{}", base_url, name))
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to set field on project '{}': {}", name, err);
            }

            println!("Project '{}' field '{}' set to '{}'.", name, field, value);
        }
        // The daemon has no endpoints for ports or env files, so these always write config directly.
        ProjectCommands::Port(_) | ProjectCommands::EnvFile(_) => {
            return Ok(DaemonOutcome::Fallback)
        }
        // These run git and walk the local filesystem. The daemon exposes no endpoint for that, and
        // the CLI has to keep working with no daemon running, so they always take the fs arm — the
        // same treatment Port/EnvFile get. A future POST /api/projects/:name/sync would let the
        // desktop app offer sync as well.
        ProjectCommands::Sync { .. }
        | ProjectCommands::Import { .. }
        | ProjectCommands::ImportMcp { .. }
        | ProjectCommands::ImportSkills { .. } => return Ok(DaemonOutcome::Fallback),
    }

    Ok(DaemonOutcome::Handled)
}
