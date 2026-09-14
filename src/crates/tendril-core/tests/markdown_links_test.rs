//! Port of the 25 cases in the legacy `MarkdownLinkPolisherTests.cs`, plus the V2-specific
//! questions-fence protection tests that have no legacy equivalent.
//!
//! This repo has no `tempfile` dev-dependency (the plan's claim that one is "already used across
//! tendril-core/tests" does not hold — every other test file here builds its own scratch directory
//! under `std::env::temp_dir()` with a `uuid`-suffixed name instead), so these tests follow that
//! existing convention rather than adding a new dependency.

use std::path::{Path, PathBuf};
use tendril_core::plans::{normalize_path, polish_links};

struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("create temp root");
        Self { path }
    }

    fn repo_dir(&self) -> PathBuf {
        let dir = self.path.join("repo");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn plans_dir(&self) -> PathBuf {
        let dir = self.path.join("Plans");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn make_plan(&self, folder_name: &str) -> PathBuf {
        let dir = self.plans_dir().join(folder_name);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn write_file(dir: &Path, name: &str) -> String {
    let file_path = dir.join(name);
    std::fs::write(&file_path, "content").unwrap();
    file_path.to_string_lossy().replace('\\', "/")
}

#[test]
fn test_converts_plan_revision_links() {
    let tmp = TempRoot::new("md-links-revision");
    let input = "[Plan 01450](file:///D:/Tendril/Plans/01450-Something/revisions/001.md)";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, "[Plan 01450](plan://01450)");
}

#[test]
fn test_converts_bare_plan_numbers() {
    let tmp = TempRoot::new("md-links-bare");
    tmp.make_plan("02369-SomePlan");
    tmp.make_plan("03232-OtherPlan");

    let result = polish_links("Plans 02369, 03232", &tmp.plans_dir());
    assert_eq!(result, "Plans [02369](plan://02369), [03232](plan://03232)");
}

#[test]
fn test_leaves_bare_number_for_nonexistent_plan() {
    let tmp = TempRoot::new("md-links-missing-plan");
    let result = polish_links("Plan 09999", &tmp.plans_dir());
    assert_eq!(result, "Plan 09999");
}

#[test]
fn test_collapses_nested_plan_links() {
    let tmp = TempRoot::new("md-links-nested");
    tmp.make_plan("00050-SomePlan");

    let input = "[Plan [00050](plan://00050)](plan://00050)";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, "[Plan 00050](plan://00050)");
}

#[test]
fn test_removes_backticks_from_link_text() {
    let tmp = TempRoot::new("md-links-backticks");
    let repo = tmp.repo_dir();
    let path = write_file(&repo, "File.cs");

    let input = format!("[`File.cs:131-176`](file:///{path})");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, format!("[File.cs:131-176](file:///{path})"));
}

#[test]
fn test_removes_line_number_anchors() {
    let tmp = TempRoot::new("md-links-anchor");
    let repo = tmp.repo_dir();
    let path = write_file(&repo, "Test.cs");

    let input = format!("[Test.cs:26](file:///{path}#26)");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, format!("[Test.cs:26](file:///{path})"));
}

#[test]
fn test_removes_colon_line_number_suffix() {
    let tmp = TempRoot::new("md-links-colon");
    let repo = tmp.repo_dir();
    let path = write_file(&repo, "jwt-tester.tsx");

    let input = format!("[jwt-tester.tsx:348](file:///{path}:348)");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, format!("[jwt-tester.tsx:348](file:///{path})"));
}

#[test]
fn test_removes_colon_line_range_suffix() {
    let tmp = TempRoot::new("md-links-colon-range");
    let repo = tmp.repo_dir();
    let path = write_file(&repo, "jwt-tester.tsx");

    let input = format!("[jwt-tester.tsx:348-350](file:///{path}:348-350)");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, format!("[jwt-tester.tsx:348-350](file:///{path})"));
}

#[test]
fn test_preserves_drive_letter_colon_without_line_number() {
    let tmp = TempRoot::new("md-links-drive-letter");
    let repo = tmp.repo_dir();
    let path = write_file(&repo, "bar.tsx");

    let input = format!("[bar.tsx](file:///{path})");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_simplifies_verbose_link_text_with_full_path() {
    let tmp = TempRoot::new("md-links-verbose-full");
    let repo = tmp.repo_dir();
    let apps_dir = repo.join("src").join("Apps");
    std::fs::create_dir_all(&apps_dir).unwrap();
    let path = write_file(&apps_dir, "JobsApp.cs");

    let verbose_text = format!("file:///{path}:205");
    let input = format!("[`{verbose_text}`](file:///{path}#L205)");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, format!("[JobsApp.cs:205](file:///{path})"));
}

#[test]
fn test_simplifies_verbose_link_text_without_line_number() {
    let tmp = TempRoot::new("md-links-verbose-no-line");
    let repo = tmp.repo_dir();
    let src_dir = repo.join("src");
    std::fs::create_dir_all(&src_dir).unwrap();
    let path = write_file(&src_dir, "Program.cs");

    let verbose_text = format!("file:///{path}");
    let input = format!("[`{verbose_text}`](file:///{path})");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, format!("[Program.cs](file:///{path})"));
}

#[test]
fn test_simplifies_link_text_with_line_range() {
    let tmp = TempRoot::new("md-links-range");
    let repo = tmp.repo_dir();
    let src_dir = repo.join("src");
    std::fs::create_dir_all(&src_dir).unwrap();
    let path = write_file(&src_dir, "Utils.cs");

    let input = format!("[file:///{path}:42-50](file:///{path})");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, format!("[Utils.cs:42-50](file:///{path})"));
}

#[test]
fn test_normalizes_path_segments() {
    let result = normalize_path("D:\\Repos\\src\\tendril\\..\\tendril\\File.cs");
    assert_eq!(result, "D:/Repos/src/tendril/File.cs");
}

#[test]
fn test_simplifies_windows_style_link_text_on_any_platform() {
    // Pins the deliberate divergence from V1: V1 only tests its own OS's separator, so a
    // Windows-style link text is left alone on macOS/Linux. This port checks both separators
    // unconditionally, so the behavior is identical on every platform.
    let tmp = TempRoot::new("md-links-windows-style");
    let input = "[D:\\repo\\File.cs](file:///D:/repo/File.cs)";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, "[File.cs](file:///D:/repo/File.cs)");
}

#[test]
fn test_does_not_link_plan_numbers_in_inline_code() {
    let tmp = TempRoot::new("md-links-inline-code");
    tmp.make_plan("02369-SomePlan");

    let input = "Run `Plan 02369` and also ``Plan 02369``.";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_does_not_link_plan_numbers_in_fenced_code() {
    let tmp = TempRoot::new("md-links-fenced-code");
    tmp.make_plan("02369-SomePlan");

    let input = "```\nSee Plan 02369 for details.\n```";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_does_not_link_plan_numbers_in_tilde_fence() {
    let tmp = TempRoot::new("md-links-tilde-fence");
    tmp.make_plan("02369-SomePlan");

    let input = "~~~\nSee Plan 02369 for details.\n~~~";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_does_not_collapse_nested_plan_link_in_inline_code() {
    let tmp = TempRoot::new("md-links-nested-inline-code");
    tmp.make_plan("00050-SomePlan");

    let input = "`[Plan [00050](plan://00050)](plan://00050)`";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_preserves_inline_code_backticks() {
    let tmp = TempRoot::new("md-links-preserve-inline");
    let input = "Use `SomeMethod()` to call it";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_preserves_plan_links() {
    let tmp = TempRoot::new("md-links-preserve-plan");
    tmp.make_plan("01234-SomePlan");

    let input = "[Plan 01234](plan://01234)";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_preserves_plan_link_alongside_bare_number() {
    let tmp = TempRoot::new("md-links-plan-and-bare");
    tmp.make_plan("01234-SomePlan");
    tmp.make_plan("02369-SomePlan");

    let input = "[Plan 01234](plan://01234) and Plan 02369.";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(
        result,
        "[Plan 01234](plan://01234) and Plan [02369](plan://02369)."
    );
}

#[test]
fn test_preserves_plural_plan_link_text() {
    let tmp = TempRoot::new("md-links-plural");
    tmp.make_plan("01234-SomePlan");
    tmp.make_plan("02369-SomePlan");

    let input = "[Plans 01234, 02369](plan://01234)";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_leaves_ambiguous_links_unchanged() {
    let tmp = TempRoot::new("md-links-ambiguous");
    let repo = tmp.repo_dir();
    let dir1 = repo.join("dir1");
    let dir2 = repo.join("dir2");
    std::fs::create_dir_all(&dir1).unwrap();
    std::fs::create_dir_all(&dir2).unwrap();
    std::fs::write(dir1.join("Dup.cs"), "a").unwrap();
    std::fs::write(dir2.join("Dup.cs"), "b").unwrap();

    let input = "[Dup.cs](file:///Z:/wrong/Dup.cs)";
    let result = polish_links(input, &tmp.plans_dir());
    assert!(result.contains("file:///Z:/wrong/Dup.cs"));
}

#[test]
fn test_does_not_redirect_missing_path_to_same_named_file() {
    let tmp = TempRoot::new("md-links-missing-path");
    let repo = tmp.repo_dir();
    let src_dir = repo.join("src");
    std::fs::create_dir_all(&src_dir).unwrap();
    std::fs::write(src_dir.join("MyFile.cs"), "content").unwrap();

    let input = "[MyFile.cs](file:///Z:/wrong/path/MyFile.cs)";
    let result = polish_links(input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_preserves_already_simplified_links() {
    let tmp = TempRoot::new("md-links-already-simplified");
    let repo = tmp.repo_dir();
    let apps_dir = repo.join("src").join("Apps");
    std::fs::create_dir_all(&apps_dir).unwrap();
    let path = write_file(&apps_dir, "JobsApp.cs");

    let input = format!("[JobsApp.cs:205](file:///{path})");
    let result = polish_links(&input, &tmp.plans_dir());
    assert_eq!(result, input);
}

#[test]
fn test_is_idempotent() {
    let tmp = TempRoot::new("md-links-idempotent");
    tmp.make_plan("02369-SomePlan");
    let repo = tmp.repo_dir();
    let path = write_file(&repo, "jwt-tester.tsx");

    let input = format!("See [`file:///{path}:348`](file:///{path}:348) and Plans 02369.");
    let once = polish_links(&input, &tmp.plans_dir());
    let twice = polish_links(&once, &tmp.plans_dir());

    assert_eq!(once, twice);
    assert_eq!(
        once,
        format!("See [jwt-tester.tsx:348](file:///{path}) and Plans [02369](plan://02369).")
    );
}

#[test]
fn test_is_idempotent_for_plan_links() {
    let tmp = TempRoot::new("md-links-idempotent-plan");
    tmp.make_plan("01234-SomePlan");

    let input = "[Plan 01234](plan://01234)";
    let once = polish_links(input, &tmp.plans_dir());
    let twice = polish_links(&once, &tmp.plans_dir());

    assert_eq!(once, twice);
    assert!(!regex::Regex::new(r"\]\(plan://\d+\)\]\(")
        .unwrap()
        .is_match(&once));
    assert_eq!(once, "[Plan 01234](plan://01234)");
}

// Questions-fence protection (V2-specific, no legacy equivalent).

#[test]
fn test_does_not_touch_questions_fence_body() {
    let tmp = TempRoot::new("md-links-fence-body");
    tmp.make_plan("02369-SomePlan");

    let input = "Before Plan 02369.\n\n```questions\nquestions:\n  - id: q1\n    title: \"See Plan 02369\"\n    options:\n      - title: A\n        value: \"02369\"\n      - title: B\n        value: other\n```\n\nAfter Plan 02369.";
    let result = polish_links(input, &tmp.plans_dir());

    assert!(result.contains("Before Plan [02369](plan://02369)."));
    assert!(result.contains("After Plan [02369](plan://02369)."));
    assert!(result.contains("title: \"See Plan 02369\""));
    assert!(result.contains("value: \"02369\""));
}

#[test]
fn test_polishes_around_questions_fence() {
    let tmp = TempRoot::new("md-links-around-fence");
    tmp.make_plan("01234-SomePlan");
    tmp.make_plan("02369-SomePlan");

    let input = "Plan 01234 before.\n```questions\nquestions:\n  - id: q1\n    title: Pick one\n    options:\n      - title: A\n        value: a\n      - title: B\n        value: b\n```\nPlan 02369 after.";
    let result = polish_links(input, &tmp.plans_dir());

    assert!(result.starts_with("Plan [01234](plan://01234) before."));
    assert!(result.ends_with("Plan [02369](plan://02369) after."));
    assert!(result.contains("```questions\nquestions:\n  - id: q1\n    title: Pick one\n    options:\n      - title: A\n        value: a\n      - title: B\n        value: b\n```"));
}

#[test]
fn test_handles_two_questions_fences() {
    let tmp = TempRoot::new("md-links-two-fences");
    tmp.make_plan("01234-SomePlan");
    tmp.make_plan("02369-SomePlan");

    let fence1 = "```questions\nquestions:\n  - id: q1\n    title: First\n    options:\n      - title: A\n        value: a\n      - title: B\n        value: b\n```";
    let fence2 = "```questions\nquestions:\n  - id: q2\n    title: Second\n    options:\n      - title: C\n        value: c\n      - title: D\n        value: d\n```";
    let input = format!("Plan 01234.\n{fence1}\nBetween Plan 02369.\n{fence2}\nEnd.");
    let result = polish_links(&input, &tmp.plans_dir());

    assert!(result.contains("Plan [01234](plan://01234)."));
    assert!(result.contains(fence1));
    assert!(result.contains("Between Plan [02369](plan://02369)."));
    assert!(result.contains(fence2));
    assert!(result.ends_with("End."));
}

#[test]
fn test_preserves_leading_blank_line_with_questions_fence() {
    let tmp = TempRoot::new("md-links-leading-blank");
    let fence = "```questions\nquestions:\n  - id: q1\n    title: Pick one\n    options:\n      - title: A\n        value: a\n      - title: B\n        value: b\n```";
    let input = format!("\n{fence}\nAfter.");
    let result = polish_links(&input, &tmp.plans_dir());

    assert!(result.starts_with('\n'));
    assert!(result.contains(fence));
    assert!(result.ends_with("After."));
}

#[test]
fn test_preserves_crlf_around_questions_fence() {
    let tmp = TempRoot::new("md-links-crlf");
    let fence = "```questions\r\nquestions:\r\n  - id: q1\r\n    title: Pick one\r\n    options:\r\n      - title: A\r\n        value: a\r\n      - title: B\r\n        value: b\r\n```";
    let input = format!("Prose line.\r\n{fence}\r\nMore prose.");
    let result = polish_links(&input, &tmp.plans_dir());

    assert_eq!(result, input);
}
