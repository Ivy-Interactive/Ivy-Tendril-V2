use clap::Subcommand;
use std::path::Path;
use tendril_core::config::{get_config_path, load_config, save_config};

#[derive(Subcommand)]
pub enum ConfigCommands {
    #[command(about = "Print a top-level config value")]
    Get { key: String },

    #[command(about = "Set a top-level config value")]
    Set { key: String, value: String },
}

pub fn handle_config_command(cmd: ConfigCommands, tendril_home: &Path) -> anyhow::Result<()> {
    let cfg_path = get_config_path(tendril_home);
    let mut settings = load_config(&cfg_path)?;

    match cmd {
        ConfigCommands::Get { key } => {
            let val = match key.to_ascii_lowercase().as_str() {
                "codingagent" => settings.coding_agent,
                "jobtimeout" => settings.job_timeout.to_string(),
                "staleoutputtimeout" => settings.stale_output_timeout.to_string(),
                "gittimeout" => settings.git_timeout.to_string(),
                "maxconcurrentjobs" => settings.max_concurrent_jobs.to_string(),
                "plantemplate" => settings.plan_template,
                "theme" => settings.theme,
                _ => {
                    if let Some((_, v)) = settings
                        .extra
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case(&key))
                    {
                        match v {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        }
                    } else {
                        anyhow::bail!("Unknown config key: {}", key)
                    }
                }
            };
            println!("{}", val);
        }
        ConfigCommands::Set { key, value } => {
            match key.to_ascii_lowercase().as_str() {
                "codingagent" => settings.coding_agent = value,
                "jobtimeout" => settings.job_timeout = value.parse()?,
                "staleoutputtimeout" => settings.stale_output_timeout = value.parse()?,
                "gittimeout" => settings.git_timeout = value.parse()?,
                "maxconcurrentjobs" => settings.max_concurrent_jobs = value.parse()?,
                "plantemplate" => settings.plan_template = value,
                "theme" => settings.theme = value,
                _ => {
                    if let Some(existing_key) = settings
                        .extra
                        .keys()
                        .find(|k| k.eq_ignore_ascii_case(&key))
                        .cloned()
                    {
                        let parsed: serde_json::Value = serde_json::from_str(&value)
                            .unwrap_or(serde_json::Value::String(value));
                        settings.extra.insert(existing_key, parsed);
                    } else {
                        let parsed: serde_json::Value = serde_json::from_str(&value)
                            .unwrap_or(serde_json::Value::String(value));
                        settings.extra.insert(key, parsed);
                    }
                }
            };
            save_config(&cfg_path, &settings)?;
            println!("Config updated.");
        }
    }

    Ok(())
}
