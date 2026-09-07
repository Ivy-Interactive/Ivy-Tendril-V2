use crate::error::{Result, TendrilError};
use crate::models::PlanStatus;
use crate::plans::reader::read_plan_yaml;
use crate::plans::writer::write_plan_yaml;
use chrono::Utc;
use std::collections::HashSet;
use std::path::Path;
use std::process::Command;

pub struct DependencyCheckResult {
    pub ok: bool,
    pub block_reason: Option<String>,
}

/// Resolves a PR URL to its GitHub state (`MERGED`, `OPEN`, …). Injectable so the gate can be
/// tested without invoking `gh` or touching the network.
pub type PrStateResolver<'a> = &'a dyn Fn(&str) -> Result<String>;

/// Runs the dependency gate using the real `gh` CLI to resolve PR states.
pub fn check_dependencies(plan_folder: &Path, plans_dir: &Path) -> Result<DependencyCheckResult> {
    check_dependencies_with(plan_folder, plans_dir, &get_gh_pr_state)
}

/// Decides whether `plan_folder` may execute.
///
/// A dependency is satisfied when its folder exists, its state is `Completed`, and every PR it
/// records has been merged. A `Completed` dependency with no PRs is satisfied (commit-only plans).
///
/// Resolver failures are reported as a block, never as an `Err`: GitHub being unreachable must not
/// turn into "starting a job failed". The only `Err` this returns is an unreadable `plan.yaml` for
/// the plan being gated.
pub fn check_dependencies_with(
    plan_folder: &Path,
    plans_dir: &Path,
    resolve_pr_state: PrStateResolver,
) -> Result<DependencyCheckResult> {
    let (plan, _) = read_plan_yaml(plan_folder)?;
    if plan.depends_on.is_empty() {
        return Ok(ok_result());
    }

    let root = folder_name(plan_folder);
    if let Some(cycle) = find_cycle(plans_dir, &root) {
        return Ok(blocked(format!(
            "Dependency cycle detected: {}",
            cycle.join(" -> ")
        )));
    }

    for dep in &plan.depends_on {
        let dep_folder = plans_dir.join(dep);
        if !dep_folder.exists() {
            return Ok(blocked(format!(
                "Dependency plan folder '{}' does not exist",
                dep
            )));
        }

        let (dep_plan, _) = read_plan_yaml(&dep_folder)?;
        let dep_state = PlanStatus::from_str_loose(&dep_plan.state);

        if dep_state != Some(PlanStatus::Completed) {
            return Ok(blocked(format!(
                "Dependency '{}' is in state '{}', not Completed",
                dep, dep_plan.state
            )));
        }

        for pr_url in &dep_plan.prs {
            if !pr_url.contains("/pull/") {
                continue;
            }
            let pr_state = match resolve_pr_state(pr_url) {
                Ok(state) => state,
                Err(e) => {
                    return Ok(blocked(format!(
                        "Could not determine PR state for {}: {}",
                        pr_url, e
                    )));
                }
            };
            if !pr_state.eq_ignore_ascii_case("MERGED") {
                return Ok(blocked(format!(
                    "Dependency '{}' PR {} is in state '{}', not MERGED",
                    dep, pr_url, pr_state
                )));
            }
        }
    }

    Ok(ok_result())
}

/// Re-runs the gate for every plan currently in `Blocked` and moves the satisfied ones back to
/// `Draft`. Returns the folder names that were unblocked. Idempotent.
pub fn unblock_satisfied_plans(plans_dir: &Path) -> Result<Vec<String>> {
    unblock_satisfied_plans_with(plans_dir, &get_gh_pr_state)
}

/// [`unblock_satisfied_plans`] with an injectable PR-state resolver.
pub fn unblock_satisfied_plans_with(
    plans_dir: &Path,
    resolve_pr_state: PrStateResolver,
) -> Result<Vec<String>> {
    let mut unblocked = Vec::new();
    if !plans_dir.exists() {
        return Ok(unblocked);
    }

    for entry in std::fs::read_dir(plans_dir)?.flatten() {
        let folder = entry.path();
        if !folder.is_dir() || !folder.join("plan.yaml").exists() {
            continue;
        }

        let (mut plan, _) = match read_plan_yaml(&folder) {
            Ok(p) => p,
            Err(_) => continue,
        };
        if PlanStatus::from_str_loose(&plan.state) != Some(PlanStatus::Blocked) {
            continue;
        }

        if let Ok(res) = check_dependencies_with(&folder, plans_dir, resolve_pr_state) {
            if res.ok {
                plan.state = PlanStatus::Draft.to_string();
                plan.updated = Utc::now();
                if write_plan_yaml(&folder, &plan).is_ok() {
                    unblocked.push(folder_name(&folder));
                }
            }
        }
    }

    unblocked.sort();
    Ok(unblocked)
}

fn ok_result() -> DependencyCheckResult {
    DependencyCheckResult {
        ok: true,
        block_reason: None,
    }
}

fn blocked(reason: String) -> DependencyCheckResult {
    DependencyCheckResult {
        ok: false,
        block_reason: Some(reason),
    }
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string()
}

/// Depth-first walk of the `dependsOn` graph from `root`, returning the cycle path (e.g.
/// `["A", "B", "A"]`) when one is reachable. `path` is the gray set and `visited` the black set, so
/// a diamond-shaped graph is not mistaken for a cycle.
fn find_cycle(plans_dir: &Path, root: &str) -> Option<Vec<String>> {
    let mut path = Vec::new();
    let mut visited = HashSet::new();
    walk_for_cycle(plans_dir, root, &mut path, &mut visited)
}

fn walk_for_cycle(
    plans_dir: &Path,
    node: &str,
    path: &mut Vec<String>,
    visited: &mut HashSet<String>,
) -> Option<Vec<String>> {
    if let Some(pos) = path.iter().position(|p| p == node) {
        let mut cycle = path[pos..].to_vec();
        cycle.push(node.to_string());
        return Some(cycle);
    }
    if visited.contains(node) {
        return None;
    }

    path.push(node.to_string());
    for dep in depends_on_of(plans_dir, node) {
        if let Some(cycle) = walk_for_cycle(plans_dir, &dep, path, visited) {
            return Some(cycle);
        }
    }
    path.pop();
    visited.insert(node.to_string());
    None
}

fn depends_on_of(plans_dir: &Path, folder_name: &str) -> Vec<String> {
    read_plan_yaml(&plans_dir.join(folder_name))
        .map(|(plan, _)| plan.depends_on)
        .unwrap_or_default()
}

/// Resolves a PR URL to its state with the `gh` CLI. This is the production [`PrStateResolver`].
pub fn get_gh_pr_state(pr_url: &str) -> Result<String> {
    let output = Command::new("gh")
        .args(["pr", "view", pr_url, "--json", "state", "-q", ".state"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let state = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(state)
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(TendrilError::Git(format!(
                "gh pr view failed for {}: {}",
                pr_url, err
            )))
        }
        Err(e) => Err(TendrilError::Git(format!("Failed to run gh CLI: {}", e))),
    }
}
