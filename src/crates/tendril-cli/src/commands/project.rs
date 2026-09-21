//! `tendril project` — the project registry: repos, verifications, review actions, hooks, MCP
//! servers, skills, ports and env files.
//!
//! Every subcommand is tried against the running daemon first and falls back to editing
//! `config.yaml` directly, so the two handler modules mirror each other arm for arm:
//!
//! - `cli` is the clap surface, `daemon` the HTTP path, `local` the filesystem path.
//! - `edits` holds the `ProjectConfig` mutations and printing both paths share, so a rule like
//!   "is this a duplicate?" has exactly one answer.
//! - `import` resolves the repo an `import` subcommand names.
//!
//! What stays here is the entry point that chooses between the two paths, plus the review-action
//! ordering and project lookup helpers the filesystem path uses.

mod cli;
mod daemon;
mod edits;
mod import;
mod local;

pub use cli::{ProjectCommands, ProjectEnvFileCommands, ProjectPortCommands};

use daemon::{handle_project_command_daemon, DaemonOutcome};
use local::handle_project_command_fs;
use std::path::Path;
use tendril_core::config::read_master;
use tendril_core::config::{get_plans_dir_with_settings, TendrilSettings};
use tendril_core::git::service::run_git;
use tendril_core::git::worktree::derive_worktree_relative_path;
use tendril_core::models::{ProjectConfig, ReviewActionConfig};
use tendril_core::plans::{read_plan_yaml, resolve_plan_folder};

pub async fn handle_project_command(
    cmd: ProjectCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    if let Some(master) = read_master(tendril_home) {
        match handle_project_command_daemon(tendril_home, &cmd, &master).await {
            Ok(DaemonOutcome::Handled) => return Ok(()),
            Ok(DaemonOutcome::Fallback) => {
                tracing::debug!("Failed to reach master daemon, falling back to filesystem");
            }
            Err(e) => return Err(e),
        }
    }

    handle_project_command_fs(cmd, tendril_home)
}

/// Prints a project's hooks, or nothing at all when it has none — the same shape as the review
/// actions block above it, so `project get` stays readable for the projects that use neither.
///
/// Shared by the daemon and filesystem arms: two copies of a printer is two copies to drift.
pub(super) fn print_hooks(project: &ProjectConfig) {
    if project.hooks.is_empty() {
        return;
    }

    println!("Hooks:");
    for h in &project.hooks {
        let promptwares = if h.promptwares.is_empty() {
            "all".to_string()
        } else {
            h.promptwares.join(", ")
        };
        println!(
            "  - {} (when: {}, promptwares: {}, action: {}, condition: {})",
            h.name, h.when, promptwares, h.action, h.condition
        );
    }
}

/// Where a new/re-scoped review action should be inserted: `before`/`after` name an existing
/// action, otherwise it goes at the end (today's behaviour).
pub(super) fn resolve_review_action_insert_index(
    review_actions: &[ReviewActionConfig],
    before: Option<&str>,
    after: Option<&str>,
    project_name: &str,
) -> anyhow::Result<usize> {
    let available = || {
        review_actions
            .iter()
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };

    if let Some(target) = before {
        return review_actions
            .iter()
            .position(|a| a.name.eq_ignore_ascii_case(target))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Review action '{}' not found in project '{}'. Available: {}",
                    target,
                    project_name,
                    available()
                )
            });
    }

    if let Some(target) = after {
        return review_actions
            .iter()
            .position(|a| a.name.eq_ignore_ascii_case(target))
            .map(|idx| idx + 1)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Review action '{}' not found in project '{}'. Available: {}",
                    target,
                    project_name,
                    available()
                )
            });
    }

    Ok(review_actions.len())
}

/// Derives the changed files for `plan_id` by diffing each of the plan's repo worktrees against
/// its base branch. Never fails hard on a per-repo diff error — callers treat an empty result (or
/// this function returning `Err`) as "fall back to configured order".
pub(super) fn changed_files_for_plan(
    tendril_home: &Path,
    settings: &TendrilSettings,
    plan_id: &str,
) -> anyhow::Result<Vec<String>> {
    let plans_dir = get_plans_dir_with_settings(tendril_home, Some(settings));
    let plan_folder = resolve_plan_folder(plan_id, &plans_dir)?;
    let (plan, _) = read_plan_yaml(&plan_folder)?;

    let project_repos = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&plan.project))
        .map(|p| p.repos.as_slice())
        .unwrap_or(&[]);

    let mut all_files = Vec::new();
    for repo in &plan.repos {
        let repo_path = Path::new(repo);
        let worktree_path = plan_folder
            .join("Worktrees")
            .join(derive_worktree_relative_path(repo_path));
        if !worktree_path.exists() {
            continue;
        }

        let base_branch = project_repos
            .iter()
            .find(|r| r.path.eq_ignore_ascii_case(repo))
            .and_then(|r| r.base_branch.as_deref())
            .unwrap_or("main");

        let base_ref = format!("origin/{}", base_branch);
        let diff_ref = if run_git(&["rev-parse", "--verify", &base_ref], &worktree_path)
            .map(|(code, _, _)| code == 0)
            .unwrap_or(false)
        {
            base_ref
        } else {
            base_branch.to_string()
        };

        let (code, stdout, stderr) = run_git(
            &["diff", "--name-only", &format!("{}...HEAD", diff_ref)],
            &worktree_path,
        )?;
        if code != 0 {
            anyhow::bail!("git diff failed in {}: {}", worktree_path.display(), stderr);
        }

        all_files.extend(
            stdout
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty()),
        );
    }

    Ok(all_files)
}

pub(super) fn print_ranked_review_actions(
    ranked: &[&ReviewActionConfig],
    format: &str,
) -> anyhow::Result<()> {
    match format {
        "json" => {
            let json = serde_json::to_string_pretty(ranked)?;
            println!("{}", json);
        }
        "table" | "" => {
            for a in ranked {
                println!("{}\t{}\t{}", a.name, a.condition, a.command);
            }
        }
        other => {
            anyhow::bail!(
                "Unsupported format '{}'. Supported formats: table, json",
                other
            );
        }
    }
    Ok(())
}

pub(super) fn find_project<'a>(
    settings: &'a tendril_core::config::TendrilSettings,
    name: &str,
) -> anyhow::Result<&'a ProjectConfig> {
    settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))
}

pub(super) fn find_project_mut<'a>(
    settings: &'a mut tendril_core::config::TendrilSettings,
    name: &str,
) -> anyhow::Result<&'a mut ProjectConfig> {
    settings
        .projects
        .iter_mut()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))
}
