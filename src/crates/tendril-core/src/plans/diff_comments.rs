//! A reviewer's inline diff comments, persisted alongside the plan.
//!
//! The on-disk file is `<planFolder>/Artifacts/draft_diff_comments.yaml`, a YAML sequence of
//! camelCase-keyed comments. Both the location and the key spelling are a migration-compatibility
//! requirement rather than a convention: plan folders written by the original Tendril
//! (`PlanDiffCommentService`) must stay readable here, and a folder this module writes must stay
//! readable there.
//!
//! A comment is identified by its `(file_path, change_key)` pair, which is how an update or a
//! delete finds it.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use uuid::Uuid;

/// One inline comment on a diff line.
///
/// Every field carries `#[serde(default)]` so that a legacy file missing `author` or `isResolved`
/// still parses. Unknown keys are tolerated deliberately (no `deny_unknown_fields`) — the original
/// Tendril tolerates them, so a file round-tripping between the two must too.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DraftComment {
    #[serde(rename = "filePath", default)]
    pub file_path: String,

    #[serde(rename = "changeKey", default)]
    pub change_key: String,

    #[serde(default)]
    pub content: String,

    #[serde(rename = "lineNumber", default)]
    pub line_number: i64,

    /// Absent rather than null when unset, reproducing the original's `OmitNull` emitter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,

    #[serde(rename = "isResolved", default)]
    pub is_resolved: bool,
}

/// `<plan_folder>/Artifacts/draft_diff_comments.yaml`.
pub fn diff_comments_path(plan_folder: &Path) -> PathBuf {
    plan_folder
        .join("Artifacts")
        .join("draft_diff_comments.yaml")
}

/// Every comment recorded for a plan, in file order.
///
/// A missing folder, a missing file, an empty file and a malformed file all yield an empty list. The
/// malformed case logs a warning and carries on: the original swallows the parse error the same way,
/// and a corrupt review file must not take the whole Diff View down with it.
pub fn read_diff_comments(plan_folder: &Path) -> Result<Vec<DraftComment>> {
    let path = diff_comments_path(plan_folder);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&path)?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    match serde_yaml::from_str::<Vec<DraftComment>>(&content) {
        Ok(comments) => Ok(comments),
        Err(err) => {
            tracing::warn!(
                "Ignoring unreadable draft diff comments at {}: {err}",
                path.display()
            );
            Ok(Vec::new())
        }
    }
}

/// Replace the whole list. An empty list deletes the file, as the original does, so a plan with no
/// review leaves no artifact behind.
pub fn write_diff_comments(plan_folder: &Path, comments: &[DraftComment]) -> Result<()> {
    let path = diff_comments_path(plan_folder);
    let lock = lock_for(&path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    write_locked(&path, comments)
}

/// Insert or update one comment, keyed on `(file_path, change_key)`, and return the resulting list.
pub fn upsert_diff_comment(
    plan_folder: &Path,
    comment: &DraftComment,
) -> Result<Vec<DraftComment>> {
    let path = diff_comments_path(plan_folder);
    let lock = lock_for(&path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut comments = read_diff_comments(plan_folder)?;
    match comments
        .iter_mut()
        .find(|c| c.file_path == comment.file_path && c.change_key == comment.change_key)
    {
        Some(existing) => *existing = comment.clone(),
        None => comments.push(comment.clone()),
    }

    write_locked(&path, &comments)?;
    Ok(comments)
}

/// Remove every comment matching `(file_path, change_key)` and return the resulting list.
pub fn remove_diff_comment(
    plan_folder: &Path,
    file_path: &str,
    change_key: &str,
) -> Result<Vec<DraftComment>> {
    let path = diff_comments_path(plan_folder);
    let lock = lock_for(&path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());

    let mut comments = read_diff_comments(plan_folder)?;
    comments.retain(|c| !(c.file_path == file_path && c.change_key == change_key));

    write_locked(&path, &comments)?;
    Ok(comments)
}

/// Drop the whole review, deleting the file if it exists.
pub fn clear_diff_comments(plan_folder: &Path) -> Result<()> {
    let path = diff_comments_path(plan_folder);
    let lock = lock_for(&path);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    write_locked(&path, &[])
}

/// Serialize to a temp file in the target directory, flush it, then rename over the target, so a
/// concurrent reader sees either the old file or the new one and never a half-written list.
///
/// Callers must already hold the path's lock — that is what makes the surrounding
/// read-modify-write atomic, which a rename alone cannot do.
fn write_locked(path: &Path, comments: &[DraftComment]) -> Result<()> {
    if comments.is_empty() {
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        return Ok(());
    }

    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;

    let yaml = serde_yaml::to_string(comments)?;
    let temp_path = dir.join(format!(
        "draft_diff_comments.yaml.tmp-{}",
        Uuid::new_v4().simple()
    ));

    {
        let mut file = std::fs::File::create(&temp_path)?;
        file.write_all(yaml.as_bytes())?;
        file.sync_all()?;
    }

    std::fs::rename(&temp_path, path)?;
    Ok(())
}

/// Per-file mutex, held across a whole read-modify-write.
///
/// A temp+rename write on its own still loses updates: two callers that each read the same list and
/// append a different comment produce two writes where the second wins. Holding this for the
/// duration of the mutation is what stops that.
///
/// This is a single-process guarantee, which is the right scope — the daemon is the only writer, and
/// the original Tendril offered no more than this either.
fn lock_for(path: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));

    // Canonicalize where possible so two spellings of the same plan folder contend, and unrelated
    // plans do not. The file itself usually does not exist yet, so canonicalize its directory.
    let key = path
        .parent()
        .and_then(|p| std::fs::canonicalize(p).ok())
        .map(|dir| dir.join(path.file_name().unwrap_or_default()))
        .unwrap_or_else(|| path.to_path_buf());

    // `into_inner` rather than `unwrap`: one panicking caller must not wedge the store for the rest
    // of the process. The guarded value is `()`, so there is no state left inconsistent by a panic.
    let mut guard = locks.lock().unwrap_or_else(|e| e.into_inner());
    Arc::clone(guard.entry(key).or_default())
}
