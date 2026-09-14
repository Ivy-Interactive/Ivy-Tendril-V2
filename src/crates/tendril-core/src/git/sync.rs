//! Synchronous per-repo base-branch fast-forward, behind `tendril project sync`.
//!
//! This is the non-agent path an operator runs before starting work: it only ever fast-forwards,
//! and refuses (rather than reconciling) anything that would need a judgement call — a dirty tree,
//! a checked-out feature branch, a detached HEAD, diverged history. Those failures are flagged
//! [`ProjectSyncResult::can_fix_with_agent`] so the caller can point a human or an agent at them.
//!
//! The [`crate::jobs`] `SyncRepo` job type is the agent-driven counterpart; this module never
//! spawns anything.

use crate::config::expand_variables;
use crate::git::service::run_git;
use crate::models::{ProjectConfig, RepoRef};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ProjectSyncResult {
    pub success: bool,
    pub message: String,
    pub repo_path: String,
    pub base_branch: Option<String>,
    pub git_error_details: Option<String>,
    /// The failure is one an agent could reconcile (dirty tree, divergence, wrong branch),
    /// as opposed to a missing directory.
    pub can_fix_with_agent: bool,
}

/// A git invocation that cannot fail the caller: a spawn error becomes exit `-1` with the error as
/// stderr, so every check below handles it the same way it handles git's own non-zero exits.
///
/// Deviation from the original C# helper: it passes per-call millisecond timeouts (15s/30s/60s).
/// [`run_git`] has no timeout parameter and adding one would change every existing caller, so a
/// hung `git fetch` hangs the command here — the same as everywhere else in V2 today.
fn git(args: &[&str], repo: &Path) -> (i32, String, String) {
    run_git(args, repo).unwrap_or_else(|e| (-1, String::new(), e.to_string()))
}

/// `refs/remotes/<remote>/HEAD` reduced to its last segment, the same resolution
/// [`crate::git::worktree`] uses when a repo has no configured base branch.
fn resolve_default_branch(repo: &Path, remote: &str) -> Option<String> {
    let head_ref = format!("refs/remotes/{}/HEAD", remote);
    let (code, stdout, _) = git(&["symbolic-ref", &head_ref], repo);
    if code != 0 {
        return None;
    }
    stdout
        .trim()
        .rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
}

/// Fast-forwards one repo's base branch onto its remote tracking branch.
///
/// The checks run in the original's order and return on the first failure, because each one is
/// what makes the next safe: there is no point resolving a branch in a directory that is not a
/// repository, and no point merging into a tree with uncommitted work in it.
pub fn sync_repository(
    repo_path: &str,
    base_branch: Option<&str>,
    tendril_home: &Path,
) -> ProjectSyncResult {
    if repo_path.trim().is_empty() {
        return ProjectSyncResult {
            success: false,
            message: "Repository path is empty".to_string(),
            repo_path: repo_path.to_string(),
            base_branch: None,
            git_error_details: None,
            can_fix_with_agent: false,
        };
    }

    let requested_branch = base_branch.map(str::to_string);
    let expanded = expand_variables(repo_path.trim(), &tendril_home.to_string_lossy());
    let repo = Path::new(&expanded);

    if !repo.is_dir() {
        return ProjectSyncResult {
            success: false,
            message: format!("Repository directory does not exist: {}", expanded),
            repo_path: expanded,
            base_branch: requested_branch,
            git_error_details: None,
            can_fix_with_agent: false,
        };
    }

    // A worktree's `.git` is a file, not a directory, so both shapes count.
    let git_entry = repo.join(".git");
    if !git_entry.is_dir() && !git_entry.is_file() {
        return ProjectSyncResult {
            success: false,
            message: format!("Not a git repository: {}", expanded),
            repo_path: expanded,
            base_branch: requested_branch,
            git_error_details: None,
            can_fix_with_agent: false,
        };
    }

    let (remote_code, remote_out, remote_err) = git(&["remote"], repo);
    if remote_code != 0 || remote_out.trim().is_empty() {
        let details = if remote_err.trim().is_empty() {
            "No remote configured".to_string()
        } else {
            remote_err.trim().to_string()
        };
        return ProjectSyncResult {
            success: false,
            message: "No remote configured for repository".to_string(),
            repo_path: expanded,
            base_branch: requested_branch,
            git_error_details: Some(details),
            can_fix_with_agent: true,
        };
    }

    let remotes: Vec<&str> = remote_out
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let remote = if remotes.iter().any(|r| r.eq_ignore_ascii_case("origin")) {
        "origin"
    } else {
        remotes.first().copied().unwrap_or("origin")
    };

    let (fetch_code, fetch_out, fetch_err) = git(&["fetch", "--prune", remote], repo);
    if fetch_code != 0 {
        let details = if fetch_err.trim().is_empty() {
            fetch_out.trim().to_string()
        } else {
            fetch_err.trim().to_string()
        };
        return ProjectSyncResult {
            success: false,
            message: format!("Failed to fetch from remote '{}': {}", remote, details),
            repo_path: expanded,
            base_branch: requested_branch,
            git_error_details: Some(details),
            can_fix_with_agent: true,
        };
    }

    let target_branch = requested_branch
        .clone()
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty())
        .or_else(|| resolve_default_branch(repo, remote))
        .unwrap_or_else(|| "main".to_string());

    let (branch_code, branch_out, _) = git(&["symbolic-ref", "--short", "HEAD"], repo);
    if branch_code != 0 {
        let (head_code, head_sha, _) = git(&["rev-parse", "--short", "HEAD"], repo);
        let sha = if head_code == 0 {
            head_sha.trim().to_string()
        } else {
            "unknown".to_string()
        };
        return ProjectSyncResult {
            success: false,
            message: format!(
                "HEAD is detached at {}. Expected base branch '{}'",
                sha, target_branch
            ),
            repo_path: expanded,
            base_branch: Some(target_branch),
            git_error_details: Some(format!("HEAD is detached at {}", sha)),
            can_fix_with_agent: true,
        };
    }

    let current_branch = branch_out.trim().to_string();
    if current_branch != target_branch {
        return ProjectSyncResult {
            success: false,
            message: format!(
                "Repository is on branch '{}', expected base branch '{}'",
                current_branch, target_branch
            ),
            repo_path: expanded,
            base_branch: Some(target_branch.clone()),
            git_error_details: Some(format!(
                "Current branch '{}' does not match expected base branch '{}'",
                current_branch, target_branch
            )),
            can_fix_with_agent: true,
        };
    }

    let (status_code, status_out, status_err) = git(&["status", "--porcelain"], repo);
    if status_code != 0 {
        return ProjectSyncResult {
            success: false,
            message: format!("Failed to check git status: {}", status_err.trim()),
            repo_path: expanded,
            base_branch: Some(target_branch),
            git_error_details: Some(status_err.trim().to_string()),
            can_fix_with_agent: true,
        };
    }
    if !status_out.trim().is_empty() {
        return ProjectSyncResult {
            success: false,
            message: "Repository has uncommitted or untracked changes".to_string(),
            repo_path: expanded,
            base_branch: Some(target_branch),
            git_error_details: Some(status_out.trim().to_string()),
            can_fix_with_agent: true,
        };
    }

    let remote_ref = format!("{}/{}", remote, target_branch);
    // One argv element, unquoted: `run_git` takes `&[&str]` and never goes through a shell, so an
    // embedded quote would become part of the refname.
    let tracking_ref = format!("refs/remotes/{}", remote_ref);
    let (rev_code, _, _) = git(&["rev-parse", "--verify", &tracking_ref], repo);
    if rev_code != 0 {
        return ProjectSyncResult {
            success: false,
            message: format!(
                "Remote tracking branch '{}' not found after fetch",
                remote_ref
            ),
            repo_path: expanded,
            base_branch: Some(target_branch),
            git_error_details: Some(format!(
                "Remote tracking branch '{}' does not exist on '{}'",
                remote_ref, remote
            )),
            can_fix_with_agent: true,
        };
    }

    let (head_before_code, head_before, _) = git(&["rev-parse", "HEAD"], repo);
    let (merge_code, merge_out, merge_err) = git(&["merge", "--ff-only", &remote_ref], repo);
    if merge_code != 0 {
        let details = if merge_err.trim().is_empty() {
            merge_out.trim().to_string()
        } else {
            merge_err.trim().to_string()
        };
        return ProjectSyncResult {
            success: false,
            message: format!("Fast-forward merge failed for {}", remote_ref),
            repo_path: expanded,
            base_branch: Some(target_branch),
            git_error_details: Some(details),
            can_fix_with_agent: true,
        };
    }

    let (head_after_code, head_after, _) = git(&["rev-parse", "HEAD"], repo);
    let was_updated =
        head_before_code == 0 && head_after_code == 0 && head_before.trim() != head_after.trim();

    let message = if was_updated {
        format!("Fast-forwarded {} to {}.", target_branch, remote_ref)
    } else {
        "Already up to date.".to_string()
    };

    ProjectSyncResult {
        success: true,
        message,
        repo_path: expanded,
        base_branch: Some(target_branch),
        git_error_details: None,
        can_fix_with_agent: false,
    }
}

/// Trailing separators and backslashes make two spellings of one path compare unequal, so every
/// repo match below goes through this first.
fn normalize_repo_path(path: &str) -> String {
    path.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn final_segment(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Syncs every repo of `project`, in configured order.
///
/// `specific_repo` keeps only the repos whose expanded path, configured path, or final path segment
/// matches it case-insensitively. An unmatched value yields an empty vec, which the CLI reports
/// distinctly from a project that has no repos at all.
pub fn sync_project(
    project: &ProjectConfig,
    specific_repo: Option<&str>,
    tendril_home: &Path,
) -> Vec<ProjectSyncResult> {
    let home = tendril_home.to_string_lossy().to_string();

    let selected: Vec<&RepoRef> = match specific_repo.map(str::trim).filter(|s| !s.is_empty()) {
        Some(target) => {
            let normalized_target = normalize_repo_path(target);
            let expanded_target = normalize_repo_path(&expand_variables(&normalized_target, &home));
            project
                .repos
                .iter()
                .filter(|repo| {
                    let normalized = normalize_repo_path(&repo.path);
                    let expanded = normalize_repo_path(&expand_variables(&normalized, &home));
                    expanded.eq_ignore_ascii_case(&expanded_target)
                        || normalized.eq_ignore_ascii_case(&normalized_target)
                        || final_segment(&expanded).eq_ignore_ascii_case(target)
                        || repo.path.eq_ignore_ascii_case(target)
                })
                .collect()
        }
        None => project.repos.iter().collect(),
    };

    selected
        .into_iter()
        .map(|repo| sync_repository(&repo.path, repo.base_branch.as_deref(), tendril_home))
        .collect()
}

/// The prompt to hand an agent for a failure flagged [`ProjectSyncResult::can_fix_with_agent`].
pub fn diagnostic_prompt(result: &ProjectSyncResult) -> String {
    let branch = result
        .base_branch
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .unwrap_or("default branch");
    let details = result
        .git_error_details
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .unwrap_or("Unknown error");

    format!(
        "The repository at '{}' could not be safely synchronized with remote branch '{}'.\n\
         Issue details:\n\
         {}\n\
         \n\
         Please inspect the repository status, check for uncommitted changes or branch divergence, \
         and help reconcile or update the branch safely without losing any work.",
        result.repo_path, branch, details
    )
}
