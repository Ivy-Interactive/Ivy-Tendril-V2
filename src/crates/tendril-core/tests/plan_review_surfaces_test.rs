use std::fs;
use tempfile::TempDir;
use tendril_core::plans::{read_plan_artifacts, read_plan_summary};

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
    assert!(artifacts.screenshots[0].ends_with("diagram.svg") || artifacts.screenshots[1].ends_with("diagram.svg"));
    assert!(artifacts.screenshots[0].ends_with("shot1.png") || artifacts.screenshots[1].ends_with("shot1.png"));

    assert_eq!(artifacts.other.len(), 1);
    assert!(artifacts.other[0].ends_with("output.json"));
}
