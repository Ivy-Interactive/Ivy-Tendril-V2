//! Worktree creation, removal, the plan-level worktree registry, and the unattended reaper.
//!
//! These tests drive real `git` against a throwaway repository with a bare `origin` beside it:
//! `git worktree add` cannot be stubbed, and every reaper decision is an answer git gives about
//! actual refs. Nothing here reaches the network — PR states come from an injected resolver.

mod common;

use common::{plan_with, worktree_registered, GitRepoFixture, HomeFixture};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tendril_core::config::TendrilSettings;
use tendril_core::error::Result;
use tendril_core::git::worktree::{
    add_worktree, register_worktree, remove_worktree, RemoveOutcome, WorktreeCreation, WorktreeMode,
};
use tendril_core::git::worktree_log::WorktreeLifecycleLog;
use tendril_core::git::worktree_reaper::{
    branch_disposition, reap_worktrees_with, BranchDeleteMode, BranchDisposition, ReaperConfig,
};
use tendril_core::models::{
    ExecutePlanArgs, JobArgs, JobItem, PlanStatus, PlanWorktreeEntry, ProjectConfig, RepoRef,
};
use tendril_core::plans::reader::read_plan_yaml;
use tendril_core::plans::writer::write_plan_yaml;

/// A PR resolver that reports every PR as merged.
fn merged(_url: &str) -> Result<String> {
    Ok("MERGED".to_string())
}

/// A PR resolver that reports every PR as still open.
fn open(_url: &str) -> Result<String> {
    Ok("OPEN".to_string())
}

/// A PR resolver that cannot reach GitHub.
fn unreachable(_url: &str) -> Result<String> {
    Err(tendril_core::error::TendrilError::Git(
        "gh: could not resolve host".to_string(),
    ))
}

/// Writes a plan folder in the given state, with the given PR URLs.
fn write_plan(home: &HomeFixture, folder: &str, state: PlanStatus, prs: &[&str]) -> PathBuf {
    let mut plan = plan_with(state, &[]);
    plan.state = state.to_string();
    plan.prs = prs.iter().map(|u| (*u).to_string()).collect();
    home.write_plan(folder, &plan)
}

/// Backdates `plan.updated` so the plan reads as idle. Called after every worktree registration,
/// because registering bumps `updated` to now.
fn set_idle(plan_folder: &Path, idle: chrono::Duration) {
    let (mut plan, _) = read_plan_yaml(plan_folder).expect("read plan.yaml");
    plan.updated = chrono::Utc::now() - idle;
    write_plan_yaml(plan_folder, &plan).expect("write plan.yaml");
}

/// Creates the plan's worktree for the fixture repo and records it on the plan.
fn worktree_for(fx: &GitRepoFixture, plan_folder: &Path) -> WorktreeCreation {
    let creation = add_worktree(
        &fx.repo,
        plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect("add worktree");

    register_worktree(
        plan_folder,
        PlanWorktreeEntry {
            repo: creation.repo.to_string_lossy().to_string(),
            path: creation.path.to_string_lossy().to_string(),
            branch: creation.branch.clone(),
            created: chrono::Utc::now(),
        },
    )
    .expect("register worktree");

    creation
}

/// A config for a pass that reaps anything idle at all.
fn reap_now(mode: BranchDeleteMode) -> ReaperConfig {
    ReaperConfig {
        grace: Duration::from_secs(0),
        mode,
        log: None,
    }
}

/// Commits a file inside a worktree, leaving the commit only on the worktree's branch.
fn commit_in_worktree(fx: &GitRepoFixture, worktree: &Path, file: &str, content: &str) {
    std::fs::write(worktree.join(file), content).expect("write file in worktree");
    fx.git_in(worktree, &["add", file]);
    fx.git_in(worktree, &["commit", "-m", &format!("Add {}", file)]);
}

/// Creates a directory that looks like a leftover worktree but has no `.git` file.
fn orphan_dir(plan_folder: &Path, name: &str) -> PathBuf {
    let path = plan_folder.join("Worktrees").join(name);
    std::fs::create_dir_all(&path).expect("create orphan worktree dir");
    std::fs::write(path.join("leftover.txt"), "stale\n").expect("write orphan file");
    path
}

#[test]
fn add_worktree_creates_a_usable_checkout() {
    let home = HomeFixture::new("wt-create");
    let fx = GitRepoFixture::new("create");
    let plan_folder = write_plan(&home, "00101-CreateCheckout", PlanStatus::Executing, &[]);

    let creation = add_worktree(
        &fx.repo,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect("add worktree");

    assert!(!creation.reused);
    assert_eq!(creation.branch, "tendril/00101-CreateCheckout");
    assert_eq!(
        creation.path,
        plan_folder
            .join("Worktrees")
            .join(fx.repo.file_name().unwrap())
    );
    assert!(
        creation.path.join(".git").is_file(),
        "a worktree without a .git file is not a checkout"
    );
    assert!(creation.path.join("README.md").is_file());
    assert!(fx.branch_exists("tendril/00101-CreateCheckout"));
}

#[test]
fn add_worktree_is_idempotent_on_rerun() {
    let home = HomeFixture::new("wt-rerun");
    let fx = GitRepoFixture::new("rerun");
    let plan_folder = write_plan(&home, "00102-Rerun", PlanStatus::Executing, &[]);

    let first = add_worktree(
        &fx.repo,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect("first add");
    // Work in progress that a re-run must not throw away.
    commit_in_worktree(&fx, &first.path, "wip.txt", "in progress\n");
    let tip = fx
        .git_in(&first.path, &["rev-parse", "HEAD"])
        .trim()
        .to_string();

    let second = add_worktree(
        &fx.repo,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect("second add");

    assert!(second.reused, "an existing valid worktree must be reused");
    assert_eq!(second.path, first.path);
    assert_eq!(second.branch, first.branch);
    assert!(second.path.join("wip.txt").is_file());
    assert_eq!(
        fx.git_in(&second.path, &["rev-parse", "HEAD"]).trim(),
        tip,
        "reuse must not re-cut the branch"
    );
}

#[test]
fn add_worktree_registers_the_worktree_on_the_plan() {
    let home = HomeFixture::new("wt-register");
    let fx = GitRepoFixture::new("register");
    let plan_folder = write_plan(&home, "00103-Register", PlanStatus::Executing, &[]);

    let creation = worktree_for(&fx, &plan_folder);

    assert!(worktree_registered(&plan_folder, &creation.path));

    let (plan, _) = read_plan_yaml(&plan_folder).expect("read plan.yaml");
    let entries = plan.worktrees.expect("worktrees recorded");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].branch, creation.branch);
    assert_eq!(entries[0].repo, fx.repo.to_string_lossy().to_string());

    // Registering the same worktree twice must not duplicate the row.
    worktree_for(&fx, &plan_folder);
    let (plan, _) = read_plan_yaml(&plan_folder).expect("read plan.yaml");
    assert_eq!(plan.worktrees.expect("worktrees recorded").len(), 1);
}

#[test]
fn a_repo_path_that_does_not_exist_is_an_error() {
    let home = HomeFixture::new("wt-norepo");
    let plan_folder = write_plan(&home, "00104-NoRepo", PlanStatus::Executing, &[]);
    let missing = home.path.join("repos").join("gone");

    let err = add_worktree(
        &missing,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect_err("a missing repo cannot yield a worktree");

    assert!(err.to_string().contains("does not exist"), "got: {}", err);
}

#[test]
fn remove_worktree_removes_exactly_one() {
    let home = HomeFixture::new("wt-remove-one");
    let repo_a = GitRepoFixture::new("removeone-a");
    let repo_b = GitRepoFixture::new("removeone-b");
    let plan_folder = write_plan(&home, "00105-RemoveOne", PlanStatus::Executing, &[]);

    let worktree_a = add_worktree(
        &repo_a.repo,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect("add worktree a");
    let worktree_b = add_worktree(
        &repo_b.repo,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect("add worktree b");
    assert!(repo_a.branch_exists(&worktree_a.branch));
    assert!(repo_b.branch_exists(&worktree_b.branch));

    let name_a = worktree_a
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let outcome = remove_worktree(&plan_folder, &name_a, None).expect("remove_worktree");

    assert!(
        matches!(
            outcome,
            RemoveOutcome::Removed(_) | RemoveOutcome::ForceDeleted(_)
        ),
        "unexpected outcome: {:?}",
        outcome
    );
    assert!(!worktree_a.path.exists(), "removed worktree should be gone");
    assert!(
        worktree_b.path.exists(),
        "the other worktree must be untouched"
    );

    assert!(
        !repo_a.branch_exists(&worktree_a.branch),
        "the removed worktree's branch should be deleted"
    );
    assert!(
        repo_b.branch_exists(&worktree_b.branch),
        "the surviving worktree's branch must be left alone"
    );
}

#[test]
fn remove_worktree_missing_directory_is_ok() {
    let home = HomeFixture::new("wt-remove-missing");
    let plan_folder = write_plan(&home, "00106-MissingWorktree", PlanStatus::Executing, &[]);
    std::fs::create_dir_all(plan_folder.join("Worktrees")).expect("create Worktrees dir");

    // CreatePr runs cleanup unconditionally, so "already gone" has to be success rather than an
    // error, or a second run would fail the plan.
    let outcome = remove_worktree(&plan_folder, "NotThere", None).expect("missing worktree is Ok");
    assert!(matches!(outcome, RemoveOutcome::NotFound(_)));
}

#[test]
fn remove_worktree_finds_nested_worktree_by_name() {
    let home = HomeFixture::new("wt-remove-nested");
    let repo = GitRepoFixture::new("removenested");
    let plan_folder = write_plan(&home, "00107-NestedWorktree", PlanStatus::Executing, &[]);

    let creation = add_worktree(
        &repo.repo,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect("add_worktree");
    let repo_name = creation
        .path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();

    // Move it into an owner folder, which is the `Worktrees/<owner>/<repo>` layout in use, so the
    // case-insensitive fallback scan is what has to find it.
    let owner_dir = plan_folder.join("Worktrees").join("Ivy-Interactive");
    std::fs::create_dir_all(&owner_dir).expect("create owner dir");
    let nested = owner_dir.join(&repo_name);
    std::fs::rename(&creation.path, &nested).expect("move worktree under owner dir");

    let outcome =
        remove_worktree(&plan_folder, &repo_name.to_uppercase(), None).expect("remove nested");
    assert!(
        matches!(
            outcome,
            RemoveOutcome::Removed(_) | RemoveOutcome::ForceDeleted(_)
        ),
        "unexpected outcome: {:?}",
        outcome
    );
    assert!(!nested.exists());
}

#[test]
fn reaper_keeps_a_branch_with_unpushed_commits() {
    let home = HomeFixture::new("reap-keep");
    let fx = GitRepoFixture::new("keep");
    let plan_folder = write_plan(
        &home,
        "00110-Keep",
        PlanStatus::Completed,
        &["https://github.com/o/r/pull/1"],
    );
    let creation = worktree_for(&fx, &plan_folder);
    commit_in_worktree(&fx, &creation.path, "unpushed.txt", "only here\n");
    set_idle(&plan_folder, chrono::Duration::hours(1));

    let report = reap_worktrees_with(
        &home.plans_dir(),
        &reap_now(BranchDeleteMode::PreserveUnpushed),
        &merged,
    );

    assert!(
        report.reclaimed.is_empty(),
        "unpushed work must survive: {:?}",
        report.reclaimed
    );
    assert_eq!(report.skipped.len(), 1);
    assert!(
        report.skipped[0].1.contains("on no remote"),
        "got: {}",
        report.skipped[0].1
    );
    assert!(creation.path.is_dir(), "the worktree must be left in place");
    assert!(fx.branch_exists(&creation.branch));
    assert!(worktree_registered(&plan_folder, &creation.path));
}

#[test]
fn reaper_deletes_a_pushed_branch() {
    let home = HomeFixture::new("reap-pushed");
    let fx = GitRepoFixture::new("pushed");
    let plan_folder = write_plan(
        &home,
        "00111-Pushed",
        PlanStatus::Completed,
        &["https://github.com/o/r/pull/2"],
    );
    let creation = worktree_for(&fx, &plan_folder);
    commit_in_worktree(&fx, &creation.path, "pushed.txt", "safe elsewhere\n");
    fx.git_in(&creation.path, &["push", "origin", &creation.branch]);
    set_idle(&plan_folder, chrono::Duration::hours(1));

    let report = reap_worktrees_with(
        &home.plans_dir(),
        &reap_now(BranchDeleteMode::PreserveUnpushed),
        &merged,
    );

    assert_eq!(report.skipped, vec![], "nothing should have been skipped");
    assert_eq!(report.reclaimed.len(), 1);
    assert!(!creation.path.exists(), "the worktree must be gone");
    assert!(!fx.branch_exists(&creation.branch));
    assert!(!worktree_registered(&plan_folder, &creation.path));
}

#[test]
fn branch_disposition_keeps_on_git_failure() {
    // git cannot even be started in a directory that is not there, so nothing is known about the
    // branch — and an unknown branch is never deleted.
    let missing =
        std::env::temp_dir().join(format!("tendril-absent-{}", uuid::Uuid::new_v4().simple()));

    let disposition = branch_disposition(
        &missing,
        "tendril/00112-Unknown",
        BranchDeleteMode::PreserveUnpushed,
    );

    assert_eq!(
        disposition,
        BranchDisposition::Keep("could not resolve branch tip".to_string())
    );
}

#[test]
fn reaper_skips_non_terminal_plans() {
    for state in [
        "Draft",
        "Creating",
        "Updating",
        "Executing",
        "Failed",
        "Review",
        "Icebox",
        "Blocked",
        "NotAState",
    ] {
        let home = HomeFixture::new("reap-nonterminal");
        let mut plan = plan_with(PlanStatus::Draft, &[]);
        plan.state = state.to_string();
        plan.prs = vec!["https://github.com/o/r/pull/3".to_string()];
        plan.updated = chrono::Utc::now() - chrono::Duration::days(30);
        let plan_folder = home.write_plan("00113-NonTerminal", &plan);
        let leftover = orphan_dir(&plan_folder, "leftover");

        let report = reap_worktrees_with(
            &home.plans_dir(),
            &reap_now(BranchDeleteMode::PreserveUnpushed),
            &merged,
        );

        assert!(
            report.reclaimed.is_empty(),
            "state {} must not be reaped: {:?}",
            state,
            report.reclaimed
        );
        assert_eq!(report.skipped.len(), 1, "state {}", state);
        assert!(leftover.is_dir(), "state {} lost its worktree", state);
    }
}

#[test]
fn reaper_skips_completed_plan_without_a_merged_pr() {
    let cases: [(
        &str,
        &[&str],
        tendril_core::plans::dependencies::PrStateResolver,
    ); 3] = [
        ("no PR at all", &[], &merged),
        ("an open PR", &["https://github.com/o/r/pull/4"], &open),
        (
            "a PR whose state is unknown",
            &["https://github.com/o/r/pull/5"],
            &unreachable,
        ),
    ];

    for (label, prs, resolver) in cases {
        let home = HomeFixture::new("reap-unmerged");
        let plan_folder = write_plan(&home, "00114-Unmerged", PlanStatus::Completed, prs);
        set_idle(&plan_folder, chrono::Duration::days(30));
        let leftover = orphan_dir(&plan_folder, "leftover");

        let report = reap_worktrees_with(
            &home.plans_dir(),
            &reap_now(BranchDeleteMode::PreserveUnpushed),
            resolver,
        );

        assert!(
            report.reclaimed.is_empty(),
            "{} must not be reaped: {:?}",
            label,
            report.reclaimed
        );
        assert_eq!(report.skipped.len(), 1, "{}", label);
        assert!(leftover.is_dir(), "{} lost its worktree", label);
    }
}

#[test]
fn reaper_skips_a_plan_inside_its_grace_window() {
    let home = HomeFixture::new("reap-grace");
    let fx = GitRepoFixture::new("grace");
    let plan_folder = write_plan(&home, "00115-Grace", PlanStatus::Skipped, &[]);
    let creation = worktree_for(&fx, &plan_folder);
    set_idle(&plan_folder, chrono::Duration::minutes(1));

    let cfg = ReaperConfig {
        grace: Duration::from_secs(60 * 60),
        mode: BranchDeleteMode::PreserveUnpushed,
        log: None,
    };
    let report = reap_worktrees_with(&home.plans_dir(), &cfg, &merged);

    assert!(report.reclaimed.is_empty());
    assert_eq!(report.skipped.len(), 1);
    assert!(
        report.skipped[0].1.contains("grace"),
        "got: {}",
        report.skipped[0].1
    );
    assert!(creation.path.is_dir());
}

#[test]
fn reaper_reaps_a_skipped_plan_without_a_pr() {
    let home = HomeFixture::new("reap-skipped");
    let fx = GitRepoFixture::new("skipped");
    let plan_folder = write_plan(&home, "00116-SkippedPlan", PlanStatus::Skipped, &[]);
    let creation = worktree_for(&fx, &plan_folder);
    set_idle(&plan_folder, chrono::Duration::hours(1));

    let report = reap_worktrees_with(
        &home.plans_dir(),
        &reap_now(BranchDeleteMode::PreserveUnpushed),
        &merged,
    );

    assert_eq!(report.skipped, vec![]);
    assert_eq!(report.reclaimed.len(), 1);
    assert!(!creation.path.exists());
    assert!(!fx.branch_exists(&creation.branch));
}

#[test]
fn force_mode_deletes_the_branch_and_worktree() {
    let home = HomeFixture::new("reap-force");
    let fx = GitRepoFixture::new("force");
    let plan_folder = write_plan(&home, "00117-Force", PlanStatus::Skipped, &[]);
    let creation = worktree_for(&fx, &plan_folder);
    commit_in_worktree(&fx, &creation.path, "unpushed.txt", "gone in force mode\n");
    set_idle(&plan_folder, chrono::Duration::hours(1));

    let report = reap_worktrees_with(
        &home.plans_dir(),
        &reap_now(BranchDeleteMode::Force),
        &merged,
    );

    assert_eq!(report.skipped, vec![]);
    assert_eq!(report.reclaimed.len(), 1);
    assert!(!creation.path.exists());
    assert!(
        !fx.branch_exists(&creation.branch),
        "Force mode deletes the branch even unpushed"
    );
}

#[test]
fn reaper_removes_an_orphan_worktree_directory() {
    let home = HomeFixture::new("reap-orphan");
    let plan_folder = write_plan(&home, "00118-Orphan", PlanStatus::Skipped, &[]);
    set_idle(&plan_folder, chrono::Duration::hours(1));
    let orphan = orphan_dir(&plan_folder, "AbandonedRepo");

    let report = reap_worktrees_with(
        &home.plans_dir(),
        &reap_now(BranchDeleteMode::PreserveUnpushed),
        &merged,
    );

    assert_eq!(report.skipped, vec![]);
    assert_eq!(report.reclaimed, vec!["00118-Orphan/AbandonedRepo"]);
    assert!(!orphan.exists());
}

#[test]
fn lifecycle_log_records_creation_reuse_and_reaping() {
    let home = HomeFixture::new("reap-log");
    let fx = GitRepoFixture::new("log");
    let plan_folder = write_plan(&home, "00119-Logged", PlanStatus::Skipped, &[]);

    let log_path = home.path.join("Logs").join("worktrees.log");
    let log = WorktreeLifecycleLog::at(log_path.clone());

    let created = add_worktree(
        &fx.repo,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        Some(&log),
    )
    .expect("first add");
    add_worktree(
        &fx.repo,
        &plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        Some(&log),
    )
    .expect("second add");
    set_idle(&plan_folder, chrono::Duration::hours(1));

    let cfg = ReaperConfig {
        grace: Duration::from_secs(0),
        mode: BranchDeleteMode::PreserveUnpushed,
        log: Some(WorktreeLifecycleLog::at(log_path.clone())),
    };
    let report = reap_worktrees_with(&home.plans_dir(), &cfg, &merged);
    assert_eq!(report.reclaimed.len(), 1, "skipped: {:?}", report.skipped);

    let contents = std::fs::read_to_string(&log_path).expect("read worktree log");
    for event in ["[Creation]", "[Reuse]", "[ReapAttempt]", "[Reclaimed]"] {
        assert!(
            contents.contains(event),
            "{} missing from:\n{}",
            event,
            contents
        );
    }
    assert!(
        contents.contains("[00119]"),
        "the plan id must be on every line:\n{}",
        contents
    );
    assert!(contents.contains(&created.branch.to_string()));
}

#[tokio::test]
async fn prepare_plan_worktrees_creates_one_per_repo() {
    let home = HomeFixture::new("prepare-worktrees");
    let first = GitRepoFixture::new("first");
    let second = GitRepoFixture::new("second");

    let mut plan = plan_with(PlanStatus::Executing, &[]);
    plan.repos = vec![
        first.repo.to_string_lossy().to_string(),
        second.repo.to_string_lossy().to_string(),
    ];
    let plan_folder = home.write_plan("00120-TwoRepos", &plan);

    let settings = TendrilSettings {
        projects: vec![ProjectConfig {
            name: "FixtureProject".to_string(),
            color: String::new(),
            repos: plan
                .repos
                .iter()
                .map(|path| RepoRef {
                    path: path.clone(),
                    base_branch: Some("main".to_string()),
                })
                .collect(),
            verifications: vec![],
            context: String::new(),
            stack_hash: None,
            review_actions: vec![],
            build_dependencies: vec![],
            ..Default::default()
        }],
        ..Default::default()
    };

    let folder_path = plan_folder.to_string_lossy().to_string();
    let mut job = JobItem::new(
        "00042".to_string(),
        "ExecutePlan".to_string(),
        folder_path.clone(),
        "FixtureProject".to_string(),
    );
    let args = JobArgs::ExecutePlan(ExecutePlanArgs {
        folder_path,
        note: None,
    });
    job.typed_args = Some(args.clone());
    job.args = serde_json::to_string(&args).ok();

    tendril_core::jobs::manager::prepare_plan_worktrees(&home.path, &job, &settings)
        .await
        .expect("prepare worktrees");

    for fx in [&first, &second] {
        let expected = plan_folder
            .join("Worktrees")
            .join(fx.repo.file_name().unwrap());
        assert!(
            expected.join(".git").is_file(),
            "no worktree for {}",
            fx.repo.display()
        );
        assert!(fx.branch_exists("tendril/00120-TwoRepos"));
        assert!(worktree_registered(&plan_folder, &expected));
    }
}
