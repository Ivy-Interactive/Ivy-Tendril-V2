use std::io::Read;
use std::path::{Path, PathBuf};
use clap::Subcommand;
use tendril_core::promptware::{
    delete_memory, deploy_standard_promptwares, list_memory, read_memory, write_memory, write_tool,
};

#[derive(Subcommand)]
pub enum PromptwareCommands {
    #[command(about = "List a promptware's memory files")]
    ListMemory { name: String },

    #[command(about = "Read promptware memory")]
    ReadMemory { name: String, files: Vec<String> },

    #[command(about = "Write promptware memory")]
    WriteMemory {
        name: String,
        filename: String,
        #[arg(long)]
        file: Option<PathBuf>,
    },

    #[command(about = "Delete an outdated promptware memory")]
    DeleteMemory { name: String, filename: String },

    #[command(about = "Write promptware tool")]
    WriteTool {
        name: String,
        tool_name: String,
        #[arg(long)]
        file: Option<PathBuf>,
    },

    #[command(about = "Deploy standard promptwares")]
    Deploy,
}

pub fn handle_promptware_command(cmd: PromptwareCommands, tendril_home: &Path) -> anyhow::Result<()> {
    let p_dir = tendril_home.join("Promptwares");

    match cmd {
        PromptwareCommands::ListMemory { name } => {
            let files = list_memory(&p_dir, &name)?;
            for f in files {
                println!("{}", f);
            }
        }
        PromptwareCommands::ReadMemory { name, files } => {
            let content = read_memory(&p_dir, &name, &files)?;
            print!("{}", content);
        }
        PromptwareCommands::WriteMemory { name, filename, file } => {
            let content = if let Some(p) = file {
                std::fs::read_to_string(p)?
            } else {
                let mut buf = String::new();
                std::io::stdin().read_to_string(&mut buf)?;
                buf
            };
            write_memory(&p_dir, &name, &filename, &content)?;
            println!("Memory written.");
        }
        PromptwareCommands::DeleteMemory { name, filename } => {
            delete_memory(&p_dir, &name, &filename)?;
            println!("Memory deleted.");
        }
        PromptwareCommands::WriteTool { name, tool_name, file } => {
            let content = if let Some(p) = file {
                std::fs::read_to_string(p)?
            } else {
                let mut buf = String::new();
                std::io::stdin().read_to_string(&mut buf)?;
                buf
            };
            write_tool(&p_dir, &name, &tool_name, &content)?;
            println!("Tool written.");
        }
        PromptwareCommands::Deploy => {
            deploy_standard_promptwares(&p_dir)?;
            println!("Standard promptwares deployed to {}", p_dir.display());
        }
    }

    Ok(())
}
