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
    compile_firmware, delete_memory, deploy_promptwares, list_memory, read_memory, read_provenance,
    resolve_overlay, write_memory, write_tool, DeployOptions, DeployReport, Layer,
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

    #[command(about = "Show which layer supplied each deployed promptware")]
    Layers {
        #[arg(help = "Limit the report to one promptware")]
        name: Option<String>,
    },

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
            help = "Override agent provider (claude, antigravity, codex, copilot, opencode, ivy, apple)"
        )]
        agent: Option<String>,
        #[arg(
            long,
            help = "Print the compiled firmware and exit without launching the agent"
        )]
        dry_run: bool,
    },
}

/// Renders a [`DeployReport`] as the `tendril promptware layers` table, optionally narrowed to one
/// promptware. Pure so the wording can be asserted in tests.
fn layer_lines(report: &DeployReport, filter: Option<&str>) -> Vec<String> {
    let mut lines = Vec::new();

    match (&report.overlay_root, &report.overlay_version) {
        (Some(root), Some(version)) => lines.push(format!(
            "Overlay: {} (.version {})",
            root.display(),
            version
        )),
        (Some(root), None) => lines.push(format!("Overlay: {}", root.display())),
        (None, _) => lines.push("Overlay: (none configured)".to_string()),
    }
    match &report.shipped_root {
        Some(root) => lines.push(format!(
            "Shipped: {} ({})",
            root.display(),
            report.shipped_version
        )),
        None => lines.push(format!("Shipped: (not found) ({})", report.shipped_version)),
    }
    lines.push(String::new());

    for entry in &report.promptwares {
        if let Some(want) = filter {
            if !entry.name.eq_ignore_ascii_case(want) {
                continue;
            }
        }
        // Neither layer supplied a program, so the stub fallback wrote one.
        let program = entry.program.map(Layer::label).unwrap_or("stub");
        let mut line = format!(
            "{:<26} Program.md: {:<9} Tools: {} overlay / {} shipped",
            entry.name,
            program,
            entry.tool_count(Layer::Overlay),
            entry.tool_count(Layer::Shipped)
        );
        if entry.overlay_only {
            line.push_str("   (overlay-only)");
        }
        lines.push(line);
    }

    lines
}

pub async fn handle_promptware_command(
    cmd: PromptwareCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    let p_dir = tendril_home.join("Promptwares");

    // Resolved once here so every deploy path in this command — explicit, lazy, and the layers
    // report — sees the same overlay.
    let overlay = resolve_overlay(
        tendril_home,
        &load_config(&get_config_path(tendril_home)).unwrap_or_default(),
    );
    let deploy_opts = DeployOptions {
        shipped_root: None,
        overlay: overlay.as_ref(),
    };

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
            let report = deploy_promptwares(&p_dir, deploy_opts)?;
            println!("Promptwares deployed to {}", p_dir.display());
            println!();
            for line in layer_lines(&report, None) {
                println!("{}", line);
            }
        }
        PromptwareCommands::Layers { name } => match read_provenance(&p_dir) {
            Some(report) => {
                for line in layer_lines(&report, name.as_deref()) {
                    println!("{}", line);
                }
            }
            None => println!(
                "No promptware provenance recorded at {} — run 'tendril promptware deploy'.",
                p_dir.display()
            ),
        },
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
                // Ensure promptwares are deployed. Passing the overlay is what lets an overlay-only
                // promptware (e.g. IvyFrameworkVerification) be materialized here rather than fail.
                let _ = deploy_promptwares(&p_dir, deploy_opts);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tendril_core::promptware::PromptwareProvenance;

    fn provenance(
        name: &str,
        program: Option<Layer>,
        overlay_only: bool,
        files: &[(&str, Layer)],
    ) -> PromptwareProvenance {
        PromptwareProvenance {
            name: name.to_string(),
            program,
            overlay_only,
            files: files
                .iter()
                .map(|(p, l)| (p.to_string(), *l))
                .collect::<BTreeMap<_, _>>(),
            version: None,
        }
    }

    fn report_with_overlay() -> DeployReport {
        DeployReport {
            shipped_root: Some(PathBuf::from("/repo/src/promptwares")),
            overlay_root: Some(PathBuf::from("/team/Promptwares")),
            overlay_version: Some("1.0.45".to_string()),
            shipped_version: "0.1.0".to_string(),
            promptwares: vec![
                provenance(
                    "CreatePlan",
                    Some(Layer::Overlay),
                    false,
                    &[("Program.md", Layer::Overlay)],
                ),
                provenance(
                    "ExecutePlan",
                    Some(Layer::Shipped),
                    false,
                    &[("Program.md", Layer::Shipped)],
                ),
                provenance(
                    "IvyFrameworkVerification",
                    Some(Layer::Overlay),
                    true,
                    &[
                        ("Program.md", Layer::Overlay),
                        ("Tools/Test-SampleBuild.ps1", Layer::Overlay),
                    ],
                ),
            ],
        }
    }

    #[test]
    fn layer_lines_report_both_roots_and_each_program_layer() {
        let lines = layer_lines(&report_with_overlay(), None);

        assert_eq!(lines[0], "Overlay: /team/Promptwares (.version 1.0.45)");
        assert_eq!(lines[1], "Shipped: /repo/src/promptwares (0.1.0)");
        assert_eq!(lines[2], "");
        assert!(lines[3].starts_with("CreatePlan"));
        assert!(lines[3].contains("Program.md: overlay"));
        assert!(lines[3].contains("Tools: 0 overlay / 0 shipped"));
        assert!(lines[4].contains("Program.md: shipped"));
    }

    #[test]
    fn layer_lines_flag_an_overlay_only_promptware_and_count_its_tools() {
        let lines = layer_lines(&report_with_overlay(), None);

        let row = lines
            .iter()
            .find(|l| l.starts_with("IvyFrameworkVerification"))
            .expect("overlay-only promptware is listed");
        assert!(row.contains("Tools: 1 overlay / 0 shipped"), "{row}");
        assert!(row.ends_with("(overlay-only)"), "{row}");
    }

    #[test]
    fn layer_lines_report_no_overlay_as_shipped_everywhere() {
        let mut report = report_with_overlay();
        report.overlay_root = None;
        report.overlay_version = None;
        report.promptwares = vec![provenance(
            "CreatePlan",
            Some(Layer::Shipped),
            false,
            &[("Program.md", Layer::Shipped)],
        )];

        let lines = layer_lines(&report, None);

        assert_eq!(lines[0], "Overlay: (none configured)");
        assert!(lines[3].contains("Program.md: shipped"));
        assert!(!lines.iter().any(|l| l.contains("overlay-only")));
    }

    #[test]
    fn layer_lines_narrow_to_one_promptware() {
        let lines = layer_lines(&report_with_overlay(), Some("executeplan"));

        // Header lines and the blank separator, then exactly the one requested row.
        assert_eq!(lines.len(), 4);
        assert!(lines[3].starts_with("ExecutePlan"));
    }

    #[test]
    fn layer_lines_label_a_stubbed_program() {
        let mut report = report_with_overlay();
        report.promptwares = vec![provenance("UpdateProject", None, false, &[])];

        let lines = layer_lines(&report, None);

        assert!(lines[3].contains("Program.md: stub"), "{}", lines[3]);
    }
}
