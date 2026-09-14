use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tendril_core::config::get_default_tendril_home;

use tendril_cli::commands;

#[derive(Parser)]
#[command(
    name = "tendril",
    author = "SpaceCorps Technology",
    version = env!("CARGO_PKG_VERSION"),
    about = "Tendril - AI Coding Agent Orchestration Service & CLI in Rust"
)]
struct Cli {
    #[arg(long, env = "TENDRIL_HOME", help = "Path to Tendril home directory")]
    home: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    #[command(subcommand, about = "Manage plans")]
    Plan(commands::plan::PlanCommands),

    #[command(subcommand, about = "Manage jobs")]
    Job(commands::job::JobCommands),

    #[command(subcommand, about = "Manage chat sessions and execution")]
    Chat(commands::chat::ChatCommands),

    #[command(subcommand, about = "Manage projects")]
    Project(commands::project::ProjectCommands),

    #[command(subcommand, about = "Manage team configuration vaults")]
    Vault(commands::vault::VaultCommands),

    // Top-level rather than `project analyzer`, because the promptwares call
    // `tendril project-analyzer <path>`.
    #[command(
        name = "project-analyzer",
        about = "Print a trimmed YAML stack report for a folder"
    )]
    ProjectAnalyzer {
        #[arg(value_name = "FOLDERPATH")]
        folder: String,
    },

    #[command(subcommand, about = "Manage verification definitions")]
    Verification(commands::verification::VerificationCommands),

    #[command(subcommand, about = "Manage promptwares")]
    Promptware(commands::promptware::PromptwareCommands),

    #[command(subcommand, about = "Tendril configuration")]
    Config(commands::config::ConfigCommands),

    #[command(about = "Check system health")]
    Doctor {
        #[arg(
            long,
            help = "Rebuild the plan full-text search index from the Plans table"
        )]
        rebuild_search_index: bool,
    },

    #[command(about = "Show version")]
    Version,

    #[command(about = "List available models and pricing")]
    Models {
        #[arg(
            long,
            help = "Fetch live model updates and pricing from models.dev before printing"
        )]
        refresh: bool,
    },

    #[command(about = "Start the Tendril HTTP & WebSocket API server")]
    Serve {
        #[arg(short, long, default_value = "5010")]
        port: u16,

        #[arg(long, default_value = "127.0.0.1")]
        host: String,
    },

    #[command(about = "Run Model Context Protocol (MCP) server over stdio")]
    Mcp,

    #[command(subcommand, about = "Inspect and maintain the Tendril database")]
    Db(commands::db::DbCommands),

    #[command(about = "Delete the Tendril home and plans directories")]
    Reset(commands::reset::ResetArgs),

    #[command(about = "Update Tendril to the latest version")]
    Update(commands::update::UpdateArgs),

    #[command(about = "Refresh deployed promptwares, preserving their Memory/ and Tools/")]
    UpdatePromptwares(commands::update_promptwares::UpdatePromptwaresArgs),

    #[command(
        about = "Hash a password for config.yaml's auth block",
        long_about = "Hashes PASSWORD with Argon2i and prints the encoded hash plus the secret \
(pepper) it was hashed with.\n\nThe pepper is NOT part of the hash string, so both values have to \
be stored: the hash as `auth.password` and the pepper as `auth.hashSecret` in config.yaml. Pass \
SECRET to reuse an existing pepper; omit it to generate a new 32-byte one."
    )]
    HashPassword {
        #[arg(value_name = "PASSWORD")]
        password: String,

        #[arg(value_name = "SECRET")]
        secret: Option<String>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let tendril_home = cli.home.unwrap_or_else(get_default_tendril_home);

    match cli.command {
        Commands::Plan(cmd) => commands::plan::handle_plan_command(cmd, &tendril_home).await?,
        Commands::Job(cmd) => commands::job::handle_job_command(cmd, &tendril_home).await?,
        Commands::Chat(cmd) => commands::chat::handle_chat_command(cmd, &tendril_home).await?,
        Commands::Project(cmd) => {
            commands::project::handle_project_command(cmd, &tendril_home).await?
        }
        Commands::Vault(cmd) => commands::vault::handle_vault_command(cmd, &tendril_home).await?,
        Commands::ProjectAnalyzer { folder } => {
            commands::project_analyzer::handle_project_analyzer(&folder)?
        }
        Commands::Verification(cmd) => {
            commands::verification::handle_verification_command(cmd, &tendril_home).await?
        }
        Commands::Promptware(cmd) => {
            commands::promptware::handle_promptware_command(cmd, &tendril_home).await?
        }
        Commands::Config(cmd) => commands::config::handle_config_command(cmd, &tendril_home)?,
        Commands::Doctor {
            rebuild_search_index,
        } => commands::doctor::handle_doctor(&tendril_home, rebuild_search_index)?,
        Commands::Version => println!("tendril v{}", env!("CARGO_PKG_VERSION")),
        Commands::Models { refresh } => {
            commands::models::handle_models(refresh, &tendril_home).await?
        }
        Commands::Serve { port, host } => {
            commands::serve::handle_serve(&tendril_home, port, Some(host)).await?
        }
        Commands::Mcp => commands::mcp::handle_mcp(&tendril_home).await?,
        Commands::Db(cmd) => commands::db::handle_db_command(cmd, &tendril_home)?,
        Commands::Reset(args) => commands::reset::handle_reset(args, &tendril_home)?,
        Commands::Update(args) => commands::update::handle_update(args).await?,
        Commands::UpdatePromptwares(args) => {
            commands::update_promptwares::handle_update_promptwares(args, &tendril_home)?
        }
        Commands::HashPassword { password, secret } => {
            commands::hash_password::handle_hash_password(&password, secret.as_deref())?
        }
    }

    Ok(())
}
