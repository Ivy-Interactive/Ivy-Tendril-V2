use crate::error::{Result, TendrilError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub commit_hash: String,
}

/// The branch a worktree was cut from and the commit where it diverged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeBaseInfo {
    pub branch: String,
    pub commit_hash: String,
}

/// Whether a commit a plan recorded is still held alive by a ref in the repo it was made in.
/// Once a plan's worktree and branch are gone, its commits can survive as nothing but loose
/// objects, which the next `git gc` in that repo prunes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommitRefStatus {
    /// Some ref — a branch, a remote-tracking branch or a tag — contains the commit.
    Reachable,
    /// The commit object exists, but no ref reaches it. It is one `git gc` from gone.
    Unreachable,
    /// The commit object is not in the repo at all.
    Missing,
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
        return Err(TendrilError::Git(format!(
            "get_commit_title failed: {}",
            stderr
        )));
    }
    Ok(stdout.lines().next().unwrap_or("").to_string())
}

pub fn get_commit_diff(repo_path: &Path, commit_hash: &str) -> Result<String> {
    let (code, stdout, stderr) =
        run_git(&["show", "--format=", "--patch", commit_hash], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!(
            "get_commit_diff failed: {}",
            stderr
        )));
    }
    Ok(stdout)
}

pub fn get_commit_files(repo_path: &Path, commit_hash: &str) -> Result<Vec<(String, String)>> {
    let (code, stdout, stderr) = run_git(
        &[
            "diff-tree",
            "--no-commit-id",
            "--name-status",
            "-r",
            commit_hash,
        ],
        repo_path,
    )?;
    if code != 0 {
        return Err(TendrilError::Git(format!(
            "get_commit_files failed: {}",
            stderr
        )));
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

pub fn get_combined_diff(
    repo_path: &Path,
    first_commit: &str,
    last_commit: &str,
) -> Result<String> {
    let range = format!("{}^..{}", first_commit, last_commit);
    let (code, stdout, stderr) = run_git(&["diff", &range], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!(
            "get_combined_diff failed: {}",
            stderr
        )));
    }
    Ok(stdout)
}

/// Number of files a commit touched, for the commit rows the Git tab renders.
pub fn get_commit_file_count(repo_path: &Path, commit_hash: &str) -> Result<usize> {
    Ok(get_commit_files(repo_path, commit_hash)?.len())
}

/// Whether the working tree has any modified, staged or untracked files.
pub fn has_uncommitted_changes(repo_path: &Path) -> Result<bool> {
    let (code, stdout, stderr) = run_git(&["status", "--porcelain"], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!(
            "has_uncommitted_changes failed: {}",
            stderr
        )));
    }
    Ok(!stdout.trim().is_empty())
}

/// Which of `candidate_hashes` are ancestors of `repo_path`'s HEAD.
///
/// This is the question "does this worktree account for the commit", which is what groups a plan's
/// commits under the worktree that made them. It is not the question
/// [`get_commit_ref_status`] answers.
pub fn get_reachable_commits(repo_path: &Path, candidate_hashes: &[String]) -> Result<Vec<String>> {
    if candidate_hashes.is_empty() {
        return Ok(Vec::new());
    }

    let mut reachable = Vec::new();
    for hash in candidate_hashes {
        let (code, _, _) = run_git(&["merge-base", "--is-ancestor", hash, "HEAD"], repo_path)?;
        if code == 0 {
            reachable.push(hash.clone());
        }
    }
    Ok(reachable)
}

/// Classifies each commit as reachable from a ref, unreachable (a loose object the next `git gc`
/// prunes), or absent from this repo.
///
/// Unlike [`get_reachable_commits`], which asks whether a commit is an ancestor of one worktree's
/// HEAD, this asks whether *anything at all* still holds the commit.
pub fn get_commit_ref_status(
    repo_path: &Path,
    commit_hashes: &[String],
) -> Result<HashMap<String, CommitRefStatus>> {
    let mut statuses = HashMap::new();

    for hash in commit_hashes {
        if statuses.contains_key(hash) {
            continue;
        }

        let (exists_code, _, _) = run_git(
            &["cat-file", "-e", &format!("{}^{{commit}}", hash)],
            repo_path,
        )?;
        if exists_code != 0 {
            statuses.insert(hash.clone(), CommitRefStatus::Missing);
            continue;
        }

        let (refs_code, refs_stdout, _) = run_git(
            &[
                "for-each-ref",
                "--count=1",
                &format!("--contains={}", hash),
                "--format=%(refname)",
            ],
            repo_path,
        )?;

        // A non-zero exit means the question could not be answered (an old git without
        // --contains, a timeout). Report Reachable rather than raise a false alarm about work
        // being one `git gc` from destruction.
        let status = if refs_code != 0 || !refs_stdout.trim().is_empty() {
            CommitRefStatus::Reachable
        } else {
            CommitRefStatus::Unreachable
        };
        statuses.insert(hash.clone(), status);
    }

    Ok(statuses)
}

/// The upstream branch of `repo_path`'s HEAD and the commit it forked from, or `None` when HEAD has
/// no upstream (a branch that was never pushed, or a detached HEAD).
pub fn get_worktree_base(repo_path: &Path) -> Result<Option<WorktreeBaseInfo>> {
    let (upstream_code, upstream_stdout, _) =
        run_git(&["rev-parse", "--abbrev-ref", "@{u}"], repo_path)?;
    let upstream = upstream_stdout.trim().to_string();
    if upstream_code != 0 || upstream.is_empty() {
        return Ok(None);
    }

    let (base_code, base_stdout, _) = run_git(&["merge-base", "HEAD", "@{u}"], repo_path)?;
    let fork_point = base_stdout.trim().to_string();
    if base_code != 0 || fork_point.is_empty() {
        return Ok(None);
    }

    Ok(Some(WorktreeBaseInfo {
        branch: upstream,
        commit_hash: fork_point,
    }))
}

pub fn get_worktrees(repo_path: &Path) -> Result<Vec<WorktreeInfo>> {
    let (code, stdout, stderr) = run_git(&["worktree", "list", "--porcelain"], repo_path)?;
    if code != 0 {
        return Err(TendrilError::Git(format!(
            "get_worktrees failed: {}",
            stderr
        )));
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
