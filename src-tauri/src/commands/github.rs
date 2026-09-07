use crate::error::BridgeError;
use crate::models::{GitHubIssueDto, GitHubLabelDto, GitHubRepositoryDto, GitHubUserDto};
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGitHubIssue {
    number: u64,
    title: String,
    #[serde(default)]
    body: Option<String>,
    state: String,
    #[serde(default)]
    author: Option<GitHubUserDto>,
    #[serde(default)]
    assignees: Vec<GitHubUserDto>,
    #[serde(default)]
    labels: Vec<GitHubLabelDto>,
    #[serde(default)]
    comments_count: Option<u64>,
    #[serde(default)]
    comments: Option<Vec<serde_json::Value>>,
    created_at: String,
    updated_at: String,
    url: String,
    #[serde(default)]
    repository: Option<GitHubRepositoryDto>,
    #[serde(default)]
    is_pull_request: Option<bool>,
}

/// Parse a remote git URL into an "owner/repo" slug.
pub fn extract_owner_repo_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches(".git");
    if let Some(pos) = trimmed.rfind("github.com/") {
        let slug = &trimmed[pos + "github.com/".len()..];
        return Some(slug.trim_matches('/').to_string());
    }
    if let Some(pos) = trimmed.rfind("github.com:") {
        let slug = &trimmed[pos + "github.com:".len()..];
        return Some(slug.trim_matches('/').to_string());
    }
    None
}

/// Resolve a repo identifier (either an "owner/repo" string or a local filesystem path)
/// into a GitHub "owner/repo" slug.
pub fn resolve_repo_slug(repo_str: &str) -> String {
    let trimmed = repo_str.trim();
    let path = Path::new(trimmed);

    if path.exists() {
        if let Ok(output) = std::process::Command::new("git")
            .arg("-C")
            .arg(trimmed)
            .args(["remote", "get-url", "origin"])
            .output()
        {
            if output.status.success() {
                let url = String::from_utf8_lossy(&output.stdout);
                if let Some(slug) = extract_owner_repo_from_url(&url) {
                    return slug;
                }
            }
        }
    }

    if let Some(slug) = extract_owner_repo_from_url(trimmed) {
        return slug;
    }

    trimmed.to_string()
}

/// Convert gh CLI exit code and stderr into a clean BridgeError.
pub fn parse_gh_cli_error(status_code: Option<i32>, stderr: &str) -> BridgeError {
    let lower = stderr.to_lowercase();
    if lower.contains("auth login")
        || lower.contains("authentication")
        || lower.contains("not logged into")
        || lower.contains("unauthenticated")
        || lower.contains("token")
    {
        BridgeError::unauthenticated(format!(
            "GitHub CLI is not authenticated. Please run 'gh auth login' in your terminal: {}",
            stderr.trim()
        ))
    } else if lower.contains("could not resolve to a repository") || lower.contains("not found") {
        BridgeError::not_found(format!(
            "Repository or resource not found: {}",
            stderr.trim()
        ))
    } else {
        BridgeError::with_details(
            "GITHUB_ERROR",
            format!(
                "GitHub CLI failed (exit code: {:?}): {}",
                status_code,
                stderr.trim()
            ),
            stderr.trim().to_string(),
        )
    }
}

/// Parse raw GitHub JSON from gh CLI stdout into standard GitHubIssueDto items.
pub fn parse_github_issues_json(
    json_str: &str,
    default_repo: Option<&str>,
) -> Result<Vec<GitHubIssueDto>, BridgeError> {
    let raw_list: Vec<RawGitHubIssue> = serde_json::from_str(json_str).map_err(|e| {
        BridgeError::with_details(
            "JSON_ERROR",
            format!("Failed to parse GitHub issues JSON: {e}"),
            e.to_string(),
        )
    })?;

    let items = raw_list
        .into_iter()
        .map(|raw| {
            let comments_count = raw
                .comments_count
                .or_else(|| raw.comments.as_ref().map(|c| c.len() as u64))
                .unwrap_or(0);

            let repository = raw.repository.or_else(|| {
                default_repo.map(|dr| {
                    let parts: Vec<&str> = dr.split('/').collect();
                    let name = if parts.len() >= 2 { parts[1] } else { dr };
                    GitHubRepositoryDto {
                        name: name.to_string(),
                        name_with_owner: dr.to_string(),
                    }
                })
            });

            let is_pr = raw
                .is_pull_request
                .unwrap_or_else(|| raw.url.contains("/pull/"));

            GitHubIssueDto {
                number: raw.number,
                title: raw.title,
                body: raw.body.unwrap_or_default(),
                state: raw.state.to_lowercase(),
                author: raw.author,
                assignees: raw.assignees,
                labels: raw.labels,
                comments_count,
                created_at: raw.created_at,
                updated_at: raw.updated_at,
                url: raw.url,
                repository,
                is_pull_request: is_pr,
            }
        })
        .collect();

    Ok(items)
}

#[tauri::command]
pub async fn cmd_list_github_issues(
    repo: Option<String>,
    category: Option<String>,
) -> Result<Vec<GitHubIssueDto>, BridgeError> {
    let category = category.as_deref().unwrap_or("my-issues");
    let resolved_repo = repo.as_deref().map(resolve_repo_slug);

    let mut cmd = tokio::process::Command::new("gh");

    match category {
        "review-requests" => {
            cmd.args([
                "search",
                "prs",
                "--review-requested=@me",
                "--state=open",
                "--limit",
                "50",
            ]);
            if let Some(ref r) = resolved_repo {
                if !r.is_empty() {
                    cmd.args(["--repo", r]);
                }
            }
            cmd.args([
                "--json",
                "number,title,body,state,author,assignees,labels,commentsCount,createdAt,updatedAt,url,repository",
            ]);
        }
        "project-issues" => {
            if let Some(ref r) = resolved_repo {
                if !r.is_empty() {
                    cmd.args([
                        "issue",
                        "list",
                        "--repo",
                        r,
                        "--state",
                        "open",
                        "--limit",
                        "50",
                        "--json",
                        "number,title,body,state,author,assignees,labels,comments,createdAt,updatedAt,url",
                    ]);
                } else {
                    cmd.args([
                        "search",
                        "issues",
                        "--state=open",
                        "--limit",
                        "50",
                        "--json",
                        "number,title,body,state,author,assignees,labels,commentsCount,createdAt,updatedAt,url,repository,isPullRequest",
                    ]);
                }
            } else {
                cmd.args([
                    "search",
                    "issues",
                    "--state=open",
                    "--limit",
                    "50",
                    "--json",
                    "number,title,body,state,author,assignees,labels,commentsCount,createdAt,updatedAt,url,repository,isPullRequest",
                ]);
            }
        }
        _ => {
            // Default to "my-issues"
            cmd.args([
                "search",
                "issues",
                "--assignee=@me",
                "--state=open",
                "--limit",
                "50",
            ]);
            if let Some(ref r) = resolved_repo {
                if !r.is_empty() {
                    cmd.args(["--repo", r]);
                }
            }
            cmd.args([
                "--json",
                "number,title,body,state,author,assignees,labels,commentsCount,createdAt,updatedAt,url,repository,isPullRequest",
            ]);
        }
    }

    let output = match cmd.output().await {
        Ok(out) => out,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(BridgeError::with_details(
                "NOT_FOUND",
                "GitHub CLI ('gh') is not installed or not found in PATH",
                e.to_string(),
            ));
        }
        Err(e) => {
            return Err(BridgeError::with_details(
                "IO_ERROR",
                format!("Failed to execute GitHub CLI: {e}"),
                e.to_string(),
            ));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(parse_gh_cli_error(output.status.code(), &stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_github_issues_json(&stdout, resolved_repo.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_owner_repo_from_url() {
        assert_eq!(
            extract_owner_repo_from_url("https://github.com/SpaceCorps/Tendril-App.git"),
            Some("SpaceCorps/Tendril-App".to_string())
        );
        assert_eq!(
            extract_owner_repo_from_url("git@github.com:Ivy-Interactive/Ivy-Tendril.git"),
            Some("Ivy-Interactive/Ivy-Tendril".to_string())
        );
        assert_eq!(
            extract_owner_repo_from_url("https://github.com/cli/cli"),
            Some("cli/cli".to_string())
        );
        assert_eq!(extract_owner_repo_from_url("not-a-url"), None);
    }

    #[test]
    fn test_resolve_repo_slug_passthrough() {
        assert_eq!(
            resolve_repo_slug("SpaceCorps/Tendril-App"),
            "SpaceCorps/Tendril-App"
        );
        assert_eq!(resolve_repo_slug("owner/repo-name"), "owner/repo-name");
    }

    #[test]
    fn test_parse_gh_cli_error_unauthenticated() {
        let err = parse_gh_cli_error(Some(1), "To re-authenticate, run: gh auth login");
        assert_eq!(err.code, "UNAUTHENTICATED");
        assert!(err.message.contains("gh auth login"));

        let err2 = parse_gh_cli_error(Some(1), "Authentication failed: invalid token");
        assert_eq!(err2.code, "UNAUTHENTICATED");
    }

    #[test]
    fn test_parse_gh_cli_error_generic() {
        let err = parse_gh_cli_error(Some(2), "fatal: network timeout");
        assert_eq!(err.code, "GITHUB_ERROR");
    }

    #[test]
    fn test_parse_github_issues_json_search_format() {
        let sample = r#"[
            {
                "number": 101,
                "title": "Fix memory leak in parser",
                "body": "Detailed description here",
                "state": "OPEN",
                "author": { "login": "alice", "name": "Alice Developer" },
                "assignees": [{ "login": "alice" }],
                "labels": [{ "id": "1", "name": "bug", "color": "d73a4a" }],
                "commentsCount": 4,
                "createdAt": "2026-09-01T10:00:00Z",
                "updatedAt": "2026-09-02T11:00:00Z",
                "url": "https://github.com/SpaceCorps/Tendril-App/issues/101",
                "repository": { "name": "Tendril-App", "nameWithOwner": "SpaceCorps/Tendril-App" },
                "isPullRequest": false
            }
        ]"#;

        let issues = parse_github_issues_json(sample, None).expect("Must parse JSON successfully");
        assert_eq!(issues.len(), 1);
        let issue = &issues[0];
        assert_eq!(issue.number, 101);
        assert_eq!(issue.title, "Fix memory leak in parser");
        assert_eq!(issue.state, "open");
        assert_eq!(issue.comments_count, 4);
        assert_eq!(issue.author.as_ref().unwrap().login, "alice");
        assert_eq!(issue.labels.len(), 1);
        assert_eq!(issue.labels[0].name, "bug");
        assert_eq!(issue.labels[0].color, "d73a4a");
        assert!(!issue.is_pull_request);
        assert_eq!(
            issue.repository.as_ref().unwrap().name_with_owner,
            "SpaceCorps/Tendril-App"
        );
    }

    #[test]
    fn test_parse_github_issues_json_issue_list_format() {
        let sample = r#"[
            {
                "number": 202,
                "title": "Update dependencies",
                "body": null,
                "state": "OPEN",
                "author": { "login": "bob" },
                "assignees": [],
                "labels": [],
                "comments": [
                    { "id": "c1", "body": "first comment" },
                    { "id": "c2", "body": "second comment" }
                ],
                "createdAt": "2026-09-05T08:00:00Z",
                "updatedAt": "2026-09-05T09:00:00Z",
                "url": "https://github.com/SpaceCorps/Tendril-App/issues/202"
            }
        ]"#;

        let issues = parse_github_issues_json(sample, Some("SpaceCorps/Tendril-App"))
            .expect("Must parse JSON successfully");
        assert_eq!(issues.len(), 1);
        let issue = &issues[0];
        assert_eq!(issue.number, 202);
        assert_eq!(issue.body, "");
        assert_eq!(issue.comments_count, 2);
        assert_eq!(
            issue.repository.as_ref().unwrap().name_with_owner,
            "SpaceCorps/Tendril-App"
        );
        assert_eq!(issue.repository.as_ref().unwrap().name, "Tendril-App");
    }
}
