use std::path::Path;
use std::process::Command;
use crate::error::{Result, TendrilError};

pub fn create_pr(
    repo_path: &Path,
    branch: &str,
    base: Option<&str>,
    title: &str,
    body: &str,
    draft: bool,
    reviewers: Option<&[String]>,
) -> Result<String> {
    let mut args = vec!["pr", "create", "--head", branch, "--title", title, "--body", body];

    if let Some(b) = base {
        args.push("--base");
        args.push(b);
    }

    if draft {
        args.push("--draft");
    }

    let reviewers_arg: String;
    if let Some(revs) = reviewers {
        if !revs.is_empty() {
            reviewers_arg = revs.join(",");
            args.push("--reviewer");
            args.push(&reviewers_arg);
        }
    }

    let output = Command::new("gh")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| TendrilError::Git(format!("Failed to run gh pr create: {}", e)))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(TendrilError::Git(format!("gh pr create failed: {}", err)));
    }

    let pr_url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(pr_url)
}
