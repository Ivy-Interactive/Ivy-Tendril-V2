use clap::{Args, Subcommand};
use std::io::{IsTerminal, Write};
use std::path::Path;
use tendril_core::config::{get_plans_dir, read_master, MasterInfo};
use tendril_core::jobs::logger::append_agent_log;
use tendril_core::mcp::dispatch::{build_job_args, JobStartRequest};

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

    #[arg(
        long,
        help = "Submit again even if identical work is already in flight (also skips CreatePlan's \
                own plan-level duplicate check)"
    )]
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
            let client = super::daemon_client(&master)?;
            let mut url = format!("{}/api/jobs?limit={}", master.base_url(), args.limit);
            if let Some(st) = args.status {
                url.push_str(&format!("&status={}", st));
            }

            let resp = client.get(&url).bearer_auth(&master.secret).send().await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}",
                    master.base_url()
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

            // Shared with the MCP `tendril_start_job` tool, so the per-type required-argument
            // rules cannot diverge between the two front ends.
            let request = JobStartRequest {
                job_type: args.job_type.clone(),
                plan_id: args.plan_id,
                description: args.description,
                project: args.project,
                note: args.note,
                instructions: args.instructions,
                change_request: args.change_request,
                source_path: args.source_path,
                repo: args.repo,
                assignee: args.assignee,
                reviewers: args.reviewer,
                comment: args.comment,
                labels: args.labels,
                repo_path: args.repo_path,
                base_branch: args.base_branch,
                untracked_policy: args.untracked_policy,
                priority: args.priority,
                force: args.force,
                no_merge: args.no_merge,
                no_delete_branch: args.no_delete_branch,
                no_artifacts: args.no_artifacts,
                draft: args.draft,
            };
            let job_args = build_job_args(&request, &plans_dir).map_err(anyhow::Error::msg)?;

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

            let client = super::daemon_client(&master)?;
            let mut url = format!("{}/api/jobs", master.base_url());
            // `CreatePlanArgs` carries `force` in the body; every other job type needs the query
            // parameter, so `--force` works for ExecutePlan and friends too.
            if args.force {
                url.push_str("?force=true");
            }
            let resp = client
                .post(&url)
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}",
                    master.base_url()
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
            let client = super::daemon_client(&master)?;
            let url = format!("{}/api/jobs/{}/status", master.base_url(), args.job_id);
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
                    "Authentication failed: unauthorized request to Tendril daemon at {}",
                    master.base_url()
                );
            }
            resp.error_for_status()?;
            println!("Status updated for job {}", args.job_id);
        }
        JobCommands::Fail(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = super::daemon_client(&master)?;
            let url = format!("{}/api/jobs/{}/fail", master.base_url(), args.job_id);
            let body = serde_json::json!({ "message": args.message });
            let resp = client
                .put(&url)
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}",
                    master.base_url()
                );
            }
            resp.error_for_status()?;
            println!("Failure reported for job {}", args.job_id);
        }
        JobCommands::Cancel(args) => {
            let master = get_master_or_err(tendril_home)?;
            let client = super::daemon_client(&master)?;
            let url = format!("{}/api/jobs/{}/cancel", master.base_url(), args.job_id);
            let body = serde_json::json!({ "message": args.message });
            let resp = client
                .post(&url)
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}",
                    master.base_url()
                );
            }
            resp.error_for_status()?;
            println!("Job {} cancelled.", args.job_id);
        }
        JobCommands::Delete(args) => {
            let master = get_master_or_err(tendril_home)?;
            let url = format!("{}/api/jobs/{}", master.base_url(), args.job_id);
            let resp = send(super::daemon_client(&master)?.delete(&url), &master).await?;
            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Job {} not found", args.job_id);
            }
            resp.error_for_status()?;
            println!("Job {} deleted.", args.job_id);
        }
        JobCommands::ForceStart(args) => {
            let master = get_master_or_err(tendril_home)?;
            let url = format!("{}/api/jobs/{}/force-start", master.base_url(), args.job_id);
            let resp = send(super::daemon_client(&master)?.post(&url), &master).await?;
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
            let url = format!("{}/api/jobs/stop-all", master.base_url());
            let resp = send(super::daemon_client(&master)?.post(&url), &master).await?;
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
            let url = format!("{}/api/jobs/clear", master.base_url());
            let resp = send(
                super::daemon_client(&master)?
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
            let url = format!("{}/api/jobs/queue", master.base_url());
            let resp = send(super::daemon_client(&master)?.get(&url), &master).await?;
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
            let url = format!("{}/api/jobs/maintenance", master.base_url());
            let resp = send(super::daemon_client(&master)?.post(&url), &master).await?;
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
            "Authentication failed: unauthorized request to Tendril daemon at {}",
            master.base_url()
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
