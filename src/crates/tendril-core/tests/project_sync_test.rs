//! `tendril project sync` against real repositories.
//!
//! Every case here is a state git actually has to be in — behind origin, dirty, detached, diverged,
//! remoteless — so the fixtures drive real `git`, with a bare `origin` beside each repo and no
//! network.
//!
//! The divergence cases carry the load. A diverged branch has no safe automatic resolution, so the
//! assertions are as much about what does *not* happen as what does: the repository is compared
//! before and after, byte for byte, and a static guard checks the module cannot even spell a
//! destructive git command.

mod common;

use common::{GitRepoFixture, HomeFixture};
use std::path::Path;
use tendril_core::git::sync::{diagnostic_prompt, sync_project, sync_repository};
use tendril_core::git::worktree::{derive_branch_name, remove_worktree};
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
fn no_remote_configured_is_agent_fixable() {
    let home = HomeFixture::new("sync-no-remote");
    let fixture = GitRepoFixture::new("remoteless");
    // A repo can lose its remote (a clone-by-copy, a hand-edited config) and there is nothing to
    // fast-forward onto. That is a configuration question, so it escalates rather than failing hard.
    fixture.git(&["remote", "remove", "origin"]);

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(!result.success);
    assert_eq!(result.message, "No remote configured for repository");
    assert_eq!(
        result.git_error_details.as_deref(),
        Some("No remote configured")
    );
    assert!(result.can_fix_with_agent);
    assert!(result.divergence.is_none());
}

/// A repo whose local `main` holds `local_commits` commits the bare origin does not, while origin
/// holds one commit the local branch does not. That is the divergence: no fast-forward exists in
/// either direction.
fn repo_diverged_from_origin(label: &str, local_commits: usize) -> GitRepoFixture {
    let (fixture, _) = repo_behind_origin(label);
    for i in 0..local_commits {
        let file = format!("local-{}.txt", i);
        std::fs::write(fixture.repo.join(&file), "local\n").expect("write local file");
        fixture.git(&["add", &file]);
        fixture.git(&["commit", "-m", &format!("Local-only commit {}", i)]);
    }
    fixture
}

/// Everything about a repo that a history rewrite or a discarded change would alter. Comparing this
/// before and after a refused sync is stronger than asserting on the commands issued: it holds no
/// matter how the refusal is implemented.
///
/// Remote-tracking refs are deliberately *not* in `local_refs`. `git fetch --prune` is one of the two
/// non-read-only commands the sync path runs, and creating `refs/remotes/origin/HEAD` on a repo that
/// lacked it is a legitimate effect of it — the sha of the base branch's tracking ref is asserted
/// separately, since the fixture's bare origin never moves during a test.
#[derive(Debug, PartialEq, Eq)]
struct RepoState {
    head: String,
    /// `refs/heads/*` only: every local branch, including any plan branch a worktree is on.
    local_refs: String,
    remote_base: String,
    reflog: String,
    stashes: String,
    porcelain: String,
}

fn repo_state(fixture: &GitRepoFixture) -> RepoState {
    let local_refs = fixture
        .git(&["show-ref"])
        .lines()
        .filter(|line| line.contains(" refs/heads/"))
        .map(|line| format!("{}\n", line))
        .collect();

    RepoState {
        head: fixture.git(&["rev-parse", "HEAD"]),
        local_refs,
        remote_base: fixture.git(&["rev-parse", "refs/remotes/origin/main"]),
        // The reflog is the record a `reset --hard` or a rebase would add an entry to.
        reflog: fixture.git(&["reflog", "--date=iso"]),
        stashes: fixture.git(&["stash", "list"]),
        porcelain: fixture.git(&["status", "--porcelain"]),
    }
}

#[test]
fn diverged_history_fails_the_fast_forward_and_names_both_sides() {
    let home = HomeFixture::new("sync-diverged");
    let fixture = repo_diverged_from_origin("diverged", 2);

    let before = repo_state(&fixture);
    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(!result.success);
    // The message stays the original helper's wording; the divergence is in the details, which is
    // what the CLI prints next and what the escalation prompt carries.
    assert_eq!(result.message, "Fast-forward merge failed for origin/main");
    assert!(result.can_fix_with_agent);

    let divergence = result.divergence.expect("divergence should be classified");
    assert_eq!(divergence.ahead, 2, "two local-only commits");
    assert_eq!(divergence.behind, 1, "one remote-only commit");
    assert!(divergence.is_diverged());

    let details = result.git_error_details.as_deref().unwrap_or_default();
    assert!(
        details.contains("have diverged")
            && details.contains("2 local commit(s)")
            && details.contains("1 remote commit(s)"),
        "details do not describe the divergence: {}",
        details
    );

    // The refusal is total: git's `--ff-only` merge aborts before touching anything, so not one
    // commit, ref, reflog entry or working-tree file moved.
    assert_eq!(
        repo_state(&fixture),
        before,
        "a refused divergence must leave the repository byte-identical"
    );
}

#[test]
fn a_branch_only_ahead_of_its_remote_is_not_treated_as_diverged() {
    let home = HomeFixture::new("sync-ahead");
    let fixture = GitRepoFixture::new("ahead-only");
    // Unpushed local commits with nothing new on the remote: `--ff-only` succeeds as a no-op, so the
    // repo is already up to date and the commits are simply waiting to be pushed.
    std::fs::write(fixture.repo.join("unpushed.txt"), "unpushed\n").expect("write unpushed.txt");
    fixture.git(&["add", "unpushed.txt"]);
    fixture.git(&["commit", "-m", "Unpushed local commit"]);
    let head = fixture.git(&["rev-parse", "HEAD"]);

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(result.success, "sync failed: {}", result.message);
    assert_eq!(result.message, "Already up to date.");
    assert!(result.divergence.is_none());
    assert_eq!(
        fixture.git(&["rev-parse", "HEAD"]),
        head,
        "the unpushed commit must still be HEAD"
    );
}

#[test]
fn a_diverged_repo_with_a_dirty_tree_stops_at_the_dirty_tree() {
    let home = HomeFixture::new("sync-diverged-dirty");
    let fixture = repo_diverged_from_origin("diverged-dirty", 1);
    std::fs::write(fixture.repo.join("README.md"), "uncommitted edit\n").expect("dirty the tree");
    std::fs::write(fixture.repo.join("scratch.txt"), "untracked\n").expect("add untracked file");

    let before = repo_state(&fixture);
    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    // The dirty-tree check runs before the merge is attempted, so this is the reason reported even
    // though the branches have also diverged. That ordering is deliberate: the uncommitted work is
    // the more fragile of the two problems, and it is what the agent has to deal with first.
    assert!(!result.success);
    assert_eq!(
        result.message,
        "Repository has uncommitted or untracked changes"
    );
    assert!(result.can_fix_with_agent);
    assert!(
        result.divergence.is_none(),
        "no merge was attempted, so no divergence is claimed"
    );

    assert_eq!(
        repo_state(&fixture),
        before,
        "the uncommitted work must be exactly where the operator left it"
    );
    assert_eq!(
        std::fs::read_to_string(fixture.repo.join("README.md")).expect("read README"),
        "uncommitted edit\n",
        "the uncommitted edit was overwritten"
    );
    assert!(
        fixture.repo.join("scratch.txt").exists(),
        "the untracked file was removed"
    );
}

#[test]
fn the_divergence_prompt_escalates_and_forbids_destroying_work() {
    let home = HomeFixture::new("sync-prompt");
    let fixture = repo_diverged_from_origin("prompt", 3);

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );
    let prompt = diagnostic_prompt(&result);

    // The original helper's wording is the contract the SyncRepo promptware was written against.
    assert!(
        prompt.contains(&format!(
            "The repository at '{}' could not be safely synchronized with remote branch 'main'.",
            result.repo_path
        )),
        "prompt lost the original opening: {}",
        prompt
    );
    assert!(prompt.contains(
        "Please inspect the repository status, check for uncommitted changes or branch divergence, \
         and help reconcile or update the branch safely without losing any work."
    ));

    // The divergence-specific paragraph exists because "without losing any work" is exactly the
    // instruction a hurried agent satisfies with a `reset --hard`.
    assert!(prompt.contains("3 local commit(s) and 1 remote commit(s)"));
    for forbidden in [
        "Do NOT force-push",
        "do NOT `reset --hard`",
        "do NOT delete a branch",
        "do NOT discard",
    ] {
        assert!(
            prompt.contains(forbidden),
            "prompt is missing the guardrail {:?}: {}",
            forbidden,
            prompt
        );
    }
    assert!(prompt.contains("Propose a merge or a rebase"));
}

#[test]
fn a_clean_failure_prompt_carries_no_divergence_paragraph() {
    let home = HomeFixture::new("sync-prompt-dirty");
    let fixture = GitRepoFixture::new("prompt-dirty");
    std::fs::write(fixture.repo.join("README.md"), "edited\n").expect("dirty the tree");

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );
    let prompt = diagnostic_prompt(&result);

    assert!(prompt.contains("could not be safely synchronized"));
    assert!(
        !prompt.contains("have genuinely diverged"),
        "a dirty tree is not a divergence: {}",
        prompt
    );
}

/// The two paths that touch branches in a repo must not be able to reach each other's refs: sync
/// only ever fast-forwards the base branch, and worktree reclaim only ever deletes `tendril/<plan>`.
#[test]
fn divergence_handling_and_worktree_reclaim_do_not_touch_each_other() {
    let home = HomeFixture::new("sync-worktree");
    let fixture = repo_diverged_from_origin("worktree-repo", 2);

    let plan_folder = home.plans_dir().join("20240101-Diverged");
    let worktrees_dir = plan_folder.join("Worktrees");
    std::fs::create_dir_all(&worktrees_dir).expect("create Worktrees dir");
    let worktree_path = worktrees_dir.join("worktree-repo");
    let plan_branch = derive_branch_name(&plan_folder);
    fixture.git(&[
        "worktree",
        "add",
        &worktree_path.to_string_lossy(),
        "-b",
        &plan_branch,
    ]);
    // A commit that exists only on the plan branch, so deleting it would destroy real work.
    let worktree_fixture_git = |args: &[&str]| fixture.git_in(&worktree_path, args);
    std::fs::write(worktree_path.join("agent.txt"), "agent work\n").expect("write agent.txt");
    worktree_fixture_git(&["add", "agent.txt"]);
    worktree_fixture_git(&["commit", "-m", "Agent work on the plan branch"]);
    let plan_branch_head = fixture.git(&["rev-parse", &plan_branch]);

    // 1. A refused sync leaves the plan's worktree and branch alone.
    let before = repo_state(&fixture);
    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );
    assert!(result.divergence.is_some(), "expected a divergence");
    assert_eq!(
        repo_state(&fixture),
        before,
        "sync must not disturb any ref, including the plan branch"
    );
    assert!(worktree_path.is_dir(), "the worktree was removed");
    assert!(
        fixture.branch_exists(&plan_branch),
        "the plan branch was deleted"
    );
    assert_eq!(fixture.git(&["rev-parse", &plan_branch]), plan_branch_head);

    // 2. Reclaiming the worktree — the one path that does delete a branch — leaves the diverged base
    //    branch and its remote-tracking ref exactly as they were.
    let main_head = fixture.git(&["rev-parse", "refs/heads/main"]);
    let origin_main_head = fixture.git(&["rev-parse", "refs/remotes/origin/main"]);
    remove_worktree(&plan_folder, "worktree-repo", None).expect("reclaim the worktree");
    assert!(!worktree_path.exists(), "the worktree was not reclaimed");
    assert!(
        !fixture.branch_exists(&plan_branch),
        "reclaim should have deleted the plan branch"
    );
    assert_eq!(
        fixture.git(&["rev-parse", "refs/heads/main"]),
        main_head,
        "reclaim moved the base branch"
    );
    assert_eq!(
        fixture.git(&["rev-parse", "refs/remotes/origin/main"]),
        origin_main_head,
        "reclaim moved the remote-tracking ref"
    );

    // 3. The divergence is still there afterwards, reported identically — reclaim resolved nothing
    //    and hid nothing.
    let after_reclaim = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );
    assert_eq!(after_reclaim.divergence, result.divergence);
    assert_eq!(after_reclaim.message, result.message);
}

/// A static guard over the git commands the sync path can issue.
///
/// The behavioural tests above prove the repository is unchanged after a refusal, but they can only
/// prove it for the states they set up. This proves it for every state at once: the module simply has
/// no way to spell a destructive command. A new `git(&[...])` call with a forbidden verb fails here
/// even if no test happens to exercise the branch that added it.
#[test]
fn the_sync_path_can_only_issue_read_only_and_fast_forward_git_commands() {
    let source =
        std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/git/sync.rs"))
            .expect("read sync.rs");

    let invocations = git_invocations(&source);
    assert!(
        invocations.len() >= 10,
        "the parser found only {} git invocations, so it is no longer reading the source correctly",
        invocations.len()
    );

    // `fetch` writes remote-tracking refs and `merge --ff-only` can advance a branch. Everything
    // else here only reads.
    const ALLOWED_SUBCOMMANDS: [&str; 7] = [
        "remote",
        "fetch",
        "symbolic-ref",
        "rev-parse",
        "rev-list",
        "status",
        "merge",
    ];
    // Anything that rewrites history, moves work between places, or deletes a ref.
    const FORBIDDEN: [&str; 13] = [
        "push",
        "reset",
        "rebase",
        "stash",
        "clean",
        "checkout",
        "switch",
        "branch",
        "worktree",
        "cherry-pick",
        "--hard",
        "--force",
        "-D",
    ];

    for argv in &invocations {
        let subcommand = argv.first().map(String::as_str).unwrap_or("");
        assert!(
            ALLOWED_SUBCOMMANDS.contains(&subcommand),
            "sync.rs issues `git {}`, which is not on the read-only/fast-forward allowlist: {:?}",
            subcommand,
            argv
        );
        for arg in argv {
            assert!(
                !FORBIDDEN.contains(&arg.as_str()),
                "sync.rs issues the forbidden argument {:?} in {:?}",
                arg,
                argv
            );
        }
        if subcommand == "merge" {
            assert!(
                argv.iter().any(|a| a == "--ff-only"),
                "every merge in sync.rs must be --ff-only: {:?}",
                argv
            );
        }
    }
}

/// The string literals of every `git(&[...], repo)` call in `source`, in order.
///
/// Non-literal elements (`remote`, `&remote_ref`) are kept as their identifier text so a forbidden
/// verb cannot hide behind a variable name, but only literals can carry a flag.
fn git_invocations(source: &str) -> Vec<Vec<String>> {
    let mut found = Vec::new();
    let mut rest = source;

    while let Some(idx) = rest.find("git(&[") {
        rest = &rest[idx + "git(&[".len()..];
        let Some(end) = rest.find(']') else { break };
        let argv = rest[..end]
            .split(',')
            .map(|arg| arg.trim().trim_matches('"').trim().to_string())
            .filter(|arg| !arg.is_empty())
            .collect::<Vec<_>>();
        rest = &rest[end..];
        if !argv.is_empty() {
            found.push(argv);
        }
    }

    found
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

/// A repo path that is a credentialed URL ends up in the result verbatim, and from there in three
/// places at once: the CLI printed `message` raw on the line between two it redacted,
/// `RepoSyncResultDto` copies every field into the HTTP response the webview reads, and
/// `diagnostic_prompt` pastes them into text handed to an agent.
///
/// A URL reaches `repos` for real. `tendril add-repo` and `POST /api/projects/:name/repos` both
/// accept one, `config.yaml` is hand-editable, and a create whose clone failed can leave one
/// behind. Sync expands whatever is there and reports it back.
///
/// The URL resolving to nothing is the point rather than a limitation: no directory means the very
/// first check fails, so this needs no network and no fixture, and it pins the field that carries
/// the credential furthest.
#[test]
fn sync_redacts_a_credentialed_repo_path() {
    let home = HomeFixture::new("sync-redact-path");
    let secret_url = "https://oauth2:ghp_notarealtoken@example.invalid/o/r.git";

    let result = sync_repository(secret_url, Some("main"), Path::new(&home.path));

    assert!(!result.success, "a URL is not a directory");

    let prompt = diagnostic_prompt(&result);
    for (label, text) in [
        ("message", result.message.as_str()),
        ("repo_path", result.repo_path.as_str()),
        ("diagnostic_prompt", prompt.as_str()),
    ] {
        assert!(
            !text.contains("ghp_notarealtoken"),
            "{} leaked the token: {}",
            label,
            text
        );
        // The username half goes too: a bare `ghp_...@host` is a credential with no colon in it, so
        // no rule can keep one half of the userinfo and still be safe.
        assert!(
            !text.contains("oauth2"),
            "{} leaked the userinfo: {}",
            label,
            text
        );
    }

    // Redacted, not dropped. A path the operator cannot recognise is a worse bug report than a
    // loud one, and this is what tells the assertions above from a function returning "".
    assert!(
        result.repo_path.contains("example.invalid") && result.repo_path.contains("***"),
        "the host should survive redaction: {}",
        result.repo_path
    );
    assert!(
        result.message.contains("example.invalid"),
        "the message should still name the repo: {}",
        result.message
    );
}

/// The other half: git's own stderr, reached through a fetch that fails.
///
/// Current git strips the userinfo out of its "unable to access" line itself, so this does not
/// leak today - it is here so that it cannot start to. Git has echoed credentialed URLs back in
/// the past, the shapes it prints differ by version, subcommand and transport, and the redaction
/// this asserts is what makes the difference not matter.
#[test]
fn sync_redacts_git_stderr_from_a_failing_fetch() {
    let home = HomeFixture::new("sync-redact-fetch");
    let fixture = GitRepoFixture::new("sync-redact-fetch");
    fixture.git(&[
        "remote",
        "set-url",
        "origin",
        "https://oauth2:ghp_notarealtoken@example.invalid/o/r.git",
    ]);

    let result = sync_repository(
        &fixture.repo.to_string_lossy(),
        Some("main"),
        Path::new(&home.path),
    );

    assert!(!result.success, "a fetch from nowhere should fail");
    let details = result.git_error_details.as_deref().unwrap_or_default();
    assert!(
        !details.is_empty(),
        "the fetch failure should carry git's stderr"
    );

    let prompt = diagnostic_prompt(&result);
    for (label, text) in [
        ("message", result.message.as_str()),
        ("git_error_details", details),
        ("diagnostic_prompt", prompt.as_str()),
    ] {
        assert!(
            !text.contains("ghp_notarealtoken") && !text.contains("oauth2"),
            "{} leaked the credential: {}",
            label,
            text
        );
    }
}
