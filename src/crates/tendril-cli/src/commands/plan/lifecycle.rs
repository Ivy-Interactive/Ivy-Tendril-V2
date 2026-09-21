//! The plan document itself: `list`, `create`, `update`, `get`, `set`, and the revisions
//! (`write-revision`, `get-revision`) that record how it got that way.
//!
//! These are the commands that read or rewrite `plan.yaml` wholesale, as against the list verbs in
//! [`super::links`] that only append to or remove from one of its arrays.

use super::cli::{
    PlanCreateArgs, PlanGetArgs, PlanGetRevisionArgs, PlanListArgs, PlanSetArgs, PlanUpdateArgs,
    PlanWriteRevisionArgs,
};
use super::events::{report_plan_edit_event, resolve_source_chat_session, PlanEditEvent};
use super::vocabulary::{PLAN_LIST_FORMATS, SETTABLE_PLAN_FIELDS, SUPPORTED_PLAN_STATES};
use chrono::Utc;
use std::io::Read;
use std::path::PathBuf;
use tendril_core::config::{get_config_path, load_config};
use tendril_core::db::{get_plans, open_database, sync_plan};
use tendril_core::jobs::firmware_values::find_project;
use tendril_core::models::{PlanStatus, PlanVerificationEntry, VerificationStatus};
use tendril_core::plans::{
    create_plan_for_job, get_plan_field, get_revision, read_plan_file, read_plan_yaml,
    resolve_plan_folder, seed_plan_from_project, write_plan_yaml, write_revision,
    CreatePlanOptions, DuplicateCandidateFinder, PlanCompletionGuard, SUPPORTED_PLAN_FIELDS,
};

/// `plan list`.
pub(super) fn list(args: PlanListArgs, plans_dir: PathBuf, db_path: PathBuf) -> anyhow::Result<()> {
    let custom_dir = args.plans_dir.is_some();
    let p_dir = args.plans_dir.unwrap_or(plans_dir);

    // Every filter is validated before anything is read, because a filter that cannot be
    // honoured must not be silently dropped: `--state Faild` used to mean "no state filter",
    // so "show me the failed plans" answered with every plan and exit 0.
    let status_filter = match args.state.as_deref().or(args.status.as_deref()) {
        Some(v) => Some(PlanStatus::from_str_loose(v).ok_or_else(|| {
            anyhow::anyhow!(
                "Unknown plan state '{}'. Supported states: {}",
                v,
                SUPPORTED_PLAN_STATES.join(", ")
            )
        })?),
        None => None,
    };
    let format = args
        .format
        .as_deref()
        .unwrap_or("table")
        .to_ascii_lowercase();
    if !PLAN_LIST_FORMATS.contains(&format.as_str()) {
        anyhow::bail!(
            "Unknown format '{}'. Supported formats: {}",
            args.format.as_deref().unwrap_or_default(),
            PLAN_LIST_FORMATS.join(", ")
        );
    }
    // A mistyped `--plans-dir` printed an empty table, which reads as "this home has no
    // plans" rather than "I looked in the wrong place". The default directory is *not*
    // checked: a home with no `Plans/` yet legitimately lists nothing.
    if custom_dir && !p_dir.exists() {
        anyhow::bail!("Plans directory not found: {}", p_dir.display());
    }
    let search_term = args.search.as_deref();

    let mut plans = if custom_dir || !db_path.exists() {
        let mut disk_plans = Vec::new();
        if p_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&p_dir) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        if let Ok(plan) = read_plan_file(&entry.path()) {
                            disk_plans.push(plan);
                        }
                    }
                }
            }
        }
        // `read_dir` yields whatever order the filesystem happens to hand back - APFS
        // returns these sorted, ext4 does not - so the ordering has to be imposed here to
        // match the database branch's `ORDER BY p.Id DESC`. It is also what makes
        // `--limit` mean "the newest N" rather than "an arbitrary N".
        disk_plans.sort_by_key(|p| std::cmp::Reverse(p.metadata.id));
        disk_plans.retain(|p| {
            if let Some(state) = status_filter {
                if p.metadata.state != state {
                    return false;
                }
            }
            if let Some(proj) = args.project.as_deref() {
                if !p.metadata.project.eq_ignore_ascii_case(proj) {
                    return false;
                }
            }
            if let Some(st) = search_term {
                let id_str = format!("{:05}", p.metadata.id);
                if !p.metadata.title.to_lowercase().contains(&st.to_lowercase())
                    && !id_str.contains(st)
                {
                    return false;
                }
            }
            true
        });
        disk_plans
    } else {
        let conn = open_database(&db_path)?;
        get_plans(&conn, status_filter, args.project.as_deref(), search_term)?
    };

    if let Some(lvl) = &args.level {
        plans.retain(|p| p.metadata.level.eq_ignore_ascii_case(lvl));
    }
    if args.has_pr {
        plans.retain(|p| !p.metadata.prs.is_empty());
    }
    if args.has_worktree {
        plans.retain(|p| {
            let folder = std::path::Path::new(&p.folder_path);
            let wt_dir = folder.join("Worktrees");
            wt_dir.exists()
                && std::fs::read_dir(&wt_dir)
                    .map(|mut it| it.next().is_some())
                    .unwrap_or(false)
        });
    }

    if let Some(limit) = args.limit {
        plans.truncate(limit as usize);
    }

    match format.as_str() {
        "json" => {
            println!("{}", serde_json::to_string_pretty(&plans)?);
        }
        "ids" => {
            for p in plans {
                println!("{:05}", p.metadata.id);
            }
        }
        "folders" => {
            for p in plans {
                let name = std::path::Path::new(&p.folder_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&p.folder_path);
                println!("{}", name);
            }
        }
        _ => {
            println!(
                "{:<8} {:<12} {:<10} {:<15} TITLE",
                "ID", "STATE", "LEVEL", "PROJECT"
            );
            println!("{}", "-".repeat(70));
            for p in plans {
                println!(
                    "{:<8} {:<12} {:<10} {:<15} {}",
                    format!("{:05}", p.metadata.id),
                    p.metadata.state.to_string(),
                    p.metadata.level,
                    p.metadata.project,
                    p.metadata.title
                );
            }
        }
    }

    Ok(())
}

/// `plan create <title> <project>`.
pub(super) fn create(
    args: PlanCreateArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
    db_path: PathBuf,
) -> anyhow::Result<()> {
    let p_dir = args.plans_dir.unwrap_or(plans_dir);
    let mut verifications = Vec::new();
    for v in args.verification {
        let parts: Vec<&str> = v.split('=').collect();
        if parts.len() == 2 {
            let st =
                VerificationStatus::from_str_loose(parts[1]).unwrap_or(VerificationStatus::Pending);
            verifications.push(PlanVerificationEntry {
                name: parts[0].to_string(),
                status: st,
            });
        }
    }

    let duplicates = DuplicateCandidateFinder::find(&p_dir, &args.title, &args.project, None);

    // The plan inherits the project's repos and verification set, as V1 does. A project with
    // no repos is refused rather than producing a plan `ExecutePlan` can make no worktree
    // for — also V1's behaviour.
    let settings = load_config(&get_config_path(tendril_home))?;
    let (repos, verifications) = match find_project(&settings, &args.project) {
        Some(project) => {
            if project.repos.is_empty() {
                anyhow::bail!("Project '{}' has no repos configured.", args.project);
            }
            seed_plan_from_project(project, verifications)
        }
        None => anyhow::bail!("Project '{}' not found.", args.project),
    };

    let opts = CreatePlanOptions {
        title: args.title,
        project: args.project,
        level: args.level,
        initial_prompt: args.initial_prompt,
        source_url: args.source_url,
        execution_profile: args.execution_profile,
        priority: args.priority,
        repos,
        verifications,
        depends_on: args.depends_on,
        related_plans: args.related_plan,
        chat_session_id: args.chat_session,
    };

    // Stamped into `plan.yaml` at creation, so a `CreatePlan` job killed before it could
    // report its plan id can still be matched to the folder it made. `TENDRIL_JOB_ID` is set
    // by the job runner for every agent process; it is absent when an operator runs this
    // command themselves, which is exactly when there is no job to attribute it to.
    let created_by_job = std::env::var("TENDRIL_JOB_ID")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let plan_file = create_plan_for_job(&p_dir, opts, created_by_job.as_deref())?;
    println!("PlanId: {:05}", plan_file.metadata.id);
    println!("Directory: {}", plan_file.folder_path);
    println!("Verifications:");
    for v in &plan_file.metadata.verifications {
        println!("{}:{}", v.name, v.status);
    }

    if !args.no_duplicate_check {
        let block = DuplicateCandidateFinder::format_block(&duplicates);
        if !block.is_empty() {
            println!("{}", block);
        }
    }

    // A plan the database never hears about is invisible to the app, which reads its plan
    // list from SQLite -- so a failure here is reported rather than swallowed. Not fatal: the
    // plan is on disk and correct, `plan doctor` and the next sync will pick it up, and
    // failing the command would tell the agent to create it again.
    match open_database(&db_path) {
        Ok(conn) => {
            if let Err(e) = sync_plan(&conn, &plan_file) {
                eprintln!(
                            "Warning: plan {:05} was created on disk but could not be written to the database: {}",
                            plan_file.metadata.id, e
                        );
            }
        }
        Err(e) => eprintln!(
            "Warning: plan {:05} was created on disk but the database could not be opened: {}",
            plan_file.metadata.id, e
        ),
    }

    Ok(())
}

/// `plan update <id>` — replace the whole of `plan.yaml` from a file or stdin.
pub(super) fn update(
    args: PlanUpdateArgs,
    plans_dir: PathBuf,
    db_path: PathBuf,
) -> anyhow::Result<()> {
    let p_dir = args.plans_dir.unwrap_or(plans_dir);
    let folder = resolve_plan_folder(&args.plan_id, &p_dir)?;
    let content = if let Some(path) = args.file {
        std::fs::read_to_string(path)?
    } else if args.stdin {
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf)?;
        buf
    } else {
        anyhow::bail!("No YAML content provided (use --file or --stdin)");
    };

    let plan: tendril_core::models::PlanYaml = serde_yaml::from_str(&content)?;
    write_plan_yaml(&folder, &plan)?;

    if let Ok(plan_file) = read_plan_file(&folder) {
        if let Ok(conn) = open_database(&db_path) {
            let _ = sync_plan(&conn, &plan_file);
        }
    }
    println!("Updated plan {}", args.plan_id);

    Ok(())
}

/// `plan get <id> [field]`.
pub(super) fn get(args: PlanGetArgs, plans_dir: PathBuf) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;

    // Read straight from plan.yaml: allocatedPorts is deliberately not on PlanMetadata.
    if args
        .field
        .as_deref()
        .is_some_and(|f| f.eq_ignore_ascii_case("allocatedports"))
    {
        let (plan, _) = read_plan_yaml(&folder)?;
        for (name, port) in plan.allocated_ports.unwrap_or_default() {
            println!("{}={}", name, port);
        }
        return Ok(());
    }

    let plan_file = read_plan_file(&folder)?;

    if let Some(f) = args.field {
        let val = if f.eq_ignore_ascii_case("id") {
            plan_file.metadata.id.to_string()
        } else {
            let (plan_yaml, _) = read_plan_yaml(&folder)?;
            // An unknown field is an error, as in V1. Swallowing it into an empty line made
            // a typo indistinguishable from a genuinely empty list, with exit 0 either way.
            match get_plan_field(&plan_yaml, &f) {
                Some(v) => v,
                None => anyhow::bail!(
                    "Unknown field '{}'. Valid fields: {}",
                    f,
                    SUPPORTED_PLAN_FIELDS.join(", ")
                ),
            }
        };
        println!("{}", val);
    } else {
        println!("{}", plan_file.yaml_raw);
    }

    Ok(())
}

/// `plan set <id> <field> <value>`.
pub(super) async fn set(
    args: PlanSetArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
    db_path: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let (mut plan, _) = read_plan_yaml(&folder)?;

    // A `match` with a `_` arm, not an `if/else if` chain: the chain had no final `else`, so
    // `plan set 1 titel "X"` bumped `updated`, rewrote plan.yaml, re-synced the database and
    // reported success while writing nothing at all.
    match args.field.to_ascii_lowercase().as_str() {
        "state" => {
            let new_state = PlanStatus::from_str_loose(&args.value).ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid state: {}. Supported states: {}",
                    args.value,
                    SUPPORTED_PLAN_STATES.join(", ")
                )
            })?;
            if let Some(warn) = PlanCompletionGuard::apply_state(
                &mut plan,
                new_state,
                args.allow_failed_verifications,
                &args.plan_id,
            )? {
                eprintln!("{}", warn);
            }
        }
        "title" => plan.title = args.value.clone(),
        "level" => plan.level = args.value.clone(),
        "project" => plan.project = args.value.clone(),
        "executionprofile" => plan.execution_profile = Some(args.value.clone()),
        "initialprompt" => plan.initial_prompt = Some(args.value.clone()),
        "sourceurl" => plan.source_url = Some(args.value.clone()),
        // The old arm was `if let Ok(p) = value.parse()` with no error branch, so a
        // non-numeric priority reported success and kept the old number.
        "priority" => {
            plan.priority = args.value.parse::<i32>().map_err(|_| {
                anyhow::anyhow!(
                    "Invalid priority '{}': expected a whole number.",
                    args.value
                )
            })?
        }
        _ => anyhow::bail!(
            "Unknown field '{}'. Settable fields: {}",
            args.field,
            SETTABLE_PLAN_FIELDS.join(", ")
        ),
    }

    plan.updated = Utc::now();
    write_plan_yaml(&folder, &plan)?;
    // The value that was written, not the plan's title: an agent that reads this back to
    // check its own write was being told "Updated state to 'My Plan Title'". V1's wording.
    println!("Set {} = {}", args.field, args.value);

    if let Ok(pf) = read_plan_file(&folder) {
        if let Ok(conn) = open_database(&db_path) {
            let _ = sync_plan(&conn, &pf);
        }
    }

    let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
    report_plan_edit_event(
        tendril_home,
        &args.plan_id,
        PlanEditEvent {
            summary: &format!("{} set to {}", args.field, args.value),
            reason: args.reason.as_deref(),
            source_chat_session_id: source_chat.as_deref(),
            ..Default::default()
        },
    )
    .await;

    Ok(())
}

/// `plan write-revision <id>`.
pub(super) async fn write_revision_command(
    args: PlanWriteRevisionArgs,
    tendril_home: &std::path::Path,
    plans_dir: PathBuf,
    db_path: PathBuf,
) -> anyhow::Result<()> {
    let p_dir = args.plans_dir.unwrap_or(plans_dir);
    let folder = resolve_plan_folder(&args.plan_id, &p_dir)?;
    let content = if let Some(path) = args.file {
        std::fs::read_to_string(path)?
    } else if args.stdin {
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf)?;
        buf
    } else {
        anyhow::bail!("Specify --file <path> or --stdin");
    };

    let rev_num = write_revision(&folder, &content, !args.no_question_check)?;
    println!("Revision {:03} written.", rev_num);

    if args.reason.as_deref().is_none_or(|r| r.trim().is_empty()) {
        eprintln!("warning: no --reason given for this plan edit. Pass --reason \"<why you changed it>\" so the plan's other chat sessions are told why, not just what.");
    }

    if let Ok(pf) = read_plan_file(&folder) {
        if let Ok(conn) = open_database(&db_path) {
            let _ = sync_plan(&conn, &pf);
        }
    }

    let source_chat = resolve_source_chat_session(args.chat_session.as_deref());
    report_plan_edit_event(
        tendril_home,
        &args.plan_id,
        PlanEditEvent {
            summary: &format!("revision {:03}.md written", rev_num),
            reason: args.reason.as_deref(),
            source_chat_session_id: source_chat.as_deref(),
            revision_file: Some(&format!("{:03}.md", rev_num)),
            ..Default::default()
        },
    )
    .await;

    if let Ok((plan, _)) = read_plan_yaml(&folder) {
        if let Some(folder_name) = folder.file_name().and_then(|n| n.to_str()) {
            let candidates = DuplicateCandidateFinder::find(
                &p_dir,
                &plan.title,
                &plan.project,
                Some(folder_name),
            );
            if !candidates.is_empty() {
                eprintln!();
                eprintln!("warning: {} possible duplicate plan(s) found. Review before this plan is executed:", candidates.len());
                eprintln!("{}", DuplicateCandidateFinder::format_block(&candidates));
            }
        }
    }

    Ok(())
}

/// `plan get-revision <id>`.
pub(super) fn get_revision_command(
    args: PlanGetRevisionArgs,
    plans_dir: PathBuf,
) -> anyhow::Result<()> {
    let folder = resolve_plan_folder(&args.plan_id, &plans_dir)?;
    let content = get_revision(&folder, args.number)?;
    println!("{}", content);

    Ok(())
}
