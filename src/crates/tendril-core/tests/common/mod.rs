//! Disposable fixtures for the orchestration tests.
//!
//! Every fixture lives under `std::env::temp_dir()` and is deleted when the test finishes. Nothing
//! here reads or writes the operator's real `~/.tendril`, and nothing here launches a real agent.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use tendril_core::models::{PlanStatus, PlanVerificationEntry, PlanYaml, VerificationStatus};
use tendril_core::plans::writer::write_plan_yaml;

/// A throwaway `TENDRIL_HOME`, removed on drop.
pub struct HomeFixture {
    pub path: PathBuf,
}

impl HomeFixture {
    pub fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert_under_temp_dir(&path);
        std::fs::create_dir_all(path.join("Plans")).expect("create fixture Plans dir");
        std::fs::create_dir_all(path.join("Logs").join("Jobs")).expect("create fixture Logs dir");
        Self { path }
    }

    pub fn plans_dir(&self) -> PathBuf {
        self.path.join("Plans")
    }

    /// Creates `Promptwares/<job_type>/Program.md` so the launch path finds a compilable promptware.
    pub fn write_promptware(&self, job_type: &str) -> PathBuf {
        let folder = self.path.join("Promptwares").join(job_type);
        std::fs::create_dir_all(&folder).expect("create promptware folder");
        std::fs::write(
            folder.join("Program.md"),
            format!("# {}\n\nDo the thing.\n", job_type),
        )
        .expect("write Program.md");
        folder
    }

    /// Writes a plan folder with the given verification rows and returns its path.
    pub fn write_plan(&self, folder_name: &str, plan: &PlanYaml) -> PathBuf {
        let folder = self.plans_dir().join(folder_name);
        std::fs::create_dir_all(&folder).expect("create plan folder");
        write_plan_yaml(&folder, plan).expect("write plan.yaml");
        folder
    }
}

impl Drop for HomeFixture {
    fn drop(&mut self) {
        assert_under_temp_dir(&self.path);
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Guards against a fixture path escaping the temp directory. Called before every fixture write and
/// before the recursive delete, so a bad path can never reach operator data.
pub fn assert_under_temp_dir(path: &Path) {
    let temp = std::env::temp_dir();
    assert!(
        path.starts_with(&temp),
        "fixture path {} is not under the temp dir {}",
        path.display(),
        temp.display()
    );
}

/// A plan in the given state with the given verification rows.
pub fn plan_with(state: PlanStatus, verifications: &[(&str, VerificationStatus)]) -> PlanYaml {
    PlanYaml {
        schema_version: 3,
        state: state.to_string(),
        project: "FixtureProject".to_string(),
        level: "Feature".to_string(),
        title: "Fixture Plan".to_string(),
        repos: vec![],
        created: chrono::Utc::now(),
        updated: chrono::Utc::now(),
        prs: vec![],
        commits: vec![],
        worktrees: None,
        verifications: verifications
            .iter()
            .map(|(name, status)| PlanVerificationEntry {
                name: (*name).to_string(),
                status: *status,
            })
            .collect(),
        related_plans: vec![],
        depends_on: vec![],
        priority: 0,
        partial_delivery: false,
        execution_profile: None,
        initial_prompt: None,
        source_url: None,
        recommendations: None,
        chat_session_id: None,
        allocated_ports: None,
        extra: std::collections::BTreeMap::new(),
    }
}

/// A disposable git repository with a bare `origin` beside it, removed on drop.
///
/// The worktree tests need a real repository: `git worktree add` cannot be faked, and the reaper's
/// branch-safety decisions are answers `git` gives about actual refs. Everything is local — no
/// network, no operator repo, no global git config — and identity plus signing are set per repo so
/// the commits work on a machine whose global config demands a GPG key.
pub struct GitRepoFixture {
    pub root: PathBuf,
    pub repo: PathBuf,
    pub origin: PathBuf,
}

impl GitRepoFixture {
    pub fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-repo-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert_under_temp_dir(&root);
        // Named after the label, not "repo": a worktree path is derived from the repo's directory
        // name, so two fixtures in one test must not share it.
        let repo = root.join(label);
        let origin = root.join("origin.git");
        std::fs::create_dir_all(&repo).expect("create fixture repo dir");
        std::fs::create_dir_all(&origin).expect("create fixture origin dir");

        let fixture = Self { root, repo, origin };

        fixture.git_in(&fixture.origin, &["init", "--bare", "-b", "main"]);

        fixture.git(&["init", "-b", "main"]);
        fixture.git(&["config", "user.email", "fixture@tendril.test"]);
        fixture.git(&["config", "user.name", "Tendril Fixture"]);
        fixture.git(&["config", "commit.gpgsign", "false"]);
        std::fs::write(fixture.repo.join("README.md"), "fixture\n").expect("write README");
        fixture.git(&["add", "."]);
        fixture.git(&["commit", "-m", "Initial commit"]);

        let origin_url = fixture.origin.to_string_lossy().to_string();
        fixture.git(&["remote", "add", "origin", &origin_url]);
        fixture.git(&["push", "-u", "origin", "main"]);

        fixture
    }

    /// Runs git in the working repo, asserting success.
    pub fn git(&self, args: &[&str]) -> String {
        self.git_in(&self.repo, args)
    }

    /// Runs git in an arbitrary directory of the fixture, asserting success.
    pub fn git_in(&self, dir: &Path, args: &[&str]) -> String {
        assert_under_temp_dir(dir);
        let (code, stdout, stderr) =
            tendril_core::git::service::run_git(args, dir).expect("run git");
        assert_eq!(code, 0, "git {:?} failed: {}{}", args, stdout, stderr);
        stdout
    }

    /// Commits a file on `branch`, creating the branch from the current HEAD if it is new.
    pub fn commit_on(&self, branch: &str, file: &str, content: &str) {
        if self.branch_exists(branch) {
            self.git(&["checkout", branch]);
        } else {
            self.git(&["checkout", "-b", branch]);
        }
        std::fs::write(self.repo.join(file), content).expect("write fixture file");
        self.git(&["add", file]);
        self.git(&["commit", "-m", &format!("Add {}", file)]);
    }

    /// Pushes `branch` to the bare origin.
    pub fn push(&self, branch: &str) {
        self.git(&["push", "origin", branch]);
    }

    pub fn branch_exists(&self, branch: &str) -> bool {
        let (code, _, _) = tendril_core::git::service::run_git(
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{}", branch),
            ],
            &self.repo,
        )
        .expect("run git rev-parse");
        code == 0
    }
}

impl Drop for GitRepoFixture {
    fn drop(&mut self) {
        assert_under_temp_dir(&self.root);
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// Whether a plan's `worktrees` registry records the given path.
pub fn worktree_registered(plan_folder: &Path, worktree_path: &Path) -> bool {
    let Ok((plan, _)) = tendril_core::plans::reader::read_plan_yaml(plan_folder) else {
        return false;
    };
    let target =
        std::fs::canonicalize(worktree_path).unwrap_or_else(|_| worktree_path.to_path_buf());
    plan.worktrees.unwrap_or_default().iter().any(|e| {
        let recorded = PathBuf::from(&e.path);
        std::fs::canonicalize(&recorded).unwrap_or(recorded) == target
    })
}

/// Writes a `Verification/<name>.md` report with YAML frontmatter.
pub fn write_verification_report(plan_folder: &Path, name: &str, body: &str) {
    let dir = plan_folder.join("Verification");
    std::fs::create_dir_all(&dir).expect("create Verification dir");
    std::fs::write(dir.join(format!("{}.md", name)), body).expect("write verification report");
}

/// Reads a plan's `state` field back from disk.
pub fn plan_state(plan_folder: &Path) -> String {
    tendril_core::plans::reader::read_plan_yaml(plan_folder)
        .expect("read plan.yaml")
        .0
        .state
}
