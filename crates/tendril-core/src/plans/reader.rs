use std::path::Path;
use crate::error::{Result, TendrilError};
use crate::models::{PlanFile, PlanMetadata, PlanStatus, PlanYaml};
use crate::plans::revisions::get_revision;

pub fn read_plan_yaml(plan_folder: &Path) -> Result<(PlanYaml, String)> {
    let yaml_path = plan_folder.join("plan.yaml");
    if !yaml_path.exists() {
        return Err(TendrilError::PlanNotFound(format!("plan.yaml not found at {}", yaml_path.display())));
    }

    let raw = std::fs::read_to_string(&yaml_path)?;
    let plan: PlanYaml = serde_yaml::from_str(&raw)
        .map_err(|e| TendrilError::Plan(format!("Failed to parse {}: {}", yaml_path.display(), e)))?;

    Ok((plan, raw))
}

pub fn read_plan_file(plan_folder: &Path) -> Result<PlanFile> {
    let (plan_yaml, yaml_raw) = read_plan_yaml(plan_folder)?;
    let folder_name = plan_folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let id = if folder_name.len() >= 5 {
        folder_name[..5].parse::<i32>().unwrap_or(0)
    } else {
        0
    };

    let state = PlanStatus::from_str_loose(&plan_yaml.state).unwrap_or(PlanStatus::Draft);
    let latest_revision_content = get_revision(plan_folder, None)?;

    // Count revisions
    let rev_dir = plan_folder.join("Revisions");
    let revision_count = if rev_dir.exists() {
        std::fs::read_dir(&rev_dir)?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("md"))
            .count() as i32
    } else {
        0
    };

    let metadata = PlanMetadata {
        id,
        project: plan_yaml.project,
        level: plan_yaml.level,
        title: plan_yaml.title,
        state,
        repos: plan_yaml.repos,
        commits: plan_yaml.commits,
        prs: plan_yaml.prs,
        verifications: plan_yaml.verifications,
        related_plans: plan_yaml.related_plans,
        depends_on: plan_yaml.depends_on,
        created: plan_yaml.created,
        updated: plan_yaml.updated,
        initial_prompt: plan_yaml.initial_prompt,
        source_url: plan_yaml.source_url,
        partial_delivery: plan_yaml.partial_delivery,
    };

    Ok(PlanFile {
        metadata,
        latest_revision_content,
        folder_path: plan_folder.to_string_lossy().to_string(),
        folder_name,
        yaml_raw,
        revision_count,
    })
}
