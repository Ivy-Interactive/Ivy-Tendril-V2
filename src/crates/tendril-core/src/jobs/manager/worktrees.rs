//! Preparing the git worktrees a plan's job runs in.

use crate::config::TendrilSettings;
use crate::error::TendrilError;
use crate::git::worktree::{add_worktree, register_worktree, WorktreeMode};
use crate::git::worktree_log::WorktreeLifecycleLog;
use crate::jobs::firmware_values::{find_project, find_repo_ref, repo_name, resolve_project};
use crate::models::{JobItem, PlanWorktreeEntry};
use crate::plans::reader::read_plan_yaml;
use chrono::Utc;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

/// Creates the plan's worktrees before its agent is launched, one per repo in `plan.repos`, and
/// records them on the plan.
///
/// Returns `Err` with the message the job should fail with. Continuing without a worktree would run
/// the agent against the operator's main checkout, so a creation failure is fatal to the job — which
/// is also what the promptware does when `tendril plan add-worktree` exits non-zero.
///
/// Only `plan.repos` are covered here. Read-only build dependencies reach the same `add_worktree`
/// through the CLI, driven by the promptware's `RepoConfigs` loop.
pub async fn prepare_plan_worktrees(
    tendril_home: &Path,
    job: &JobItem,
    settings: &TendrilSettings,
) -> std::result::Result<(), String> {
    if !matches!(job.job_type.as_str(), "ExecutePlan" | "RetryPlan") {
        return Ok(());
    }

    let plan_folder = PathBuf::from(&job.plan_file);
    if !plan_folder.is_dir() {
        return Ok(());
    }

    let Ok((plan, _)) = read_plan_yaml(&plan_folder) else {
        return Ok(());
    };
    if plan.repos.is_empty() {
        return Ok(());
    }

    // A PR-sourced plan must be based on the PR's own head branch, which the promptware does itself
    // and explicitly cannot do through `add-worktree`. Pre-cutting a `tendril/*` branch here would
    // only be thrown away.
    if plan
        .source_url
        .as_deref()
        .is_some_and(|u| u.contains("/pull/"))
    {
        tracing::info!(
            "Job {}: not pre-creating worktrees for {} — the plan's source is a pull request, so the promptware bases the worktree on the PR's head branch",
            job.id,
            job.plan_file
        );
        return Ok(());
    }

    let project_config = find_project(settings, &resolve_project(job, settings));

    for repo_path in &plan.repos {
        let base = project_config
            .and_then(|c| find_repo_ref(c, repo_path))
            .and_then(|r| r.base_branch.clone());

        let repo = PathBuf::from(repo_path);
        let name = repo_name(repo_path).to_string();
        let plan_folder_for_task = plan_folder.clone();
        let home = tendril_home.to_path_buf();

        // git is blocking, and this runs on the runtime.
        let created = tokio::task::spawn_blocking(move || {
            let log = WorktreeLifecycleLog::new(&home);
            let creation = add_worktree(
                &repo,
                &plan_folder_for_task,
                base.as_deref(),
                WorktreeMode::ReuseIfValid,
                Some(&log),
            )?;

            // The checkout is what matters; a registry write failure is not worth failing the job
            // for, because the reaper also finds worktrees by directory scan.
            if let Err(e) = register_worktree(
                &plan_folder_for_task,
                PlanWorktreeEntry {
                    repo: creation.repo.to_string_lossy().to_string(),
                    path: creation.path.to_string_lossy().to_string(),
                    branch: creation.branch.clone(),
                    created: Utc::now(),
                },
            ) {
                tracing::warn!(
                    "Failed to register worktree {} on plan {}: {}",
                    creation.path.display(),
                    plan_folder_for_task.display(),
                    e
                );
            }

            Ok::<_, TendrilError>(creation)
        })
        .await;

        match created {
            Ok(Ok(creation)) => tracing::info!(
                "Job {}: {} worktree {} on {}",
                job.id,
                if creation.reused { "reused" } else { "created" },
                creation.path.display(),
                creation.branch
            ),
            Ok(Err(e)) => {
                return Err(format!("Worktree creation failed for {}: {}", name, e));
            }
            Err(e) => {
                return Err(format!("Worktree creation failed for {}: {}", name, e));
            }
        }
    }

    Ok(())
}
