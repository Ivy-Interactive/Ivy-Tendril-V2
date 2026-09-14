use crate::error::{Result, TendrilError};
use crate::git::issues::run_gh_command;
use crate::models::{canonical_pr_url, PrState};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

pub fn create_pr(
    repo_path: &Path,
    branch: &str,
    base: Option<&str>,
    title: &str,
    body: &str,
    draft: bool,
    reviewers: Option<&[String]>,
) -> Result<String> {
    let mut args = vec![
        "pr", "create", "--head", branch, "--title", title, "--body", body,
    ];

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

// ---------------------------------------------------------------------------
// Pull request status
// ---------------------------------------------------------------------------

/// What one `gh` response says about a pull request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrInfo {
    pub status: PrState,
    pub branch: Option<String>,
}

impl PrInfo {
    pub fn unknown() -> Self {
        Self {
            status: PrState::Unknown,
            branch: None,
        }
    }
}

/// Pure parser over `gh pr list --json url,state,headRefName` output, keyed by canonical PR URL.
///
/// Entries whose `url` is not a recognisable PR URL are dropped rather than failing the batch: one
/// odd row must not cost the whole repository's refresh.
pub fn parse_pr_statuses(json: &str) -> Result<HashMap<String, PrInfo>> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json)
        .map_err(|e| TendrilError::Git(format!("Failed to parse gh pr list output: {}", e)))?;

    let mut out = HashMap::new();
    for row in rows {
        let Some(url) = row.get("url").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(key) = canonical_pr_url(url) else {
            continue;
        };
        out.insert(key, pr_info_from_json(&row));
    }
    Ok(out)
}

/// One `gh` call per repository, never one per PR: this is the rate-limit contract the
/// reconciliation pass depends on.
pub async fn fetch_repo_pr_statuses(owner: &str, repo: &str) -> Result<HashMap<String, PrInfo>> {
    let args = [
        "pr".to_string(),
        "list".to_string(),
        "--repo".to_string(),
        format!("{}/{}", owner, repo),
        "--limit".to_string(),
        "100".to_string(),
        "--state".to_string(),
        "all".to_string(),
        "--json".to_string(),
        "url,state,headRefName".to_string(),
    ];
    let stdout = run_gh_command(&args, None).await?;
    parse_pr_statuses(&stdout)
}

/// Single-PR resolution, for the cases where the `--limit 100` window is not good enough: the
/// dependency gate (which must be exact) and the doctor check (which must not report a healthy PR on
/// a busy repository as phantom).
pub async fn fetch_pr_status(pr_url: &str) -> Result<PrInfo> {
    let args = [
        "pr".to_string(),
        "view".to_string(),
        pr_url.to_string(),
        "--json".to_string(),
        "state,headRefName".to_string(),
    ];
    let stdout = run_gh_command(&args, None).await?;
    let value: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| TendrilError::Git(format!("Failed to parse gh pr view output: {}", e)))?;
    Ok(pr_info_from_json(&value))
}

/// Runs a `gh` future to completion from synchronous code.
///
/// The reconciliation pass and the dependency gate both hold a `rusqlite::Connection` (not `Send`)
/// and are therefore blocking by construction, but there must be exactly one *fetch* code path per
/// shape — so they reach the async `gh` helpers through here rather than shelling out a second time.
/// The future runs on its own thread with its own current-thread runtime, which is the one form that
/// neither panics on a reactor thread (as `Runtime::block_on` would) nor requires a multi-threaded
/// runtime to be present (as `block_in_place` would).
pub fn block_on_gh<T, F>(fut: F) -> Result<T>
where
    F: std::future::Future<Output = Result<T>> + Send,
    T: Send,
{
    std::thread::scope(|scope| {
        scope
            .spawn(|| {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| {
                        TendrilError::Git(format!("Failed to start a runtime for gh: {}", e))
                    })?;
                rt.block_on(fut)
            })
            .join()
            .unwrap_or_else(|_| Err(TendrilError::Git("gh resolver thread panicked".to_string())))
    })
}

fn pr_info_from_json(value: &serde_json::Value) -> PrInfo {
    let status = value
        .get("state")
        .and_then(|v| v.as_str())
        .map(PrState::from_str_loose)
        .unwrap_or(PrState::Unknown);
    let branch = value
        .get("headRefName")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|b| !b.is_empty());
    PrInfo { status, branch }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST_JSON: &str = r#"[
      {"url":"https://github.com/acme/widgets/pull/7","state":"MERGED","headRefName":"tendril/00002-Upstream"},
      {"url":"https://github.com/acme/widgets/pull/8","state":"OPEN","headRefName":"tendril/00003-Feature"},
      {"url":"https://github.com/acme/widgets/pull/9","state":"CLOSED","headRefName":null}
    ]"#;

    #[test]
    fn parses_a_repo_listing_keyed_by_canonical_url() {
        let map = parse_pr_statuses(LIST_JSON).expect("parse");
        assert_eq!(map.len(), 3);
        assert_eq!(
            map.get("https://github.com/acme/widgets/pull/7"),
            Some(&PrInfo {
                status: PrState::Merged,
                branch: Some("tendril/00002-Upstream".to_string())
            })
        );
        assert_eq!(
            map["https://github.com/acme/widgets/pull/8"].status,
            PrState::Open
        );
        assert_eq!(
            map["https://github.com/acme/widgets/pull/9"],
            PrInfo {
                status: PrState::Closed,
                branch: None
            }
        );
    }

    #[test]
    fn an_empty_listing_is_an_empty_map_not_an_error() {
        assert!(parse_pr_statuses("[]").expect("parse").is_empty());
    }

    #[test]
    fn a_non_json_body_is_an_error() {
        assert!(parse_pr_statuses("gh: command not found").is_err());
    }
}
