use crate::error::{Result, TendrilError};
use crate::git::service::run_git;
use std::path::{Path, PathBuf};

pub fn derive_branch_name(plan_folder: &Path) -> String {
    let folder_name = plan_folder
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("plan");
    format!("tendril/{}", folder_name)
}

pub fn derive_worktree_relative_path(repo_path: &Path) -> String {
    repo_path
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("repo")
        .to_string()
}

pub fn add_worktree(
    repo_path: &Path,
    plan_folder: &Path,
    base_branch: Option<&str>,
) -> Result<PathBuf> {
    if !repo_path.exists() {
        return Err(TendrilError::Git(format!(
            "Repo path does not exist: {}",
            repo_path.display()
        )));
    }

    let branch_name = derive_branch_name(plan_folder);
    let rel_path = derive_worktree_relative_path(repo_path);
    let worktrees_dir = plan_folder.join("Worktrees");
    std::fs::create_dir_all(&worktrees_dir)?;

    let worktree_path = worktrees_dir.join(&rel_path);

    // Remove existing worktree if present
    if worktree_path.exists() {
        let _ = run_git(
            &[
                "worktree",
                "remove",
                "--force",
                &worktree_path.to_string_lossy(),
            ],
            repo_path,
        );
        let _ = run_git(&["branch", "-D", &branch_name], repo_path);
    }

    // Fetch origin
    let _ = run_git(&["fetch", "origin"], repo_path);

    // Determine base branch
    let base = if let Some(b) = base_branch {
        b.to_string()
    } else {
        let (code, stdout, _) = run_git(&["symbolic-ref", "refs/remotes/origin/HEAD"], repo_path)?;
        if code == 0 && !stdout.trim().is_empty() {
            stdout.trim().replace("refs/remotes/origin/", "")
        } else {
            "main".to_string()
        }
    };

    let origin_base = format!("origin/{}", base);
    let (code, _, stderr) = run_git(
        &[
            "worktree",
            "add",
            &worktree_path.to_string_lossy(),
            "-b",
            &branch_name,
            &origin_base,
        ],
        repo_path,
    )?;

    if code != 0 {
        // Fallback without origin/ if branch is local only
        let (retry_code, _, retry_err) = run_git(
            &[
                "worktree",
                "add",
                &worktree_path.to_string_lossy(),
                "-b",
                &branch_name,
                &base,
            ],
            repo_path,
        )?;
        if retry_code != 0 {
            return Err(TendrilError::Git(format!(
                "git worktree add failed: {}\n{}",
                stderr, retry_err
            )));
        }
    }

    Ok(worktree_path)
}

/// What happened while removing a single worktree, so callers can report it without
/// re-inspecting the filesystem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoveOutcome {
    /// The directory was already gone. Treated as success — cleanup runs unconditionally
    /// in CreatePr and must not fail a plan just because a prior run already tidied up.
    NotFound(PathBuf),
    /// `git worktree remove --force` succeeded.
    Removed(PathBuf),
    /// git refused or left the directory behind, so it was deleted from disk directly.
    ForceDeleted(PathBuf),
}

/// Recovers the main repository root from a worktree's `.git` file, which contains
/// `gitdir: <repo>/.git/worktrees/<name>`. Returns `None` when the path is not a worktree.
pub fn resolve_repo_root(worktree_path: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(worktree_path.join(".git")).ok()?;
    let gitdir = content
        .lines()
        .find_map(|line| line.trim().strip_prefix("gitdir:"))?
        .trim();

    // <repo>/.git/worktrees/<name> -> <repo>/.git -> <repo>
    let repo_root = Path::new(gitdir).parent()?.parent()?.parent()?;
    if repo_root.is_dir() {
        Some(repo_root.to_path_buf())
    } else {
        None
    }
}

/// Lists the worktree directories under a plan's `Worktrees/` folder. Both a flat
/// `Worktrees/<repo>` and a nested `Worktrees/<owner>/<repo>` layout are in use, so the
/// first two levels are scanned for the `.git` file that marks a real worktree.
pub fn enumerate_worktree_directories(worktrees_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(worktrees_dir) else {
        return found;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.join(".git").exists() {
            found.push(path);
            continue;
        }
        if let Ok(children) = std::fs::read_dir(&path) {
            for child in children.flatten() {
                let child_path = child.path();
                if child_path.is_dir() && child_path.join(".git").exists() {
                    found.push(child_path);
                }
            }
        }
    }

    found.sort();
    found
}

/// Removes one worktree directory, escalating from `git worktree remove --force` to a
/// direct delete. Shared by [`remove_worktree`] and [`cleanup_worktrees`] so both use the
/// same ladder; branch deletion is the caller's business.
pub fn remove_worktree_directory(worktree_path: &Path) -> Result<RemoveOutcome> {
    if !worktree_path.exists() {
        return Ok(RemoveOutcome::NotFound(worktree_path.to_path_buf()));
    }

    let mut remove_stderr = String::new();
    if let Some(repo_root) = resolve_repo_root(worktree_path) {
        if let Ok((_, _, stderr)) = run_git(
            &[
                "worktree",
                "remove",
                "--force",
                &worktree_path.to_string_lossy(),
            ],
            &repo_root,
        ) {
            remove_stderr = stderr;
        }

        if !worktree_path.exists() {
            return Ok(RemoveOutcome::Removed(worktree_path.to_path_buf()));
        }
    }

    let _ = std::fs::remove_dir_all(worktree_path);
    if !worktree_path.exists() {
        return Ok(RemoveOutcome::ForceDeleted(worktree_path.to_path_buf()));
    }

    let detail = if remove_stderr.trim().is_empty() {
        "git worktree remove and force-delete both failed; no git stderr was captured.".to_string()
    } else {
        format!(
            "git worktree remove reported:\n{}",
            remove_stderr.trim_end()
        )
    };
    Err(TendrilError::Git(format!(
        "Failed to remove worktree at {}. {}",
        worktree_path.display(),
        detail
    )))
}

/// Removes exactly one of a plan's worktrees, identified by its folder name inside the
/// plan's `Worktrees/` directory, and deletes the branch it was checked out on.
///
/// `branch` defaults to the plan's `tendril/<planFolderName>` branch.
pub fn remove_worktree(
    plan_folder: &Path,
    repo_name: &str,
    branch: Option<&str>,
) -> Result<RemoveOutcome> {
    let worktrees_dir = plan_folder.join("Worktrees");
    let mut worktree_path = worktrees_dir.join(repo_name);

    if !worktree_path.exists() {
        let wanted = repo_name.replace('\\', "/");
        let matched = enumerate_worktree_directories(&worktrees_dir)
            .into_iter()
            .find(|w| {
                let by_name = w
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.eq_ignore_ascii_case(repo_name));
                let by_relative = w
                    .strip_prefix(&worktrees_dir)
                    .ok()
                    .map(|r| r.to_string_lossy().replace('\\', "/"))
                    .is_some_and(|r| r.eq_ignore_ascii_case(&wanted));
                by_name || by_relative
            });

        match matched {
            Some(m) => worktree_path = m,
            None => return Ok(RemoveOutcome::NotFound(worktree_path)),
        }
    }

    let branch_name = branch
        .map(|b| b.to_string())
        .unwrap_or_else(|| derive_branch_name(plan_folder));
    // Read the repo root before removal — the `.git` file it comes from is deleted with the
    // worktree, and the branch still has to be deleted afterwards.
    let repo_root = resolve_repo_root(&worktree_path);

    let outcome = remove_worktree_directory(&worktree_path)?;

    if let Some(root) = repo_root {
        // Best-effort: the branch may already be gone (e.g. a re-run after a prior cleanup).
        let _ = run_git(&["branch", "-D", &branch_name], &root);
    }

    Ok(outcome)
}

pub fn cleanup_worktrees(plan_folder: &Path) -> Result<()> {
    let worktrees_dir = plan_folder.join("Worktrees");
    if !worktrees_dir.exists() {
        return Ok(());
    }

    // Deregister every real worktree first, so git's admin entries go with them. Best-effort
    // per directory: one stubborn worktree must not stop the rest. Branches are left alone
    // here — `remove_worktree` is the branch-deleting path.
    for path in enumerate_worktree_directories(&worktrees_dir) {
        let _ = remove_worktree_directory(&path);
    }

    // Then drop whatever is left (empty owner folders, orphaned checkouts with no `.git`).
    for entry in std::fs::read_dir(&worktrees_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }

    Ok(())
}
