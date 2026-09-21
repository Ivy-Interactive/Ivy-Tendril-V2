//! The list verbs: the repos, pull requests, commits, dependencies and related plans a plan
//! accumulates as it is worked on.
//!
//! Every one of these is the same shape — read `plan.yaml`, add to or remove from one array, write
//! it back, report the edit — and they differ only in which array and whether a duplicate is an
//! error or a no-op, so they are worth reading side by side.

use super::cli::{
    PlanAddCommitArgs, PlanAddDependsOnArgs, PlanAddPrArgs, PlanAddRelatedArgs, PlanAddRepoArgs,
    PlanRemoveDependsOnArgs, PlanRemovePrArgs, PlanRemoveRelatedArgs, PlanRemoveRepoArgs,
};
use super::events::{report_plan_edit_event, resolve_source_chat_session, PlanEditEvent};
use chrono::Utc;
use std::path::PathBuf;
use tendril_core::git::same_pr;
use tendril_core::plans::{
    read_plan_yaml, resolve_plan_folder, resolve_plan_folder_name, write_plan_yaml,
};

/// Resolves a `depends-on` / `related-plan` reference to its canonical folder name, failing the same
/// way the REST endpoints 404 so the CLI and HTTP agree on what an unknown reference means.
fn resolve_referenced_plan_folder(
    plan_ref: &str,
    plans_dir: &std::path::Path,
) -> anyhow::Result<String> {
    resolve_plan_folder_name(plan_ref.trim(), plans_dir)
        .map_err(|_| anyhow::anyhow!("Referenced plan '{}' not found", plan_ref.trim()))
}

/// `plan add-repo <id> <path>`.
pub(super) async fn add_repo(
    args: PlanAddRepoArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let changed = !plan
        .repos
        .iter()
        .any(|r| r.eq_ignore_ascii_case(&args.path));
    if changed {
        plan.repos.push(args.path.clone());
        plan.updated = Utc::now();
        write_plan_yaml(&folder, &plan)?;
    }
    println!("Repo added.");

    if changed {
        let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
        report_plan_edit_event(
            tendril_home,
            &args.plan_id,
            PlanEditEvent {
                summary: &format!("repo added: {}", args.path),
                reason: args.reason.as_deref(),
                source_chat_session_id: source_chat.as_deref(),
                ..Default::default()
            },
        )
        .await;
    }

    Ok(())
}

/// `plan remove-repo <id> <path>`.
pub(super) async fn remove_repo(
    args: PlanRemoveRepoArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let before = plan.repos.len();
    plan.repos.retain(|r| !r.eq_ignore_ascii_case(&args.path));
    if plan.repos.len() == before {
        anyhow::bail!("Repository not found in plan: {}", args.path);
    }
    plan.updated = Utc::now();
    write_plan_yaml(&folder, &plan)?;
    println!("Repo removed.");

    let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
    report_plan_edit_event(
        tendril_home,
        &args.plan_id,
        PlanEditEvent {
            summary: &format!("repo removed: {}", args.path),
            reason: args.reason.as_deref(),
            source_chat_session_id: source_chat.as_deref(),
            ..Default::default()
        },
    )
    .await;

    Ok(())
}

/// `plan add-pr <id> <url>`.
pub(super) async fn add_pr(
    args: PlanAddPrArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let changed = !plan.prs.iter().any(|p| same_pr(p, &args.url));
    if changed {
        plan.prs.push(args.url.clone());
        plan.updated = Utc::now();
        write_plan_yaml(&folder, &plan)?;
    }
    println!("PR added.");

    if args.reason.as_deref().is_none_or(|r| r.trim().is_empty()) {
        eprintln!("warning: no --reason given for this plan edit. Pass --reason \"<why you changed it>\" so the plan's other chat sessions are told why, not just what.");
    }

    if changed {
        let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
        report_plan_edit_event(
            tendril_home,
            &args.plan_id,
            PlanEditEvent {
                summary: &format!("PR added: {}", args.url),
                reason: args.reason.as_deref(),
                source_chat_session_id: source_chat.as_deref(),
                event_kind: Some("pr-created"),
                pr_url: Some(&args.url),
                ..Default::default()
            },
        )
        .await;
    }

    Ok(())
}

/// `plan remove-pr <id> <url>`.
pub(super) async fn remove_pr(
    args: PlanRemovePrArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let before = plan.prs.len();
    plan.prs.retain(|p| !same_pr(p, &args.url));
    if plan.prs.len() == before {
        println!("PR not recorded on plan {}: {}", args.plan_id, args.url);
        return Ok(());
    }
    plan.updated = Utc::now();
    write_plan_yaml(&folder, &plan)?;
    println!("PR removed.");

    if args.reason.as_deref().is_none_or(|r| r.trim().is_empty()) {
        eprintln!("warning: no --reason given for this plan edit. Pass --reason \"<why you changed it>\" so the plan's other chat sessions are told why, not just what.");
    }

    let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
    report_plan_edit_event(
        tendril_home,
        &args.plan_id,
        PlanEditEvent {
            summary: &format!("PR removed: {}", args.url),
            reason: args.reason.as_deref(),
            source_chat_session_id: source_chat.as_deref(),
            ..Default::default()
        },
    )
    .await;

    Ok(())
}

/// `plan add-commit <id> <sha>`.
pub(super) async fn add_commit(
    args: PlanAddCommitArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let changed = !plan.commits.contains(&args.sha);
    if changed {
        plan.commits.push(args.sha.clone());
        plan.updated = Utc::now();
        write_plan_yaml(&folder, &plan)?;
    }
    println!("Commit added.");

    if changed {
        let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
        report_plan_edit_event(
            tendril_home,
            &args.plan_id,
            PlanEditEvent {
                summary: &format!("commit added: {}", args.sha),
                reason: args.reason.as_deref(),
                source_chat_session_id: source_chat.as_deref(),
                ..Default::default()
            },
        )
        .await;
    }

    Ok(())
}

/// `plan add-depends-on <id> <folder>`.
pub(super) async fn add_depends_on(
    args: PlanAddDependsOnArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    // Store the canonical folder name: a bare `123` written verbatim would block the plan
    // forever with "Dependency plan folder '123' does not exist".
    let target = resolve_referenced_plan_folder(&args.folder, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let changed = !plan
        .depends_on
        .iter()
        .any(|d| d.eq_ignore_ascii_case(&target));
    if changed {
        plan.depends_on.push(target.clone());
        plan.updated = Utc::now();
        write_plan_yaml(&folder, &plan)?;
    }
    println!("Dependency added.");

    if changed {
        let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
        report_plan_edit_event(
            tendril_home,
            &args.plan_id,
            PlanEditEvent {
                summary: &format!("dependency added: {}", target),
                reason: args.reason.as_deref(),
                source_chat_session_id: source_chat.as_deref(),
                ..Default::default()
            },
        )
        .await;
    }

    Ok(())
}

/// `plan remove-depends-on <id> <folder>`.
pub(super) async fn remove_depends_on(
    args: PlanRemoveDependsOnArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let target = resolve_referenced_plan_folder(&args.folder, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let before = plan.depends_on.len();
    plan.depends_on.retain(|d| !d.eq_ignore_ascii_case(&target));
    if plan.depends_on.len() == before {
        anyhow::bail!("Dependency not found: {}", target);
    }
    plan.updated = Utc::now();
    write_plan_yaml(&folder, &plan)?;
    println!("Dependency removed.");

    let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
    report_plan_edit_event(
        tendril_home,
        &args.plan_id,
        PlanEditEvent {
            summary: &format!("dependency removed: {}", target),
            reason: args.reason.as_deref(),
            source_chat_session_id: source_chat.as_deref(),
            ..Default::default()
        },
    )
    .await;

    Ok(())
}

/// `plan add-related-plan <id> <folder>`.
pub(super) async fn add_related_plan(
    args: PlanAddRelatedArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let target = resolve_referenced_plan_folder(&args.folder, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let changed = !plan
        .related_plans
        .iter()
        .any(|r| r.eq_ignore_ascii_case(&target));
    if changed {
        plan.related_plans.push(target.clone());
        plan.updated = Utc::now();
        write_plan_yaml(&folder, &plan)?;
    }
    println!("Related plan added.");

    if changed {
        let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
        report_plan_edit_event(
            tendril_home,
            &args.plan_id,
            PlanEditEvent {
                summary: &format!("related plan added: {}", target),
                reason: args.reason.as_deref(),
                source_chat_session_id: source_chat.as_deref(),
                ..Default::default()
            },
        )
        .await;
    }

    Ok(())
}

/// `plan remove-related-plan <id> <folder>`.
pub(super) async fn remove_related_plan(
    args: PlanRemoveRelatedArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let target = resolve_referenced_plan_folder(&args.folder, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;
    let before = plan.related_plans.len();
    plan.related_plans
        .retain(|r| !r.eq_ignore_ascii_case(&target));
    if plan.related_plans.len() == before {
        anyhow::bail!("Related plan not found: {}", target);
    }
    plan.updated = Utc::now();
    write_plan_yaml(&folder, &plan)?;
    println!("Related plan removed.");

    let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
    report_plan_edit_event(
        tendril_home,
        &args.plan_id,
        PlanEditEvent {
            summary: &format!("related plan removed: {}", target),
            reason: args.reason.as_deref(),
            source_chat_session_id: source_chat.as_deref(),
            ..Default::default()
        },
    )
    .await;

    Ok(())
}
