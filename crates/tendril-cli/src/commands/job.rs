use std::path::Path;
use clap::{Args, Subcommand};
use tendril_core::config::{get_plans_dir, MasterInfo, read_master};
use tendril_core::jobs::logger::append_agent_log;
use tendril_core::models::{
    CreatePlanArgs, ExecutePlanArgs, ExpandPlanArgs,
    JobArgs, RetryPlanArgs, SplitPlanArgs, UpdatePlanArgs,
};
use tendril_core::plans::resolve_plan_folder;

#[derive(Subcommand)]
pub enum JobCommands {
    #[command(about = "List jobs")]
    List(JobListArgs),

    #[command(about = "Start a background job on the running Tendril server")]
    Start(JobStartArgs),

    #[command(about = "Report job status to the server")]
    Status(JobStatusArgs),

    #[command(about = "Cancel a job")]
    Cancel(JobCancelArgs),

    #[command(about = "Append a narrative log entry to this job's log")]
    AddLog(JobAddLogArgs),
}

#[derive(Args)]
pub struct JobListArgs {
    #[arg(short, long)]
    pub status: Option<String>,
    #[arg(short, long, default_value = "20")]
    pub limit: usize,
    #[arg(long, help = "Output jobs as JSON")]
    pub json: bool,
}

#[derive(Args)]
pub struct JobStartArgs {
    #[arg(help = "Job type: ExecutePlan, CreatePlan, RetryPlan, UpdatePlan, ExpandPlan, SplitPlan, CreatePr, CreateIssue, SetupProject, AddProject, SyncRepo")]
    pub job_type: String,

    #[arg(help = "Plan ID or folder (or project name for SetupProject/AddProject)")]
    pub plan_id: Option<String>,

    #[arg(long, help = "Task description (for CreatePlan)")]
    pub description: Option<String>,

    #[arg(long, help = "Target project (for CreatePlan)")]
    pub project: Option<String>,

    #[arg(long, help = "Priority for CreatePlan")]
    pub priority: Option<i32>,

    #[arg(long, help = "Force CreatePlan without duplicate check")]
    pub force: bool,

    #[arg(long, help = "Source path (for CreatePlan)")]
    pub source_path: Option<String>,

    #[arg(long, help = "Reviewer feedback / change request (for RetryPlan)")]
    pub change_request: Option<String>,

    #[arg(long, help = "Execution note (for ExecutePlan)")]
    pub note: Option<String>,

    #[arg(long, help = "Refinement instructions (for UpdatePlan)")]
    pub instructions: Option<String>,

    #[arg(long, help = "Repository for CreateIssue")]
    pub repo: Option<String>,

    #[arg(long, help = "Assignee for CreateIssue / CreatePr")]
    pub assignee: Option<String>,

    #[arg(long, help = "Reviewers for CreatePr (repeatable or comma-separated)")]
    pub reviewer: Vec<String>,

    #[arg(long, help = "Comment for CreateIssue / CreatePr")]
    pub comment: Option<String>,

    #[arg(long, help = "Labels for CreateIssue")]
    pub labels: Option<String>,

    #[arg(long, help = "Skip merge for CreatePr")]
    pub no_merge: bool,

    #[arg(long, help = "Skip branch deletion for CreatePr")]
    pub no_delete_branch: bool,

    #[arg(long, help = "Skip artifacts for CreatePr")]
    pub no_artifacts: bool,

    #[arg(long, help = "Create draft PR for CreatePr")]
    pub draft: bool,

    #[arg(long, help = "Repository path for SyncRepo")]
    pub repo_path: Option<String>,

    #[arg(long, help = "Base branch for SyncRepo")]
    pub base_branch: Option<String>,

    #[arg(long, help = "Untracked policy for SyncRepo (Stash, Commit, PullRequest)")]
    pub untracked_policy: Option<String>,
}

#[derive(Args)]
pub struct JobStatusArgs {
    pub job_id: String,
    #[arg(short = 'm', long)]
    pub message: String,
    #[arg(long)]
    pub plan_id: Option<String>,
    #[arg(long)]
    pub plan_title: Option<String>,
}

#[derive(Args)]
pub struct JobCancelArgs {
    pub job_id: String,
    #[arg(short = 'm', long)]
    pub message: Option<String>,
}

#[derive(Args)]
pub struct JobAddLogArgs {
    pub job_id: String,
    pub action: String,
    #[arg(long)]
    pub summary: Option<String>,
}

pub async fn handle_job_command(cmd: JobCommands, tendril_home: &Path) -> anyhow::Result<()> {
    match cmd {
        JobCommands::AddLog(args) => {
            let log_path = append_agent_log(tendril_home, &args.job_id, &args.action, args.summary.as_deref())?;
            println!("Log written: {}", log_path.display());
            return Ok(());
        }
        JobCommands::List(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = reqwest::Client::new();
            let mut url = format!("http://127.0.0.1:{}/api/jobs?limit={}", master.port, args.limit);
            if let Some(st) = args.status {
                url.push_str(&format!("&status={}", st));
            }

            let resp = client.get(&url).send().await?.error_for_status()?;
            let jobs: serde_json::Value = resp.json().await?;

            if args.json {
                println!("{}", serde_json::to_string_pretty(&jobs)?);
                return Ok(());
            }

            println!("{:<8} {:<15} {:<12} {:<15} {}", "ID", "TYPE", "STATUS", "PROJECT", "PLAN / ARGS");
            println!("{}", "-".repeat(75));
            if let Some(arr) = jobs.as_array() {
                for j in arr {
                    println!(
                        "{:<8} {:<15} {:<12} {:<15} {}",
                        j["id"].as_str().unwrap_or(""),
                        j["type"].as_str().unwrap_or(""),
                        j["status"].as_str().unwrap_or(""),
                        j["project"].as_str().unwrap_or(""),
                        j["planFile"].as_str().unwrap_or("")
                    );
                }
            }
        }
        JobCommands::Start(args) => {
            let master = get_master_or_err(tendril_home)?;
            let plans_dir = get_plans_dir(tendril_home);

            let job_args = match args.job_type.to_ascii_lowercase().as_str() {
                "createplan" => {
                    let desc = args.description.ok_or_else(|| anyhow::anyhow!("--description is required for CreatePlan"))?;
                    let proj = args.project.ok_or_else(|| anyhow::anyhow!("--project is required for CreatePlan"))?;
                    JobArgs::CreatePlan(CreatePlanArgs {
                        description: desc,
                        project: proj,
                        priority: args.priority.unwrap_or(0),
                        force: args.force,
                        source_path: args.source_path,
                    })
                }
                "executeplan" => {
                    let pid = args.plan_id.ok_or_else(|| anyhow::anyhow!("<plan-id> is required for ExecutePlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::ExecutePlan(ExecutePlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        note: args.note,
                    })
                }
                "retryplan" => {
                    let pid = args.plan_id.ok_or_else(|| anyhow::anyhow!("<plan-id> is required for RetryPlan"))?;
                    let cr = args.change_request.ok_or_else(|| anyhow::anyhow!("--change-request is required for RetryPlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::RetryPlan(RetryPlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        change_request: cr,
                    })
                }
                "expandplan" => {
                    let pid = args.plan_id.ok_or_else(|| anyhow::anyhow!("<plan-id> is required for ExpandPlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::ExpandPlan(ExpandPlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                    })
                }
                "updateplan" => {
                    let pid = args.plan_id.ok_or_else(|| anyhow::anyhow!("<plan-id> is required for UpdatePlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    let inst = args.instructions.ok_or_else(|| anyhow::anyhow!("--instructions is required for UpdatePlan"))?;
                    JobArgs::UpdatePlan(UpdatePlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        instructions: Some(inst),
                    })
                }
                "splitplan" => {
                    let pid = args.plan_id.ok_or_else(|| anyhow::anyhow!("<plan-id> is required for SplitPlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::SplitPlan(SplitPlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                    })
                }
                "createpr" => {
                    let pid = args.plan_id.ok_or_else(|| anyhow::anyhow!("<plan-id> is required for CreatePr"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    let mut reviewers = Vec::new();
                    for r in &args.reviewer {
                        for sub in r.split(',') {
                            let trimmed = sub.trim();
                            if !trimmed.is_empty() {
                                reviewers.push(trimmed.to_string());
                            }
                        }
                    }
                    if reviewers.is_empty() {
                        if let Some(ass) = &args.assignee {
                            reviewers.push(ass.clone());
                        }
                    }
                    JobArgs::CreatePr(tendril_core::models::CreatePrArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        solve_merge_conflicts: true,
                        merge: !args.no_merge,
                        delete_branch: !args.no_delete_branch,
                        include_artifacts: !args.no_artifacts,
                        reviewers: if reviewers.is_empty() { None } else { Some(reviewers) },
                        comment: args.comment,
                        draft: args.draft,
                    })
                }
                "createissue" => {
                    let pid = args.plan_id.ok_or_else(|| anyhow::anyhow!("<plan-id> is required for CreateIssue"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    let repo = args.repo.ok_or_else(|| anyhow::anyhow!("--repo is required for CreateIssue"))?;
                    JobArgs::CreateIssue(tendril_core::models::CreateIssueArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        repo,
                        assignee: args.assignee,
                        comment: args.comment,
                        labels: args.labels,
                    })
                }
                "setupproject" => {
                    let name = args.plan_id.ok_or_else(|| anyhow::anyhow!("<project-name> is required for SetupProject"))?;
                    JobArgs::SetupProject(tendril_core::models::SetupProjectArgs {
                        folder_path: name,
                    })
                }
                "addproject" => {
                    let name = args.plan_id.ok_or_else(|| anyhow::anyhow!("<project-name> is required for AddProject"))?;
                    JobArgs::AddProject(tendril_core::models::AddProjectArgs {
                        project_name: name,
                        repos: Vec::new(),
                    })
                }
                "syncrepo" => {
                    let rp = args.repo_path.ok_or_else(|| anyhow::anyhow!("--repo-path is required for SyncRepo"))?;
                    let bb = args.base_branch.unwrap_or_else(|| "main".to_string());
                    JobArgs::SyncRepo(tendril_core::models::SyncRepoArgs {
                        repo_path: rp,
                        base_branch: bb,
                        plan_folder_path: None,
                        untracked_changes_policy: args.untracked_policy.unwrap_or_else(|| "Stash".to_string()),
                    })
                }
                _ => anyhow::bail!("Unsupported job type: {}", args.job_type),
            };

            let client = reqwest::Client::new();
            let url = format!("http://127.0.0.1:{}/api/jobs", master.port);
            let resp = client.post(&url).json(&job_args).send().await?.error_for_status()?;
            let res: serde_json::Value = resp.json().await?;

            println!("Job started: ID {}", res["jobId"].as_str().unwrap_or(""));
        }
        JobCommands::Status(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = reqwest::Client::new();
            let url = format!("http://127.0.0.1:{}/api/jobs/{}/status", master.port, args.job_id);
            let body = serde_json::json!({
                "message": args.message,
                "planId": args.plan_id,
                "planTitle": args.plan_title,
            });
            client.put(&url).json(&body).send().await?.error_for_status()?;
            println!("Status updated for job {}", args.job_id);
        }
        JobCommands::Cancel(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = reqwest::Client::new();
            let url = format!("http://127.0.0.1:{}/api/jobs/{}/cancel", master.port, args.job_id);
            let body = serde_json::json!({ "message": args.message });
            client.post(&url).json(&body).send().await?.error_for_status()?;
            println!("Job {} cancelled.", args.job_id);
        }
    }

    Ok(())
}

fn get_master_or_err(tendril_home: &Path) -> anyhow::Result<MasterInfo> {
    read_master(tendril_home)
        .ok_or_else(|| anyhow::anyhow!("Tendril server is not running. Start it with 'tendril serve' first."))
}
