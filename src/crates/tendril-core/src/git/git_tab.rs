//! The git state behind a plan's Git tab: one section per surviving worktree, the plan's commits
//! grouped under the worktree that made them, and a reachability verdict for the commits no
//! worktree accounts for.
//!
//! The verdict is the point of this module. A plan's worktree and branch are removed once its PR
//! merges, and from then on its commits are held alive only by whatever ref the merge left behind.
//! When nothing holds one, it survives as a loose object that the next `git gc` in the repo
//! destroys — silently, and with no other place in the UI that would say so.

use crate::git::service::{
    get_commit_file_count, get_commit_ref_status, get_commit_title, get_reachable_commits,
    get_worktree_base, get_worktrees, has_uncommitted_changes, CommitRefStatus,
};
use crate::git::worktree::{enumerate_worktree_directories, resolve_repo_root};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// One of the plan's recorded commits, resolved against a repo that still holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    pub hash: String,
    pub short_hash: String,
    /// The commit's subject line, or empty when no repo could resolve the hash.
    pub title: String,
    /// Files the commit touched, or `None` when no repo could resolve the hash.
    pub file_count: Option<usize>,
}

/// A worktree the plan still has on disk, and the commits reachable from its HEAD.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSection {
    /// The worktree directory's own name, which is the repo's name.
    pub name: String,
    pub path: String,
    /// HEAD's branch with the `refs/heads/` prefix stripped, or empty for a detached HEAD.
    pub branch: String,
    pub short_hash: String,
    pub has_uncommitted_changes: bool,
    pub commits: Vec<CommitRow>,
    /// The main repository this worktree belongs to.
    pub parent_repo_path: Option<String>,
    /// The branch the worktree was cut from, `origin/` stripped.
    pub base_branch: Option<String>,
    pub base_short_hash: Option<String>,
}

/// Everything the Git tab renders for one plan.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanGitData {
    pub worktrees: Vec<WorktreeSection>,
    /// Recorded commits that no surviving worktree accounts for.
    pub unassociated_commits: Vec<CommitRow>,
    /// Ref status for the unassociated commits only, keyed by full hash. Commits listed under a
    /// worktree section are ancestors of that worktree's HEAD and so reachable by definition; the
    /// unassociated ones are those no surviving worktree accounts for, which is exactly where a
    /// commit can turn out to be reachable from nothing at all.
    pub unassociated_commit_ref_status: HashMap<String, CommitRefStatus>,
}

impl PlanGitData {
    /// Number of git items behind the tab: worktrees plus recorded commits. Zero means there is
    /// nothing to show.
    pub fn item_count(&self, recorded_commits: usize) -> usize {
        self.worktrees.len() + recorded_commits
    }

    /// The unassociated commits that are one `git gc` from destruction, in recorded order.
    pub fn commits_at_risk(&self) -> Vec<&CommitRow> {
        self.unassociated_commits
            .iter()
            .filter(|row| {
                matches!(
                    self.unassociated_commit_ref_status.get(&row.hash),
                    Some(CommitRefStatus::Unreachable) | Some(CommitRefStatus::Missing)
                )
            })
            .collect()
    }
}

/// Builds the Git tab's data for a plan.
///
/// `repo_paths` are the plan's effective repos — the main repositories, not its worktrees. Every
/// git question is asked of each of them in turn, because a commit lives in exactly one repo of a
/// multi-repo plan and a repo that has never heard of it must not mask the repo that has.
///
/// Nothing here fails the whole call: a repo that has been moved away, or a worktree directory git
/// no longer knows about, contributes no answer instead of an error. The caller is a read-only UI
/// endpoint, and a plan whose repo is temporarily unmounted must still render.
pub fn build_plan_git_data(
    plan_folder: &Path,
    commits: &[String],
    repo_paths: &[PathBuf],
) -> PlanGitData {
    let all_rows = build_commit_rows(commits, repo_paths);

    let mut worktrees = Vec::new();
    let mut assigned: Vec<String> = Vec::new();
    let worktrees_dir = plan_folder.join("Worktrees");

    if worktrees_dir.is_dir() {
        for repo_dir in enumerate_worktree_directories(&worktrees_dir) {
            if let Some(section) = build_section(&repo_dir, &all_rows, &mut assigned) {
                worktrees.push(section);
            }
        }
    }

    let unassociated_commits: Vec<CommitRow> = all_rows
        .into_iter()
        .filter(|row| !assigned.iter().any(|h| h.eq_ignore_ascii_case(&row.hash)))
        .collect();

    let unassociated_commit_ref_status = resolve_ref_status(&unassociated_commits, repo_paths);

    PlanGitData {
        worktrees,
        unassociated_commits,
        unassociated_commit_ref_status,
    }
}

/// Resolves each recorded commit's subject and file count against the first repo that holds it.
/// A commit no repo holds still gets a row — an unresolvable hash is itself worth showing.
fn build_commit_rows(commits: &[String], repo_paths: &[PathBuf]) -> Vec<CommitRow> {
    commits
        .iter()
        .map(|hash| {
            let mut title = String::new();
            let mut file_count = None;

            for repo in repo_paths {
                if !repo.is_dir() {
                    continue;
                }
                if let Ok(resolved) = get_commit_title(repo, hash) {
                    title = resolved;
                    file_count = get_commit_file_count(repo, hash).ok();
                    break;
                }
            }

            CommitRow {
                hash: hash.clone(),
                short_hash: shorten(hash),
                title,
                file_count,
            }
        })
        .collect()
}

/// Asks each of the plan's repos whether it still holds the given commits, and keeps the best
/// answer per commit: a commit lives in exactly one of a multi-repo plan's repos, so a repo that
/// has never heard of it must not mask the repo that has.
fn resolve_ref_status(
    rows: &[CommitRow],
    repo_paths: &[PathBuf],
) -> HashMap<String, CommitRefStatus> {
    let mut statuses: HashMap<String, CommitRefStatus> = HashMap::new();
    if rows.is_empty() {
        return statuses;
    }

    let hashes: Vec<String> = rows.iter().map(|r| r.hash.clone()).collect();
    for repo in repo_paths {
        if !repo.is_dir() {
            continue;
        }
        let Ok(result) = get_commit_ref_status(repo, &hashes) else {
            continue;
        };

        for (hash, status) in result {
            match statuses.get(&hash) {
                Some(current) if rank(*current) <= rank(status) => {}
                _ => {
                    statuses.insert(hash, status);
                }
            }
        }
    }

    statuses
}

/// Reachable is the most informative answer, Missing the least.
fn rank(status: CommitRefStatus) -> u8 {
    match status {
        CommitRefStatus::Reachable => 0,
        CommitRefStatus::Unreachable => 1,
        CommitRefStatus::Missing => 2,
    }
}

/// Builds one worktree's section, claiming the commits reachable from its HEAD out of the rows not
/// yet claimed by an earlier worktree. Returns `None` when git does not list `repo_dir` as a
/// worktree of itself — a leftover directory with no registration behind it.
fn build_section(
    repo_dir: &Path,
    all_rows: &[CommitRow],
    assigned: &mut Vec<String>,
) -> Option<WorktreeSection> {
    let worktrees = get_worktrees(repo_dir).ok()?;
    let target = canonical(repo_dir);
    let worktree = worktrees
        .iter()
        .find(|w| canonical(Path::new(&w.path)) == target)?;

    let mut commits = Vec::new();
    let candidates: Vec<String> = all_rows
        .iter()
        .filter(|row| !assigned.iter().any(|h| h.eq_ignore_ascii_case(&row.hash)))
        .map(|row| row.hash.clone())
        .collect();

    if let Ok(reachable) = get_reachable_commits(repo_dir, &candidates) {
        for row in all_rows {
            if reachable.iter().any(|h| h.eq_ignore_ascii_case(&row.hash)) {
                assigned.push(row.hash.clone());
                commits.push(row.clone());
            }
        }
    }

    let (parent_repo_path, base_branch, base_short_hash) =
        resolve_parent_info(repo_dir, &worktrees);

    Some(WorktreeSection {
        name: repo_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("repo")
            .to_string(),
        path: repo_dir.to_string_lossy().to_string(),
        branch: strip_prefix(&worktree.branch, "refs/heads/"),
        short_hash: shorten(&worktree.commit_hash),
        has_uncommitted_changes: has_uncommitted_changes(repo_dir).unwrap_or(false),
        commits,
        parent_repo_path,
        base_branch,
        base_short_hash,
    })
}

/// The main repository behind a worktree, and the base it was cut from. The upstream branch is the
/// better answer where HEAD has one; the main worktree's own branch is the fallback for a branch
/// that was never pushed.
fn resolve_parent_info(
    repo_dir: &Path,
    worktrees: &[crate::git::service::WorktreeInfo],
) -> (Option<String>, Option<String>, Option<String>) {
    let fallback = resolve_main_worktree_info(repo_dir, worktrees);

    if let Ok(Some(base)) = get_worktree_base(repo_dir) {
        return (
            fallback.0,
            Some(strip_prefix(&base.branch, "origin/")),
            Some(shorten(&base.commit_hash)),
        );
    }

    fallback
}

fn resolve_main_worktree_info(
    repo_dir: &Path,
    worktrees: &[crate::git::service::WorktreeInfo],
) -> (Option<String>, Option<String>, Option<String>) {
    let target = canonical(repo_dir);

    // `git worktree list` run inside a worktree lists its siblings and the main checkout, so the
    // first entry that is not this directory is the repo this worktree came from.
    if let Some(main) = worktrees
        .iter()
        .find(|w| canonical(Path::new(&w.path)) != target)
    {
        return (
            Some(main.path.clone()),
            Some(strip_prefix(&main.branch, "refs/heads/")),
            Some(shorten(&main.commit_hash)),
        );
    }

    let Some(root) = resolve_repo_root(repo_dir) else {
        return (None, None, None);
    };

    let Ok(parent_worktrees) = get_worktrees(&root) else {
        return (Some(root.to_string_lossy().to_string()), None, None);
    };

    let root_target = canonical(&root);
    match parent_worktrees
        .iter()
        .find(|w| canonical(Path::new(&w.path)) == root_target)
    {
        Some(main) => (
            Some(root.to_string_lossy().to_string()),
            Some(strip_prefix(&main.branch, "refs/heads/")),
            Some(shorten(&main.commit_hash)),
        ),
        None => (Some(root.to_string_lossy().to_string()), None, None),
    }
}

fn shorten(hash: &str) -> String {
    if hash.len() > 7 {
        hash[..7].to_string()
    } else {
        hash.to_string()
    }
}

fn strip_prefix(value: &str, prefix: &str) -> String {
    value.strip_prefix(prefix).unwrap_or(value).to_string()
}

/// Fully resolved form of a path, for comparing two spellings of the same directory. Falls back to
/// the path as given when it no longer exists (macOS `/var` → `/private/var` is the common case).
fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}
