use crate::error::{Result, TendrilError};
use crate::models::{PlanFile, PlanStatus, PlanVerificationEntry, PlanYaml};
use crate::plans::helpers::{allocate_plan_id, to_safe_title};
use crate::plans::reader::read_plan_file;
use chrono::Utc;
use std::path::Path;

pub fn write_plan_yaml(plan_folder: &Path, plan: &PlanYaml) -> Result<()> {
    let yaml_path = plan_folder.join("plan.yaml");
    let raw = serde_yaml::to_string(plan)
        .map_err(|e| TendrilError::Plan(format!("Failed to serialize plan.yaml: {}", e)))?;
    std::fs::write(&yaml_path, raw)?;
    Ok(())
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
