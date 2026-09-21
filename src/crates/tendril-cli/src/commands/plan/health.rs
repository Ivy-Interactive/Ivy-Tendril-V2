//! The three read-only verdicts: `plan validate`, `plan doctor` and `plan check-wireframes`.
//!
//! All three answer "is this plan in a fit state?" and all three gate a script on their exit code,
//! so the rule that decides that — errors fail, warnings do not — lives here once in
//! [`error_count`] rather than once per command.

use super::cli::PlanValidateArgs;
use tendril_core::plans::{
    check_all_plans_health, check_plan_health, check_pr_health_with_progress, resolve_plan_folder,
    resolve_pr_head_via_gh,
};

/// `plan validate <id>` — the health report for a single plan.
pub(super) fn validate(
    args: PlanValidateArgs,
    plans_dir: std::path::PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let issues = check_plan_health(&folder);
    if issues.is_empty() {
        println!("Plan is valid.");
    } else {
        for issue in &issues {
            println!("[{}] {}", issue.severity, issue.message);
        }
        // Exit non-zero on an error, so a script can gate on validity. Warnings stay exit 0:
        // an outdated schema version or a missing Revisions directory is a note, not a
        // reason to refuse to work with the plan.
        let errors = error_count(&issues);
        if errors > 0 {
            anyhow::bail!(
                "Plan {} is not valid: {} error(s). See the [Error] line(s) above.",
                args.plan_id,
                errors
            );
        }
    }

    Ok(())
}

/// `plan doctor` — the health report across every plan, plus the optional schema migration and
/// husk prune that run before it.
pub(super) fn doctor(
    fix: bool,
    prs: bool,
    prune_husks: bool,
    dry_run: bool,
    plans_dir: std::path::PathBuf,
) -> anyhow::Result<()> {
    if dry_run && !prune_husks {
        anyhow::bail!("--dry-run only applies to --prune-husks.");
    }
    if fix {
        let migrator = tendril_core::plans::migrations::PlanMigrator::new();
        let count = migrator.migrate_plans(&plans_dir, None)?;
        if count > 0 {
            println!(
                "Migrated {} plan(s) to schema version {}.",
                count,
                migrator.latest_version()
            );
        }
    }
    // Before the report, so the report describes the tree as it is once the prune has run.
    if prune_husks {
        let outcome = tendril_core::plans::prune_husk_plans(&plans_dir, dry_run)?;
        for (folder, why) in &outcome.kept {
            println!("Kept {}: {}", folder, why);
        }
        for folder in &outcome.pruned {
            if dry_run {
                println!("Would remove husk plan {}", folder);
            } else {
                println!("Removed husk plan {}", folder);
            }
        }
        if outcome.pruned.is_empty() && outcome.kept.is_empty() {
            println!("No husk plans found.");
        }
    }

    let mut issues = check_all_plans_health(&plans_dir)?;
    if prs {
        issues.extend(check_pr_health_with_progress(
            &plans_dir,
            &resolve_pr_head_via_gh,
            &|count| println!("Resolving {} pull request(s) via gh...", count),
        )?);
    }
    if issues.is_empty() {
        println!("All plans are healthy.");
    } else {
        for issue in &issues {
            println!(
                "{}: [{}] {}",
                issue.plan_folder, issue.severity, issue.message
            );
        }
        let errors = error_count(&issues);
        if errors > 0 {
            anyhow::bail!(
                "{} plan error(s) found. See the [Error] line(s) above.",
                errors
            );
        }
    }

    Ok(())
}

/// How many of these health issues are errors rather than warnings. `plan validate` and
/// `plan doctor` exit non-zero on errors only.
fn error_count(issues: &[tendril_core::plans::PlanDoctorIssue]) -> usize {
    issues
        .iter()
        .filter(|i| i.severity.eq_ignore_ascii_case("Error"))
        .count()
}

/// `tendril plan check-wireframes <id>` -- the leak guard, on demand.
///
/// The same check the execution gate, the PR launch and the completion guard run, so a developer
/// can see exactly what is blocking a plan without having to trigger one of them.
///
/// **Exits the process with status 1 when it finds anything**, rather than returning an error. A
/// hook or a script gates on the exit code, and an `Err` here would be printed as a Tendril failure
/// - which this is not. It is a report with a verdict. Returning `Ok` means the plan is clean.
pub(super) fn handle_check_wireframes(
    id: &str,
    tendril_home: &std::path::Path,
) -> anyhow::Result<()> {
    let plans_dir = tendril_core::config::get_plans_dir(tendril_home);
    let plan_folder = resolve_plan_folder(id, &plans_dir)?;

    let leaks = tendril_core::wireframes::plan_guard::check_and_report(&plan_folder, None);
    if leaks.is_empty() {
        println!("No wireframe code in {}'s changes.", plan_folder.display());
        return Ok(());
    }

    print!("{}", tendril_core::wireframes::leak_guard::describe(&leaks));
    println!();
    println!(
        "Report written to {}",
        tendril_core::wireframes::leak_guard::report_path(&plan_folder).display()
    );
    // A non-zero exit so a script or a hook can gate on it.
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tendril_core::plans::PlanDoctorIssue;

    fn issue(severity: &str) -> PlanDoctorIssue {
        PlanDoctorIssue {
            plan_folder: "00001-Plan".to_string(),
            severity: severity.to_string(),
            message: "m".to_string(),
        }
    }

    #[test]
    fn error_count_counts_errors_case_insensitively_and_ignores_warnings() {
        let issues = vec![issue("Error"), issue("error"), issue("Warning")];
        assert_eq!(error_count(&issues), 2);
        assert_eq!(error_count(&[issue("Warning")]), 0);
        assert_eq!(error_count(&[]), 0);
    }
}
