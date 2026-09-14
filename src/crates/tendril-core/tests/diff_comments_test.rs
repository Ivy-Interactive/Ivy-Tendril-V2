use std::path::{Path, PathBuf};
use tendril_core::plans::{
    clear_diff_comments, diff_comments_path, read_diff_comments, remove_diff_comment,
    upsert_diff_comment, write_diff_comments, DraftComment,
};

/// A disposable plan folder under the system temp dir, removed on drop.
struct TempPlan {
    path: PathBuf,
}

impl TempPlan {
    fn new(label: &str) -> Self {
        // Canonicalize: on macOS `std::env::temp_dir()` sits behind the `/var` -> `/private/var`
        // symlink, and the store canonicalizes its lock key, so a raw temp path would compare
        // unequal to what production resolves.
        let base =
            std::fs::canonicalize(std::env::temp_dir()).unwrap_or_else(|_| std::env::temp_dir());
        let path = base.join(format!(
            "tendril-diff-comments-{label}-{}",
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

fn comment(file_path: &str, change_key: &str, content: &str) -> DraftComment {
    DraftComment {
        file_path: file_path.to_string(),
        change_key: change_key.to_string(),
        content: content.to_string(),
        line_number: 10,
        author: Some("Calm Niels".to_string()),
        is_resolved: false,
    }
}

#[test]
fn test_round_trip_preserves_every_field() {
    let plan = TempPlan::new("roundtrip");

    let first = DraftComment {
        file_path: "src/Main.cs".to_string(),
        change_key: "I10".to_string(),
        content: "Should this handle null?".to_string(),
        line_number: 10,
        author: Some("Calm Niels".to_string()),
        is_resolved: false,
    };
    let second = DraftComment {
        file_path: "src/Other.cs".to_string(),
        change_key: "D42".to_string(),
        content: "Resolved in the follow-up.".to_string(),
        line_number: 42,
        author: None,
        is_resolved: true,
    };

    write_diff_comments(plan.folder(), &[first.clone(), second.clone()]).unwrap();

    // Location is part of the contract, not an implementation detail.
    let expected_path = plan
        .folder()
        .join("Artifacts")
        .join("draft_diff_comments.yaml");
    assert_eq!(diff_comments_path(plan.folder()), expected_path);
    assert!(expected_path.exists(), "file must land in Artifacts/");

    let read_back = read_diff_comments(plan.folder()).unwrap();
    assert_eq!(read_back, vec![first, second]);
}

#[test]
fn test_reads_the_legacy_camel_case_format() {
    let plan = TempPlan::new("legacy");
    std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();

    // Byte-for-byte the shape the original Tendril's YamlHelper emits.
    std::fs::write(
        diff_comments_path(plan.folder()),
        "- filePath: src/Main.cs\n\
         \x20 changeKey: I10\n\
         \x20 content: Should this handle null?\n\
         \x20 lineNumber: 10\n\
         \x20 author: Calm Niels\n\
         \x20 isResolved: false\n",
    )
    .unwrap();

    let comments = read_diff_comments(plan.folder()).unwrap();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].file_path, "src/Main.cs");
    assert_eq!(comments[0].change_key, "I10");
    assert_eq!(comments[0].content, "Should this handle null?");
    assert_eq!(comments[0].line_number, 10);
    assert_eq!(comments[0].author.as_deref(), Some("Calm Niels"));
    assert!(!comments[0].is_resolved);
}

#[test]
fn test_reads_a_legacy_entry_with_optional_keys_omitted() {
    let plan = TempPlan::new("legacy-sparse");
    std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();

    std::fs::write(
        diff_comments_path(plan.folder()),
        "- filePath: plan.md\n\
         \x20 changeKey: I7\n\
         \x20 content: No author recorded.\n\
         \x20 lineNumber: 7\n",
    )
    .unwrap();

    let comments = read_diff_comments(plan.folder()).unwrap();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].author, None);
    assert!(!comments[0].is_resolved);
}

#[test]
fn test_tolerates_unknown_keys_from_a_newer_writer() {
    let plan = TempPlan::new("unknown-keys");
    std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();

    std::fs::write(
        diff_comments_path(plan.folder()),
        "- filePath: plan.md\n\
         \x20 changeKey: I7\n\
         \x20 content: Has an extra key.\n\
         \x20 lineNumber: 7\n\
         \x20 somethingElse: ignored\n",
    )
    .unwrap();

    let comments = read_diff_comments(plan.folder()).unwrap();
    assert_eq!(comments.len(), 1, "an unknown key must not fail the parse");
    assert_eq!(comments[0].content, "Has an extra key.");
}

#[test]
fn test_serialized_keys_stay_camel_case() {
    let plan = TempPlan::new("keys");

    write_diff_comments(
        plan.folder(),
        &[DraftComment {
            file_path: "plan.md@1-2".to_string(),
            change_key: "I10".to_string(),
            content: "Anchored to a revision pair.".to_string(),
            line_number: 10,
            author: None,
            is_resolved: true,
        }],
    )
    .unwrap();

    let raw = std::fs::read_to_string(diff_comments_path(plan.folder())).unwrap();
    assert!(raw.contains("filePath:"), "got: {raw}");
    assert!(raw.contains("changeKey:"), "got: {raw}");
    assert!(raw.contains("lineNumber:"), "got: {raw}");
    assert!(raw.contains("isResolved:"), "got: {raw}");
    // snake_case would be unreadable to the original Tendril.
    assert!(!raw.contains("file_path"), "got: {raw}");
    assert!(!raw.contains("change_key"), "got: {raw}");
    assert!(!raw.contains("line_number"), "got: {raw}");
    assert!(!raw.contains("is_resolved"), "got: {raw}");
    // OmitNull: a `None` author is absent, not `author: null`.
    assert!(!raw.contains("author"), "got: {raw}");
}

#[test]
fn test_empty_list_deletes_the_file() {
    let plan = TempPlan::new("empty");

    write_diff_comments(plan.folder(), &[comment("plan.md", "I1", "First")]).unwrap();
    assert!(diff_comments_path(plan.folder()).exists());

    write_diff_comments(plan.folder(), &[]).unwrap();
    assert!(
        !diff_comments_path(plan.folder()).exists(),
        "an empty list must leave no artifact behind"
    );
    assert!(read_diff_comments(plan.folder()).unwrap().is_empty());
}

#[test]
fn test_clear_deletes_the_file() {
    let plan = TempPlan::new("clear");

    write_diff_comments(plan.folder(), &[comment("plan.md", "I1", "First")]).unwrap();
    clear_diff_comments(plan.folder()).unwrap();

    assert!(!diff_comments_path(plan.folder()).exists());
    assert!(read_diff_comments(plan.folder()).unwrap().is_empty());
    // Clearing an already-clear plan is not an error.
    clear_diff_comments(plan.folder()).unwrap();
}

#[test]
fn test_missing_folder_reads_as_empty() {
    let plan = TempPlan::new("missing-folder");
    let absent = plan.folder().join("no-such-plan");

    assert!(read_diff_comments(&absent).unwrap().is_empty());
}

#[test]
fn test_missing_file_reads_as_empty() {
    let plan = TempPlan::new("missing-file");
    std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();

    assert!(read_diff_comments(plan.folder()).unwrap().is_empty());
}

#[test]
fn test_empty_file_reads_as_empty() {
    let plan = TempPlan::new("empty-file");
    std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();
    std::fs::write(diff_comments_path(plan.folder()), "   \n").unwrap();

    assert!(read_diff_comments(plan.folder()).unwrap().is_empty());
}

#[test]
fn test_malformed_file_reads_as_empty_rather_than_erroring() {
    let plan = TempPlan::new("malformed");
    std::fs::create_dir_all(plan.folder().join("Artifacts")).unwrap();
    std::fs::write(
        diff_comments_path(plan.folder()),
        "this: is not\n  - a: valid\n    sequence: [of\n",
    )
    .unwrap();

    // A corrupt review file must not take the Diff View down with it.
    assert!(read_diff_comments(plan.folder()).unwrap().is_empty());
}

#[test]
fn test_upsert_appends_then_updates_in_place() {
    let plan = TempPlan::new("upsert");

    let after_first =
        upsert_diff_comment(plan.folder(), &comment("plan.md", "I10", "First take")).unwrap();
    assert_eq!(after_first.len(), 1);

    let after_second =
        upsert_diff_comment(plan.folder(), &comment("plan.md", "I11", "Another line")).unwrap();
    assert_eq!(after_second.len(), 2);

    let mut edited = comment("plan.md", "I10", "Second take");
    edited.is_resolved = true;
    let after_edit = upsert_diff_comment(plan.folder(), &edited).unwrap();

    assert_eq!(after_edit.len(), 2, "same key must update, not append");
    assert_eq!(after_edit[0].content, "Second take");
    assert!(after_edit[0].is_resolved);
    assert_eq!(after_edit[1].change_key, "I11", "order is preserved");
    assert_eq!(read_diff_comments(plan.folder()).unwrap(), after_edit);
}

#[test]
fn test_upsert_treats_the_file_path_as_part_of_the_identity() {
    let plan = TempPlan::new("upsert-identity");

    upsert_diff_comment(plan.folder(), &comment("plan.md", "I10", "Legacy anchor")).unwrap();
    let comments = upsert_diff_comment(
        plan.folder(),
        &comment("plan.md@1-2", "I10", "Scoped anchor"),
    )
    .unwrap();

    assert_eq!(
        comments.len(),
        2,
        "the same changeKey under a different filePath is a different comment"
    );
}

#[test]
fn test_remove_takes_only_the_matching_pair() {
    let plan = TempPlan::new("remove");

    write_diff_comments(
        plan.folder(),
        &[
            comment("plan.md", "I10", "Keep me"),
            comment("plan.md", "I11", "Delete me"),
            comment("src/Main.cs", "I11", "Keep me too"),
        ],
    )
    .unwrap();

    let remaining = remove_diff_comment(plan.folder(), "plan.md", "I11").unwrap();

    assert_eq!(remaining.len(), 2);
    assert_eq!(remaining[0].change_key, "I10");
    assert_eq!(remaining[1].file_path, "src/Main.cs");
    assert_eq!(read_diff_comments(plan.folder()).unwrap(), remaining);
}

#[test]
fn test_remove_of_a_missing_pair_is_a_no_op() {
    let plan = TempPlan::new("remove-missing");

    write_diff_comments(plan.folder(), &[comment("plan.md", "I10", "Keep me")]).unwrap();
    let remaining = remove_diff_comment(plan.folder(), "plan.md", "nope").unwrap();

    assert_eq!(remaining.len(), 1);
}

#[test]
fn test_remove_of_the_last_comment_deletes_the_file() {
    let plan = TempPlan::new("remove-last");

    write_diff_comments(plan.folder(), &[comment("plan.md", "I10", "Only one")]).unwrap();
    let remaining = remove_diff_comment(plan.folder(), "plan.md", "I10").unwrap();

    assert!(remaining.is_empty());
    assert!(!diff_comments_path(plan.folder()).exists());
}

#[test]
fn test_concurrent_upserts_of_distinct_keys_lose_nothing() {
    let plan = TempPlan::new("concurrent-distinct");
    let folder = plan.folder().to_path_buf();

    let handles: Vec<_> = (0..16)
        .map(|i| {
            let folder = folder.clone();
            std::thread::spawn(move || {
                upsert_diff_comment(
                    &folder,
                    &comment("plan.md", &format!("I{i}"), &format!("Comment {i}")),
                )
                .unwrap();
            })
        })
        .collect();

    for handle in handles {
        handle.join().unwrap();
    }

    // Without the per-file lock the read-modify-write races and entries vanish.
    let comments = read_diff_comments(&folder).unwrap();
    assert_eq!(comments.len(), 16, "every concurrent upsert must survive");

    let mut keys: Vec<_> = comments.iter().map(|c| c.change_key.clone()).collect();
    keys.sort();
    keys.dedup();
    assert_eq!(keys.len(), 16, "all 16 keys must be distinct");
}

#[test]
fn test_concurrent_upserts_of_the_same_key_leave_one_entry() {
    let plan = TempPlan::new("concurrent-same");
    let folder = plan.folder().to_path_buf();

    let handles: Vec<_> = (0..16)
        .map(|i| {
            let folder = folder.clone();
            std::thread::spawn(move || {
                upsert_diff_comment(&folder, &comment("plan.md", "I10", &format!("Take {i}")))
                    .unwrap();
            })
        })
        .collect();

    for handle in handles {
        handle.join().unwrap();
    }

    let comments = read_diff_comments(&folder).unwrap();
    assert_eq!(comments.len(), 1);
    assert_eq!(comments[0].change_key, "I10");
}

#[test]
fn test_concurrent_writes_never_leave_a_torn_file() {
    let plan = TempPlan::new("torn");
    let folder = plan.folder().to_path_buf();

    let writers: Vec<_> = (0..8)
        .map(|i| {
            let folder = folder.clone();
            std::thread::spawn(move || {
                for round in 0..10 {
                    upsert_diff_comment(
                        &folder,
                        &comment("plan.md", &format!("I{i}"), &format!("Round {round}")),
                    )
                    .unwrap();
                }
            })
        })
        .collect();

    let reader = {
        let folder = folder.clone();
        std::thread::spawn(move || {
            for _ in 0..200 {
                // A temp+rename write means a reader sees either the old file or the new one, so a
                // parse failure here would surface as a silently empty list rather than an error.
                let _ = read_diff_comments(&folder).unwrap();
            }
        })
    };

    for writer in writers {
        writer.join().unwrap();
    }
    reader.join().unwrap();

    assert_eq!(read_diff_comments(&folder).unwrap().len(), 8);
    // No temp files left behind.
    let strays: Vec<_> = std::fs::read_dir(folder.join("Artifacts"))
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.contains(".tmp-"))
        .collect();
    assert!(strays.is_empty(), "stray temp files: {strays:?}");
}
