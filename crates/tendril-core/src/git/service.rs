use std::path::Path;
use std::process::Command;
use crate::error::{Result, TendrilError};

#[derive(Debug, Clone)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub commit_hash: String,
}

pub fn run_git(args: &[&str], working_dir: &Path) -> Result<(i32, String, String)> {
    let output = Command::new("git")
        .args(args)
        .current_dir(working_dir)
        .output()
        .map_err(|e| TendrilError::Git(format!("Failed to execute git command: {}", e)))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let code = output.status.code().unwrap_or(-1);

    Ok((code, stdout, stderr))
}

pub fn get_commit_title(repo_path: &Path, commit_hash: &str) -> Result<String> {
    let (code, stdout, stderr) = run_git(&["log", "-1", "--format=%s", commit_hash], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!("get_commit_title failed: {}", stderr)));
    }
    Ok(stdout.lines().next().unwrap_or("").to_string())
}

pub fn get_commit_diff(repo_path: &Path, commit_hash: &str) -> Result<String> {
    let (code, stdout, stderr) = run_git(&["show", "--format=", "--patch", commit_hash], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!("get_commit_diff failed: {}", stderr)));
    }
    Ok(stdout)
}

pub fn get_commit_files(repo_path: &Path, commit_hash: &str) -> Result<Vec<(String, String)>> {
    let (code, stdout, stderr) = run_git(&["diff-tree", "--no-commit-id", "--name-status", "-r", commit_hash], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!("get_commit_files failed: {}", stderr)));
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            list.push((parts[0].to_string(), parts[1].to_string()));
        }
    }
    Ok(list)
}

pub fn get_combined_diff(repo_path: &Path, first_commit: &str, last_commit: &str) -> Result<String> {
    let range = format!("{}^..{}", first_commit, last_commit);
    let (code, stdout, stderr) = run_git(&["diff", &range], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!("get_combined_diff failed: {}", stderr)));
    }
    Ok(stdout)
}

pub fn get_worktrees(repo_path: &Path) -> Result<Vec<WorktreeInfo>> {
    let (code, stdout, stderr) = run_git(&["worktree", "list", "--porcelain"], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!("get_worktrees failed: {}", stderr)));
    }

    let mut worktrees = Vec::new();
    let mut cur_path = String::new();
    let mut cur_hash = String::new();
    let mut cur_branch = String::new();

    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            if !cur_path.is_empty() {
                worktrees.push(WorktreeInfo {
                    path: cur_path,
                    branch: cur_branch,
                    commit_hash: cur_hash,
                });
                cur_hash = String::new();
                cur_branch = String::new();
            }
            cur_path = line.trim_start_matches("worktree ").trim().to_string();
        } else if line.starts_with("HEAD ") {
            cur_hash = line.trim_start_matches("HEAD ").trim().to_string();
        } else if line.starts_with("branch ") {
            cur_branch = line.trim_start_matches("branch ").trim().to_string();
        }
    }

    if !cur_path.is_empty() {
        worktrees.push(WorktreeInfo {
            path: cur_path,
            branch: cur_branch,
            commit_hash: cur_hash,
        });
    }

    Ok(worktrees)
}
