//! Confines `GET /ivy/local-file` to a set of configured roots — the piece that actually stops an
//! arbitrary file read. A port of `Controllers/LocalFileRootPolicy.cs`.
//!
//! Two rules carry the whole guarantee:
//!
//! 1. **Fail closed.** An empty root list denies everything, unlike a general-purpose "no
//!    restriction when unset" policy.
//! 2. **Canonicalise, then contain.** Containment is decided on the fully symlink-resolved path,
//!    never by string-prefix matching on the raw input, so neither `..` traversal nor a symlink
//!    (final component *or* mid-path directory) can point out of a root.

use std::collections::VecDeque;
use std::path::{Component, Path, PathBuf};

use crate::config::{expand_variables, TendrilSettings};

/// Maximum symlink hops before a path is rejected outright, matching `MaxLinkHops`.
const MAX_LINK_HOPS: usize = 40;

/// Every directory `GET /ivy/local-file` may serve from: the Tendril home, the plans folder, every
/// configured project repo and every `security.localFileRoots` entry.
///
/// A root can itself sit behind a symlink (macOS's `/var -> /private/var`), so both the expanded and
/// the fully resolved form of each candidate are kept — a request resolved to its real path would
/// otherwise never match a symlinked root. An unresolvable candidate is skipped, not fatal.
pub fn compute_roots(
    settings: &TendrilSettings,
    tendril_home: &Path,
    plans_dir: &Path,
) -> Vec<PathBuf> {
    let home_str = tendril_home.to_string_lossy().to_string();

    let mut candidates: Vec<String> =
        vec![home_str.clone(), plans_dir.to_string_lossy().to_string()];

    for project in &settings.projects {
        candidates.extend(project.repo_paths());
    }

    if let Some(extra) = settings
        .security
        .as_ref()
        .and_then(|s| s.local_file_roots.as_ref())
    {
        candidates.extend(extra.iter().cloned());
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    for candidate in candidates {
        if candidate.trim().is_empty() {
            continue;
        }

        let expanded = expand_variables(candidate.trim(), &home_str);
        let Some(normalized) = absolutize(Path::new(&expanded)) else {
            continue;
        };
        let normalized = trim_trailing_separators(&normalized);
        if normalized.as_os_str().is_empty() {
            continue;
        }

        push_unique(&mut roots, normalized.clone());

        if let Some(resolved) = resolve_real_path(&normalized) {
            push_unique(&mut roots, trim_trailing_separators(&resolved));
        }
    }

    roots
}

/// Resolves a requested path against the allowed roots, returning the absolute (pre-symlink) path to
/// serve, or `None` if it must be refused.
///
/// Refused before any filesystem access: an empty path, an empty root list, a path containing a null
/// byte, an NT-style (`\\?\`) or UNC (`\\host\share`) path, and any path with a `..` component.
/// Refused after resolution: anything whose real path falls outside every root, including a symlink
/// escape and a symlink cycle.
pub fn try_resolve(path: &str, roots: &[PathBuf]) -> Option<PathBuf> {
    if path.is_empty() || roots.is_empty() {
        return None;
    }

    if is_rejected_shape(path) {
        return None;
    }

    let absolute = absolutize(Path::new(path))?;

    // The resolved form decides containment; the caller is handed the unresolved path back so it
    // serves what was asked for rather than the link target.
    let resolved = resolve_real_path(&absolute)?;
    if roots.iter().any(|root| is_within_root(&resolved, root)) {
        Some(absolute)
    } else {
        None
    }
}

/// `realpath`-style resolution: walks every component, not just the last, and follows each symlink
/// it finds, so a symlinked directory in the middle of the path is followed too.
///
/// Hops are counted here rather than delegated to a "resolve everything" call, so a symlink cycle is
/// rejected (`None`) instead of falling back to the unresolved — still-contained-looking — input. A
/// component that does not exist or cannot be read is not a symlink: keep walking and let
/// containment decide, which preserves the response for e.g. a deleted screenshot.
pub fn resolve_real_path(path: &Path) -> Option<PathBuf> {
    let (mut root, mut pending) = split_absolute(path)?;
    let mut accepted: Vec<String> = Vec::new();
    let mut hops = 0usize;

    while let Some(component) = pending.pop_front() {
        if component == "." {
            continue;
        }
        if component == ".." {
            accepted.pop();
            continue;
        }

        let candidate = build_path(&root, &accepted).join(&component);
        let link_target = std::fs::symlink_metadata(&candidate)
            .ok()
            .filter(|meta| meta.file_type().is_symlink())
            .and_then(|_| std::fs::read_link(&candidate).ok());

        let Some(target) = link_target else {
            accepted.push(component);
            continue;
        };

        hops += 1;
        if hops > MAX_LINK_HOPS {
            return None;
        }

        // A relative link target resolves against the directory holding the link.
        let absolute_target = if target.is_absolute() {
            target
        } else {
            build_path(&root, &accepted).join(target)
        };

        let (target_root, target_components) = split_absolute(&absolute_target)?;
        let mut requeued = target_components;
        requeued.extend(std::mem::take(&mut pending));

        root = target_root;
        accepted = Vec::new();
        pending = requeued;
    }

    Some(build_path(&root, &accepted))
}

/// Shapes refused up front, before the filesystem is touched at all. Each of these only ever
/// narrows what is servable, so rejecting them cannot break a legitimate request.
fn is_rejected_shape(path: &str) -> bool {
    if path.contains('\0') {
        return true;
    }

    // NT-style (`\\?\C:\...`, `\\.\...`) and UNC (`\\host\share\...`) paths. Checked on every
    // platform: a Windows-shaped path arriving at a Unix daemon has no business being served either.
    let backslashed = path.replace('\\', "/");
    if backslashed.starts_with("//") {
        return true;
    }

    // Any `..` component. Canonicalise-then-contain below would already catch an escape, but a
    // traversal attempt is never a legitimate screenshot path, so it does not get that far.
    backslashed.split('/').any(|segment| segment.trim() == "..")
}

/// Makes `path` absolute (against the process working directory, as `Path.GetFullPath` does) and
/// removes `.` / `..` lexically. Returns `None` when the working directory is unavailable.
fn absolutize(path: &Path) -> Option<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().ok()?.join(path)
    };

    let (root, components) = split_absolute(&absolute)?;
    let mut accepted: Vec<String> = Vec::new();
    for component in components {
        match component.as_str() {
            "." => {}
            ".." => {
                accepted.pop();
            }
            _ => accepted.push(component),
        }
    }

    Some(build_path(&root, &accepted))
}

/// Splits an absolute path into its root (prefix + separator) and its remaining components.
fn split_absolute(path: &Path) -> Option<(PathBuf, VecDeque<String>)> {
    let mut root = PathBuf::new();
    let mut components: VecDeque<String> = VecDeque::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => root.push(prefix.as_os_str()),
            Component::RootDir => root.push(std::path::MAIN_SEPARATOR_STR),
            Component::CurDir => components.push_back(".".to_string()),
            Component::ParentDir => components.push_back("..".to_string()),
            Component::Normal(part) => components.push_back(part.to_string_lossy().to_string()),
        }
    }

    if root.as_os_str().is_empty() {
        return None;
    }

    Some((root, components))
}

fn build_path(root: &Path, components: &[String]) -> PathBuf {
    let mut path = root.to_path_buf();
    for component in components {
        path.push(component);
    }
    path
}

fn trim_trailing_separators(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    let trimmed = raw.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        path.to_path_buf()
    } else {
        PathBuf::from(trimmed)
    }
}

/// Case-insensitive containment, matching the original's `OrdinalIgnoreCase` on every platform.
/// Comparing case-insensitively on a case-sensitive filesystem only ever narrows what is servable
/// (two roots that differ in case collapse into one), never widens it.
fn is_within_root(path: &Path, root: &Path) -> bool {
    let path_key = compare_key(path);
    let root_key = compare_key(root);

    if path_key == root_key {
        return true;
    }

    path_key.starts_with(&format!("{root_key}/"))
}

fn compare_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

fn push_unique(roots: &mut Vec<PathBuf>, candidate: PathBuf) {
    let key = compare_key(&candidate);
    if key.is_empty() {
        return;
    }
    if roots.iter().any(|existing| compare_key(existing) == key) {
        return;
    }
    roots.push(candidate);
}
