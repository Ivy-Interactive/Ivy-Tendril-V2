use tendril_app_lib::commands::github::{
    extract_owner_repo_from_url, parse_gh_cli_error, parse_github_issues_json, resolve_repo_slug,
};

#[test]
fn test_github_dto_parsing_and_fallback() {
    let raw_json = r#"[
        {
            "number": 42,
            "title": "Add triage inbox",
            "body": "Need an inbox view for operators",
            "state": "OPEN",
            "author": { "login": "octocat" },
            "assignees": [{ "login": "octocat" }],
            "labels": [{ "name": "enhancement", "color": "a2eeef" }],
            "commentsCount": 3,
            "createdAt": "2026-09-01T12:00:00Z",
            "updatedAt": "2026-09-02T14:30:00Z",
            "url": "https://github.com/SpaceCorps/Tendril-App/issues/42",
            "repository": { "name": "Tendril-App", "nameWithOwner": "SpaceCorps/Tendril-App" },
            "isPullRequest": false
        }
    ]"#;

    let issues = parse_github_issues_json(raw_json, None).expect("Should parse valid issues");
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].number, 42);
    assert_eq!(issues[0].title, "Add triage inbox");
    assert_eq!(issues[0].comments_count, 3);
    assert_eq!(issues[0].state, "open");
    assert_eq!(issues[0].labels[0].name, "enhancement");
    assert!(!issues[0].is_pull_request);
}

#[test]
fn test_github_dto_pull_request_detection() {
    let raw_json = r#"[
        {
            "number": 77,
            "title": "Review requested on PR",
            "body": "PR description",
            "state": "OPEN",
            "author": { "login": "contributor" },
            "assignees": [],
            "labels": [],
            "commentsCount": 0,
            "createdAt": "2026-09-03T10:00:00Z",
            "updatedAt": "2026-09-03T10:00:00Z",
            "url": "https://github.com/SpaceCorps/Tendril-App/pull/77"
        }
    ]"#;

    let issues = parse_github_issues_json(raw_json, Some("SpaceCorps/Tendril-App"))
        .expect("Should parse PR issue");
    assert_eq!(issues.len(), 1);
    assert!(issues[0].is_pull_request);
    assert_eq!(
        issues[0].repository.as_ref().unwrap().name_with_owner,
        "SpaceCorps/Tendril-App"
    );
}

#[test]
fn test_github_error_unauthenticated_classification() {
    let stderr = "You are not logged into any GitHub hosts. Run gh auth login to authenticate.";
    let err = parse_gh_cli_error(Some(1), stderr);
    assert_eq!(err.code, "UNAUTHENTICATED");
    assert!(err.message.contains("gh auth login"));
}

#[test]
fn test_github_error_not_found_classification() {
    let stderr = "GraphQL: Could not resolve to a Repository with the name 'nonexistent/repo'.";
    let err = parse_gh_cli_error(Some(1), stderr);
    assert_eq!(err.code, "NOT_FOUND");
}

#[test]
fn test_resolve_repo_slug_varieties() {
    assert_eq!(
        extract_owner_repo_from_url("https://github.com/SpaceCorps/Tendril-App.git"),
        Some("SpaceCorps/Tendril-App".to_string())
    );
    assert_eq!(
        extract_owner_repo_from_url("git@github.com:SpaceCorps/Tendril-App.git"),
        Some("SpaceCorps/Tendril-App".to_string())
    );
    assert_eq!(
        resolve_repo_slug("SpaceCorps/Tendril-App"),
        "SpaceCorps/Tendril-App"
    );
}
