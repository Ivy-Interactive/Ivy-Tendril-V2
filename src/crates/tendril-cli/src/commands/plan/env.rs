//! The `plan env` subtree: allocating the plan's ports and rendering the project's env files into
//! its worktrees (`materialize`), and reading back what that produced (`get`).
//!
//! `get` is deliberately read-only — it never allocates — so it is safe to run against a plan
//! someone else is executing. Both render the same `--json` document, which is why
//! [`env_json_document`] is shared rather than written twice with two spellings of the same keys.

use super::cli::PlanEnvCommands;
use std::path::PathBuf;
use tendril_core::plans::{
    materialize_plan_env, read_plan_yaml, render_env_file, resolve_plan_folder,
    resolve_plan_project, resolve_worktrees, MaterializeOutcome, RenderedEnvFile,
};

/// The `plan env` subtree.
pub(super) fn handle(
    env_cmd: PlanEnvCommands,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    match env_cmd {
        PlanEnvCommands::Materialize {
            plan_id,
            repo,
            force,
            json,
        } => {
            let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
            let (plan, _) = read_plan_yaml(&folder)?;
            let project = resolve_plan_project(&plan.project, tendril_home)?;
            let report = materialize_plan_env(&folder, tendril_home, repo.as_deref(), force)?;

            if json {
                let first = report.worktrees.first();
                let files: Vec<(&RenderedEnvFile, Option<MaterializeOutcome>)> = first
                    .map(|w| w.files.iter().map(|(r, o)| (r, Some(*o))).collect())
                    .unwrap_or_default();
                println!(
                    "{}",
                    env_json_document(
                        &folder,
                        &report.project,
                        first.map(|w| w.worktree.as_path()),
                        &report.allocated_ports,
                        &files,
                    )
                );
                return Ok(());
            }

            for (name, port) in &report.allocated_ports {
                println!("Port {}: {}", name, port);
            }

            if report.worktrees.is_empty() {
                match repo.as_deref() {
                    Some(r) => anyhow::bail!("No worktree found for repo {}.", r),
                    None => anyhow::bail!(
                        "No worktrees found for this plan - run 'tendril plan add-worktree' first."
                    ),
                }
            }

            if project.env_files.is_empty() {
                println!("No environment files configured for this project.");
                return Ok(());
            }

            for wt in &report.worktrees {
                let unchanged = wt
                    .files
                    .iter()
                    .filter(|(_, o)| *o == MaterializeOutcome::Unchanged)
                    .count();
                let skipped = wt
                    .files
                    .iter()
                    .filter(|(_, o)| *o == MaterializeOutcome::SkippedHandEdited)
                    .count();
                println!(
                    "Materialized {} environment file(s) into {} ({} unchanged, {} skipped).",
                    wt.files.len(),
                    wt.worktree.display(),
                    unchanged,
                    skipped
                );

                for (rendered, outcome) in &wt.files {
                    if *outcome == MaterializeOutcome::SkippedHandEdited {
                        eprintln!(
                            "warning: {} was edited by hand - not overwritten (use --force)",
                            rendered.path
                        );
                    }
                    for missing in &rendered.missing {
                        eprintln!(
                            "warning: {}: {} is unset ({})",
                            rendered.path, missing.key, missing.reference
                        );
                    }
                }
            }
        }
        PlanEnvCommands::Get {
            plan_id,
            repo,
            json,
        } => {
            let folder = resolve_plan_folder(&plan_id, &plans_dir)?;
            let (plan, _) = read_plan_yaml(&folder)?;
            let project = resolve_plan_project(&plan.project, tendril_home)?;
            // Read-only: ports come from plan.yaml, never allocated here, so this is safe to run
            // against a plan under review.
            let allocated = plan.allocated_ports.clone().unwrap_or_default();

            // A template is read relative to a worktree. Without one the templates are simply
            // absent and only the overrides show.
            let worktrees = resolve_worktrees(&plan, &folder, repo.as_deref());
            let worktree = worktrees.first().cloned().unwrap_or_else(|| folder.clone());

            let rendered: Vec<RenderedEnvFile> = project
                .env_files
                .iter()
                .filter(|f| !f.path.trim().is_empty())
                .map(|f| render_env_file(f, &project, &allocated, &worktree, tendril_home))
                .collect();

            if json {
                let files: Vec<(&RenderedEnvFile, Option<MaterializeOutcome>)> =
                    rendered.iter().map(|r| (r, None)).collect();
                println!(
                    "{}",
                    env_json_document(
                        &folder,
                        &project.name,
                        Some(worktree.as_path()),
                        &allocated,
                        &files,
                    )
                );
                return Ok(());
            }

            if allocated.is_empty() {
                println!("No ports allocated for this plan.");
            } else {
                println!("Port\tValue");
                for (name, port) in &allocated {
                    println!("{}\t{}", name, port);
                }
            }

            if project.env_files.is_empty() {
                println!("No environment files configured for this project.");
                return Ok(());
            }

            for file in &rendered {
                println!("{}", file.path);
                if file.values.is_empty() {
                    println!("  (empty)");
                    continue;
                }
                for (key, value) in &file.values {
                    println!("  {}={}", key, value);
                }
            }

            for file in &rendered {
                for missing in &file.missing {
                    println!(
                        "Missing: {} {} ({})",
                        file.path, missing.key, missing.reference
                    );
                }
            }
        }
    }

    Ok(())
}

/// The plan id as everything else in Tendril addresses it: the folder's 5-digit prefix.
fn plan_id_from_folder(plan_folder: &std::path::Path) -> String {
    plan_folder
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.split('-').next().unwrap_or(n).to_string())
        .unwrap_or_default()
}

/// The `--json` document for both `plan env` commands. `outcome` is present only for `materialize`.
fn env_json_document(
    plan_folder: &std::path::Path,
    project: &str,
    worktree: Option<&std::path::Path>,
    allocated: &std::collections::BTreeMap<String, u16>,
    files: &[(&RenderedEnvFile, Option<MaterializeOutcome>)],
) -> String {
    let env_files: Vec<serde_json::Value> = files
        .iter()
        .map(|(rendered, outcome)| {
            let values: serde_json::Map<String, serde_json::Value> = rendered
                .values
                .iter()
                .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
                .collect();
            let missing: Vec<serde_json::Value> = rendered
                .missing
                .iter()
                .map(|m| serde_json::json!({ "key": m.key, "reference": m.reference }))
                .collect();

            let mut doc = serde_json::json!({
                "path": rendered.path,
                "values": values,
                "missing": missing,
            });
            if let Some(outcome) = outcome {
                doc["outcome"] = serde_json::Value::String(outcome.as_str().to_string());
            }
            doc
        })
        .collect();

    let doc = serde_json::json!({
        "planId": plan_id_from_folder(plan_folder),
        "project": project,
        "worktree": worktree.map(|w| w.to_string_lossy().to_string()),
        "allocatedPorts": allocated,
        "envFiles": env_files,
    });

    serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".to_string())
}
