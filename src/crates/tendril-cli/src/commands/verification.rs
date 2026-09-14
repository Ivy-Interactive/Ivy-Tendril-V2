use clap::Subcommand;
use std::path::Path;
use std::time::Duration;
use tendril_core::config::{
    find_projects_referencing_verification, get_config_path, load_config, read_master,
    remove_verification_from_projects, save_config, MasterInfo,
};
use tendril_core::http::{
    classify_transport_error, daemon_client_with_timeout, daemon_request_timeout_for,
    describe_transport_error, DaemonTransportFailure,
};
use tendril_core::models::VerificationConfig;

#[derive(Subcommand)]
pub enum VerificationCommands {
    #[command(about = "List verification definitions")]
    List {
        #[arg(long)]
        json: bool,
    },

    #[command(about = "Get verification details")]
    Get { name: String },

    #[command(about = "Add a verification definition")]
    Add {
        name: String,
        #[arg(long, default_value = "")]
        prompt: String,
    },

    #[command(about = "Update a verification definition's prompt or name")]
    Set {
        name: String,
        #[arg(long = "new-name")]
        new_name: Option<String>,
        #[arg(long)]
        prompt: Option<String>,
    },

    #[command(about = "Remove a verification definition")]
    Remove {
        name: String,
        #[arg(long, short)]
        force: bool,
    },
}

enum DaemonOutcome {
    Handled,
    Fallback,
}

/// A daemon call that failed at the transport level.
///
/// Only an unreachable daemon may fall back to `config.json`: a timed-out mutation may already have
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

pub async fn handle_verification_command(
    cmd: VerificationCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    if let Some(master) = read_master(tendril_home) {
        match handle_verification_command_daemon(tendril_home, &cmd, &master).await {
            Ok(DaemonOutcome::Handled) => return Ok(()),
            Ok(DaemonOutcome::Fallback) => {
                tracing::debug!("Failed to reach master daemon, falling back to filesystem");
            }
            Err(e) => return Err(e),
        }
    }

    handle_verification_command_fs(cmd, tendril_home)
}

async fn handle_verification_command_daemon(
    tendril_home: &Path,
    cmd: &VerificationCommands,
    master: &MasterInfo,
) -> anyhow::Result<DaemonOutcome> {
    let timeout = daemon_request_timeout_for(tendril_home);
    let client = daemon_client_with_timeout(timeout);
    let base_url = format!("http://{}:{}", master.host, master.port);

    match cmd {
        VerificationCommands::List { json } => {
            let resp = match client
                .get(format!("{}/api/verifications", base_url))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if !resp.status().is_success() {
                anyhow::bail!("Failed to list verifications: HTTP {}", resp.status());
            }

            let verifications: Vec<VerificationConfig> = resp.json().await?;
            if *json {
                println!("{}", serde_json::to_string_pretty(&verifications)?);
            } else {
                for v in &verifications {
                    println!("{}", v.name);
                }
            }
        }
        VerificationCommands::Get { name } => {
            let resp = match client
                .get(format!("{}/api/verifications/{}", base_url, name))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Verification '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to get verification '{}': {}", name, err);
            }

            let v: VerificationConfig = resp.json().await?;
            println!("Name: {}", v.name);
            println!("Prompt:\n{}", v.prompt);
        }
        VerificationCommands::Add { name, prompt } => {
            let resp = match client
                .post(format!("{}/api/verifications", base_url))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "name": name,
                    "prompt": prompt,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::CONFLICT {
                anyhow::bail!("Verification '{}' already exists", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add verification '{}': {}", name, err);
            }

            println!("Verification '{}' added.", name);
        }
        VerificationCommands::Set {
            name,
            new_name,
            prompt,
        } => {
            let mut body = serde_json::Map::new();
            if let Some(nn) = new_name {
                body.insert("newName".to_string(), serde_json::Value::String(nn.clone()));
            }
            if let Some(p) = prompt {
                body.insert("prompt".to_string(), serde_json::Value::String(p.clone()));
            }

            let resp = match client
                .put(format!("{}/api/verifications/{}", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::Value::Object(body))
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Verification '{}' not found", name);
            }
            if resp.status() == reqwest::StatusCode::CONFLICT {
                if let Some(nn) = new_name {
                    anyhow::bail!("Verification '{}' already exists", nn);
                } else {
                    anyhow::bail!("Verification already exists");
                }
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to update verification '{}': {}", name, err);
            }

            println!("Verification '{}' updated.", name);
        }
        VerificationCommands::Remove { name, force } => {
            let resp = match client
                .delete(format!(
                    "{}/api/verifications/{}?force={}",
                    base_url, name, force
                ))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => return fallback_or_fail(e, master, timeout),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Verification '{}' not found", name);
            }
            if resp.status() == reqwest::StatusCode::CONFLICT {
                let err_body: serde_json::Value = resp.json().await.unwrap_or_default();
                let err_msg = err_body["error"]
                    .as_str()
                    .unwrap_or("Verification is referenced by active projects");
                anyhow::bail!(
                    "{}. Use --force to remove it and clean up project references.",
                    err_msg
                );
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to remove verification '{}': {}", name, err);
            }

            let body: serde_json::Value = resp.json().await.unwrap_or_default();
            if let Some(cleaned) = body["cleanedProjects"].as_array() {
                if !cleaned.is_empty() {
                    let project_names: Vec<&str> =
                        cleaned.iter().filter_map(|p| p.as_str()).collect();
                    println!(
                        "Verification '{}' removed (cleaned up references in: {}).",
                        name,
                        project_names.join(", ")
                    );
                    return Ok(DaemonOutcome::Handled);
                }
            }

            println!("Verification '{}' removed.", name);
        }
    }

    Ok(DaemonOutcome::Handled)
}

fn handle_verification_command_fs(
    cmd: VerificationCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    let cfg_path = get_config_path(tendril_home);
    let mut settings = load_config(&cfg_path)?;

    match cmd {
        VerificationCommands::List { json } => {
            if json {
                println!("{}", serde_json::to_string_pretty(&settings.verifications)?);
            } else {
                for v in &settings.verifications {
                    println!("{}", v.name);
                }
            }
        }
        VerificationCommands::Get { name } => {
            if let Some(v) = settings
                .verifications
                .iter()
                .find(|v| v.name.eq_ignore_ascii_case(&name))
            {
                println!("Name: {}", v.name);
                println!("Prompt:\n{}", v.prompt);
            } else {
                anyhow::bail!("Verification '{}' not found", name);
            }
        }
        VerificationCommands::Add { name, prompt } => {
            if settings
                .verifications
                .iter()
                .any(|v| v.name.eq_ignore_ascii_case(&name))
            {
                anyhow::bail!("Verification '{}' already exists", name);
            }
            settings.verifications.push(VerificationConfig {
                name: name.clone(),
                prompt,
            });
            save_config(&cfg_path, &settings)?;
            println!("Verification '{}' added.", name);
        }
        VerificationCommands::Set {
            name,
            new_name,
            prompt,
        } => {
            let idx = settings
                .verifications
                .iter()
                .position(|v| v.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Verification '{}' not found", name))?;

            if let Some(nn) = new_name {
                let trimmed = nn.trim().to_string();
                if trimmed.is_empty() {
                    anyhow::bail!("Verification name cannot be empty");
                }
                if !trimmed.eq_ignore_ascii_case(&name)
                    && settings
                        .verifications
                        .iter()
                        .any(|v| v.name.eq_ignore_ascii_case(&trimmed))
                {
                    anyhow::bail!("Verification '{}' already exists", trimmed);
                }

                settings.verifications[idx].name = trimmed.clone();

                for p in &mut settings.projects {
                    for v in &mut p.verifications {
                        if v.name.eq_ignore_ascii_case(&name) {
                            v.name = trimmed.clone();
                        }
                    }
                }

                let plans_dir = tendril_core::config::get_plans_dir_with_settings(
                    tendril_home,
                    Some(&settings),
                );
                tendril_core::plans::rename_verification_in_plans(&plans_dir, &name, &trimmed)?;

                let db_path = tendril_core::config::get_database_path(tendril_home);
                if let Ok(conn) = tendril_core::db::open_database(&db_path) {
                    let _ = tendril_core::db::rename_verification(&conn, &name, &trimmed);
                }
            }

            if let Some(p) = prompt {
                settings.verifications[idx].prompt = p;
            }

            save_config(&cfg_path, &settings)?;
            println!("Verification '{}' updated.", name);
        }
        VerificationCommands::Remove { name, force } => {
            let idx = settings
                .verifications
                .iter()
                .position(|v| v.name.eq_ignore_ascii_case(&name));
            if idx.is_none() {
                anyhow::bail!("Verification '{}' not found", name);
            }

            let referencing = find_projects_referencing_verification(&settings, &name);
            if !referencing.is_empty() && !force {
                anyhow::bail!(
                    "Cannot remove verification '{}': it is referenced by project(s): {}. Use --force to remove it and clean up project references.",
                    name,
                    referencing.join(", ")
                );
            }

            settings
                .verifications
                .retain(|v| !v.name.eq_ignore_ascii_case(&name));

            let cleaned = if !referencing.is_empty() {
                remove_verification_from_projects(&mut settings, &name)
            } else {
                Vec::new()
            };

            save_config(&cfg_path, &settings)?;

            if !cleaned.is_empty() {
                println!(
                    "Verification '{}' removed (cleaned up references in: {}).",
                    name,
                    cleaned.join(", ")
                );
            } else {
                println!("Verification '{}' removed.", name);
            }
        }
    }

    Ok(())
}
