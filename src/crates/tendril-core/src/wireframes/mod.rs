//! Where a plan's wireframes live, and the rules that keep them there.
//!
//! Ported from V1's `Services/Wireframes/*.cs`.
//!
//! Wireframes are throwaway plan material: they sit in the plan folder beside `Revisions/`, never in
//! a project repo or a worktree, and exist only to show the user what will be built and to guide the
//! agent that builds it. The leak guard is what enforces the "never" -- see [`leak_guard`].

pub mod fence;
pub mod leak_guard;

use std::path::{Path, PathBuf};

/// The folder inside a plan that holds its wireframes.
pub const FOLDER_NAME: &str = "Wireframes";

/// Where Tendril serves plan previews from. Reserved: the app's own router must not claim it.
pub const ROUTE_PREFIX: &str = "/__wireframes";

/// The address a plan's `wireframe` fences resolve their names against.
pub fn base_url(plan_id: i64) -> String {
    format!("{ROUTE_PREFIX}/{plan_id}/")
}

/// A wireframe name is a lowercase slug: it becomes a folder name and a URL segment.
///
/// Deliberately strict. The name arrives from a markdown fence an agent wrote, and it is used to
/// build a filesystem path, so anything that could traverse or collide across case-insensitive
/// filesystems is refused rather than sanitised.
pub fn is_valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }
    if name.len() > 64 {
        return false;
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A scope is a plan id: digits only, and short enough that it cannot be a path of its own.
pub fn is_valid_scope(scope: &str) -> bool {
    !scope.is_empty() && scope.len() <= 9 && scope.chars().all(|c| c.is_ascii_digit())
}

/// The project directory for one of a plan's wireframes, or `None` when the plan does not exist.
///
/// The directory itself may not exist yet; the host reports that as a missing wireframe rather than
/// as an error, because an agent can reference a wireframe in a revision before it writes one.
pub fn resolve_root(plans_directory: Option<&Path>, scope: &str, name: &str) -> Option<PathBuf> {
    let plans_directory = plans_directory?;
    if !plans_directory.is_dir() {
        return None;
    }
    if !is_valid_name(name) || !is_valid_scope(scope) {
        return None;
    }
    let plan_id: i64 = scope.parse().ok()?;

    // Plan folders are `NNNNN-Title`, so the id is zero-padded to five digits.
    let prefix = format!("{plan_id:05}-");
    let folder = std::fs::read_dir(plans_directory)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(&prefix))
        })?;

    Some(folder.join(FOLDER_NAME).join(name))
}

/// The nearest enclosing plan folder: a `NNNNN-Title` directory holding a `plan.yaml`.
pub fn find_plan_folder(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(dir) = current {
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            let looks_like_a_plan = name.len() > 6
                && name[..5].chars().all(|c| c.is_ascii_digit())
                && name.as_bytes()[5] == b'-';
            if looks_like_a_plan && dir.join("plan.yaml").is_file() {
                return Some(dir.to_path_buf());
            }
        }
        current = dir.parent();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_a_lowercase_slug() {
        assert!(is_valid_name("checkout"));
        assert!(is_valid_name("sign-in-v2"));
        assert!(is_valid_name("0"));

        // It becomes a folder name and a URL segment, so none of these may pass.
        assert!(!is_valid_name(""));
        assert!(!is_valid_name("-leading"));
        assert!(!is_valid_name("Checkout"), "case would collide on Windows");
        assert!(!is_valid_name("check out"));
        assert!(!is_valid_name("../escape"));
        assert!(!is_valid_name("check/out"));
        assert!(!is_valid_name("check.out"));
        assert!(!is_valid_name(&"a".repeat(65)));
        assert!(is_valid_name(&"a".repeat(64)));
    }

    #[test]
    fn a_scope_is_a_plan_id() {
        assert!(is_valid_scope("99"));
        assert!(is_valid_scope("000099"));
        assert!(!is_valid_scope(""));
        assert!(!is_valid_scope("99a"));
        assert!(!is_valid_scope("../99"));
        assert!(!is_valid_scope("1234567890"), "longer than any plan id");
    }

    #[test]
    fn the_base_url_is_where_a_fence_resolves_names() {
        assert_eq!(base_url(99), "/__wireframes/99/");
    }

    #[test]
    fn resolve_root_finds_the_zero_padded_plan_folder() {
        let dir = tempfile::tempdir().unwrap();
        let plan = dir.path().join("00099-Add-Checkout");
        std::fs::create_dir_all(&plan).unwrap();

        let root = resolve_root(Some(dir.path()), "99", "checkout").unwrap();
        assert_eq!(root, plan.join("Wireframes").join("checkout"));
        // The directory need not exist yet: a revision can name a wireframe before one is written.
        assert!(!root.exists());
    }

    #[test]
    fn resolve_root_refuses_a_crafted_name_or_scope() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("00099-Add-Checkout")).unwrap();

        assert!(resolve_root(Some(dir.path()), "99", "../../etc").is_none());
        assert!(resolve_root(Some(dir.path()), "../99", "checkout").is_none());
        assert!(resolve_root(Some(dir.path()), "99", "Checkout").is_none());
        // A plan that does not exist resolves to nothing rather than to a path under Plans/.
        assert!(resolve_root(Some(dir.path()), "12345", "checkout").is_none());
    }

    #[test]
    fn find_plan_folder_walks_up_to_the_nearest_plan() {
        let dir = tempfile::tempdir().unwrap();
        let plan = dir.path().join("00099-Add-Checkout");
        let nested = plan.join("Wireframes").join("checkout").join("src");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(plan.join("plan.yaml"), "project: demo\n").unwrap();

        assert_eq!(find_plan_folder(&nested).unwrap(), plan);
        assert_eq!(find_plan_folder(&plan).unwrap(), plan);
    }

    #[test]
    fn a_directory_that_merely_looks_like_a_plan_is_not_one() {
        // The plan.yaml is what makes it a plan; a folder named like one is not enough, or a
        // wireframe scaffolded anywhere under a numbered directory would be treated as plan
        // material.
        let dir = tempfile::tempdir().unwrap();
        let impostor = dir.path().join("00099-Not-A-Plan");
        std::fs::create_dir_all(&impostor).unwrap();
        assert!(find_plan_folder(&impostor).is_none());
    }
}
