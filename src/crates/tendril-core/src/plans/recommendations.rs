use crate::error::{Result, TendrilError};
use crate::models::{
    canonical_recommendation_impact, Recommendation, RecommendationStatus, RECOMMENDATION_IMPACTS,
};
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

    let impact = match impact.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => Some(canonical_impact(raw)?.to_string()),
        None => None,
    };

    list.push(Recommendation {
        title: title.to_string(),
        description: description.to_string(),
        state: RecommendationStatus::PENDING.to_string(),
        decline_reason: None,
        notes: None,
        impact,
    });

    plan.recommendations = Some(list);
    plan.updated = Utc::now();
    write_plan_yaml(plan_folder, &plan)
}

/// Reads the plan, finds the recommendation `title` (case-insensitively), hands it to `f` along with
/// the titles of its siblings, then bumps `updated` and writes the file back.
///
/// Every write path below goes through here, which is what keeps them from drifting: the lookup
/// rule, the `updated` bump and the not-found error are each defined once.
fn mutate<F>(plan_folder: &Path, title: &str, f: F) -> Result<()>
where
    F: FnOnce(&mut Recommendation, &[String]) -> Result<()>,
{
    let (mut plan, _) = read_plan_yaml(plan_folder)?;
    let mut list = plan.recommendations.unwrap_or_default();

    let index = list
        .iter()
        .position(|r| r.title.eq_ignore_ascii_case(title))
        .ok_or_else(|| TendrilError::Plan(format!("Recommendation '{}' not found", title)))?;

    // The other titles in the plan, so a rename can be checked against them without holding a second
    // borrow of the list.
    let siblings: Vec<String> = list
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != index)
        .map(|(_, r)| r.title.clone())
        .collect();

    f(&mut list[index], &siblings)?;

    plan.recommendations = Some(list);
    plan.updated = Utc::now();
    write_plan_yaml(plan_folder, &plan)
}

fn canonical_impact(value: &str) -> Result<&'static str> {
    canonical_recommendation_impact(value).ok_or_else(|| {
        TendrilError::Plan(format!(
            "Invalid impact '{}'. Valid: {}",
            value,
            RECOMMENDATION_IMPACTS.join(", ")
        ))
    })
}

fn canonical_state(value: &str) -> Result<&'static str> {
    RecommendationStatus::canonical(value).ok_or_else(|| {
        TendrilError::Plan(format!(
            "Invalid recommendation state '{}'. Valid: {}",
            value,
            RecommendationStatus::ALL.join(", ")
        ))
    })
}

fn non_empty(value: &str) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

/// Accepts a recommendation and returns the state it landed in. Notes are what choose that state:
/// absent or blank lands in `Accepted`, any real text lands in `AcceptedWithNotes` and is stored in
/// `notes`. Either way the decline reason is cleared — a recommendation cannot be accepted and still
/// carry a reason for having been declined.
pub fn accept_recommendation(
    plan_folder: &Path,
    title: &str,
    notes: Option<&str>,
) -> Result<&'static str> {
    let notes = notes.map(str::trim).filter(|s| !s.is_empty());
    let state = if notes.is_some() {
        RecommendationStatus::ACCEPTED_WITH_NOTES
    } else {
        RecommendationStatus::ACCEPTED
    };

    mutate(plan_folder, title, |rec, _| {
        rec.state = state.to_string();
        rec.notes = notes.map(|s| s.to_string());
        rec.decline_reason = None;
        Ok(())
    })?;

    Ok(state)
}

/// Declines a recommendation, storing `reason` as the decline reason and clearing any accept notes.
pub fn decline_recommendation(plan_folder: &Path, title: &str, reason: Option<&str>) -> Result<()> {
    let reason = reason.map(str::trim).filter(|s| !s.is_empty());

    mutate(plan_folder, title, |rec, _| {
        rec.state = RecommendationStatus::DECLINED.to_string();
        rec.decline_reason = reason.map(|s| s.to_string());
        rec.notes = None;
        Ok(())
    })
}

/// Edits one field of a recommendation. `field` is matched case-insensitively against
/// `title | description | state | impact | declineReason | notes`; anything else is an error naming
/// the valid set.
pub fn set_recommendation_field(
    plan_folder: &Path,
    title: &str,
    field: &str,
    value: &str,
) -> Result<()> {
    const VALID_FIELDS: &str = "title, description, state, impact, declineReason, notes";

    match field.to_ascii_lowercase().as_str() {
        "title" => {
            let new_title = value.trim();
            if new_title.is_empty() {
                return Err(TendrilError::Plan(
                    "Recommendation title cannot be empty".to_string(),
                ));
            }
            mutate(plan_folder, title, |rec, siblings| {
                // The title is the natural key every route, CLI command and projection row looks the
                // entry up by, so two recommendations in one plan must not share one.
                if siblings.iter().any(|t| t.eq_ignore_ascii_case(new_title)) {
                    return Err(TendrilError::Plan(format!(
                        "Recommendation '{}' already exists",
                        new_title
                    )));
                }
                rec.title = new_title.to_string();
                Ok(())
            })
        }
        "description" => mutate(plan_folder, title, |rec, _| {
            rec.description = value.to_string();
            Ok(())
        }),
        "state" => {
            let state = canonical_state(value.trim())?;
            mutate(plan_folder, title, |rec, _| {
                rec.state = state.to_string();
                // Keep the two reason fields consistent with the state being moved into: notes belong
                // to AcceptedWithNotes, declineReason to Declined, and neither survives a move back
                // to Pending or to a plain Accepted.
                match state {
                    RecommendationStatus::ACCEPTED | RecommendationStatus::PENDING => {
                        rec.notes = None;
                        rec.decline_reason = None;
                    }
                    RecommendationStatus::ACCEPTED_WITH_NOTES => {
                        rec.decline_reason = None;
                    }
                    RecommendationStatus::DECLINED => {
                        rec.notes = None;
                    }
                    _ => {}
                }
                Ok(())
            })
        }
        "impact" => {
            let trimmed = value.trim();
            let impact = if trimmed.is_empty() {
                None
            } else {
                Some(canonical_impact(trimmed)?)
            };
            mutate(plan_folder, title, |rec, _| {
                rec.impact = impact.map(|s| s.to_string());
                Ok(())
            })
        }
        "declinereason" => mutate(plan_folder, title, |rec, _| {
            rec.decline_reason = non_empty(value);
            Ok(())
        }),
        "notes" => mutate(plan_folder, title, |rec, _| {
            rec.notes = non_empty(value);
            Ok(())
        }),
        _ => Err(TendrilError::Plan(format!(
            "Unknown field: {}. Valid: {}",
            field, VALID_FIELDS
        ))),
    }
}

/// Sets a recommendation's state directly, for the `{state, declineReason}` HTTP contract the desktop
/// app already speaks. Accepts and declines are routed through [`accept_recommendation`] /
/// [`decline_recommendation`] so the notes-versus-reason rules hold however the state was reached:
/// `reason` is stored as notes for the accepted states and as the decline reason for `Declined`.
pub fn set_recommendation_state(
    plan_folder: &Path,
    title: &str,
    state: &str,
    reason: Option<&str>,
) -> Result<()> {
    match canonical_state(state)? {
        RecommendationStatus::ACCEPTED => {
            accept_recommendation(plan_folder, title, None)?;
            Ok(())
        }
        RecommendationStatus::ACCEPTED_WITH_NOTES => {
            // An AcceptedWithNotes with nothing to say is a plain Accepted; accept_recommendation
            // decides that from the notes rather than trusting the requested state.
            accept_recommendation(plan_folder, title, reason)?;
            Ok(())
        }
        RecommendationStatus::DECLINED => decline_recommendation(plan_folder, title, reason),
        canonical => mutate(plan_folder, title, |rec, _| {
            rec.state = canonical.to_string();
            rec.notes = None;
            rec.decline_reason = None;
            Ok(())
        }),
    }
}

pub fn remove_recommendation(plan_folder: &Path, title: &str) -> Result<()> {
    let (mut plan, _) = read_plan_yaml(plan_folder)?;
    let mut list = plan.recommendations.unwrap_or_default();

    let initial_len = list.len();
    list.retain(|r| !r.title.eq_ignore_ascii_case(title));

    if list.len() == initial_len {
        return Err(TendrilError::Plan(format!(
            "Recommendation '{}' not found",
            title
        )));
    }

    plan.recommendations = Some(list);
    plan.updated = Utc::now();
    write_plan_yaml(plan_folder, &plan)
}
