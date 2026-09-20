//! The `plan rec` subtree: the follow-up work a review turns up, recorded on the plan it came from.
//!
//! Every mutation here re-projects the plan folder into the database afterwards. The subcommands
//! did none of that before, which is why a CLI edit could leave the `Recommendations` table behind
//! while the server's own routes kept it current.

use super::cli::{PlanEditReasonArgs, PlanRecCommands};
use super::events::{report_edit_with_reason, sync_plan_folder};
use std::path::PathBuf;
use tendril_core::db::{get_recommendations, open_database, rebuild_recommendations_projection};
use tendril_core::models::RecommendationStatus;
use tendril_core::plans::{
    accept_recommendation, add_recommendation, decline_recommendation, list_recommendations,
    remove_recommendation, resolve_plan_folder, set_recommendation_field,
};

/// The `plan rec` subtree.
pub(super) async fn handle(
    rec_cmd: PlanRecCommands,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
    db_path: PathBuf,
) -> anyhow::Result<()> {
    match rec_cmd {
        PlanRecCommands::List { plan_id, state } => {
            let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
            let filter = match state.as_deref() {
                Some(raw) => Some(RecommendationStatus::canonical(raw).ok_or_else(|| {
                    anyhow::anyhow!(
                        "Invalid recommendation state: {} (valid: {})",
                        raw,
                        RecommendationStatus::ALL.join(", ")
                    )
                })?),
                None => None,
            };

            for r in list_recommendations(&folder)? {
                if let Some(want) = filter {
                    if !r.state.eq_ignore_ascii_case(want) {
                        continue;
                    }
                }
                println!("[{}] {} - {}", r.state, r.title, r.description);
                if let Some(notes) = &r.notes {
                    println!("    notes: {}", notes);
                }
                if let Some(reason) = &r.decline_reason {
                    println!("    declineReason: {}", reason);
                }
            }
        }
        PlanRecCommands::All { project, state } => {
            // The cross-plan view is the one recommendation read that cannot come from a single
            // plan.yaml, so it reads the projection instead.
            let state = match state.as_deref() {
                Some(raw) => Some(RecommendationStatus::canonical(raw).ok_or_else(|| {
                    anyhow::anyhow!(
                        "Invalid recommendation state: {} (valid: {})",
                        raw,
                        RecommendationStatus::ALL.join(", ")
                    )
                })?),
                None => None,
            };

            let conn = open_database(&db_path)?;
            let rows = get_recommendations(&conn, project.as_deref(), state)?;
            for row in &rows {
                let impact = row.impact.as_deref().unwrap_or("-");
                println!(
                    "[{}] {} / {} — {}",
                    row.state, row.plan_folder_name, row.title, impact
                );
            }
            if rows.is_empty() {
                println!("No recommendations.");
            }
        }
        PlanRecCommands::Rebuild => {
            let conn = open_database(&db_path)?;
            let (rows, plans) = rebuild_recommendations_projection(&conn, &plans_dir)?;
            println!("Rebuilt {} recommendation rows from {} plans.", rows, plans);
        }
        PlanRecCommands::Add {
            plan_id,
            title,
            description,
            impact,
            edit,
        } => {
            let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
            add_recommendation(&folder, &title, &description, impact.as_deref())?;
            println!("Recommendation added.");
            sync_plan_folder(&folder, &db_path);
            report_edit_with_reason(
                tendril_home,
                &plan_id,
                &format!("recommendation '{}' added", title),
                &edit,
            )
            .await;
        }
        PlanRecCommands::Set {
            plan_id,
            title,
            field,
            value,
            edit,
        } => {
            let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
            set_recommendation_field(&folder, &title, &field, &value)?;
            println!("Recommendation updated.");
            sync_plan_folder(&folder, &db_path);
            report_edit_with_reason(
                tendril_home,
                &plan_id,
                &format!("recommendation '{}' field '{}' updated", title, field),
                &edit,
            )
            .await;
        }
        PlanRecCommands::Accept {
            plan_id,
            title,
            notes,
            edit,
        } => {
            let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
            let new_state = accept_recommendation(&folder, &title, notes.as_deref())?;
            if new_state == RecommendationStatus::ACCEPTED_WITH_NOTES {
                println!("Recommendation accepted with notes.");
            } else {
                println!("Recommendation accepted.");
            }
            sync_plan_folder(&folder, &db_path);
            report_edit_with_reason(
                tendril_home,
                &plan_id,
                &format!("recommendation '{}' set to {}", title, new_state),
                &edit,
            )
            .await;
        }
        PlanRecCommands::Decline {
            plan_id,
            title,
            reason,
            edit_reason,
            chat_session,
        } => {
            let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
            decline_recommendation(&folder, &title, reason.as_deref())?;
            println!("Recommendation declined.");
            sync_plan_folder(&folder, &db_path);
            report_edit_with_reason(
                tendril_home,
                &plan_id,
                &format!("recommendation '{}' declined", title),
                &PlanEditReasonArgs {
                    reason: edit_reason,
                    chat_session,
                },
            )
            .await;
        }
        PlanRecCommands::Remove {
            plan_id,
            title,
            edit,
        } => {
            let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
            remove_recommendation(&folder, &title)?;
            println!("Recommendation removed.");
            sync_plan_folder(&folder, &db_path);
            report_edit_with_reason(
                tendril_home,
                &plan_id,
                &format!("recommendation '{}' removed", title),
                &edit,
            )
            .await;
        }
    }

    Ok(())
}
