use crate::error::{Result, TendrilError};
use crate::models::{Recommendation, RecommendationStatus};
use crate::plans::reader::read_plan_yaml;
use crate::plans::writer::write_plan_yaml;
use chrono::Utc;
use std::path::Path;

pub fn list_recommendations(plan_folder: &Path) -> Result<Vec<Recommendation>> {
    let (plan, _) = read_plan_yaml(plan_folder)?;
    Ok(plan.recommendations.unwrap_or_default())
}

pub fn add_recommendation(
    plan_folder: &Path,
    title: &str,
    description: &str,
    impact: Option<&str>,
) -> Result<()> {
    let (mut plan, _) = read_plan_yaml(plan_folder)?;
    let mut list = plan.recommendations.unwrap_or_default();

    if list.iter().any(|r| r.title.eq_ignore_ascii_case(title)) {
        return Err(TendrilError::Plan(format!(
            "Recommendation '{}' already exists",
            title
        )));
    }

    list.push(Recommendation {
        title: title.to_string(),
        description: description.to_string(),
        state: RecommendationStatus::PENDING.to_string(),
        decline_reason: None,
        impact: impact.map(|s| s.to_string()),
    });

    plan.recommendations = Some(list);
    plan.updated = Utc::now();
    write_plan_yaml(plan_folder, &plan)
}

pub fn set_recommendation_state(
    plan_folder: &Path,
    title: &str,
    state: &str,
    decline_reason: Option<&str>,
) -> Result<()> {
    let (mut plan, _) = read_plan_yaml(plan_folder)?;
    let mut list = plan.recommendations.unwrap_or_default();

    let rec = list
        .iter_mut()
        .find(|r| r.title.eq_ignore_ascii_case(title))
        .ok_or_else(|| TendrilError::Plan(format!("Recommendation '{}' not found", title)))?;

    rec.state = state.to_string();
    if let Some(reason) = decline_reason {
        rec.decline_reason = Some(reason.to_string());
    }

    plan.recommendations = Some(list);
    plan.updated = Utc::now();
    write_plan_yaml(plan_folder, &plan)
}
