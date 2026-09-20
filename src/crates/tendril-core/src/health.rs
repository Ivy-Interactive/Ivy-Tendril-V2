//! The health-check registry behind `tendril doctor` and the onboarding wizard.
//!
//! Every probe `tendril doctor` used to run inline lives here as a [`CheckResult`], so callers other
//! than the CLI printer can consume the same answers. [`run_checks`] is the doctor set, in the order
//! doctor prints it; [`run_prerequisite_checks`] is the "can this machine run Tendril at all" subset
//! the first-run wizard renders, which additionally probes each known coding-agent CLI.

use crate::agents::model_cache::{self, CacheFreshness};
use crate::agents::model_specs;
use crate::agents::providers::agent_command;
use crate::agents::resolution::{default_profiles, normalize_agent_name};
use crate::config::{
    expand_config_path, expand_variables, get_config_path, get_database_path, get_plans_dir,
    load_config, MasterFileKind, TendrilSettings,
};
use crate::db::{check_plan_search, get_last_sync_time, open_database, PlanSearchHealth};
use crate::git::{
    classify_path_budget, derive_worktree_relative_path, worst_case_worktree_root_len,
    PathBudgetVerdict, MAX_WORKTREE_ROOT_LEN,
};
use crate::promptware::{
    configured_overlay_root, overlay_promptware_names, read_provenance, resolve_overlay,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

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

/// Every check `tendril doctor` runs, in display order: home, environment overrides, config,
/// overlay, server, installation, software (git/gh), agents and models, database, plans
/// directory, path budget. Path budget runs last because it is the longest section and depends
/// on the plans-directory line printed just above it.
pub fn run_checks(tendril_home: &Path) -> Vec<CheckResult> {
    let mut checks = vec![CheckResult::environment(
        "Tendril Home",
        CheckStatus::Ok,
        format!("Tendril Home: {}", tendril_home.display()),
    )];

    checks.extend(environment_override_checks());

    let settings = load_config(&get_config_path(tendril_home)).unwrap_or_default();
    checks.extend(config_checks(tendril_home));
    checks.extend(overlay_checks(tendril_home, &settings));
    checks.push(server_check(tendril_home));

    checks.extend(installation_checks());

    checks.push(git_check());
    checks.extend(co_author_check(&settings));
    checks.extend(github_cli_checks());

    let (mut catalog_checks, catalog_is_static) = model_catalog_checks(tendril_home, &settings);
    checks.append(&mut catalog_checks);
    checks.extend(agent_model_checks(&settings, catalog_is_static));

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

    if plans_dir.exists() {
        checks.extend(path_budget_checks(
            &plans_dir,
            &plan_folder_names(&plans_dir),
            &configured_repo_rel_paths(&settings, tendril_home),
        ));
    }

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
        .map(
            |agent| match probe_version_with_arg(agent.command, agent.version_arg) {
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
            },
        )
        .collect()
}

/// The prerequisite row for a catalog agent id, matched the way the wizard matches one: by
/// lowercasing the label. `None` for an agent that has no row, such as the bundled `ivy`.
fn prerequisite_for(agent: &str) -> Option<&'static AgentPrerequisite> {
    AGENT_PREREQUISITES
        .iter()
        .find(|p| p.label.to_lowercase() == agent)
}

/// A coding-agent CLI the wizard can offer to install.
struct AgentPrerequisite {
    /// The catalog id from `crate::agents::catalog`, lowercased form of `label`.
    label: &'static str,
    /// The binary `crate::agents::providers::build_agent_spec` launches for this agent, or, for an
    /// agent launched through another CLI, the one that is distinctively its own prerequisite.
    command: &'static str,
    /// The argument that makes `command` report its presence. Almost every CLI answers
    /// `--version`; one that does not names the subcommand that stands in for it.
    version_arg: &'static str,
    install_url: &'static str,
}

/// Mirrors `build_agent_spec`'s match arms and the `command` each one sets. Spelled out rather than
/// derived by calling `build_agent_spec`, because building a spec writes temp prompt files — a probe
/// must not have side effects.
const AGENT_PREREQUISITES: &[AgentPrerequisite] = &[
    AgentPrerequisite {
        label: "Claude",
        command: "claude",
        version_arg: "--version",
        install_url: "https://claude.com/claude-code",
    },
    AgentPrerequisite {
        label: "Codex",
        command: "codex",
        version_arg: "--version",
        install_url: "https://github.com/openai/codex",
    },
    AgentPrerequisite {
        label: "Gemini",
        command: "gemini",
        version_arg: "--version",
        install_url: "https://github.com/google-gemini/gemini-cli",
    },
    AgentPrerequisite {
        label: "OpenCode",
        command: "opencode",
        version_arg: "--version",
        install_url: "https://opencode.ai",
    },
    AgentPrerequisite {
        label: "Copilot",
        command: "copilot",
        version_arg: "--version",
        install_url: "https://github.com/github/copilot-cli",
    },
    AgentPrerequisite {
        label: "Antigravity",
        command: "agy",
        version_arg: "--version",
        install_url: "https://antigravity.google",
    },
    // Apple runs through the OpenCode CLI, which is probed on its own row above. What is distinctly
    // Apple's is `fm`, and it rejects `--version` outright, so presence is probed with `available` —
    // the subcommand that reports whether the on-device model can be used on this machine.
    AgentPrerequisite {
        label: "Apple",
        command: "fm",
        version_arg: "available",
        install_url: "https://developer.apple.com/documentation/foundationmodels",
    },
];

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

/// The one version floor this codebase asserts, and it only applies to an install that has opted in.
///
/// `coAuthor` attribution works by handing a spawned agent `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
/// `GIT_CONFIG_VALUE_n`, which git only honours from 2.31 (2021). An older git ignores them silently:
/// commits would simply come out unattributed, with nothing anywhere saying why. Reported here rather
/// than failing a job, because a missing trailer must never be the reason a plan does not run.
///
/// Nothing is reported when the feature is off, which is why this returns a `Vec` — `doctor` should
/// not grow a line for a setting the operator has not touched.
fn co_author_check(settings: &TendrilSettings) -> Vec<CheckResult> {
    co_author_check_with(settings, || probe_full_version("git"))
}

/// Split from [`co_author_check`] so the version arm can be tested without an old git on the box —
/// there is no way to install git 2.30 in CI to prove the warning fires.
fn co_author_check_with(
    settings: &TendrilSettings,
    probe: impl FnOnce() -> Option<String>,
) -> Vec<CheckResult> {
    if settings.co_author_identity().is_none() {
        return Vec::new();
    }

    // `git version 2.54.0 (Apple Git-157)` — the third whitespace-separated token, then major.minor.
    let parsed = probe()
        .and_then(|v| v.split_whitespace().nth(2).map(str::to_string))
        .and_then(|v| {
            let mut parts = v.split('.');
            let major: u32 = parts.next()?.parse().ok()?;
            let minor: u32 = parts.next()?.parse().ok()?;
            Some((major, minor))
        });

    let check = match parsed {
        Some((major, minor)) if (major, minor) >= (2, 31) => CheckResult::prerequisite(
            "Git (coAuthor)",
            CheckStatus::Ok,
            format!(
                "Git {major}.{minor} supports GIT_CONFIG_COUNT; coAuthor attribution is active"
            ),
            false,
            "https://git-scm.com/downloads",
        ),
        Some((major, minor)) => CheckResult::prerequisite(
            "Git (coAuthor)",
            CheckStatus::Warn,
            format!(
                "coAuthor is configured but Git {major}.{minor} predates GIT_CONFIG_COUNT (2.31); \
                 commits will not carry the Co-Authored-By trailer"
            ),
            false,
            "https://git-scm.com/downloads",
        ),
        // An unparseable `git --version` is not evidence of an old git, and `git_check` above already
        // reports a git that is missing outright.
        None => return Vec::new(),
    };

    vec![check]
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

/// [`github_cli_check`] plus, when `gh` is installed, whether it is authenticated — a `gh`
/// present but logged out fails the same PR-creation flows a missing `gh` would.
fn github_cli_checks() -> Vec<CheckResult> {
    let gh = github_cli_check();
    let installed = gh.status != CheckStatus::Warn;
    let mut checks = vec![gh];

    if installed {
        let authenticated = std::process::Command::new("gh")
            .args(["auth", "status", "--active"])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);

        checks.push(if authenticated {
            CheckResult::environment(
                "GitHub CLI auth",
                CheckStatus::Ok,
                "GitHub CLI authenticated".to_string(),
            )
        } else {
            CheckResult::environment(
                "GitHub CLI auth",
                CheckStatus::Fail,
                "GitHub CLI installed but not authenticated — run 'gh auth login'".to_string(),
            )
        });
    }

    checks
}

/// First line of `<command> --version`, or `None` when the binary is not on PATH.
fn probe_version(command: &str) -> Option<String> {
    probe_version_with_arg(command, "--version")
}

/// First line of `<command> <arg>`, or `None` when the binary is not on PATH.
///
/// A non-zero exit is still a present binary, so only a failure to spawn reports absent. A CLI that
/// rejects the argument prints nothing to stdout, which reads as present with an unknown version --
/// hence `version_arg`, so each agent is asked in a way it answers.
fn probe_version_with_arg(command: &str, arg: &str) -> Option<String> {
    let out = std::process::Command::new(command).arg(arg).output().ok()?;
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

/// The env vars `crate::config` honours that silently change where Tendril looks, reported right
/// after Tendril Home so an operator sees them before wondering why a path doesn't match what
/// `config.yaml` says. Prints nothing for a variable that isn't set — the defaults are already
/// implied by the Tendril Home line above.
fn environment_override_checks() -> Vec<CheckResult> {
    let mut checks = Vec::new();

    if let Ok(val) = std::env::var("TENDRIL_HOME") {
        checks.push(CheckResult::environment(
            "Environment overrides",
            CheckStatus::Ok,
            format!("TENDRIL_HOME is set: {}", val),
        ));
    }
    if let Ok(val) = std::env::var("TENDRIL_CONFIG") {
        checks.push(CheckResult::environment(
            "Environment overrides",
            CheckStatus::Ok,
            format!("TENDRIL_CONFIG is set: {}", val),
        ));
    }
    if let Ok(val) = std::env::var("TENDRIL_PLANS") {
        checks.push(CheckResult::environment(
            "Environment overrides",
            CheckStatus::Warn,
            format!(
                "TENDRIL_PLANS is set: {} — this overrides plansFolder from config.yaml",
                val
            ),
        ));
    }

    checks
}

/// Which build of `tendril` is actually running, whether the `tendril` an operator would invoke on
/// PATH resolves to that same build, and whether the legacy .NET tool is still installed alongside
/// it. Pure over its inputs (see [`installation_checks`] for the real-environment probes) so tests
/// drive every branch without touching the real PATH.
fn installation_lines(
    current_exe: Option<&Path>,
    path_hit: Option<&Path>,
    legacy_tool: Option<&str>,
) -> Vec<CheckResult> {
    let mut checks = vec![CheckResult::environment(
        "Installation",
        CheckStatus::Ok,
        format!("Version: tendril v{}", env!("CARGO_PKG_VERSION")),
    )];

    if let Some(exe) = current_exe {
        checks.push(CheckResult::environment(
            "Installation",
            CheckStatus::Ok,
            format!("Executable: {}", exe.display()),
        ));
    }

    checks.push(match (current_exe, path_hit) {
        (_, None) => CheckResult::environment(
            "Installation",
            CheckStatus::Warn,
            "tendril not found on PATH".to_string(),
        ),
        (Some(exe), Some(hit)) if exe == hit => CheckResult::environment(
            "Installation",
            CheckStatus::Ok,
            format!("tendril on PATH: {}", hit.display()),
        ),
        (Some(exe), Some(hit)) => CheckResult::environment(
            "Installation",
            CheckStatus::Warn,
            format!(
                "tendril on PATH resolves elsewhere: {} (running: {}) — the CLI you invoke is not this build",
                hit.display(),
                exe.display()
            ),
        ),
        (None, Some(hit)) => CheckResult::environment(
            "Installation",
            CheckStatus::Ok,
            format!("tendril on PATH: {}", hit.display()),
        ),
    });

    if let Some(version) = legacy_tool {
        checks.push(CheckResult::environment(
            "Installation",
            CheckStatus::Warn,
            format!(
                "Legacy .NET tool installed: Ivy.Tendril {} — run 'dotnet tool uninstall --global Ivy.Tendril'",
                version
            ),
        ));
    }

    checks
}

fn installation_checks() -> Vec<CheckResult> {
    let current_exe = std::env::current_exe().ok();
    let path_hit = which_tendril();
    let legacy_tool = legacy_dotnet_tool_version();
    installation_lines(
        current_exe.as_deref(),
        path_hit.as_deref(),
        legacy_tool.as_deref(),
    )
}

/// `which tendril` on Unix, `where.exe tendril` on Windows — first line of stdout, or `None` when
/// `tendril` is not on PATH at all.
fn which_tendril() -> Option<PathBuf> {
    let (cmd, arg) = if cfg!(windows) {
        ("where.exe", "tendril")
    } else {
        ("which", "tendril")
    };
    let out = std::process::Command::new(cmd).arg(arg).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let first_line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if first_line.is_empty() {
        None
    } else {
        Some(PathBuf::from(first_line))
    }
}

/// `dotnet tool list --global`, matched case-insensitively for `ivy.tendril`. `None` when `dotnet`
/// is missing or the tool isn't installed — a machine without `dotnet` should not be nagged.
fn legacy_dotnet_tool_version() -> Option<String> {
    let out = std::process::Command::new("dotnet")
        .args(["tool", "list", "--global"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let mut parts = line.split_whitespace();
        let Some(package) = parts.next() else {
            continue;
        };
        if package.eq_ignore_ascii_case("ivy.tendril") {
            return parts.next().map(|v| v.to_string());
        }
    }
    None
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
            expanded_repo_paths.insert(
                expand_config_path(&r.path, tendril_home)
                    .to_string_lossy()
                    .to_string(),
            );
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
            let expanded_dep = expand_config_path(dep_path, tendril_home)
                .to_string_lossy()
                .to_string();
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

/// What `.master` says the running server is, including which scheme it serves: a client that
/// guesses wrong gets a connection error rather than a redirect, so this is worth stating plainly.
///
/// A file that is present but unreadable is its own answer, and not "not running": nothing deletes it
/// on a guess any more (see [`crate::config::inspect_master_file`]), so `doctor` is where an operator
/// finds out it is there and that a daemon is refusing to start because of it.
fn server_check(tendril_home: &Path) -> CheckResult {
    match crate::config::inspect_master_file(tendril_home) {
        MasterFileKind::Claim(claim) => {
            let master = claim.info;
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
        MasterFileKind::Missing => CheckResult::environment(
            "Server",
            CheckStatus::Ok,
            "Server: not running (no .master file)".to_string(),
        ),
        MasterFileKind::Garbage => CheckResult::environment(
            "Server",
            CheckStatus::Warn,
            format!(
                "Server: {}/.master is not a JSON document — a daemon starting here will discard it",
                tendril_home.display()
            ),
        ),
        MasterFileKind::Foreign { schema_version } => CheckResult::environment(
            "Server",
            CheckStatus::Warn,
            format!(
                "Server: {}/.master was written by a Tendril this build does not understand (schema \
                 version {}, this build writes {}). It is left untouched, and a daemon will refuse to \
                 start on this home until it is gone.",
                tendril_home.display(),
                schema_version
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "unmarked".to_string()),
                crate::config::MASTER_SCHEMA_VERSION
            ),
        ),
    }
}

/// Reports where the promptware overlay is, whether it resolves, and whether what is deployed still
/// matches it. A configured-but-missing overlay is the failure mode the original mechanism could not
/// report at all: it had no notion of an overlay path, only a git-tracked deploy target.
pub fn overlay_checks(tendril_home: &Path, settings: &TendrilSettings) -> Vec<CheckResult> {
    let Some(configured) = configured_overlay_root(tendril_home, settings) else {
        return vec![CheckResult::environment(
            "Promptware overlay",
            CheckStatus::Ok,
            "Promptware overlay: not configured".to_string(),
        )];
    };

    let Some(overlay) = resolve_overlay(tendril_home, settings) else {
        return vec![CheckResult::environment(
            "Promptware overlay",
            CheckStatus::Warn,
            format!(
                "Promptware overlay configured but not found: {}",
                configured.display()
            ),
        )];
    };

    let overridden = overlay_promptware_names(&overlay.root).len();
    let mut detail = Vec::new();
    if let Some(version) = &overlay.version {
        detail.push(format!(".version {}", version));
    }
    detail.push(format!(
        "{} promptware{} overridden",
        overridden,
        if overridden == 1 { "" } else { "s" }
    ));

    let mut checks = vec![CheckResult::environment(
        "Promptware overlay",
        CheckStatus::Ok,
        format!(
            "Promptware overlay: {} ({})",
            overlay.root.display(),
            detail.join(", ")
        ),
    )];

    match read_provenance(&tendril_home.join("Promptwares")) {
        None => checks.push(CheckResult::environment(
            "Promptware overlay deploy status",
            CheckStatus::Warn,
            "Promptware overlay has not been deployed yet — run 'tendril promptware deploy'"
                .to_string(),
        )),
        Some(deployed) if deployed.overlay_root.as_deref() != Some(overlay.root.as_path()) => {
            checks.push(CheckResult::environment(
                "Promptware overlay deploy status",
                CheckStatus::Warn,
                format!(
                    "Promptware overlay root changed (deployed {}, configured {}) — run 'tendril promptware deploy'",
                    deployed
                        .overlay_root
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "none".to_string()),
                    overlay.root.display()
                ),
            ));
        }
        Some(deployed) if deployed.overlay_version != overlay.version => {
            checks.push(CheckResult::environment(
                "Promptware overlay deploy status",
                CheckStatus::Warn,
                format!(
                    "Promptware overlay is stale (deployed .version {}, overlay .version {}) — run 'tendril promptware deploy'",
                    deployed.overlay_version.as_deref().unwrap_or("none"),
                    overlay.version.as_deref().unwrap_or("none")
                ),
            ));
        }
        Some(_) => {}
    }

    checks
}

/// Age in whole days rendered the way an operator reads it, matching `models.rs`'s own wording.
fn format_age(age_days: Option<i64>) -> String {
    match age_days {
        Some(0) => "today".to_string(),
        Some(1) => "1 day ago".to_string(),
        Some(d) => format!("{d} days ago"),
        None => "an unknown age".to_string(),
    }
}

/// Loads the on-disk models.dev cache and registers it as `model_specs`'s dynamic catalog, mirroring
/// the bootstrap `tendril models` runs — minus the network fetch, since doctor must stay offline.
/// The returned `bool` is whether model resolution fell back to the static catalog (no cache, unreadable
/// cache, or a cache past `modelCacheMaxAgeDays`), which downgrades an unresolved model from `Fail` to
/// `Warn` in [`agent_model_checks`]: the model may just be missing from a stale catalog, not actually
/// wrong.
fn model_catalog_checks(
    tendril_home: &Path,
    settings: &TendrilSettings,
) -> (Vec<CheckResult>, bool) {
    let catalog = match model_cache::load_disk_cache(tendril_home) {
        Ok(catalog) if !catalog.is_empty() => catalog,
        _ => {
            return (
                vec![CheckResult::environment(
                    "Model catalog",
                    CheckStatus::Warn,
                    "Model catalog: static ModelSpecs fallback (no models.dev cache yet) — run 'tendril models --refresh'".to_string(),
                )],
                true,
            );
        }
    };

    let count = catalog.specs.len();
    match model_cache::classify(
        &catalog,
        settings.model_cache_warn_age_days,
        settings.model_cache_max_age_days,
    ) {
        CacheFreshness::Fresh { age_days } => {
            model_specs::register_dynamic_specs(catalog.specs);
            (
                vec![CheckResult::environment(
                    "Model catalog",
                    CheckStatus::Ok,
                    format!(
                        "Model catalog: models.dev cache ({} models, fetched {})",
                        count,
                        format_age(age_days)
                    ),
                )],
                false,
            )
        }
        CacheFreshness::Stale { age_days } => {
            model_specs::register_dynamic_specs(catalog.specs);
            (
                vec![CheckResult::environment(
                    "Model catalog",
                    CheckStatus::Warn,
                    format!(
                        "Model catalog: cache is {} — run 'tendril models --refresh'",
                        format_age(age_days)
                    ),
                )],
                false,
            )
        }
        CacheFreshness::Expired { age_days } => (
            vec![CheckResult::environment(
                "Model catalog",
                CheckStatus::Warn,
                format!(
                    "Model catalog: static ModelSpecs fallback (models.dev cache ignored: {} old) — run 'tendril models --refresh'",
                    format_age(age_days)
                ),
            )],
            true,
        ),
    }
}

/// The models to check for `agent`: its configured profiles' models (skipping blanks and the
/// literal `default`), or — when it has no configured profiles at all — the built-in
/// `deep`/`balanced`/`quick` tier defaults. Returns `(profile or tier name, model id)` pairs.
fn configured_or_default_models(settings: &TendrilSettings, agent: &str) -> Vec<(String, String)> {
    let configured: Vec<(String, String)> = settings
        .coding_agents
        .iter()
        .filter(|a| normalize_agent_name(&a.name) == agent)
        .flat_map(|a| a.profiles.iter())
        .filter(|p| !p.model.is_empty() && p.model != "default")
        .map(|p| (p.name.clone(), p.model.clone()))
        .collect();

    if !configured.is_empty() {
        return configured;
    }

    default_profiles(agent)
        .into_iter()
        .filter_map(|tier| tier.model.map(|m| (tier.tier.to_string(), m.to_string())))
        .collect()
}

/// The binary doctor probes for an agent, and the argument that binary answers.
///
/// Not `agent_command` alone: that reports the binary the launch execs, which for an agent that
/// wraps another CLI is the wrapper. Apple runs through OpenCode, so `agent_command` returns the
/// OpenCode binary -- which answers `--version` happily on a machine with no `fm` installed at
/// all, and doctor would call the install healthy at exactly the moment it is not. The
/// prerequisite row names the binary that is distinctly this agent's, and the argument that
/// binary actually answers, so the wizard and doctor probe the same thing.
///
/// Agents with no row, such as the bundled `ivy`, keep the launch binary and the conventional
/// `--version`.
fn doctor_probe_target(agent: &str) -> (String, &'static str) {
    match prerequisite_for(agent) {
        Some(prereq) => (prereq.command.to_string(), prereq.version_arg),
        None => (agent_command(agent), "--version"),
    }
}

/// One probe per configured coding agent: whether its CLI is installed, and whether every model it
/// is configured (or defaulted) to use resolves in the model catalog. Model resolution is a pure
/// catalog lookup, never a shell-out to the agent, so this stays synchronous and offline.
fn agent_model_checks(settings: &TendrilSettings, catalog_is_static: bool) -> Vec<CheckResult> {
    agent_model_checks_with(settings, catalog_is_static, |command, version_arg| {
        probe_version_with_arg(command, version_arg).is_some()
    })
}

/// [`agent_model_checks`] with the "is this CLI installed" probe supplied by the caller.
///
/// Split out for the tests. The model-catalog half of this function is pure, but it is only reached
/// for an agent whose CLI is on PATH — so asserting on it through the real probe asserts that the
/// machine running the suite happens to have `claude` installed, which CI does not. The tests pass a
/// fixed answer and get to exercise the logic they are actually about.
///
/// The probe takes the version argument as well as the command, because [`doctor_probe_target`]
/// picks both per agent: a CLI that rejects the argument prints nothing and reads as an unknown
/// version, so asking `fm` for `--version` when it answers `--help` would report a working install
/// as broken.
fn agent_model_checks_with(
    settings: &TendrilSettings,
    catalog_is_static: bool,
    is_installed: impl Fn(&str, &str) -> bool,
) -> Vec<CheckResult> {
    let active = normalize_agent_name(&settings.coding_agent);
    let mut agents: Vec<(String, bool)> = vec![(active, true)];
    for a in &settings.coding_agents {
        let name = normalize_agent_name(&a.name);
        if !agents.iter().any(|(n, _)| *n == name) {
            agents.push((name, false));
        }
    }

    let mut checks = Vec::new();

    for (agent, is_active) in &agents {
        let label = if *is_active {
            format!("{} (active)", agent)
        } else {
            agent.clone()
        };
        let (command, version_arg) = doctor_probe_target(agent);

        if !is_installed(&command, version_arg) {
            checks.push(CheckResult::environment(
                "Agent models",
                if *is_active {
                    CheckStatus::Fail
                } else {
                    CheckStatus::Warn
                },
                format!("{}: CLI '{}' not found on PATH", label, command),
            ));
            // An unresolvable model on an uninstalled agent is noise; legacy skipped it too.
            continue;
        }

        for (profile_name, model) in configured_or_default_models(settings, agent) {
            match model_specs::find(&model) {
                Some(spec) => {
                    let matched = if spec.model_id.as_ref() != model {
                        format!(" (matched {})", spec.model_id)
                    } else {
                        String::new()
                    };
                    checks.push(CheckResult::environment(
                        "Agent models",
                        CheckStatus::Ok,
                        format!("{} {}: {}{}", label, profile_name, model, matched),
                    ));
                }
                None => {
                    let status = if catalog_is_static {
                        CheckStatus::Warn
                    } else {
                        CheckStatus::Fail
                    };
                    checks.push(CheckResult::environment(
                        "Agent models",
                        status,
                        format!(
                            "{} {}: model '{}' is not in the model catalog — fix codingAgents.{}.profiles.{}.model in config.yaml, or run 'tendril models --refresh' if it is a new model",
                            label, profile_name, model, agent, profile_name
                        ),
                    ));
                }
            }
        }
    }

    checks
}

/// Existing plan folder names under `plans_root` — directory entries whose first 5 characters are
/// all ASCII digits, matching [`crate::plans::helpers::allocate_plan_id`]'s numbering.
fn plan_folder_names(plans_root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(plans_root) else {
        return Vec::new();
    };

    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
        .filter(|name| name.len() >= 5 && name.as_bytes()[..5].iter().all(|b| b.is_ascii_digit()))
        .collect();
    // `read_dir` yields whatever order the filesystem happens to hand back - APFS returns these
    // sorted, ext4 does not - and `path_budget_checks` names the longest folder via `max_by_key`,
    // which keeps the *last* of equally long names. Without an order that tie would resolve
    // differently per machine and the doctor output would not reproduce.
    names.sort();
    names
}

/// The relative path segment a worktree would use for every repo and build-dependency path
/// configured across all projects, expanded and deduplicated. Mirrors
/// [`crate::git::derive_worktree_relative_path`] exactly, since that is what actually determines a
/// worktree's path length.
fn configured_repo_rel_paths(settings: &TendrilSettings, tendril_home: &Path) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut names = Vec::new();

    let push_unique = |raw_path: &str, seen: &mut HashSet<String>, names: &mut Vec<String>| {
        let expanded = expand_config_path(raw_path, tendril_home);
        let name = derive_worktree_relative_path(&expanded);
        if seen.insert(name.clone()) {
            names.push(name);
        }
    };

    for project in &settings.projects {
        for r in &project.repos {
            push_unique(&r.path, &mut seen, &mut names);
        }
        for dep_path in &project.build_dependencies {
            push_unique(dep_path, &mut seen, &mut names);
        }
    }

    names
}

/// Reports whether the worst-case worktree root — `<plans root>/<longest plan folder>/Worktrees/
/// <longest configured repo>` — stays under the Windows path-creation budget. Pure over its inputs
/// so tests can drive every branch with literals instead of building a plans directory on disk.
/// `Over` is a hard `[FAIL]` only on Windows, where the budget actually bites; elsewhere it is a
/// `[WARN]` naming Windows as the reason, since a long path is harmless on macOS/Linux.
fn path_budget_checks(
    plans_root: &Path,
    plan_folder_names: &[String],
    repo_rel_paths: &[String],
) -> Vec<CheckResult> {
    let plans_root_len = plans_root.to_string_lossy().len();
    let mut checks = vec![CheckResult::environment(
        "Path budget",
        CheckStatus::Ok,
        format!(
            "Plans root: {} ({} chars)",
            plans_root.display(),
            plans_root_len
        ),
    )];

    let longest_repo = repo_rel_paths.iter().max_by_key(|p| p.len());
    checks.push(match longest_repo {
        Some(name) => CheckResult::environment(
            "Path budget",
            CheckStatus::Ok,
            format!(
                "Longest configured repo path segment: {} ({} chars)",
                name,
                name.len()
            ),
        ),
        None => CheckResult::environment(
            "Path budget",
            CheckStatus::Warn,
            "Longest configured repo path segment: none — no repos configured".to_string(),
        ),
    });

    let longest_folder = plan_folder_names.iter().max_by_key(|f| f.len());
    if let Some(folder) = longest_folder {
        checks.push(CheckResult::environment(
            "Path budget",
            CheckStatus::Ok,
            format!(
                "Longest existing plan folder: {} ({} chars)",
                folder,
                folder.len()
            ),
        ));
    }

    let repo_len = longest_repo.map(|s| s.len()).unwrap_or(0);
    let folder_len = longest_folder.map(|s| s.len()).unwrap_or(0);
    let worst_case = worst_case_worktree_root_len(plans_root_len, folder_len, repo_len);
    let headroom = MAX_WORKTREE_ROOT_LEN as i64 - worst_case as i64;
    let remediation = "shorten plansFolder, or give plans shorter titles — the worktree root must stay under 95 chars for Windows process creation";

    checks.push(match classify_path_budget(worst_case) {
        PathBudgetVerdict::Ok => CheckResult::environment(
            "Path budget",
            CheckStatus::Ok,
            format!(
                "Worst-case worktree root: {} chars (budget {}, headroom {})",
                worst_case, MAX_WORKTREE_ROOT_LEN, headroom
            ),
        ),
        PathBudgetVerdict::Tight => CheckResult::environment(
            "Path budget",
            CheckStatus::Warn,
            format!(
                "Worst-case worktree root: {} chars (budget {}, headroom {}) — {}",
                worst_case, MAX_WORKTREE_ROOT_LEN, headroom, remediation
            ),
        ),
        PathBudgetVerdict::Over if cfg!(windows) => CheckResult::environment(
            "Path budget",
            CheckStatus::Fail,
            format!(
                "Worst-case worktree root: {} chars (budget {}, headroom {}) — {}",
                worst_case, MAX_WORKTREE_ROOT_LEN, headroom, remediation
            ),
        ),
        PathBudgetVerdict::Over => CheckResult::environment(
            "Path budget",
            CheckStatus::Warn,
            format!(
                "Worst-case worktree root: {} chars (budget {}, headroom {}) (Windows path budget) — {}",
                worst_case, MAX_WORKTREE_ROOT_LEN, headroom, remediation
            ),
        ),
    });

    let over_budget: Vec<&String> = plan_folder_names
        .iter()
        .filter(|f| {
            worst_case_worktree_root_len(plans_root_len, f.len(), repo_len) > MAX_WORKTREE_ROOT_LEN
        })
        .collect();

    checks.push(if over_budget.is_empty() {
        CheckResult::environment(
            "Path budget",
            CheckStatus::Ok,
            format!(
                "Plan folders over the {}-char budget: None",
                MAX_WORKTREE_ROOT_LEN
            ),
        )
    } else {
        let longest = over_budget.iter().max_by_key(|f| f.len()).unwrap();
        CheckResult::environment(
            "Path budget",
            CheckStatus::Warn,
            format!(
                "Plan folders over the {}-char budget: {} (longest: {} at {} chars)",
                MAX_WORKTREE_ROOT_LEN,
                over_budget.len(),
                longest,
                longest.len()
            ),
        )
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
    // Anchored the same way every consumer anchors it, so the diagnostic describes the directory
    // that will actually be used. Reporting against the process cwd would make this check pass in
    // the shell the user ran it from and fail in the daemon, which is the opposite of useful.
    let resolved = expand_config_path(raw_path, tendril_home);
    let expanded = resolved.to_string_lossy().to_string();
    let resolved_suffix = if expanded != raw_path {
        format!(" (resolved: {})", expanded)
    } else {
        String::new()
    };

    // A relative path is worth its own message even when it happens to resolve: it resolves to a
    // different directory on every surface, so "it works in the CLI" says nothing about the app.
    if !raw_path.trim().is_empty()
        && !Path::new(&expand_variables(raw_path, &tendril_home.to_string_lossy())).is_absolute()
    {
        return Some(format!(
            "Project '{}' {} is relative: {}. It has been anchored to {}, but a relative path means something different in every process that reads this config -- write it absolute, or with %TENDRIL_HOME%.",
            project_name, kind, raw_path, expanded
        ));
    }

    match classify_repo_path(&resolved) {
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

    /// `doctor` is where an operator learns that a `.master` nothing will delete is what is stopping a
    /// daemon from starting. "Not running" would be the wrong report, and it is what this used to say
    /// for any file it could not parse.
    #[test]
    fn the_server_check_names_a_master_file_it_cannot_read() {
        let home = scratch_dir("tendril-doctor-master");

        assert_eq!(server_check(&home).status, CheckStatus::Ok);
        assert!(server_check(&home).message.contains("not running"));

        std::fs::write(home.join(".master"), r#"{"schemaVersion":99}"#).unwrap();
        let foreign = server_check(&home);
        assert_eq!(foreign.status, CheckStatus::Warn);
        assert!(
            foreign.message.contains("does not understand") && foreign.message.contains("99"),
            "got: {}",
            foreign.message
        );

        std::fs::write(home.join(".master"), "").unwrap();
        let garbage = server_check(&home);
        assert_eq!(garbage.status, CheckStatus::Warn);
        assert!(
            garbage.message.contains("not a JSON document"),
            "got: {}",
            garbage.message
        );

        crate::config::write_master(&home, 5010, "s", "127.0.0.1", "https").unwrap();
        let claim = server_check(&home);
        assert_eq!(claim.status, CheckStatus::Ok);
        assert!(claim.message.contains("https://127.0.0.1:5010"));

        let _ = std::fs::remove_dir_all(home);
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
            "apple",
        ] {
            assert!(names.contains(&id.to_string()), "{} is not probed", id);
        }
    }

    /// A CLI that rejects its probe argument prints nothing to stdout, so the probe reads as
    /// "present, version unknown" and the check still passes -- which means reverting an agent's
    /// `version_arg` to `--version` would not fail any assertion about statuses or row counts. It
    /// would just quietly stop reporting a version. Asserting the text each agent actually answers
    /// with is what makes that regression visible, so the probe argument is only exercised on a
    /// machine where the binary is installed; elsewhere there is nothing to assert and it skips.
    #[test]
    fn each_agent_is_probed_with_an_argument_it_answers() {
        for agent in AGENT_PREREQUISITES {
            let Some(version) = probe_version_with_arg(agent.command, agent.version_arg) else {
                continue; // Not installed on this machine: the absent case is covered above.
            };

            assert!(
                !version.trim().is_empty(),
                "'{} {}' printed nothing to stdout, so {} reports as installed with no version -- \
                 the probe argument is one this CLI does not answer",
                agent.command,
                agent.version_arg,
                agent.label
            );
        }
    }

    /// `build_agent_spec` matches on a `&str` with a catch-all arm, so an agent added to the catalog
    /// but forgotten here would not fail to compile: it would quietly report no install status at
    /// all, and its onboarding card would sit blank. Deriving the expectation from the catalog is
    /// what turns that into a test failure the moment the next agent is added.
    /// An agent that wraps another CLI launches the wrapper, so `agent_command` reports the
    /// wrapper and a probe built on it passes on a machine that is missing the agent's own
    /// prerequisite entirely. Apple is the case in hand: it execs OpenCode, so probing the launch
    /// binary answers `1.17.x` whether or not `fm` exists, and doctor would call a broken install
    /// healthy. Asserting that doctor probes the prerequisite binary, rather than the launch one,
    /// is what keeps that hole closed; the second half pins the argument too, since probing the
    /// right binary with an argument it rejects reads as "present, version unknown" and passes
    /// just as wrongly.
    #[test]
    fn doctor_probes_each_agents_own_prerequisite_not_the_binary_it_launches() {
        for prereq in AGENT_PREREQUISITES {
            let agent = prereq.label.to_lowercase();
            let (command, version_arg) = doctor_probe_target(&agent);

            assert_eq!(
                command, prereq.command,
                "doctor probes '{}' for {}, but its prerequisite is '{}' -- on a machine without \
                 that binary the check would pass anyway",
                command, prereq.label, prereq.command
            );
            assert_eq!(
                version_arg, prereq.version_arg,
                "doctor probes '{}' with '{}' while the wizard uses '{}' -- an argument the CLI \
                 rejects prints nothing and reads as installed",
                command, version_arg, prereq.version_arg
            );
        }
    }

    /// The wrapper case is only a hole when the two binaries actually differ, so this pins that
    /// apple is still that case. If OpenCode ever stops being apple's launch binary this test
    /// fails and the guard above becomes a tautology worth revisiting rather than silently
    /// asserting nothing.
    #[test]
    fn apples_launch_binary_is_not_its_prerequisite_binary() {
        let launched = agent_command("apple");
        let (probed, _) = doctor_probe_target("apple");

        assert_ne!(
            std::path::Path::new(&launched).file_name(),
            std::path::Path::new(&probed).file_name(),
            "apple's launch binary and prerequisite binary are now the same, so doctor can no \
             longer confuse them"
        );
        assert_eq!(probed, "fm");
    }

    #[test]
    fn every_catalog_agent_has_a_prerequisite_row() {
        // Two deliberate omissions, both for the same reason: they are the bundled OpenCode under
        // a different base URL rather than a third-party CLI, so there is nothing for the user to
        // install and the wizard offers no card. `ivy` no longer launches its own `ivy-agent`
        // binary, and `openaiproxy` never did. Anything else reaching this list is an agent whose
        // install status silently went missing.
        const NO_PREREQUISITE: &[&str] = &["ivy", "openaiproxy"];

        let probed: Vec<String> = AGENT_PREREQUISITES
            .iter()
            .map(|a| a.label.to_lowercase())
            .collect();

        for agent in crate::agents::catalog::all_agents() {
            if NO_PREREQUISITE.contains(&agent.id.as_str()) {
                continue;
            }
            assert!(
                probed.contains(&agent.id.to_lowercase()),
                "catalog agent '{}' has no AGENT_PREREQUISITES row, so it reports no install status",
                agent.id
            );
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

    /// A `TENDRIL_HOME` plus an overlay root beside it, so overlay wording can be asserted without a
    /// live installation.
    struct OverlayFixture {
        root: std::path::PathBuf,
        home: std::path::PathBuf,
        overlay: std::path::PathBuf,
    }

    impl OverlayFixture {
        fn new() -> Self {
            let root = scratch_dir("tendril-doctor-overlay");
            let home = root.join("home");
            let overlay = root.join("team").join("Promptwares");
            std::fs::create_dir_all(&home).unwrap();
            std::fs::create_dir_all(overlay.join("CreatePlan")).unwrap();
            std::fs::write(overlay.join("CreatePlan").join("Program.md"), "team plan").unwrap();
            OverlayFixture {
                root,
                home,
                overlay,
            }
        }

        fn settings(&self, overlay: Option<&std::path::Path>) -> TendrilSettings {
            TendrilSettings {
                promptware_overlay: overlay.map(|p| p.to_string_lossy().to_string()),
                ..Default::default()
            }
        }

        /// Deploys into the fixture's home so `read_provenance` has something to compare against.
        fn deploy(&self, overlay: Option<&crate::promptware::OverlayLayer>) {
            let shipped = self.root.join("shipped");
            std::fs::create_dir_all(shipped.join("CreatePlan")).unwrap();
            std::fs::write(shipped.join("CreatePlan").join("Program.md"), "shipped").unwrap();
            crate::promptware::deploy_promptwares(
                &self.home.join("Promptwares"),
                crate::promptware::DeployOptions {
                    shipped_root: Some(&shipped),
                    overlay,
                },
            )
            .unwrap();
        }
    }

    impl Drop for OverlayFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn overlay_checks_report_not_configured() {
        let fx = OverlayFixture::new();

        let lines = render(&overlay_checks(&fx.home, &fx.settings(None)));

        assert_eq!(lines, vec!["[OK] Promptware overlay: not configured"]);
    }

    #[test]
    fn overlay_checks_warn_when_configured_but_missing() {
        let fx = OverlayFixture::new();
        let missing = fx.root.join("does-not-exist");

        let lines = render(&overlay_checks(&fx.home, &fx.settings(Some(&missing))));

        assert_eq!(
            lines,
            vec![format!(
                "[WARN] Promptware overlay configured but not found: {}",
                missing.display()
            )]
        );
    }

    #[test]
    fn overlay_checks_report_a_healthy_overlay() {
        let fx = OverlayFixture::new();
        std::fs::write(fx.overlay.join(".version"), "1.0.45\n").unwrap();
        let settings = fx.settings(Some(&fx.overlay));
        let overlay = resolve_overlay(&fx.home, &settings).unwrap();
        fx.deploy(Some(&overlay));

        let lines = render(&overlay_checks(&fx.home, &settings));

        assert_eq!(
            lines,
            vec![format!(
                "[OK] Promptware overlay: {} (.version 1.0.45, 1 promptware overridden)",
                fx.overlay.display()
            )]
        );
    }

    #[test]
    fn overlay_checks_warn_when_never_deployed() {
        let fx = OverlayFixture::new();
        let settings = fx.settings(Some(&fx.overlay));

        let lines = render(&overlay_checks(&fx.home, &settings));

        assert!(lines[0].starts_with("[OK] Promptware overlay:"));
        assert_eq!(
            lines[1],
            "[WARN] Promptware overlay has not been deployed yet — run 'tendril promptware deploy'"
        );
    }

    #[test]
    fn overlay_checks_warn_when_stale() {
        let fx = OverlayFixture::new();
        std::fs::write(fx.overlay.join(".version"), "1.0.44").unwrap();
        let settings = fx.settings(Some(&fx.overlay));
        fx.deploy(Some(&resolve_overlay(&fx.home, &settings).unwrap()));

        // The team bumps its revision; nothing has re-deployed yet.
        std::fs::write(fx.overlay.join(".version"), "1.0.45").unwrap();

        let lines = render(&overlay_checks(&fx.home, &settings));

        assert_eq!(
            lines[1],
            "[WARN] Promptware overlay is stale (deployed .version 1.0.44, overlay .version 1.0.45) — run 'tendril promptware deploy'"
        );
    }

    #[test]
    fn overlay_checks_warn_when_the_root_changed() {
        let fx = OverlayFixture::new();
        let settings = fx.settings(Some(&fx.overlay));
        // Deployed shipped-only, then an overlay was configured.
        fx.deploy(None);

        let lines = render(&overlay_checks(&fx.home, &settings));

        assert_eq!(
            lines[1],
            format!(
                "[WARN] Promptware overlay root changed (deployed none, configured {}) — run 'tendril promptware deploy'",
                fx.overlay.display()
            )
        );
    }

    #[test]
    fn path_budget_lines_reports_headroom_when_inside_budget() {
        let plans_root = Path::new("/Users/rory/.tendril/Plans");
        let checks = path_budget_checks(
            plans_root,
            &["00632-AddPathBudget".to_string()],
            &["Ivy-Tendril-V2".to_string()],
        );
        let lines = render(&checks);

        assert!(lines[0].starts_with("[OK] Plans root:"));
        assert!(lines[1].starts_with("[OK] Longest configured repo path segment: Ivy-Tendril-V2"));
        assert!(lines[2].starts_with("[OK] Longest existing plan folder:"));
        assert!(lines[3].starts_with("[OK] Worst-case worktree root:"));
        assert!(lines[3].contains("headroom"));
        assert_eq!(lines[4], "[OK] Plan folders over the 95-char budget: None");
    }

    #[test]
    fn path_budget_lines_flags_over_budget_root() {
        // A plans root alone this long already exceeds the 95-char budget once the plan folder,
        // `Worktrees`, and a repo name are appended.
        let plans_root = Path::new("/Users/rory/some/very/deeply/nested/tendril/home/directory/that/is/quite/long/.tendril/Plans");
        let folder = "00632-AddPathBudgetAndAgentModelDoctorChecks".to_string();
        let checks = path_budget_checks(plans_root, &[folder], &["Ivy-Tendril-V2".to_string()]);
        let lines = render(&checks);

        let worst_case_line = &lines[3];
        if cfg!(windows) {
            assert!(worst_case_line.starts_with("[FAIL] Worst-case worktree root:"));
        } else {
            assert!(worst_case_line.starts_with("[WARN] Worst-case worktree root:"));
            assert!(worst_case_line.contains("Windows path budget"));
        }
    }

    #[test]
    fn path_budget_lines_warns_with_no_repos() {
        let plans_root = Path::new("/Users/rory/.tendril/Plans");
        let checks = path_budget_checks(plans_root, &["00632-Plan".to_string()], &[]);
        let lines = render(&checks);

        assert_eq!(
            lines[1],
            "[WARN] Longest configured repo path segment: none — no repos configured"
        );
    }

    #[test]
    fn path_budget_lines_counts_folders_over_budget() {
        let plans_root = Path::new("/Users/rory/some/very/deeply/nested/tendril/home/directory/that/is/quite/long/.tendril/Plans");
        let folders = vec![
            "00001-Short".to_string(),
            "00632-AddPathBudgetAndAgentModelDoctorChecksWithAVeryLongTitleIndeed".to_string(),
        ];
        let checks = path_budget_checks(plans_root, &folders, &["Ivy-Tendril-V2".to_string()]);
        let lines = render(&checks);

        let over_line = lines.last().unwrap();
        assert!(over_line.starts_with("[WARN] Plan folders over the 95-char budget: "));
        assert!(!over_line.contains(": None"));
    }

    fn agent_settings(agent: &str, model: &str) -> TendrilSettings {
        TendrilSettings {
            coding_agent: agent.to_string(),
            coding_agents: vec![crate::config::AgentConfig {
                name: agent.to_string(),
                profiles: vec![crate::config::AgentProfileConfig {
                    name: "deep".to_string(),
                    model: model.to_string(),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn agent_model_lines_ok_for_builtin_defaults() {
        let settings = TendrilSettings {
            coding_agent: "claude".to_string(),
            ..Default::default()
        };

        // Installed, always: the subject is whether the built-in default models resolve in the
        // catalog, and running the real probe would instead assert that whoever runs the suite has
        // `claude` on PATH. CI does not, and used to fail here with a single "not found" line.
        let checks = agent_model_checks_with(&settings, false, |_, _| true);
        let lines = render(&checks);

        assert!(
            lines
                .iter()
                .any(|l| l.starts_with("[OK]") && l.contains("(active)")),
            "expected at least one OK line for the active agent's default models, got {:?}",
            lines
        );
    }

    #[test]
    fn agent_model_lines_flags_unknown_model() {
        let settings = agent_settings("claude", "not-a-real-model-id");

        let checks = agent_model_checks_with(&settings, false, |_, _| true);
        let lines = render(&checks);

        assert!(
            lines
                .iter()
                .any(|l| l.starts_with("[FAIL]") && l.contains("not-a-real-model-id")),
            "expected a FAIL line for the unresolvable model, got {:?}",
            lines
        );
    }

    #[test]
    fn agent_model_lines_marks_active_agent() {
        let settings = agent_settings("claude", "opus");

        let checks = agent_model_checks_with(&settings, false, |_, _| true);
        let lines = render(&checks);

        assert!(lines.iter().any(|l| l.contains("claude (active)")));
    }

    /// The other side of the probe, which CI was exercising by accident.
    ///
    /// A machine without the agent installed gets one line per agent and no model lines at all —
    /// `FAIL` for the active agent, `WARN` for the rest, because an unresolvable model on an agent
    /// you are not using is noise. This is pinned so the fixed-`true` probe in the tests above
    /// cannot quietly become the only behaviour under test.
    #[test]
    fn agent_model_lines_stop_at_the_cli_when_it_is_not_installed() {
        let mut settings = agent_settings("claude", "not-a-real-model-id");
        settings.coding_agents.push(crate::config::AgentConfig {
            name: "codex".to_string(),
            ..Default::default()
        });

        let checks = agent_model_checks_with(&settings, false, |_, _| false);
        let lines = render(&checks);

        assert_eq!(
            lines,
            vec![
                "[FAIL] claude (active): CLI 'claude' not found on PATH".to_string(),
                "[WARN] codex: CLI 'codex' not found on PATH".to_string(),
            ]
        );
    }

    #[test]
    fn installation_lines_warns_when_path_differs() {
        let current = PathBuf::from("/opt/tendril/bin/tendril");
        let on_path = PathBuf::from("/usr/local/bin/tendril");

        let checks = installation_lines(Some(&current), Some(&on_path), None);
        let lines = render(&checks);

        assert!(lines
            .iter()
            .any(|l| l.starts_with("[WARN]") && l.contains("tendril on PATH resolves elsewhere")));
    }

    #[test]
    fn installation_lines_ok_when_path_matches() {
        let current = PathBuf::from("/usr/local/bin/tendril");

        let checks = installation_lines(Some(&current), Some(&current), None);
        let lines = render(&checks);

        assert!(lines
            .iter()
            .any(|l| l.starts_with("[OK]") && l.contains("tendril on PATH:")));
    }

    #[test]
    fn installation_lines_warns_on_legacy_tool() {
        let current = PathBuf::from("/usr/local/bin/tendril");

        let checks = installation_lines(Some(&current), Some(&current), Some("1.0.99"));
        let lines = render(&checks);

        assert!(lines.iter().any(|l| l.starts_with("[WARN]")
            && l.contains("Legacy .NET tool")
            && l.contains("1.0.99")));
    }

    fn settings_with_co_author(value: Option<&str>) -> TendrilSettings {
        TendrilSettings {
            co_author: value.map(str::to_string),
            ..Default::default()
        }
    }

    /// An operator who has not touched `coAuthor` must not gain a doctor line about it. This is the
    /// same "unconfigured is byte-identical to today" rule the feature is built on, applied to output.
    #[test]
    fn co_author_check_is_silent_when_the_feature_is_off() {
        assert!(co_author_check_with(&settings_with_co_author(None), || {
            panic!("git must not even be probed when coAuthor is unset")
        })
        .is_empty());

        // Blank is "off" too, per `co_author_identity`.
        assert!(
            co_author_check_with(&settings_with_co_author(Some("   ")), || {
                panic!("git must not even be probed when coAuthor is blank")
            })
            .is_empty()
        );
    }

    /// The whole reason this check exists: on git < 2.31 the `GIT_CONFIG_COUNT` handoff is ignored
    /// silently, so the only symptom is commits that quietly lack the trailer.
    #[test]
    fn co_author_check_warns_on_a_git_older_than_the_env_config_floor() {
        let checks = co_author_check_with(
            &settings_with_co_author(Some("bot <bot@example.com>")),
            || Some("git version 2.30.2".to_string()),
        );

        assert_eq!(checks.len(), 1);
        assert_eq!(checks[0].status, CheckStatus::Warn);
        assert!(
            checks[0].message.contains("2.30"),
            "got: {}",
            checks[0].message
        );
        assert!(checks[0].message.contains("Co-Authored-By"));
        // A missing trailer is cosmetic; it must never gate a job or a daemon start.
        assert!(!checks[0].required);
    }

    #[test]
    fn co_author_check_passes_on_the_floor_and_above() {
        for version in ["git version 2.31.0", "git version 2.54.0 (Apple Git-157)"] {
            let checks = co_author_check_with(
                &settings_with_co_author(Some("bot <bot@example.com>")),
                || Some(version.to_string()),
            );
            assert_eq!(checks.len(), 1, "{version}");
            assert_eq!(checks[0].status, CheckStatus::Ok, "{version}");
        }
    }

    /// `git_check` already reports a git that is missing or unreadable; a second red line saying the
    /// same thing in different words is noise, so an unparseable probe reports nothing here.
    #[test]
    fn co_author_check_defers_to_git_check_when_the_version_is_unreadable() {
        for probe in [
            None,
            Some("nonsense".to_string()),
            Some("git version x.y".to_string()),
        ] {
            assert!(
                co_author_check_with(
                    &settings_with_co_author(Some("bot <bot@example.com>")),
                    || probe.clone()
                )
                .is_empty(),
                "{probe:?}"
            );
        }
    }
}
