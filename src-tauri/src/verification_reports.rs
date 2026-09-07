//! Reading verification reports off disk.
//!
//! ExecutePlan writes one markdown report per verification to
//! `<planFolder>/Verification/<VerificationName>.md`, with YAML frontmatter
//! carrying `result` and `date`. `tendril-server` exposes the verification
//! *definitions* (`GET /api/verifications`) but no route for report content, so
//! the app reads the files itself — it always runs on the same machine as the
//! daemon it talks to.

use crate::error::BridgeError;
use crate::models::VerificationReportDto;
use std::path::Path;

/// Reject anything that could escape the plan's `Verification/` directory.
/// Verification names come from `plan.yaml`, but they arrive here over the
/// Tauri bridge and are pasted straight into a path.
fn validate_name(name: &str) -> Result<(), BridgeError> {
    let ok = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.contains("..");

    if ok {
        Ok(())
    } else {
        Err(BridgeError::validation(format!(
            "Invalid verification name '{name}'"
        )))
    }
}

/// Pull `result` and `date` out of a report's YAML frontmatter, if it has any.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let Some(rest) = content.strip_prefix("---") else {
        return (None, None);
    };
    let Some(end) = rest.find("\n---") else {
        return (None, None);
    };

    let mut result = None;
    let mut date = None;
    for line in rest[..end].lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').to_string();
        match key.trim() {
            "result" => result = Some(value),
            "date" => date = Some(value),
            _ => {}
        }
    }

    (result, date)
}

/// Read `<plan_folder>/Verification/<name>.md`.
pub fn read_report(plan_folder: &Path, name: &str) -> Result<VerificationReportDto, BridgeError> {
    validate_name(name)?;

    let path = plan_folder.join("Verification").join(format!("{name}.md"));
    if !path.is_file() {
        return Err(BridgeError::not_found(format!(
            "No verification report for '{name}' at {}",
            path.display()
        )));
    }

    let content = std::fs::read_to_string(&path)?;
    let (result, date) = parse_frontmatter(&content);

    Ok(VerificationReportDto {
        name: name.to_string(),
        content,
        result,
        date,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(dir: &Path, name: &str, body: &str) {
        let verification_dir = dir.join("Verification");
        std::fs::create_dir_all(&verification_dir).expect("create Verification dir");
        std::fs::write(verification_dir.join(format!("{name}.md")), body).expect("write report");
    }

    #[test]
    fn reads_report_content_and_frontmatter() {
        let temp = tempfile::tempdir().expect("tempdir");
        seed(
            temp.path(),
            "RustClippy",
            "---\nresult: Pass\ndate: 2026-09-07T10:41:11Z\nattempts: 2\n---\n# RustClippy\n\n## Output\n\nno warnings\n",
        );

        let report = read_report(temp.path(), "RustClippy").expect("report is readable");

        assert_eq!(report.name, "RustClippy");
        assert_eq!(report.result.as_deref(), Some("Pass"));
        assert_eq!(report.date.as_deref(), Some("2026-09-07T10:41:11Z"));
        assert!(report.content.contains("no warnings"));
    }

    #[test]
    fn reports_a_failing_verification_as_fail() {
        let temp = tempfile::tempdir().expect("tempdir");
        seed(
            temp.path(),
            "RustTest",
            "---\nresult: Fail\n---\n# RustTest\n\n2 tests failed\n",
        );

        let report = read_report(temp.path(), "RustTest").expect("report is readable");
        assert_eq!(report.result.as_deref(), Some("Fail"));
    }

    #[test]
    fn missing_report_is_not_found_rather_than_an_io_error() {
        let temp = tempfile::tempdir().expect("tempdir");
        let err = read_report(temp.path(), "CheckResult").expect_err("no report exists");
        assert_eq!(err.code, "NOT_FOUND");
    }

    #[test]
    fn report_without_frontmatter_still_returns_content() {
        let temp = tempfile::tempdir().expect("tempdir");
        seed(temp.path(), "RustBuild", "# RustBuild\n\nplain report\n");

        let report = read_report(temp.path(), "RustBuild").expect("report is readable");
        assert_eq!(report.result, None);
        assert!(report.content.contains("plain report"));
    }

    #[test]
    fn rejects_names_that_would_escape_the_verification_directory() {
        let temp = tempfile::tempdir().expect("tempdir");

        for name in ["../../etc/passwd", "..", "sub/dir", ""] {
            let err = read_report(temp.path(), name).expect_err("name must be rejected");
            assert_eq!(err.code, "VALIDATION_ERROR", "name {name:?}");
        }
    }
}
