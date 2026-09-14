use crate::error::BridgeError;
use crate::models::{
    GitHubIssueDto, GitHubIssuesPageDto, GitHubLabelDto, GitHubRepositoryDto, GitHubUserDto,
};
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

#[derive(Debug, Clone, Deserialize)]
struct RawGitHubApiUser {
    login: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawGitHubApiLabel {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawGitHubApiRepository {
    name: String,
    full_name: String,
}

/// Shape of one issue/PR item as returned by the GitHub REST API, either from
/// `GET /repos/{owner}/{repo}/issues` or from the `items` array of `GET /search/issues`.
#[derive(Debug, Clone, Deserialize)]
struct RawGitHubApiIssue {
    number: u64,
    title: String,
    #[serde(default)]
    body: Option<String>,
    state: String,
    #[serde(default)]
    user: Option<RawGitHubApiUser>,
    #[serde(default)]
    assignees: Vec<RawGitHubApiUser>,
    #[serde(default)]
    labels: Vec<RawGitHubApiLabel>,
    #[serde(default)]
    comments: Option<u64>,
    created_at: String,
    updated_at: String,
    html_url: String,
    #[serde(default)]
    repository: Option<RawGitHubApiRepository>,
    #[serde(default)]
    repository_url: Option<String>,
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

/// Envelope returned by `GET /search/issues`.
#[derive(Debug, Clone, Deserialize)]
struct RawGitHubSearchEnvelope {
    total_count: u64,
    items: Vec<RawGitHubApiIssue>,
}

fn repository_from_url(repository_url: &str) -> Option<GitHubRepositoryDto> {
    let marker = "/repos/";
    let pos = repository_url.find(marker)?;
    let slug = &repository_url[pos + marker.len()..];
    let parts: Vec<&str> = slug.trim_matches('/').split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    Some(GitHubRepositoryDto {
        name: parts[1].to_string(),
        name_with_owner: format!("{}/{}", parts[0], parts[1]),
    })
}

fn map_raw_api_issue(raw: RawGitHubApiIssue, default_repo: Option<&str>) -> GitHubIssueDto {
    let repository = raw
        .repository
        .map(|r| GitHubRepositoryDto {
            name: r.name,
            name_with_owner: r.full_name,
        })
        .or_else(|| raw.repository_url.as_deref().and_then(repository_from_url))
        .or_else(|| {
            default_repo.map(|dr| {
                let parts: Vec<&str> = dr.split('/').collect();
                let name = if parts.len() >= 2 { parts[1] } else { dr };
                GitHubRepositoryDto {
                    name: name.to_string(),
                    name_with_owner: dr.to_string(),
                }
            })
        });

    let labels = raw
        .labels
        .into_iter()
        .filter_map(|l| {
            let name = l.name?;
            Some(GitHubLabelDto {
                id: None,
                name,
                color: l.color.unwrap_or_default(),
                description: l.description,
            })
        })
        .collect();

    GitHubIssueDto {
        number: raw.number,
        title: raw.title,
        body: raw.body.unwrap_or_default(),
        state: raw.state.to_lowercase(),
        author: raw.user.map(|u| GitHubUserDto {
            login: u.login,
            name: u.name,
            avatar_url: u.avatar_url,
        }),
        assignees: raw
            .assignees
            .into_iter()
            .map(|u| GitHubUserDto {
                login: u.login,
                name: u.name,
                avatar_url: u.avatar_url,
            })
            .collect(),
        labels,
        comments_count: raw.comments.unwrap_or(0),
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        url: raw.html_url,
        repository,
        is_pull_request: raw.pull_request.is_some(),
    }
}

/// Parse a page of GitHub REST API issue/PR results into DTOs plus an optional
/// total count. Handles both a raw JSON array (`GET /repos/{owner}/{repo}/issues`)
/// and the `{ total_count, items }` envelope (`GET /search/issues`).
pub fn parse_github_issues_page_json(
    json_str: &str,
    default_repo: Option<&str>,
) -> Result<(Vec<GitHubIssueDto>, Option<u64>), BridgeError> {
    if let Ok(envelope) = serde_json::from_str::<RawGitHubSearchEnvelope>(json_str) {
        let issues = envelope
            .items
            .into_iter()
            .map(|raw| map_raw_api_issue(raw, default_repo))
            .collect();
        return Ok((issues, Some(envelope.total_count)));
    }

    let raw_list: Vec<RawGitHubApiIssue> = serde_json::from_str(json_str).map_err(|e| {
        BridgeError::with_details(
            "JSON_ERROR",
            format!("Failed to parse GitHub issues JSON: {e}"),
            e.to_string(),
        )
    })?;

    let issues = raw_list
        .into_iter()
        .map(|raw| map_raw_api_issue(raw, default_repo))
        .collect();
    Ok((issues, None))
}

/// Normalize pagination inputs: `page` defaults to 1 (minimum 1), `per_page`
/// defaults to 50 (clamped between 10 and 100).
fn normalize_pagination(page: Option<u32>, per_page: Option<u32>) -> (u32, u32) {
    let page = page.unwrap_or(1).max(1);
    let per_page = per_page.unwrap_or(50).clamp(10, 100);
    (page, per_page)
}

fn search_query_for_category(category: &str, resolved_repo: Option<&str>) -> String {
    let mut query = match category {
        "review-requests" => "is:open is:pr review-requested:@me".to_string(),
        "project-issues" => "is:open is:issue".to_string(),
        _ => "is:open is:issue assignee:@me".to_string(),
    };
    if let Some(r) = resolved_repo {
        if !r.is_empty() {
            query.push_str(&format!(" repo:{r}"));
        }
    }
    query
}

#[tauri::command]
pub async fn cmd_list_github_issues(
    repo: Option<String>,
    category: Option<String>,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<GitHubIssuesPageDto, BridgeError> {
    let category = category.as_deref().unwrap_or("my-issues");
    let resolved_repo = repo.as_deref().map(resolve_repo_slug);
    let (page, per_page) = normalize_pagination(page, per_page);

    let mut cmd = tokio::process::Command::new("gh");
    cmd.arg("api").args(["-X", "GET"]);

    let use_repo_issues_endpoint =
        category == "project-issues" && resolved_repo.as_deref().is_some_and(|r| !r.is_empty());

    if use_repo_issues_endpoint {
        let r = resolved_repo.as_deref().unwrap();
        cmd.arg(format!("repos/{r}/issues"));
        cmd.args(["-f", "state=open"]);
    } else {
        cmd.arg("search/issues");
        let query = search_query_for_category(category, resolved_repo.as_deref());
        cmd.args(["-f", &format!("q={query}")]);
    }

    cmd.args(["-F", &format!("per_page={per_page}")]);
    cmd.args(["-F", &format!("page={page}")]);

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
    let (issues, total_count) = parse_github_issues_page_json(&stdout, resolved_repo.as_deref())?;

    let has_more = total_count.map_or(issues.len() == per_page as usize, |total| {
        (page as u64) * (per_page as u64) < total
    });

    Ok(GitHubIssuesPageDto {
        issues,
        total_count,
        page,
        per_page,
        has_more,
    })
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

    #[test]
    fn test_parse_github_issues_page_json_search_envelope() {
        let sample = r#"{
            "total_count": 120,
            "incomplete_results": false,
            "items": [
                {
                    "number": 5,
                    "title": "Search result issue",
                    "body": "Body text",
                    "state": "open",
                    "user": { "login": "dana" },
                    "assignees": [],
                    "labels": [{ "name": "bug", "color": "d73a4a" }],
                    "comments": 2,
                    "created_at": "2026-09-01T10:00:00Z",
                    "updated_at": "2026-09-02T11:00:00Z",
                    "html_url": "https://github.com/SpaceCorps/Tendril-App/issues/5",
                    "repository_url": "https://api.github.com/repos/SpaceCorps/Tendril-App"
                }
            ]
        }"#;

        let (issues, total_count) =
            parse_github_issues_page_json(sample, None).expect("Must parse envelope");
        assert_eq!(total_count, Some(120));
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].number, 5);
        assert!(!issues[0].is_pull_request);
        assert_eq!(
            issues[0].repository.as_ref().unwrap().name_with_owner,
            "SpaceCorps/Tendril-App"
        );
    }

    #[test]
    fn test_parse_github_issues_page_json_raw_array_no_total_count() {
        let sample = r#"[
            {
                "number": 9,
                "title": "Repo issue",
                "state": "open",
                "assignees": [],
                "labels": [],
                "created_at": "2026-09-01T10:00:00Z",
                "updated_at": "2026-09-02T11:00:00Z",
                "html_url": "https://github.com/SpaceCorps/Tendril-App/pull/9",
                "pull_request": { "url": "https://api.github.com/repos/SpaceCorps/Tendril-App/pulls/9" }
            }
        ]"#;

        let (issues, total_count) =
            parse_github_issues_page_json(sample, Some("SpaceCorps/Tendril-App"))
                .expect("Must parse raw array");
        assert_eq!(total_count, None);
        assert_eq!(issues.len(), 1);
        assert!(issues[0].is_pull_request);
        assert_eq!(
            issues[0].repository.as_ref().unwrap().name_with_owner,
            "SpaceCorps/Tendril-App"
        );
    }

    #[test]
    fn test_normalize_pagination_defaults_and_clamping() {
        assert_eq!(normalize_pagination(None, None), (1, 50));
        assert_eq!(normalize_pagination(Some(0), Some(5)), (1, 10));
        assert_eq!(normalize_pagination(Some(3), Some(500)), (3, 100));
        assert_eq!(normalize_pagination(Some(2), Some(75)), (2, 75));
    }

    #[test]
    fn test_has_more_calculation_with_total_count() {
        let total = Some(120u64);
        let page = 2u32;
        let per_page = 50u32;
        let has_more = total.is_some_and(|t| (page as u64) * (per_page as u64) < t);
        assert!(has_more);

        let page_last = 3u32;
        let has_more_last = total.is_some_and(|t| (page_last as u64) * (per_page as u64) < t);
        assert!(!has_more_last);
    }

    #[test]
    fn test_has_more_calculation_without_total_count_uses_length_heuristic() {
        let total: Option<u64> = None;
        let per_page = 50usize;
        let full_page_len = 50usize;
        let partial_page_len = 10usize;

        let has_more_full = total.map_or(full_page_len == per_page, |_| unreachable!());
        let has_more_partial = total.map_or(partial_page_len == per_page, |_| unreachable!());

        assert!(has_more_full);
        assert!(!has_more_partial);
    }
}
