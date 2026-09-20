//! Resolving and cloning the repository an `import` subcommand names.
//!
//! `import`, `import-mcp` and `import-skills` all have to turn a `--repo` (a name, a path suffix or
//! nothing at all) into one repo of one project, and only `import` may also be handed a remote URL
//! to clone first.

use std::path::{Path, PathBuf};
use tendril_core::config::{expand_variables, sanitize_project_name};
use tendril_core::git::clone::{
    clone_or_refresh_with, extract_repo_name, CloneFailure, CloneOptions,
};
use tendril_core::git::clone::{is_remote_url, redact_credentials};
use tendril_core::models::ProjectConfig;

/// The local directory to scan for an `import*` verb.
///
/// `repo_arg` may name one of the project's repos (by configured path, final segment, or path
/// suffix), a path on disk, or a git URL — a URL is shallow-cloned into the import cache so the
/// scanners only ever see a real directory.
pub(super) fn resolve_import_repo(
    project: &ProjectConfig,
    repo_arg: &str,
    tendril_home: &Path,
) -> anyhow::Result<PathBuf> {
    let target = project
        .repos
        .iter()
        .find(|r| {
            r.path.eq_ignore_ascii_case(repo_arg)
                || final_path_segment(&r.path).eq_ignore_ascii_case(repo_arg)
                || ends_with_segment(&r.path, repo_arg)
        })
        .map(|r| r.path.clone())
        .unwrap_or_else(|| repo_arg.to_string());

    let expanded = expand_variables(target.trim(), &tendril_home.to_string_lossy());
    let path = PathBuf::from(&expanded);
    if path.is_dir() {
        return Ok(path.canonicalize().unwrap_or(path));
    }

    if is_remote_url(&expanded) {
        return clone_for_import(&expanded, tendril_home);
    }

    // Reached by anything that is neither a directory nor a transport `is_remote_url` knows, which
    // includes credential-bearing URLs on a scheme it rejects (`ftp://u:p@host/o/r`).
    anyhow::bail!(
        "Repository path not found: {}",
        redact_credentials(&expanded)
    );
}

fn final_path_segment(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
}

fn ends_with_segment(path: &str, segment: &str) -> bool {
    let lower = path.to_lowercase();
    let needle = segment.to_lowercase();
    lower.ends_with(&format!("/{}", needle)) || lower.ends_with(&format!("\\{}", needle))
}

/// Shallow-clones `url` into `<TendrilHome>/Cache/Imports/<repo-name>`, refreshing an existing
/// clone rather than re-fetching it.
///
/// The clone itself is [`tendril_core::git::clone::clone_or_refresh_with`], which is also what the
/// daemon's project routes use — so the credential redaction around git's stderr is written once.
/// This cache is only ever read by the `import*` scanners, hence `--depth 1`; a project repo is
/// cloned in full.
pub(super) fn clone_for_import(url: &str, tendril_home: &Path) -> anyhow::Result<PathBuf> {
    let repo_name = extract_repo_name(url).unwrap_or_else(|| final_path_segment(url).to_string());
    let sanitized = sanitize_project_name(&repo_name);
    let name = if sanitized.is_empty() {
        "remote-repo".to_string()
    } else {
        sanitized
    };

    let target_dir = tendril_home.join("Cache").join("Imports").join(&name);
    let options = CloneOptions { depth: Some(1) };

    match clone_or_refresh_with(url, &target_dir, options) {
        Ok(cloned) => Ok(cloned.path),
        // A cache entry that is stale, half-written, or left over from a different remote of the
        // same name is not worth diagnosing: throw it away and clone again, which is what the user
        // asked for anyway. Only the cache is disposable like this — the daemon's project repos
        // are not, and it reports the same conflict instead.
        Err(e) if e.kind == CloneFailure::DestinationConflict && target_dir.exists() => {
            std::fs::remove_dir_all(&target_dir)?;
            Ok(clone_or_refresh_with(url, &target_dir, options)?.path)
        }
        Err(e) => anyhow::bail!("{}", e.message),
    }
}
