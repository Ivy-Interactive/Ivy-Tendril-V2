use crate::config::{expand_variables, get_plans_dir_with_settings, TendrilSettings};
use crate::models::{JobArgs, JobItem, PlanYaml, ProjectConfig};
use crate::plans::reader::read_plan_yaml;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Instruction text both project-setup promptwares receive; they have no plan to read from.
const PROJECT_SETUP_INSTRUCTIONS: &str = "Setup verifications and review actions for this project.";

/// Builds the firmware header values for a job.
///
/// Every deployed promptware documents the header values it needs; this is the only place they are
/// produced. `CurrentTime` is added by the firmware compiler, not here.
pub fn build_firmware_values(
    job: &JobItem,
    tendril_home: &Path,
    settings: &TendrilSettings,
) -> HashMap<String, String> {
    build_firmware_values_with(
        job,
        tendril_home,
        settings,
        &get_plans_dir_with_settings(tendril_home, Some(settings)),
    )
}

/// Builds the firmware header values for a job with an explicit plans directory.
///
/// This seam allows tests and callers to supply a plans directory directly rather than relying on
/// ambient TENDRIL_PLANS environment resolution.
pub fn build_firmware_values_with(
    job: &JobItem,
    tendril_home: &Path,
    settings: &TendrilSettings,
    plans_dir: &Path,
) -> HashMap<String, String> {
    let mut values = HashMap::new();
    values.insert("TendrilJobId".to_string(), job.id.clone());
    values.insert(
        "TendrilHome".to_string(),
        tendril_home.to_string_lossy().to_string(),
    );
    values.insert("TendrilProject".to_string(), resolve_project(job, settings));

    let Some(args) = job_args(job) else {
        return values;
    };

    match &args {
        JobArgs::CreatePlan(a) => {
            values.insert("TaskDescription".to_string(), a.description.clone());
            values.insert(
                "TendrilPlansFolder".to_string(),
                plans_dir.to_string_lossy().to_string(),
            );
            if a.force {
                values.insert("Force".to_string(), "true".to_string());
            }
            if let Some(sp) = &a.source_path {
                values.insert("SourcePath".to_string(), sp.clone());
            }
        }
        JobArgs::SyncRepo(a) => {
            values.insert("RepoPath".to_string(), a.repo_path.clone());
            values.insert("BaseBranch".to_string(), a.base_branch.clone());
            values.insert(
                "UntrackedChangesPolicy".to_string(),
                a.untracked_changes_policy.clone(),
            );
        }
        JobArgs::SetupProject(a) => {
            // `folder_path` carries a project name for this job type, not a plan folder.
            values.insert("ProjectName".to_string(), a.folder_path.clone());
            values.insert(
                "Instructions".to_string(),
                PROJECT_SETUP_INSTRUCTIONS.to_string(),
            );
        }
        JobArgs::AddProject(a) => {
            values.insert("ProjectName".to_string(), a.project_name.clone());
            values.insert(
                "ReposJson".to_string(),
                serde_json::to_string(&a.repos).unwrap_or_else(|_| "[]".to_string()),
            );
            values.insert(
                "Instructions".to_string(),
                PROJECT_SETUP_INSTRUCTIONS.to_string(),
            );
        }
        _ => add_plan_scoped_values(&args, job, settings, &mut values),
    }

    values
}

/// Adds the plan block (`TendrilPlanFolder`, `TendrilPlanId`, `TendrilPlansFolder`, `SourceUrl`) and
/// the per-promptware extras for every job type that operates on a plan.
///
/// The whole block is skipped when the plan folder is missing, so a stale folder yields a header
/// without plan keys rather than a failure.
fn add_plan_scoped_values(
    args: &JobArgs,
    job: &JobItem,
    settings: &TendrilSettings,
    values: &mut HashMap<String, String>,
) {
    let Some(plan_folder) = args.plan_folder().filter(|p| !p.is_empty()) else {
        return;
    };
    let plan_folder = PathBuf::from(plan_folder);
    if !plan_folder.is_dir() {
        return;
    }

    if let Some(plan_id) = extract_plan_id_from_folder(&plan_folder) {
        values.insert("TendrilPlanId".to_string(), plan_id);
    }
    values.insert(
        "TendrilPlanFolder".to_string(),
        plan_folder.to_string_lossy().to_string(),
    );
    if let Some(parent) = plan_folder.parent() {
        values.insert(
            "TendrilPlansFolder".to_string(),
            parent.to_string_lossy().to_string(),
        );
    }

    let Ok((plan, _)) = read_plan_yaml(&plan_folder) else {
        return;
    };

    if let Some(url) = plan.source_url.as_ref().filter(|u| !u.is_empty()) {
        values.insert("SourceUrl".to_string(), url.clone());
    }

    match args {
        JobArgs::ExecutePlan(a) => {
            if let Some(note) = a.note.as_ref().filter(|n| !n.is_empty()) {
                values.insert("Note".to_string(), note.clone());
            }
        }
        JobArgs::RetryPlan(a) => {
            values.insert("ChangeRequest".to_string(), a.change_request.clone());
        }
        JobArgs::UpdatePlan(a) => {
            if let Some(instructions) = a.instructions.as_ref().filter(|i| !i.is_empty()) {
                values.insert("UpdateInstructions".to_string(), instructions.clone());
            }
        }
        JobArgs::CreatePr(a) => {
            values.insert(
                "PrSolveMergeConflicts".to_string(),
                a.solve_merge_conflicts.to_string(),
            );
            values.insert("PrMerge".to_string(), a.merge.to_string());
            values.insert("PrDeleteBranch".to_string(), a.delete_branch.to_string());
            values.insert(
                "PrIncludeArtifacts".to_string(),
                a.include_artifacts.to_string(),
            );
            values.insert("PrDraft".to_string(), a.draft.to_string());

            let reviewers: Vec<String> = a
                .reviewers
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|r| r.trim().to_string())
                .filter(|r| !r.is_empty())
                .collect();
            if !reviewers.is_empty() {
                values.insert("PrReviewer".to_string(), reviewers.join(","));
            }
            if let Some(comment) = a.comment.as_ref().filter(|c| !c.is_empty()) {
                values.insert("PrComment".to_string(), comment.clone());
            }
        }
        JobArgs::CreateIssue(a) => {
            if !a.repo.is_empty() {
                values.insert("Repo".to_string(), a.repo.clone());
            }
            if let Some(assignee) = a.assignee.as_ref().filter(|v| !v.is_empty()) {
                values.insert("Assignee".to_string(), assignee.clone());
            }
            if let Some(comment) = a.comment.as_ref().filter(|v| !v.is_empty()) {
                values.insert("Comment".to_string(), comment.clone());
            }
            if let Some(labels) = a.labels.as_ref().filter(|v| !v.is_empty()) {
                values.insert("Labels".to_string(), labels.clone());
            }
        }
        _ => {}
    }

    if matches!(
        args,
        JobArgs::ExecutePlan(_) | JobArgs::RetryPlan(_) | JobArgs::CreatePr(_)
    ) {
        let project_config = find_project(settings, &resolve_project(job, settings));
        if let Some(repo_configs) = build_repo_configs_yaml(&plan, project_config) {
            values.insert("RepoConfigs".to_string(), repo_configs);
        }
    }
}

/// The project a job belongs to. Plan-scoped jobs take it from `plan.yaml`; `CreatePlan` from its
/// args; the project-setup jobs from the project name they were given. Everything else is `Auto`.
pub fn resolve_project(job: &JobItem, _settings: &TendrilSettings) -> String {
    let Some(args) = job_args(job) else {
        return "Auto".to_string();
    };

    match &args {
        JobArgs::CreatePlan(a) if !a.project.is_empty() => a.project.clone(),
        JobArgs::SetupProject(a) if !a.folder_path.is_empty() => a.folder_path.clone(),
        JobArgs::AddProject(a) if !a.project_name.is_empty() => a.project_name.clone(),
        JobArgs::SyncRepo(_) => "Auto".to_string(),
        _ => args
            .plan_folder()
            .filter(|p| !p.is_empty())
            .and_then(|p| read_plan_yaml(Path::new(p)).ok())
            .map(|(plan, _)| plan.project)
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "Auto".to_string()),
    }
}

/// Directory the agent process starts in: the resolved project's first existing repo, else the
/// promptware folder, else `TENDRIL_HOME`. `SyncRepo` always runs in the repo it syncs.
pub fn resolve_working_directory(
    job: &JobItem,
    settings: &TendrilSettings,
    tendril_home: &Path,
    promptware_folder: &Path,
) -> PathBuf {
    if let Some(JobArgs::SyncRepo(a)) = job_args(job) {
        return PathBuf::from(a.repo_path);
    }

    let home_str = tendril_home.to_string_lossy().to_string();
    let project = resolve_project(job, settings);
    if project != "Auto" {
        if let Some(config) = find_project(settings, &project) {
            for repo in &config.repos {
                let expanded = PathBuf::from(expand_variables(&repo.path, &home_str));
                if expanded.is_dir() {
                    return expanded;
                }
            }
        }
    }

    if promptware_folder.is_dir() {
        return promptware_folder.to_path_buf();
    }

    tendril_home.to_path_buf()
}

/// The `RepoConfigs` header block: one entry per plan repo, then the project's build dependencies as
/// read-only entries. `None` when the plan records no repos.
pub fn build_repo_configs_yaml(
    plan: &PlanYaml,
    project_config: Option<&ProjectConfig>,
) -> Option<String> {
    if plan.repos.is_empty() {
        return None;
    }

    let plan_repo_names: HashSet<String> = plan
        .repos
        .iter()
        .map(|r| repo_name(r).to_ascii_lowercase())
        .collect();

    let mut lines = Vec::new();

    for repo_path in &plan.repos {
        let base_branch = project_config
            .and_then(|c| find_repo_ref(c, repo_path))
            .and_then(|r| r.base_branch.clone())
            .unwrap_or_else(|| "main".to_string());
        lines.push(format!("- path: {}", repo_path));
        lines.push(format!("  baseBranch: {}", base_branch));
    }

    if let Some(config) = project_config {
        for dep_path in &config.build_dependencies {
            if plan_repo_names.contains(&repo_name(dep_path).to_ascii_lowercase()) {
                continue;
            }
            let base_branch = find_repo_ref(config, dep_path)
                .and_then(|r| r.base_branch.clone())
                .unwrap_or_else(|| "main".to_string());
            lines.push(format!("- path: {}", dep_path));
            lines.push(format!("  baseBranch: {}", base_branch));
            lines.push("  readOnly: true".to_string());
        }
    }

    Some(lines.join("\n"))
}

/// The plan's recommended execution profile, for the job types that honour one.
pub fn execution_profile_override(job: &JobItem, plan: &PlanYaml) -> Option<String> {
    match job_args(job) {
        Some(JobArgs::ExecutePlan(_)) | Some(JobArgs::RetryPlan(_)) => {
            plan.execution_profile.clone().filter(|p| !p.is_empty())
        }
        _ => None,
    }
}

/// The typed args for a job, rehydrated from the persisted JSON when the in-memory copy is absent
/// (which is the case for any job loaded back from SQLite).
pub fn job_args(job: &JobItem) -> Option<JobArgs> {
    if let Some(args) = &job.typed_args {
        return Some(args.clone());
    }
    job.args
        .as_ref()
        .and_then(|json| serde_json::from_str(json).ok())
}

/// The 5-digit ID prefix of a plan folder name, e.g. `00058` from `00058-HardenCoreJob`.
pub fn extract_plan_id_from_folder(plan_folder: &Path) -> Option<String> {
    let name = plan_folder.file_name()?.to_str()?;
    if name.len() >= 5 && name.chars().take(5).all(|c| c.is_ascii_digit()) {
        return Some(name[..5].to_string());
    }
    None
}

pub fn find_project<'a>(settings: &'a TendrilSettings, name: &str) -> Option<&'a ProjectConfig> {
    settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name))
}

pub(crate) fn find_repo_ref<'a>(
    config: &'a ProjectConfig,
    repo_path: &str,
) -> Option<&'a crate::models::RepoRef> {
    let target = repo_name(repo_path).to_ascii_lowercase();
    config
        .repos
        .iter()
        .find(|r| repo_name(&r.path).to_ascii_lowercase() == target)
}

pub(crate) fn repo_name(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
}
