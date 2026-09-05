use std::path::Path;
use std::process::Command;
use crate::error::{Result, TendrilError};
use crate::models::PlanStatus;
use crate::plans::reader::read_plan_yaml;

pub struct DependencyCheckResult {
    pub ok: bool,
    pub block_reason: Option<String>,
}

pub fn check_dependencies(plan_folder: &Path, plans_dir: &Path) -> Result<DependencyCheckResult> {
    let (plan, _) = read_plan_yaml(plan_folder)?;
    if plan.depends_on.is_empty() {
        return Ok(DependencyCheckResult { ok: true, block_reason: None });
    }

    for dep in &plan.depends_on {
        let dep_folder = plans_dir.join(dep);
        if !dep_folder.exists() {
            return Ok(DependencyCheckResult {
                ok: false,
                block_reason: Some(format!("Dependency plan folder '{}' does not exist", dep)),
            });
        }

        let (dep_plan, _) = read_plan_yaml(&dep_folder)?;
        let dep_state = PlanStatus::from_str_loose(&dep_plan.state);

        if dep_state != Some(PlanStatus::Completed) {
            return Ok(DependencyCheckResult {
                ok: false,
                block_reason: Some(format!(
                    "Dependency '{}' is in state '{}', not Completed",
                    dep, dep_plan.state
                )),
            });
        }

        // Verify PR status
        for pr_url in &dep_plan.prs {
            if pr_url.contains("/pull/") {
                let pr_state = get_gh_pr_state(pr_url)?;
                if !pr_state.eq_ignore_ascii_case("MERGED") {
                    return Ok(DependencyCheckResult {
                        ok: false,
                        block_reason: Some(format!(
                            "Dependency '{}' PR {} is in state '{}', not MERGED",
                            dep, pr_url, pr_state
                        )),
                    });
                }
            }
        }
    }

    Ok(DependencyCheckResult { ok: true, block_reason: None })
}

fn get_gh_pr_state(pr_url: &str) -> Result<String> {
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
            Err(TendrilError::Git(format!("gh pr view failed for {}: {}", pr_url, err)))
        }
        Err(e) => Err(TendrilError::Git(format!("Failed to run gh CLI: {}", e))),
    }
}
