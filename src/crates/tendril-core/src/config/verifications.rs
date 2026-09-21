//! Verification entries as they sit inside a project: which projects reference one, removing one
//! everywhere, and the ordered insert/move operations whose order is the run order.

use super::settings::TendrilSettings;
use crate::error::{Result, TendrilError};
use crate::models::{ProjectConfig, ProjectVerificationRef};

pub fn find_projects_referencing_verification(
    settings: &TendrilSettings,
    verification_name: &str,
) -> Vec<String> {
    settings
        .projects
        .iter()
        .filter(|p| {
            p.verifications
                .iter()
                .any(|v| v.name.eq_ignore_ascii_case(verification_name))
        })
        .map(|p| p.name.clone())
        .collect()
}

pub fn remove_verification_from_projects(
    settings: &mut TendrilSettings,
    verification_name: &str,
) -> Vec<String> {
    let mut modified = Vec::new();
    for p in &mut settings.projects {
        let before_len = p.verifications.len();
        p.verifications
            .retain(|v| !v.name.eq_ignore_ascii_case(verification_name));
        if p.verifications.len() != before_len {
            modified.push(p.name.clone());
        }
    }
    modified
}

/// Where a verification goes in a project's ordered verification list. The order is the run
/// order, which is why moving an entry is a first-class operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerificationPlacement {
    /// Immediately before the named verification.
    Before(String),
    /// Immediately after the named verification.
    After(String),
    /// At this zero-based index, clamped to the list length.
    Position(usize),
}

/// Resolves a placement to an insert index against `verifications` as it stands. For a move,
/// pass the list with the moved entry already removed — that is what makes `--after` behave
/// correctly when an entry moves forward.
fn resolve_insert_index(
    verifications: &[ProjectVerificationRef],
    placement: &VerificationPlacement,
) -> Result<usize> {
    let find = |name: &str| {
        verifications
            .iter()
            .position(|v| v.name.eq_ignore_ascii_case(name))
    };
    let available = || {
        verifications
            .iter()
            .map(|v| v.name.clone())
            .collect::<Vec<_>>()
            .join(", ")
    };

    match placement {
        VerificationPlacement::Before(name) => find(name).ok_or_else(|| {
            TendrilError::Config(format!(
                "Target verification for --before not found: '{}'. Available: {}",
                name,
                available()
            ))
        }),
        VerificationPlacement::After(name) => find(name).map(|i| i + 1).ok_or_else(|| {
            TendrilError::Config(format!(
                "Target verification for --after not found: '{}'. Available: {}",
                name,
                available()
            ))
        }),
        VerificationPlacement::Position(n) => Ok((*n).min(verifications.len())),
    }
}

/// Moves an existing verification within a project, returning the index it landed at.
/// The list is left untouched if the placement target cannot be resolved.
pub fn move_project_verification(
    project: &mut ProjectConfig,
    verification: &str,
    placement: &VerificationPlacement,
) -> Result<usize> {
    let current = project
        .verifications
        .iter()
        .position(|v| v.name.eq_ignore_ascii_case(verification))
        .ok_or_else(|| {
            TendrilError::Config(format!(
                "Verification not found: '{}'. Available: {}",
                verification,
                project
                    .verifications
                    .iter()
                    .map(|v| v.name.clone())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })?;

    // Resolve against the shortened list, but before mutating, so a bad target leaves the
    // project's order exactly as it was.
    let mut shortened = project.verifications.clone();
    let item = shortened.remove(current);
    let insert_index = resolve_insert_index(&shortened, placement)?;

    shortened.insert(insert_index, item);
    project.verifications = shortened;
    Ok(insert_index)
}

/// Inserts a new verification into a project, returning the index it landed at.
/// `after: None` appends. Errors if the verification is already present, or if `after`
/// names a verification the project does not have.
pub fn insert_project_verification(
    project: &mut ProjectConfig,
    entry: ProjectVerificationRef,
    after: Option<&str>,
) -> Result<usize> {
    if project
        .verifications
        .iter()
        .any(|v| v.name.eq_ignore_ascii_case(&entry.name))
    {
        return Err(TendrilError::Config(format!(
            "Verification already exists in project: {}",
            entry.name
        )));
    }

    let insert_index = match after {
        Some(name) => resolve_insert_index(
            &project.verifications,
            &VerificationPlacement::After(name.to_string()),
        )?,
        None => project.verifications.len(),
    };

    project.verifications.insert(insert_index, entry);
    Ok(insert_index)
}
