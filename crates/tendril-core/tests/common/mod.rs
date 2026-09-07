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
    }
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
