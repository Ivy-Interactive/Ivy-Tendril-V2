use clap::Subcommand;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use tendril_core::agents::providers::{build_agent_spec, AgentLaunchConfig};
use tendril_core::agents::resolution::resolve_agent;
use tendril_core::agents::runner::run_agent_process;
use tendril_core::config::{get_config_path, get_plans_dir, load_config, TendrilSettings};
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
        #[arg(long, help = "Read the content from this file instead of stdin")]
        file: Option<PathBuf>,
        /// Reading stdin is already the default; accepted because the agent instructions document
        /// this flag and an agent that types it must not get a clap usage error.
        #[arg(long, conflicts_with = "file", help = "Read the content from stdin")]
        stdin: bool,
    },

    #[command(about = "Delete an outdated promptware memory")]
    DeleteMemory { name: String, filename: String },

    #[command(about = "Write promptware tool")]
    WriteTool {
        name: String,
        tool_name: String,
        #[arg(long, help = "Read the content from this file instead of stdin")]
        file: Option<PathBuf>,
        /// See `WriteMemory::stdin`.
        #[arg(long, conflicts_with = "file", help = "Read the content from stdin")]
        stdin: bool,
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

/// Rejects a promptware or file name that is not a single plain path segment.
///
/// Every memory and tool path is built as `<Promptwares>/<name>/Memory/<filename>`, so a name
/// carrying a separator or a `..` would write outside the promptware's own directory. The agents
/// choose these names themselves from prose they read, so this is a real escape and not a
/// theoretical one. Rejecting here rather than in `tendril-core` keeps the CLI the single place a
/// caller-supplied name enters the file system.
fn validate_segment(label: &str, value: &str) -> anyhow::Result<()> {
    let is_single_segment = !value.contains('/')
        && !value.contains('\\')
        && matches!(
            Path::new(value).components().next(),
            Some(std::path::Component::Normal(_))
        )
        && Path::new(value).components().count() == 1;

    if !is_single_segment {
        anyhow::bail!(
            "Invalid {label} '{value}': must be a single file or folder name with no path separators"
        );
    }
    Ok(())
}

/// Reads the content for `write-memory`/`write-tool`: `--file` when given, otherwise stdin. `--stdin`
/// is redundant by construction, which is why it needs no branch of its own.
fn read_content(file: Option<PathBuf>) -> anyhow::Result<String> {
    if let Some(path) = file {
        return Ok(std::fs::read_to_string(path)?);
    }
    let mut buf = String::new();
    std::io::stdin().read_to_string(&mut buf)?;
    Ok(buf)
}

/// The firmware header values `tendril promptware run` compiles into the prompt: the free-form
/// arguments as `TaskDescription`, the resolved plan folder, and any `--value key=value` overrides,
/// which are applied last and therefore win.
fn build_run_values(
    args: &[String],
    plan: Option<&str>,
    overrides: &[String],
    tendril_home: &Path,
) -> HashMap<String, String> {
    let mut values = HashMap::new();
    if !args.is_empty() {
        values.insert("TaskDescription".to_string(), args.join(" "));
    }

    if let Some(plan_ref) = plan {
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
            // An unresolvable reference is passed through verbatim rather than dropped: a caller
            // pointing at a folder outside the plans directory still gets what it asked for.
            values.insert("TendrilPlanFolder".to_string(), plan_ref.to_string());
        }
    }

    for v in overrides {
        if let Some(idx) = v.find('=') {
            values.insert(v[..idx].to_string(), v[(idx + 1)..].to_string());
        }
    }

    values
}

/// Everything `tendril promptware run` has decided by the time the agent has to be resolved.
struct RunRequest<'a> {
    prompt: String,
    /// The promptware name, which is also the key `resolve_agent` looks up per-promptware config by.
    name: &'a str,
    promptware_folder: &'a Path,
    /// `--working-dir`; defaults to the promptware folder.
    working_dir: Option<PathBuf>,
    values: &'a HashMap<String, String>,
    /// `--profile`, a tier name rather than an effort.
    profile: Option<&'a str>,
    provider: &'a str,
}

/// The agent launch `tendril promptware run` performs. This is the one path that resolves the agent
/// properly, so it goes through [`resolve_agent`]: `--profile` names a *tier* (deep / balanced /
/// quick), not an effort, and resolving it is what turns it into a model and an effort the agent CLI
/// will actually accept. Extracted so the resolution can be asserted without spawning an agent.
fn build_run_launch(
    req: RunRequest<'_>,
    settings: &TendrilSettings,
    tendril_home: &Path,
) -> AgentLaunchConfig {
    let job_context = build_job_context(req.values, tendril_home, req.promptware_folder);
    let resolution = resolve_agent(settings, req.provider, req.name, req.profile, &job_context);
    let plan_folder = req
        .values
        .get("TendrilPlanFolder")
        .map(|s| s.as_str())
        .unwrap_or("");

    AgentLaunchConfig {
        prompt: req.prompt,
        working_directory: req
            .working_dir
            .unwrap_or_else(|| req.promptware_folder.to_path_buf()),
        model: resolution.model,
        effort: resolution.effort,
        permission_mode: Some("FullAuto".to_string()),
        allowed_tools: resolution.allowed_tools,
        denied_tools: resolution.denied_tools,
        writable_directories: resolve_writable_directories(
            req.name,
            req.promptware_folder,
            Path::new(plan_folder),
            tendril_home,
            settings,
        ),
        environment_variables: resolution.environment_variables,
        extra_arguments: resolution.extra_arguments,
        ..Default::default()
    }
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
            validate_segment("promptware name", &name)?;
            let files = list_memory(&p_dir, &name)?;
            for f in files {
                println!("{}", f);
            }
        }
        PromptwareCommands::ReadMemory { name, files } => {
            validate_segment("promptware name", &name)?;
            for file in &files {
                validate_segment("memory filename", file)?;
            }
            let content = read_memory(&p_dir, &name, &files)?;
            print!("{}", content);
        }
        PromptwareCommands::WriteMemory {
            name,
            filename,
            file,
            stdin: _,
        } => {
            validate_segment("promptware name", &name)?;
            validate_segment("memory filename", &filename)?;
            let content = read_content(file)?;
            write_memory(&p_dir, &name, &filename, &content)?;
            println!("Memory written.");
        }
        PromptwareCommands::DeleteMemory { name, filename } => {
            validate_segment("promptware name", &name)?;
            validate_segment("memory filename", &filename)?;
            delete_memory(&p_dir, &name, &filename)?;
            println!("Memory deleted.");
        }
        PromptwareCommands::WriteTool {
            name,
            tool_name,
            file,
            stdin: _,
        } => {
            validate_segment("promptware name", &name)?;
            validate_segment("tool filename", &tool_name)?;
            let content = read_content(file)?;
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
            validate_segment("promptware name", &name)?;
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

            let values = build_run_values(&args, plan.as_deref(), &value, tendril_home);
            let prompt = compile_firmware(&p_folder, &values)?;

            if dry_run {
                println!("{}", prompt);
                return Ok(());
            }

            let cfg_path = config.unwrap_or_else(|| get_config_path(tendril_home));
            let settings = load_config(&cfg_path).unwrap_or_default();
            let provider = agent.unwrap_or_else(|| settings.coding_agent.clone());

            let launch_config = build_run_launch(
                RunRequest {
                    prompt,
                    name: &name,
                    promptware_folder: &p_folder,
                    working_dir,
                    values: &values,
                    profile: profile.as_deref(),
                    provider: &provider,
                },
                &settings,
                tendril_home,
            );

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

    #[test]
    fn validate_segment_accepts_an_ordinary_name() {
        for good in [
            "CreatePlan",
            "lesson.md",
            "Test-SampleBuild.ps1",
            "with space.md",
            ".hidden",
        ] {
            assert!(
                validate_segment("memory filename", good).is_ok(),
                "rejected {good}"
            );
        }
    }

    #[test]
    fn validate_segment_rejects_anything_that_could_escape_the_promptware_folder() {
        for bad in [
            "",
            ".",
            "..",
            "../escaped.md",
            "..\\escaped.md",
            "nested/lesson.md",
            "nested\\lesson.md",
            "/etc/passwd",
            "Memory/../../escaped.md",
        ] {
            let err =
                validate_segment("memory filename", bad).expect_err(&format!("accepted {bad:?}"));
            assert!(
                err.to_string().starts_with("Invalid memory filename"),
                "{err}"
            );
        }
    }

    fn home() -> PathBuf {
        std::env::temp_dir().join("tendril-promptware-unit-home")
    }

    #[test]
    fn run_values_join_the_free_form_args_into_task_description() {
        let values = build_run_values(
            &["fix".to_string(), "the".to_string(), "bug".to_string()],
            None,
            &[],
            &home(),
        );

        assert_eq!(
            values.get("TaskDescription").map(String::as_str),
            Some("fix the bug")
        );
        // No plan was asked for, so no plan keys are invented.
        assert!(!values.contains_key("TendrilPlanFolder"));
    }

    #[test]
    fn run_values_omit_task_description_when_no_args_are_given() {
        assert!(build_run_values(&[], None, &[], &home()).is_empty());
    }

    #[test]
    fn run_values_let_an_explicit_value_override_win() {
        let values = build_run_values(
            &["ignored".to_string()],
            None,
            &[
                "TaskDescription=explicit".to_string(),
                "Custom=a=b".to_string(),
                "no-equals-sign".to_string(),
            ],
            &home(),
        );

        assert_eq!(
            values.get("TaskDescription").map(String::as_str),
            Some("explicit")
        );
        // Only the first `=` separates key from value.
        assert_eq!(values.get("Custom").map(String::as_str), Some("a=b"));
        assert!(!values.contains_key("no-equals-sign"));
    }

    #[test]
    fn run_values_pass_through_an_unresolvable_plan_reference() {
        let values = build_run_values(&[], Some("/nowhere/00999-Ghost"), &[], &home());

        assert_eq!(
            values.get("TendrilPlanFolder").map(String::as_str),
            Some("/nowhere/00999-Ghost")
        );
        assert!(!values.contains_key("TendrilPlanId"));
    }

    /// A `RunRequest` with only the fields a test cares about set.
    fn request<'a>(
        name: &'a str,
        folder: &'a Path,
        profile: Option<&'a str>,
        values: &'a HashMap<String, String>,
    ) -> RunRequest<'a> {
        RunRequest {
            prompt: "prompt".to_string(),
            name,
            promptware_folder: folder,
            working_dir: None,
            values,
            profile,
            provider: "claude",
        }
    }

    /// `--profile` is a tier name. Claude's built-in tiers are the fallback when config names no
    /// profile, so this pins the tier -> (model, effort) mapping the agent CLI is actually handed.
    #[test]
    fn run_launch_maps_each_profile_to_its_tier_model_and_effort() {
        let settings = TendrilSettings::default();
        let folder = home().join("Promptwares").join("CreatePlan");
        let values = HashMap::new();

        for (profile, model, effort) in [
            (Some("deep"), "opus", "max"),
            (Some("balanced"), "sonnet", "high"),
            (Some("quick"), "haiku", "low"),
        ] {
            let launch = build_run_launch(
                request("CreatePlan", &folder, profile, &values),
                &settings,
                &home(),
            );

            assert_eq!(launch.model.as_deref(), Some(model), "{profile:?}");
            assert_eq!(launch.effort.as_deref(), Some(effort), "{profile:?}");
        }
    }

    #[test]
    fn run_launch_defaults_the_working_directory_to_the_promptware_folder() {
        let settings = TendrilSettings::default();
        let folder = home().join("Promptwares").join("ExecutePlan");
        let values = HashMap::new();

        let launch = build_run_launch(
            request("ExecutePlan", &folder, None, &values),
            &settings,
            &home(),
        );

        assert_eq!(launch.working_directory, folder);
        assert_eq!(launch.permission_mode.as_deref(), Some("FullAuto"));
        // ExecutePlan writes files, so the write tools are on top of the base allowlist.
        assert!(launch.allowed_tools.contains(&"Read".to_string()));
        assert!(launch.allowed_tools.contains(&"Write".to_string()));
        assert!(launch.allowed_tools.contains(&"Edit".to_string()));
        // The promptware's own Memory/ and Tools/ are writable, via TENDRIL_HOME covering them.
        assert!(launch
            .writable_directories
            .contains(&home().to_string_lossy().to_string()));

        // An explicit --working-dir wins.
        let elsewhere = home().join("repos").join("widgets");
        let launch = build_run_launch(
            RunRequest {
                working_dir: Some(elsewhere.clone()),
                ..request("ExecutePlan", &folder, None, &values)
            },
            &settings,
            &home(),
        );
        assert_eq!(launch.working_directory, elsewhere);
    }

    /// A promptware that does not write files gets the base tools only — the resolution is real, not
    /// a blanket allowlist.
    #[test]
    fn run_launch_withholds_write_tools_from_a_read_only_promptware() {
        let folder = home().join("Promptwares").join("CreatePlan");
        let values = HashMap::new();
        let launch = build_run_launch(
            request("CreatePlan", &folder, None, &values),
            &TendrilSettings::default(),
            &home(),
        );

        assert!(!launch.allowed_tools.contains(&"Write".to_string()));
        assert!(!launch.allowed_tools.contains(&"Edit".to_string()));
    }
}
