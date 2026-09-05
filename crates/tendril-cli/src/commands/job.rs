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
}

#[derive(Args)]
pub struct JobStartArgs {
    #[arg(help = "Job type: ExecutePlan, CreatePlan, RetryPlan, UpdatePlan, ExpandPlan, SplitPlan, CreatePr, CreateIssue, SetupProject")]
    pub job_type: String,

    #[arg(help = "Plan ID or folder (required for most job types)")]
    pub plan_id: Option<String>,

    #[arg(long, help = "Task description (for CreatePlan)")]
    pub description: Option<String>,

    #[arg(long, help = "Target project (for CreatePlan)")]
    pub project: Option<String>,

    #[arg(long, help = "Reviewer feedback / change request (for RetryPlan)")]
    pub change_request: Option<String>,

    #[arg(long, help = "Execution note (for ExecutePlan)")]
    pub note: Option<String>,

    #[arg(long, help = "Refinement instructions (for UpdatePlan)")]
    pub instructions: Option<String>,
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
                    let proj = args.project.unwrap_or_else(|| "Auto".to_string());
                    JobArgs::CreatePlan(CreatePlanArgs {
                        description: desc,
                        project: proj,
                        priority: 0,
                        force: false,
                        source_path: None,
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
                    JobArgs::UpdatePlan(UpdatePlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
                        instructions: args.instructions,
                    })
                }
                "splitplan" => {
                    let pid = args.plan_id.ok_or_else(|| anyhow::anyhow!("<plan-id> is required for SplitPlan"))?;
                    let folder = resolve_plan_folder(&pid, &plans_dir)?;
                    JobArgs::SplitPlan(SplitPlanArgs {
                        folder_path: folder.to_string_lossy().to_string(),
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
