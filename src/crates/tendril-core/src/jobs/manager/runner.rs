//! The per-job runner task: everything between a launch and a finish.
//!
//! [`spawn_runner`] resolves the agent, compiles its firmware, runs the `before` hooks, spawns the
//! process, wires up the liveness plumbing and the cancellation watch, then classifies the outcome
//! and hands it to [`finish_job`]. It is one long function on
//! purpose: the ordering of those steps is the contract, and each early return has to unwind exactly
//! the steps taken so far.

use super::completion::{classify_outcome, finish_job};
use super::events::persist;
use super::internals::{job_timeout_duration, stale_output_timeout_duration, DispatchContext};
use super::progress::{note_agent_output, run_stale_output_watchdog, OutputActivity};
use super::waiting::release_wait_dependents;
use crate::agents::eventwire::EventWireNormalizer;
use crate::agents::providers::{apply_security_settings, AgentLaunchConfig};
use crate::agents::reconcile::build_missing_result_lines;
use crate::agents::resolution::resolve_agent;
use crate::agents::runner::{run_agent_process_with_grace, TerminationReason};
use crate::config::{get_plans_dir_with_settings, TendrilSettings};
use crate::jobs::dependents::release_dependents;
use crate::jobs::firmware_values::{
    build_firmware_values, build_job_context, execution_profile_override, find_project,
    is_auto_project, resolve_project, resolve_project_skills, resolve_working_directory,
    resolve_writable_directories,
};
use crate::jobs::hooks::{run_hooks, HookPhase, HookRunContext};
use crate::jobs::logger::{
    append_to_eventwire, append_to_raw_log, read_eventwire_log, write_prompt,
};
use crate::models::{JobItem, JobStatus};
use crate::plans::reader::read_plan_yaml;
use crate::promptware::compiler::compile_firmware_with_skills;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{watch, OwnedSemaphorePermit};

#[allow(clippy::too_many_lines, clippy::too_many_arguments)]
pub(super) fn spawn_runner(
    ctx: DispatchContext,
    mut job: JobItem,
    cancel_tx: Arc<watch::Sender<bool>>,
    pid: Arc<AtomicU32>,
    completion_claimed: Arc<AtomicBool>,
    settings: TendrilSettings,
    permit: OwnedSemaphorePermit,
) {
    let tendril_home = ctx.tendril_home.clone();
    // Resolved once, here, and passed down: `finish_job` deletes orphan plan folders, and an
    // ambient `TENDRIL_PLANS` lookup inside it would point a test at the real plans directory.
    let plans_dir = ctx
        .plans_dir_override
        .clone()
        .unwrap_or_else(|| get_plans_dir_with_settings(&tendril_home, Some(&settings)));
    let jobs_map = ctx.jobs.clone();
    let handles = ctx.handles.clone();
    let job_events = ctx.events.clone();
    let spec_builder = ctx.spec_builder.clone();
    let hook_executor = ctx.hook_executor.clone();
    let dispatch_notify = ctx.dispatch_notify.clone();
    let timeout = ctx
        .job_timeout_override
        .or_else(|| job_timeout_duration(&settings));
    let post_result_grace = ctx
        .post_result_grace_override
        .unwrap_or(crate::agents::runner::DEFAULT_POST_RESULT_GRACE);
    let stale_timeout = ctx
        .stale_output_timeout_override
        .or_else(|| stale_output_timeout_duration(&settings));

    tokio::spawn(async move {
        // The permit is held for the whole life of the job, and released to the dispatcher at the end.
        let permit = permit;
        let job_id = job.id.clone();
        let cancel_rx = cancel_tx.subscribe();

        // A job cancelled while it was still queued never had a process; cancel_job has already
        // written its terminal state, so there is nothing left to do.
        if *cancel_rx.borrow() {
            drop(permit);
            dispatch_notify.notify_one();
            return;
        }

        job.status = JobStatus::Running;
        // The dispatch path's own announcement: without it a job that starts while no job view is
        // open is invisible until the next poll.
        persist(&tendril_home, &jobs_map, &job, Some(&job_events)).await;

        // `before` hooks fire once the job is genuinely starting: past the queue and the cancel
        // check, ahead of everything that can still fail. A hook cannot stop the job — a failing one
        // is logged and ignored, see `crate::jobs::hooks`.
        if let Some(hook_ctx) = hook_context(
            &tendril_home,
            &settings,
            &job,
            JobStatus::Running,
            HookPhase::Before,
        ) {
            run_hooks(&hook_ctx, HookPhase::Before, &hook_executor).await;
        }

        let promptware_folder = tendril_home.join("Promptwares").join(&job.job_type);
        if !promptware_folder.is_dir() {
            let msg = format!(
                "Promptware folder not found: {}",
                promptware_folder.display()
            );
            // No `after` hooks here, deliberately: a launch that never got as far as an agent has
            // nothing for a hook to react to, and the same is true of the compile failure below.
            finish_job(
                &tendril_home,
                &plans_dir,
                &jobs_map,
                &handles,
                &completion_claimed,
                job,
                JobStatus::Failed,
                msg,
                None,
                Some(&job_events),
            )
            .await;
            release_wait_dependents(&ctx, &job_id).await;
            drop(permit);
            dispatch_notify.notify_one();
            return;
        }

        let values = build_firmware_values(&job, &tendril_home, &settings);
        let skills = resolve_project_skills(&settings, &job.project, &tendril_home);
        let compiled_prompt =
            match compile_firmware_with_skills(&promptware_folder, &values, &skills) {
                Ok(p) => p,
                Err(e) => {
                    let msg = format!(
                        "Failed to compile firmware from {}: {}",
                        promptware_folder.display(),
                        e
                    );
                    finish_job(
                        &tendril_home,
                        &plans_dir,
                        &jobs_map,
                        &handles,
                        &completion_claimed,
                        job,
                        JobStatus::Failed,
                        msg,
                        None,
                        Some(&job_events),
                    )
                    .await;
                    release_wait_dependents(&ctx, &job_id).await;
                    drop(permit);
                    dispatch_notify.notify_one();
                    return;
                }
            };

        if let Err(e) = write_prompt(&tendril_home, &job_id, &compiled_prompt) {
            tracing::warn!("Failed to persist prompt for job {}: {}", job_id, e);
        }

        let working_dir =
            resolve_working_directory(&job, &settings, &tendril_home, &promptware_folder);

        if let Ok((plan, _)) = read_plan_yaml(Path::new(&job.plan_file)) {
            if let Some(profile) = execution_profile_override(&job, &plan) {
                job.execution_profile = Some(profile);
            }
        }

        let security = find_project(&settings, &resolve_project(&job, &settings))
            .map(|p| p.security.clone())
            .unwrap_or_default();

        // What the agent is actually launched with. Without this the launch config carries no
        // allowlist at all, which sends `build_claude_spec` down its restrictive fallback and denies
        // the shell commands every promptware is built out of — so the job burns tokens and reports
        // "exited 0 with no commits recorded". V1 resolves the same way in `AgentProviderFactory`.
        let job_context = build_job_context(&values, &tendril_home, &promptware_folder);
        let resolution = resolve_agent(
            &settings,
            &job.provider,
            &job.job_type,
            job.execution_profile.as_deref(),
            &job_context,
        );

        let mut launch_config = AgentLaunchConfig {
            prompt: compiled_prompt,
            working_directory: working_dir.clone(),
            // The job's own model and effort win when it carries them: an explicit per-job choice is
            // downstream of the profile the resolution applied.
            model: job.model.clone().or_else(|| resolution.model.clone()),
            effort: job.effort.clone().or_else(|| resolution.effort.clone()),
            permission_mode: Some("FullAuto".to_string()),
            allowed_tools: resolution.allowed_tools.clone(),
            denied_tools: resolution.denied_tools.clone(),
            writable_directories: resolve_writable_directories(
                &job.job_type,
                &promptware_folder,
                Path::new(&job.plan_file),
                &tendril_home,
                &settings,
            ),
            environment_variables: resolution.environment_variables.clone(),
            extra_arguments: resolution.extra_arguments.clone(),
            ..Default::default()
        };
        // The agent runs `tendril plan create`, and that command stamps this id into the plan's
        // `plan.yaml` so the plan can be traced back to the job that made it without the agent having
        // to report anything. `TENDRIL_JOB_ID` is the name the hook environment already uses for the
        // same value (see `crate::jobs::hooks`), so there is one spelling of it to learn.
        //
        // Inserted after the resolution's own variables so a misconfigured agent entry cannot shadow
        // it: the whole point is that this is present on every run.
        launch_config
            .environment_variables
            .insert("TENDRIL_JOB_ID".to_string(), job.id.clone());
        apply_security_settings(&mut launch_config, &security);

        let spec = (spec_builder)(&job.provider, &launch_config);
        job.working_directory = Some(working_dir.to_string_lossy().to_string());
        job.cli_command = Some(format!("{} {}", spec.command, spec.args.join(" ")));

        let start_time = Instant::now();
        let th = tendril_home.clone();
        let jid = job_id.clone();
        let pid_slot = pid.clone();
        let jobs_for_pid = jobs_map.clone();
        let home_for_pid = tendril_home.clone();
        let job_for_pid = job.clone();

        // Liveness plumbing: the callback stamps activity, the watchdog reads it.
        let activity = Arc::new(OutputActivity::new());
        let finished = Arc::new(AtomicBool::new(false));
        let stale_fired = Arc::new(AtomicBool::new(false));
        if let Some(stale) = stale_timeout {
            tokio::spawn(run_stale_output_watchdog(
                job_id.clone(),
                activity.clone(),
                stale,
                cancel_tx.clone(),
                finished.clone(),
                stale_fired.clone(),
            ));
        }
        let activity_for_output = activity.clone();
        let home_for_output = tendril_home.clone();
        let id_for_output = job_id.clone();
        let jobs_for_output = jobs_map.clone();

        // Stateful, and held by the `FnMut` closure rather than shared: Antigravity ties a tool call's
        // two halves together by `step_index`, so the normalizer has to remember the open ones.
        let mut eventwire = EventWireNormalizer::new();

        let run_res = run_agent_process_with_grace(
            spec,
            move |evt| {
                let _ = append_to_raw_log(&th, &jid, &evt.raw_line);
                // A provider's own line is *not* eventwire. `parseEventWireStream` keeps only lines
                // carrying a `kind`, so appending the raw line here left `AgentViewer` with nothing to
                // render in `JobSessionView` - for every provider, not just one. Normalising first is
                // what the chat turn already does; this is the same layer, so a job's tool disclosure
                // and a chat turn's now come from one implementation.
                for event_line in eventwire.normalize(&evt.raw_line, evt.is_stderr) {
                    let _ = append_to_eventwire(&th, &jid, &event_line);
                }
                note_agent_output(
                    &activity_for_output,
                    &jobs_for_output,
                    &home_for_output,
                    &id_for_output,
                    &evt.raw_line,
                );
            },
            move |spawned_pid| {
                pid_slot.store(spawned_pid, Ordering::SeqCst);
                // Persist the PID immediately: startup reconciliation uses it to tell a
                // detached agent from an interrupted one.
                let mut with_pid = job_for_pid;
                with_pid.process_id = Some(spawned_pid);
                tokio::spawn(async move {
                    // No sender: the status has not moved since the `Running` write above, so this
                    // would be a duplicate event even before `persist`'s own guard sees it.
                    persist(&home_for_pid, &jobs_for_pid, &with_pid, None).await;
                });
            },
            cancel_rx,
            timeout,
            post_result_grace,
        )
        .await;

        finished.store(true, Ordering::SeqCst);
        job.process_id = Some(pid.load(Ordering::SeqCst)).filter(|p| *p != 0);
        // This task's own copy predates every write the run made, and `finish_job` persists the whole
        // record — so anything the *running agent* reported has to be taken from the live record here or
        // the terminal write erases it.
        //
        // `last_output_at` is the heartbeat `note_agent_output` maintains: without it a job's row
        // remembers when it started but not when it last spoke. The other three are what the promptware
        // reports over HTTP while it works — `tendril job status --plan-id/--plan-title` and
        // `tendril job fail --message` — and losing them is why a `CreatePlan` that really did produce a
        // plan came out with `ReportedPlanId` NULL: the chat then had no plan to name in its follow-up
        // turn, `adopt_plan_into_chat_session` had nothing to stamp the plan with, and
        // `resolve_created_plan_folder` lost the candidate it needed to recognise the plan at all.
        if let Some(current) = jobs_map.read().await.get(&job_id) {
            if let Some(at) = current.last_output_at {
                job.last_output_at = Some(at);
            }
            if current.reported_plan_id.is_some() {
                job.reported_plan_id = current.reported_plan_id.clone();
            }
            if current.reported_plan_title.is_some() {
                job.reported_plan_title = current.reported_plan_title.clone();
            }
            if current.reported_failure_reason.is_some() {
                job.reported_failure_reason = current.reported_failure_reason.clone();
            }
            // A `CreatePlan` that reported its plan mid-run learned its project then; this copy still
            // says `Auto`, and the terminal write would put that back.
            if is_auto_project(&job.project) && !is_auto_project(&current.project) {
                job.project = current.project.clone();
            }
        }

        // A tool_call that never received a tool_result leaves its card spinning forever in
        // AgentViewer, since that's fed straight from this eventwire log. Close any out before
        // classifying the outcome, using the same reason text the chat path uses.
        let synthetic_output = match &run_res {
            Ok(outcome) => match outcome.terminated {
                TerminationReason::Cancelled => "[Cancelled]",
                TerminationReason::TimedOut => "[Timed out]",
                TerminationReason::Exited | TerminationReason::PostResultGraceExceeded => {
                    "[No output received]"
                }
            },
            Err(_) => "[No output received]",
        };
        if let Ok(Some(ev_lines)) = read_eventwire_log(&tendril_home, &job_id, None) {
            for line in build_missing_result_lines(&ev_lines, synthetic_output, true) {
                let _ = append_to_eventwire(&tendril_home, &job_id, &line);
            }
        }

        let duration = start_time.elapsed().as_secs() as i64;
        let (final_status, msg) = classify_outcome(
            run_res,
            timeout,
            stale_fired
                .load(Ordering::SeqCst)
                .then(|| stale_timeout.unwrap_or_default()),
        );

        let finished = job.clone();
        let completed = finish_job(
            &tendril_home,
            &plans_dir,
            &jobs_map,
            &handles,
            &completion_claimed,
            job,
            final_status,
            msg,
            Some(duration),
            Some(&job_events),
        )
        .await;

        // `after` hooks read the status `finish_job` settled on, not the one the process reported: a
        // `Completed` that produced no deliverable is a `Failed`, and that is what a hook must see.
        // `None` means a cancellation had already claimed completion and written the terminal state,
        // so the job this task was running no longer owns the outcome.
        if let Some(completed) = &completed {
            if let Some(hook_ctx) = hook_context(
                &tendril_home,
                &settings,
                completed,
                completed.status,
                HookPhase::After,
            ) {
                run_hooks(&hook_ctx, HookPhase::After, &hook_executor).await;
            }
        }

        // `finish_job`'s signature is public and depended on by tests, so the release step lives here
        // rather than inside it. The maintenance pass rechecks the same thing every 60s, which covers
        // a job that finished while the daemon was down.
        release_wait_dependents(&ctx, &job_id).await;

        // Anything that was waiting on this job is re-gated now the terminal state is written. A
        // manager that was never published as an `Arc` yields `None` and simply restarts nothing.
        let manager = ctx.self_handle.upgrade();
        release_dependents(
            &tendril_home,
            &plans_dir,
            &jobs_map,
            manager.as_ref(),
            &finished,
        )
        .await;

        drop(permit);
        dispatch_notify.notify_one();
    });
}

/// What a hook run needs from a job, or `None` when the job's project is unknown or configures no
/// hooks — the common case, which is why it is the first thing checked.
fn hook_context(
    tendril_home: &Path,
    settings: &TendrilSettings,
    job: &JobItem,
    job_status: JobStatus,
    phase: HookPhase,
) -> Option<HookRunContext> {
    let project = find_project(settings, &job.project)?;
    if project.hooks.is_empty() {
        return None;
    }

    Some(HookRunContext {
        tendril_home: tendril_home.to_path_buf(),
        config_path: crate::config::get_config_path(tendril_home),
        project: project.clone(),
        job_id: job.id.clone(),
        job_type: job.job_type.clone(),
        job_status,
        // A `CreatePlan` job has no plan folder until it has written one, so a `before` hook is told
        // there is none rather than pointed at a path that does not exist yet. Its `after` hook gets
        // the folder the run produced, which is the whole reason such a hook would be configured.
        plan_folder: if phase == HookPhase::Before && job.job_type == "CreatePlan" {
            String::new()
        } else {
            job.plan_file.clone()
        },
    })
}
