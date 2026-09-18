//! [`leak_guard`](super::leak_guard) for a plan, with its project's configuration applied.
//!
//! Ported from V1's `Services/Wireframes/PlanWireframeGuard.cs`.
//!
//! Every gate calls this one function -- execution finishing, a PR being created, a plan being
//! completed -- so they all give the same answer. That matters: a plan that passed the check at
//! execution and failed it at PR time, or the reverse, would be maddening.

use std::path::Path;

use crate::models::project::ProjectConfig;
use crate::wireframes::leak_guard::{self, WireframeLeak};

/// The leaks in a plan's changes, with the project's opt-out and base branches applied.
pub fn check(plan_folder: &Path, project: Option<&ProjectConfig>) -> Vec<WireframeLeak> {
    if !plan_folder.is_dir() {
        return Vec::new();
    }

    // The opt-out exists for the repos that are the wireframe tooling itself, where wireframe code
    // in a diff is the product rather than a leak.
    if project.is_some_and(|p| !p.wireframe_guard()) {
        return Vec::new();
    }

    // One base branch for the whole scan. V1 resolves it per repo root; every worktree under a plan
    // belongs to the same project, so the first configured base branch is the same answer with less
    // machinery. A repo without one falls back to its detected default branch inside the guard.
    let base_branch = project.and_then(|p| p.repos.iter().find_map(|r| r.base_branch.as_deref()));

    leak_guard::scan(plan_folder, base_branch)
}

/// Why the plan may not move on, or `None` when its changes carry no wireframe code.
pub fn block_reason(plan_folder: &Path, project: Option<&ProjectConfig>) -> Option<String> {
    let leaks = check(plan_folder, project);
    if leaks.is_empty() {
        None
    } else {
        Some(leak_guard::describe(&leaks))
    }
}

/// Runs the check and records its outcome, which is what a plan's failure callout shows.
///
/// Writing the report on a clean run too is deliberate: it removes a stale one, so a plan that has
/// been fixed stops showing a failure it already dealt with.
pub fn check_and_report(plan_folder: &Path, project: Option<&ProjectConfig>) -> Vec<WireframeLeak> {
    let leaks = check(plan_folder, project);
    if let Err(e) = leak_guard::write_report(plan_folder, &leaks) {
        tracing::warn!(
            "Could not write the wireframe leak report for {}: {e}",
            plan_folder.display()
        );
    }
    leaks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wireframes::FOLDER_NAME;

    fn plan_with_a_leaking_worktree() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let plan = dir.path().join("00099-Add-Checkout");

        // A wireframe with enough substance to fingerprint.
        let src = plan.join(FOLDER_NAME).join("checkout").join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(
            src.join("App.tsx"),
            "// @tendril-wireframe plan-only\nexport default function App() { return <div />; }\n",
        )
        .unwrap();

        // A worktree whose changed file carries the marker. `changed_files` needs git, so the file
        // is untracked in a real repo below.
        let worktree = plan.join("Worktrees").join("repo");
        std::fs::create_dir_all(worktree.join("src")).unwrap();
        std::fs::write(
            worktree.join("src").join("Login.tsx"),
            "// @tendril-wireframe plan-only\nexport const Login = () => null;\n",
        )
        .unwrap();
        let _ = std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(&worktree)
            .output();

        (dir, plan)
    }

    #[test]
    fn a_leak_is_found_and_reported() {
        let (_g, plan) = plan_with_a_leaking_worktree();
        let leaks = check_and_report(&plan, None);
        assert!(!leaks.is_empty(), "the marker should have been found");
        assert!(leak_guard::report_path(&plan).is_file());
        assert!(block_reason(&plan, None).is_some());
    }

    #[test]
    fn the_project_opt_out_turns_the_whole_check_off() {
        // For the wireframe tooling repos, where this code in a diff is the product.
        let (_g, plan) = plan_with_a_leaking_worktree();
        let project = ProjectConfig {
            wireframe_guard: Some(false),
            ..Default::default()
        };
        assert!(check(&plan, Some(&project)).is_empty());
        assert!(block_reason(&plan, Some(&project)).is_none());
    }

    #[test]
    fn the_guard_is_on_by_default() {
        // A config.yaml written before wireframes existed has neither key, and both must default on.
        let project = ProjectConfig::default();
        // Both must be on for a default-constructed config, not only for a deserialized one:
        // #[derive(Default)] gives false for a bare bool, which would silently disable the guard.
        assert!(project.wireframe_guard());
        assert!(project.wireframes());
    }

    #[test]
    fn a_clean_plan_clears_a_stale_report() {
        let dir = tempfile::tempdir().unwrap();
        let plan = dir.path().to_path_buf();
        std::fs::create_dir_all(plan.join("Verification")).unwrap();
        std::fs::write(leak_guard::report_path(&plan), "# Wireframe Leak\n\nold").unwrap();

        // No worktrees at all, so nothing can leak.
        let leaks = check_and_report(&plan, None);
        assert!(leaks.is_empty());
        assert!(
            !leak_guard::report_path(&plan).exists(),
            "a fixed plan must stop showing a failure it already dealt with"
        );
    }

    #[test]
    fn a_plan_folder_that_does_not_exist_is_not_an_error() {
        let leaks = check(Path::new("/no/such/plan"), None);
        assert!(leaks.is_empty());
    }
}
