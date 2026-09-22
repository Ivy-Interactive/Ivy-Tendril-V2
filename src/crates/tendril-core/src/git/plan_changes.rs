//! Git changes/diff behind a plan's Changes tab.

use crate::git::service::{get_combined_diff, get_commit_diff, run_git};
use crate::git::worktree::enumerate_worktree_directories;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// A single changed file in a plan's git diff.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub file_path: String,
    pub diff: String,
    pub additions: usize,
    pub deletions: usize,
}

/// The collection of changed files and summary metrics for a plan.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChangesData {
    pub files: Vec<ChangedFile>,
    pub raw_diff: String,
    pub total_additions: usize,
    pub total_deletions: usize,
    pub repository: Option<String>,
}

/// Builds the Changes tab data for a plan by inspecting its commits across configured repos,
/// falling back to surviving worktrees.
pub fn build_plan_changes_data(
    plan_folder: &Path,
    commits: &[String],
    repo_paths: &[PathBuf],
) -> PlanChangesData {
    // 1. Try commits across repo_paths
    for repo in repo_paths {
        if !repo.is_dir() {
            continue;
        }
        if let Some(diff) = get_diff_from_commits(repo, commits) {
            return make_plan_changes(diff, Some(repo.to_string_lossy().to_string()));
        }
    }

    // 2. Fall back to worktrees directory in plan_folder
    let worktrees_dir = plan_folder.join("Worktrees");
    if worktrees_dir.is_dir() {
        for worktree in enumerate_worktree_directories(&worktrees_dir) {
            // First try commits in worktree
            if let Some(diff) = get_diff_from_commits(&worktree, commits) {
                return make_plan_changes(diff, Some(worktree.to_string_lossy().to_string()));
            }
            // If no commits or diff was empty, check working tree diff (git diff HEAD or git diff)
            if let Ok((code, stdout, _)) = run_git(&["diff", "HEAD"], &worktree) {
                if code == 0 && !stdout.trim().is_empty() {
                    return make_plan_changes(stdout, Some(worktree.to_string_lossy().to_string()));
                }
            }
            if let Ok((code, stdout, _)) = run_git(&["diff"], &worktree) {
                if code == 0 && !stdout.trim().is_empty() {
                    return make_plan_changes(stdout, Some(worktree.to_string_lossy().to_string()));
                }
            }
        }
    }

    PlanChangesData::default()
}

fn get_diff_from_commits(repo: &Path, commits: &[String]) -> Option<String> {
    if commits.is_empty() {
        return None;
    }
    if commits.len() == 1 {
        get_commit_diff(repo, &commits[0])
            .ok()
            .filter(|d| !d.trim().is_empty())
    } else {
        let first = &commits[0];
        let last = commits.last().unwrap();
        get_combined_diff(repo, first, last)
            .ok()
            .filter(|d| !d.trim().is_empty())
    }
}

fn make_plan_changes(raw_diff: String, repository: Option<String>) -> PlanChangesData {
    let files = parse_git_diff(&raw_diff);
    let total_additions = files.iter().map(|f| f.additions).sum();
    let total_deletions = files.iter().map(|f| f.deletions).sum();
    PlanChangesData {
        files,
        raw_diff,
        total_additions,
        total_deletions,
        repository,
    }
}

/// Parses a raw unified git diff into structured `ChangedFile` records.
pub fn parse_git_diff(raw_diff: &str) -> Vec<ChangedFile> {
    let mut files = Vec::new();
    if raw_diff.trim().is_empty() {
        return files;
    }

    let mut current_file: Option<String> = None;
    let mut current_diff_lines: Vec<&str> = Vec::new();
    let mut current_additions = 0;
    let mut current_deletions = 0;

    let finish_current = |file: Option<String>,
                          lines: Vec<&str>,
                          adds: usize,
                          dels: usize,
                          files: &mut Vec<ChangedFile>| {
        if let Some(path) = file {
            if !lines.is_empty() {
                files.push(ChangedFile {
                    file_path: path,
                    diff: lines.join("\n"),
                    additions: adds,
                    deletions: dels,
                });
            }
        }
    };

    for line in raw_diff.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            finish_current(
                current_file.take(),
                std::mem::take(&mut current_diff_lines),
                current_additions,
                current_deletions,
                &mut files,
            );
            current_additions = 0;
            current_deletions = 0;

            let mut parts = rest.split(" b/");
            let a_part = parts.next().unwrap_or("");
            let b_part = parts.next();

            let file_path = if let Some(b) = b_part {
                b.trim().to_string()
            } else if let Some(a) = a_part.strip_prefix("a/") {
                a.trim().to_string()
            } else {
                rest.trim().to_string()
            };

            current_file = Some(file_path);
            current_diff_lines.push(line);
        } else {
            if line.starts_with('+') && !line.starts_with("+++") {
                current_additions += 1;
            } else if line.starts_with('-') && !line.starts_with("---") {
                current_deletions += 1;
            }
            current_diff_lines.push(line);
        }
    }

    finish_current(
        current_file,
        current_diff_lines,
        current_additions,
        current_deletions,
        &mut files,
    );
    files
}
