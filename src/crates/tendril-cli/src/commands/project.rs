use clap::Subcommand;
use std::path::Path;
use tendril_core::config::{
    get_config_path, insert_project_verification, load_config, move_project_verification,
    read_master, save_config, MasterInfo, VerificationPlacement,
};
use tendril_core::models::{
    ProjectConfig, ProjectEnvFileConfig, ProjectPortConfig, ProjectVerificationRef, RepoRef,
    ReviewActionConfig,
};

#[derive(Subcommand)]
pub enum ProjectCommands {
    #[command(about = "List projects")]
    List,

    #[command(about = "Get project details")]
    Get { name: String },

    #[command(about = "Add a new project")]
    Add { name: String },

    #[command(about = "Remove a project")]
    Remove { name: String },

    #[command(about = "Rename a project")]
    Rename { name: String, new_name: String },

    #[command(about = "Add a repository to a project")]
    AddRepo { name: String, path: String },

    #[command(about = "Remove a repository from a project")]
    RemoveRepo { name: String, path: String },

    #[command(about = "Add a verification to a project")]
    AddVerification {
        name: String,
        verification: String,
        #[arg(long, conflicts_with = "optional", help = "Mark as required (default)")]
        required: bool,
        #[arg(long, help = "Mark as optional")]
        optional: bool,
        #[arg(long, help = "Insert directly after this verification")]
        after: Option<String>,
    },

    #[command(about = "Remove a verification from a project")]
    RemoveVerification { name: String, verification: String },

    #[command(about = "Move a verification within a project's run order")]
    MoveVerification {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "VERIFICATION")]
        verification: String,
        #[arg(long, help = "Move directly before this verification")]
        before: Option<String>,
        #[arg(long, help = "Move directly after this verification")]
        after: Option<String>,
        #[arg(long, help = "Move to this zero-based position")]
        position: Option<usize>,
    },

    #[command(about = "Add a review action to a project")]
    AddReviewAction {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        action: String,
        #[arg(long)]
        command: String,
        #[arg(long, default_value = "")]
        condition: String,
    },

    #[command(about = "Remove a review action from a project")]
    RemoveReviewAction {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        action: String,
    },

    #[command(about = "Set a project field")]
    Set {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "FIELD")]
        field: String,
        #[arg(value_name = "VALUE")]
        value: String,
    },

    #[command(subcommand, about = "Manage a project's named service ports")]
    Port(ProjectPortCommands),

    #[command(subcommand, about = "Manage a project's environment files")]
    EnvFile(ProjectEnvFileCommands),
}

#[derive(Subcommand)]
pub enum ProjectPortCommands {
    #[command(about = "List a project's named service ports")]
    List {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add or update a named service port")]
    Add {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        port_name: String,
        #[arg(long)]
        default_port: u16,
        #[arg(long, default_value = "")]
        description: String,
    },

    #[command(about = "Remove a named service port")]
    Remove {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        port_name: String,
    },
}

#[derive(Subcommand)]
pub enum ProjectEnvFileCommands {
    #[command(about = "List a project's environment files")]
    List {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add or update an environment file")]
    Add {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "PATH")]
        path: String,
        #[arg(long, help = "Source file, relative to the worktree root")]
        template: Option<String>,
        #[arg(
            long = "override",
            value_name = "KEY=VALUE",
            help = "Key written on top of the template (repeatable)"
        )]
        overrides: Vec<String>,
    },

    #[command(about = "Remove an environment file")]
    Remove {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "PATH")]
        path: String,
    },
}

enum DaemonOutcome {
    Handled,
    Fallback,
}

/// Both the daemon and filesystem paths need the same "exactly one placement" rule, so they share
/// this resolution rather than each deciding for itself.
fn resolve_placement(
    before: Option<String>,
    after: Option<String>,
    position: Option<usize>,
) -> anyhow::Result<VerificationPlacement> {
    match (before, after, position) {
        (Some(target), None, None) => Ok(VerificationPlacement::Before(target)),
        (None, Some(target), None) => Ok(VerificationPlacement::After(target)),
        (None, None, Some(pos)) => Ok(VerificationPlacement::Position(pos)),
        _ => anyhow::bail!("Specify exactly one of --before, --after, or --position"),
    }
}

pub async fn handle_project_command(
    cmd: ProjectCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    if let Some(master) = read_master(tendril_home) {
        match handle_project_command_daemon(&cmd, &master).await {
            Ok(DaemonOutcome::Handled) => return Ok(()),
            Ok(DaemonOutcome::Fallback) => {
                tracing::debug!("Failed to reach master daemon, falling back to filesystem");
            }
            Err(e) => return Err(e),
        }
    }

    handle_project_command_fs(cmd, tendril_home)
}

async fn handle_project_command_daemon(
    cmd: &ProjectCommands,
    master: &MasterInfo,
) -> anyhow::Result<DaemonOutcome> {
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", master.host, master.port);

    match cmd {
        ProjectCommands::List => {
            let resp = match client
                .get(format!("{}/api/projects", base_url))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
            let resp = match client
                .get(format!("{}/api/projects/{}", base_url, name))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to get project '{}': {}", name, err);
            }

            let p: ProjectConfig = resp.json().await?;
            println!("Project: {}", p.name);
            println!("Color: {}", p.color);
            println!("Repos:");
            for r in &p.repos {
                println!("  - {}", r.path);
            }
            println!("Verifications:");
            for v in &p.verifications {
                println!("  - {} (required: {})", v.name, v.required);
            }
            if !p.review_actions.is_empty() {
                println!("Review Actions:");
                for a in &p.review_actions {
                    println!(
                        "  - {} (command: {}, condition: {})",
                        a.name, a.command, a.condition
                    );
                }
            }
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add repo to project '{}': {}", name, err);
            }

            println!("Repo '{}' added to project '{}'.", path, name);
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to remove repo from project '{}': {}", name, err);
            }

            println!("Repo '{}' removed from project '{}'.", path, name);
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
        } => {
            let resp = match client
                .post(format!("{}/api/projects/{}/review-actions", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "name": action,
                    "command": command,
                    "condition": condition,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
    }

    Ok(DaemonOutcome::Handled)
}

fn handle_project_command_fs(cmd: ProjectCommands, tendril_home: &Path) -> anyhow::Result<()> {
    let cfg_path = get_config_path(tendril_home);
    let mut settings = load_config(&cfg_path)?;

    match cmd {
        ProjectCommands::List => {
            for p in &settings.projects {
                println!("{}", p.name);
            }
        }
        ProjectCommands::Get { name } => {
            if let Some(p) = settings
                .projects
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
            {
                println!("Project: {}", p.name);
                println!("Color: {}", p.color);
                println!("Repos:");
                for r in &p.repos {
                    println!("  - {}", r.path);
                }
                println!("Verifications:");
                for v in &p.verifications {
                    println!("  - {} (required: {})", v.name, v.required);
                }
                if !p.review_actions.is_empty() {
                    println!("Review Actions:");
                    for a in &p.review_actions {
                        println!(
                            "  - {} (command: {}, condition: {})",
                            a.name, a.command, a.condition
                        );
                    }
                }
            } else {
                anyhow::bail!("Project '{}' not found", name);
            }
        }
        ProjectCommands::Add { name } => {
            if settings
                .projects
                .iter()
                .any(|p| p.name.eq_ignore_ascii_case(&name))
            {
                anyhow::bail!("Project '{}' already exists", name);
            }
            settings.projects.push(ProjectConfig {
                name: name.clone(),
                color: "Blue".to_string(),
                ..Default::default()
            });
            save_config(&cfg_path, &settings)?;
            println!("Project '{}' added.", name);
        }
        ProjectCommands::Remove { name } => {
            let before = settings.projects.len();
            settings
                .projects
                .retain(|p| !p.name.eq_ignore_ascii_case(&name));
            if settings.projects.len() == before {
                anyhow::bail!("Project '{}' not found", name);
            }
            save_config(&cfg_path, &settings)?;
            println!("Project '{}' removed.", name);
        }
        ProjectCommands::Rename { name, new_name } => {
            let trimmed = new_name.trim().to_string();
            if trimmed.is_empty() {
                anyhow::bail!("Project name cannot be empty");
            }
            let proj_idx = settings
                .projects
                .iter()
                .position(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            if !trimmed.eq_ignore_ascii_case(&name)
                && settings
                    .projects
                    .iter()
                    .any(|p| p.name.eq_ignore_ascii_case(&trimmed))
            {
                anyhow::bail!("Project '{}' already exists", trimmed);
            }

            settings.projects[proj_idx].name = trimmed.clone();
            save_config(&cfg_path, &settings)?;

            let plans_dir =
                tendril_core::config::get_plans_dir_with_settings(tendril_home, Some(&settings));
            tendril_core::plans::rename_project_in_plans(&plans_dir, &name, &trimmed)?;

            let db_path = tendril_core::config::get_database_path(tendril_home);
            if let Ok(conn) = tendril_core::db::open_database(&db_path) {
                let _ = tendril_core::db::rename_project(&conn, &name, &trimmed);
            }

            println!("Project '{}' renamed to '{}'.", name, trimmed);
        }
        ProjectCommands::AddRepo { name, path } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            if !proj
                .repos
                .iter()
                .any(|r| r.path.eq_ignore_ascii_case(&path))
            {
                proj.repos.push(RepoRef {
                    path: path.clone(),
                    base_branch: None,
                });
                save_config(&cfg_path, &settings)?;
            }
            println!("Repo '{}' added to project '{}'.", path, name);
        }
        ProjectCommands::RemoveRepo { name, path } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            proj.repos.retain(|r| !r.path.eq_ignore_ascii_case(&path));
            save_config(&cfg_path, &settings)?;
            println!("Repo '{}' removed from project '{}'.", path, name);
        }
        ProjectCommands::AddVerification {
            name,
            verification,
            // `--required` restates the default, so only `--optional` changes the outcome.
            required: _,
            optional,
            after,
        } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            if !proj
                .verifications
                .iter()
                .any(|v| v.name.eq_ignore_ascii_case(&verification))
            {
                insert_project_verification(
                    proj,
                    ProjectVerificationRef {
                        name: verification.clone(),
                        required: !optional,
                    },
                    after.as_deref(),
                )?;
                save_config(&cfg_path, &settings)?;
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
            let placement = resolve_placement(before, after, position)?;
            let available = settings
                .projects
                .iter()
                .map(|p| p.name.clone())
                .collect::<Vec<_>>()
                .join(", ");
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| {
                    anyhow::anyhow!("Project '{}' not found. Available: {}", name, available)
                })?;

            let index = move_project_verification(proj, &verification, &placement)?;
            save_config(&cfg_path, &settings)?;
            println!(
                "Moved verification '{}' to position {}",
                verification, index
            );
        }
        ProjectCommands::RemoveVerification { name, verification } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            proj.verifications
                .retain(|v| !v.name.eq_ignore_ascii_case(&verification));
            save_config(&cfg_path, &settings)?;
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
        } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            proj.review_actions
                .retain(|a| !a.name.eq_ignore_ascii_case(&action));
            proj.review_actions.push(ReviewActionConfig {
                name: action.clone(),
                condition: condition.clone(),
                command: command.clone(),
            });
            save_config(&cfg_path, &settings)?;
            println!("Review action '{}' added to project '{}'.", action, name);
        }
        ProjectCommands::RemoveReviewAction { name, action } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            let before = proj.review_actions.len();
            proj.review_actions
                .retain(|a| !a.name.eq_ignore_ascii_case(&action));
            if proj.review_actions.len() == before {
                anyhow::bail!("Review action '{}' not found in project '{}'", action, name);
            }
            save_config(&cfg_path, &settings)?;
            println!(
                "Review action '{}' removed from project '{}'.",
                action, name
            );
        }
        ProjectCommands::Set { name, field, value } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            match field.as_str() {
                "color" => {
                    proj.color = value.clone();
                }
                "context" => {
                    proj.context = value.clone();
                }
                "stackHash" | "stack_hash" => {
                    proj.stack_hash = if value.trim().is_empty() {
                        None
                    } else {
                        Some(value.clone())
                    };
                }
                _ => {
                    anyhow::bail!(
                        "Unsupported project field '{}'. Supported fields: color, context, stackHash",
                        field
                    );
                }
            }
            save_config(&cfg_path, &settings)?;
            println!("Project '{}' field '{}' set to '{}'.", name, field, value);
        }
        ProjectCommands::Port(port_cmd) => match port_cmd {
            ProjectPortCommands::List { name } => {
                let proj = find_project(&settings, &name)?;
                if proj.ports.is_empty() {
                    println!("No ports configured for this project.");
                } else {
                    println!("Name\tDefault Port\tDescription");
                    for (port_name, config) in &proj.ports {
                        println!(
                            "{}\t{}\t{}",
                            port_name, config.default_port, config.description
                        );
                    }
                }
            }
            ProjectPortCommands::Add {
                name,
                port_name,
                default_port,
                description,
            } => {
                let proj = find_project_mut(&mut settings, &name)?;
                let updated = proj
                    .ports
                    .insert(
                        port_name.clone(),
                        ProjectPortConfig {
                            default_port,
                            description: description.clone(),
                        },
                    )
                    .is_some();
                save_config(&cfg_path, &settings)?;
                println!(
                    "{} port: {} -> {}",
                    if updated { "Updated" } else { "Added" },
                    port_name,
                    default_port
                );
            }
            ProjectPortCommands::Remove { name, port_name } => {
                let proj = find_project_mut(&mut settings, &name)?;
                if proj.ports.remove(&port_name).is_none() {
                    anyhow::bail!("Port not found: {}", port_name);
                }
                save_config(&cfg_path, &settings)?;
                println!("Removed port: {}", port_name);
            }
        },
        ProjectCommands::EnvFile(env_cmd) => match env_cmd {
            ProjectEnvFileCommands::List { name } => {
                let proj = find_project(&settings, &name)?;
                if proj.env_files.is_empty() {
                    println!("No environment files configured for this project.");
                } else {
                    println!("Path\tTemplate\tOverrides");
                    for file in &proj.env_files {
                        println!(
                            "{}\t{}\t{}",
                            file.path,
                            file.template.clone().unwrap_or_default(),
                            file.overrides
                                .keys()
                                .cloned()
                                .collect::<Vec<String>>()
                                .join(", ")
                        );
                    }
                }
            }
            ProjectEnvFileCommands::Add {
                name,
                path,
                template,
                overrides,
            } => {
                // Split on the first '=' only, so a value may itself contain '='.
                let mut parsed = std::collections::BTreeMap::new();
                for entry in &overrides {
                    let (key, value) = entry.split_once('=').ok_or_else(|| {
                        anyhow::anyhow!("Invalid override (expected KEY=VALUE): {}", entry)
                    })?;
                    parsed.insert(key.trim().to_string(), value.to_string());
                }

                let proj = find_project_mut(&mut settings, &name)?;
                // Re-adding the same path replaces the entry rather than appending a duplicate: two
                // configs for one file would race, with the last one written winning silently.
                let before = proj.env_files.len();
                proj.env_files
                    .retain(|f| !f.path.eq_ignore_ascii_case(&path));
                let updated = proj.env_files.len() != before;

                proj.env_files.push(ProjectEnvFileConfig {
                    path: path.clone(),
                    template: template.filter(|t| !t.trim().is_empty()),
                    overrides: parsed,
                });
                save_config(&cfg_path, &settings)?;
                println!(
                    "{} environment file: {}",
                    if updated { "Updated" } else { "Added" },
                    path
                );
            }
            ProjectEnvFileCommands::Remove { name, path } => {
                let proj = find_project_mut(&mut settings, &name)?;
                let before = proj.env_files.len();
                proj.env_files
                    .retain(|f| !f.path.eq_ignore_ascii_case(&path));
                if proj.env_files.len() == before {
                    anyhow::bail!("Environment file not found: {}", path);
                }
                save_config(&cfg_path, &settings)?;
                println!("Removed environment file: {}", path);
            }
        },
    }

    Ok(())
}

fn find_project<'a>(
    settings: &'a tendril_core::config::TendrilSettings,
    name: &str,
) -> anyhow::Result<&'a ProjectConfig> {
    settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))
}

fn find_project_mut<'a>(
    settings: &'a mut tendril_core::config::TendrilSettings,
    name: &str,
) -> anyhow::Result<&'a mut ProjectConfig> {
    settings
        .projects
        .iter_mut()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))
}
