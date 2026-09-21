//! The worktree verbs: `plan add-worktree`, `plan remove-worktree` and the `plan cleanup` teardown.
//!
//! `cleanup` sits with them rather than with the other health commands because what it destroys is
//! worktrees: the "did the removal actually happen?" check in [`surviving_worktree_dirs`] is the
//! same knowledge `add-worktree` needs about what a laid-down worktree looks like on disk.

use super::cli::{PlanAddWorktreeArgs, PlanCleanupArgs, PlanRemoveWorktreeArgs};
use super::vocabulary::TERMINAL_PLAN_STATES;
use chrono::Utc;
use std::path::PathBuf;
use tendril_core::git::worktree::{
    add_worktree, cleanup_worktrees, register_worktree, remove_worktree, RemoveOutcome,
    WorktreeMode,
};
use tendril_core::models::{PlanStatus, PlanWorktreeEntry};
use tendril_core::plans::{read_plan_yaml, resolve_plan_folder, write_plan_yaml};

/// `plan cleanup <id>` — remove a finished plan's worktrees.
pub(super) fn cleanup(args: PlanCleanupArgs, plans_dir: PathBuf) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;

    // The worktrees of a non-terminal plan may have a coding agent working inside them, so
    // removing them needs an explicit override. Without this guard `plan cleanup` deleted an
    // actively executing plan's worktrees out from under its agent and exited 0.
    if !args.force {
        let (plan, _) = read_plan_yaml(&folder)?;
        let terminal = PlanStatus::from_str_loose(&plan.state)
            .is_some_and(|s| TERMINAL_PLAN_STATES.contains(&s));
        if !terminal {
            anyhow::bail!(
                "Plan is not in a terminal state (current: {}). Use --force to override.",
                plan.state
            );
        }
    }

    cleanup_worktrees(&folder)?;

    // `cleanup_worktrees` is best-effort per directory and returns `Ok(())` even when it
    // removed nothing, so the only honest verdict comes from looking again.
    let survivors = surviving_worktree_dirs(&folder);
    if !survivors.is_empty() {
        for path in &survivors {
            eprintln!("Could not remove worktree: {}", path.display());
        }
        anyhow::bail!("{} worktrees could not be removed.", survivors.len());
    }
    println!("Worktrees cleaned up for plan {}", args.plan_id);

    Ok(())
}

/// `plan add-worktree <id> <repo>`.
pub(super) fn add(args: PlanAddWorktreeArgs, plans_dir: PathBuf) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let repo_path = PathBuf::from(&args.repo);
    let creation = add_worktree(
        &repo_path,
        &folder,
        args.base.as_deref(),
        WorktreeMode::ReuseIfValid,
        None,
    )?;

    // add_worktree can return before git has finished laying the worktree down, and a
    // worktree without a `.git` file is unusable for everything downstream.
    if !creation.path.join(".git").exists() {
        anyhow::bail!(
            "Worktree at {} has no .git file, so git did not create it",
            creation.path.display()
        );
    }

    // The checkout is what matters; a registry write failure is not worth failing the
    // command for, because the reaper also finds worktrees by directory scan.
    if let Err(e) = register_worktree(
        &folder,
        PlanWorktreeEntry {
            repo: creation.repo.to_string_lossy().to_string(),
            path: creation.path.to_string_lossy().to_string(),
            branch: creation.branch.clone(),
            created: Utc::now(),
        },
    ) {
        eprintln!("Warning: failed to register worktree on plan: {}", e);
    }

    let (mut plan, _) = read_plan_yaml(&folder)?;
    if !plan.repos.contains(&args.repo) {
        plan.repos.push(args.repo.clone());
        plan.updated = Utc::now();
        write_plan_yaml(&folder, &plan)?;
    }

    println!("Worktree created: {}", creation.path.display());
    println!("Branch: {}", creation.branch);

    Ok(())
}

/// `plan remove-worktree <id> <repo-name>`.
pub(super) fn remove(args: PlanRemoveWorktreeArgs, plans_dir: PathBuf) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    match remove_worktree(&folder, &args.repo_name, args.branch.as_deref())? {
        // Already gone is the outcome the caller asked for, so this is not a failure.
        RemoveOutcome::NotFound(path) => {
            println!("Worktree directory not found: {}", path.display());
        }
        RemoveOutcome::Removed(path) | RemoveOutcome::ForceDeleted(path) => {
            println!("Worktree removed: {}", path.display());
        }
    }

    Ok(())
}

/// The directories still present under a plan's `Worktrees/` folder, i.e. what a cleanup pass failed
/// to remove. Empty when there is no `Worktrees/` folder at all.
fn surviving_worktree_dirs(plan_folder: &std::path::Path) -> Vec<PathBuf> {
    let worktrees_dir = plan_folder.join("Worktrees");
    let Ok(entries) = std::fs::read_dir(&worktrees_dir) else {
        return Vec::new();
    };
    let mut survivors: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    // `read_dir` yields whatever order the filesystem happens to hand back - APFS returns these
    // sorted, ext4 does not - and `plan cleanup` prints one "Could not remove worktree" line per
    // survivor, so the failure report has to read the same way on every machine.
    survivors.sort();
    survivors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surviving_worktree_dirs_reports_what_is_left_behind() {
        let root = std::env::temp_dir().join(format!(
            "tendril-cli-survivors-{}",
            uuid::Uuid::new_v4().simple()
        ));
        // No Worktrees folder at all is a clean plan, not a failure.
        std::fs::create_dir_all(&root).unwrap();
        assert!(surviving_worktree_dirs(&root).is_empty());

        std::fs::create_dir_all(root.join("Worktrees")).unwrap();
        assert!(surviving_worktree_dirs(&root).is_empty());

        std::fs::create_dir_all(root.join("Worktrees/repo-one")).unwrap();
        std::fs::write(root.join("Worktrees/stray-file"), b"x").unwrap();
        let survivors = surviving_worktree_dirs(&root);
        assert_eq!(
            survivors.len(),
            1,
            "files are not worktrees: {:?}",
            survivors
        );
        assert!(survivors[0].ends_with("repo-one"));

        let _ = std::fs::remove_dir_all(&root);
    }
}
