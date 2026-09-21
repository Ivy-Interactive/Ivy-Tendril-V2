//! `plan set-verification` and the `plan verification` subtree: the checks a plan has to pass
//! before it can be completed.
//!
//! The add/remove pair validates against the project's configured verification set, so a name with
//! no runnable prompt behind it is refused at the point it is seeded rather than at the point it is
//! run — but tolerantly, since a home with no `config.yaml` has nothing to validate against.

use super::cli::{PlanSetVerificationArgs, PlanVerificationCommands};
use super::events::{
    report_edit_with_reason, report_plan_edit_event, resolve_source_chat_session, sync_plan_folder,
    PlanEditEvent,
};
use std::path::PathBuf;
use tendril_core::config::{get_config_path, load_config};
use tendril_core::models::VerificationStatus;
use tendril_core::plans::{
    add_plan_verification, order_by_project_config, read_plan_yaml, remove_plan_verification,
    resolve_plan_folder, set_plan_verification_status,
};

/// Configured verification names, or `None` when there is no usable config to check against.
fn configured_verification_names(tendril_home: &std::path::Path) -> Option<Vec<String>> {
    let settings = load_config(&get_config_path(tendril_home)).ok()?;
    if settings.verifications.is_empty() {
        // A missing config.yaml loads as `TendrilSettings::default()`, which has no verification
        // definitions at all — that is "nothing configured to check against" too, not "nothing is
        // valid".
        return None;
    }
    Some(settings.verifications.into_iter().map(|v| v.name).collect())
}

/// Rejects a name `plan verification add` would seed with no runnable prompt behind it. A missing
/// config is treated the same tolerant way `plan verification list` treats one: leave it alone
/// rather than block on it.
fn validate_verification_name(tendril_home: &std::path::Path, name: &str) -> anyhow::Result<()> {
    let Some(valid) = configured_verification_names(tendril_home) else {
        return Ok(());
    };
    if valid.iter().any(|v| v.eq_ignore_ascii_case(name)) {
        return Ok(());
    }
    anyhow::bail!(
        "Unknown verification '{}'. Valid verifications: {}",
        name,
        valid.join(", ")
    )
}

/// `plan set-verification <id> <name> <status>`.
pub(super) async fn set_verification(
    args: PlanSetVerificationArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let status = VerificationStatus::from_str_loose(&args.status)
        .ok_or_else(|| anyhow::anyhow!("Invalid verification status: {}", args.status))?;

    set_plan_verification_status(&folder, &args.name, status)?;
    println!("Verification updated.");

    let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
    report_plan_edit_event(
        tendril_home,
        &args.plan_id,
        PlanEditEvent {
            summary: &format!("verification {} set to {}", args.name, args.status),
            reason: args.reason.as_deref(),
            source_chat_session_id: source_chat.as_deref(),
            ..Default::default()
        },
    )
    .await;

    Ok(())
}

/// The `plan verification` subtree.
pub(super) async fn handle(
    verification_cmd: PlanVerificationCommands,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
    db_path: PathBuf,
) -> anyhow::Result<()> {
    match verification_cmd {
        PlanVerificationCommands::List(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let (plan, _) = read_plan_yaml(&folder)?;

            // The project config's order is the run order, which is what someone listing
            // verifications wants to see. A missing config just leaves the plan's own order.
            let settings = load_config(&get_config_path(tendril_home)).ok();
            let project_verifications = settings.as_ref().and_then(|s| {
                s.projects
                    .iter()
                    .find(|p| p.name.eq_ignore_ascii_case(&plan.project))
                    .map(|p| p.verifications.as_slice())
            });
            let mut entries = order_by_project_config(&plan.verifications, project_verifications);

            if let Some(filter) = args.status.as_deref() {
                let wanted = VerificationStatus::from_str_loose(filter)
                    .ok_or_else(|| anyhow::anyhow!("Invalid verification status: {}", filter))?;
                entries.retain(|e| e.status == wanted);
            }

            if args.json {
                let payload: Vec<serde_json::Value> = entries
                    .iter()
                    .map(|e| serde_json::json!({ "name": e.name, "status": e.status.as_str() }))
                    .collect();
                println!("{}", serde_json::to_string(&payload)?);
            } else if entries.is_empty() {
                println!("No verifications found.");
            } else {
                let width = entries
                    .iter()
                    .map(|e| e.name.len())
                    .max()
                    .unwrap_or(4)
                    .max(4);
                println!("{:<width$}  Status", "Name", width = width);
                for e in &entries {
                    println!("{:<width$}  {}", e.name, e.status.as_str(), width = width);
                }
            }
        }
        PlanVerificationCommands::Add(args) => {
            validate_verification_name(tendril_home, &args.name)?;
            let status = match args.status.as_deref() {
                Some(s) => Some(
                    VerificationStatus::from_str_loose(s)
                        .ok_or_else(|| anyhow::anyhow!("Invalid verification status: {}", s))?,
                ),
                None => None,
            };

            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            let entry = add_plan_verification(&folder, &args.name, status)?;
            sync_plan_folder(&folder, &db_path);
            println!("Verification added.");

            if args
                .edit
                .reason
                .as_deref()
                .is_none_or(|r| r.trim().is_empty())
            {
                eprintln!("warning: no --reason given for this plan edit. Pass --reason \"<why you changed it>\" so the plan's other chat sessions are told why, not just what.");
            }

            report_edit_with_reason(
                tendril_home,
                &args.plan_id,
                &format!(
                    "verification {} added as {}",
                    entry.name,
                    entry.status.as_str()
                ),
                &args.edit,
            )
            .await;
        }
        PlanVerificationCommands::Remove(args) => {
            let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
            if let Err(e) = remove_plan_verification(&folder, &args.name) {
                let (plan, _) = read_plan_yaml(&folder)?;
                let current = plan
                    .verifications
                    .iter()
                    .map(|v| v.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                anyhow::bail!("{}. Current verifications: {}", e, current);
            }
            sync_plan_folder(&folder, &db_path);
            println!("Verification removed.");

            if args
                .edit
                .reason
                .as_deref()
                .is_none_or(|r| r.trim().is_empty())
            {
                eprintln!("warning: no --reason given for this plan edit. Pass --reason \"<why you changed it>\" so the plan's other chat sessions are told why, not just what.");
            }

            report_edit_with_reason(
                tendril_home,
                &args.plan_id,
                &format!("verification {} removed", args.name),
                &args.edit,
            )
            .await;
        }
    }

    Ok(())
}
