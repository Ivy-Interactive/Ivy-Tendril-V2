//! The data behind a plan's Git tab: commits grouped under the worktree that made them, and the
//! reachability verdict for the commits no worktree accounts for.
//!
//! Reachability is a question only real git can answer — whether a ref still holds a commit is a
//! property of the object store, not of anything Tendril records — so these tests drive a throwaway
//! repository with a bare `origin` beside it. Nothing here reaches the network.

mod common;

use common::{plan_with, GitRepoFixture, HomeFixture};
use std::path::{Path, PathBuf};
use tendril_core::git::git_tab::build_plan_git_data;
use tendril_core::git::service::CommitRefStatus;
use tendril_core::git::worktree::{add_worktree, WorktreeMode};
use tendril_core::models::PlanStatus;

/// Writes an Executing plan folder and returns its path.
fn plan_folder(home: &HomeFixture, folder: &str) -> PathBuf {
    home.write_plan(folder, &plan_with(PlanStatus::Executing, &[]))
}

/// Cuts the plan's worktree for the fixture repo off `main`.
fn worktree_for(fx: &GitRepoFixture, plan_folder: &Path) -> PathBuf {
    add_worktree(
        &fx.repo,
        plan_folder,
        Some("main"),
        WorktreeMode::ReuseIfValid,
        None,
    )
    .expect("add worktree")
    .path
}

/// Commits a file inside a worktree and returns the commit's full hash.
fn commit_in(fx: &GitRepoFixture, worktree: &Path, file: &str, content: &str) -> String {
    std::fs::write(worktree.join(file), content).expect("write file in worktree");
    fx.git_in(worktree, &["add", file]);
    fx.git_in(worktree, &["commit", "-m", &format!("Add {}", file)]);
    fx.git_in(worktree, &["rev-parse", "HEAD"])
        .trim()
        .to_string()
}

#[test]
fn commits_made_in_a_worktree_are_grouped_under_it() {
    let home = HomeFixture::new("git-tab-group");
    let fx = GitRepoFixture::new("group");
    let folder = plan_folder(&home, "00201-GroupCommits");
    let worktree = worktree_for(&fx, &folder);

    let first = commit_in(&fx, &worktree, "one.txt", "one\n");
    let second = commit_in(&fx, &worktree, "two.txt", "two\n");

    let data = build_plan_git_data(
        &folder,
        &[first.clone(), second.clone()],
        &[fx.repo.clone()],
    );

    assert_eq!(data.worktrees.len(), 1, "the plan has exactly one worktree");
    let section = &data.worktrees[0];
    assert_eq!(section.branch, "tendril/00201-GroupCommits");
    assert_eq!(section.short_hash, second[..7]);
    assert!(!section.has_uncommitted_changes);
    assert_eq!(
        section.commits.iter().map(|c| &c.hash).collect::<Vec<_>>(),
        vec![&first, &second],
        "both commits belong to the worktree that made them, in recorded order"
    );
    assert_eq!(section.commits[0].title, "Add one.txt");
    assert_eq!(section.commits[0].file_count, Some(1));
    assert_eq!(section.commits[0].short_hash, first[..7]);

    // The base is the branch the worktree was cut from, not the worktree's own branch.
    assert_eq!(section.base_branch.as_deref(), Some("main"));
    assert!(section.base_short_hash.is_some());
    assert_eq!(
        section
            .parent_repo_path
            .as_deref()
            .map(|p| canonical(Path::new(p))),
        Some(canonical(&fx.repo)),
        "the section points back at the repository the worktree came from"
    );

    assert!(
        data.unassociated_commits.is_empty(),
        "a live worktree accounts for its own commits"
    );
    assert!(
        data.commits_at_risk().is_empty(),
        "commits reachable from a worktree HEAD are not at risk"
    );
    assert_eq!(data.item_count(2), 3);
}

#[test]
fn a_dirty_worktree_is_flagged() {
    let home = HomeFixture::new("git-tab-dirty");
    let fx = GitRepoFixture::new("dirty");
    let folder = plan_folder(&home, "00202-DirtyWorktree");
    let worktree = worktree_for(&fx, &folder);

    std::fs::write(worktree.join("scratch.txt"), "uncommitted\n").expect("write scratch file");

    let data = build_plan_git_data(&folder, &[], &[fx.repo.clone()]);

    assert_eq!(data.worktrees.len(), 1);
    assert!(
        data.worktrees[0].has_uncommitted_changes,
        "an untracked file is uncommitted work the tab has to surface"
    );
}

#[test]
fn a_commit_whose_worktree_and_branch_are_gone_is_reported_unreachable() {
    let home = HomeFixture::new("git-tab-lost");
    let fx = GitRepoFixture::new("lost");
    let folder = plan_folder(&home, "00203-LostWork");
    let worktree = worktree_for(&fx, &folder);

    let hash = commit_in(&fx, &worktree, "work.txt", "work\n");

    // What happens to every plan once its PR merges and the reaper runs. The commit was never
    // pushed, so nothing is left holding it.
    fx.git(&["worktree", "remove", "--force", &worktree.to_string_lossy()]);
    fx.git(&["branch", "-D", "tendril/00203-LostWork"]);

    let data = build_plan_git_data(&folder, &[hash.clone()], &[fx.repo.clone()]);

    assert!(
        data.worktrees.is_empty(),
        "the worktree is gone, so there is no section for it"
    );
    assert_eq!(
        data.unassociated_commits
            .iter()
            .map(|c| &c.hash)
            .collect::<Vec<_>>(),
        vec![&hash],
        "a commit no surviving worktree accounts for is unassociated"
    );
    assert_eq!(
        data.unassociated_commit_ref_status.get(&hash),
        Some(&CommitRefStatus::Unreachable),
        "the object still exists but no ref holds it: one `git gc` from gone"
    );
    assert_eq!(
        data.commits_at_risk().len(),
        1,
        "this is the case the Git tab exists to warn about"
    );
    assert_eq!(
        data.unassociated_commits[0].title, "Add work.txt",
        "an unreachable commit is still readable, which is why the warning can name it"
    );
}

#[test]
fn a_commit_another_branch_still_holds_is_unassociated_but_not_at_risk() {
    let home = HomeFixture::new("git-tab-other-branch");
    let fx = GitRepoFixture::new("otherbranch");
    let folder = plan_folder(&home, "00204-OtherBranch");
    worktree_for(&fx, &folder);

    // A commit on a branch of its own: not an ancestor of the worktree's HEAD, but held by a ref.
    fx.commit_on("feature", "elsewhere.txt", "elsewhere\n");
    let hash = fx.git(&["rev-parse", "HEAD"]).trim().to_string();

    let data = build_plan_git_data(&folder, &[hash.clone()], &[fx.repo.clone()]);

    assert_eq!(
        data.unassociated_commits.len(),
        1,
        "the worktree's HEAD does not reach it"
    );
    assert_eq!(
        data.unassociated_commit_ref_status.get(&hash),
        Some(&CommitRefStatus::Reachable)
    );
    assert!(
        data.commits_at_risk().is_empty(),
        "a commit a branch still holds is not at risk"
    );
}

#[test]
fn a_commit_no_repo_holds_is_reported_missing() {
    let home = HomeFixture::new("git-tab-missing");
    let fx = GitRepoFixture::new("missing");
    let folder = plan_folder(&home, "00205-MissingCommit");

    let hash = "0123456789abcdef0123456789abcdef01234567".to_string();
    let data = build_plan_git_data(&folder, &[hash.clone()], &[fx.repo.clone()]);

    assert_eq!(
        data.unassociated_commit_ref_status.get(&hash),
        Some(&CommitRefStatus::Missing)
    );
    assert_eq!(data.commits_at_risk().len(), 1);
    let row = &data.unassociated_commits[0];
    assert_eq!(row.short_hash, "0123456");
    assert!(
        row.title.is_empty() && row.file_count.is_none(),
        "a hash no repo can resolve still gets a row, with nothing filled in"
    );
}

#[test]
fn a_plan_with_no_worktrees_and_no_commits_has_nothing_to_show() {
    let home = HomeFixture::new("git-tab-empty");
    let folder = plan_folder(&home, "00206-Empty");

    let data = build_plan_git_data(&folder, &[], &[]);

    assert!(data.worktrees.is_empty());
    assert!(data.unassociated_commits.is_empty());
    assert!(data.unassociated_commit_ref_status.is_empty());
    assert_eq!(data.item_count(0), 0);
}

#[test]
fn a_worktree_directory_git_no_longer_knows_about_is_skipped() {
    let home = HomeFixture::new("git-tab-orphan");
    let fx = GitRepoFixture::new("orphan");
    let folder = plan_folder(&home, "00207-OrphanDir");

    // A leftover directory with a `.git` file pointing nowhere: enumeration finds it, git does not
    // recognise it, and the tab must render the rest of the plan regardless.
    let orphan = folder.join("Worktrees").join("orphan");
    std::fs::create_dir_all(&orphan).expect("create orphan worktree dir");
    std::fs::write(
        orphan.join(".git"),
        "gitdir: /nonexistent/.git/worktrees/orphan\n",
    )
    .expect("write orphan .git file");

    let data = build_plan_git_data(&folder, &[], &[fx.repo.clone()]);

    assert!(
        data.worktrees.is_empty(),
        "a directory with no live registration behind it contributes no section"
    );
}

fn canonical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}
