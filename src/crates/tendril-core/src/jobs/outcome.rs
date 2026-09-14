//! Writes a durable per-job record of what a run actually produced.
//!
//! The job row in SQLite says `Completed` or `Failed`; it does not say which commits landed or which
//! verification was left `Pending`. That evidence is what a human needs when a plan comes back for
//! review, and it has to survive the plan folder being cleaned up.
//!
//! Everything here appends to the existing `Logs/Jobs/<id>.md` file that `tendril job add-log` writes
//! into, and every failure to write is logged and swallowed: an outcome log must never change a job's
//! status.

use crate::jobs::logger::{ensure_log_dirs, get_job_log_path};
use crate::models::JobItem;
use crate::plans::reader::read_plan_yaml;
use chrono::Utc;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Appends a `## Job Outcome [<rfc3339>]` block to the job's log.
pub fn write_job_outcome_log(tendril_home: &Path, job: &JobItem) {
    if let Err(e) = append_outcome(tendril_home, job) {
        tracing::warn!("Failed to write outcome log for job {}: {}", job.id, e);
    }
}

fn append_outcome(tendril_home: &Path, job: &JobItem) -> std::io::Result<()> {
    ensure_log_dirs(tendril_home).map_err(|e| std::io::Error::other(e.to_string()))?;
    let path: PathBuf = get_job_log_path(tendril_home, &job.id);

    let mut block = format!(
        "\n\n## Job Outcome [{}]\n**Status:** {}\n",
        Utc::now().to_rfc3339(),
        job.status
    );

    if let Some(msg) = &job.status_message {
        block.push_str(&format!("**Message:** {}\n", msg));
    }
    if let Some(reason) = &job.reported_failure_reason {
        block.push_str(&format!("**Failure Reason:** {}\n", reason));
    }
    if let Some(duration) = job.duration_seconds {
        block.push_str(&format!("**Duration:** {}s\n", duration));
    }
    if let Some(tokens) = job.tokens {
        block.push_str(&format!("**Tokens:** {}\n", tokens));
    }
    if let Some(cost) = job.cost {
        block.push_str(&format!("**Cost:** ${:.4}\n", cost));
    }
    if let Some(denials) = &job.permission_denials {
        if !denials.is_empty() {
            block.push_str("**Permission Denials:**\n");
            for denial in denials {
                block.push_str(&format!("- {}\n", denial));
            }
        }
    }

    let plan_summary = build_plan_outcome_summary(job);
    if !plan_summary.is_empty() {
        block.push('\n');
        block.push_str(&plan_summary);
    }

    // Append, never truncate: `tendril job add-log` writes `## Agent Log` sections into this file.
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?;
    file.write_all(block.as_bytes())
}

/// What the plan looks like now the job is done: its commits, its verification rows and its state.
///
/// Empty for job types that do not own a plan's outcome — there is nothing to summarise, and a
/// heading with nothing under it is worse than no heading.
pub fn build_plan_outcome_summary(job: &JobItem) -> String {
    if !matches!(job.job_type.as_str(), "ExecutePlan" | "RetryPlan") {
        return String::new();
    }
    let Ok((plan, _)) = read_plan_yaml(Path::new(&job.plan_file)) else {
        return String::new();
    };

    let mut out = String::from("## Outcome\n");
    out.push_str(&format!("**Commits:** {}\n", plan.commits.len()));
    if plan.commits.is_empty() {
        out.push_str("- none\n");
    } else {
        for commit in &plan.commits {
            out.push_str(&format!("- {}\n", commit));
        }
    }

    out.push_str("**Verifications:**\n");
    if plan.verifications.is_empty() {
        out.push_str("- none\n");
    } else {
        for v in &plan.verifications {
            out.push_str(&format!("- {}: {}\n", v.name, v.status));
        }
    }

    out.push_str(&format!("**Final State:** {}\n", plan.state));
    out
}
