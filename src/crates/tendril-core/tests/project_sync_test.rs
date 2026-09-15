//! `tendril project sync` against real repositories.
//!
//! Every case here is a state git actually has to be in — behind origin, dirty, detached, diverged —
//! so the fixtures drive real `git`, with a bare `origin` beside each repo and no network.

mod common;

use common::{GitRepoFixture, HomeFixture};
use std::path::Path;
use tendril_core::git::sync::{sync_project, sync_repository};
use tendril_core::models::{ProjectConfig, RepoRef};

/// A repo whose local main is one commit behind its origin, and that commit's sha.
fn repo_behind_origin(label: &str) -> (GitRepoFixture, String) {
    let fixture = GitRepoFixture::new(label);
    std::fs::write(fixture.repo.join("ahead.txt"), "ahead\n").expect("write ahead.txt");
    fixture.git(&["add", "ahead.txt"]);
    fixture.git(&["commit", "-m", "Commit only origin has"]);
    fixture.push("main");
    let remote_head = fixture.git(&["rev-parse", "HEAD"]).trim().to_string();
    // Rewinding the local branch is the cheapest way to be genuinely behind the bare origin.
    fixture.git(&["reset", "--hard", "HEAD~1"]);
    (fixture, remote_head)
}

fn repo_config(path: &str, base_branch: Option<&str>) -> ProjectConfig {
    ProjectConfig {
        name: "SyncFixture".to_string(),
        repos: vec![RepoRef {
            path: path.to_string(),
            base_branch: base_branch.map(str::to_string),
            extra: Default::default(),
        }],
        ..Default::default()
    }
}

#[test]
fn clean_repo_behind_origin_fast_forwards() {
    let home = HomeFixture::new("sync-behind");
    let (fixture, remote_head) = repo_behind_origin("behind");

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(result.success, "sync failed: {}", result.message);
    assert_eq!(result.message, "Fast-forwarded main to origin/main.");
    assert_eq!(fixture.git(&["rev-parse", "HEAD"]).trim(), remote_head);
}

#[test]
fn repo_already_current_reports_up_to_date() {
    let home = HomeFixture::new("sync-current");
    let fixture = GitRepoFixture::new("current");

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(result.success, "sync failed: {}", result.message);
    assert_eq!(result.message, "Already up to date.");
}

#[test]
fn uncommitted_changes_block_the_sync() {
    let home = HomeFixture::new("sync-dirty");
    let fixture = GitRepoFixture::new("dirty");
    std::fs::write(fixture.repo.join("README.md"), "edited\n").expect("dirty the tree");

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(!result.success);
    assert_eq!(
        result.message,
        "Repository has uncommitted or untracked changes"
    );
    assert!(result.can_fix_with_agent);
    assert!(
        result
            .git_error_details
            .as_deref()
            .unwrap_or_default()
            .contains("README.md"),
        "porcelain output missing from details: {:?}",
        result.git_error_details
    );
}

#[test]
fn feature_branch_names_both_branches() {
    let home = HomeFixture::new("sync-branch");
    let fixture = GitRepoFixture::new("branch");
    fixture.commit_on("feature/work", "work.txt", "work\n");

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(!result.success);
    assert_eq!(
        result.message,
        "Repository is on branch 'feature/work', expected base branch 'main'"
    );
    assert!(result.can_fix_with_agent);
}

#[test]
fn detached_head_reports_the_short_sha() {
    let home = HomeFixture::new("sync-detached");
    let fixture = GitRepoFixture::new("detached");
    let sha = fixture
        .git(&["rev-parse", "--short", "HEAD"])
        .trim()
        .to_string();
    fixture.git(&["checkout", "--detach", "HEAD"]);

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(!result.success);
    assert_eq!(
        result.message,
        format!("HEAD is detached at {}. Expected base branch 'main'", sha)
    );
    assert!(result.can_fix_with_agent);
}

#[test]
fn non_repository_and_missing_directory_are_not_agent_fixable() {
    let home = HomeFixture::new("sync-nonrepo");
    let plain_dir = home.path.join("not-a-repo");
    std::fs::create_dir_all(&plain_dir).expect("create plain dir");

    let not_a_repo = sync_repository(&plain_dir.to_string_lossy(), None, Path::new(&home.path));
    assert!(!not_a_repo.success);
    assert!(
        not_a_repo.message.starts_with("Not a git repository:"),
        "unexpected message: {}",
        not_a_repo.message
    );
    assert!(!not_a_repo.can_fix_with_agent);

    let missing = home.path.join("does-not-exist");
    let absent = sync_repository(&missing.to_string_lossy(), None, Path::new(&home.path));
    assert!(!absent.success);
    assert!(
        absent
            .message
            .starts_with("Repository directory does not exist:"),
        "unexpected message: {}",
        absent.message
    );
    assert!(!absent.can_fix_with_agent);
}

#[test]
fn diverged_history_fails_the_fast_forward() {
    let home = HomeFixture::new("sync-diverged");
    let (fixture, _) = repo_behind_origin("diverged");
    // A local commit on the rewound branch makes the histories diverge, so --ff-only cannot apply.
    std::fs::write(fixture.repo.join("local.txt"), "local\n").expect("write local.txt");
    fixture.git(&["add", "local.txt"]);
    fixture.git(&["commit", "-m", "Local-only commit"]);

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(!result.success);
    assert_eq!(result.message, "Fast-forward merge failed for origin/main");
    assert!(result.can_fix_with_agent);
}

#[test]
fn tendril_home_variable_in_the_repo_path_is_expanded() {
    let fixture = GitRepoFixture::new("expanded");
    // The fixture root stands in for TENDRIL_HOME so the configured path can be written relative
    // to it, the way an operator's config.yaml refers to repos under %TENDRIL_HOME%.
    let home = fixture.root.clone();
    let configured = format!("%TENDRIL_HOME%/{}", "expanded");

    let result = sync_repository(&configured, Some("main"), &home);

    assert!(result.success, "sync failed: {}", result.message);
    assert_eq!(result.repo_path, fixture.repo.to_string_lossy());
}

#[test]
fn sync_project_returns_one_result_per_repo_in_configured_order() {
    let home = HomeFixture::new("sync-project");
    let first = GitRepoFixture::new("first");
    let second = GitRepoFixture::new("second");

    let project = ProjectConfig {
        name: "TwoRepos".to_string(),
        repos: vec![
            RepoRef {
                path: first.repo.to_string_lossy().to_string(),
                base_branch: Some("main".to_string()),
                extra: Default::default(),
            },
            RepoRef {
                path: second.repo.to_string_lossy().to_string(),
                base_branch: Some("main".to_string()),
                extra: Default::default(),
            },
        ],
        ..Default::default()
    };

    let results = sync_project(&project, None, Path::new(&home.path));

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].repo_path, first.repo.to_string_lossy());
    assert_eq!(results[1].repo_path, second.repo.to_string_lossy());
    assert!(results.iter().all(|r| r.success));
}

#[test]
fn sync_project_selects_by_directory_name_and_ignores_unmatched() {
    let home = HomeFixture::new("sync-select");
    let fixture = GitRepoFixture::new("selectable");
    let project = repo_config(&fixture.repo.to_string_lossy(), Some("main"));

    let by_name = sync_project(&project, Some("selectable"), Path::new(&home.path));
    assert_eq!(by_name.len(), 1);
    assert_eq!(by_name[0].repo_path, fixture.repo.to_string_lossy());

    let unmatched = sync_project(&project, Some("no-such-repo"), Path::new(&home.path));
    assert!(unmatched.is_empty());
}
