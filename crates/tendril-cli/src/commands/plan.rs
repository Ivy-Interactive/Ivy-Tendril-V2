use tendril_core::git::worktree::cleanup_worktrees;
use std::io::Read;
use std::path::PathBuf;
use chrono::Utc;
use clap::{Args, Subcommand};
use tendril_core::config::{get_database_path, get_plans_dir};
use tendril_core::db::{get_plans, open_database, sync_plan};
use tendril_core::models::{PlanStatus, PlanVerificationEntry, VerificationStatus};
use tendril_core::plans::{
    add_recommendation, check_all_plans_health, check_plan_health,
    create_plan, get_revision, list_recommendations, read_plan_file, read_plan_yaml,
    resolve_plan_folder, set_recommendation_state, write_plan_yaml, write_revision,
    CreatePlanOptions, PlanCompletionGuard,
};

#[derive(Subcommand)]
pub enum PlanCommands {
    #[command(about = "List plans")]
    List(PlanListArgs),

    #[command(about = "Create a new plan")]
    Create(PlanCreateArgs),

    #[command(about = "Get plan data")]
    Get(PlanGetArgs),

    #[command(about = "Set a plan field")]
    Set(PlanSetArgs),

    #[command(about = "Validate plan health")]
    Validate(PlanValidateArgs),

    #[command(about = "Check all plans health")]
    Doctor,

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
}

#[derive(Args)]
pub struct PlanListArgs {
    #[arg(short, long)]
    pub status: Option<String>,
    #[arg(short, long)]
    pub project: Option<String>,
    #[arg(short, long)]
    pub q: Option<String>,
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
}

pub fn handle_plan_command(cmd: PlanCommands, tendril_home: &std::path::Path) -> anyhow::Result<()> {
    let plans_dir = get_plans_dir(tendril_home);
    let db_path = get_database_path(tendril_home);

    match cmd {
        PlanCommands::List(args) => {
            let conn = open_database(&db_path)?;
            let status_filter = args.status.as_deref().and_then(PlanStatus::from_str_loose);
            let plans = get_plans(&conn, status_filter, args.project.as_deref(), args.q.as_deref())?;

            println!("{:<8} {:<12} {:<10} {:<15} {}", "ID", "STATE", "LEVEL", "PROJECT", "TITLE");
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
        PlanCommands::Create(args) => {
            let mut verifications = Vec::new();
            for v in args.verification {
                let parts: Vec<&str> = v.split('=').collect();
                if parts.len() == 2 {
                    let st = VerificationStatus::from_str_loose(parts[1]).unwrap_or(VerificationStatus::Pending);
                    verifications.push(PlanVerificationEntry { name: parts[0].to_string(), status: st });
                }
            }

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
            };

            let plan_file = create_plan(&plans_dir, opts)?;
            println!("PlanId: {:05}", plan_file.metadata.id);
            println!("Directory: {}", plan_file.folder_path);
            println!("Verifications:");
            for v in &plan_file.metadata.verifications {
                println!("{}:{}", v.name, v.status);
            }

            if let Ok(conn) = open_database(&db_path) {
                let _ = sync_plan(&conn, &plan_file);
            }
        }
        PlanCommands::Get(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
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
                plan.title = args.value;
            } else if args.field.eq_ignore_ascii_case("level") {
                plan.level = args.value;
            } else if args.field.eq_ignore_ascii_case("project") {
                plan.project = args.value;
            } else if args.field.eq_ignore_ascii_case("executionprofile") {
                plan.execution_profile = Some(args.value);
            } else if args.field.eq_ignore_ascii_case("initialprompt") {
                plan.initial_prompt = Some(args.value);
            } else if args.field.eq_ignore_ascii_case("sourceurl") {
                plan.source_url = Some(args.value);
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
        PlanCommands::Doctor => {
            let issues = check_all_plans_health(&plans_dir)?;
            if issues.is_empty() {
                println!("All plans are healthy.");
            } else {
                for issue in issues {
                    println!("{}: [{}] {}", issue.plan_folder, issue.severity, issue.message);
                }
            }
        }
        PlanCommands::Cleanup(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            cleanup_worktrees(&folder)?;
            println!("Worktrees cleaned up for plan {}", args.plan_id);
        }
        PlanCommands::WriteRevision(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let content = if let Some(path) = args.file {
                std::fs::read_to_string(path)?
            } else if args.stdin {
                let mut buf = String::new();
                std::io::stdin().read_to_string(&mut buf)?;
                buf
            } else {
                anyhow::bail!("Specify --file <path> or --stdin");
            };

            let rev_num = write_revision(&folder, &content)?;
            println!("Revision {:03} written.", rev_num);

            if let Ok(pf) = read_plan_file(&folder) {
                if let Ok(conn) = open_database(&db_path) {
                    let _ = sync_plan(&conn, &pf);
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
                plan.prs.push(args.url);
                plan.updated = Utc::now();
                write_plan_yaml(&folder, &plan)?;
            }
            println!("PR added.");
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
            let (mut plan, _) = read_plan_yaml(&folder)?;
            let status = VerificationStatus::from_str_loose(&args.status)
                .ok_or_else(|| anyhow::anyhow!("Invalid verification status: {}", args.status))?;

            if let Some(entry) = plan.verifications.iter_mut().find(|v| v.name.eq_ignore_ascii_case(&args.name)) {
                entry.status = status;
            } else {
                plan.verifications.push(PlanVerificationEntry {
                    name: args.name,
                    status,
                });
            }

            plan.updated = Utc::now();
            write_plan_yaml(&folder, &plan)?;
            println!("Verification updated.");
        }
        PlanCommands::Rec(rec_cmd) => match rec_cmd {
            PlanRecCommands::List { plan_id } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                let recs = list_recommendations(&folder)?;
                for r in recs {
                    println!("[{}] {} - {}", r.state, r.title, r.description);
                }
            }
            PlanRecCommands::Add { plan_id, title, description, impact } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                add_recommendation(&folder, &title, &description, impact.as_deref())?;
                println!("Recommendation added.");
            }
            PlanRecCommands::Accept { plan_id, title } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                set_recommendation_state(&folder, &title, "Accepted", None)?;
                println!("Recommendation accepted.");
            }
            PlanRecCommands::Decline { plan_id, title, reason } => {
                let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
                set_recommendation_state(&folder, &title, "Declined", reason.as_deref())?;
                println!("Recommendation declined.");
            }
        },
    }

    Ok(())
}

