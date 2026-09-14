//! Unattended reclamation of plan worktrees.
//!
//! A `tendril/*` branch is frequently the only ref holding a run's commits, and the next `git gc`
//! makes anything it alone reaches unrecoverable. Every rule here is therefore written so that
//! **doubt means keep**: a plan is reaped only when it is demonstrably finished with, and a branch
//! is deleted only on positive proof that its commits survive elsewhere.

use crate::git::service::run_git;
use crate::git::worktree::{canonical, derive_branch_name, unregister_worktree};
use crate::git::worktree_log::{extract_plan_id, WorktreeLifecycleLog};
use crate::models::PlanStatus;
use crate::plans::dependencies::{get_gh_pr_state, PrStateResolver};
use crate::plans::reader::read_plan_yaml;
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// How a plan's branch is disposed of once its worktree has been removed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchDeleteMode {
    /// Delete the branch only when its tip is reachable from a remote or merged into its base.
    /// Anything else is kept, worktree included. The mode the unattended reaper runs in.
    PreserveUnpushed,
    /// `git branch -D` regardless of what the branch holds.
    Force,
}

impl BranchDeleteMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PreserveUnpushed => "PreserveUnpushed",
            Self::Force => "Force",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "preserveunpushed" => Some(Self::PreserveUnpushed),
            "force" => Some(Self::Force),
            _ => None,
        }
    }
}

impl std::fmt::Display for BranchDeleteMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// What one reaper pass is allowed to do.
#[derive(Debug)]
pub struct ReaperConfig {
    /// How long a plan must have been idle (since `plan.updated`) before it is eligible.
    pub grace: Duration,
    pub mode: BranchDeleteMode,
    pub log: Option<WorktreeLifecycleLog>,
}

/// The outcome of one pass. A skip is the normal, expected case, not a problem.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReapReport {
    /// `<plan folder>/<worktree name>` for each worktree reclaimed.
    pub reclaimed: Vec<String>,
    /// `(target, reason)` for each worktree or plan left alone.
    pub skipped: Vec<(String, String)>,
}

/// What to do with a plan's branch once its worktree is gone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BranchDisposition {
    /// No such branch; nothing to do.
    Absent,
    /// Safe: the commits are reachable from a remote or merged into the base.
    Delete,
    /// Keep the branch. The reason is logged verbatim.
    Keep(String),
}

impl BranchDisposition {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Absent => "absent",
            Self::Delete => "deleted",
            Self::Keep(_) => "kept",
        }
    }
}

/// One pass over every plan folder, resolving PR states with the real `gh` CLI.
pub fn reap_worktrees(plans_dir: &Path, cfg: &ReaperConfig) -> ReapReport {
    reap_worktrees_with(plans_dir, cfg, &get_gh_pr_state)
}

/// [`reap_worktrees`] with an injectable PR-state resolver, so tests never touch the network.
///
/// Never fails for a single bad plan: an unreadable `plan.yaml`, a missing repo or a failing git
/// call is a skip, logged, and the scan continues.
pub fn reap_worktrees_with(
    plans_dir: &Path,
    cfg: &ReaperConfig,
    resolve_pr_state: PrStateResolver,
) -> ReapReport {
    let mut report = ReapReport::default();

    let Ok(entries) = std::fs::read_dir(plans_dir) else {
        return report;
    };

    let mut plan_folders: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir() && p.join("plan.yaml").is_file())
        .collect();
    plan_folders.sort();

    for plan_folder in plan_folders {
        reap_plan(&plan_folder, cfg, resolve_pr_state, &mut report);
    }

    report
}

fn reap_plan(
    plan_folder: &Path,
    cfg: &ReaperConfig,
    resolve_pr_state: PrStateResolver,
    report: &mut ReapReport,
) {
    let name = folder_name(plan_folder);

    if let Err(reason) = plan_is_eligible(plan_folder, cfg, resolve_pr_state) {
        report.skipped.push((name, reason));
        return;
    }

    let plan_id = extract_plan_id(plan_folder);
    let worktrees_dir = plan_folder.join("Worktrees");
    let targets = collect_worktrees(plan_folder);

    for target in targets {
        reap_one(plan_folder, &plan_id, &target, cfg, report);
    }

    // A plan with no worktrees left has no use for the directory that held them.
    if let Ok(mut remaining) = std::fs::read_dir(&worktrees_dir) {
        if remaining.next().is_none() {
            let _ = std::fs::remove_dir(&worktrees_dir);
        }
    }
}

/// One worktree to consider: its path, and the repo/branch it belongs to when those are knowable.
#[derive(Debug)]
struct ReapTarget {
    path: PathBuf,
    repo: Option<PathBuf>,
    branch: Option<String>,
}

fn reap_one(
    plan_folder: &Path,
    plan_id: &str,
    target: &ReapTarget,
    cfg: &ReaperConfig,
    report: &mut ReapReport,
) {
    let label = format!("{}/{}", folder_name(plan_folder), folder_name(&target.path));
    let git_file_exists = target.path.join(".git").is_file();

    if let Some(log) = &cfg.log {
        log.reap_attempt(plan_id, &target.path, "reaper", git_file_exists);
    }

    // No repo to talk to: this is orphaned disk with no branch at risk.
    let (Some(repo), Some(branch)) = (target.repo.as_ref(), target.branch.as_ref()) else {
        match std::fs::remove_dir_all(&target.path) {
            Ok(()) => {
                if let Some(log) = &cfg.log {
                    log.reclaimed(plan_id, &target.path, "orphan");
                }
                let _ = unregister_worktree(plan_folder, &target.path);
                report.reclaimed.push(label);
            }
            Err(e) => {
                if let Some(log) = &cfg.log {
                    log.reap_failed(plan_id, &target.path, &e.to_string());
                }
                report
                    .skipped
                    .push((label, format!("remove failed: {}", e)));
            }
        }
        return;
    };

    // Decide the branch's fate before removing anything: under PreserveUnpushed a branch worth
    // keeping keeps its worktree too, so the work stays exactly where the next run expects it.
    let disposition = branch_disposition(repo, branch, cfg.mode);
    if let BranchDisposition::Keep(reason) = &disposition {
        if let Some(log) = &cfg.log {
            log.reap_skipped(plan_id, &target.path, reason);
        }
        report.skipped.push((label, reason.clone()));
        return;
    }

    let (code, _, stderr) = match run_git(
        &[
            "worktree",
            "remove",
            "--force",
            &target.path.to_string_lossy(),
        ],
        repo,
    ) {
        Ok(res) => res,
        Err(e) => {
            if let Some(log) = &cfg.log {
                log.reap_failed(plan_id, &target.path, &e.to_string());
            }
            report.skipped.push((label, format!("git failed: {}", e)));
            return;
        }
    };
    let _ = run_git(&["worktree", "prune"], repo);

    if target.path.exists() {
        if let Err(e) = std::fs::remove_dir_all(&target.path) {
            let detail = if code == 0 {
                e.to_string()
            } else {
                format!("git worktree remove said: {}; {}", stderr.trim(), e)
            };
            if let Some(log) = &cfg.log {
                log.reap_failed(plan_id, &target.path, &detail);
            }
            report
                .skipped
                .push((label, format!("remove failed: {}", detail)));
            return;
        }
    }

    // git refuses to delete a branch checked out in a live worktree, so this has to come last.
    if disposition == BranchDisposition::Delete {
        if let Ok((del_code, _, del_err)) = run_git(&["branch", "-D", branch], repo) {
            if del_code != 0 {
                tracing::warn!(
                    "Failed to delete branch {} in {}: {}",
                    branch,
                    repo.display(),
                    del_err.trim()
                );
            }
        }
    }

    let _ = unregister_worktree(plan_folder, &target.path);
    if let Some(log) = &cfg.log {
        log.reclaimed(plan_id, &target.path, disposition.as_str());
    }
    report.reclaimed.push(label);
}

/// Whether a plan may be reaped at all. `Err` carries the reason it may not.
///
/// Four gates, and anything unproven is a refusal: the plan is `Completed` or `Skipped`, a
/// `Completed` plan has at least one merged PR and no unmerged one, every PR state resolved, and the
/// plan has been idle for at least the configured grace period.
fn plan_is_eligible(
    plan_folder: &Path,
    cfg: &ReaperConfig,
    resolve_pr_state: PrStateResolver,
) -> std::result::Result<(), String> {
    let Ok((plan, _)) = read_plan_yaml(plan_folder) else {
        return Err("plan.yaml could not be read".to_string());
    };

    let state = match PlanStatus::from_str_loose(&plan.state) {
        Some(s) => s,
        None => return Err(format!("state '{}' is not a known plan state", plan.state)),
    };

    if !matches!(state, PlanStatus::Completed | PlanStatus::Skipped) {
        return Err(format!("state {} is not terminal", state));
    }

    if state == PlanStatus::Completed {
        let pr_urls: Vec<&String> = plan.prs.iter().filter(|u| u.contains("/pull/")).collect();
        if pr_urls.is_empty() {
            return Err("Completed plan records no pull request".to_string());
        }
        for url in pr_urls {
            match resolve_pr_state(url) {
                Ok(pr_state) if pr_state.eq_ignore_ascii_case("MERGED") => {}
                Ok(pr_state) => {
                    return Err(format!("PR {} is '{}', not MERGED", url, pr_state.trim()));
                }
                // GitHub being unreachable must never authorise a delete.
                Err(e) => return Err(format!("PR state for {} is unknown: {}", url, e)),
            }
        }
    }

    let Ok(grace) = chrono::Duration::from_std(cfg.grace) else {
        return Err("configured grace period is out of range".to_string());
    };
    let idle = Utc::now() - plan.updated;
    if idle < grace {
        return Err(format!(
            "idle for {}s, grace is {}s",
            idle.num_seconds(),
            grace.num_seconds()
        ));
    }

    Ok(())
}

/// The worktrees of an eligible plan: the registry entries that still exist on disk, plus whatever
/// a directory scan turns up (worktrees created before the registry existed, and orphans).
fn collect_worktrees(plan_folder: &Path) -> Vec<ReapTarget> {
    let mut targets: Vec<ReapTarget> = Vec::new();

    if let Ok((plan, _)) = read_plan_yaml(plan_folder) {
        for entry in plan.worktrees.iter().flatten() {
            let path = PathBuf::from(&entry.path);
            if !path.is_dir() {
                continue;
            }
            let repo = PathBuf::from(&entry.repo);
            targets.push(ReapTarget {
                path,
                repo: repo.is_dir().then_some(repo),
                branch: Some(entry.branch.clone()),
            });
        }
    }

    for path in enumerate_worktree_dirs(&plan_folder.join("Worktrees")) {
        if targets
            .iter()
            .any(|t| canonical(&t.path) == canonical(&path))
        {
            continue;
        }
        let repo = repo_root_of(&path);
        let branch = repo.is_some().then(|| derive_branch_name(plan_folder));
        targets.push(ReapTarget { path, repo, branch });
    }

    targets
}

/// Worktree directories under `worktrees_dir`, one nesting level deep (`Worktrees/<repo>` and
/// `Worktrees/<owner>/<repo>` are both in use). A directory that holds no worktree of its own but
/// does hold subdirectories is descended into rather than removed, so a nested layout is never
/// mistaken for one orphan.
fn enumerate_worktree_dirs(worktrees_dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(worktrees_dir) else {
        return found;
    };

    let mut top: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    top.sort();

    for dir in top {
        if dir.join(".git").is_file() {
            found.push(dir);
            continue;
        }

        let mut children: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .collect()
            })
            .unwrap_or_default();
        children.sort();

        if children.is_empty() {
            found.push(dir);
        } else {
            found.extend(children);
        }
    }

    found
}

/// The repo a worktree belongs to, read from its `.git` file: `gitdir:` points at
/// `<repo>/.git/worktrees/<name>`, so the repo root is two levels up from that, then its parent.
fn repo_root_of(worktree_path: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(worktree_path.join(".git")).ok()?;
    let gitdir = content
        .lines()
        .find_map(|l| l.trim().strip_prefix("gitdir:"))?
        .trim();
    if gitdir.is_empty() {
        return None;
    }

    let repo_git_dir = canonical(&PathBuf::from(gitdir).join("..").join(".."));
    let repo_root = repo_git_dir.parent()?.to_path_buf();
    repo_root.is_dir().then_some(repo_root)
}

/// Decides whether a plan's branch can be deleted once its worktree is gone.
///
/// [`BranchDeleteMode::Force`] always yields [`BranchDisposition::Delete`].
/// [`BranchDeleteMode::PreserveUnpushed`] yields `Delete` only on positive proof that the tip
/// survives the branch; every git failure, empty output or unparseable result yields
/// [`BranchDisposition::Keep`], never `Delete`.
pub fn branch_disposition(
    repo_root: &Path,
    branch: &str,
    mode: BranchDeleteMode,
) -> BranchDisposition {
    if mode == BranchDeleteMode::Force {
        return BranchDisposition::Delete;
    }

    let tip_ref = format!("refs/heads/{}", branch);
    let tip = match run_git(&["rev-parse", "--verify", "--quiet", &tip_ref], repo_root) {
        Ok((code, stdout, _)) => {
            let tip = stdout.trim().to_string();
            if code != 0 || tip.is_empty() {
                return BranchDisposition::Absent;
            }
            tip
        }
        // git itself could not be run: we know nothing, so we touch nothing.
        Err(_) => return BranchDisposition::Keep("could not resolve branch tip".to_string()),
    };

    // A pure read, unlike `git branch -d`, which is what makes this decision testable.
    if let Ok((code, stdout, _)) = run_git(&["branch", "-r", "--contains", &tip], repo_root) {
        if code == 0 && !stdout.trim().is_empty() {
            return BranchDisposition::Delete;
        }
    }

    for base_ref in base_refs(repo_root, branch) {
        if let Ok((code, _, _)) =
            run_git(&["merge-base", "--is-ancestor", &tip, &base_ref], repo_root)
        {
            if code == 0 {
                return BranchDisposition::Delete;
            }
        }
    }

    BranchDisposition::Keep(format!(
        "branch {} ({}) holds commits that are on no remote and merged into no base; kept so `git gc` cannot destroy them — push it, or delete it manually with `git branch -D`",
        branch,
        shorten(&tip)
    ))
}

/// Refs a branch's commits could already be merged into, in order of preference: its own upstream,
/// the remote's default branch, then `origin/main`. Only refs that actually resolve are returned.
fn base_refs(repo_root: &Path, branch: &str) -> Vec<String> {
    let mut refs = Vec::new();

    if let Ok((code, stdout, _)) = run_git(
        &[
            "rev-parse",
            "--abbrev-ref",
            &format!("{}@{{upstream}}", branch),
        ],
        repo_root,
    ) {
        if code == 0 && !stdout.trim().is_empty() {
            refs.push(stdout.trim().to_string());
        }
    }

    if let Ok((code, stdout, _)) = run_git(&["symbolic-ref", "refs/remotes/origin/HEAD"], repo_root)
    {
        if code == 0 && !stdout.trim().is_empty() {
            refs.push(stdout.trim().to_string());
        }
    }

    refs.push("origin/main".to_string());

    refs.retain(|r| {
        matches!(
            run_git(&["rev-parse", "--verify", "--quiet", r], repo_root),
            Ok((0, ref out, _)) if !out.trim().is_empty()
        )
    });
    refs.dedup();
    refs
}

fn shorten(hash: &str) -> &str {
    if hash.len() > 7 {
        &hash[..7]
    } else {
        hash
    }
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string()
}
