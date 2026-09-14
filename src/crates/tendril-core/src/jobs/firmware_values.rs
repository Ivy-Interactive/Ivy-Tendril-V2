use crate::agents::McpServerConfig;
use crate::config::{
    expand_variables, get_plans_dir_with_env, get_plans_dir_with_settings, EnvSource, SystemEnv,
    TendrilSettings,
};
use crate::models::{JobArgs, JobItem, PlanYaml, ProjectConfig, ProjectSkillInfo};
use crate::plans::reader::read_plan_yaml;
use crate::skills::project_skills_dir;
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

/// The `%TOKEN%` values a promptware's configured tool rules may reference.
///
/// Keyed the way the config spells them, so `Write(%PLAN_DIR%/Artifacts/**)` resolves to the plan
/// folder this job is actually working on.
pub fn build_job_context(
    firmware_values: &HashMap<String, String>,
    tendril_home: &Path,
    promptware_folder: &Path,
) -> HashMap<String, String> {
    let mut ctx = HashMap::new();
    ctx.insert(
        "PROMPTWARE_DIR".to_string(),
        promptware_folder.to_string_lossy().to_string(),
    );
    if let Some(plans_dir) = firmware_values.get("TendrilPlansFolder") {
        ctx.insert("PLANS_DIR".to_string(), plans_dir.clone());
    }
    if let Some(plan_folder) = firmware_values.get("TendrilPlanFolder") {
        ctx.insert("PLAN_DIR".to_string(), plan_folder.clone());
    }
    ctx.insert(
        "TENDRIL_HOME".to_string(),
        tendril_home.to_string_lossy().to_string(),
    );
    ctx
}

/// The directories an agent is allowed to write outside its working directory.
///
/// These flags (`--add-dir` and friends) *widen* an agent's reach; they do not confine it. The point
/// here is that a promptware can reach the Tendril home it has to write into — its plan's
/// `Verification/` and `Artifacts/`, its promptware `Memory/` — not that anything else is locked
/// down.
///
/// Entries already covered by an ancestor in the set are dropped, so the common layout (plans dir
/// under `TENDRIL_HOME`) yields just the home rather than a pile of redundant flags.
pub fn resolve_writable_directories(
    promptware_type: &str,
    promptware_folder: &Path,
    plan_folder: &Path,
    tendril_home: &Path,
    settings: &TendrilSettings,
) -> Vec<String> {
    resolve_writable_directories_with_env(
        promptware_type,
        promptware_folder,
        plan_folder,
        tendril_home,
        settings,
        &SystemEnv,
    )
}

/// [`resolve_writable_directories`] with the environment injected, so a test can resolve against a
/// fixture home without the operator's own `TENDRIL_PLANS` leaking in.
pub fn resolve_writable_directories_with_env(
    promptware_type: &str,
    promptware_folder: &Path,
    plan_folder: &Path,
    tendril_home: &Path,
    settings: &TendrilSettings,
    env: &impl EnvSource,
) -> Vec<String> {
    let mut dirs: Vec<String> = vec![tendril_home.to_string_lossy().to_string()];

    dirs.push(
        get_plans_dir_with_env(tendril_home, Some(settings), env)
            .to_string_lossy()
            .to_string(),
    );
    dirs.push(
        promptware_folder
            .join("Memory")
            .to_string_lossy()
            .to_string(),
    );
    dirs.push(
        promptware_folder
            .join("Tools")
            .to_string_lossy()
            .to_string(),
    );

    // The plan folder itself transitively covers Worktrees/, Verification/ and Artifacts/. It only
    // adds anything when the plan folder lives outside TENDRIL_HOME, but that case is real and the
    // intent is worth stating in code.
    if matches!(promptware_type, "ExecutePlan" | "RetryPlan") {
        let plan_str = plan_folder.to_string_lossy();
        if !plan_str.is_empty() {
            dirs.push(plan_str.to_string());
        }
    }

    dedupe_nested_dirs(dirs)
}

/// Drops duplicates (case-insensitively) and any directory that already has an ancestor in the list,
/// preserving the order the entries were added in.
fn dedupe_nested_dirs(dirs: Vec<String>) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    for dir in dirs {
        let normalized = dir.trim_end_matches(['/', '\\']).to_string();
        if normalized.is_empty() {
            continue;
        }
        let covered = kept.iter().any(|k| is_same_or_ancestor(k, &normalized));
        if !covered {
            kept.push(normalized);
        }
    }
    kept
}

fn is_same_or_ancestor(ancestor: &str, candidate: &str) -> bool {
    let a = ancestor.replace('\\', "/").to_ascii_lowercase();
    let c = candidate.replace('\\', "/").to_ascii_lowercase();
    if a == c {
        return true;
    }
    c.starts_with(&format!("{}/", a))
}

/// The MCP servers a job's agent gets: the project's configured servers, then any additional ones
/// declared in the project's `MCP/mcp.json`.
///
/// Config wins over the file on a name collision, and a malformed `mcp.json` is logged and ignored —
/// a broken side file must never stop a job from launching.
pub fn resolve_mcp_servers(
    settings: &TendrilSettings,
    project_name: &str,
    tendril_home: &Path,
) -> Vec<McpServerConfig> {
    let mut servers: Vec<McpServerConfig> = Vec::new();
    let home = tendril_home.to_string_lossy().to_string();

    if let Some(project) = find_project(settings, project_name) {
        for server in project.mcp_servers.iter().filter(|s| !s.disabled) {
            servers.push(McpServerConfig {
                name: server.name.clone(),
                command: expand_variables(&server.command, &home),
                arguments: server
                    .arguments
                    .iter()
                    .map(|a| expand_variables(a, &home))
                    .collect(),
                environment: server
                    .environment
                    .iter()
                    .map(|(k, v)| (k.clone(), expand_variables(v, &home)))
                    .collect(),
            });
        }
    }

    if project_name.is_empty() {
        return servers;
    }

    let mcp_file = tendril_home
        .join("Projects")
        .join(project_name)
        .join("MCP")
        .join("mcp.json");
    if !mcp_file.is_file() {
        return servers;
    }

    let text = match std::fs::read_to_string(&mcp_file) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("Failed to read {}: {}", mcp_file.display(), e);
            return servers;
        }
    };
    let parsed: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Failed to parse {}: {}", mcp_file.display(), e);
            return servers;
        }
    };
    let Some(entries) = parsed.get("mcpServers").and_then(|v| v.as_object()) else {
        return servers;
    };

    for (name, body) in entries {
        if servers.iter().any(|s| s.name.eq_ignore_ascii_case(name)) {
            continue;
        }
        let command = body
            .get("command")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string();
        let arguments = body
            .get("args")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let environment = body
            .get("env")
            .and_then(|e| e.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        servers.push(McpServerConfig {
            name: name.clone(),
            command,
            arguments,
            environment,
        });
    }

    servers
}

/// The project skills a job's agent gets: the project's configured skills (instructions read off
/// disk when `path` resolves), then any additional skills auto-discovered from
/// `<tendril_home>/Projects/<project>/Skills/`.
///
/// Config wins over disk on a name collision (case-insensitive), and a broken skill (unreadable
/// `path`) falls back to its inline `instructions` rather than being dropped — a broken skill must
/// never stop a job from launching, mirroring [`resolve_mcp_servers`].
pub fn resolve_project_skills(
    settings: &TendrilSettings,
    project_name: &str,
    tendril_home: &Path,
) -> Vec<ProjectSkillInfo> {
    let mut skills: Vec<ProjectSkillInfo> = Vec::new();
    let home = tendril_home.to_string_lossy().to_string();

    if let Some(project) = find_project(settings, project_name) {
        for skill in project.skills.iter().filter(|s| !s.disabled) {
            let mut instructions = skill.instructions.clone().unwrap_or_default();
            if let Some(path) = skill.path.as_ref().filter(|p| !p.trim().is_empty()) {
                let expanded = expand_variables(path, &home);
                let expanded_path = Path::new(&expanded);
                let resolved = if expanded_path.is_file() {
                    std::fs::read_to_string(expanded_path).ok()
                } else if expanded_path.is_dir() {
                    let skill_md = expanded_path.join("SKILL.md");
                    if skill_md.is_file() {
                        std::fs::read_to_string(&skill_md).ok()
                    } else {
                        None
                    }
                } else {
                    None
                };
                match resolved {
                    Some(text) => instructions = text,
                    None => {
                        tracing::warn!(
                            "Failed to read skill path for '{}': {}",
                            skill.name,
                            expanded
                        );
                    }
                }
            }
            skills.push(ProjectSkillInfo {
                name: skill.name.clone(),
                description: skill.description.clone(),
                instructions,
            });
        }
    }

    if project_name.is_empty() {
        return skills;
    }

    let skills_dir = project_skills_dir(tendril_home, project_name);
    if !skills_dir.is_dir() {
        return skills;
    }

    let mut disk_entries: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let skill_md = path.join("SKILL.md");
                if skill_md.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    disk_entries.push((name, skill_md));
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    disk_entries.push((stem.to_string(), path.clone()));
                }
            }
        }
    }
    disk_entries.sort_by(|a, b| a.0.cmp(&b.0));

    for (name, skill_md) in disk_entries {
        if skills.iter().any(|s| s.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let Ok(instructions) = std::fs::read_to_string(&skill_md) else {
            continue;
        };
        skills.push(ProjectSkillInfo {
            name,
            description: "Disk skill".to_string(),
            instructions,
        });
    }

    skills
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
