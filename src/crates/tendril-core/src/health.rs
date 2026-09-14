//! The health-check registry behind `tendril doctor` and the onboarding wizard.
//!
//! Every probe `tendril doctor` used to run inline lives here as a [`CheckResult`], so callers other
//! than the CLI printer can consume the same answers. [`run_checks`] is the doctor set, in the order
//! doctor prints it; [`run_prerequisite_checks`] is the "can this machine run Tendril at all" subset
//! the first-run wizard renders, which additionally probes each known coding-agent CLI.

use crate::config::{
    expand_variables, get_config_path, get_database_path, get_plans_dir, load_config, read_master,
};
use crate::db::{check_plan_search, get_last_sync_time, open_database, PlanSearchHealth};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

/// The name of the database check, which `handle_doctor` uses to place its `--rebuild-search-index`
/// note in the same position it has always printed.
pub const DATABASE_CHECK_NAME: &str = "Database";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

impl CheckStatus {
    /// The bracketed tag doctor prints in front of a check's message.
    pub fn tag(self) -> &'static str {
        match self {
            CheckStatus::Ok => "OK",
            CheckStatus::Warn => "WARN",
            CheckStatus::Fail => "FAIL",
        }
    }
}

/// Whether a check is about the machine (a tool that must be installed) or about this Tendril
/// installation (config, database, plans). The wizard only shows `Prerequisite` entries as
/// actionable; `Environment` entries are diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckCategory {
    Prerequisite,
    Environment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub name: String,
    pub status: CheckStatus,
    /// The line doctor prints, minus the `[OK]`/`[WARN]`/`[FAIL]` prefix.
    pub message: String,
    /// `false` means Tendril still works without it — the wizard must not block on those.
    pub required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_url: Option<String>,
    pub category: CheckCategory,
}

impl CheckResult {
    fn environment(name: &str, status: CheckStatus, message: String) -> Self {
        Self {
            name: name.to_string(),
            status,
            message,
            required: false,
            install_url: None,
            category: CheckCategory::Environment,
        }
    }

    fn prerequisite(
        name: &str,
        status: CheckStatus,
        message: String,
        required: bool,
        install_url: &str,
    ) -> Self {
        Self {
            name: name.to_string(),
            status,
            message,
            required,
            install_url: Some(install_url.to_string()),
            category: CheckCategory::Prerequisite,
        }
    }
}

/// Every check `tendril doctor` runs, in display order.
pub fn run_checks(tendril_home: &Path) -> Vec<CheckResult> {
    let mut checks = vec![CheckResult::environment(
        "Tendril Home",
        CheckStatus::Ok,
        format!("Tendril Home: {}", tendril_home.display()),
    )];

    checks.extend(config_checks(tendril_home));
    checks.extend(database_checks(tendril_home));

    let plans_dir = get_plans_dir(tendril_home);
    checks.push(if plans_dir.exists() {
        CheckResult::environment(
            "Plans directory",
            CheckStatus::Ok,
            format!("Plans directory: {}", plans_dir.display()),
        )
    } else {
        CheckResult::environment(
            "Plans directory",
            CheckStatus::Warn,
            format!("Plans directory not found: {}", plans_dir.display()),
        )
    });

    checks.push(server_check(tendril_home));
    checks.push(git_check());
    checks.push(github_cli_check());

    checks
}

/// The tools an operator needs on PATH: git, the GitHub CLI, and every coding-agent CLI Tendril
/// knows how to launch. Touches no config, database or plans directory, so the wizard can run it on
/// a machine that has no `TendrilHome` yet.
pub fn run_prerequisite_checks() -> Vec<CheckResult> {
    let mut checks = vec![git_check(), github_cli_check()];
    checks.extend(agent_checks());
    checks
}

/// One probe per coding-agent CLI. All of them report `Warn` when absent rather than `Fail`: only
/// the agent the operator actually selects matters, so a missing `gemini` is not a broken install.
pub fn agent_checks() -> Vec<CheckResult> {
    AGENT_PREREQUISITES
        .iter()
        .map(|agent| match probe_version(agent.command) {
            Some(version) => CheckResult::prerequisite(
                agent.label,
                CheckStatus::Ok,
                format!("{} installed: {}", agent.label, version),
                false,
                agent.install_url,
            ),
            None => CheckResult::prerequisite(
                agent.label,
                CheckStatus::Warn,
                format!(
                    "{} CLI ('{}') not found on PATH",
                    agent.label, agent.command
                ),
                false,
                agent.install_url,
            ),
        })
        .collect()
}

/// A coding-agent CLI the wizard can offer to install.
struct AgentPrerequisite {
    /// The catalog id from `crate::agents::catalog`, lowercased form of `label`.
    label: &'static str,
    /// The binary `crate::agents::providers::build_agent_spec` launches for this agent.
    command: &'static str,
    install_url: &'static str,
}

/// Mirrors `build_agent_spec`'s match arms and the `command` each one sets. Spelled out rather than
/// derived by calling `build_agent_spec`, because building a spec writes temp prompt files — a probe
/// must not have side effects.
const AGENT_PREREQUISITES: &[AgentPrerequisite] = &[
    AgentPrerequisite {
        label: "Claude",
        command: "claude",
        install_url: "https://claude.com/claude-code",
    },
    AgentPrerequisite {
        label: "Codex",
        command: "codex",
        install_url: "https://github.com/openai/codex",
    },
    AgentPrerequisite {
        label: "Gemini",
        command: "gemini",
        install_url: "https://github.com/google-gemini/gemini-cli",
    },
    AgentPrerequisite {
        label: "OpenCode",
        command: "opencode",
        install_url: "https://opencode.ai",
    },
    AgentPrerequisite {
        label: "Copilot",
        command: "copilot",
        install_url: "https://github.com/github/copilot-cli",
    },
    AgentPrerequisite {
        label: "Antigravity",
        command: "agy",
        install_url: "https://antigravity.google",
    },
];

/// What `.master` says the running server is, including which scheme it serves: a client that
/// guesses wrong gets a connection error rather than a redirect, so this is worth stating plainly.
fn server_check(tendril_home: &Path) -> CheckResult {
    match read_master(tendril_home) {
        Some(master) => {
            let note = if master.scheme.eq_ignore_ascii_case("https") {
                "TLS"
            } else {
                "plaintext; --tls-cert/--tls-key serves HTTPS"
            };
            CheckResult::environment(
                "Server",
                CheckStatus::Ok,
                format!(
                    "Server: {} (pid {}, {})",
                    master.base_url(),
                    master.pid,
                    note
                ),
            )
        }
        None => CheckResult::environment(
            "Server",
            CheckStatus::Ok,
            "Server: not running (no .master file)".to_string(),
        ),
    }
}

fn git_check() -> CheckResult {
    match probe_full_version("git") {
        Some(version) => CheckResult::prerequisite(
            "Git",
            CheckStatus::Ok,
            format!("Git installed: {}", version),
            true,
            "https://git-scm.com/downloads",
        ),
        None => CheckResult::prerequisite(
            "Git",
            CheckStatus::Fail,
            "Git not found on PATH".to_string(),
            true,
            "https://git-scm.com/downloads",
        ),
    }
}

fn github_cli_check() -> CheckResult {
    match probe_version("gh") {
        Some(version) => CheckResult::prerequisite(
            "GitHub CLI",
            CheckStatus::Ok,
            format!("GitHub CLI installed: {}", version),
            false,
            "https://cli.github.com",
        ),
        None => CheckResult::prerequisite(
            "GitHub CLI",
            CheckStatus::Warn,
            "GitHub CLI ('gh') not found on PATH".to_string(),
            false,
            "https://cli.github.com",
        ),
    }
}

/// First line of `<command> --version`, or `None` when the binary is not on PATH.
fn probe_version(command: &str) -> Option<String> {
    let out = std::process::Command::new(command)
        .arg("--version")
        .output()
        .ok()?;
    Some(
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .to_string(),
    )
}

/// Whole trimmed stdout of `<command> --version`. Git prints one line, and doctor has always
/// reported it this way.
fn probe_full_version(command: &str) -> Option<String> {
    let out = std::process::Command::new(command)
        .arg("--version")
        .output()
        .ok()?;
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn config_checks(tendril_home: &Path) -> Vec<CheckResult> {
    let cfg_path = get_config_path(tendril_home);
    if !cfg_path.exists() {
        return vec![CheckResult::environment(
            "Config file",
            CheckStatus::Warn,
            format!("Config file does not exist: {}", cfg_path.display()),
        )];
    }

    let settings = match load_config(&cfg_path) {
        Ok(settings) => settings,
        Err(e) => {
            return vec![CheckResult::environment(
                "Config file",
                CheckStatus::Fail,
                format!("Config file error: {}", e),
            )]
        }
    };

    let mut checks = vec![CheckResult::environment(
        "Config file",
        CheckStatus::Ok,
        format!("Config file valid: {}", cfg_path.display()),
    )];

    for project in &settings.projects {
        for v in &project.verifications {
            if !settings
                .verifications
                .iter()
                .any(|def| def.name.eq_ignore_ascii_case(&v.name))
            {
                checks.push(CheckResult::environment(
                    "Project configuration",
                    CheckStatus::Warn,
                    format!(
                        "Project '{}' references non-existent verification '{}'",
                        project.name, v.name
                    ),
                ));
            }
        }

        let mut expanded_repo_paths: HashSet<String> = HashSet::new();
        for r in &project.repos {
            expanded_repo_paths.insert(expand_variables(&r.path, &tendril_home.to_string_lossy()));
            if let Some(message) =
                repo_path_message(&project.name, "repository path", &r.path, tendril_home)
            {
                checks.push(CheckResult::environment(
                    "Project configuration",
                    CheckStatus::Warn,
                    message,
                ));
            }
        }

        for dep_path in &project.build_dependencies {
            let expanded_dep = expand_variables(dep_path, &tendril_home.to_string_lossy());
            if expanded_repo_paths.contains(&expanded_dep) {
                continue;
            }
            if let Some(message) = repo_path_message(
                &project.name,
                "build dependency path",
                dep_path,
                tendril_home,
            ) {
                checks.push(CheckResult::environment(
                    "Project configuration",
                    CheckStatus::Warn,
                    message,
                ));
            }
        }
    }

    checks
}

fn database_checks(tendril_home: &Path) -> Vec<CheckResult> {
    let db_path = get_database_path(tendril_home);
    let conn = match open_database(&db_path) {
        Ok(conn) => conn,
        Err(e) => {
            return vec![CheckResult::environment(
                DATABASE_CHECK_NAME,
                CheckStatus::Fail,
                format!("Database error: {}", e),
            )]
        }
    };

    let mut checks = vec![CheckResult::environment(
        DATABASE_CHECK_NAME,
        CheckStatus::Ok,
        format!("Database accessible and migrated: {}", db_path.display()),
    )];

    match check_plan_search(&conn) {
        Ok(health) => {
            let last_sync = get_last_sync_time(&conn).unwrap_or(None);
            checks.extend(plan_search_checks(&health, last_sync));
        }
        Err(e) => checks.push(CheckResult::environment(
            "Plan search index",
            CheckStatus::Fail,
            format!("Could not inspect plan search index: {}", e),
        )),
    }

    checks
}

/// The plan-search and sync-bookkeeping checks. Split out so they can be exercised without a live
/// `TendrilHome`, the way [`repo_path_warning`] already is.
pub fn plan_search_checks(
    health: &PlanSearchHealth,
    last_sync: Option<DateTime<Utc>>,
) -> Vec<CheckResult> {
    let mut checks = Vec::new();

    if health.index_present {
        checks.push(CheckResult::environment(
            "Plan search index",
            CheckStatus::Ok,
            "Plan search index present".to_string(),
        ));
    } else {
        checks.push(CheckResult::environment(
            "Plan search index",
            CheckStatus::Warn,
            "Plan search index missing (run: tendril doctor --rebuild-search-index)".to_string(),
        ));
    }

    if !health.missing_triggers.is_empty() {
        checks.push(CheckResult::environment(
            "Plan search triggers",
            CheckStatus::Warn,
            format!(
                "Plan search triggers missing: {} (run: tendril doctor --rebuild-search-index)",
                health.missing_triggers.join(", ")
            ),
        ));
    }

    if health.index_present {
        if health.integrity_ok {
            checks.push(CheckResult::environment(
                "Plan search integrity",
                CheckStatus::Ok,
                "Plan search index integrity verified".to_string(),
            ));
        } else {
            checks.push(CheckResult::environment(
                "Plan search integrity",
                CheckStatus::Warn,
                "Plan search index corrupt (run: tendril doctor --rebuild-search-index)"
                    .to_string(),
            ));
        }
    }

    checks.push(match last_sync {
        Some(time) => CheckResult::environment(
            "Plan sync",
            CheckStatus::Ok,
            format!("Last plan sync: {}", time.to_rfc3339()),
        ),
        None => CheckResult::environment(
            "Plan sync",
            CheckStatus::Warn,
            "Plans have never been synced".to_string(),
        ),
    });

    checks
}

#[derive(Debug, PartialEq, Eq)]
pub enum RepoPathStatus {
    Missing,
    NotADirectory,
    NotAGitRepo,
    Ok,
}

pub fn classify_repo_path(path: &Path) -> RepoPathStatus {
    if !path.exists() {
        return RepoPathStatus::Missing;
    }
    if !path.is_dir() {
        return RepoPathStatus::NotADirectory;
    }
    if path.join(".git").exists() {
        return RepoPathStatus::Ok;
    }
    if path.join("HEAD").is_file() && path.join("objects").is_dir() && path.join("refs").is_dir() {
        return RepoPathStatus::Ok;
    }
    RepoPathStatus::NotAGitRepo
}

/// The warning text for a bad repo path, without the `[WARN] ` prefix.
fn repo_path_message(
    project_name: &str,
    kind: &str,
    raw_path: &str,
    tendril_home: &Path,
) -> Option<String> {
    let expanded = expand_variables(raw_path, &tendril_home.to_string_lossy());
    let resolved_suffix = if expanded != raw_path {
        format!(" (resolved: {})", expanded)
    } else {
        String::new()
    };
    match classify_repo_path(Path::new(&expanded)) {
        RepoPathStatus::Missing => Some(format!(
            "Project '{}' {} does not exist: {}{}",
            project_name, kind, raw_path, resolved_suffix
        )),
        RepoPathStatus::NotADirectory => Some(format!(
            "Project '{}' {} is not a directory: {}{}",
            project_name, kind, raw_path, resolved_suffix
        )),
        RepoPathStatus::NotAGitRepo => Some(format!(
            "Project '{}' {} is not a git repository (no .git found): {}{}",
            project_name, kind, raw_path, resolved_suffix
        )),
        RepoPathStatus::Ok => None,
    }
}

/// The full `[WARN] …` line for a bad repo path, as doctor prints it.
pub fn repo_path_warning(
    project_name: &str,
    kind: &str,
    raw_path: &str,
    tendril_home: &Path,
) -> Option<String> {
    repo_path_message(project_name, kind, raw_path, tendril_home)
        .map(|message| format!("[{}] {}", CheckStatus::Warn.tag(), message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::rebuild_search_index;

    /// Checks rendered the way doctor prints them, so the migrated assertions below can stay
    /// line-for-line what they were when this code lived in `tendril-cli`.
    fn render(checks: &[CheckResult]) -> Vec<String> {
        checks
            .iter()
            .map(|c| format!("[{}] {}", c.status.tag(), c.message))
            .collect()
    }

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn registry_contains_required_git_check() {
        let checks = run_prerequisite_checks();
        let git = checks
            .iter()
            .find(|c| c.name == "Git")
            .expect("Git is always registered");

        assert!(git.required, "Tendril cannot work without git");
        assert_eq!(git.category, CheckCategory::Prerequisite);
        assert_eq!(
            git.install_url.as_deref(),
            Some("https://git-scm.com/downloads")
        );
        // The test machine has git, so this doubles as a probe smoke test.
        assert_eq!(git.status, CheckStatus::Ok);
        assert!(git.message.starts_with("Git installed: git version"));
    }

    #[test]
    fn gh_check_is_optional() {
        let checks = run_prerequisite_checks();
        let gh = checks
            .iter()
            .find(|c| c.name == "GitHub CLI")
            .expect("the GitHub CLI is always registered");

        assert!(!gh.required, "gh is optional; only some flows need it");
        assert!(gh.status != CheckStatus::Fail, "a missing gh only warns");
        assert_eq!(gh.install_url.as_deref(), Some("https://cli.github.com"));
    }

    #[test]
    fn every_agent_cli_is_probed_and_optional() {
        let checks = agent_checks();
        assert_eq!(checks.len(), AGENT_PREREQUISITES.len());

        for check in &checks {
            assert_eq!(check.category, CheckCategory::Prerequisite);
            assert!(
                !check.required,
                "{} must be optional: only the selected agent matters",
                check.name
            );
            assert!(
                check.status != CheckStatus::Fail,
                "{} must warn rather than fail when absent",
                check.name
            );
            assert!(check.install_url.is_some());
        }

        // The wizard matches a check back to a catalog id by lowercasing the name.
        let names: Vec<String> = checks.iter().map(|c| c.name.to_lowercase()).collect();
        for id in [
            "claude",
            "codex",
            "gemini",
            "opencode",
            "copilot",
            "antigravity",
        ] {
            assert!(names.contains(&id.to_string()), "{} is not probed", id);
        }
    }

    #[test]
    fn run_checks_reports_a_missing_config_and_plans_directory() {
        let home = scratch_dir("tendril-health-empty-home");
        let checks = run_checks(&home);

        let lines = render(&checks);
        assert!(lines[0].starts_with("[OK] Tendril Home: "));
        assert!(lines
            .iter()
            .any(|l| l.starts_with("[WARN] Config file does not exist: ")));
        // Whether the plans directory exists depends on the ambient TENDRIL_PLANS, which
        // `get_plans_dir` honours — so only the line's presence is asserted, not its status.
        assert!(lines.iter().any(|l| l.contains("Plans directory")));
        assert!(lines.iter().any(|l| l.starts_with("[OK] Git installed: ")));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn classify_repo_path_missing() {
        let dir = scratch_dir("tendril-doctor-classify-missing");
        let missing = dir.join("does-not-exist");
        assert_eq!(classify_repo_path(&missing), RepoPathStatus::Missing);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_not_a_directory() {
        let dir = scratch_dir("tendril-doctor-classify-file");
        let file_path = dir.join("some-file.txt");
        std::fs::write(&file_path, "not a repo").unwrap();
        assert_eq!(
            classify_repo_path(&file_path),
            RepoPathStatus::NotADirectory
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_not_a_git_repo() {
        let dir = scratch_dir("tendril-doctor-classify-empty");
        assert_eq!(classify_repo_path(&dir), RepoPathStatus::NotAGitRepo);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_ok_for_git_dir() {
        let dir = scratch_dir("tendril-doctor-classify-git-dir");
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        assert_eq!(classify_repo_path(&dir), RepoPathStatus::Ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_ok_for_git_file() {
        let dir = scratch_dir("tendril-doctor-classify-git-file");
        std::fs::write(dir.join(".git"), "gitdir: /somewhere/else").unwrap();
        assert_eq!(classify_repo_path(&dir), RepoPathStatus::Ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_ok_for_bare_repo() {
        let dir = scratch_dir("tendril-doctor-classify-bare");
        std::fs::write(dir.join("HEAD"), "ref: refs/heads/main").unwrap();
        std::fs::create_dir_all(dir.join("objects")).unwrap();
        std::fs::create_dir_all(dir.join("refs")).unwrap();
        assert_eq!(classify_repo_path(&dir), RepoPathStatus::Ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn repo_path_warning_none_for_valid_repo() {
        let dir = scratch_dir("tendril-doctor-warning-valid");
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        let tendril_home = scratch_dir("tendril-doctor-warning-valid-home");
        assert_eq!(
            repo_path_warning(
                "Proj",
                "repository path",
                &dir.to_string_lossy(),
                &tendril_home
            ),
            None
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&tendril_home);
    }

    #[test]
    fn repo_path_warning_missing_build_dependency() {
        let tendril_home = scratch_dir("tendril-doctor-warning-missing-home");
        let missing = tendril_home.join("does-not-exist");
        let warning = repo_path_warning(
            "Proj",
            "build dependency path",
            &missing.to_string_lossy(),
            &tendril_home,
        )
        .expect("expected a warning");
        assert!(warning.contains("build dependency path"));
        assert!(warning.contains("does not exist"));
        let _ = std::fs::remove_dir_all(&tendril_home);
    }

    #[test]
    fn repo_path_warning_non_git_build_dependency() {
        let dir = scratch_dir("tendril-doctor-warning-non-git");
        let tendril_home = scratch_dir("tendril-doctor-warning-non-git-home");
        let warning = repo_path_warning(
            "Proj",
            "build dependency path",
            &dir.to_string_lossy(),
            &tendril_home,
        )
        .expect("expected a warning");
        assert!(warning.contains("is not a git repository"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&tendril_home);
    }

    #[test]
    fn repo_path_warning_keeps_repository_wording() {
        let tendril_home = scratch_dir("tendril-doctor-warning-wording-home");
        let missing = tendril_home.join("does-not-exist");
        let warning = repo_path_warning(
            "Proj",
            "repository path",
            &missing.to_string_lossy(),
            &tendril_home,
        )
        .expect("expected a warning");
        assert_eq!(
            warning,
            format!(
                "[WARN] Project 'Proj' repository path does not exist: {}",
                missing.to_string_lossy()
            )
        );
        let _ = std::fs::remove_dir_all(&tendril_home);
    }

    fn healthy() -> PlanSearchHealth {
        PlanSearchHealth {
            index_present: true,
            missing_triggers: vec![],
            integrity_ok: true,
        }
    }

    #[test]
    fn plan_search_checks_report_a_healthy_index() {
        let synced = Utc::now();
        let lines = render(&plan_search_checks(&healthy(), Some(synced)));

        assert!(lines.iter().any(|l| l == "[OK] Plan search index present"));
        assert!(lines
            .iter()
            .any(|l| l == "[OK] Plan search index integrity verified"));
        assert!(lines
            .iter()
            .any(|l| l == &format!("[OK] Last plan sync: {}", synced.to_rfc3339())));
        assert!(
            !lines.iter().any(|l| l.starts_with("[WARN]")),
            "a healthy index warns about nothing: {:?}",
            lines
        );
    }

    #[test]
    fn plan_search_checks_warn_when_index_is_missing() {
        let health = PlanSearchHealth {
            index_present: false,
            missing_triggers: vec!["plans_fts_update".to_string()],
            integrity_ok: false,
        };
        let lines = render(&plan_search_checks(&health, None));

        assert!(lines
            .iter()
            .any(|l| l.starts_with("[WARN] Plan search index missing")));
        assert!(lines
            .iter()
            .any(|l| l.contains("Plan search triggers missing: plans_fts_update")));
        assert!(lines
            .iter()
            .any(|l| l == "[WARN] Plans have never been synced"));
        // An absent index cannot be integrity-checked, so there is nothing to say about it.
        assert!(!lines.iter().any(|l| l.contains("integrity")));
    }

    #[test]
    fn plan_search_checks_warn_when_index_is_corrupt() {
        let health = PlanSearchHealth {
            index_present: true,
            missing_triggers: vec![],
            integrity_ok: false,
        };
        let lines = render(&plan_search_checks(&health, Some(Utc::now())));

        assert!(lines.iter().any(|l| l == "[OK] Plan search index present"));
        assert!(lines
            .iter()
            .any(|l| l.starts_with("[WARN] Plan search index corrupt")));
    }

    #[test]
    fn plan_search_checks_run_against_a_real_database() {
        let dir = scratch_dir("tendril-doctor-search-db");
        let conn = open_database(&dir.join("tendril.db")).expect("open database");

        // The rebuild is what `--rebuild-search-index` calls; an empty Plans table indexes nothing.
        assert_eq!(rebuild_search_index(&conn).expect("rebuild index"), 0);

        let health = check_plan_search(&conn).expect("inspect index");
        assert!(health.index_present);
        assert!(health.missing_triggers.is_empty());
        assert!(health.integrity_ok);

        let lines = render(&plan_search_checks(
            &health,
            get_last_sync_time(&conn).expect("read sync time"),
        ));
        assert!(lines.iter().any(|l| l == "[OK] Plan search index present"));
        assert!(lines
            .iter()
            .any(|l| l == "[WARN] Plans have never been synced"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
