//! Finishing a job: deciding what its run meant, then writing that down once.
//!
//! [`classify_outcome`] turns an agent run into a status and a message; [`finish_job`] is the single
//! terminal write — deliverable verification, plan state, hooks, telemetry, dependents — and it runs
//! for exactly one of the runner, the supervisor and the canceller, whichever claimed the job. The
//! smaller readers here (`check_job_truncation`, `find_abandoned_background_tasks`) exist to feed
//! that decision.

use super::events::{persist, JobEvent};
use super::internals::{claim, describe_window, JobHandle};
use super::plan_state::{
    apply_plan_state, plan_state_on_success, revert_plan_state, sync_plan_state_to_db,
};
use super::usage::{extract_and_record_usage, track_job_completion};
use crate::agents::runner::{AgentRunOutcome, TerminationReason};
use crate::error::Result;
use crate::jobs::attachments::move_attachments_to_plan_folder;
use crate::jobs::deliverable::{
    cleanup_plan_folder_and_database, resolve_created_plan_folder, revision_count,
    verify_deliverable, Cleanup, Deliverable,
};
use crate::jobs::denials::{describe_denials, extract_permission_denials, summarize_denials};
use crate::jobs::failure_analysis::{agent_text, extract_failure_reason};
use crate::jobs::firmware_values::is_auto_project;
use crate::jobs::logger::{find_log_file, read_eventwire_log, read_raw_log};
use crate::jobs::outcome::write_job_outcome_log;
use crate::models::{JobItem, JobStatus, PlanStatus};
use crate::plans::helpers::resolve_plan_folder;
use crate::plans::reader::read_plan_yaml;
use crate::plans::writer::write_plan_yaml;
use chrono::Utc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/// Maps an agent run to the job's terminal status. `stale_output` carries the silence window when the
/// cancellation came from the stale-output watchdog rather than from a user.
pub(super) fn classify_outcome(
    run_res: Result<AgentRunOutcome>,
    timeout: Option<Duration>,
    stale_output: Option<Duration>,
) -> (JobStatus, String) {
    if let (Some(window), Ok(outcome)) = (stale_output, &run_res) {
        if outcome.terminated == TerminationReason::Cancelled {
            return (
                JobStatus::Timeout,
                format!(
                    "No agent output for {} (stale output timeout)",
                    describe_window(window)
                ),
            );
        }
    }

    match run_res {
        Ok(outcome) => match outcome.terminated {
            TerminationReason::Exited => match outcome.exit_code {
                Some(0) => (JobStatus::Completed, "Completed successfully".to_string()),
                Some(code) => (
                    JobStatus::Failed,
                    format!("Process exited with code {}", code),
                ),
                None => (
                    JobStatus::Failed,
                    "Process terminated without an exit code".to_string(),
                ),
            },
            TerminationReason::Cancelled => (JobStatus::Stopped, "Cancelled".to_string()),
            TerminationReason::TimedOut => (
                JobStatus::Timeout,
                format!(
                    "Job timed out after {} seconds",
                    timeout.map(|t| t.as_secs()).unwrap_or_default()
                ),
            ),
            TerminationReason::PostResultGraceExceeded => match outcome.exit_code {
                Some(0) => (
                    JobStatus::Completed,
                    "Completed with result event outcome after post-result grace period"
                        .to_string(),
                ),
                Some(code) => (
                    JobStatus::Failed,
                    format!(
                        "Process terminated after post-result grace period with exit code {}",
                        code
                    ),
                ),
                None => (
                    JobStatus::Completed,
                    "Completed with result event outcome after post-result grace period"
                        .to_string(),
                ),
            },
        },
        Err(e) => (JobStatus::Failed, format!("Execution failed: {}", e)),
    }
}

/// Background task ids a run started and then never accounted for.
///
/// Only the agent's *own* words can open an accusation. [`agent_text`] lifts assistant prose out of
/// either wire shape and refuses a tool result, and a line that is not JSON at all is prose too --
/// that is exactly what [`EventWireNormalizer::normalize`](crate::agents::eventwire::EventWireNormalizer::normalize)
/// makes of a provider's plain stdout. What a tool *returned* is not evidence of anything the agent
/// did: job 00007 was asked to work on this very guard, `sed`-ed this file into a tool result, and
/// the fixture string below matched -- so the run was failed for quoting the guard's own test data.
/// A check that cannot tell who said something cannot be trusted to accuse anyone of it.
///
/// Exoneration is deliberately not held to that standard: a "task x finished" clears x wherever it
/// appears. An accusation has to know who spoke; a retraction only has to be true.
pub fn find_abandoned_background_tasks(lines: &[String]) -> Vec<String> {
    let start_re = regex::Regex::new(
        r"(?i)(?:was moved to the background|running in background with ID:?|Tool is running as a background task with task id:?)\s*(?:\(?ID:?\s*)?(?<id>[a-zA-Z0-9_/-]+)\)?"
    ).unwrap();

    let manage_task_running_re = regex::Regex::new(
        r"(?i)Task:\s*(?<id>[a-zA-Z0-9_/-]+)(?:[\s\r\n]|\\r|\\n)+Status:\s*RUNNING",
    )
    .unwrap();

    let complete_re = regex::Regex::new(
        r"(?i)(?:task|background task)\s*(?:with\s+ID:?\s*|ID:?\s*)?(?<id>[a-zA-Z0-9_/-]+)\s*(?:has\s+)?(?:completed|finished|terminated|exited|killed|stopped|done)"
    ).unwrap();

    let complete_re2 = regex::Regex::new(
        r"(?i)(?:completed|finished|terminated|exited|killed|stopped|done)\s*(?:background\s+)?task\s*(?:with\s+ID:?\s*|ID:?\s*)?(?<id>[a-zA-Z0-9_/-]+)"
    ).unwrap();

    let complete_re3 = regex::Regex::new(
        r#"(?i)(?:"task_id"|"taskId")\s*:\s*"(?<id>[a-zA-Z0-9_/-]+)".*?"(?:completed|finished|stopped|terminated|done)""#
    ).unwrap();

    let complete_re4 = regex::Regex::new(
        r"(?i)Task:\s*(?<id>[a-zA-Z0-9_/-]+)(?:[\s\r\n]|\\r|\\n)+Status:\s*(?:DONE|COMPLETED|FINISHED)"
    ).unwrap();

    let complete_re5 =
        regex::Regex::new(r#"(?i)Task\s*id\s*"(?<id>[a-zA-Z0-9_/-]+)"\s*finished"#).unwrap();

    let terminating_re =
        regex::Regex::new(r"(?i)terminating\s+(?<count>\d+)\s+background\s+task\(s\)\s+on\s+exit")
            .unwrap();

    let mut started = std::collections::HashSet::new();
    let mut completed = std::collections::HashSet::new();
    let mut terminated_count: usize = 0;

    for line in lines {
        // An agent's own turn is one text block, not one line, so every match in it counts.
        if let Some(text) = authored_text(line) {
            for caps in start_re.captures_iter(&text) {
                if let Some(id) = caps.name("id") {
                    started.insert(id.as_str().to_string());
                }
            }
        }
        if line.contains("manage_task") {
            if let Some(caps) = manage_task_running_re.captures(line) {
                if let Some(id) = caps.name("id") {
                    started.insert(id.as_str().to_string());
                }
            }
        }
        if let Some(caps) = complete_re.captures(line) {
            if let Some(id) = caps.name("id") {
                completed.insert(id.as_str().to_string());
            }
        }
        if let Some(caps) = complete_re2.captures(line) {
            if let Some(id) = caps.name("id") {
                completed.insert(id.as_str().to_string());
            }
        }
        if let Some(caps) = complete_re3.captures(line) {
            if let Some(id) = caps.name("id") {
                completed.insert(id.as_str().to_string());
            }
        }
        if let Some(caps) = complete_re4.captures(line) {
            if let Some(id) = caps.name("id") {
                completed.insert(id.as_str().to_string());
            }
        }
        if let Some(caps) = complete_re5.captures(line) {
            if let Some(id) = caps.name("id") {
                completed.insert(id.as_str().to_string());
            }
        }
        if let Some(caps) = terminating_re.captures(line) {
            if let Some(c) = caps
                .name("count")
                .and_then(|m| m.as_str().parse::<usize>().ok())
            {
                terminated_count = terminated_count.max(c);
            }
        }
    }

    let mut abandoned: Vec<String> = started
        .into_iter()
        .filter(|id| !completed.contains(id))
        .collect();
    abandoned.sort();

    if abandoned.is_empty() && terminated_count > 0 {
        abandoned.push(if terminated_count == 1 {
            "1 background task terminated on exit".to_string()
        } else {
            format!("{} background tasks terminated on exit", terminated_count)
        });
    }

    abandoned
}

/// The words on this line that the *agent* wrote, or `None` when nobody can be shown to have.
///
/// Two streams are merged into the scan. The eventwire log is attributed, so [`agent_text`] answers
/// it exactly. The raw log is the provider's own, and a line of it that is not a JSON object carries
/// no authorship at all -- but the normalizer already rules on that case, turning bare stdout into a
/// `text` event, and this agrees with it rather than inventing a second answer. A *structured* line
/// that is not assistant prose -- a tool result, a step update, session metadata -- is never the
/// agent talking, so it yields nothing here even though its payload is full of text.
fn authored_text(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.starts_with('{') {
        return Some(trimmed.to_string());
    }
    agent_text(line)
}

fn check_job_truncation(tendril_home: &Path, job: &JobItem) -> bool {
    // 1. Check event log files for truncation reasons
    for suffix in [".eventwire.jsonl", ".raw.jsonl"] {
        if let Some(log_path) = find_log_file(tendril_home, &job.id, suffix) {
            if let Ok(file) = std::fs::File::open(&log_path) {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(file);
                for line in reader.lines().map_while(|l| l.ok()) {
                    if crate::agents::truncation::is_event_line_truncated(&line) {
                        return true;
                    }
                }
            }
        }
    }

    // 2. Check output artifacts in the plan folder if available
    if !job.plan_file.is_empty() {
        let plan_folder = Path::new(&job.plan_file);
        if plan_folder.is_dir() {
            for sub in ["Revisions", "revisions"] {
                let rev_dir = plan_folder.join(sub);
                if rev_dir.is_dir() {
                    if let Ok(entries) = std::fs::read_dir(&rev_dir) {
                        let mut md_files: Vec<PathBuf> = entries
                            .filter_map(|e| e.ok())
                            .map(|e| e.path())
                            .filter(|p| p.extension().and_then(|ext| ext.to_str()) == Some("md"))
                            .collect();
                        md_files.sort();
                        if let Some(latest) = md_files.last() {
                            if let Ok(content) = std::fs::read_to_string(latest) {
                                if crate::agents::truncation::check_markdown_truncation(&content)
                                    .is_some()
                                {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    false
}

/// Writes a job's terminal state and moves its plan, claiming completion first so a simultaneous
/// cancellation cannot be overwritten.
///
/// A job that exited zero is only recorded `Completed` once [`verify_deliverable`] confirms it
/// produced something: no commits, an unsettled verification row or a missing plan revision all land
/// on `Failed` instead, with the worktree left in place for a human to look at.
///
/// `plans_dir` is a parameter rather than an ambient lookup on purpose — this function deletes orphan
/// plan folders, and `TENDRIL_PLANS` in the environment would otherwise aim that at the operator's
/// real plans directory during a test run.
///
/// Returns the job as it was persisted, carrying the *effective* status — which is not always the
/// `final_status` that was asked for. `None` means the completion claim had already been taken, so
/// this call wrote nothing at all.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub async fn finish_job(
    tendril_home: &Path,
    plans_dir: &Path,
    jobs_map: &Arc<RwLock<HashMap<String, JobItem>>>,
    handles: &Arc<RwLock<HashMap<String, JobHandle>>>,
    completion_claimed: &AtomicBool,
    mut job: JobItem,
    final_status: JobStatus,
    msg: String,
    duration_seconds: Option<i64>,
    events: Option<&broadcast::Sender<JobEvent>>,
) -> Option<JobItem> {
    if !claim(completion_claimed) {
        // Cancellation got there first and has already written the terminal state.
        return None;
    }

    // Read the output once. Denials, the abandoned-task guard, deliverable verification and failure
    // analysis all read the same stream, and it can be tens of megabytes.
    let mut output_lines = Vec::new();
    if let Ok(Some(raw_lines)) = read_raw_log(tendril_home, &job.id, None) {
        output_lines.extend(raw_lines);
    }
    if let Ok(Some(ev_lines)) = read_eventwire_log(tendril_home, &job.id, None) {
        output_lines.extend(ev_lines);
    }

    // Denials explain a job that failed or did nothing; they never fail one by themselves.
    let denials = extract_permission_denials(&output_lines);
    if !denials.is_empty() {
        job.permission_denials = Some(describe_denials(&denials));
    }

    let (mut effective_status, mut effective_msg) = if final_status == JobStatus::Completed {
        if let Some(reason) = &job.reported_failure_reason {
            (JobStatus::Failed, reason.clone())
        } else if check_job_truncation(tendril_home, &job) {
            (
                JobStatus::Failed,
                "Agent output truncated at maximum token limit or ended prematurely".to_string(),
            )
        } else {
            (final_status, msg)
        }
    } else {
        let failure_msg = match &job.reported_failure_reason {
            Some(reason) if final_status == JobStatus::Failed => reason.clone(),
            _ => enrich_failure_message(&output_lines, &job, final_status, msg),
        };
        (final_status, failure_msg)
    };

    // The deliverable check: the job says it succeeded, so ask what it produced.
    //
    // This runs *before* the abandoned-background-task guard below, and the order is the rule. Both
    // are reasons to distrust an exit code of zero, but only one of them is an observation: the
    // deliverable check reads the plan folder on disk, while the guard infers intent from prose. When
    // the two disagree, what the job actually produced wins.
    let mut deliverable = Deliverable::Present;
    if effective_status == JobStatus::Completed {
        deliverable = verify_deliverable(plans_dir, &mut job, &output_lines);

        if let Deliverable::Missing { reason, cleanup } = &deliverable {
            tracing::warn!(
                "Job {} ({}) exited successfully but produced no deliverable: {}",
                job.id,
                job.job_type,
                reason
            );
            effective_status = JobStatus::Failed;
            effective_msg = reason.clone();
            if job.reported_failure_reason.is_none() {
                job.reported_failure_reason = Some(reason.clone());
            }
            if let Cleanup::OrphanPlan(folder) = cleanup {
                cleanup_plan_folder_and_database(tendril_home, plans_dir, folder);
            }
        }
    } else if job.job_type == "CreatePlan" {
        // A CreatePlan that failed, timed out or was killed must not leave an empty folder behind
        // either — it would look like a real plan nobody ever wrote.
        cleanup_empty_create_plan(tendril_home, plans_dir, &mut job, &output_lines);
    }

    // The abandoned-background-task guard, deliberately last of the three that can distrust an exit
    // code of zero -- and only for a run that claimed success, the way it has always been.
    //
    // The precedence, once the scan is scoped to what the agent itself said:
    //
    //   * produced its deliverable -> it stays `Completed`, with the dangling ids noted on the
    //     message. A run that did the work it was asked for has not failed; leaving a task running is
    //     a loose end an operator should see, not grounds to throw the work away. Job 00007 produced
    //     plan 00004 and was marked `Failed` precisely because this ran first and answered alone.
    //   * produced nothing -> already `Failed`, and the abandoned task is the better account of why
    //     than "no plan revision was written": it names what the run was still waiting on.
    //   * failed for some other reason (truncated output, a reason the promptware reported) -> that
    //     reason is closer to the cause, so it stands and the ids are appended as context.
    //
    // So the guard can no longer *cause* a failure on its own. That is the point: it never observed a
    // running process, only prose about one, and the deliverable check observes the disk.
    if final_status == JobStatus::Completed {
        let abandoned = find_abandoned_background_tasks(&output_lines);
        if !abandoned.is_empty() {
            let note = format!(
                "Background task(s) still running when the turn ended ({}).",
                abandoned.join(", ")
            );
            tracing::warn!(
                "Job {} ({}) ended with background task(s) unaccounted for: {}",
                job.id,
                job.job_type,
                abandoned.join(", ")
            );
            if matches!(deliverable, Deliverable::Missing { .. }) {
                effective_msg = note.clone();
                job.reported_failure_reason = Some(note);
            } else {
                effective_msg = format!("{} — {}", effective_msg, note);
            }
        }
    }

    let deliverable_present = matches!(deliverable, Deliverable::Present);

    if !denials.is_empty() {
        // Appended to the existing status message so the Jobs UI shows it with no frontend change.
        effective_msg = format!("{} — {}", effective_msg, summarize_denials(&denials));
    }

    // `verify_deliverable` has just written the plan a `CreatePlan` produced onto `job.plan_file`, so
    // this is the last moment the project can be learned and the only one that catches a job whose
    // promptware never reported a plan id. Guarded, so a job that already knows its project keeps it.
    if is_auto_project(&job.project) && !job.plan_file.trim().is_empty() {
        if let Ok((plan, _)) = read_plan_yaml(Path::new(&job.plan_file)) {
            if !is_auto_project(&plan.project) {
                job.project = plan.project;
            }
        }
    }

    job.status = effective_status;
    job.completed_at = Some(Utc::now());
    job.duration_seconds = duration_seconds;
    job.status_message = Some(effective_msg);

    if effective_status == JobStatus::Completed {
        let plan_folder = PathBuf::from(&job.plan_file);
        if plan_folder.is_dir() {
            if let Ok((plan, _)) = read_plan_yaml(&plan_folder) {
                if let Some(state) = plan_state_on_success(&job.job_type, &plan, &plan_folder) {
                    apply_plan_state(&plan_folder, state);
                }

                if job.job_type == "CreatePr" {
                    let folder_name = plan_folder
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default();
                    let plan_id: i32 = folder_name
                        .split('-')
                        .next()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0);
                    let pr_url = plan.prs.last().map(|s| s.as_str()).unwrap_or("");
                    let msg = format!(
                        "[System Event] Pull request for plan '{}' (#{id:05}) has been created: {pr_url}. Please review the pull request and next steps.",
                        plan.title,
                        id = plan_id
                    );
                    let _ = crate::chat::storage::broadcast_system_message_to_plan_sessions(
                        tendril_home,
                        folder_name,
                        plan.chat_session_id.as_deref(),
                        None,
                        &msg,
                    );
                }
            }
        }

        // Uploads live in a session temp directory until the plan they belong to exists.
        if matches!(job.job_type.as_str(), "CreatePlan" | "UpdatePlan") {
            move_attachments_to_plan_folder(tendril_home, plans_dir, &job);
        }

        // A `CreatePlan` had no plan to inherit a conversation from when it started, so the link is
        // made in this direction instead: the plan it just produced takes on the chat that asked for
        // it. That is what later plan events — a pull request, an edit — resolve their recipients by,
        // so without this only *this* job's completion would ever reach the conversation.
        if let Some(chat_session_id) = job.chat_session_id.as_deref() {
            adopt_plan_into_chat_session(plans_dir, &job, chat_session_id);
        }
    } else if matches!(deliverable, Deliverable::Missing { .. })
        && matches!(job.job_type.as_str(), "ExecutePlan" | "RetryPlan")
    {
        // An execution that produced nothing goes to `Failed`, not back to `Draft`: the worktree is
        // still on disk, and reverting would erase the only sign that an attempt happened.
        apply_plan_state(Path::new(&job.plan_file), PlanStatus::Failed);
    } else {
        revert_plan_state(&job);
    }

    // Whatever the branches above decided, the plan's state on disk is now its final one for this
    // job. Mirroring it here rather than inside `apply_plan_state` is deliberate: a job holds a
    // plan's state for its whole run, so the two moments the mirror can be wrong are the transition
    // into the run (`JobManager::set_plan_state`) and this one out of it — and one sync per job beats
    // one per write from a function that is also called by the CLI, where there is nothing to serve.
    sync_plan_state_to_db(tendril_home, Path::new(&job.plan_file));

    extract_and_record_usage(tendril_home, &mut job);

    track_job_completion(tendril_home, &job, deliverable_present);

    // Emits `job.status_changed` plus `job.completed`/`job.failed`, so a client hears the outcome
    // rather than waiting for its next poll.
    persist(tendril_home, jobs_map, &job, events).await;
    handles.write().await.remove(&job.id);

    // Written last, so the record carries the final status, usage and plan outcome. Never fails a job.
    write_job_outcome_log(tendril_home, &job);

    Some(job)
}

/// Replaces a bare `Process exited with code 1` with what the output actually says went wrong.
///
/// Only for `Failed`: a timeout and a cancellation already carry the whole story. Leaves the original
/// message in place as context, and says nothing when the analysis has nothing to add.
fn enrich_failure_message(
    output_lines: &[String],
    job: &JobItem,
    final_status: JobStatus,
    msg: String,
) -> String {
    if final_status != JobStatus::Failed || output_lines.is_empty() {
        return msg;
    }

    let reason = extract_failure_reason(output_lines, &job.job_type, None);
    if reason.is_empty() || reason == "Unknown error (exit code non-zero)" || msg.contains(&reason)
    {
        return msg;
    }
    format!("{} — {}", msg, reason)
}

/// Removes the folder a CreatePlan run left behind with no revision in it.
///
/// The counterpart to [`JobManager::attribute_created_plan`](super::JobManager::attribute_created_plan),
/// for the half of the stop paths that
/// arrives here instead of there, and it resolves the same folder through the same resolver -- so it
/// records the link on the same terms. Without that, whether a stopped `CreatePlan` ended up linked
/// to the plan it made came down to which of the two paths happened to reach it first.
fn cleanup_empty_create_plan(
    tendril_home: &Path,
    plans_dir: &Path,
    job: &mut JobItem,
    output_lines: &[String],
) {
    let Some(folder) = resolve_created_plan_folder(plans_dir, job, output_lines) else {
        return;
    };
    if revision_count(&folder) > 0 {
        // A real plan, interrupted. Keep it, and link the job to it: this is the only place that
        // knows the two belong together once the run is over.
        job.plan_file = folder.to_string_lossy().to_string();
        return;
    }
    if cleanup_plan_folder_and_database(tendril_home, plans_dir, &folder) {
        // Nothing to link to any more.
        job.plan_file = String::new();
    } else {
        // Kept -- it holds work `classify_husk` refused to destroy. Link it, so the operator can
        // reach it from the job instead of finding it by hand in the plans list.
        job.plan_file = folder.to_string_lossy().to_string();
    }
}

/// Records `chat_session_id` on the plan a finished job produced or worked on, so the plan's own later
/// events reach the conversation too. Never overwrites a session the plan already names: a plan opened
/// in its own side-panel chat belongs to that conversation, not to whichever chat last ran a job on it.
fn adopt_plan_into_chat_session(plans_dir: &Path, job: &JobItem, chat_session_id: &str) {
    // `plan_file` is empty for the `CreatePlan` that produced the plan, so fall back to the id the
    // promptware reported through `tendril job status --plan-id`.
    let folder = {
        let named = PathBuf::from(&job.plan_file);
        if named.is_dir() {
            Some(named)
        } else {
            let plan_id = job.resolve_plan_id();
            (!plan_id.is_empty())
                .then(|| resolve_plan_folder(&plan_id, plans_dir).ok())
                .flatten()
        }
    };
    let Some(folder) = folder else { return };

    let Ok((mut plan, _)) = read_plan_yaml(&folder) else {
        return;
    };
    if plan
        .chat_session_id
        .as_deref()
        .is_some_and(|id| !id.trim().is_empty())
    {
        return;
    }
    plan.chat_session_id = Some(chat_session_id.to_string());
    if let Err(e) = write_plan_yaml(&folder, &plan) {
        tracing::debug!(
            "Could not record chat session {chat_session_id} on plan {}: {e}",
            folder.display()
        );
    }
}
