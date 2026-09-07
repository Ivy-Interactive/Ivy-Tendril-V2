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

    #[command(subcommand, about = "Manage verification definitions")]
    Verification(commands::verification::VerificationCommands),

    #[command(subcommand, about = "Manage promptwares")]
    Promptware(commands::promptware::PromptwareCommands),

    #[command(subcommand, about = "Tendril configuration")]
    Config(commands::config::ConfigCommands),

    #[command(about = "Check system health")]
    Doctor,

    #[command(about = "Show version")]
    Version,

    #[command(about = "List available models and pricing")]
    Models,

    #[command(about = "Start the Tendril HTTP & WebSocket API server")]
    Serve {
        #[arg(short, long, default_value = "5010")]
        port: u16,

        #[arg(long, default_value = "127.0.0.1")]
        host: String,
    },

    #[command(about = "Run Model Context Protocol (MCP) server over stdio")]
    Mcp,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let tendril_home = cli.home.unwrap_or_else(get_default_tendril_home);

    match cli.command {
        Commands::Plan(cmd) => commands::plan::handle_plan_command(cmd, &tendril_home)?,
        Commands::Job(cmd) => commands::job::handle_job_command(cmd, &tendril_home).await?,
        Commands::Chat(cmd) => commands::chat::handle_chat_command(cmd, &tendril_home).await?,
        Commands::Project(cmd) => {
            commands::project::handle_project_command(cmd, &tendril_home).await?
        }
        Commands::Verification(cmd) => {
            commands::verification::handle_verification_command(cmd, &tendril_home)?
        }
        Commands::Promptware(cmd) => {
            commands::promptware::handle_promptware_command(cmd, &tendril_home).await?
        }
        Commands::Config(cmd) => commands::config::handle_config_command(cmd, &tendril_home)?,
        Commands::Doctor => commands::doctor::handle_doctor(&tendril_home)?,
        Commands::Version => println!("tendril v{}", env!("CARGO_PKG_VERSION")),
        Commands::Models => commands::models::handle_models()?,
        Commands::Serve { port, host } => {
            commands::serve::handle_serve(&tendril_home, port, Some(host)).await?
        }
        Commands::Mcp => commands::mcp::handle_mcp()?,
    }

    Ok(())
}
