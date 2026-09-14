//! Coverage for `git/worktree.rs`, which had none before Plan 00559.
//!
//! Every fixture is a throwaway `git init` under the temp dir, so nothing here touches a real
//! repository. Note that `add_worktree` runs `fetch origin` and these repos have no remote: the
//! fetch result is deliberately ignored and the local-branch retry path takes over.

use std::path::{Path, PathBuf};
use tendril_core::git::worktree::{add_worktree, remove_worktree, RemoveOutcome};

/// A temp git repo with one commit, removed on drop.
struct RepoFixture {
    path: PathBuf,
}

impl Drop for RepoFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn git(args: &[&str], cwd: &Path) {
    let status = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap_or_else(|e| panic!("git {:?} failed to spawn: {}", args, e));
    assert!(
        status.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&status.stderr)
    );
}

fn git_output(args: &[&str], cwd: &Path) -> String {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap_or_else(|e| panic!("git {:?} failed to spawn: {}", args, e));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

impl RepoFixture {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-worktree-repo-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).expect("create repo dir");

        git(&["init", "--initial-branch=main"], &path);
        // Set identity locally so the commit works on an account with no global git config.
        git(&["config", "user.name", "Tendril Test"], &path);
        git(&["config", "user.email", "test@example.com"], &path);
        std::fs::write(path.join("README.md"), "fixture\n").expect("write README");
        git(&["add", "."], &path);
        git(&["commit", "-m", "initial"], &path);

        Self { path }
    }

    fn branch_exists(&self, branch: &str) -> bool {
        !git_output(&["branch", "--list", branch], &self.path).is_empty()
    }
}

/// A throwaway plan folder, removed on drop.
struct PlanFixture {
    path: PathBuf,
}

impl Drop for PlanFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

impl PlanFixture {
    fn new(folder_name: &str) -> Self {
        let path = std::env::temp_dir()
            .join(format!(
                "tendril-worktree-plan-{}",
                uuid::Uuid::new_v4().simple()
            ))
            .join(folder_name);
        std::fs::create_dir_all(&path).expect("create plan folder");
        Self { path }
    }

    fn branch(&self) -> String {
        format!(
            "tendril/{}",
            self.path.file_name().unwrap().to_string_lossy()
        )
    }
}

#[test]
fn add_worktree_creates_worktree_in_temp_repo() {
    let repo = RepoFixture::new("add");
    let plan = PlanFixture::new("00001-AddWorktreeTest");

    let worktree = add_worktree(&repo.path, &plan.path, None).expect("add_worktree");

    // A worktree's `.git` is a file containing `gitdir:`, not a directory. Everything downstream
    // (branch derivation, repo-root recovery) depends on that.
    let dot_git = worktree.join(".git");
    assert!(dot_git.is_file(), "{} should be a file", dot_git.display());

    let repo_name = repo.path.file_name().unwrap().to_string_lossy().to_string();
    assert_eq!(worktree, plan.path.join("Worktrees").join(&repo_name));

    let head = git_output(&["rev-parse", "--abbrev-ref", "HEAD"], &worktree);
    assert_eq!(head, plan.branch());
}

#[test]
fn remove_worktree_removes_exactly_one() {
    let repo_a = RepoFixture::new("one");
    let repo_b = RepoFixture::new("two");
    let plan = PlanFixture::new("00002-RemoveOneWorktree");

    let worktree_a = add_worktree(&repo_a.path, &plan.path, None).expect("add worktree a");
    let worktree_b = add_worktree(&repo_b.path, &plan.path, None).expect("add worktree b");
    assert!(repo_a.branch_exists(&plan.branch()));
    assert!(repo_b.branch_exists(&plan.branch()));

    let name_a = worktree_a
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    let outcome = remove_worktree(&plan.path, &name_a, None).expect("remove_worktree");

    assert!(
        matches!(
            outcome,
            RemoveOutcome::Removed(_) | RemoveOutcome::ForceDeleted(_)
        ),
        "unexpected outcome: {:?}",
        outcome
    );
    assert!(!worktree_a.exists(), "removed worktree should be gone");
    assert!(worktree_b.exists(), "the other worktree must be untouched");

    assert!(
        !repo_a.branch_exists(&plan.branch()),
        "the removed worktree's branch should be deleted"
    );
    assert!(
        repo_b.branch_exists(&plan.branch()),
        "the surviving worktree's branch must be left alone"
    );
}

#[test]
fn remove_worktree_missing_directory_is_ok() {
    let plan = PlanFixture::new("00003-MissingWorktree");
    std::fs::create_dir_all(plan.path.join("Worktrees")).expect("create Worktrees dir");

    // CreatePr runs cleanup unconditionally, so "already gone" has to be success rather than an
    // error, or a second run would fail the plan.
    let outcome = remove_worktree(&plan.path, "NotThere", None).expect("missing worktree is Ok");
    assert!(matches!(outcome, RemoveOutcome::NotFound(_)));
}

#[test]
fn remove_worktree_finds_nested_worktree_by_name() {
    let repo = RepoFixture::new("nested");
    let plan = PlanFixture::new("00004-NestedWorktree");

    let worktree = add_worktree(&repo.path, &plan.path, None).expect("add_worktree");
    let repo_name = worktree.file_name().unwrap().to_string_lossy().to_string();

    // Move it into an owner folder, which is the `Worktrees/<owner>/<repo>` layout in use, so the
    // case-insensitive fallback scan is what has to find it.
    let owner_dir = plan.path.join("Worktrees").join("Ivy-Interactive");
    std::fs::create_dir_all(&owner_dir).expect("create owner dir");
    let nested = owner_dir.join(&repo_name);
    std::fs::rename(&worktree, &nested).expect("move worktree under owner dir");

    let outcome =
        remove_worktree(&plan.path, &repo_name.to_uppercase(), None).expect("remove nested");
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
