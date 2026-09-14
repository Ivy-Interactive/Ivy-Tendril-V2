use clap::{Args, Subcommand};
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

            let client = reqwest::Client::new();
            let url = format!("http://{}:{}/api/jobs", master.host, master.port);
            let resp = client
                .post(&url)
                .bearer_auth(&master.secret)
                .json(&job_args)
                .send()
                .await?;
            if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                anyhow::bail!(
                    "Authentication failed: unauthorized request to Tendril daemon at {}:{}",
                    master.host,
                    master.port
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
    }

    Ok(())
}

fn get_master_or_err(tendril_home: &Path) -> anyhow::Result<MasterInfo> {
    read_master(tendril_home).ok_or_else(|| {
        anyhow::anyhow!("Tendril server is not running. Start it with 'tendril serve' first.")
    })
}
