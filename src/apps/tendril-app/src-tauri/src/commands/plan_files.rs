//! Two reads the plan and review pages' sheets need, answered on the native side from the plan's
//! own repos.
//!
//! * [`cmd_get_plan_commit`] — V1's `CommitDetailSheet` (`Apps/Views/Sheets/CommitDetailSheet.cs`):
//!   one of a plan's commits, looked up in each repo the plan names (`GetEffectiveRepoPaths`) and then
//!   in its surviving worktrees, the order `PlanContentHelpers.GetAllChangesData` uses.
//! * [`cmd_get_plan_file_content`] — V1's `FileSheet` (`Apps/Views/Sheets/FileSheet.cs`): a local file
//!   a plan's markdown links to.
//!
//! Neither has a daemon route, and neither needs one for the reason `cmd_get_verification_report`
//! gives: the daemon is loopback-only and its `.master` lives under `TENDRIL_HOME`, so the plan folder
//! and its repos are on this machine. Both go straight to `tendril_core`, the same code the Changes
//! tab's fallback read (`cmd_get_plan_changes`) uses.
//!
//! **What the file read may reach is narrower than V1's.** V1's `FileSheet` reads whatever path the
//! link names (`File.Exists` + `ReadAllText`). That would make any text file on the machine readable
//! from the webview — `config.yaml` and `.master` under the Tendril home included — which is exactly
//! the widening `tendril_core::plans::read_plan_artifact` refuses for the artifact sheet. So the read
//! is confined to the plan's own folder (its worktrees included) and the repos the plan targets, by
//! canonical path, and anything else answers `VALIDATION_ERROR`. A plan's links point into its repos
//! and its folder, so that is every file V1's sheet was actually opened on. Markdown that belongs to
//! no plan (an Inbox issue) may reach the configured projects' repos and nothing else. Images go
//! through `cmd_get_local_file_preview` and the daemon's own guard, as before.

use crate::error::BridgeError;
use crate::models::{ChangedFileDto, PlanArtifactContentDto};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// One file a commit touched: `git diff-tree --name-status`'s letter (`A`, `M`, `D`, `R100`, …) and path.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileDto {
    pub status: String,
    pub path: String,
}

/// V1's `PlanContentHelpers.CommitDetailData` (`Title`, `Diff`, `Files`), with the diff split per
/// file the way the Changes tab gets it, and the repo the commit was found in.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCommitDetailDto {
    pub hash: String,
    pub title: String,
    pub repository: String,
    pub files: Vec<CommitFileDto>,
    pub changes: Vec<ChangedFileDto>,
    pub total_additions: usize,
    pub total_deletions: usize,
}

/// A plan's folder and the repos it targets: `plan.yaml`'s `repos`, or its project's repos when the
/// plan names none — `PlanFile.GetEffectiveRepoPaths`, as `tendril_core::plans::read_plan_changes`
/// resolves it.
fn plan_context(plan_id: &str) -> Result<(PathBuf, Vec<PathBuf>), BridgeError> {
    let home = crate::daemon::resolve_tendril_home();
    let plans_dir = home.join("Plans");
    let folder = tendril_core::plans::resolve_plan_folder(plan_id, &plans_dir)
        .map_err(|_| BridgeError::not_found(format!("Plan '{plan_id}' not found")))?;
    let (plan, _) = tendril_core::plans::read_plan_yaml(&folder)
        .map_err(|err| BridgeError::internal(format!("Failed to read plan '{plan_id}': {err}")))?;

    let mut repos: Vec<PathBuf> = plan.repos.iter().map(PathBuf::from).collect();
    if repos.is_empty() {
        let config_path = tendril_core::config::get_config_path(&home);
        if let Ok(settings) = tendril_core::config::load_config(&config_path) {
            if let Some(project) = settings
                .projects
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case(&plan.project))
            {
                repos = project
                    .repo_paths()
                    .into_iter()
                    .map(PathBuf::from)
                    .collect();
            }
        }
    }
    Ok((folder, repos))
}

/// A full or abbreviated commit hash, and nothing else — so the value can never reach git as an
/// option (`--output=…`) or a revision expression.
fn is_commit_hash(hash: &str) -> bool {
    (4..=64).contains(&hash.len()) && hash.chars().all(|c| c.is_ascii_hexdigit())
}

/// The directories a plan's commit may be in: its repos first, then its worktrees.
fn commit_search_dirs(folder: &Path, repos: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = repos.iter().filter(|r| r.is_dir()).cloned().collect();
    let worktrees = folder.join("Worktrees");
    if worktrees.is_dir() {
        dirs.extend(tendril_core::git::enumerate_worktree_directories(
            &worktrees,
        ));
    }
    dirs
}

/// `CommitDetailSheet.Build`'s query: the first repo that knows the hash answers with its title,
/// patch and file list. A patch or file list git refuses is left empty rather than failing the
/// whole read, as V1 leaves it `null`.
fn read_commit(folder: &Path, repos: &[PathBuf], hash: &str) -> Option<PlanCommitDetailDto> {
    use tendril_core::git::{get_commit_diff, get_commit_files, get_commit_title, parse_git_diff};

    for dir in commit_search_dirs(folder, repos) {
        let Ok(title) = get_commit_title(&dir, hash) else {
            continue;
        };
        let diff = get_commit_diff(&dir, hash).unwrap_or_default();
        let files = get_commit_files(&dir, hash).unwrap_or_default();
        let changes: Vec<ChangedFileDto> = parse_git_diff(&diff)
            .into_iter()
            .map(|f| ChangedFileDto {
                file_path: f.file_path,
                diff: f.diff,
                additions: f.additions,
                deletions: f.deletions,
            })
            .collect();
        return Some(PlanCommitDetailDto {
            hash: hash.to_string(),
            title,
            repository: dir.to_string_lossy().to_string(),
            total_additions: changes.iter().map(|c| c.additions).sum(),
            total_deletions: changes.iter().map(|c| c.deletions).sum(),
            files: files
                .into_iter()
                .map(|(status, path)| CommitFileDto { status, path })
                .collect(),
            changes,
        });
    }
    None
}

/// One of a plan's commits, for the commit detail sheet. `None` when no repo or worktree the plan
/// has still holds it — V1's "Commit not found.".
#[tauri::command]
pub async fn cmd_get_plan_commit(
    id: String,
    hash: String,
) -> Result<Option<PlanCommitDetailDto>, BridgeError> {
    if !is_commit_hash(&hash) {
        return Err(BridgeError::validation(format!(
            "'{hash}' is not a commit hash"
        )));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (folder, repos) = plan_context(&id)?;
        Ok(read_commit(&folder, &repos, &hash))
    })
    .await
    .map_err(|err| BridgeError::internal(format!("Commit read failed: {err}")))?
}

/// Whether `resolved` (canonical) sits inside one of `roots`, compared on canonical paths so neither
/// `..` nor a symlink can step out.
fn is_within(resolved: &Path, roots: &[PathBuf]) -> bool {
    roots
        .iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| resolved.starts_with(root))
}

/// Reads `path` for a preview, with the artifact read's rules: capped at
/// `MAX_ARTIFACT_PREVIEW_BYTES`, a NUL byte or invalid UTF-8 is `binary`, and a BOM is dropped.
fn read_preview(resolved: &Path, shown: &str) -> Result<PlanArtifactContentDto, BridgeError> {
    use std::io::Read;
    use tendril_core::plans::MAX_ARTIFACT_PREVIEW_BYTES;

    let io_error =
        |err: std::io::Error| BridgeError::internal(format!("Failed to read '{shown}': {err}"));
    let metadata = std::fs::metadata(resolved).map_err(io_error)?;
    if !metadata.is_file() {
        return Err(BridgeError::not_found(format!("'{shown}' is not a file")));
    }
    if metadata.len() > MAX_ARTIFACT_PREVIEW_BYTES {
        return Ok(PlanArtifactContentDto::TooLarge {
            size: metadata.len(),
        });
    }
    let mut bytes = Vec::new();
    std::fs::File::open(resolved)
        .and_then(|file| {
            file.take(MAX_ARTIFACT_PREVIEW_BYTES + 1)
                .read_to_end(&mut bytes)
        })
        .map_err(io_error)?;
    let size = bytes.len() as u64;
    if size > MAX_ARTIFACT_PREVIEW_BYTES {
        return Ok(PlanArtifactContentDto::TooLarge { size });
    }
    if bytes.contains(&0) {
        return Ok(PlanArtifactContentDto::Binary { size });
    }
    match String::from_utf8(bytes) {
        Ok(text) => Ok(PlanArtifactContentDto::Text {
            text: text
                .strip_prefix('\u{feff}')
                .map(str::to_string)
                .unwrap_or(text),
            size,
        }),
        Err(_) => Ok(PlanArtifactContentDto::Binary { size }),
    }
}

/// The confinement and read behind [`cmd_get_plan_file_content`], separated so it can be tested
/// without a Tendril home: `path` is read only when it resolves inside one of `roots`.
pub fn read_confined_file(
    roots: &[PathBuf],
    path: &str,
) -> Result<PlanArtifactContentDto, BridgeError> {
    let requested = Path::new(path);
    if !requested.is_absolute() {
        return Err(BridgeError::validation(format!(
            "'{path}' is not an absolute path"
        )));
    }
    let resolved = match requested.canonicalize() {
        Ok(resolved) => resolved,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(BridgeError::not_found(format!("File not found: '{path}'")))
        }
        Err(err) => {
            return Err(BridgeError::internal(format!(
                "Failed to read '{path}': {err}"
            )))
        }
    };
    if !is_within(&resolved, roots) {
        return Err(BridgeError::validation(format!(
            "'{path}' is outside the plan's folder and the project repositories"
        )));
    }
    read_preview(&resolved, path)
}

/// Every configured project's repos: where a link in markdown that belongs to no plan (an Inbox
/// issue) may point.
fn project_repos() -> Vec<PathBuf> {
    let home = crate::daemon::resolve_tendril_home();
    let config_path = tendril_core::config::get_config_path(&home);
    tendril_core::config::load_config(&config_path)
        .map(|settings| {
            settings
                .projects
                .iter()
                .flat_map(|project| project.repo_paths())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

/// A local file markdown links to, for the file sheet.
///
/// With a plan (`id`), confined to the plan's folder and the repos it targets; without one - the
/// Inbox's issue sheet, whose markdown belongs to no plan - to the configured projects' repos. See
/// the module comment for why that is narrower than V1.
#[tauri::command]
pub async fn cmd_get_plan_file_content(
    id: Option<String>,
    path: String,
) -> Result<PlanArtifactContentDto, BridgeError> {
    tauri::async_runtime::spawn_blocking(move || {
        let roots = match id.as_deref().filter(|id| !id.is_empty()) {
            Some(id) => {
                let (folder, mut repos) = plan_context(id)?;
                repos.insert(0, folder);
                repos
            }
            None => project_repos(),
        };
        read_confined_file(&roots, &path)
    })
    .await
    .map_err(|err| BridgeError::internal(format!("File read failed: {err}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_hex_hashes_are_commit_hashes() {
        assert!(is_commit_hash("3f9c2a1"));
        assert!(is_commit_hash("3f9c2a1be8d04c7f9a61e2b35d7c0a4e91f8b6d2"));
        for bad in [
            "",
            "abc",
            "--output=/tmp/x",
            "HEAD",
            "main~1",
            "3f9c2a1 ",
            "3f9c..a1b",
        ] {
            assert!(!is_commit_hash(bad), "{bad} must be refused");
        }
    }

    #[test]
    fn a_file_in_the_plan_or_its_repos_is_read_and_anything_else_refused() {
        let temp = std::env::temp_dir().join(format!("tendril-plan-files-{}", std::process::id()));
        let folder = temp.join("Plans").join("00021-Build");
        let repo = temp.join("repo");
        let outside = temp.join("elsewhere");
        for dir in [&folder, &repo, &outside] {
            std::fs::create_dir_all(dir).unwrap();
        }
        std::fs::write(folder.join("plan.yaml"), "state: Draft\n").unwrap();
        std::fs::write(repo.join("lib.rs"), "\u{feff}fn main() {}\n").unwrap();
        std::fs::write(repo.join("blob.bin"), [0u8, 1, 2]).unwrap();
        std::fs::write(outside.join("config.yaml"), "secret: 1\n").unwrap();
        let roots = vec![folder.clone(), repo.clone()];

        match read_confined_file(&roots, &repo.join("lib.rs").to_string_lossy()).unwrap() {
            PlanArtifactContentDto::Text { text, .. } => assert_eq!(text, "fn main() {}\n"),
            other => panic!("expected text, got {other:?}"),
        }
        assert!(matches!(
            read_confined_file(&roots, &folder.join("plan.yaml").to_string_lossy()).unwrap(),
            PlanArtifactContentDto::Text { .. }
        ));
        assert!(matches!(
            read_confined_file(&roots, &repo.join("blob.bin").to_string_lossy()).unwrap(),
            PlanArtifactContentDto::Binary { size: 3 }
        ));

        let refused =
            read_confined_file(&roots, &outside.join("config.yaml").to_string_lossy()).unwrap_err();
        assert_eq!(refused.code, "VALIDATION_ERROR");
        let climbed = repo.join("..").join("elsewhere").join("config.yaml");
        assert_eq!(
            read_confined_file(&roots, &climbed.to_string_lossy())
                .unwrap_err()
                .code,
            "VALIDATION_ERROR"
        );
        assert_eq!(
            read_confined_file(&roots, &repo.join("missing.rs").to_string_lossy())
                .unwrap_err()
                .code,
            "NOT_FOUND"
        );
        assert_eq!(
            read_confined_file(&roots, "lib.rs").unwrap_err().code,
            "VALIDATION_ERROR"
        );

        let _ = std::fs::remove_dir_all(&temp);
    }
}
