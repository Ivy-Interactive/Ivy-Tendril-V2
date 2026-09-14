use chrono::Utc;
use clap::{Args, Subcommand};
use std::io::Read;
use std::path::PathBuf;
use tendril_core::config::{get_database_path, get_plans_dir, read_master};
use tendril_core::db::{get_plans, open_database, sync_plan};
use tendril_core::git::worktree::cleanup_worktrees;
use tendril_core::models::{PlanStatus, PlanVerificationEntry, VerificationStatus};
use tendril_core::plans::{
    add_recommendation, check_all_plans_health, check_plan_health, create_plan, get_revision,
    list_recommendations, materialize_plan_env, read_plan_file, read_plan_yaml,
    remove_recommendation, render_env_file, resolve_plan_folder, resolve_plan_project,
    resolve_worktrees, set_plan_verification_status, set_recommendation_state, write_plan_yaml,
    write_revision, CreatePlanOptions, DuplicateCandidateFinder, MaterializeOutcome,
    PlanCompletionGuard, RenderedEnvFile,
};

#[derive(Subcommand)]
pub enum PlanCommands {
    #[command(about = "List plans")]
    List(PlanListArgs),

    #[command(about = "Create a new plan")]
    Create(PlanCreateArgs),

    #[command(about = "Update plan from file or stdin")]
    Update(PlanUpdateArgs),

    #[command(about = "Get plan data")]
    Get(PlanGetArgs),

    #[command(about = "Set a plan field")]
    Set(PlanSetArgs),

    #[command(about = "Validate plan health")]
    Validate(PlanValidateArgs),

    #[command(about = "Check all plans health")]
    Doctor {
        #[arg(long)]
        fix: bool,
    },

    #[command(about = "Remove plan worktrees")]
    Cleanup(PlanCleanupArgs),

    #[command(about = "Write a revision")]
    WriteRevision(PlanWriteRevisionArgs),

    #[command(about = "Get revision content")]
    GetRevision(PlanGetRevisionArgs),

    #[command(about = "Add repository to plan")]
    AddRepo(PlanAddRepoArgs),

    #[command(about = "Remove repository from plan")]
    RemoveRepo(PlanRemoveRepoArgs),

    #[command(about = "Add pull request to plan")]
    AddPr(PlanAddPrArgs),

    #[command(about = "Add commit to plan")]
    AddCommit(PlanAddCommitArgs),

    #[command(about = "Add dependency to plan")]
    AddDependsOn(PlanAddDependsOnArgs),

    #[command(about = "Remove dependency from plan")]
    RemoveDependsOn(PlanRemoveDependsOnArgs),

    #[command(about = "Add related plan")]
    AddRelatedPlan(PlanAddRelatedArgs),

    #[command(about = "Remove related plan")]
    RemoveRelatedPlan(PlanRemoveRelatedArgs),

    #[command(about = "Set verification status")]
    SetVerification(PlanSetVerificationArgs),

    #[command(subcommand, about = "Manage plan recommendations")]
    Rec(PlanRecCommands),

    #[command(subcommand, about = "Materialize or inspect the plan's environment")]
    Env(PlanEnvCommands),
}

#[derive(Args)]
pub struct PlanListArgs {
    #[arg(short, long)]
    pub status: Option<String>,
    #[arg(long)]
    pub state: Option<String>,
    #[arg(short, long)]
    pub project: Option<String>,
    #[arg(long)]
    pub level: Option<String>,
    #[arg(long)]
    pub has_pr: bool,
    #[arg(long)]
    pub has_worktree: bool,
    #[arg(short = 'q', long)]
    pub search: Option<String>,
    #[arg(long)]
    pub format: Option<String>,
    #[arg(long)]
    pub limit: Option<usize>,
    #[arg(long)]
    pub plans_dir: Option<PathBuf>,
}

#[derive(Args)]
pub struct PlanCreateArgs {
    pub title: String,
    pub project: String,
    #[arg(long)]
    pub level: Option<String>,
    #[arg(long)]
    pub initial_prompt: Option<String>,
    #[arg(long)]
    pub source_url: Option<String>,
    #[arg(long)]
    pub execution_profile: Option<String>,
    #[arg(long)]
    pub priority: Option<i32>,
    #[arg(long)]
    pub verification: Vec<String>,
    #[arg(long)]
    pub depends_on: Vec<String>,
    #[arg(long)]
    pub related_plan: Vec<String>,
    #[arg(long)]
    pub chat_session: Option<String>,
    #[arg(long)]
    pub plans_dir: Option<PathBuf>,
    #[arg(long)]
    pub no_duplicate_check: bool,
}

#[derive(Args)]
pub struct PlanUpdateArgs {
    pub plan_id: String,
    #[arg(short, long)]
    pub file: Option<PathBuf>,
    #[arg(long)]
    pub stdin: bool,
    #[arg(long)]
    pub plans_dir: Option<PathBuf>,
}

#[derive(Args)]
pub struct PlanGetArgs {
    pub plan_id: String,
    pub field: Option<String>,
}

#[derive(Args)]
pub struct PlanSetArgs {
    pub plan_id: String,
    pub field: String,
    pub value: String,
    #[arg(long)]
    pub allow_failed_verifications: bool,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanValidateArgs {
    pub plan_id: String,
}

#[derive(Args)]
pub struct PlanCleanupArgs {
    pub plan_id: String,
}

#[derive(Args)]
pub struct PlanWriteRevisionArgs {
    pub plan_id: String,
    #[arg(long)]
    pub file: Option<PathBuf>,
    #[arg(long)]
    pub stdin: bool,
    #[arg(long)]
    pub plans_dir: Option<PathBuf>,
    #[arg(long, help = "Bypass question block validation")]
    pub no_question_check: bool,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanGetRevisionArgs {
    pub plan_id: String,
    #[arg(long)]
    pub number: Option<i32>,
}

#[derive(Args)]
pub struct PlanAddRepoArgs {
    pub plan_id: String,
    pub path: String,
}

#[derive(Args)]
pub struct PlanRemoveRepoArgs {
    pub plan_id: String,
    pub path: String,
}

#[derive(Args)]
pub struct PlanAddPrArgs {
    pub plan_id: String,
    pub url: String,
}

#[derive(Args)]
pub struct PlanAddCommitArgs {
    pub plan_id: String,
    pub sha: String,
}

#[derive(Args)]
pub struct PlanAddDependsOnArgs {
    pub plan_id: String,
    pub folder: String,
}

#[derive(Args)]
pub struct PlanRemoveDependsOnArgs {
    pub plan_id: String,
    pub folder: String,
}

#[derive(Args)]
pub struct PlanAddRelatedArgs {
    pub plan_id: String,
    pub folder: String,
}

#[derive(Args)]
pub struct PlanRemoveRelatedArgs {
    pub plan_id: String,
    pub folder: String,
}

#[derive(Args)]
pub struct PlanSetVerificationArgs {
    pub plan_id: String,
    pub name: String,
    pub status: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Subcommand)]
pub enum PlanRecCommands {
    #[command(about = "List recommendations")]
    List { plan_id: String },
    #[command(about = "Add recommendation")]
    Add {
        plan_id: String,
        title: String,
        #[arg(long, default_value = "")]
        description: String,
        #[arg(long)]
        impact: Option<String>,
    },
    #[command(about = "Accept recommendation")]
    Accept { plan_id: String, title: String },
    #[command(about = "Decline recommendation")]
    Decline {
        plan_id: String,
        title: String,
        #[arg(long)]
        reason: Option<String>,
    },
    #[command(about = "Remove recommendation")]
    Remove { plan_id: String, title: String },
}

#[derive(Subcommand)]
pub enum PlanEnvCommands {
    #[command(
        about = "Allocate ports and write the project's env files into the plan's worktrees"
    )]
    Materialize {
        plan_id: String,
        #[arg(long, help = "Only this repo's worktree (path or repo name)")]
        repo: Option<String>,
        #[arg(long, help = "Overwrite env files that were edited by hand")]
        force: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Print the plan's allocated ports and resolved environment")]
    Get {
        plan_id: String,
        #[arg(
            long,
            help = "Resolve against this repo's worktree (path or repo name)"
        )]
        repo: Option<String>,
        #[arg(long)]
        json: bool,
    },
}

pub fn resolve_source_chat_session(chat_session: Option<&str>) -> Option<String> {
    if let Some(cs) = chat_session {
        let trimmed = cs.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    std::env::var("TENDRIL_CHAT_SESSION_ID")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn report_plan_edit_event(
    tendril_home: &std::path::Path,
    plan_id: &str,
    summary: &str,
    reason: Option<&str>,
    source_chat_session_id: Option<&str>,
    revision_file: Option<&str>,
) {
    let master = match read_master(tendril_home) {
        Some(m) => m,
        None => {
            eprintln!(
                "Warning: could not report the edit to plan {}: server is offline",
                plan_id
            );
            return;
        }
    };

    let client = reqwest::Client::new();
    let url = format!(
        "http://{}:{}/api/plans/{}/events",
        master.host, master.port, plan_id
    );

    let payload = serde_json::json!({
        "summary": summary,
        "reason": reason,
        "sourceChatSessionId": source_chat_session_id,
        "revisionFile": revision_file,
    });

    match client
        .post(&url)
        .bearer_auth(&master.secret)
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                eprintln!(
                    "Warning: could not report the edit to plan {}: status {} - {}",
                    plan_id, status, text
                );
            }
        }
        Err(e) => {
            eprintln!(
                "Warning: could not report the edit to plan {}: {}",
                plan_id, e
            );
        }
    }
}

pub async fn handle_plan_command(
    cmd: PlanCommands,
    tendril_home: &std::path::Path,
) -> anyhow::Result<()> {
    let plans_dir = get_plans_dir(tendril_home);
    let db_path = get_database_path(tendril_home);

    match cmd {
        PlanCommands::List(args) => {
            let custom_dir = args.plans_dir.is_some();
            let p_dir = args.plans_dir.unwrap_or(plans_dir);
            let status_filter = args
                .state
                .as_deref()
                .or(args.status.as_deref())
                .and_then(PlanStatus::from_str_loose);
            let search_term = args.search.as_deref();

            let mut plans = if custom_dir || !db_path.exists() {
                let mut disk_plans = Vec::new();
                if p_dir.exists() {
                    if let Ok(entries) = std::fs::read_dir(&p_dir) {
                        for entry in entries.flatten() {
                            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                                if let Ok(plan) = read_plan_file(&entry.path()) {
                                    disk_plans.push(plan);
                                }
                            }
                        }
                    }
                }
                disk_plans.retain(|p| {
                    if let Some(state) = status_filter {
                        if p.metadata.state != state {
                            return false;
                        }
                    }
                    if let Some(proj) = args.project.as_deref() {
                        if !p.metadata.project.eq_ignore_ascii_case(proj) {
                            return false;
                        }
                    }
                    if let Some(st) = search_term {
                        let id_str = format!("{:05}", p.metadata.id);
                        if !p.metadata.title.to_lowercase().contains(&st.to_lowercase())
                            && !id_str.contains(st)
                        {
                            return false;
                        }
                    }
                    true
                });
                disk_plans
            } else {
                let conn = open_database(&db_path)?;
                get_plans(&conn, status_filter, args.project.as_deref(), search_term)?
            };

            if let Some(lvl) = &args.level {
                plans.retain(|p| p.metadata.level.eq_ignore_ascii_case(lvl));
            }
            if args.has_pr {
                plans.retain(|p| !p.metadata.prs.is_empty());
            }
            if args.has_worktree {
                plans.retain(|p| {
                    let folder = std::path::Path::new(&p.folder_path);
                    let wt_dir = folder.join("Worktrees");
                    wt_dir.exists()
                        && std::fs::read_dir(&wt_dir)
                            .map(|mut it| it.next().is_some())
                            .unwrap_or(false)
                });
            }

            if let Some(limit) = args.limit {
                plans.truncate(limit);
            }

            match args
                .format
                .as_deref()
                .unwrap_or("table")
                .to_ascii_lowercase()
                .as_str()
            {
                "json" => {
                    println!("{}", serde_json::to_string_pretty(&plans)?);
                }
                "ids" => {
                    for p in plans {
                        println!("{:05}", p.metadata.id);
                    }
                }
                "folders" => {
                    for p in plans {
                        let name = std::path::Path::new(&p.folder_path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(&p.folder_path);
                        println!("{}", name);
                    }
                }
                _ => {
                    println!(
                        "{:<8} {:<12} {:<10} {:<15} TITLE",
                        "ID", "STATE", "LEVEL", "PROJECT"
                    );
                    println!("{}", "-".repeat(70));
                    for p in plans {
                        println!(
                            "{:<8} {:<12} {:<10} {:<15} {}",
                            format!("{:05}", p.metadata.id),
                            p.metadata.state.to_string(),
                            p.metadata.level,
                            p.metadata.project,
                            p.metadata.title
                        );
                    }
                }
            }
        }
        PlanCommands::Create(args) => {
            let p_dir = args.plans_dir.unwrap_or(plans_dir);
            let mut verifications = Vec::new();
            for v in args.verification {
                let parts: Vec<&str> = v.split('=').collect();
                if parts.len() == 2 {
                    let st = VerificationStatus::from_str_loose(parts[1])
                        .unwrap_or(VerificationStatus::Pending);
                    verifications.push(PlanVerificationEntry {
                        name: parts[0].to_string(),
                        status: st,
                    });
                }
            }

            let duplicates =
                DuplicateCandidateFinder::find(&p_dir, &args.title, &args.project, None);

            let opts = CreatePlanOptions {
                title: args.title,
                project: args.project,
                level: args.level,
                initial_prompt: args.initial_prompt,
                source_url: args.source_url,
                execution_profile: args.execution_profile,
                priority: args.priority,
                repos: Vec::new(),
                verifications,
                depends_on: args.depends_on,
                related_plans: args.related_plan,
                chat_session_id: args.chat_session,
            };

            let plan_file = create_plan(&p_dir, opts)?;
            println!("PlanId: {:05}", plan_file.metadata.id);
            println!("Directory: {}", plan_file.folder_path);
            println!("Verifications:");
            for v in &plan_file.metadata.verifications {
                println!("{}:{}", v.name, v.status);
            }

            if !args.no_duplicate_check {
                let block = DuplicateCandidateFinder::format_block(&duplicates);
                if !block.is_empty() {
                    println!("{}", block);
                }
            }

            if let Ok(conn) = open_database(&db_path) {
                let _ = sync_plan(&conn, &plan_file);
            }
        }
        PlanCommands::Update(args) => {
            let p_dir = args.plans_dir.unwrap_or(plans_dir);
            let folder = resolve_plan_folder(&args.plan_id, &p_dir)?;
            let content = if let Some(path) = args.file {
                std::fs::read_to_string(path)?
            } else if args.stdin {
                let mut buf = String::new();
                std::io::stdin().read_to_string(&mut buf)?;
                buf
            } else {
                anyhow::bail!("No YAML content provided (use --file or --stdin)");
            };

            let plan: tendril_core::models::PlanYaml = serde_yaml::from_str(&content)?;
            write_plan_yaml(&folder, &plan)?;

            if let Ok(plan_file) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&db_path) {
                    let _ = sync_plan(&conn, &plan_file);
                }
            }
            println!("Updated plan {}", args.plan_id);
        }
        PlanCommands::Get(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;

            // Read straight from plan.yaml: allocatedPorts is deliberately not on PlanMetadata.
            if args
                .field
                .as_deref()
                .is_some_and(|f| f.eq_ignore_ascii_case("allocatedports"))
            {
                let (plan, _) = read_plan_yaml(&folder)?;
                for (name, port) in plan.allocated_ports.unwrap_or_default() {
                    println!("{}={}", name, port);
                }
                return Ok(());
            }

            let plan_file = read_plan_file(&folder)?;

            if let Some(f) = args.field {
                let val = match f.to_ascii_lowercase().as_str() {
                    "title" => plan_file.metadata.title,
                    "state" => plan_file.metadata.state.to_string(),
                    "project" => plan_file.metadata.project,
                    "level" => plan_file.metadata.level,
                    "id" => plan_file.metadata.id.to_string(),
                    "initialprompt" => plan_file.metadata.initial_prompt.unwrap_or_default(),
                    "sourceurl" => plan_file.metadata.source_url.unwrap_or_default(),
                    _ => String::new(),
                };
                println!("{}", val);
            } else {
                println!("{}", plan_file.yaml_raw);
            }
        }
        PlanCommands::Set(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;

            if args.field.eq_ignore_ascii_case("state") {
                if let Some(new_state) = PlanStatus::from_str_loose(&args.value) {
                    if let Some(warn) = PlanCompletionGuard::apply_state(
                        &mut plan,
                        new_state,
                        args.allow_failed_verifications,
                        &args.plan_id,
                    )? {
                        eprintln!("{}", warn);
                    }
                } else {
                    anyhow::bail!("Invalid state: {}", args.value);
                }
            } else if args.field.eq_ignore_ascii_case("title") {
                plan.title = args.value.clone();
            } else if args.field.eq_ignore_ascii_case("level") {
                plan.level = args.value.clone();
            } else if args.field.eq_ignore_ascii_case("project") {
                plan.project = args.value.clone();
            } else if args.field.eq_ignore_ascii_case("executionprofile") {
                plan.execution_profile = Some(args.value.clone());
            } else if args.field.eq_ignore_ascii_case("initialprompt") {
                plan.initial_prompt = Some(args.value.clone());
            } else if args.field.eq_ignore_ascii_case("sourceurl") {
                plan.source_url = Some(args.value.clone());
            } else if args.field.eq_ignore_ascii_case("priority") {
                if let Ok(p) = args.value.parse::<i32>() {
                    plan.priority = p;
                }
            }

            plan.updated = Utc::now();
            write_plan_yaml(&folder, &plan)?;
            println!("Updated {} to '{}'", args.field, plan.title);

            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }

            let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
            report_plan_edit_event(
                tendril_home,
                &args.plan_id,
                &format!("{} set to {}", args.field, args.value),
                args.reason.as_deref(),
                source_chat.as_deref(),
                None,
            )
            .await;
        }
        PlanCommands::Validate(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let issues = check_plan_health(&folder);
            if issues.is_empty() {
                println!("Plan is valid.");
            } else {
                for issue in issues {
                    println!("[{}] {}", issue.severity, issue.message);
                }
            }
        }
        PlanCommands::Doctor { fix } => {
            if fix {
                let migrator = tendril_core::plans::migrations::PlanMigrator::new();
                let count = migrator.migrate_plans(&plans_dir, None)?;
                if count > 0 {
                    println!(
                        "Migrated {} plan(s) to schema version {}.",
                        count,
                        migrator.latest_version()
                    );
                }
            }
            let issues = check_all_plans_health(&plans_dir)?;
            if issues.is_empty() {
                println!("All plans are healthy.");
            } else {
                for issue in issues {
                    println!(
                        "{}: [{}] {}",
                        issue.plan_folder, issue.severity, issue.message
                    );
                }
            }
        }
        PlanCommands::Cleanup(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            cleanup_worktrees(&folder)?;
            println!("Worktrees cleaned up for plan {}", args.plan_id);
        }
        PlanCommands::WriteRevision(args) => {
            let p_dir = args.plans_dir.unwrap_or(plans_dir);
            let folder = resolve_plan_folder(&args.plan_id, &p_dir)?;
            let content = if let Some(path) = args.file {
                std::fs::read_to_string(path)?
            } else if args.stdin {
                let mut buf = String::new();
                std::io::stdin().read_to_string(&mut buf)?;
                buf
            } else {
                anyhow::bail!("Specify --file <path> or --stdin");
            };

            let rev_num = write_revision(&folder, &content, !args.no_question_check)?;
            println!("Revision {:03} written.", rev_num);

            if args.reason.as_deref().is_none_or(|r| r.trim().is_empty()) {
                eprintln!("warning: no --reason given for this plan edit. Pass --reason \"<why you changed it>\" so the plan's other chat sessions are told why, not just what.");
            }

            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&db_path) {
                    let _ = sync_plan(&conn, &pf);
                }
            }

            let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
            report_plan_edit_event(
                tendril_home,
                &args.plan_id,
                &format!("revision {:03}.md written", rev_num),
                args.reason.as_deref(),
                source_chat.as_deref(),
                Some(&format!("{:03}.md", rev_num)),
            )
            .await;

            if let Ok((plan, _)) = read_plan_yaml(&folder) {
                if let Some(folder_name) = folder.file_name().and_then(|n| n.to_str()) {
                    let candidates = DuplicateCandidateFinder::find(
                        &p_dir,
                        &plan.title,
                        &plan.project,
                        Some(folder_name),
                    );
                    if !candidates.is_empty() {
                        eprintln!();
                        eprintln!("warning: {} possible duplicate plan(s) found. Review before this plan is executed:", candidates.len());
                        eprintln!("{}", DuplicateCandidateFinder::format_block(&candidates));
                    }
                }
            }
        }
        PlanCommands::GetRevision(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let content = get_revision(&folder, args.number)?;
            println!("{}", content);
        }
        PlanCommands::AddRepo(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;
            if !plan.repos.contains(&args.path) {
                plan.repos.push(args.path);
                plan.updated = Utc::now();
                write_plan_yaml(&folder, &plan)?;
            }
            println!("Repo added.");
        }
        PlanCommands::RemoveRepo(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;
            plan.repos.retain(|r| r != &args.path);
            plan.updated = Utc::now();
            write_plan_yaml(&folder, &plan)?;
            println!("Repo removed.");
        }
        PlanCommands::AddPr(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;
            if !plan.prs.contains(&args.url) {
                plan.prs.push(args.url.clone());
                plan.updated = Utc::now();
                write_plan_yaml(&folder, &plan)?;
            }
            println!("PR added.");

            let source_chat = resolve_source_chat_session(None);
            report_plan_edit_event(
                tendril_home,
                &args.plan_id,
                &format!("PR added: {}", args.url),
                None,
                source_chat.as_deref(),
                None,
            )
            .await;
        }
        PlanCommands::AddCommit(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;
            if !plan.commits.contains(&args.sha) {
                plan.commits.push(args.sha);
                plan.updated = Utc::now();
                write_plan_yaml(&folder, &plan)?;
            }
            println!("Commit added.");
        }
        PlanCommands::AddDependsOn(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;
            if !plan.depends_on.contains(&args.folder) {
                plan.depends_on.push(args.folder);
                plan.updated = Utc::now();
                write_plan_yaml(&folder, &plan)?;
            }
            println!("Dependency added.");
        }
        PlanCommands::RemoveDependsOn(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;
            plan.depends_on.retain(|d| d != &args.folder);
            plan.updated = Utc::now();
            write_plan_yaml(&folder, &plan)?;
            println!("Dependency removed.");
        }
        PlanCommands::AddRelatedPlan(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;
            if !plan.related_plans.contains(&args.folder) {
                plan.related_plans.push(args.folder);
                plan.updated = Utc::now();
                write_plan_yaml(&folder, &plan)?;
            }
            println!("Related plan added.");
        }
        PlanCommands::RemoveRelatedPlan(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (mut plan, _) = read_plan_yaml(&folder)?;
            plan.related_plans.retain(|r| r != &args.folder);
            plan.updated = Utc::now();
            write_plan_yaml(&folder, &plan)?;
            println!("Related plan removed.");
        }
        PlanCommands::SetVerification(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let status = VerificationStatus::from_str_loose(&args.status)
                .ok_or_else(|| anyhow::anyhow!("Invalid verification status: {}", args.status))?;

            set_plan_verification_status(&folder, &args.name, status)?;
            println!("Verification updated.");

            let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
            report_plan_edit_event(
                tendril_home,
                &args.plan_id,
                &format!("verification {} set to {}", args.name, args.status),
                args.reason.as_deref(),
                source_chat.as_deref(),
                None,
            )
            .await;
        }
        PlanCommands::Rec(rec_cmd) => match rec_cmd {
            PlanRecCommands::List { plan_id } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                let recs = list_recommendations(&folder)?;
                for r in recs {
                    println!("[{}] {} - {}", r.state, r.title, r.description);
                }
            }
            PlanRecCommands::Add {
                plan_id,
                title,
                description,
                impact,
            } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                add_recommendation(&folder, &title, &description, impact.as_deref())?;
                println!("Recommendation added.");
            }
            PlanRecCommands::Accept { plan_id, title } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                set_recommendation_state(&folder, &title, "Accepted", None)?;
                println!("Recommendation accepted.");
            }
            PlanRecCommands::Decline {
                plan_id,
                title,
                reason,
            } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                set_recommendation_state(&folder, &title, "Declined", reason.as_deref())?;
                println!("Recommendation declined.");
            }
            PlanRecCommands::Remove { plan_id, title } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                remove_recommendation(&folder, &title)?;
                println!("Recommendation removed.");
            }
        },
        PlanCommands::Env(env_cmd) => match env_cmd {
            PlanEnvCommands::Materialize {
                plan_id,
                repo,
                force,
                json,
            } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                let (plan, _) = read_plan_yaml(&folder)?;
                let project = resolve_plan_project(&plan.project, tendril_home)?;
                let report = materialize_plan_env(&folder, tendril_home, repo.as_deref(), force)?;

                if json {
                    let first = report.worktrees.first();
                    let files: Vec<(&RenderedEnvFile, Option<MaterializeOutcome>)> = first
                        .map(|w| w.files.iter().map(|(r, o)| (r, Some(*o))).collect())
                        .unwrap_or_default();
                    println!(
                        "{}",
                        env_json_document(
                            &folder,
                            &report.project,
                            first.map(|w| w.worktree.as_path()),
                            &report.allocated_ports,
                            &files,
                        )
                    );
                    return Ok(());
                }

                for (name, port) in &report.allocated_ports {
                    println!("Port {}: {}", name, port);
                }

                if report.worktrees.is_empty() {
                    match repo.as_deref() {
                        Some(r) => anyhow::bail!("No worktree found for repo {}.", r),
                        None => anyhow::bail!(
                            "No worktrees found for this plan - run 'tendril plan add-worktree' first."
                        ),
                    }
                }

                if project.env_files.is_empty() {
                    println!("No environment files configured for this project.");
                    return Ok(());
                }

                for wt in &report.worktrees {
                    let unchanged = wt
                        .files
                        .iter()
                        .filter(|(_, o)| *o == MaterializeOutcome::Unchanged)
                        .count();
                    let skipped = wt
                        .files
                        .iter()
                        .filter(|(_, o)| *o == MaterializeOutcome::SkippedHandEdited)
                        .count();
                    println!(
                        "Materialized {} environment file(s) into {} ({} unchanged, {} skipped).",
                        wt.files.len(),
                        wt.worktree.display(),
                        unchanged,
                        skipped
                    );

                    for (rendered, outcome) in &wt.files {
                        if *outcome == MaterializeOutcome::SkippedHandEdited {
                            eprintln!(
                                "warning: {} was edited by hand - not overwritten (use --force)",
                                rendered.path
                            );
                        }
                        for missing in &rendered.missing {
                            eprintln!(
                                "warning: {}: {} is unset ({})",
                                rendered.path, missing.key, missing.reference
                            );
                        }
                    }
                }
            }
            PlanEnvCommands::Get {
                plan_id,
                repo,
                json,
            } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                let (plan, _) = read_plan_yaml(&folder)?;
                let project = resolve_plan_project(&plan.project, tendril_home)?;
                // Read-only: ports come from plan.yaml, never allocated here, so this is safe to run
                // against a plan under review.
                let allocated = plan.allocated_ports.clone().unwrap_or_default();

                // A template is read relative to a worktree. Without one the templates are simply
                // absent and only the overrides show.
                let worktrees = resolve_worktrees(&plan, &folder, repo.as_deref());
                let worktree = worktrees.first().cloned().unwrap_or_else(|| folder.clone());

                let rendered: Vec<RenderedEnvFile> = project
                    .env_files
                    .iter()
                    .filter(|f| !f.path.trim().is_empty())
                    .map(|f| render_env_file(f, &project, &allocated, &worktree, tendril_home))
                    .collect();

                if json {
                    let files: Vec<(&RenderedEnvFile, Option<MaterializeOutcome>)> =
                        rendered.iter().map(|r| (r, None)).collect();
                    println!(
                        "{}",
                        env_json_document(
                            &folder,
                            &project.name,
                            Some(worktree.as_path()),
                            &allocated,
                            &files,
                        )
                    );
                    return Ok(());
                }

                if allocated.is_empty() {
                    println!("No ports allocated for this plan.");
                } else {
                    println!("Port\tValue");
                    for (name, port) in &allocated {
                        println!("{}\t{}", name, port);
                    }
                }

                if project.env_files.is_empty() {
                    println!("No environment files configured for this project.");
                    return Ok(());
                }

                for file in &rendered {
                    println!("{}", file.path);
                    if file.values.is_empty() {
                        println!("  (empty)");
                        continue;
                    }
                    for (key, value) in &file.values {
                        println!("  {}={}", key, value);
                    }
                }

                for file in &rendered {
                    for missing in &file.missing {
                        println!(
                            "Missing: {} {} ({})",
                            file.path, missing.key, missing.reference
                        );
                    }
                }
            }
        },
    }

    Ok(())
}

/// The plan id as everything else in Tendril addresses it: the folder's 5-digit prefix.
fn plan_id_from_folder(plan_folder: &std::path::Path) -> String {
    plan_folder
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.split('-').next().unwrap_or(n).to_string())
        .unwrap_or_default()
}

/// The `--json` document for both `plan env` commands. `outcome` is present only for `materialize`.
fn env_json_document(
    plan_folder: &std::path::Path,
    project: &str,
    worktree: Option<&std::path::Path>,
    allocated: &std::collections::BTreeMap<String, u16>,
    files: &[(&RenderedEnvFile, Option<MaterializeOutcome>)],
) -> String {
    let env_files: Vec<serde_json::Value> = files
        .iter()
        .map(|(rendered, outcome)| {
            let values: serde_json::Map<String, serde_json::Value> = rendered
                .values
                .iter()
                .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
                .collect();
            let missing: Vec<serde_json::Value> = rendered
                .missing
                .iter()
                .map(|m| serde_json::json!({ "key": m.key, "reference": m.reference }))
                .collect();

            let mut doc = serde_json::json!({
                "path": rendered.path,
                "values": values,
                "missing": missing,
            });
            if let Some(outcome) = outcome {
                doc["outcome"] = serde_json::Value::String(outcome.as_str().to_string());
            }
            doc
        })
        .collect();

    let doc = serde_json::json!({
        "planId": plan_id_from_folder(plan_folder),
        "project": project,
        "worktree": worktree.map(|w| w.to_string_lossy().to_string()),
        "allocatedPorts": allocated,
        "envFiles": env_files,
    });

    serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".to_string())
}
