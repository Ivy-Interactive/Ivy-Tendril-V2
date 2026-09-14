use crate::config::expand_variables;
use crate::error::{Result, TendrilError};
use crate::git::service::run_git;
use crate::models::ProjectConfig;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::{LazyLock, RwLock};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubIssue {
    pub number: u64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, deserialize_with = "deserialize_labels")]
    pub labels: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_assignees")]
    pub assignees: Vec<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_repository",
        skip_serializing_if = "Option::is_none"
    )]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(
        rename = "updatedAt",
        alias = "updated_at",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub updated_at: Option<String>,
    #[serde(
        rename = "headRefName",
        alias = "head_ref_name",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub head_ref_name: Option<String>,
}

fn deserialize_labels<'de, D>(deserializer: D) -> std::result::Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum LabelItem {
        Name(String),
        Obj { name: String },
    }

    let items: Vec<LabelItem> = Vec::deserialize(deserializer)?;
    Ok(items
        .into_iter()
        .map(|item| match item {
            LabelItem::Name(s) => s,
            LabelItem::Obj { name } => name,
        })
        .collect())
}

fn deserialize_assignees<'de, D>(deserializer: D) -> std::result::Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum AssigneeItem {
        Login(String),
        Obj { login: String },
    }

    let items: Vec<AssigneeItem> = Vec::deserialize(deserializer)?;
    Ok(items
        .into_iter()
        .map(|item| match item {
            AssigneeItem::Login(s) => s,
            AssigneeItem::Obj { login } => login,
        })
        .collect())
}

fn deserialize_repository<'de, D>(deserializer: D) -> std::result::Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum RepoItem {
        Name(String),
        Obj {
            #[serde(rename = "nameWithOwner")]
            name_with_owner: Option<String>,
            name: Option<String>,
        },
    }

    let opt: Option<RepoItem> = Option::deserialize(deserializer)?;
    Ok(opt.and_then(|item| match item {
        RepoItem::Name(s) => Some(s),
        RepoItem::Obj {
            name_with_owner,
            name,
        } => name_with_owner.or(name),
    }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum IssueCategory {
    #[default]
    #[serde(rename = "Project", alias = "project")]
    Project,
    #[serde(
        rename = "MyIssues",
        alias = "myissues",
        alias = "my_issues",
        alias = "my-issues"
    )]
    MyIssues,
    #[serde(
        rename = "ReviewRequests",
        alias = "reviewrequests",
        alias = "review_requests",
        alias = "review-requests"
    )]
    ReviewRequests,
}

impl IssueCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Project => "Project",
            Self::MyIssues => "MyIssues",
            Self::ReviewRequests => "ReviewRequests",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s
            .trim()
            .to_ascii_lowercase()
            .replace(['-', '_'], "")
            .as_str()
        {
            "project" => Some(Self::Project),
            "myissues" => Some(Self::MyIssues),
            "reviewrequests" => Some(Self::ReviewRequests),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct IssueFilterParams {
    pub category: Option<IssueCategory>,
    pub assignee: Option<String>,
    pub label: Option<String>,
    pub query: Option<String>,
    pub page: Option<usize>,
    pub limit: Option<usize>,
}

pub type IssueQueryParams = IssueFilterParams;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct IssueMetadataResponse {
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PaginatedIssuesResponse {
    pub issues: Vec<GitHubIssue>,
    pub total: usize,
    pub page: usize,
    pub limit: usize,
}

pub fn parse_github_remote_url(remote_url: &str) -> Option<(String, String)> {
    let s = remote_url.trim();
    if s.is_empty() {
        return None;
    }

    let path_part = if let Some(stripped) = s.strip_prefix("git@github.com:") {
        stripped
    } else if let Some(stripped) = s.strip_prefix("ssh://git@github.com/") {
        stripped
    } else {
        let idx = s.find("github.com/")?;
        &s[idx + "github.com/".len()..]
    };

    let cleaned = path_part.trim_matches('/');
    let parts: Vec<&str> = cleaned.split('/').collect();
    if parts.len() < 2 {
        return None;
    }

    let owner = parts[0].trim();
    let mut repo = parts[1].trim();
    if let Some(stripped) = repo.strip_suffix(".git") {
        repo = stripped;
    }

    if owner.is_empty() || repo.is_empty() {
        return None;
    }

    Some((owner.to_string(), repo.to_string()))
}

pub fn resolve_project_github_repos(
    project: &ProjectConfig,
    tendril_home: &Path,
) -> Vec<(String, String)> {
    let home_str = tendril_home.to_string_lossy();
    let mut repos = Vec::new();

    for repo_ref in &project.repos {
        let expanded = expand_variables(&repo_ref.path, &home_str);
        let repo_path = Path::new(&expanded);
        if !repo_path.is_dir() {
            continue;
        }

        if let Ok((code, stdout, _)) = run_git(&["remote", "get-url", "origin"], repo_path) {
            if code == 0 {
                if let Some((owner, repo)) = parse_github_remote_url(stdout.trim()) {
                    if !repos.iter().any(|(o, r): &(String, String)| {
                        o.eq_ignore_ascii_case(&owner) && r.eq_ignore_ascii_case(&repo)
                    }) {
                        repos.push((owner, repo));
                    }
                }
            }
        }
    }

    repos
}

pub fn build_project_issues_args(
    owner: &str,
    repo: &str,
    filters: &IssueFilterParams,
    fetch_limit: usize,
) -> Vec<String> {
    let mut args = vec![
        "issue".to_string(),
        "list".to_string(),
        "--repo".to_string(),
        format!("{}/{}", owner, repo),
        "--state".to_string(),
        "open".to_string(),
        "--limit".to_string(),
        fetch_limit.to_string(),
        "--json".to_string(),
        "number,title,body,labels,assignees,url,updatedAt".to_string(),
    ];

    if let Some(q) = &filters.query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            args.push("--search".to_string());
            args.push(trimmed.to_string());
        }
    }

    if let Some(a) = &filters.assignee {
        let trimmed = a.trim();
        if !trimmed.is_empty() {
            args.push("--assignee".to_string());
            args.push(trimmed.to_string());
        }
    }

    if let Some(l) = &filters.label {
        let trimmed = l.trim();
        if !trimmed.is_empty() {
            args.push("--label".to_string());
            args.push(trimmed.to_string());
        }
    }

    args
}

pub fn build_my_issues_args(filters: &IssueFilterParams, fetch_limit: usize) -> Vec<String> {
    let mut args = vec!["search".to_string(), "issues".to_string()];

    if let Some(q) = &filters.query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            args.push(trimmed.to_string());
        }
    }

    let assignee = filters
        .assignee
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("@me");
    args.push(format!("--assignee={}", assignee));
    args.push("--state=open".to_string());
    args.push("--limit".to_string());
    args.push(fetch_limit.to_string());
    args.push("--json".to_string());
    args.push("number,title,body,labels,assignees,repository,url,updatedAt".to_string());

    if let Some(l) = &filters.label {
        let trimmed = l.trim();
        if !trimmed.is_empty() {
            args.push("--label".to_string());
            args.push(trimmed.to_string());
        }
    }

    args
}

pub fn build_review_requests_args(filters: &IssueFilterParams, fetch_limit: usize) -> Vec<String> {
    let mut args = vec!["search".to_string(), "prs".to_string()];

    if let Some(q) = &filters.query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            args.push(trimmed.to_string());
        }
    }

    args.push("--review-requested=@me".to_string());
    args.push("--state=open".to_string());
    args.push("--limit".to_string());
    args.push(fetch_limit.to_string());
    args.push("--json".to_string());
    args.push("number,title,body,labels,assignees,repository,url,updatedAt".to_string());

    if let Some(l) = &filters.label {
        let trimmed = l.trim();
        if !trimmed.is_empty() {
            args.push("--label".to_string());
            args.push(trimmed.to_string());
        }
    }

    args
}

pub async fn run_gh_command(args: &[String], working_dir: Option<&Path>) -> Result<String> {
    let mut cmd = tokio::process::Command::new("gh");
    cmd.args(args);
    if let Some(dir) = working_dir {
        cmd.current_dir(dir);
    }

    let timeout_duration = Duration::from_secs(30);
    let child = cmd.output();
    let output = tokio::time::timeout(timeout_duration, child)
        .await
        .map_err(|_| TendrilError::Git("gh command timed out after 30 seconds".to_string()))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                TendrilError::Git("GitHub CLI ('gh') is not installed or not in PATH".to_string())
            } else {
                TendrilError::Git(format!("Failed to execute gh CLI: {}", e))
            }
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.contains("authentication")
            || stderr.contains("auth login")
            || stderr.contains("not logged in")
        {
            return Err(TendrilError::Git(format!(
                "GitHub CLI is unauthenticated: {}",
                stderr
            )));
        }
        return Err(TendrilError::Git(format!("gh command failed: {}", stderr)));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn paginate_issues(
    mut all_issues: Vec<GitHubIssue>,
    page: Option<usize>,
    limit: Option<usize>,
) -> PaginatedIssuesResponse {
    all_issues.sort_by(|a, b| {
        match (&b.updated_at, &a.updated_at) {
            (Some(b_date), Some(a_date)) => {
                let cmp = b_date.cmp(a_date);
                if cmp != std::cmp::Ordering::Equal {
                    return cmp;
                }
            }
            (Some(_), None) => return std::cmp::Ordering::Less,
            (None, Some(_)) => return std::cmp::Ordering::Greater,
            (None, None) => {}
        }
        b.number.cmp(&a.number)
    });

    let total = all_issues.len();
    let page_num = page.unwrap_or(1).max(1);
    let page_size = limit.unwrap_or(50).clamp(1, 100);
    let start = (page_num - 1) * page_size;

    let issues = if start >= total {
        Vec::new()
    } else {
        let end = (start + page_size).min(total);
        all_issues[start..end].to_vec()
    };

    PaginatedIssuesResponse {
        issues,
        total,
        page: page_num,
        limit: page_size,
    }
}

pub async fn query_project_issues(
    repos: &[(String, String)],
    filters: &IssueFilterParams,
) -> Result<PaginatedIssuesResponse> {
    if repos.is_empty() {
        return Ok(paginate_issues(Vec::new(), filters.page, filters.limit));
    }

    let category = filters.category.unwrap_or(IssueCategory::Project);
    let page = filters.page.unwrap_or(1).max(1);
    let limit = filters.limit.unwrap_or(50).clamp(1, 100);
    let fetch_limit = (page * limit).clamp(50, 100);

    let all_issues = match category {
        IssueCategory::Project => {
            let mut aggregated = Vec::new();
            for (owner, repo) in repos {
                let args = build_project_issues_args(owner, repo, filters, fetch_limit);
                let stdout = run_gh_command(&args, None).await?;
                let mut issues: Vec<GitHubIssue> = serde_json::from_str(&stdout).map_err(|e| {
                    TendrilError::Git(format!(
                        "Failed to parse gh issue list output for {}/{}: {}",
                        owner, repo, e
                    ))
                })?;
                let repo_name = format!("{}/{}", owner, repo);
                for issue in &mut issues {
                    if issue.repository.is_none() {
                        issue.repository = Some(repo_name.clone());
                    }
                }
                aggregated.extend(issues);
            }
            aggregated
        }
        IssueCategory::MyIssues => {
            let args = build_my_issues_args(filters, 100);
            let stdout = run_gh_command(&args, None).await?;
            let issues: Vec<GitHubIssue> = serde_json::from_str(&stdout).map_err(|e| {
                TendrilError::Git(format!("Failed to parse gh search issues output: {}", e))
            })?;
            issues
                .into_iter()
                .filter(|issue| {
                    if let Some(ref r) = issue.repository {
                        repos
                            .iter()
                            .any(|(o, rep)| r.eq_ignore_ascii_case(&format!("{}/{}", o, rep)))
                    } else {
                        false
                    }
                })
                .collect()
        }
        IssueCategory::ReviewRequests => {
            let args = build_review_requests_args(filters, 100);
            let stdout = run_gh_command(&args, None).await?;
            let issues: Vec<GitHubIssue> = serde_json::from_str(&stdout).map_err(|e| {
                TendrilError::Git(format!("Failed to parse gh search prs output: {}", e))
            })?;
            issues
                .into_iter()
                .filter(|issue| {
                    if let Some(ref r) = issue.repository {
                        repos
                            .iter()
                            .any(|(o, rep)| r.eq_ignore_ascii_case(&format!("{}/{}", o, rep)))
                    } else {
                        false
                    }
                })
                .collect()
        }
    };

    Ok(paginate_issues(all_issues, filters.page, filters.limit))
}

const METADATA_CACHE_TTL: Duration = Duration::from_secs(300);

#[derive(Debug, Clone)]
struct CachedRepoMetadata {
    labels: Vec<String>,
    assignees: Vec<String>,
    fetched_at: Instant,
}

static ISSUE_METADATA_CACHE: LazyLock<RwLock<HashMap<String, CachedRepoMetadata>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// Clear all entries from the in-memory issue metadata cache.
pub fn clear_issue_metadata_cache() {
    let mut cache = ISSUE_METADATA_CACHE
        .write()
        .unwrap_or_else(|p| p.into_inner());
    cache.clear();
}

pub async fn get_project_issues_metadata(
    repos: &[(String, String)],
) -> Result<IssueMetadataResponse> {
    let mut labels_set = BTreeSet::new();
    let mut assignees_set = BTreeSet::new();

    #[derive(Deserialize)]
    struct GhLabelName {
        name: String,
    }

    let mut cache_misses: Vec<(String, String)> = Vec::new();

    {
        let cache = ISSUE_METADATA_CACHE
            .read()
            .unwrap_or_else(|p| p.into_inner());

        for (owner, repo) in repos {
            let repo_slug = format!("{}/{}", owner, repo);
            let cache_key = repo_slug.to_lowercase();

            if let Some(entry) = cache.get(&cache_key) {
                if entry.fetched_at.elapsed() < METADATA_CACHE_TTL {
                    labels_set.extend(entry.labels.clone());
                    assignees_set.extend(entry.assignees.clone());
                    continue;
                }
            }

            cache_misses.push((owner.clone(), repo.clone()));
        }
    }

    if !cache_misses.is_empty() {
        let fetch_futures = cache_misses.into_iter().map(|(owner, repo)| async move {
            let repo_slug = format!("{}/{}", owner, repo);
            let mut repo_labels_set = BTreeSet::new();
            let mut repo_assignees_set = BTreeSet::new();

            // Fetch labels: gh label list --repo {owner}/{repo} --json name
            let label_args = vec![
                "label".to_string(),
                "list".to_string(),
                "--repo".to_string(),
                repo_slug.clone(),
                "--json".to_string(),
                "name".to_string(),
            ];

            // Fetch assignees: gh api repos/{owner}/{repo}/assignees --jq '.[].login'
            let assignee_args = vec![
                "api".to_string(),
                format!("repos/{}/assignees", repo_slug),
                "--jq".to_string(),
                ".[].login".to_string(),
            ];

            let (label_result, assignee_result) = tokio::join!(
                run_gh_command(&label_args, None),
                run_gh_command(&assignee_args, None),
            );

            if let Ok(stdout) = label_result {
                if let Ok(labels) = serde_json::from_str::<Vec<GhLabelName>>(&stdout) {
                    for l in labels {
                        let trimmed = l.name.trim();
                        if !trimmed.is_empty() {
                            repo_labels_set.insert(trimmed.to_string());
                        }
                    }
                }
            }

            if let Ok(stdout) = assignee_result {
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        repo_assignees_set.insert(trimmed.to_string());
                    }
                }
            }

            let repo_labels: Vec<String> = repo_labels_set.into_iter().collect();
            let repo_assignees: Vec<String> = repo_assignees_set.into_iter().collect();

            (repo_slug, repo_labels, repo_assignees)
        });

        let results = futures_util::future::join_all(fetch_futures).await;

        {
            let mut cache = ISSUE_METADATA_CACHE
                .write()
                .unwrap_or_else(|p| p.into_inner());

            for (repo_slug, repo_labels, repo_assignees) in results {
                let cache_key = repo_slug.to_lowercase();
                cache.insert(
                    cache_key,
                    CachedRepoMetadata {
                        labels: repo_labels.clone(),
                        assignees: repo_assignees.clone(),
                        fetched_at: Instant::now(),
                    },
                );
                labels_set.extend(repo_labels);
                assignees_set.extend(repo_assignees);
            }
        }
    }

    Ok(IssueMetadataResponse {
        labels: labels_set.into_iter().collect(),
        assignees: assignees_set.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    static CACHE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn test_parse_github_remote_url_https() {
        assert_eq!(
            parse_github_remote_url("https://github.com/SpaceCorps/Tendril-Service.git"),
            Some(("SpaceCorps".to_string(), "Tendril-Service".to_string()))
        );
        assert_eq!(
            parse_github_remote_url("https://github.com/SpaceCorps/Tendril-Service"),
            Some(("SpaceCorps".to_string(), "Tendril-Service".to_string()))
        );
        assert_eq!(
            parse_github_remote_url("http://github.com/owner/repo.git/"),
            Some(("owner".to_string(), "repo".to_string()))
        );
    }

    #[test]
    fn test_parse_github_remote_url_ssh() {
        assert_eq!(
            parse_github_remote_url("git@github.com:SpaceCorps/Tendril-Service.git"),
            Some(("SpaceCorps".to_string(), "Tendril-Service".to_string()))
        );
        assert_eq!(
            parse_github_remote_url("git@github.com:SpaceCorps/Tendril-Service"),
            Some(("SpaceCorps".to_string(), "Tendril-Service".to_string()))
        );
        assert_eq!(
            parse_github_remote_url("ssh://git@github.com/SpaceCorps/Tendril-Service.git"),
            Some(("SpaceCorps".to_string(), "Tendril-Service".to_string()))
        );
    }

    #[test]
    fn test_parse_github_remote_url_invalid() {
        assert_eq!(
            parse_github_remote_url("https://gitlab.com/owner/repo.git"),
            None
        );
        assert_eq!(parse_github_remote_url("not-a-url"), None);
        assert_eq!(parse_github_remote_url(""), None);
    }

    #[test]
    fn test_build_project_issues_args() {
        let filters = IssueFilterParams {
            category: Some(IssueCategory::Project),
            assignee: Some("octocat".to_string()),
            label: Some("bug".to_string()),
            query: Some("crash".to_string()),
            page: Some(1),
            limit: Some(25),
        };
        let args = build_project_issues_args("SpaceCorps", "Tendril-Service", &filters, 25);
        assert_eq!(
            args,
            vec![
                "issue",
                "list",
                "--repo",
                "SpaceCorps/Tendril-Service",
                "--state",
                "open",
                "--limit",
                "25",
                "--json",
                "number,title,body,labels,assignees,url,updatedAt",
                "--search",
                "crash",
                "--assignee",
                "octocat",
                "--label",
                "bug"
            ]
        );
    }

    #[test]
    fn test_build_my_issues_args() {
        let filters = IssueFilterParams {
            category: Some(IssueCategory::MyIssues),
            assignee: None,
            label: Some("urgent".to_string()),
            query: Some("memory".to_string()),
            page: None,
            limit: None,
        };
        let args = build_my_issues_args(&filters, 50);
        assert_eq!(
            args,
            vec![
                "search",
                "issues",
                "memory",
                "--assignee=@me",
                "--state=open",
                "--limit",
                "50",
                "--json",
                "number,title,body,labels,assignees,repository,url,updatedAt",
                "--label",
                "urgent"
            ]
        );
    }

    #[test]
    fn test_build_review_requests_args() {
        let filters = IssueFilterParams {
            category: Some(IssueCategory::ReviewRequests),
            assignee: None,
            label: None,
            query: Some("refactor".to_string()),
            page: None,
            limit: None,
        };
        let args = build_review_requests_args(&filters, 100);
        assert_eq!(
            args,
            vec![
                "search",
                "prs",
                "refactor",
                "--review-requested=@me",
                "--state=open",
                "--limit",
                "100",
                "--json",
                "number,title,body,labels,assignees,repository,url,updatedAt"
            ]
        );
    }

    #[test]
    fn test_json_deserialization_gh_issue_list() {
        let json_data = r#"[
            {
                "number": 42,
                "title": "Fix crash on startup",
                "body": "Detailed crash report here",
                "labels": [{"id": "1", "name": "bug", "color": "d73a4a"}],
                "assignees": [{"login": "alice", "id": "100"}],
                "url": "https://github.com/SpaceCorps/Tendril-Service/issues/42",
                "updatedAt": "2026-09-07T12:00:00Z"
            }
        ]"#;

        let issues: Vec<GitHubIssue> = serde_json::from_str(json_data).unwrap();
        assert_eq!(issues.len(), 1);
        let issue = &issues[0];
        assert_eq!(issue.number, 42);
        assert_eq!(issue.title, "Fix crash on startup");
        assert_eq!(issue.body.as_deref(), Some("Detailed crash report here"));
        assert_eq!(issue.labels, vec!["bug"]);
        assert_eq!(issue.assignees, vec!["alice"]);
        assert_eq!(issue.repository, None);
        assert_eq!(
            issue.url.as_deref(),
            Some("https://github.com/SpaceCorps/Tendril-Service/issues/42")
        );
        assert_eq!(issue.updated_at.as_deref(), Some("2026-09-07T12:00:00Z"));
    }

    #[test]
    fn test_json_deserialization_gh_search_issues() {
        let json_data = r#"[
            {
                "number": 105,
                "title": "Add issue triage UI",
                "body": null,
                "labels": [{"name": "feature"}, {"name": "ui"}],
                "assignees": [{"login": "bob"}],
                "repository": {"name": "Tendril-Service", "nameWithOwner": "SpaceCorps/Tendril-Service"},
                "url": "https://github.com/SpaceCorps/Tendril-Service/issues/105",
                "updatedAt": "2026-09-06T15:30:00Z"
            }
        ]"#;

        let issues: Vec<GitHubIssue> = serde_json::from_str(json_data).unwrap();
        assert_eq!(issues.len(), 1);
        let issue = &issues[0];
        assert_eq!(issue.number, 105);
        assert_eq!(issue.labels, vec!["feature", "ui"]);
        assert_eq!(issue.assignees, vec!["bob"]);
        assert_eq!(
            issue.repository.as_deref(),
            Some("SpaceCorps/Tendril-Service")
        );
        assert_eq!(issue.updated_at.as_deref(), Some("2026-09-06T15:30:00Z"));
    }

    #[test]
    fn test_pagination_and_sorting() {
        let issues = vec![
            GitHubIssue {
                number: 1,
                title: "Old issue".to_string(),
                body: None,
                labels: vec![],
                assignees: vec![],
                repository: Some("SpaceCorps/Tendril-Service".to_string()),
                url: None,
                updated_at: Some("2026-09-01T10:00:00Z".to_string()),
                head_ref_name: None,
            },
            GitHubIssue {
                number: 3,
                title: "Latest issue".to_string(),
                body: None,
                labels: vec![],
                assignees: vec![],
                repository: Some("SpaceCorps/Tendril-Service".to_string()),
                url: None,
                updated_at: Some("2026-09-07T10:00:00Z".to_string()),
                head_ref_name: None,
            },
            GitHubIssue {
                number: 2,
                title: "Middle issue".to_string(),
                body: None,
                labels: vec![],
                assignees: vec![],
                repository: Some("SpaceCorps/Tendril-Service".to_string()),
                url: None,
                updated_at: Some("2026-09-05T10:00:00Z".to_string()),
                head_ref_name: None,
            },
        ];

        let page1 = paginate_issues(issues.clone(), Some(1), Some(2));
        assert_eq!(page1.total, 3);
        assert_eq!(page1.page, 1);
        assert_eq!(page1.limit, 2);
        assert_eq!(page1.issues.len(), 2);
        assert_eq!(page1.issues[0].number, 3);
        assert_eq!(page1.issues[1].number, 2);

        let page2 = paginate_issues(issues, Some(2), Some(2));
        assert_eq!(page2.total, 3);
        assert_eq!(page2.page, 2);
        assert_eq!(page2.issues.len(), 1);
        assert_eq!(page2.issues[0].number, 1);
    }

    #[tokio::test]
    async fn test_issue_metadata_cache_hit_and_expiration() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap();
        clear_issue_metadata_cache();

        let repo_key = "spacecorps/test-cached-repo";
        {
            let mut cache = ISSUE_METADATA_CACHE.write().unwrap();
            cache.insert(
                repo_key.to_string(),
                CachedRepoMetadata {
                    labels: vec!["bug".to_string(), "enhancement".to_string()],
                    assignees: vec!["alice".to_string()],
                    fetched_at: Instant::now(),
                },
            );
        }

        // Within TTL: cached values should be returned
        let repos = vec![("SpaceCorps".to_string(), "test-cached-repo".to_string())];
        let meta = get_project_issues_metadata(&repos).await.unwrap();
        assert_eq!(meta.labels, vec!["bug", "enhancement"]);
        assert_eq!(meta.assignees, vec!["alice"]);

        // Expire the cache entry manually
        {
            let mut cache = ISSUE_METADATA_CACHE.write().unwrap();
            if let Some(entry) = cache.get_mut(repo_key) {
                entry.fetched_at = Instant::now()
                    .checked_sub(METADATA_CACHE_TTL + Duration::from_secs(5))
                    .unwrap();
            }
        }

        // Check that the entry is now considered stale (elapsed >= TTL)
        {
            let cache = ISSUE_METADATA_CACHE.read().unwrap();
            let entry = cache.get(repo_key).unwrap();
            assert!(entry.fetched_at.elapsed() >= METADATA_CACHE_TTL);
        }

        clear_issue_metadata_cache();
    }

    #[test]
    fn test_clear_issue_metadata_cache() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap();
        clear_issue_metadata_cache();

        {
            let mut cache = ISSUE_METADATA_CACHE.write().unwrap();
            cache.insert(
                "spacecorps/repo-to-clear".to_string(),
                CachedRepoMetadata {
                    labels: vec!["label1".to_string()],
                    assignees: vec!["user1".to_string()],
                    fetched_at: Instant::now(),
                },
            );
        }

        {
            let cache = ISSUE_METADATA_CACHE.read().unwrap();
            assert!(cache.contains_key("spacecorps/repo-to-clear"));
        }

        clear_issue_metadata_cache();

        {
            let cache = ISSUE_METADATA_CACHE.read().unwrap();
            assert!(cache.is_empty());
        }
    }

    #[tokio::test]
    async fn test_get_project_issues_metadata_concurrent_cache_hits_and_misses() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap();
        clear_issue_metadata_cache();

        let repo1_key = "spacecorps/repo-cached-1";
        let repo2_key = "spacecorps/repo-cached-2";

        {
            let mut cache = ISSUE_METADATA_CACHE.write().unwrap();
            cache.insert(
                repo1_key.to_string(),
                CachedRepoMetadata {
                    labels: vec!["bug".to_string(), "frontend".to_string()],
                    assignees: vec!["alice".to_string()],
                    fetched_at: Instant::now(),
                },
            );
            cache.insert(
                repo2_key.to_string(),
                CachedRepoMetadata {
                    labels: vec!["documentation".to_string()],
                    assignees: vec!["bob".to_string()],
                    fetched_at: Instant::now(),
                },
            );
        }

        let repos = vec![
            ("SpaceCorps".to_string(), "repo-cached-1".to_string()),
            ("SpaceCorps".to_string(), "repo-cached-2".to_string()),
            ("SpaceCorps".to_string(), "repo-uncached".to_string()),
        ];

        let meta = get_project_issues_metadata(&repos).await.unwrap();

        // Cached entries should be present in the aggregated results
        assert!(meta.labels.contains(&"bug".to_string()));
        assert!(meta.labels.contains(&"frontend".to_string()));
        assert!(meta.labels.contains(&"documentation".to_string()));
        assert!(meta.assignees.contains(&"alice".to_string()));
        assert!(meta.assignees.contains(&"bob".to_string()));

        // The uncached repo should have been queried and recorded in the cache
        {
            let cache = ISSUE_METADATA_CACHE.read().unwrap();
            assert!(cache.contains_key("spacecorps/repo-uncached"));
            let uncached_entry = cache.get("spacecorps/repo-uncached").unwrap();
            assert!(uncached_entry.fetched_at.elapsed() < METADATA_CACHE_TTL);
        }

        clear_issue_metadata_cache();
    }

    #[tokio::test]
    async fn test_get_project_issues_metadata_uncached_repo_caches_after_join() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap();
        clear_issue_metadata_cache();

        let repos = vec![("SpaceCorps".to_string(), "repo-join-test".to_string())];

        let result = get_project_issues_metadata(&repos).await;
        assert!(result.is_ok());

        {
            let cache = ISSUE_METADATA_CACHE.read().unwrap();
            let entry = cache
                .get("spacecorps/repo-join-test")
                .expect("cache entry should be written after concurrent join");
            assert!(entry.fetched_at.elapsed() < METADATA_CACHE_TTL);
        }

        clear_issue_metadata_cache();
    }

    #[tokio::test]
    async fn test_get_project_issues_metadata_empty_repos() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap();
        clear_issue_metadata_cache();

        let meta = get_project_issues_metadata(&[]).await.unwrap();
        assert!(meta.labels.is_empty());
        assert!(meta.assignees.is_empty());
    }
}
