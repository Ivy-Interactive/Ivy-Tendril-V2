use clap::Subcommand;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use tendril_core::agents::providers::{build_agent_spec, AgentLaunchConfig};
use tendril_core::agents::resolution::resolve_agent;
use tendril_core::agents::runner::run_agent_process;
use tendril_core::config::{get_config_path, get_plans_dir, load_config};
use tendril_core::jobs::firmware_values::{build_job_context, resolve_writable_directories};
use tendril_core::plans::resolve_plan_folder;
use tendril_core::promptware::{
    compile_firmware, delete_memory, deploy_standard_promptwares, list_memory, read_memory,
    write_memory, write_tool,
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

    #[command(about = "Run a promptware directly (bypasses job service)")]
    Run {
        name: String,
        #[arg(help = "Free-form arguments passed to the promptware as the TaskDescription value")]
        args: Vec<String>,
        #[arg(
            long,
            help = "Override the agent profile (e.g., deep, balanced, quick)"
        )]
        profile: Option<String>,
        #[arg(long, help = "Working directory for the agent process")]
        working_dir: Option<PathBuf>,
        #[arg(
            long,
            help = "Additional firmware header values (key=value format, repeatable)"
        )]
        value: Vec<String>,
        #[arg(long, help = "Plan ID or folder path")]
        plan: Option<String>,
        #[arg(long, help = "Additional directory to search for promptware folders")]
        promptware_path: Option<PathBuf>,
        #[arg(long, help = "Override config.yaml path")]
        config: Option<PathBuf>,
        #[arg(
            long,
            help = "Override agent provider (claude, antigravity, codex, copilot, opencode, ivy)"
        )]
        agent: Option<String>,
        #[arg(
            long,
            help = "Print the compiled firmware and exit without launching the agent"
        )]
        dry_run: bool,
    },
}

pub async fn handle_promptware_command(
    cmd: PromptwareCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
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
        PromptwareCommands::WriteMemory {
            name,
            filename,
            file,
        } => {
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
        PromptwareCommands::WriteTool {
            name,
            tool_name,
            file,
        } => {
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
        PromptwareCommands::Run {
            name,
            args,
            profile,
            working_dir,
            value,
            plan,
            promptware_path,
            config,
            agent,
            dry_run,
        } => {
            let p_folder = if let Some(custom) = &promptware_path {
                let candidate = custom.join(&name);
                if candidate.exists() {
                    candidate
                } else {
                    p_dir.join(&name)
                }
            } else {
                p_dir.join(&name)
            };

            if !p_folder.join("Program.md").exists() {
                // Ensure standard promptwares are deployed
                let _ = deploy_standard_promptwares(&p_dir);
                if !p_folder.join("Program.md").exists() {
                    anyhow::bail!("Promptware '{}' not found at {}", name, p_folder.display());
                }
            }

            let mut values = HashMap::new();
            if !args.is_empty() {
                values.insert("TaskDescription".to_string(), args.join(" "));
            }

            if let Some(plan_ref) = &plan {
                let plans_dir = get_plans_dir(tendril_home);
                if let Ok(plan_folder) = resolve_plan_folder(plan_ref, &plans_dir) {
                    values.insert(
                        "TendrilPlanFolder".to_string(),
                        plan_folder.to_string_lossy().to_string(),
                    );
                    values.insert(
                        "TendrilPlansFolder".to_string(),
                        plans_dir.to_string_lossy().to_string(),
                    );
                    if let Some(folder_name) = plan_folder.file_name().and_then(|n| n.to_str()) {
                        if let Some(dash_idx) = folder_name.find('-') {
                            values.insert(
                                "TendrilPlanId".to_string(),
                                folder_name[..dash_idx].to_string(),
                            );
                        }
                    }
                } else {
                    values.insert("TendrilPlanFolder".to_string(), plan_ref.clone());
                }
            }

            for v in value {
                if let Some(idx) = v.find('=') {
                    values.insert(v[..idx].to_string(), v[(idx + 1)..].to_string());
                }
            }

            let prompt = compile_firmware(&p_folder, &values)?;

            if dry_run {
                println!("{}", prompt);
                return Ok(());
            }

            let cfg_path = config.unwrap_or_else(|| get_config_path(tendril_home));
            let settings = load_config(&cfg_path).unwrap_or_default();
            let provider = agent.unwrap_or_else(|| settings.coding_agent.clone());
            let work_dir = working_dir.unwrap_or_else(|| p_folder.clone());

            // `--profile` names a tier (deep / balanced / quick), not an effort. Resolving it is what
            // turns it into a model and an effort the agent CLI will actually accept.
            let job_context = build_job_context(&values, tendril_home, &p_folder);
            let resolution = resolve_agent(
                &settings,
                &provider,
                &name,
                profile.as_deref(),
                &job_context,
            );
            let plan_folder = values
                .get("TendrilPlanFolder")
                .map(|s| s.as_str())
                .unwrap_or("");

            let launch_config = AgentLaunchConfig {
                prompt,
                working_directory: work_dir,
                model: resolution.model.clone(),
                effort: resolution.effort.clone(),
                permission_mode: Some("FullAuto".to_string()),
                allowed_tools: resolution.allowed_tools.clone(),
                denied_tools: resolution.denied_tools.clone(),
                writable_directories: resolve_writable_directories(
                    &name,
                    &p_folder,
                    Path::new(plan_folder),
                    tendril_home,
                    &settings,
                ),
                environment_variables: resolution.environment_variables.clone(),
                extra_arguments: resolution.extra_arguments.clone(),
                ..Default::default()
            };

            let spec = build_agent_spec(&provider, &launch_config);
            // Nothing cancels a foreground `promptware run`; Ctrl-C reaches the child directly.
            let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
            let outcome = run_agent_process(
                spec,
                |evt| {
                    if !evt.is_stderr {
                        println!("{}", evt.raw_line);
                    } else {
                        eprintln!("{}", evt.raw_line);
                    }
                },
                |_pid| {},
                cancel_rx,
                None,
            )
            .await?;

            if let Some(code) = outcome.exit_code {
                if code != 0 {
                    std::process::exit(code);
                }
            }
        }
    }

    Ok(())
}
