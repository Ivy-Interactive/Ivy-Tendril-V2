//! The stdout contract of `tendril plan env`.
//!
//! These assert exact output shapes, so they run the built binary as a child process and read its
//! stdout rather than calling the handler in-process. The child gets its own `TENDRIL_HOME` and
//! `TENDRIL_PLANS`, so an operator's ambient environment cannot leak into the fixture.

use std::path::{Path, PathBuf};
use std::process::Command;
use tendril_core::config::{get_config_path, load_config, save_config};
use tendril_core::models::{
    PlanStatus, PlanYaml, ProjectConfig, ProjectEnvFileConfig, ProjectPortConfig,
};
use tendril_core::plans::writer::write_plan_yaml;

const PROJECT: &str = "EnvCliProject";

/// A throwaway `TENDRIL_HOME`, removed on drop.
struct Fixture {
    home: PathBuf,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-cli-plan-env-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(home.starts_with(std::env::temp_dir()));
        std::fs::create_dir_all(home.join("Plans")).unwrap();
        Self { home }
    }

    fn plans_dir(&self) -> PathBuf {
        self.home.join("Plans")
    }

    /// Writes `config.yaml` with one project carrying the given ports and env files.
    fn write_project(&self, ports: &[(&str, u16)], env_files: Vec<ProjectEnvFileConfig>) {
        let path = get_config_path(&self.home);
        let mut settings = load_config(&path).unwrap();
        settings.projects.push(ProjectConfig {
            name: PROJECT.to_string(),
            color: "Blue".to_string(),
            ports: ports
                .iter()
                .map(|(name, default_port)| {
                    (
                        name.to_string(),
                        ProjectPortConfig {
                            default_port: *default_port,
                            description: String::new(),
                        },
                    )
                })
                .collect(),
            env_files,
            ..Default::default()
        });
        save_config(&path, &settings).unwrap();
    }

    /// Writes a plan folder listing `repos`, with `allocated_ports` already recorded.
    fn write_plan(&self, folder_name: &str, repos: &[&Path], allocated: &[(&str, u16)]) -> PathBuf {
        let plan = PlanYaml {
            state: PlanStatus::Executing.to_string(),
            project: PROJECT.to_string(),
            title: "Env CLI Plan".to_string(),
            repos: repos
                .iter()
                .map(|r| r.to_string_lossy().to_string())
                .collect(),
            allocated_ports: if allocated.is_empty() {
                None
            } else {
                Some(
                    allocated
                        .iter()
                        .map(|(name, port)| (name.to_string(), *port))
                        .collect(),
                )
            },
            ..Default::default()
        };

        let folder = self.plans_dir().join(folder_name);
        std::fs::create_dir_all(&folder).unwrap();
        write_plan_yaml(&folder, &plan).unwrap();
        folder
    }

    /// Creates the worktree directory `plan env` expects for `repo`, as `add-worktree` would.
    fn write_worktree(&self, plan_folder: &Path, repo: &Path) -> PathBuf {
        let worktree = plan_folder
            .join("Worktrees")
            .join(repo.file_name().unwrap());
        std::fs::create_dir_all(&worktree).unwrap();
        worktree
    }

    /// Runs the CLI with this fixture's home, returning (status success, stdout, stderr).
    fn run(&self, args: &[&str]) -> (bool, String, String) {
        let output = Command::new(env!("CARGO_BIN_EXE_tendril"))
            .arg("--home")
            .arg(&self.home)
            .args(args)
            .env("TENDRIL_PLANS", self.plans_dir())
            .env_remove("TENDRIL_CONFIG")
            .output()
            .expect("run tendril");

        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        )
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.home.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn env_file(
    path: &str,
    template: Option<&str>,
    overrides: &[(&str, &str)],
) -> ProjectEnvFileConfig {
    ProjectEnvFileConfig {
        path: path.to_string(),
        template: template.map(|t| t.to_string()),
        overrides: overrides
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    }
}

#[test]
fn plan_env_get_plain_output_shape() {
    let fixture = Fixture::new("get-plain");
    let repo = fixture.home.join("repos").join("widgets");
    std::fs::create_dir_all(&repo).unwrap();

    fixture.write_project(
        &[("backend", 3000), ("frontend", 5173)],
        vec![env_file(
            ".env",
            None,
            &[
                ("PORT", "${ports.backend}"),
                ("VITE_API_URL", "http://127.0.0.1:${ports.backend}"),
            ],
        )],
    );

    let plan_folder = fixture.write_plan(
        "00101-EnvGet",
        &[&repo],
        &[("backend", 31000), ("frontend", 31001)],
    );
    fixture.write_worktree(&plan_folder, &repo);

    let (ok, stdout, stderr) = fixture.run(&["plan", "env", "get", "00101"]);
    assert!(ok, "plan env get failed: {}{}", stdout, stderr);

    let lines: Vec<&str> = stdout.lines().collect();
    assert_eq!(lines[0], "Port\tValue", "the table header is tab separated");
    assert_eq!(lines[1], "backend\t31000");
    assert_eq!(lines[2], "frontend\t31001");
    assert_eq!(lines[3], ".env", "the env file path is its own line");
    assert_eq!(lines[4], "  PORT=31000", "values are indented two spaces");
    assert_eq!(lines[5], "  VITE_API_URL=http://127.0.0.1:31000");
    assert_eq!(lines.len(), 6, "no extra output: {:?}", lines);

    // A plan with nothing allocated says so rather than printing an empty table.
    let unallocated = fixture.write_plan("00102-NoPorts", &[&repo], &[]);
    fixture.write_worktree(&unallocated, &repo);
    let (ok, stdout, stderr) = fixture.run(&["plan", "env", "get", "00102"]);
    assert!(ok, "plan env get failed: {}{}", stdout, stderr);
    assert_eq!(
        stdout.lines().next(),
        Some("No ports allocated for this plan.")
    );

    // An env file that renders to nothing is reported, not silently skipped.
    let empty_fixture = Fixture::new("get-empty");
    empty_fixture.write_project(&[], vec![env_file(".env", Some(".env.example"), &[])]);
    let empty_plan = empty_fixture.write_plan("00103-Empty", &[], &[]);
    let _ = empty_plan;
    let (ok, stdout, stderr) = empty_fixture.run(&["plan", "env", "get", "00103"]);
    assert!(ok, "plan env get failed: {}{}", stdout, stderr);
    assert_eq!(
        stdout, "No ports allocated for this plan.\n.env\n  (empty)\n",
        "an env file with no values prints `  (empty)`"
    );
}

#[test]
fn plan_env_get_json_shape() {
    let fixture = Fixture::new("get-json");
    let repo = fixture.home.join("repos").join("widgets");
    std::fs::create_dir_all(&repo).unwrap();

    fixture.write_project(
        &[("backend", 3000)],
        vec![env_file(
            ".env",
            None,
            &[
                ("PORT", "${ports.backend}"),
                ("TOKEN", "${env.TENDRIL_TEST_UNSET_VAR}"),
            ],
        )],
    );

    let plan_folder = fixture.write_plan("00201-EnvJson", &[&repo], &[("backend", 31500)]);
    fixture.write_worktree(&plan_folder, &repo);

    let (ok, stdout, stderr) = fixture.run(&["plan", "env", "get", "00201", "--json"]);
    assert!(ok, "plan env get --json failed: {}{}", stdout, stderr);

    let doc: serde_json::Value = serde_json::from_str(&stdout).expect("stdout is JSON");
    assert_eq!(doc["planId"], "00201");
    assert_eq!(doc["project"], PROJECT);
    assert_eq!(doc["allocatedPorts"]["backend"], 31500);

    let files = doc["envFiles"].as_array().expect("envFiles is an array");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], ".env");
    assert_eq!(files[0]["values"]["PORT"], "31500");
    assert_eq!(
        files[0]["values"]["TOKEN"], "",
        "an unresolved secret is empty, never fabricated"
    );

    let missing = files[0]["missing"].as_array().expect("missing is an array");
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0]["key"], "TOKEN");
    assert_eq!(missing[0]["reference"], "${env.TENDRIL_TEST_UNSET_VAR}");
}

#[test]
fn plan_env_materialize_repo_filter() {
    let fixture = Fixture::new("materialize-filter");
    let checked_out = fixture.home.join("repos").join("widgets");
    let never_checked_out = fixture.home.join("repos").join("gadgets");
    std::fs::create_dir_all(&checked_out).unwrap();
    std::fs::create_dir_all(&never_checked_out).unwrap();

    fixture.write_project(
        &[("backend", 3000)],
        vec![env_file(".env", None, &[("PORT", "${ports.backend}")])],
    );

    let plan_folder = fixture.write_plan(
        "00301-EnvMaterialize",
        &[&checked_out, &never_checked_out],
        &[("backend", 31900)],
    );
    let worktree = fixture.write_worktree(&plan_folder, &checked_out);

    // A repo without a worktree is an error, not a silent no-op.
    let (ok, stdout, stderr) =
        fixture.run(&["plan", "env", "materialize", "00301", "--repo", "gadgets"]);
    assert!(!ok, "a missing worktree must exit non-zero: {}", stdout);
    assert!(
        stderr.contains("No worktree found for repo gadgets."),
        "stderr names the repo: {}",
        stderr
    );

    let (ok, stdout, stderr) =
        fixture.run(&["plan", "env", "materialize", "00301", "--repo", "widgets"]);
    assert!(ok, "materialize failed: {}{}", stdout, stderr);
    assert!(
        stdout.contains("Port backend: 31900"),
        "the allocated port is reported: {}",
        stdout
    );
    assert!(
        stdout.contains(&format!(
            "Materialized 1 environment file(s) into {} (0 unchanged, 0 skipped).",
            worktree.display()
        )),
        "the summary line names the worktree: {}",
        stdout
    );

    let written = std::fs::read_to_string(worktree.join(".env")).expect("read .env");
    assert!(written.ends_with("PORT=31900\n"), "{}", written);
    assert!(
        !plan_folder.join("Worktrees").join("gadgets").exists(),
        "only the targeted worktree is touched"
    );

    // A second run reports the file as unchanged.
    let (ok, stdout, stderr) =
        fixture.run(&["plan", "env", "materialize", "00301", "--repo", "widgets"]);
    assert!(ok, "second materialize failed: {}{}", stdout, stderr);
    assert!(
        stdout.contains("(1 unchanged, 0 skipped)"),
        "the second run is a no-op: {}",
        stdout
    );
}

/// `tendril plan get <id> allocatedports` is how the review UI and scripts read the assignments.
#[test]
fn plan_get_allocatedports_prints_name_equals_port() {
    let fixture = Fixture::new("get-allocatedports");
    fixture.write_project(&[("backend", 3000)], vec![]);
    fixture.write_plan("00401-Allocated", &[], &[("backend", 32100), ("db", 32101)]);

    let (ok, stdout, stderr) = fixture.run(&["plan", "get", "00401", "allocatedports"]);
    assert!(ok, "plan get allocatedports failed: {}{}", stdout, stderr);
    assert_eq!(stdout, "backend=32100\ndb=32101\n");

    fixture.write_plan("00402-None", &[], &[]);
    let (ok, stdout, stderr) = fixture.run(&["plan", "get", "00402", "allocatedports"]);
    assert!(ok, "plan get allocatedports failed: {}{}", stdout, stderr);
    assert_eq!(stdout, "", "a plan with no ports prints nothing");
}
