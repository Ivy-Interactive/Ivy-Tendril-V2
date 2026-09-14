use crate::error::{Result, TendrilError};
use crate::models::{PlanVerificationEntry, ProjectVerificationRef, VerificationStatus};
use crate::plans::reader::read_plan_yaml;
use crate::plans::writer::write_plan_yaml;
use chrono::Utc;
use std::path::Path;

pub fn list_plan_verifications(plan_folder: &Path) -> Result<Vec<PlanVerificationEntry>> {
    let (plan, _) = read_plan_yaml(plan_folder)?;
    Ok(plan.verifications)
}

/// Orders a plan's verifications by the project's configured order, which is the order they
/// run in (and the reason `CheckResult` ends up last). Entries the project config does not
/// mention keep their relative order at the end — the sort is stable.
pub fn order_by_project_config(
    verifications: &[PlanVerificationEntry],
    project_verifications: Option<&[ProjectVerificationRef]>,
) -> Vec<PlanVerificationEntry> {
    let mut ordered = verifications.to_vec();
    let project = project_verifications.unwrap_or(&[]);

    ordered.sort_by_key(|entry| {
        project
            .iter()
            .position(|p| p.name.eq_ignore_ascii_case(&entry.name))
            .unwrap_or(usize::MAX)
    });

    ordered
}

pub fn set_plan_verification_status(
    plan_folder: &Path,
    name: &str,
    status: VerificationStatus,
) -> Result<PlanVerificationEntry> {
    let (mut plan, _) = read_plan_yaml(plan_folder)?;

    let entry = if let Some(existing) = plan
        .verifications
        .iter_mut()
        .find(|v| v.name.eq_ignore_ascii_case(name))
    {
        existing.status = status;
        existing.clone()
    } else {
        let new_entry = PlanVerificationEntry {
            name: name.to_string(),
            status,
        };
        plan.verifications.push(new_entry.clone());
        new_entry
    };

    plan.updated = Utc::now();
    write_plan_yaml(plan_folder, &plan)?;
    Ok(entry)
}

pub fn add_plan_verification(
    plan_folder: &Path,
    name: &str,
    status: Option<VerificationStatus>,
) -> Result<PlanVerificationEntry> {
    let (mut plan, _) = read_plan_yaml(plan_folder)?;

    if plan
        .verifications
        .iter()
        .any(|v| v.name.eq_ignore_ascii_case(name))
    {
        return Err(TendrilError::Plan(format!(
            "Verification '{}' already exists",
            name
        )));
    }

    let entry = PlanVerificationEntry {
        name: name.to_string(),
        status: status.unwrap_or(VerificationStatus::Pending),
    };
    plan.verifications.push(entry.clone());
    plan.updated = Utc::now();
    write_plan_yaml(plan_folder, &plan)?;
    Ok(entry)
}

pub fn remove_plan_verification(plan_folder: &Path, name: &str) -> Result<()> {
    let (mut plan, _) = read_plan_yaml(plan_folder)?;
    let initial_len = plan.verifications.len();
    plan.verifications
        .retain(|v| !v.name.eq_ignore_ascii_case(name));

    if plan.verifications.len() == initial_len {
        return Err(TendrilError::Plan(format!(
            "Verification '{}' not found",
            name
        )));
    }

    plan.updated = Utc::now();
    write_plan_yaml(plan_folder, &plan)
}

pub fn rename_verification_in_plans(
    plans_dir: &Path,
    old_name: &str,
    new_name: &str,
) -> Result<usize> {
    if !plans_dir.exists() {
        return Ok(0);
    }

    let mut count = 0;
    for entry in std::fs::read_dir(plans_dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let plan_folder = entry.path();
            if let Ok((mut plan, _)) = read_plan_yaml(&plan_folder) {
                let mut modified = false;
                for v in &mut plan.verifications {
                    if v.name.eq_ignore_ascii_case(old_name) {
                        v.name = new_name.to_string();
                        modified = true;
                    }
                }
                if modified {
                    plan.updated = Utc::now();
                    write_plan_yaml(&plan_folder, &plan)?;
                    count += 1;
                }
            }
        }
    }

    Ok(count)
}
