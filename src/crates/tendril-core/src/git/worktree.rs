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

pub fn cleanup_worktrees(plan_folder: &Path) -> Result<()> {
    let worktrees_dir = plan_folder.join("Worktrees");
    if !worktrees_dir.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(&worktrees_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            // Remove worktree
            let _ = run_git(
                &["worktree", "remove", "--force", &path.to_string_lossy()],
                &path,
            );
            let _ = std::fs::remove_dir_all(&path);
        }
    }

    Ok(())
}
