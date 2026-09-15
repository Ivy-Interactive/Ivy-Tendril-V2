//! A reviewer's draft annotations on a plan revision's markdown, persisted alongside the plan.
//!
//! The on-disk file is `<planFolder>/Artifacts/draft_annotations.yaml`, a YAML sequence of
//! camelCase-keyed annotations. Both the location and the key spelling are a
//! migration-compatibility requirement rather than a convention: plan folders written by the
//! original Tendril (`PlanAnnotationService`) must stay readable here, and a folder this module
//! writes must stay readable there.
//!
//! An annotation is identified by its `id`, which is how an update or a delete finds it. That is
//! the one structural difference from the [`super::diff_comments`] sibling, which keys on
//! `(filePath, changeKey)`: a diff comment is anchored to a line, an annotation to a character
//! range it carries its own handle for.
//!
//! # Not the same thing as a diff comment
//!
//! [`super::diff_comments`] stores comments on a plan **diff**. This module stores annotations on a
//! revision's **markdown body**. They are separate concepts with separate files upstream, and the
//! two modules are deliberately written as siblings so the difference is visible at a glance.
//!
//! # Locking, atomic writes, and the watcher
//!
//! Writes go through [`fs_lock::write_atomic`](crate::fs_lock::write_atomic) under a
//! [`FileLock`](crate::fs_lock::FileLock) held across the whole read-modify-write, which is the
//! same pair the plan writers use. The sibling predates those primitives and rolls its own
//! per-path `Mutex` plus temp/rename; this module deliberately does not copy that.
//!
//! `write_atomic` notes the write with the watcher's self-write suppression before its rename
//! becomes visible, so the write path needs nothing extra. The delete path bypasses it —
//! `remove_file` is not `write_atomic` — so it calls `note_self_write` explicitly.
//!
//! To be honest about scope: `watcher::watch_paths` registers each plan folder's root plus
//! `Revisions` and `Verification`, so **`Artifacts` is not watched today** and no watcher event
//! fires for this file at present. The primitives are used anyway because they are this project's
//! contract for plan-folder writes, because `Artifacts` may be watched later, and above all because
//! `FileLock` is doing real work independent of the watcher: it is what makes the read-modify-write
//! atomic. Nothing here is fixing a bug.

use crate::error::{Result, TendrilError};
use crate::fs_lock::{self, FileLock};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// One annotation on a span of a plan revision's markdown.
///
/// Every field carries `#[serde(default)]` so that a legacy file missing `author` or `isResolved`
/// still parses. Unknown keys are tolerated deliberately (no `deny_unknown_fields`) — the original
/// Tendril tolerates them, so a file round-tripping between the two must too.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Annotation {
    #[serde(default)]
    pub id: String,

    #[serde(rename = "startOffset", default)]
    pub start_offset: i64,

    #[serde(rename = "endOffset", default)]
    pub end_offset: i64,

    #[serde(rename = "selectedText", default)]
    pub selected_text: String,

    #[serde(default)]
    pub comment: String,

    /// Absent rather than null when unset, reproducing the original's `OmitNull` emitter. Note that
    /// `OmitNull` omits *only* nulls: `startOffset: 0` and `isResolved: false` are still written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,

    #[serde(rename = "isResolved", default)]
    pub is_resolved: bool,
}

/// `<plan_folder>/Artifacts/draft_annotations.yaml`.
pub fn annotations_path(plan_folder: &Path) -> PathBuf {
    plan_folder.join("Artifacts").join("draft_annotations.yaml")
}

/// Every annotation recorded for a plan, in file order.
///
/// A missing folder, a missing file and an empty file all yield an empty list.
///
/// **One deliberate divergence from the sibling.** `read_diff_comments` swallows a parse error and
/// returns an empty list. This function returns [`TendrilError::Plan`] instead, naming the path and
/// the serde error, so that a corrupt or half-written file surfaces to the operator rather than
/// reading as "no annotations" and inviting a write that overwrites what was left. The
/// `tracing::warn!` is kept alongside it. Do not "fix" this into the sibling's shape.
pub fn read_annotations(plan_folder: &Path) -> Result<Vec<Annotation>> {
    read_at(&annotations_path(plan_folder))
}

/// The unlocked read every entry point funnels through.
///
/// The locked mutators must call *this* rather than [`read_annotations`]: `FileLock` must never be
/// nested over the same path, or a locked write that re-locks to read would spend its whole 5 s
/// retry budget waiting on itself.
fn read_at(path: &Path) -> Result<Vec<Annotation>> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_yaml::from_str::<Vec<Annotation>>(&content).map_err(|err| {
        tracing::warn!("Unreadable draft annotations at {}: {err}", path.display());
        TendrilError::Plan(format!(
            "Failed to parse draft annotations at {}: {err}",
            path.display()
        ))
    })
}

/// Replace the whole list. An empty list deletes the file, as the original does, so a plan with no
/// annotations leaves no artifact behind.
pub fn write_annotations(plan_folder: &Path, annotations: &[Annotation]) -> Result<()> {
    let path = annotations_path(plan_folder);
    // The sidecar this takes out is `Artifacts/draft_annotations.yaml.lock`. Harmless while
    // `Artifacts` is unwatched, and matched by the watcher's ignore rules regardless.
    let _lock = FileLock::acquire(&path)?;
    write_locked(&path, annotations)
}

/// Insert or update one annotation, keyed on `id`, and return the resulting list.
pub fn upsert_annotation(plan_folder: &Path, annotation: &Annotation) -> Result<Vec<Annotation>> {
    let path = annotations_path(plan_folder);
    let _lock = FileLock::acquire(&path)?;

    let mut annotations = read_at(&path)?;
    match annotations.iter_mut().find(|a| a.id == annotation.id) {
        Some(existing) => *existing = annotation.clone(),
        None => annotations.push(annotation.clone()),
    }

    write_locked(&path, &annotations)?;
    Ok(annotations)
}

/// Remove the annotation with `id` and return the resulting list.
///
/// Removing an id that is not there is a no-op that returns the unchanged list, so a double delete
/// is not an error.
pub fn remove_annotation(plan_folder: &Path, id: &str) -> Result<Vec<Annotation>> {
    let path = annotations_path(plan_folder);
    let _lock = FileLock::acquire(&path)?;

    let mut annotations = read_at(&path)?;
    annotations.retain(|a| a.id != id);

    write_locked(&path, &annotations)?;
    Ok(annotations)
}

/// Drop every annotation, deleting the file if it exists.
pub fn clear_annotations(plan_folder: &Path) -> Result<()> {
    let path = annotations_path(plan_folder);
    let _lock = FileLock::acquire(&path)?;
    write_locked(&path, &[])
}

/// Serialize and write through `write_atomic`, or delete the file when the list is empty.
///
/// Callers must already hold the path's [`FileLock`] — that is what makes the surrounding
/// read-modify-write atomic, which an atomic write alone cannot do.
fn write_locked(path: &Path, annotations: &[Annotation]) -> Result<()> {
    if annotations.is_empty() {
        if path.exists() {
            // `remove_file` does not go through `write_atomic`, so the watcher's suppression note
            // has to be made here by hand — otherwise the daemon would treat its own delete as a
            // foreign change once `Artifacts` is watched.
            crate::watcher::self_writes::note_self_write(path);
            std::fs::remove_file(path)?;
        }
        return Ok(());
    }

    let yaml = serde_yaml::to_string(annotations)?;
    fs_lock::write_atomic(path, yaml.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A disposable plan folder under the system temp dir, removed on drop.
    struct TempPlan {
        path: PathBuf,
    }

    impl TempPlan {
        fn new(label: &str) -> Self {
            // Canonicalize: on macOS `std::env::temp_dir()` sits behind the `/var` ->
            // `/private/var` symlink, and the lock store canonicalizes its key, so a raw temp path
            // would compare unequal to what production resolves.
            let base = std::fs::canonicalize(std::env::temp_dir())
                .unwrap_or_else(|_| std::env::temp_dir());
            let path = base.join(format!(
                "tendril-annotations-{label}-{}",
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn folder(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempPlan {
        fn drop(&mut self) {
            assert!(
                self.path.starts_with(
                    std::fs::canonicalize(std::env::temp_dir())
                        .unwrap_or_else(|_| std::env::temp_dir())
                ),
                "refusing to delete a fixture outside the temp dir: {}",
                self.path.display()
            );
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn annotation(id: &str, comment: &str) -> Annotation {
        Annotation {
            id: id.to_string(),
            start_offset: 10,
            end_offset: 30,
            selected_text: "public void Execute()".to_string(),
            comment: comment.to_string(),
            author: Some("Calm Niels".to_string()),
            is_resolved: false,
        }
    }

    /// Ports `SaveAnnotationsAsync_WritesYamlFile_AndRetrievesWithAuthor`.
    #[test]
    fn test_round_trip_preserves_every_field() {
        let plan = TempPlan::new("roundtrip");

        let first = Annotation {
            id: "ann-1".to_string(),
            start_offset: 10,
            end_offset: 30,
            selected_text: "public void Execute()".to_string(),
            comment: "Should this be async?".to_string(),
            author: Some("Calm Niels".to_string()),
            is_resolved: false,
        };
        let second = Annotation {
            id: "ann-2".to_string(),
            start_offset: 50,
            end_offset: 70,
            selected_text: "var result = false;".to_string(),
            comment: "Consider true as default".to_string(),
            author: Some("Observant Fox".to_string()),
            is_resolved: false,
        };

        write_annotations(plan.folder(), &[first.clone(), second.clone()]).unwrap();

        // Location is part of the contract, not an implementation detail.
        let expected_path = plan
            .folder()
            .join("Artifacts")
            .join("draft_annotations.yaml");
        assert_eq!(annotations_path(plan.folder()), expected_path);
        assert!(expected_path.exists(), "file must land in Artifacts/");

        let read_back = read_annotations(plan.folder()).unwrap();
        assert_eq!(read_back, vec![first, second]);
        assert_eq!(read_back[0].author.as_deref(), Some("Calm Niels"));
        assert_eq!(read_back[0].comment, "Should this be async?");
        assert_eq!(read_back[0].selected_text, "public void Execute()");
        assert_eq!(read_back[1].author.as_deref(), Some("Observant Fox"));
    }

    #[test]
    fn test_serialized_keys_match_the_original_emitter() {
        let plan = TempPlan::new("keys");

        write_annotations(
            plan.folder(),
            &[
                Annotation {
                    id: "ann-1".to_string(),
                    start_offset: 10,
                    end_offset: 30,
                    selected_text: "public void Execute()".to_string(),
                    comment: "Should this be async?".to_string(),
                    author: Some("Calm Niels".to_string()),
                    is_resolved: true,
                },
                // Defaults everywhere the emitter must still write them out.
                Annotation {
                    id: "ann-2".to_string(),
                    start_offset: 0,
                    end_offset: 0,
                    selected_text: String::new(),
                    comment: "No author, no offsets.".to_string(),
                    author: None,
                    is_resolved: false,
                },
            ],
        )
        .unwrap();

        let raw = std::fs::read_to_string(annotations_path(plan.folder())).unwrap();
        for key in [
            "id:",
            "startOffset:",
            "endOffset:",
            "selectedText:",
            "comment:",
            "author:",
            "isResolved:",
        ] {
            assert!(raw.contains(key), "missing {key} in: {raw}");
        }
        // snake_case would be unreadable to the original Tendril.
        for key in ["start_offset", "end_offset", "selected_text", "is_resolved"] {
            assert!(!raw.contains(key), "leaked {key} in: {raw}");
        }
        // `OmitNull` omits nulls only, so the defaults are written and the null author is not.
        assert!(raw.contains("startOffset: 0"), "got: {raw}");
        assert!(raw.contains("isResolved: false"), "got: {raw}");
        assert!(!raw.contains("author: null"), "got: {raw}");
        assert_eq!(
            raw.matches("author:").count(),
            1,
            "only the annotation with an author may emit the key: {raw}"
        );
    }

    #[test]
    fn test_reads_the_legacy_camel_case_format() {
        let plan = TempPlan::new("legacy");
        std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();

        // Byte-for-byte the shape the original Tendril's YamlHelper emits.
        std::fs::write(
            annotations_path(plan.folder()),
            "- id: ann-1\n\
             \x20 startOffset: 10\n\
             \x20 endOffset: 30\n\
             \x20 selectedText: public void Execute()\n\
             \x20 comment: Should this be async?\n\
             \x20 author: Calm Niels\n\
             \x20 isResolved: false\n",
        )
        .unwrap();

        let annotations = read_annotations(plan.folder()).unwrap();
        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].id, "ann-1");
        assert_eq!(annotations[0].start_offset, 10);
        assert_eq!(annotations[0].end_offset, 30);
        assert_eq!(annotations[0].selected_text, "public void Execute()");
        assert_eq!(annotations[0].comment, "Should this be async?");
        assert_eq!(annotations[0].author.as_deref(), Some("Calm Niels"));
        assert!(!annotations[0].is_resolved);
    }

    #[test]
    fn test_reads_a_legacy_entry_with_optional_keys_omitted() {
        let plan = TempPlan::new("legacy-sparse");
        std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();

        std::fs::write(
            annotations_path(plan.folder()),
            "- id: ann-1\n  comment: No author recorded.\n",
        )
        .unwrap();

        let annotations = read_annotations(plan.folder()).unwrap();
        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].author, None);
        assert!(!annotations[0].is_resolved);
        assert_eq!(annotations[0].start_offset, 0);
        assert_eq!(annotations[0].selected_text, "");
    }

    #[test]
    fn test_tolerates_unknown_keys_from_a_newer_writer() {
        let plan = TempPlan::new("unknown-keys");
        std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();

        std::fs::write(
            annotations_path(plan.folder()),
            "- id: ann-1\n  comment: Has an extra key.\n  somethingElse: ignored\n",
        )
        .unwrap();

        let annotations = read_annotations(plan.folder()).unwrap();
        assert_eq!(
            annotations.len(),
            1,
            "an unknown key must not fail the parse"
        );
        assert_eq!(annotations[0].comment, "Has an extra key.");
    }

    /// Ports `SaveAnnotationsAsync_WithEmptyList_DeletesExistingFile`.
    #[test]
    fn test_empty_list_deletes_the_file() {
        let plan = TempPlan::new("empty");

        write_annotations(plan.folder(), &[annotation("ann-1", "Testing")]).unwrap();
        assert!(annotations_path(plan.folder()).exists());

        write_annotations(plan.folder(), &[]).unwrap();
        assert!(
            !annotations_path(plan.folder()).exists(),
            "an empty list must leave no artifact behind"
        );
        assert!(read_annotations(plan.folder()).unwrap().is_empty());
    }

    /// Ports `ClearAnnotationsAsync_RemovesFile`.
    #[test]
    fn test_clear_deletes_the_file_and_is_idempotent() {
        let plan = TempPlan::new("clear");

        write_annotations(plan.folder(), &[annotation("ann-1", "Testing")]).unwrap();
        assert_eq!(read_annotations(plan.folder()).unwrap().len(), 1);

        clear_annotations(plan.folder()).unwrap();
        assert!(!annotations_path(plan.folder()).exists());
        assert!(read_annotations(plan.folder()).unwrap().is_empty());

        // Clearing an already-clear plan is not an error.
        clear_annotations(plan.folder()).unwrap();
        assert!(read_annotations(plan.folder()).unwrap().is_empty());
    }

    #[test]
    fn test_missing_folder_and_missing_file_read_as_empty() {
        let plan = TempPlan::new("missing");
        let absent = plan.folder().join("no-such-plan");

        assert!(read_annotations(&absent).unwrap().is_empty());
        std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();
        assert!(read_annotations(plan.folder()).unwrap().is_empty());
    }

    #[test]
    fn test_empty_file_reads_as_empty() {
        let plan = TempPlan::new("empty-file");
        std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();
        std::fs::write(annotations_path(plan.folder()), "   \n").unwrap();

        assert!(read_annotations(plan.folder()).unwrap().is_empty());
    }

    #[test]
    fn test_upsert_replaces_by_id_and_appends_a_new_one() {
        let plan = TempPlan::new("upsert");

        let after_first =
            upsert_annotation(plan.folder(), &annotation("ann-1", "First take")).unwrap();
        assert_eq!(after_first.len(), 1);

        let mut edited = annotation("ann-1", "Second take");
        edited.is_resolved = true;
        let after_edit = upsert_annotation(plan.folder(), &edited).unwrap();
        assert_eq!(after_edit.len(), 1, "the same id must update, not append");
        assert_eq!(after_edit[0].comment, "Second take");
        assert!(after_edit[0].is_resolved);

        let after_new =
            upsert_annotation(plan.folder(), &annotation("ann-2", "Another span")).unwrap();
        assert_eq!(after_new.len(), 2);
        assert_eq!(after_new[0].id, "ann-1", "order is preserved");
        assert_eq!(after_new[1].id, "ann-2");
        assert_eq!(read_annotations(plan.folder()).unwrap(), after_new);
    }

    #[test]
    fn test_remove_is_idempotent_and_deletes_the_file_with_the_last_annotation() {
        let plan = TempPlan::new("remove");

        write_annotations(
            plan.folder(),
            &[
                annotation("ann-1", "Delete me"),
                annotation("ann-2", "Keep me"),
            ],
        )
        .unwrap();

        let remaining = remove_annotation(plan.folder(), "ann-1").unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "ann-2");

        // Removing an absent id is a no-op returning the unchanged list.
        let again = remove_annotation(plan.folder(), "ann-1").unwrap();
        assert_eq!(again, remaining);

        let empty = remove_annotation(plan.folder(), "ann-2").unwrap();
        assert!(empty.is_empty());
        assert!(
            !annotations_path(plan.folder()).exists(),
            "removing the last annotation must leave no artifact behind"
        );
    }

    #[test]
    fn test_corrupt_yaml_yields_an_error_rather_than_a_panic() {
        let plan = TempPlan::new("corrupt");
        std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();
        std::fs::write(annotations_path(plan.folder()), "  : not: yaml: [\n").unwrap();

        let err =
            read_annotations(plan.folder()).expect_err("a corrupt file must not read as empty");
        let message = err.to_string();
        assert!(
            message.contains("draft_annotations.yaml"),
            "the error must name the path: {message}"
        );
        assert!(
            matches!(err, TendrilError::Plan(_)),
            "expected TendrilError::Plan, got: {err:?}"
        );
    }

    #[test]
    fn test_concurrent_upserts_of_distinct_ids_lose_nothing() {
        let plan = TempPlan::new("concurrent-distinct");
        let folder = plan.folder().to_path_buf();

        let handles: Vec<_> = (0..8)
            .map(|i| {
                let folder = folder.clone();
                std::thread::spawn(move || {
                    upsert_annotation(&folder, &annotation(&format!("ann-{i}"), "Concurrent"))
                        .unwrap();
                })
            })
            .collect();

        for handle in handles {
            handle.join().unwrap();
        }

        // Without the file lock held across the read-modify-write, entries vanish.
        let annotations = read_annotations(&folder).unwrap();
        assert_eq!(annotations.len(), 8, "every concurrent upsert must survive");
        let mut ids: Vec<_> = annotations.iter().map(|a| a.id.clone()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 8);
    }

    #[test]
    fn test_writes_leave_no_stray_temp_or_lock_files() {
        let plan = TempPlan::new("strays");

        upsert_annotation(plan.folder(), &annotation("ann-1", "One")).unwrap();
        remove_annotation(plan.folder(), "ann-1").unwrap();
        write_annotations(plan.folder(), &[annotation("ann-2", "Two")]).unwrap();

        let strays: Vec<_> = std::fs::read_dir(plan.folder().join("Artifacts"))
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n != "draft_annotations.yaml")
            .collect();
        assert!(strays.is_empty(), "stray files: {strays:?}");
    }
}
