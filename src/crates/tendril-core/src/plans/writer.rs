use crate::error::{Result, TendrilError};
use crate::fs_lock::{write_atomic, FileLock};
use crate::models::{PlanFile, PlanStatus, PlanVerificationEntry, PlanYaml, VerificationStatus};
use crate::plans::helpers::{allocate_plan_id, to_safe_title};
use crate::plans::reader::read_plan_file;
use chrono::Utc;
use std::path::Path;

/// Serialises `plan` and replaces `plan.yaml` atomically while holding that file's lock.
///
/// The lock keeps two writers from dropping each other's change; the atomic write keeps a reader
/// woken by the filesystem watcher from parsing a half-written file. Neither is optional now that
/// [`crate::watcher`] wakes readers on every write.
///
/// The caller must not already hold the lock for this `plan.yaml` — see
/// [`FileLock::acquire`][crate::fs_lock::FileLock::acquire] on nesting.
pub fn write_plan_yaml(plan_folder: &Path, plan: &PlanYaml) -> Result<()> {
    let yaml_path = plan_folder.join("plan.yaml");
    let raw = serde_yaml::to_string(plan)
        .map_err(|e| TendrilError::Plan(format!("Failed to serialize plan.yaml: {}", e)))?;
    let _lock = FileLock::acquire(&yaml_path)?;
    write_atomic(&yaml_path, raw.as_bytes())
}

/// The repos and verifications a new plan inherits from its project.
///
/// Ports V1's `PlanCreateCommand` repo copy plus `PlanCommandHelpers.ApplyProjectVerifications`,
/// and exists as one function for the same reason V1's does: plan creation has three entry points
/// (the CLI, the HTTP route and the MCP tool) and all three have to seed identically.
///
/// Without this a plan is created with no repos and no verifications, which is not a cosmetic gap:
/// `ExecutePlan` walks the plan's repos to create worktrees and its verifications to run the quality
/// gates, so both loops iterate nothing and the job reports success having checked nothing.
///
/// A project verification is seeded `Pending` when required and `Skipped` when optional. An entry
/// named by `overrides` (the CLI's `--verification Name=Status`) takes that status instead, matched
/// case-insensitively; an override naming something the project does not have is kept and appended
/// after the project set, in the order supplied.
pub fn seed_plan_from_project(
    project: &crate::models::project::ProjectConfig,
    overrides: Vec<PlanVerificationEntry>,
) -> (Vec<String>, Vec<PlanVerificationEntry>) {
    let repos = project.repos.iter().map(|r| r.path.clone()).collect();

    let mut seeded: Vec<PlanVerificationEntry> = Vec::new();
    for pv in &project.verifications {
        let status = overrides
            .iter()
            .find(|o| o.name.eq_ignore_ascii_case(&pv.name))
            .map(|o| o.status)
            .unwrap_or(if pv.required {
                VerificationStatus::Pending
            } else {
                VerificationStatus::Skipped
            });
        seeded.push(PlanVerificationEntry {
            name: pv.name.clone(),
            status,
        });
    }

    for o in overrides {
        if !seeded.iter().any(|s| s.name.eq_ignore_ascii_case(&o.name)) {
            seeded.push(o);
        }
    }

    (repos, seeded)
}

pub struct CreatePlanOptions {
    pub title: String,
    pub project: String,
    pub level: Option<String>,
    pub initial_prompt: Option<String>,
    pub source_url: Option<String>,
    pub execution_profile: Option<String>,
    pub priority: Option<i32>,
    pub repos: Vec<String>,
    pub verifications: Vec<PlanVerificationEntry>,
    pub depends_on: Vec<String>,
    pub related_plans: Vec<String>,
    pub chat_session_id: Option<String>,
}

pub fn create_plan(plans_dir: &Path, opts: CreatePlanOptions) -> Result<PlanFile> {
    std::fs::create_dir_all(plans_dir)?;

    let id = allocate_plan_id(plans_dir)?;
    let safe_title = to_safe_title(&opts.title);
    let folder_name = format!("{}-{}", id, safe_title);
    let plan_folder = plans_dir.join(&folder_name);

    if plan_folder.exists() {
        return Err(TendrilError::Plan(format!(
            "Plan directory already exists: {}",
            plan_folder.display()
        )));
    }

    std::fs::create_dir_all(&plan_folder)?;
    std::fs::create_dir_all(plan_folder.join("Revisions"))?;
    std::fs::create_dir_all(plan_folder.join("Worktrees"))?;
    std::fs::create_dir_all(plan_folder.join("Artifacts"))?;

    let plan_yaml = PlanYaml {
        schema_version: crate::models::CURRENT_SCHEMA_VERSION,
        state: PlanStatus::Draft.to_string(),
        project: opts.project,
        level: opts.level.unwrap_or_else(|| "Feature".to_string()),
        title: opts.title,
        repos: opts.repos,
        created: Utc::now(),
        updated: Utc::now(),
        prs: Vec::new(),
        commits: Vec::new(),
        worktrees: None,
        verifications: opts.verifications,
        related_plans: opts.related_plans,
        depends_on: opts.depends_on,
        priority: opts.priority.unwrap_or(0),
        partial_delivery: false,
        execution_profile: opts.execution_profile,
        initial_prompt: opts.initial_prompt,
        source_url: opts.source_url,
        recommendations: None,
        chat_session_id: opts.chat_session_id,
        allocated_ports: None,
        extra: std::collections::BTreeMap::new(),
    };

    write_plan_yaml(&plan_folder, &plan_yaml)?;
    read_plan_file(&plan_folder)
}
