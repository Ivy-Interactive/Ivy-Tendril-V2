use crate::error::{Result, TendrilError};
use regex::Regex;
use std::path::{Path, PathBuf};

pub fn to_safe_title(title: &str) -> String {
    let re = Regex::new(r"[^a-zA-Z0-9\s-]").unwrap();
    let cleaned = re.replace_all(title, "");
    cleaned
        .split_whitespace()
        .map(|word| {
            let mut c = word.chars();
            match c.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<String>()
}

pub fn allocate_plan_id(plans_dir: &Path) -> Result<String> {
    let mut max_id = 0;

    if plans_dir.exists() {
        for entry in std::fs::read_dir(plans_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.len() >= 5 {
                    if let Ok(id) = name_str[..5].parse::<i32>() {
                        if id > max_id {
                            max_id = id;
                        }
                    }
                }
            }
        }
    }

    Ok(format!("{:05}", max_id + 1))
}

pub fn resolve_plan_folder(plan_id_or_path: &str, plans_dir: &Path) -> Result<PathBuf> {
    let input_path = PathBuf::from(plan_id_or_path);
    if input_path.is_absolute() && input_path.exists() {
        return Ok(input_path);
    }

    if plans_dir.join(plan_id_or_path).exists() {
        return Ok(plans_dir.join(plan_id_or_path));
    }

    // Try finding by prefix / numeric ID
    let search_id = if let Ok(num) = plan_id_or_path.parse::<i32>() {
        format!("{:05}", num)
    } else {
        plan_id_or_path.to_string()
    };

    if plans_dir.exists() {
        for entry in std::fs::read_dir(plans_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with(&search_id) {
                    return Ok(entry.path());
                }
            }
        }
    }

    Err(TendrilError::PlanNotFound(format!(
        "Could not resolve plan folder for '{}' in {}",
        plan_id_or_path,
        plans_dir.display()
    )))
}

/// Resolves any accepted plan reference to its canonical folder name, e.g. `42`, `00042`,
/// `00042-FixLoginBug` and `/abs/path/00042-FixLoginBug` all -> `00042-FixLoginBug`.
pub fn resolve_plan_folder_name(plan_ref: &str, plans_dir: &Path) -> Result<String> {
    let folder = resolve_plan_folder(plan_ref, plans_dir)?;
    folder
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_string())
        .ok_or_else(|| {
            TendrilError::PlanNotFound(format!(
                "Could not resolve a folder name for '{}' in {}",
                plan_ref,
                plans_dir.display()
            ))
        })
}

/// How a project rename landed across the plans on disk.
///
/// Two numbers rather than one because the sweep does not stop at the first plan it cannot write,
/// and a caller that only saw `renamed` would read a partial sweep as a complete one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectRenameOutcome {
    /// Plans rewritten to carry `new_name`.
    pub renamed: usize,
    /// One entry per plan that still names the old project, as `(folder name, why)`.
    pub failed: Vec<(String, String)>,
}

impl ProjectRenameOutcome {
    /// True when at least one plan still names the project the rename was supposed to retire.
    pub fn is_partial(&self) -> bool {
        !self.failed.is_empty()
    }

    /// One line naming the count and the folders, for a log or a CLI warning.
    ///
    /// Folder names only — a plan folder name is derived from its title, never from a path the
    /// operator supplied, so this cannot carry a credential the way a repo path can.
    pub fn failure_summary(&self) -> String {
        let folders: Vec<&str> = self.failed.iter().map(|(f, _)| f.as_str()).collect();
        format!(
            "{} plan(s) still name the old project ({})",
            self.failed.len(),
            folders.join(", ")
        )
    }
}

/// Rewrites every plan naming `old_name` to name `new_name` instead.
///
/// The sweep is **exhaustive, not fail-fast**: one plan that cannot be written does not abort the
/// rest. The previous `?` on the write meant a single locked or read-only `plan.yaml` left every
/// plan after it in `read_dir` order still naming a project that no longer exists in `config.yaml`
/// — and unrecoverably so, because the caller has already saved the rename, so a retry finds the
/// old name gone, computes no rename at all, and never sweeps again. Which plans survived was
/// decided by directory order, which is not a contract anyone can rely on.
///
/// A folder that cannot be *read* is skipped without being counted as a failure, matching the
/// previous behaviour: it is not a plan this function can identify as belonging to the project.
/// Only a plan that was identified and then could not be rewritten is a failure.
///
/// Returns [`ProjectRenameOutcome`] rather than `usize` so a partial sweep is something the caller
/// can see and report. `Err` is now reserved for not being able to enumerate `plans_dir` at all.
pub fn rename_project_in_plans(
    plans_dir: &Path,
    old_name: &str,
    new_name: &str,
) -> Result<ProjectRenameOutcome> {
    let mut outcome = ProjectRenameOutcome::default();
    if !plans_dir.exists() {
        return Ok(outcome);
    }

    for entry in std::fs::read_dir(plans_dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            let plan_folder = entry.path();
            if let Ok((mut plan, _)) = crate::plans::reader::read_plan_yaml(&plan_folder) {
                if plan.project.eq_ignore_ascii_case(old_name) {
                    plan.project = new_name.to_string();
                    plan.updated = chrono::Utc::now();
                    match crate::plans::writer::write_plan_yaml(&plan_folder, &plan) {
                        Ok(()) => outcome.renamed += 1,
                        Err(e) => outcome.failed.push((
                            plan_folder
                                .file_name()
                                .map(|n| n.to_string_lossy().into_owned())
                                .unwrap_or_else(|| plan_folder.display().to_string()),
                            e.to_string(),
                        )),
                    }
                }
            }
        }
    }

    Ok(outcome)
}
