//! Repo skill scanning and import, and the on-disk `Skills` directory helper.
//!
//! This is the surface the (separately planned) `project list-skills / add-skill / remove-skill /
//! import-skills` CLI verbs call. See [`crate::jobs::firmware_values::resolve_project_skills`] for
//! how a project's configured and disk-discovered skills are resolved for a job's firmware.

use crate::error::Result;
use crate::models::ProjectSkillRef;
use std::path::{Path, PathBuf};

/// A skill found while scanning a repo, not yet imported into a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredSkill {
    pub name: String,
    pub description: String,
    pub instructions: String,
    pub skill_folder_path: String,
    pub relative_path: String,
}

const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "bin",
    "obj",
    "dist",
    "build",
    ".vs",
    ".idea",
    ".venv",
    "venv",
    ".cache",
    "target",
];

fn is_ignored_directory(name: &str) -> bool {
    IGNORED_DIRECTORIES
        .iter()
        .any(|ignored| ignored.eq_ignore_ascii_case(name))
}

/// `<tendril_home>/Projects/<project_name>/Skills`
pub fn project_skills_dir(tendril_home: &Path, project_name: &str) -> PathBuf {
    tendril_home
        .join("Projects")
        .join(project_name)
        .join("Skills")
}

/// Every `SKILL.md`-bearing folder in a repo, for `project import-skills`. Ignores directories in
/// [`IGNORED_DIRECTORIES`], caps recursion at depth 6, and dedupes on a case-insensitive name
/// collision (first found wins). Sibling entries are visited in name order for determinism.
pub fn scan_repo_skills(repo_path: &Path) -> Vec<DiscoveredSkill> {
    let mut results = Vec::new();
    if !repo_path.is_dir() {
        return results;
    }
    scan_repo_skills_recursive(repo_path, repo_path, &mut results, 6, 0);
    results
}

fn scan_repo_skills_recursive(
    root_path: &Path,
    current_path: &Path,
    results: &mut Vec<DiscoveredSkill>,
    max_depth: usize,
    current_depth: usize,
) {
    if current_depth > max_depth {
        return;
    }

    let Ok(entries) = std::fs::read_dir(current_path) else {
        return;
    };
    let mut dir_names = Vec::new();
    let mut skill_file = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            dir_names.push(path);
        } else if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            if file_name.eq_ignore_ascii_case("SKILL.md") {
                skill_file = Some(path);
            }
        }
    }

    if let Some(skill_file) = skill_file {
        let dir_name = current_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        let (name, description, instructions) = parse_skill_markdown(&skill_file, dir_name);
        let relative_path = current_path
            .strip_prefix(root_path)
            .unwrap_or(current_path)
            .to_string_lossy()
            .to_string();
        if !results
            .iter()
            .any(|s: &DiscoveredSkill| s.name.eq_ignore_ascii_case(&name))
        {
            results.push(DiscoveredSkill {
                name,
                description,
                instructions,
                skill_folder_path: current_path.to_string_lossy().to_string(),
                relative_path,
            });
        }
    }

    dir_names.sort();
    for sub_dir in dir_names {
        let dir_name = sub_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if is_ignored_directory(dir_name) {
            continue;
        }
        scan_repo_skills_recursive(root_path, &sub_dir, results, max_depth, current_depth + 1);
    }
}

/// Frontmatter `name` / `description`, body as instructions. On a malformed frontmatter block, or
/// a read error, the whole file (or nothing) becomes the instructions and `fallback_name` is used.
pub fn parse_skill_markdown(skill_file: &Path, fallback_name: &str) -> (String, String, String) {
    let content = match std::fs::read_to_string(skill_file) {
        Ok(c) => c,
        Err(_) => {
            return (
                fallback_name.to_string(),
                format!("Custom skill {}", fallback_name),
                String::new(),
            )
        }
    };

    let mut name = fallback_name.to_string();
    let mut description = String::new();
    let mut instructions = content.clone();

    if let Some(rest) = content.strip_prefix("---") {
        if let Some(end) = rest.find("---") {
            let yaml = &rest[..end];
            instructions = rest[end + 3..].trim().to_string();

            #[derive(serde::Deserialize, Default)]
            struct Frontmatter {
                name: Option<String>,
                description: Option<String>,
            }

            if let Ok(fm) = serde_yaml::from_str::<Frontmatter>(yaml) {
                if let Some(n) = fm.name.filter(|n| !n.trim().is_empty()) {
                    name = n.trim().to_string();
                }
                if let Some(d) = fm.description.filter(|d| !d.trim().is_empty()) {
                    description = d.trim().to_string();
                }
            }
        }
    }

    if description.is_empty() && !instructions.is_empty() {
        if let Some(first_line) = instructions
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty() && !l.starts_with('#'))
        {
            description = if first_line.len() > 100 {
                format!("{}...", &first_line[..97])
            } else {
                first_line.to_string()
            };
        }
    }

    if description.is_empty() {
        description = format!("Custom skill {}", name);
    }

    (name, description, instructions)
}

fn copy_directory(source_dir: &Path, target_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(target_dir)?;

    for entry in std::fs::read_dir(source_dir)?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let dir_name = entry.file_name().to_string_lossy().to_string();
            if is_ignored_directory(&dir_name) {
                continue;
            }
            copy_directory(&path, &target_dir.join(&dir_name))?;
        } else {
            let file_name = entry.file_name();
            std::fs::copy(&path, target_dir.join(&file_name))?;
        }
    }

    Ok(())
}

/// Copies a discovered skill under the project's Skills dir and returns the config entry for it.
///
/// `copy_files: true` copies the discovered folder recursively. `copy_files: false` only writes a
/// synthesized `SKILL.md` (from `skill.description` and `skill.instructions`), and only when the
/// target does not already exist.
pub fn import_skill_to_project(
    tendril_home: &Path,
    project_name: &str,
    skill: &DiscoveredSkill,
    copy_files: bool,
) -> Result<ProjectSkillRef> {
    let target_dir = project_skills_dir(tendril_home, project_name).join(&skill.name);

    if copy_files && Path::new(&skill.skill_folder_path).is_dir() {
        copy_directory(Path::new(&skill.skill_folder_path), &target_dir)?;
    } else if !target_dir.is_dir() && !skill.instructions.trim().is_empty() {
        std::fs::create_dir_all(&target_dir)?;
        let skill_md = target_dir.join("SKILL.md");
        std::fs::write(
            &skill_md,
            format!(
                "---\nname: {}\ndescription: {}\n---\n\n{}",
                skill.name, skill.description, skill.instructions
            ),
        )?;
    }

    Ok(ProjectSkillRef {
        name: skill.name.clone(),
        description: skill.description.clone(),
        path: Some(format!(
            "%TENDRIL_HOME%/Projects/{}/Skills/{}",
            project_name, skill.name
        )),
        instructions: None,
        disabled: false,
        extra: Default::default(),
    })
}
