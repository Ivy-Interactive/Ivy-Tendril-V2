use std::fs;
use tempfile::TempDir;
use tendril_core::plans::{
    read_plan_artifact, read_plan_artifacts, read_plan_summary, PlanArtifactContent,
    PlanArtifactReadError, MAX_ARTIFACT_PREVIEW_BYTES,
};

#[test]
fn test_read_plan_summary_from_artifacts_file() {
    let temp = TempDir::new().unwrap();
    let home = temp.path();
    let plans_dir = home.join("Plans");
    let plan_folder = plans_dir.join("00006-TestPlan");
    let artifacts_dir = plan_folder.join("Artifacts");
    fs::create_dir_all(&artifacts_dir).unwrap();

    let summary_file = artifacts_dir.join("summary.md");
    fs::write(&summary_file, "# Summary\n\nAll tests passed successfully.").unwrap();

    let summary = read_plan_summary(home, &plans_dir, "00006");
    assert_eq!(
        summary.as_deref(),
        Some("# Summary\n\nAll tests passed successfully.")
    );

    // Also works with full folder name
    let summary_by_name = read_plan_summary(home, &plans_dir, "00006-TestPlan");
    assert_eq!(
        summary_by_name.as_deref(),
        Some("# Summary\n\nAll tests passed successfully.")
    );
}

#[test]
fn test_read_plan_summary_missing_no_jobs() {
    let temp = TempDir::new().unwrap();
    let home = temp.path();
    let plans_dir = home.join("Plans");
    let plan_folder = plans_dir.join("00007-NoSummaryPlan");
    fs::create_dir_all(&plan_folder).unwrap();

    let summary = read_plan_summary(home, &plans_dir, "00007");
    assert_eq!(summary, None);
}

#[test]
fn test_read_plan_artifacts_lists_screenshots_and_other_files() {
    let temp = TempDir::new().unwrap();
    let home = temp.path();
    let plans_dir = home.join("Plans");
    let plan_folder = plans_dir.join("00008-ArtifactsPlan");
    let artifacts_dir = plan_folder.join("Artifacts");
    let screenshots_dir = artifacts_dir.join("screenshots");
    fs::create_dir_all(&screenshots_dir).unwrap();

    // Add summary (which should be excluded from other)
    fs::write(artifacts_dir.join("summary.md"), "# Summary").unwrap();
    // Add draft file (which should be excluded)
    fs::write(artifacts_dir.join("draft_note.txt"), "draft").unwrap();
    // Add other file
    fs::write(artifacts_dir.join("output.json"), "{}").unwrap();
    // Add screenshot
    fs::write(screenshots_dir.join("shot1.png"), "png_bytes").unwrap();
    // Add image directly in artifacts
    fs::write(artifacts_dir.join("diagram.svg"), "<svg></svg>").unwrap();

    let artifacts = read_plan_artifacts(&plans_dir, "00008");
    assert_eq!(artifacts.screenshots.len(), 2);
    assert!(
        artifacts.screenshots[0].ends_with("diagram.svg")
            || artifacts.screenshots[1].ends_with("diagram.svg")
    );
    assert!(
        artifacts.screenshots[0].ends_with("shot1.png")
            || artifacts.screenshots[1].ends_with("shot1.png")
    );

    assert_eq!(artifacts.other.len(), 1);
    assert!(artifacts.other[0].ends_with("output.json"));
}

/// A plan folder with an `Artifacts` directory, for the artifact-read tests below.
fn artifacts_plan(temp: &TempDir) -> (std::path::PathBuf, std::path::PathBuf) {
    let plans_dir = temp.path().join("Plans");
    let artifacts_dir = plans_dir.join("00009-ArtifactSheetPlan").join("Artifacts");
    fs::create_dir_all(artifacts_dir.join("screenshots")).unwrap();
    (plans_dir, artifacts_dir)
}

#[test]
fn read_plan_artifact_returns_a_text_file_by_the_path_the_listing_gave() {
    let temp = TempDir::new().unwrap();
    let (plans_dir, artifacts_dir) = artifacts_plan(&temp);
    fs::write(artifacts_dir.join("output.json"), "{\"ok\":true}").unwrap();

    let listed = read_plan_artifacts(&plans_dir, "00009");
    let content = read_plan_artifact(&plans_dir, "00009", &listed.other[0]).unwrap();

    assert_eq!(
        content,
        PlanArtifactContent::Text {
            text: "{\"ok\":true}".to_string(),
            size: 11,
        }
    );
}

#[test]
fn read_plan_artifact_strips_a_byte_order_mark() {
    let temp = TempDir::new().unwrap();
    let (plans_dir, artifacts_dir) = artifacts_plan(&temp);
    let file = artifacts_dir.join("notes.md");
    fs::write(&file, "\u{feff}# Notes").unwrap();

    let content = read_plan_artifact(&plans_dir, "00009", file.to_str().unwrap()).unwrap();

    assert!(matches!(content, PlanArtifactContent::Text { ref text, .. } if text == "# Notes"));
}

#[test]
fn read_plan_artifact_reports_binary_rather_than_mojibake() {
    let temp = TempDir::new().unwrap();
    let (plans_dir, artifacts_dir) = artifacts_plan(&temp);
    let with_nul = artifacts_dir.join("archive.zip");
    fs::write(&with_nul, b"PK\x03\x04\x00\x00").unwrap();
    // No NUL, but not UTF-8 either: the second line of a real PDF header.
    let not_utf8 = artifacts_dir.join("report.pdf");
    fs::write(&not_utf8, b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n").unwrap();

    for file in [with_nul, not_utf8] {
        let content = read_plan_artifact(&plans_dir, "00009", file.to_str().unwrap()).unwrap();
        assert!(
            matches!(content, PlanArtifactContent::Binary { .. }),
            "{} must be binary, got {content:?}",
            file.display()
        );
    }
}

#[test]
fn read_plan_artifact_does_not_read_a_file_over_the_preview_cap() {
    let temp = TempDir::new().unwrap();
    let (plans_dir, artifacts_dir) = artifacts_plan(&temp);
    let file = artifacts_dir.join("huge.log");
    let size = MAX_ARTIFACT_PREVIEW_BYTES + 1;
    fs::write(&file, vec![b'a'; size as usize]).unwrap();

    let content = read_plan_artifact(&plans_dir, "00009", file.to_str().unwrap()).unwrap();

    assert_eq!(content, PlanArtifactContent::TooLarge { size });
}

#[test]
fn read_plan_artifact_refuses_anything_outside_the_artifacts_folder() {
    let temp = TempDir::new().unwrap();
    let (plans_dir, artifacts_dir) = artifacts_plan(&temp);
    let plan_yaml = artifacts_dir.parent().unwrap().join("plan.yaml");
    fs::write(&plan_yaml, "state: Review\n").unwrap();
    let traversal = artifacts_dir.join("..").join("plan.yaml");

    for path in [
        plan_yaml.to_string_lossy().to_string(),
        traversal.to_string_lossy().to_string(),
        "plan.yaml".to_string(),
        "../plan.yaml".to_string(),
    ] {
        let err = read_plan_artifact(&plans_dir, "00009", &path).unwrap_err();
        assert!(
            matches!(err, PlanArtifactReadError::OutsideArtifacts(_)),
            "{path} must be refused as outside, got {err:?}"
        );
    }
}

#[cfg(unix)]
#[test]
fn read_plan_artifact_does_not_follow_a_symlink_out_of_the_folder() {
    let temp = TempDir::new().unwrap();
    let (plans_dir, artifacts_dir) = artifacts_plan(&temp);
    let secret = temp.path().join("config.yaml");
    fs::write(&secret, "llm: secret\n").unwrap();
    let link = artifacts_dir.join("config.txt");
    std::os::unix::fs::symlink(&secret, &link).unwrap();

    let err = read_plan_artifact(&plans_dir, "00009", link.to_str().unwrap()).unwrap_err();

    assert!(matches!(err, PlanArtifactReadError::OutsideArtifacts(_)));
}

#[test]
fn read_plan_artifact_distinguishes_a_missing_file_and_a_missing_plan() {
    let temp = TempDir::new().unwrap();
    let (plans_dir, artifacts_dir) = artifacts_plan(&temp);
    let missing = artifacts_dir.join("gone.txt");

    let err = read_plan_artifact(&plans_dir, "00009", missing.to_str().unwrap()).unwrap_err();
    assert!(matches!(err, PlanArtifactReadError::NotFound(_)));

    // A directory is not an artifact either.
    let dir = artifacts_dir.join("screenshots");
    let err = read_plan_artifact(&plans_dir, "00009", dir.to_str().unwrap()).unwrap_err();
    assert!(matches!(err, PlanArtifactReadError::NotFound(_)));

    let err = read_plan_artifact(&plans_dir, "09999", missing.to_str().unwrap()).unwrap_err();
    assert!(matches!(err, PlanArtifactReadError::PlanNotFound(_)));
}

#[test]
fn plan_artifact_content_serializes_with_a_kind_tag() {
    let text = serde_json::to_value(PlanArtifactContent::Text {
        text: "hi".to_string(),
        size: 2,
    })
    .unwrap();
    assert_eq!(
        text,
        serde_json::json!({ "kind": "text", "text": "hi", "size": 2 })
    );

    let too_large = serde_json::to_value(PlanArtifactContent::TooLarge { size: 9 }).unwrap();
    assert_eq!(
        too_large,
        serde_json::json!({ "kind": "tooLarge", "size": 9 })
    );
}
