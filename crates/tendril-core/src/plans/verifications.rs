use crate::error::{Result, TendrilError};
use crate::models::{PlanVerificationEntry, VerificationStatus};
use crate::plans::reader::read_plan_yaml;
use crate::plans::writer::write_plan_yaml;
use chrono::Utc;
use std::path::Path;

pub fn list_plan_verifications(plan_folder: &Path) -> Result<Vec<PlanVerificationEntry>> {
    let (plan, _) = read_plan_yaml(plan_folder)?;
    Ok(plan.verifications)
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
