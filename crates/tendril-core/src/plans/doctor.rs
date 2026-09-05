use crate::error::Result;
use crate::plans::reader::read_plan_yaml;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct PlanDoctorIssue {
    pub plan_folder: String,
    pub severity: String, // "Error", "Warning"
    pub message: String,
}

pub fn check_plan_health(plan_folder: &Path) -> Vec<PlanDoctorIssue> {
    let mut issues = Vec::new();
    let folder_name = plan_folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let yaml_path = plan_folder.join("plan.yaml");
    if !yaml_path.exists() {
        issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Error".to_string(),
            message: "Missing plan.yaml".to_string(),
        });
        return issues;
    }

    let plan = match read_plan_yaml(plan_folder) {
        Ok((p, _)) => p,
        Err(e) => {
            issues.push(PlanDoctorIssue {
                plan_folder: folder_name.clone(),
                severity: "Error".to_string(),
                message: format!("Invalid plan.yaml: {}", e),
            });
            return issues;
        }
    };

    if plan.title.trim().is_empty() {
        issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Warning".to_string(),
            message: "Plan has empty title".to_string(),
        });
    }

    let rev_dir = plan_folder.join("Revisions");
    if !rev_dir.exists() {
        issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Warning".to_string(),
            message: "Missing Revisions directory".to_string(),
        });
    }

    issues
}

pub fn check_all_plans_health(plans_dir: &Path) -> Result<Vec<PlanDoctorIssue>> {
    let mut all_issues = Vec::new();

    if plans_dir.exists() {
        for entry in std::fs::read_dir(plans_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let issues = check_plan_health(&entry.path());
                all_issues.extend(issues);
            }
        }
    }

    Ok(all_issues)
}
