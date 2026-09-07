use clap::Subcommand;
use std::path::Path;
use tendril_core::config::{get_config_path, load_config, read_master, save_config, MasterInfo};
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
    Remove { name: String },
}

enum DaemonOutcome {
    Handled,
    Fallback,
}

pub async fn handle_verification_command(
    cmd: VerificationCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    if let Some(master) = read_master(tendril_home) {
        match handle_verification_command_daemon(&cmd, &master).await {
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
    cmd: &VerificationCommands,
    master: &MasterInfo,
) -> anyhow::Result<DaemonOutcome> {
    let client = reqwest::Client::new();
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
                Err(_) => return Ok(DaemonOutcome::Fallback),
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
        VerificationCommands::Remove { name } => {
            let resp = match client
                .delete(format!("{}/api/verifications/{}", base_url, name))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Verification '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to remove verification '{}': {}", name, err);
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
        VerificationCommands::Remove { name } => {
            let before = settings.verifications.len();
            settings
                .verifications
                .retain(|v| !v.name.eq_ignore_ascii_case(&name));
            if settings.verifications.len() == before {
                anyhow::bail!("Verification '{}' not found", name);
            }
            save_config(&cfg_path, &settings)?;
            println!("Verification '{}' removed.", name);
        }
    }

    Ok(())
}
