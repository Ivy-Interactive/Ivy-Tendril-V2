use clap::{Args, Subcommand};
use std::io::{IsTerminal, Write};
use std::path::Path;
use tendril_core::config::{get_plans_dir, read_master, MasterInfo};
use tendril_core::jobs::logger::append_agent_log;
use tendril_core::models::{
    CreatePlanArgs, ExecutePlanArgs, ExpandPlanArgs, JobArgs, RetryPlanArgs, SplitPlanArgs,
    UpdatePlanArgs,
};
use tendril_core::plans::resolve_plan_folder;

#[derive(Subcommand)]
#[allow(clippy::large_enum_variant)]
pub enum JobCommands {
    #[command(about = "List jobs")]
    List(JobListArgs),

    #[command(about = "Start a background job on the running Tendril server")]
    Start(JobStartArgs),

    #[command(about = "Report job status to the server")]
    Status(JobStatusArgs),

    #[command(about = "Report job failure to the server")]
    Fail(JobFailArgs),

    #[command(about = "Cancel a job")]
    Cancel(JobCancelArgs),

    #[command(about = "Append a narrative log entry to this job's log")]
    AddLog(JobAddLogArgs),

    #[command(about = "Remove a job from the job list and the database (log artifacts are kept)")]
    Delete(JobDeleteArgs),

    #[command(about = "Promote a blocked or queued job past its gates and run it next")]
    ForceStart(JobForceStartArgs),

    #[command(about = "Stop every running, queued, pending or blocked job")]
    StopAll,

    #[command(about = "Bulk-delete jobs by status")]
    Clear(JobClearArgs),

    #[command(about = "Show queued jobs in dispatch order")]
    Queue(JobQueueArgs),

    #[command(about = "Run one job maintenance pass now instead of waiting for the timer")]
    Maintenance,
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
    #[arg(
        help = "Job type: ExecutePlan, CreatePlan, RetryPlan, UpdatePlan, ExpandPlan, SplitPlan, CreatePr, CreateIssue, SetupProject, AddProject, SyncRepo"
    )]
    pub job_type: String,

    #[arg(help = "Plan ID or folder (or project name for SetupProject/AddProject)")]
    pub plan_id: Option<String>,

    #[arg(long, help = "Task description (for CreatePlan)")]
    pub description: Option<String>,

    #[arg(long, help = "Target project (for CreatePlan)")]
    pub project: Option<String>,

    #[arg(
        long,
        help = "Priority (higher runs first) — applies to every job type"
    )]
    pub priority: Option<i32>,

    #[arg(
        long = "wait-for",
        help = "Job id this job must wait for before it is queued (repeatable)"
    )]
    pub wait_for: Vec<String>,

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

    #[arg(
        long,
        help = "Untracked policy for SyncRepo (Stash, Commit, PullRequest)"
    )]
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
pub struct JobFailArgs {
    pub job_id: String,
    #[arg(short = 'm', long)]
    pub message: String,
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

#[derive(Args)]
pub struct JobDeleteArgs {
    pub job_id: String,
}

#[derive(Args)]
pub struct JobForceStartArgs {
    pub job_id: String,
}

#[derive(Args)]
pub struct JobClearArgs {
    #[arg(long, help = "Clear completed jobs (the default)")]
    pub completed: bool,
    #[arg(long, help = "Clear failed, timed-out and stopped jobs")]
    pub failed: bool,
    #[arg(long, help = "Clear every job except running, queued and blocked ones")]
    pub all: bool,
    #[arg(short = 'y', long, help = "Skip the confirmation prompt for --all")]
    pub yes: bool,
}

#[derive(Args)]
pub struct JobQueueArgs {
    #[arg(long, help = "Output the queue as JSON")]
    pub json: bool,
}

pub async fn handle_job_command(cmd: JobCommands, tendril_home: &Path) -> anyhow::Result<()> {
    match cmd {
        JobCommands::AddLog(args) => {
            let log_path = append_agent_log(
                tendril_home,
                &args.job_id,
                &args.action,
                args.summary.as_deref(),
            )?;
            println!("Log written: {}", log_path.display());
            return Ok(());
        }
        JobCommands::List(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = reqwest::Client::new();
            let mut url = format!(
                "http://{}:{}/api/jobs?limit={}",
                master.host, master.port, args.limit
            );
            if let Some(st) = args.status {
                url.push_str(&format!("&status={}", st));
            }

            let resp = client.get(&url).bearer_auth(&master.secret).send().await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}:{}",
                    master.host,
                    master.port
                );
            }
            let resp = resp.error_for_status()?;
            let jobs: serde_json::Value = resp.json().await?;

            if args.json {
                println!("{}", serde_json::to_string_pretty(&jobs)?);
                return Ok(());
            }

            println!(
                "{:<8} {:<15} {:<12} {:<15} PLAN / ARGS",
                "ID", "TYPE", "STATUS", "PROJECT"
            );
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
                    let desc = args.description.ok_or_else(|| {
                        anyhow::anyhow!("--description is required for CreatePlan")
                    })?;
                    let proj = args
                        .project
                        .ok_or_else(|| anyhow::anyhow!("--project is required for CreatePlan"))?;
                    JobArgs::CreatePlan(CreatePlanArgs {
                        description: desc,
                        project: proj,
                        priority: args.priority.unwrap_or(0),
                        force: args.force,
                        source_path: args.source_path,
                        upload_session_id: None,
                    })
                }
                "executeplan" => {
                    let pid = args
                        .plan_id
                        .ok_or_else(|| anyhow::anyhow!("<plan-id> is required for ExecutePlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::ExecutePlan(ExecutePlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        note: args.note,
                    })
                }
                "retryplan" => {
                    let pid = args
                        .plan_id
                        .ok_or_else(|| anyhow::anyhow!("<plan-id> is required for RetryPlan"))?;
                    let cr = args.change_request.ok_or_else(|| {
                        anyhow::anyhow!("--change-request is required for RetryPlan")
                    })?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::RetryPlan(RetryPlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        change_request: cr,
                    })
                }
                "expandplan" => {
                    let pid = args
                        .plan_id
                        .ok_or_else(|| anyhow::anyhow!("<plan-id> is required for ExpandPlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::ExpandPlan(ExpandPlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                    })
                }
                "updateplan" => {
                    let pid = args
                        .plan_id
                        .ok_or_else(|| anyhow::anyhow!("<plan-id> is required for UpdatePlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    let inst = args.instructions.ok_or_else(|| {
                        anyhow::anyhow!("--instructions is required for UpdatePlan")
                    })?;
                    JobArgs::UpdatePlan(UpdatePlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        instructions: Some(inst),
                        upload_session_id: None,
                    })
                }
                "splitplan" => {
                    let pid = args
                        .plan_id
                        .ok_or_else(|| anyhow::anyhow!("<plan-id> is required for SplitPlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::SplitPlan(SplitPlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                    })
                }
                "createpr" => {
                    let pid = args
                        .plan_id
                        .ok_or_else(|| anyhow::anyhow!("<plan-id> is required for CreatePr"))?;
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
                        reviewers: if reviewers.is_empty() {
                            None
                        } else {
                            Some(reviewers)
                        },
                        comment: args.comment,
                        draft: args.draft,
                    })
                }
                "createissue" => {
                    let pid = args
                        .plan_id
                        .ok_or_else(|| anyhow::anyhow!("<plan-id> is required for CreateIssue"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    let repo = args
                        .repo
                        .ok_or_else(|| anyhow::anyhow!("--repo is required for CreateIssue"))?;
                    JobArgs::CreateIssue(tendril_core::models::CreateIssueArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        repo,
                        assignee: args.assignee,
                        comment: args.comment,
                        labels: args.labels,
                    })
                }
                "setupproject" => {
                    let name = args.plan_id.ok_or_else(|| {
                        anyhow::anyhow!("<project-name> is required for SetupProject")
                    })?;
                    JobArgs::SetupProject(tendril_core::models::SetupProjectArgs {
                        folder_path: name,
                    })
                }
                "addproject" => {
                    let name = args.plan_id.ok_or_else(|| {
                        anyhow::anyhow!("<project-name> is required for AddProject")
                    })?;
                    JobArgs::AddProject(tendril_core::models::AddProjectArgs {
                        project_name: name,
                        repos: Vec::new(),
                    })
                }
                "syncrepo" => {
                    let rp = args
                        .repo_path
                        .ok_or_else(|| anyhow::anyhow!("--repo-path is required for SyncRepo"))?;
                    let bb = args.base_branch.unwrap_or_else(|| "main".to_string());
                    JobArgs::SyncRepo(tendril_core::models::SyncRepoArgs {
                        repo_path: rp,
                        base_branch: bb,
                        plan_folder_path: None,
                        untracked_changes_policy: args
                            .untracked_policy
                            .unwrap_or_else(|| "Stash".to_string()),
                    })
                }
                _ => anyhow::bail!("Unsupported job type: {}", args.job_type),
            };

            // `JobArgs` is internally tagged, so it serializes as a flat object the server reads
            // back through `#[serde(flatten)]`. The start options ride alongside those keys.
            let mut body = serde_json::to_value(&job_args)?;
            let map = body
                .as_object_mut()
                .ok_or_else(|| anyhow::anyhow!("Job args did not serialize to an object"))?;
            if !args.wait_for.is_empty() {
                map.insert("waitForJobs".to_string(), serde_json::json!(args.wait_for));
            }
            if let Some(priority) = args.priority {
                map.insert("priority".to_string(), serde_json::json!(priority));
            }

            let client = reqwest::Client::new();
            let url = format!("http://{}:{}/api/jobs", master.host, master.port);
            let resp = client
                .post(&url)
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}:{}",
                    master.host,
                    master.port
                );
            }
            // A conflict names the job already working on this plan, which is more useful than
            // reqwest's generic status message.
            if resp.status() == reqwest::StatusCode::CONFLICT {
                let res: serde_json::Value = resp.json().await.unwrap_or_default();
                anyhow::bail!(
                    "{}",
                    res["error"]
                        .as_str()
                        .unwrap_or("Another job is already in progress for this plan")
                );
            }
            let resp = resp.error_for_status()?;
            let res: serde_json::Value = resp.json().await?;

            println!("Job started: ID {}", res["jobId"].as_str().unwrap_or(""));
        }
        JobCommands::Status(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = reqwest::Client::new();
            let url = format!(
                "http://{}:{}/api/jobs/{}/status",
                master.host, master.port, args.job_id
            );
            let body = serde_json::json!({
                "message": args.message,
                "planId": args.plan_id,
                "planTitle": args.plan_title,
            });
            let resp = client
                .put(&url)
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}:{}",
                    master.host,
                    master.port
                );
            }
            resp.error_for_status()?;
            println!("Status updated for job {}", args.job_id);
        }
        JobCommands::Fail(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = reqwest::Client::new();
            let url = format!(
                "http://{}:{}/api/jobs/{}/fail",
                master.host, master.port, args.job_id
            );
            let body = serde_json::json!({ "message": args.message });
            let resp = client
                .put(&url)
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}:{}",
                    master.host,
                    master.port
                );
            }
            resp.error_for_status()?;
            println!("Failure reported for job {}", args.job_id);
        }
        JobCommands::Cancel(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = reqwest::Client::new();
            let url = format!(
                "http://{}:{}/api/jobs/{}/cancel",
                master.host, master.port, args.job_id
            );
            let body = serde_json::json!({ "message": args.message });
            let resp = client
                .post(&url)
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}:{}",
                    master.host,
                    master.port
                );
            }
            resp.error_for_status()?;
            println!("Job {} cancelled.", args.job_id);
        }
        JobCommands::Delete(args) => {
            let master = get_master_or_err(tendril_home)?;
            let url = format!(
                "http://{}:{}/api/jobs/{}",
                master.host, master.port, args.job_id
            );
            let resp = send(reqwest::Client::new().delete(&url), &master).await?;
            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Job {} not found", args.job_id);
            }
            resp.error_for_status()?;
            println!("Job {} deleted.", args.job_id);
        }
        JobCommands::ForceStart(args) => {
            let master = get_master_or_err(tendril_home)?;
            let url = format!(
                "http://{}:{}/api/jobs/{}/force-start",
                master.host, master.port, args.job_id
            );
            let resp = send(reqwest::Client::new().post(&url), &master).await?;
            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Job {} not found", args.job_id);
            }
            if resp.status() == reqwest::StatusCode::CONFLICT {
                let res: serde_json::Value = resp.json().await.unwrap_or_default();
                anyhow::bail!(
                    "{}",
                    res["error"]
                        .as_str()
                        .unwrap_or("Job cannot be force-started")
                );
            }
            resp.error_for_status()?;
            println!("Job {} force-started.", args.job_id);
        }
        JobCommands::StopAll => {
            let master = get_master_or_err(tendril_home)?;
            let url = format!("http://{}:{}/api/jobs/stop-all", master.host, master.port);
            let resp = send(reqwest::Client::new().post(&url), &master).await?;
            let res: serde_json::Value = resp.error_for_status()?.json().await?;
            let stopped: Vec<&str> = res["stopped"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                .unwrap_or_default();
            if stopped.is_empty() {
                println!("No jobs to stop.");
            } else {
                println!("Stopped {} job(s): {}", stopped.len(), stopped.join(", "));
            }
        }
        JobCommands::Clear(args) => {
            if args.failed as u8 + args.all as u8 + args.completed as u8 > 1 {
                anyhow::bail!("Pass only one of --completed, --failed or --all");
            }
            let scope = if args.all {
                "all"
            } else if args.failed {
                "failed"
            } else {
                "completed"
            };

            // `--all` can wipe a long history in one keystroke, so it is the one scope that asks.
            if scope == "all" && !args.yes && !confirm("Clear all jobs?")? {
                println!("Cancelled.");
                return Ok(());
            }

            let master = get_master_or_err(tendril_home)?;
            let url = format!("http://{}:{}/api/jobs/clear", master.host, master.port);
            let resp = send(
                reqwest::Client::new()
                    .post(&url)
                    .json(&serde_json::json!({ "status": scope })),
                &master,
            )
            .await?;
            let res: serde_json::Value = resp.error_for_status()?.json().await?;
            println!(
                "Cleared {} {} job(s).",
                res["cleared"].as_u64().unwrap_or(0),
                scope
            );
        }
        JobCommands::Queue(args) => {
            let master = get_master_or_err(tendril_home)?;
            let url = format!("http://{}:{}/api/jobs/queue", master.host, master.port);
            let resp = send(reqwest::Client::new().get(&url), &master).await?;
            let res: serde_json::Value = resp.error_for_status()?.json().await?;

            if args.json {
                println!("{}", serde_json::to_string_pretty(&res)?);
                return Ok(());
            }

            let queued = res["queued"].as_array().cloned().unwrap_or_default();
            println!(
                "{} job(s) queued, {} concurrent slot(s).",
                queued.len(),
                res["maxConcurrent"].as_u64().unwrap_or(0)
            );
            if !queued.is_empty() {
                println!("{:<8} PRIORITY", "ID");
                println!("{}", "-".repeat(20));
                for entry in queued {
                    println!(
                        "{:<8} {}",
                        entry["id"].as_str().unwrap_or(""),
                        entry["priority"].as_i64().unwrap_or(0)
                    );
                }
            }
        }
        JobCommands::Maintenance => {
            let master = get_master_or_err(tendril_home)?;
            let url = format!(
                "http://{}:{}/api/jobs/maintenance",
                master.host, master.port
            );
            let resp = send(reqwest::Client::new().post(&url), &master).await?;
            let res: serde_json::Value = resp.error_for_status()?.json().await?;
            println!("{}", serde_json::to_string_pretty(&res)?);
        }
    }

    Ok(())
}

/// Sends an authenticated request and turns the daemon's 401 into an explicit message, since
/// `error_for_status` alone reports it as an opaque status code.
async fn send(
    request: reqwest::RequestBuilder,
    master: &MasterInfo,
) -> anyhow::Result<reqwest::Response> {
    let resp = request.bearer_auth(&master.secret).send().await?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        anyhow::bail!(
            "Authentication failed: unauthorized request to Tendril daemon at {}:{}",
            master.host,
            master.port
        );
    }
    Ok(resp)
}

/// Asks for a y/N confirmation. Without a terminal there is nobody to ask, so the answer is no and
/// the caller is told to pass `--yes`.
fn confirm(prompt: &str) -> anyhow::Result<bool> {
    if !std::io::stdin().is_terminal() {
        anyhow::bail!(
            "{} Refusing without a terminal; pass --yes to confirm.",
            prompt
        );
    }
    print!("{} [y/N] ", prompt);
    std::io::stdout().flush()?;
    let mut answer = String::new();
    std::io::stdin().read_line(&mut answer)?;
    Ok(matches!(
        answer.trim().to_ascii_lowercase().as_str(),
        "y" | "yes"
    ))
}

fn get_master_or_err(tendril_home: &Path) -> anyhow::Result<MasterInfo> {
    read_master(tendril_home).ok_or_else(|| {
        anyhow::anyhow!("Tendril server is not running. Start it with 'tendril serve' first.")
    })
}
