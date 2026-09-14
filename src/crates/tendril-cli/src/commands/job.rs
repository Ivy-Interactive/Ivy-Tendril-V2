use chrono::{DateTime, Utc};
use clap::{Args, Subcommand};
use std::io::{IsTerminal, Write};
use std::path::Path;
use std::time::Duration;
use tendril_core::config::{get_plans_dir, read_master, MasterInfo};
use tendril_core::http::{
    classify_transport_error, daemon_client, daemon_client_with_timeout,
    daemon_request_timeout_for, DaemonTransportFailure,
};
use tendril_core::jobs::logger::append_agent_log;
use tendril_core::mcp::dispatch::{build_job_args, JobStartRequest};
use tendril_core::models::{JobArgs, JobItem, JobStatus};

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
    // One timed client for every daemon call this command makes. A bare `reqwest::Client` has no
    // request timeout at all, which is how a wedged daemon used to hang the CLI indefinitely.
    let client = daemon_client(tendril_home);

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
            let outcome = start_job_via_daemon(tendril_home, &master, &client, args).await?;
            match outcome {
                StartOutcome::Confirmed(_) | StartOutcome::Reconciled(_) => {
                    println!("{}", outcome.render())
                }
                // Exiting non-zero on an unconfirmed submission is the honest answer: the CLI does
                // not know it succeeded. The message says so explicitly, because a script that
                // blindly retries on non-zero can create the very duplicate this guards against.
                StartOutcome::Unconfirmed(_) => anyhow::bail!("{}", outcome.render()),
            }
        }
        JobCommands::Status(args) => {
            let master = get_master_or_err(tendril_home)?;
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
            let resp = send(client.delete(&url), &master).await?;
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
            let resp = send(client.post(&url), &master).await?;
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
            let resp = send(client.post(&url), &master).await?;
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
                client
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
            let resp = send(client.get(&url), &master).await?;
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
            let resp = send(client.post(&url), &master).await?;
            let res: serde_json::Value = resp.error_for_status()?.json().await?;
            println!("{}", serde_json::to_string_pretty(&res)?);
        }
    }

    Ok(())
}

/// What `tendril job start` learned about its submission.
///
/// The three arms exist because a lost response is genuinely ambiguous. `POST /api/jobs` flips plan
/// state, inserts into SQLite, inserts into the live job map and enqueues the job all *before* it
/// replies, so a request that timed out may well have created a job. Reporting that as a plain
/// failure is how operators end up retrying and creating duplicates.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartOutcome {
    /// The daemon replied with a job id.
    Confirmed(String),
    /// The reply was lost, but the job was found in the daemon's own job list.
    Reconciled(String),
    /// The reply was lost and reconciliation could not settle it. Carries the transport reason.
    Unconfirmed(String),
}

impl StartOutcome {
    /// The operator-facing line. Never claims failure for the ambiguous case, and never prints a
    /// job id it did not read back from the daemon.
    pub fn render(&self) -> String {
        match self {
            Self::Confirmed(id) => format!("Job started: ID {}", id),
            Self::Reconciled(id) => format!(
                "Job started: ID {} (confirmation was lost; found in the job list)",
                id
            ),
            Self::Unconfirmed(reason) => format!(
                "The job was submitted but the confirmation was lost ({}). It may or may not have \
                 been created. Check 'tendril job list' before retrying — retrying may create a \
                 duplicate job.",
                reason
            ),
        }
    }
}

/// The reconciliation query's own budget. The daemon that just failed to answer in time will not
/// answer a long query either, so this is capped well below the configured request timeout.
const RECONCILE_BUDGET: Duration = Duration::from_secs(5);

/// Clock skew allowed when deciding whether a job in the list is plausibly this submission.
const RECONCILE_CLOCK_SKEW: chrono::TimeDelta = chrono::TimeDelta::seconds(5);

/// Submits a job and reports what is actually known about the result.
pub async fn start_job_via_daemon(
    tendril_home: &Path,
    master: &MasterInfo,
    client: &reqwest::Client,
    args: JobStartArgs,
) -> anyhow::Result<StartOutcome> {
    let plans_dir = get_plans_dir(tendril_home);
    let wait_for = args.wait_for.clone();
    let priority = args.priority;

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
    if !wait_for.is_empty() {
        map.insert("waitForJobs".to_string(), serde_json::json!(wait_for));
    }
    if let Some(priority) = priority {
        map.insert("priority".to_string(), serde_json::json!(priority));
    }
    // Forward-compatible with the idempotency key Plan 00620 adds to `StartJobRequest`. Nothing
    // reads it yet — the flattened body ignores an unknown key — but sending it now means that
    // once it lands, a replay of this POST returns the original job id instead of creating a
    // second job, which is exact where the job-list scan below is only a heuristic.
    map.insert(
        "idempotencyKey".to_string(),
        serde_json::json!(uuid::Uuid::new_v4().to_string()),
    );

    let mut url = format!("http://{}:{}/api/jobs", master.host, master.port);
    // `CreatePlanArgs` carries `force` in the body; every other job type needs the query
    // parameter, so `--force` works for ExecutePlan and friends too.
    if args.force {
        url.push_str("?force=true");
    }
    let submitted_at = Utc::now();
    let resp = match client
        .post(&url)
        .bearer_auth(&master.secret)
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => {
            return resolve_lost_start(e, tendril_home, master, &job_args, submitted_at).await;
        }
    };

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

    // A timeout can strike after the status line arrives, so the body read is exactly as ambiguous
    // as the send itself and gets the same treatment.
    match resp.json::<serde_json::Value>().await {
        Ok(res) => Ok(StartOutcome::Confirmed(
            res["jobId"].as_str().unwrap_or("").to_string(),
        )),
        Err(e) => resolve_lost_start(e, tendril_home, master, &job_args, submitted_at).await,
    }
}

/// Decides what a transport failure during job start actually means.
///
/// Only an unreachable daemon proves the request was never received; everything else may have been
/// committed, so it is reconciled rather than reported as a failure.
async fn resolve_lost_start(
    err: reqwest::Error,
    tendril_home: &Path,
    master: &MasterInfo,
    job_args: &JobArgs,
    submitted_at: DateTime<Utc>,
) -> anyhow::Result<StartOutcome> {
    let configured = daemon_request_timeout_for(tendril_home);
    if classify_transport_error(&err) == DaemonTransportFailure::Unreachable {
        anyhow::bail!(
            "Could not reach the Tendril daemon at {}:{}: {}",
            master.host,
            master.port,
            err
        );
    }

    let reason = match classify_transport_error(&err) {
        DaemonTransportFailure::Timeout => match configured {
            Some(t) => format!("no reply within {}s", t.as_secs()),
            None => "no reply in time".to_string(),
        },
        _ => err.to_string(),
    };

    match reconcile_lost_job_start(tendril_home, master, job_args, submitted_at).await {
        Some(id) => Ok(StartOutcome::Reconciled(id)),
        None => Ok(StartOutcome::Unconfirmed(reason)),
    }
}

/// Answers "did this job actually get created?" after a lost response, by asking the daemon for its
/// job list and looking for the submission. Returns the job's id, or `None` when the question could
/// not be settled — which is not the same as "it was not created".
pub async fn reconcile_lost_job_start(
    tendril_home: &Path,
    master: &MasterInfo,
    job_args: &JobArgs,
    submitted_at: DateTime<Utc>,
) -> Option<String> {
    let budget = daemon_request_timeout_for(tendril_home)
        .map(|configured| configured.min(RECONCILE_BUDGET))
        .unwrap_or(RECONCILE_BUDGET);
    let client = daemon_client_with_timeout(Some(budget));
    let url = format!("http://{}:{}/api/jobs?limit=50", master.host, master.port);

    let resp = client
        .get(&url)
        .bearer_auth(&master.secret)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let jobs: Vec<JobItem> = resp.json().await.ok()?;

    jobs.into_iter()
        .find(|job| job_matches_submission(job, job_args, submitted_at))
        .map(|job| job.id)
}

/// Whether a job from the daemon's list is plausibly the submission that just lost its reply.
fn job_matches_submission(job: &JobItem, submitted: &JobArgs, submitted_at: DateTime<Utc>) -> bool {
    // The CLI accepts `executeplan` as well as `ExecutePlan`, and the daemon echoes its own
    // canonical spelling back, so the type comparison has to be case-insensitive.
    if !job.job_type.eq_ignore_ascii_case(submitted.job_type()) {
        return false;
    }

    let plan_matches = match submitted.plan_folder() {
        Some(folder) => job.plan_file.eq_ignore_ascii_case(folder),
        // A plan-less type such as `CreatePlan` has no folder yet, so the description is the only
        // handle on which submission this is.
        None => match (submission_description(submitted), job.typed_args.as_ref()) {
            (Some(wanted), Some(actual)) => submission_description(actual) == Some(wanted),
            _ => false,
        },
    };
    if !plan_matches {
        return false;
    }

    // A job still in flight is this submission or a duplicate of it either way. A terminal job
    // needs a timestamp recent enough to be ours — queued jobs have no `startedAt` at all, which
    // is why the status arm has to carry them.
    matches!(
        job.status,
        JobStatus::Pending | JobStatus::Queued | JobStatus::Running | JobStatus::Blocked
    ) || job
        .started_at
        .is_some_and(|started| started >= submitted_at - RECONCILE_CLOCK_SKEW)
}

/// The description a plan-less job carries, used to tell two `CreatePlan` submissions apart.
fn submission_description(args: &JobArgs) -> Option<&str> {
    match args {
        JobArgs::CreatePlan(a) => Some(&a.description),
        _ => None,
    }
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
