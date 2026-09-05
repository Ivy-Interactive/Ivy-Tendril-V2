use clap::Subcommand;
use std::path::Path;
use tendril_core::config::{get_config_path, load_config, save_config};
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

    #[command(about = "Remove a verification definition")]
    Remove { name: String },
}

pub fn handle_verification_command(
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
