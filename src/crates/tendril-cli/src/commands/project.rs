use clap::Subcommand;
use std::path::{Path, PathBuf};
use tendril_core::config::{
    expand_variables, get_config_path, get_plans_dir_with_settings, insert_project_verification,
    load_config, move_project_verification, read_master, sanitize_project_name, save_config,
    MasterInfo, TendrilSettings, VerificationPlacement,
};
use tendril_core::git::service::run_git;
use tendril_core::git::sync::{diagnostic_prompt, sync_project, ProjectSyncResult};
use tendril_core::git::worktree::derive_worktree_relative_path;
use tendril_core::mcp::discovery::{scan_repo_mcp_servers, to_project_ref};
use tendril_core::models::{
    ProjectConfig, ProjectEnvFileConfig, ProjectMcpServerRef, ProjectPortConfig, ProjectSkillRef,
    ProjectVerificationRef, RepoRef, ReviewActionConfig,
};
use tendril_core::plans::{read_plan_yaml, resolve_plan_folder};
use tendril_core::skills::{import_skill_to_project, scan_repo_skills};

#[derive(Subcommand)]
pub enum ProjectCommands {
    #[command(about = "List projects")]
    List,

    #[command(about = "Synchronize project repositories from remote")]
    Sync {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(long, help = "Sync only this repository (path or directory name)")]
        repo: Option<String>,
    },

    #[command(about = "Get project details")]
    Get { name: String },

    #[command(about = "Add a new project")]
    Add { name: String },

    #[command(about = "Remove a project")]
    Remove { name: String },

    #[command(about = "Rename a project")]
    Rename { name: String, new_name: String },

    #[command(about = "Add a repository to a project")]
    AddRepo { name: String, path: String },

    #[command(about = "Remove a repository from a project")]
    RemoveRepo { name: String, path: String },

    #[command(about = "Add a verification to a project")]
    AddVerification {
        name: String,
        verification: String,
        #[arg(long, conflicts_with = "optional", help = "Mark as required (default)")]
        required: bool,
        #[arg(long, help = "Mark as optional")]
        optional: bool,
        #[arg(long, help = "Insert directly after this verification")]
        after: Option<String>,
    },

    #[command(about = "Remove a verification from a project")]
    RemoveVerification { name: String, verification: String },

    #[command(about = "Move a verification within a project's run order")]
    MoveVerification {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "VERIFICATION")]
        verification: String,
        #[arg(long, help = "Move directly before this verification")]
        before: Option<String>,
        #[arg(long, help = "Move directly after this verification")]
        after: Option<String>,
        #[arg(long, help = "Move to this zero-based position")]
        position: Option<usize>,
    },

    #[command(about = "Add a build dependency to a project")]
    AddBuildDep {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "DEPENDENCY")]
        dependency: String,
    },

    #[command(about = "Remove a build dependency from a project")]
    RemoveBuildDep {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "DEPENDENCY")]
        dependency: String,
    },

    #[command(about = "Add a review action to a project")]
    AddReviewAction {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        action: String,
        #[arg(long)]
        command: String,
        #[arg(long, default_value = "")]
        condition: String,
        /// Repo-relative path prefix this action renders (repeatable).
        #[arg(long = "paths")]
        paths: Vec<String>,
        /// Insert before this existing action instead of appending to the end.
        #[arg(long)]
        before: Option<String>,
        /// Insert after this existing action instead of appending to the end.
        #[arg(long)]
        after: Option<String>,
    },

    #[command(about = "Remove a review action from a project")]
    RemoveReviewAction {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        action: String,
    },

    #[command(about = "List MCP servers in a project")]
    ListMcp {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add an MCP server to a project")]
    AddMcp {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        server: String,
        #[arg(value_name = "COMMAND")]
        command: String,
        /// Argument passed to the server command (repeatable).
        #[arg(long = "arg")]
        arguments: Vec<String>,
        /// Environment variable for the server (repeatable).
        #[arg(long = "env", value_name = "KEY=VALUE")]
        environment: Vec<String>,
    },

    #[command(about = "Remove an MCP server from a project")]
    RemoveMcp {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        server: String,
    },

    #[command(about = "List custom skills in a project")]
    ListSkills {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add a custom skill to a project")]
    AddSkill {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        skill: String,
        #[arg(long)]
        description: Option<String>,
        #[arg(long, help = "Skill file or folder holding SKILL.md")]
        path: Option<String>,
        #[arg(long, help = "Inline instructions, used when no path is given")]
        instructions: Option<String>,
    },

    #[command(about = "Remove a custom skill from a project")]
    RemoveSkill {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        skill: String,
    },

    #[command(about = "Import MCP servers and custom skills from a repository into a project")]
    Import {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "REPO")]
        repo: String,
        #[arg(long, help = "Import only MCP servers")]
        mcp_only: bool,
        #[arg(long, help = "Import only custom skills")]
        skills_only: bool,
    },

    #[command(about = "Import MCP servers from a repository into a project")]
    ImportMcp {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "REPO")]
        repo: String,
        #[arg(long = "name", help = "Import only the server with this name")]
        server: Option<String>,
    },

    #[command(about = "Import custom skills from a repository into a project")]
    ImportSkills {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "REPO")]
        repo: String,
        #[arg(long = "name", help = "Import only the skill with this name")]
        skill: Option<String>,
        #[arg(long, help = "Register the skill without copying its files")]
        no_copy: bool,
    },

    #[command(about = "Rank a project's review actions against a plan's changed files")]
    ReviewActions {
        #[arg(value_name = "PROJECT")]
        name: String,
        /// A changed file to rank against (repeatable). Combined with --plan if both are given.
        #[arg(long = "changed-file")]
        changed_files: Vec<String>,
        /// Derive changed files from this plan's worktree(s).
        #[arg(long)]
        plan: Option<String>,
        #[arg(long, default_value = "table")]
        format: String,
    },

    #[command(about = "Set a project field")]
    Set {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "FIELD")]
        field: String,
        #[arg(value_name = "VALUE")]
        value: String,
    },

    #[command(subcommand, about = "Manage a project's named service ports")]
    Port(ProjectPortCommands),

    #[command(subcommand, about = "Manage a project's environment files")]
    EnvFile(ProjectEnvFileCommands),
}

#[derive(Subcommand)]
pub enum ProjectPortCommands {
    #[command(about = "List a project's named service ports")]
    List {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add or update a named service port")]
    Add {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        port_name: String,
        #[arg(long)]
        default_port: u16,
        #[arg(long, default_value = "")]
        description: String,
    },

    #[command(about = "Remove a named service port")]
    Remove {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        port_name: String,
    },
}

#[derive(Subcommand)]
pub enum ProjectEnvFileCommands {
    #[command(about = "List a project's environment files")]
    List {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add or update an environment file")]
    Add {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "PATH")]
        path: String,
        #[arg(long, help = "Source file, relative to the worktree root")]
        template: Option<String>,
        #[arg(
            long = "override",
            value_name = "KEY=VALUE",
            help = "Key written on top of the template (repeatable)"
        )]
        overrides: Vec<String>,
    },

    #[command(about = "Remove an environment file")]
    Remove {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "PATH")]
        path: String,
    },
}

enum DaemonOutcome {
    Handled,
    Fallback,
}

/// Both the daemon and filesystem paths need the same "exactly one placement" rule, so they share
/// this resolution rather than each deciding for itself.
fn resolve_placement(
    before: Option<String>,
    after: Option<String>,
    position: Option<usize>,
) -> anyhow::Result<VerificationPlacement> {
    match (before, after, position) {
        (Some(target), None, None) => Ok(VerificationPlacement::Before(target)),
        (None, Some(target), None) => Ok(VerificationPlacement::After(target)),
        (None, None, Some(pos)) => Ok(VerificationPlacement::Position(pos)),
        _ => anyhow::bail!("Specify exactly one of --before, --after, or --position"),
    }
}

// The list mutations below are shared by the daemon and filesystem arms on purpose: both write the
// same field of the same struct, and a second copy of "is this a duplicate?" is a second answer
// waiting to disagree with the first.

fn add_build_dependency(proj: &mut ProjectConfig, dependency: &str) -> anyhow::Result<()> {
    if proj
        .build_dependencies
        .iter()
        .any(|d| d.eq_ignore_ascii_case(dependency))
    {
        anyhow::bail!("Build dependency already exists: {}", dependency);
    }
    proj.build_dependencies.push(dependency.to_string());
    Ok(())
}

fn remove_build_dependency(proj: &mut ProjectConfig, dependency: &str) -> anyhow::Result<()> {
    let before = proj.build_dependencies.len();
    proj.build_dependencies
        .retain(|d| !d.eq_ignore_ascii_case(dependency));
    if proj.build_dependencies.len() == before {
        anyhow::bail!("Build dependency not found: {}", dependency);
    }
    Ok(())
}

/// `KEY=VALUE` pairs, split on the first `=` so a value may itself contain one. An entry with a
/// blank key is dropped rather than rejected, matching the original.
fn parse_env_entries(entries: &[String]) -> std::collections::HashMap<String, String> {
    let mut parsed = std::collections::HashMap::new();
    for entry in entries {
        if let Some((key, value)) = entry.split_once('=') {
            if !key.trim().is_empty() {
                parsed.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
    }
    parsed
}

fn add_mcp_server(
    proj: &mut ProjectConfig,
    server: &str,
    command: &str,
    arguments: &[String],
    environment: &[String],
) -> anyhow::Result<()> {
    if proj
        .mcp_servers
        .iter()
        .any(|m| m.name.eq_ignore_ascii_case(server))
    {
        anyhow::bail!("MCP server already exists: {}", server);
    }
    proj.mcp_servers.push(ProjectMcpServerRef {
        name: server.to_string(),
        command: command.to_string(),
        arguments: arguments.to_vec(),
        environment: parse_env_entries(environment),
        disabled: false,
    });
    Ok(())
}

fn remove_mcp_server(proj: &mut ProjectConfig, server: &str) -> anyhow::Result<()> {
    let before = proj.mcp_servers.len();
    proj.mcp_servers
        .retain(|m| !m.name.eq_ignore_ascii_case(server));
    if proj.mcp_servers.len() == before {
        anyhow::bail!("MCP server not found: {}", server);
    }
    Ok(())
}

fn add_project_skill(
    proj: &mut ProjectConfig,
    skill: &str,
    description: Option<&str>,
    path: Option<&str>,
    instructions: Option<&str>,
) -> anyhow::Result<()> {
    if proj
        .skills
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case(skill))
    {
        anyhow::bail!("Skill already exists: {}", skill);
    }
    let blank_to_none = |value: Option<&str>| {
        value
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    proj.skills.push(ProjectSkillRef {
        name: skill.to_string(),
        description: description.unwrap_or_default().to_string(),
        path: blank_to_none(path),
        instructions: blank_to_none(instructions),
        disabled: false,
    });
    Ok(())
}

fn remove_project_skill(proj: &mut ProjectConfig, skill: &str) -> anyhow::Result<()> {
    let before = proj.skills.len();
    proj.skills.retain(|s| !s.name.eq_ignore_ascii_case(skill));
    if proj.skills.len() == before {
        anyhow::bail!("Skill not found: {}", skill);
    }
    Ok(())
}

/// Replaces an entry of the same name in place, so re-importing a repo refreshes its servers
/// instead of appending duplicates or reshuffling the list.
fn upsert_mcp_server(proj: &mut ProjectConfig, entry: ProjectMcpServerRef) {
    match proj
        .mcp_servers
        .iter()
        .position(|m| m.name.eq_ignore_ascii_case(&entry.name))
    {
        Some(idx) => proj.mcp_servers[idx] = entry,
        None => proj.mcp_servers.push(entry),
    }
}

fn upsert_project_skill(proj: &mut ProjectConfig, entry: ProjectSkillRef) {
    match proj
        .skills
        .iter()
        .position(|s| s.name.eq_ignore_ascii_case(&entry.name))
    {
        Some(idx) => proj.skills[idx] = entry,
        None => proj.skills.push(entry),
    }
}

fn print_mcp_servers(proj: &ProjectConfig) {
    if proj.mcp_servers.is_empty() {
        println!("No MCP servers configured for this project.");
        return;
    }
    for server in &proj.mcp_servers {
        let args = if server.arguments.is_empty() {
            String::new()
        } else {
            format!(" {}", server.arguments.join(" "))
        };
        println!("{}: {}{}", server.name, server.command, args);
    }
}

fn print_project_skills(proj: &ProjectConfig) {
    if proj.skills.is_empty() {
        println!("No custom skills configured for this project.");
        return;
    }
    for skill in &proj.skills {
        if skill.description.is_empty() {
            println!("{}", skill.name);
        } else {
            println!("{} - {}", skill.name, skill.description);
        }
    }
}

/// `project get`, shared by both arms so a verb can never write config the CLI cannot show back.
fn print_project(p: &ProjectConfig) {
    println!("Project: {}", p.name);
    println!("Color: {}", p.color);
    println!("Repos:");
    for r in &p.repos {
        println!("  - {}", r.path);
    }
    println!("Verifications:");
    for v in &p.verifications {
        println!("  - {} (required: {})", v.name, v.required);
    }
    if !p.review_actions.is_empty() {
        println!("Review Actions:");
        for a in &p.review_actions {
            println!(
                "  - {} (command: {}, condition: {})",
                a.name, a.command, a.condition
            );
        }
    }
    if !p.build_dependencies.is_empty() {
        println!("Build Dependencies:");
        for d in &p.build_dependencies {
            println!("  - {}", d);
        }
    }
    if !p.mcp_servers.is_empty() {
        println!("MCP Servers:");
        for m in &p.mcp_servers {
            println!("  - {} (command: {})", m.name, m.command);
        }
    }
    if !p.skills.is_empty() {
        println!("Skills:");
        for s in &p.skills {
            println!("  - {} - {}", s.name, s.description);
        }
    }
}

/// Prints one `project sync` result and reports whether it succeeded.
fn print_sync_result(result: &ProjectSyncResult) -> bool {
    let branch_info = result
        .base_branch
        .as_deref()
        .filter(|b| !b.is_empty())
        .map(|b| format!(" ({})", b))
        .unwrap_or_default();

    if result.success {
        println!("✓ {}{}: {}", result.repo_path, branch_info, result.message);
        return true;
    }

    println!("✗ {}{}: {}", result.repo_path, branch_info, result.message);
    if let Some(details) = result.git_error_details.as_deref() {
        if !details.trim().is_empty() {
            println!("  {}", details.trim());
        }
    }
    if result.can_fix_with_agent {
        println!(
            "  To safely resolve with an agent, launch an interactive session or run with tendril chat."
        );
        // The full prompt is only useful to whoever drives that session, so it stays behind the
        // debug log rather than adding six lines to every failure.
        tracing::debug!("sync diagnostic prompt: {}", diagnostic_prompt(result));
    }
    false
}

/// The local directory to scan for an `import*` verb.
///
/// `repo_arg` may name one of the project's repos (by configured path, final segment, or path
/// suffix), a path on disk, or a git URL — a URL is shallow-cloned into the import cache so the
/// scanners only ever see a real directory.
fn resolve_import_repo(
    project: &ProjectConfig,
    repo_arg: &str,
    tendril_home: &Path,
) -> anyhow::Result<PathBuf> {
    let target = project
        .repos
        .iter()
        .find(|r| {
            r.path.eq_ignore_ascii_case(repo_arg)
                || final_path_segment(&r.path).eq_ignore_ascii_case(repo_arg)
                || ends_with_segment(&r.path, repo_arg)
        })
        .map(|r| r.path.clone())
        .unwrap_or_else(|| repo_arg.to_string());

    let expanded = expand_variables(target.trim(), &tendril_home.to_string_lossy());
    let path = PathBuf::from(&expanded);
    if path.is_dir() {
        return Ok(path.canonicalize().unwrap_or(path));
    }

    if is_git_url(&expanded) {
        return clone_for_import(&expanded, tendril_home);
    }

    anyhow::bail!("Repository path not found: {}", expanded);
}

fn final_path_segment(path: &str) -> &str {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
}

fn ends_with_segment(path: &str, segment: &str) -> bool {
    let lower = path.to_lowercase();
    let needle = segment.to_lowercase();
    lower.ends_with(&format!("/{}", needle)) || lower.ends_with(&format!("\\{}", needle))
}

fn is_git_url(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("ssh://")
        || lower.starts_with("git@")
}

/// Shallow-clones `url` into `<TendrilHome>/Cache/Imports/<repo-name>`, refreshing an existing
/// clone with `git pull --depth 1` and re-cloning from scratch if that fails.
fn clone_for_import(url: &str, tendril_home: &Path) -> anyhow::Result<PathBuf> {
    let repo_name = final_path_segment(url.trim_end_matches(".git"));
    let sanitized = sanitize_project_name(repo_name);
    let name = if sanitized.is_empty() {
        "remote-repo".to_string()
    } else {
        sanitized
    };

    let cache_root = tendril_home.join("Cache").join("Imports");
    let target_dir = cache_root.join(&name);

    if target_dir.is_dir() {
        match run_git(&["pull", "--depth", "1"], &target_dir) {
            Ok((0, _, _)) => return Ok(target_dir),
            _ => {
                // A stale or half-written clone is not worth diagnosing: throw it away and clone
                // again, which is what the user asked for anyway.
                let _ = std::fs::remove_dir_all(&target_dir);
            }
        }
    }

    std::fs::create_dir_all(&cache_root)?;
    let target = target_dir.to_string_lossy().to_string();
    let (code, _, stderr) = run_git(&["clone", "--depth", "1", url, &target], &cache_root)?;
    if code != 0 || !target_dir.is_dir() {
        anyhow::bail!("Git clone failed: {}", stderr.trim());
    }
    Ok(target_dir)
}

pub async fn handle_project_command(
    cmd: ProjectCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    if let Some(master) = read_master(tendril_home) {
        match handle_project_command_daemon(&cmd, &master).await {
            Ok(DaemonOutcome::Handled) => return Ok(()),
            Ok(DaemonOutcome::Fallback) => {
                tracing::debug!("Failed to reach master daemon, falling back to filesystem");
            }
            Err(e) => return Err(e),
        }
    }

    handle_project_command_fs(cmd, tendril_home)
}

/// `GET /api/projects/:name` for the read-modify-write verbs.
///
/// `Ok(None)` means the daemon could not be reached and the caller should fall back to the
/// filesystem; `Err` is a real failure the user must see.
async fn get_project_via_daemon(
    client: &reqwest::Client,
    base_url: &str,
    master: &MasterInfo,
    name: &str,
) -> anyhow::Result<Option<ProjectConfig>> {
    let resp = match client
        .get(format!("{}/api/projects/{}", base_url, name))
        .bearer_auth(&master.secret)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        anyhow::bail!("Project '{}' not found", name);
    }
    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        anyhow::bail!("Failed to get project '{}': {}", name, err);
    }

    Ok(Some(resp.json().await?))
}

/// `PUT /api/projects/:name` with just the field the verb changed. Not atomic against a concurrent
/// editor — the same read-modify-write the `add-verification` / `add-review-action` daemon calls
/// already do.
async fn put_project_via_daemon(
    client: &reqwest::Client,
    base_url: &str,
    master: &MasterInfo,
    name: &str,
    body: serde_json::Value,
    action: &str,
) -> anyhow::Result<Option<()>> {
    let resp = match client
        .put(format!("{}/api/projects/{}", base_url, name))
        .bearer_auth(&master.secret)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(None),
    };

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        anyhow::bail!("Project '{}' not found", name);
    }
    if !resp.status().is_success() {
        let err = resp.text().await.unwrap_or_default();
        anyhow::bail!("Failed to {} in project '{}': {}", action, name, err);
    }

    Ok(Some(()))
}

async fn handle_project_command_daemon(
    cmd: &ProjectCommands,
    master: &MasterInfo,
) -> anyhow::Result<DaemonOutcome> {
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", master.host, master.port);

    match cmd {
        ProjectCommands::List => {
            let resp = match client
                .get(format!("{}/api/projects", base_url))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if !resp.status().is_success() {
                anyhow::bail!("Failed to list projects: HTTP {}", resp.status());
            }

            let projects: Vec<ProjectConfig> = resp.json().await?;
            for p in &projects {
                println!("{}", p.name);
            }
        }
        ProjectCommands::Get { name } => {
            let Some(p) = get_project_via_daemon(&client, &base_url, master, name).await? else {
                return Ok(DaemonOutcome::Fallback);
            };
            print_project(&p);
        }
        ProjectCommands::Add { name } => {
            let resp = match client
                .post(format!("{}/api/projects", base_url))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "name": name,
                    "color": "Blue",
                    "repos": [],
                    "verifications": [],
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::CONFLICT {
                anyhow::bail!("Project '{}' already exists", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add project '{}': {}", name, err);
            }

            println!("Project '{}' added.", name);
        }
        ProjectCommands::Remove { name } => {
            let resp = match client
                .delete(format!("{}/api/projects/{}", base_url, name))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to remove project '{}': {}", name, err);
            }

            println!("Project '{}' removed.", name);
        }
        ProjectCommands::Rename { name, new_name } => {
            let resp = match client
                .put(format!("{}/api/projects/{}", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "newName": new_name,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if resp.status() == reqwest::StatusCode::CONFLICT {
                anyhow::bail!("Project '{}' already exists", new_name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to rename project '{}': {}", name, err);
            }

            println!("Project '{}' renamed to '{}'.", name, new_name);
        }
        ProjectCommands::AddRepo { name, path } => {
            let resp = match client
                .post(format!("{}/api/projects/{}/repos", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "path": path,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add repo to project '{}': {}", name, err);
            }

            println!("Repo '{}' added to project '{}'.", path, name);
        }
        ProjectCommands::RemoveRepo { name, path } => {
            let resp = match client
                .delete(format!("{}/api/projects/{}/repos", base_url, name))
                .bearer_auth(&master.secret)
                .query(&[("path", path.as_str())])
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to remove repo from project '{}': {}", name, err);
            }

            println!("Repo '{}' removed from project '{}'.", path, name);
        }
        ProjectCommands::AddVerification {
            name,
            verification,
            // `--required` restates the default, so only `--optional` changes the outcome.
            required: _,
            optional,
            after,
        } => {
            let mut body = serde_json::json!({
                "name": verification,
                "required": !optional,
            });
            if let Some(after) = after {
                body["after"] = serde_json::json!(after);
            }

            let resp = match client
                .post(format!("{}/api/projects/{}/verifications", base_url, name))
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add verification to project '{}': {}", name, err);
            }

            println!(
                "Verification '{}' added to project '{}'.",
                verification, name
            );
        }
        ProjectCommands::MoveVerification {
            name,
            verification,
            before,
            after,
            position,
        } => {
            // Resolve the placement before the request so an invalid combination fails the same
            // way whether or not a daemon is up.
            let placement = resolve_placement(before.clone(), after.clone(), *position)?;
            let mut body = serde_json::json!({ "name": verification });
            match &placement {
                VerificationPlacement::Before(target) => {
                    body["before"] = serde_json::json!(target);
                }
                VerificationPlacement::After(target) => {
                    body["after"] = serde_json::json!(target);
                }
                VerificationPlacement::Position(pos) => {
                    body["position"] = serde_json::json!(pos);
                }
            }

            let resp = match client
                .put(format!("{}/api/projects/{}/verifications", base_url, name))
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to move verification in project '{}': {}", name, err);
            }

            let payload: serde_json::Value = resp.json().await.unwrap_or_default();
            let index = payload
                .get("position")
                .and_then(|v| v.as_u64())
                .unwrap_or_default();
            println!(
                "Moved verification '{}' to position {}",
                verification, index
            );
        }
        ProjectCommands::RemoveVerification { name, verification } => {
            let resp = match client
                .delete(format!(
                    "{}/api/projects/{}/verifications/{}",
                    base_url, name, verification
                ))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!(
                    "Failed to remove verification from project '{}': {}",
                    name,
                    err
                );
            }

            println!(
                "Verification '{}' removed from project '{}'.",
                verification, name
            );
        }
        ProjectCommands::AddReviewAction {
            name,
            action,
            command,
            condition,
            paths,
            before,
            after,
        } => {
            let resp = match client
                .post(format!("{}/api/projects/{}/review-actions", base_url, name))
                .bearer_auth(&master.secret)
                .json(&serde_json::json!({
                    "name": action,
                    "command": command,
                    "condition": condition,
                    "paths": paths,
                    "before": before,
                    "after": after,
                }))
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to add review action to project '{}': {}", name, err);
            }

            println!("Review action '{}' added to project '{}'.", action, name);
        }
        ProjectCommands::RemoveReviewAction { name, action } => {
            let resp = match client
                .delete(format!(
                    "{}/api/projects/{}/review-actions/{}",
                    base_url, name, action
                ))
                .bearer_auth(&master.secret)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!(
                    "Failed to remove review action from project '{}': {}",
                    name,
                    err
                );
            }

            println!(
                "Review action '{}' removed from project '{}'.",
                action, name
            );
        }
        ProjectCommands::AddBuildDep { name, dependency } => {
            let Some(mut proj) = get_project_via_daemon(&client, &base_url, master, name).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            add_build_dependency(&mut proj, dependency)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "buildDependencies": proj.build_dependencies }),
                "add build dependency",
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Added build dependency: {}", dependency);
        }
        ProjectCommands::RemoveBuildDep { name, dependency } => {
            let Some(mut proj) = get_project_via_daemon(&client, &base_url, master, name).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            remove_build_dependency(&mut proj, dependency)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "buildDependencies": proj.build_dependencies }),
                "remove build dependency",
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Removed build dependency: {}", dependency);
        }
        ProjectCommands::ListMcp { name } => {
            let Some(proj) = get_project_via_daemon(&client, &base_url, master, name).await? else {
                return Ok(DaemonOutcome::Fallback);
            };
            print_mcp_servers(&proj);
        }
        ProjectCommands::AddMcp {
            name,
            server,
            command,
            arguments,
            environment,
        } => {
            let Some(mut proj) = get_project_via_daemon(&client, &base_url, master, name).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            add_mcp_server(&mut proj, server, command, arguments, environment)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "mcpServers": proj.mcp_servers }),
                "add MCP server",
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Added MCP server: {}", server);
        }
        ProjectCommands::RemoveMcp { name, server } => {
            let Some(mut proj) = get_project_via_daemon(&client, &base_url, master, name).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            remove_mcp_server(&mut proj, server)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "mcpServers": proj.mcp_servers }),
                "remove MCP server",
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Removed MCP server: {}", server);
        }
        ProjectCommands::ListSkills { name } => {
            let Some(proj) = get_project_via_daemon(&client, &base_url, master, name).await? else {
                return Ok(DaemonOutcome::Fallback);
            };
            print_project_skills(&proj);
        }
        ProjectCommands::AddSkill {
            name,
            skill,
            description,
            path,
            instructions,
        } => {
            let Some(mut proj) = get_project_via_daemon(&client, &base_url, master, name).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            add_project_skill(
                &mut proj,
                skill,
                description.as_deref(),
                path.as_deref(),
                instructions.as_deref(),
            )?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "skills": proj.skills }),
                "add custom skill",
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Added custom skill: {}", skill);
        }
        ProjectCommands::RemoveSkill { name, skill } => {
            let Some(mut proj) = get_project_via_daemon(&client, &base_url, master, name).await?
            else {
                return Ok(DaemonOutcome::Fallback);
            };
            remove_project_skill(&mut proj, skill)?;
            if put_project_via_daemon(
                &client,
                &base_url,
                master,
                name,
                serde_json::json!({ "skills": proj.skills }),
                "remove custom skill",
            )
            .await?
            .is_none()
            {
                return Ok(DaemonOutcome::Fallback);
            }
            println!("Removed custom skill: {}", skill);
        }
        ProjectCommands::ReviewActions { .. } => {
            // Read-only ranking over the config file — no daemon round-trip needed.
            return Ok(DaemonOutcome::Fallback);
        }
        ProjectCommands::Set { name, field, value } => {
            let body = match field.as_str() {
                "color" => serde_json::json!({ "color": value }),
                "context" => serde_json::json!({ "context": value }),
                "stackHash" | "stack_hash" => {
                    if value.trim().is_empty() {
                        serde_json::json!({ "stackHash": null })
                    } else {
                        serde_json::json!({ "stackHash": value })
                    }
                }
                _ => {
                    anyhow::bail!(
                        "Unsupported project field '{}'. Supported fields: color, context, stackHash",
                        field
                    );
                }
            };

            let resp = match client
                .put(format!("{}/api/projects/{}", base_url, name))
                .bearer_auth(&master.secret)
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            };

            if resp.status() == reqwest::StatusCode::NOT_FOUND {
                anyhow::bail!("Project '{}' not found", name);
            }
            if !resp.status().is_success() {
                let err = resp.text().await.unwrap_or_default();
                anyhow::bail!("Failed to set field on project '{}': {}", name, err);
            }

            println!("Project '{}' field '{}' set to '{}'.", name, field, value);
        }
        // The daemon has no endpoints for ports or env files, so these always write config directly.
        ProjectCommands::Port(_) | ProjectCommands::EnvFile(_) => {
            return Ok(DaemonOutcome::Fallback)
        }
        // These run git and walk the local filesystem. The daemon exposes no endpoint for that, and
        // the CLI has to keep working with no daemon running, so they always take the fs arm — the
        // same treatment Port/EnvFile get. A future POST /api/projects/:name/sync would let the
        // desktop app offer sync as well.
        ProjectCommands::Sync { .. }
        | ProjectCommands::Import { .. }
        | ProjectCommands::ImportMcp { .. }
        | ProjectCommands::ImportSkills { .. } => return Ok(DaemonOutcome::Fallback),
    }

    Ok(DaemonOutcome::Handled)
}

fn handle_project_command_fs(cmd: ProjectCommands, tendril_home: &Path) -> anyhow::Result<()> {
    let cfg_path = get_config_path(tendril_home);
    let mut settings = load_config(&cfg_path)?;

    match cmd {
        ProjectCommands::List => {
            for p in &settings.projects {
                println!("{}", p.name);
            }
        }
        ProjectCommands::Get { name } => {
            print_project(find_project(&settings, &name)?);
        }
        ProjectCommands::Add { name } => {
            if settings
                .projects
                .iter()
                .any(|p| p.name.eq_ignore_ascii_case(&name))
            {
                anyhow::bail!("Project '{}' already exists", name);
            }
            settings.projects.push(ProjectConfig {
                name: name.clone(),
                color: "Blue".to_string(),
                ..Default::default()
            });
            save_config(&cfg_path, &settings)?;
            println!("Project '{}' added.", name);
        }
        ProjectCommands::Remove { name } => {
            let before = settings.projects.len();
            settings
                .projects
                .retain(|p| !p.name.eq_ignore_ascii_case(&name));
            if settings.projects.len() == before {
                anyhow::bail!("Project '{}' not found", name);
            }
            save_config(&cfg_path, &settings)?;
            println!("Project '{}' removed.", name);
        }
        ProjectCommands::Rename { name, new_name } => {
            let trimmed = new_name.trim().to_string();
            if trimmed.is_empty() {
                anyhow::bail!("Project name cannot be empty");
            }
            let proj_idx = settings
                .projects
                .iter()
                .position(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            if !trimmed.eq_ignore_ascii_case(&name)
                && settings
                    .projects
                    .iter()
                    .any(|p| p.name.eq_ignore_ascii_case(&trimmed))
            {
                anyhow::bail!("Project '{}' already exists", trimmed);
            }

            settings.projects[proj_idx].name = trimmed.clone();
            save_config(&cfg_path, &settings)?;

            let plans_dir =
                tendril_core::config::get_plans_dir_with_settings(tendril_home, Some(&settings));
            tendril_core::plans::rename_project_in_plans(&plans_dir, &name, &trimmed)?;

            let db_path = tendril_core::config::get_database_path(tendril_home);
            if let Ok(conn) = tendril_core::db::open_database(&db_path) {
                let _ = tendril_core::db::rename_project(&conn, &name, &trimmed);
            }

            println!("Project '{}' renamed to '{}'.", name, trimmed);
        }
        ProjectCommands::AddRepo { name, path } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            if !proj
                .repos
                .iter()
                .any(|r| r.path.eq_ignore_ascii_case(&path))
            {
                proj.repos.push(RepoRef {
                    path: path.clone(),
                    base_branch: None,
                });
                save_config(&cfg_path, &settings)?;
            }
            println!("Repo '{}' added to project '{}'.", path, name);
        }
        ProjectCommands::RemoveRepo { name, path } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            proj.repos.retain(|r| !r.path.eq_ignore_ascii_case(&path));
            save_config(&cfg_path, &settings)?;
            println!("Repo '{}' removed from project '{}'.", path, name);
        }
        ProjectCommands::AddVerification {
            name,
            verification,
            // `--required` restates the default, so only `--optional` changes the outcome.
            required: _,
            optional,
            after,
        } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            if !proj
                .verifications
                .iter()
                .any(|v| v.name.eq_ignore_ascii_case(&verification))
            {
                insert_project_verification(
                    proj,
                    ProjectVerificationRef {
                        name: verification.clone(),
                        required: !optional,
                    },
                    after.as_deref(),
                )?;
                save_config(&cfg_path, &settings)?;
            }
            println!(
                "Verification '{}' added to project '{}'.",
                verification, name
            );
        }
        ProjectCommands::MoveVerification {
            name,
            verification,
            before,
            after,
            position,
        } => {
            let placement = resolve_placement(before, after, position)?;
            let available = settings
                .projects
                .iter()
                .map(|p| p.name.clone())
                .collect::<Vec<_>>()
                .join(", ");
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| {
                    anyhow::anyhow!("Project '{}' not found. Available: {}", name, available)
                })?;

            let index = move_project_verification(proj, &verification, &placement)?;
            save_config(&cfg_path, &settings)?;
            println!(
                "Moved verification '{}' to position {}",
                verification, index
            );
        }
        ProjectCommands::RemoveVerification { name, verification } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            proj.verifications
                .retain(|v| !v.name.eq_ignore_ascii_case(&verification));
            save_config(&cfg_path, &settings)?;
            println!(
                "Verification '{}' removed from project '{}'.",
                verification, name
            );
        }
        ProjectCommands::AddReviewAction {
            name,
            action,
            command,
            condition,
            paths,
            before,
            after,
        } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            proj.review_actions
                .retain(|a| !a.name.eq_ignore_ascii_case(&action));

            let insert_idx = resolve_review_action_insert_index(
                &proj.review_actions,
                before.as_deref(),
                after.as_deref(),
                &name,
            )?;

            proj.review_actions.insert(
                insert_idx,
                ReviewActionConfig {
                    name: action.clone(),
                    condition: condition.clone(),
                    command: command.clone(),
                    paths: paths.clone(),
                },
            );
            save_config(&cfg_path, &settings)?;
            println!("Review action '{}' added to project '{}'.", action, name);
        }
        ProjectCommands::RemoveReviewAction { name, action } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            let before = proj.review_actions.len();
            proj.review_actions
                .retain(|a| !a.name.eq_ignore_ascii_case(&action));
            if proj.review_actions.len() == before {
                anyhow::bail!("Review action '{}' not found in project '{}'", action, name);
            }
            save_config(&cfg_path, &settings)?;
            println!(
                "Review action '{}' removed from project '{}'.",
                action, name
            );
        }
        ProjectCommands::Sync { name, repo } => {
            let proj = find_project(&settings, &name)?;
            if proj.repos.is_empty() {
                println!("No repositories found in project.");
                return Ok(());
            }

            let results = sync_project(proj, repo.as_deref(), tendril_home);
            if results.is_empty() {
                println!("No matching repositories found to sync.");
                return Ok(());
            }

            let failed = results
                .iter()
                .filter(|result| !print_sync_result(result))
                .count();
            if failed > 0 {
                // The CLI has no exit-code plumbing of its own, so the error is how main.rs learns
                // the sync did not fully succeed.
                anyhow::bail!(
                    "{} of {} repositories failed to sync.",
                    failed,
                    results.len()
                );
            }
        }
        ProjectCommands::AddBuildDep { name, dependency } => {
            let proj = find_project_mut(&mut settings, &name)?;
            add_build_dependency(proj, &dependency)?;
            save_config(&cfg_path, &settings)?;
            println!("Added build dependency: {}", dependency);
        }
        ProjectCommands::RemoveBuildDep { name, dependency } => {
            let proj = find_project_mut(&mut settings, &name)?;
            remove_build_dependency(proj, &dependency)?;
            save_config(&cfg_path, &settings)?;
            println!("Removed build dependency: {}", dependency);
        }
        ProjectCommands::ListMcp { name } => {
            print_mcp_servers(find_project(&settings, &name)?);
        }
        ProjectCommands::AddMcp {
            name,
            server,
            command,
            arguments,
            environment,
        } => {
            let proj = find_project_mut(&mut settings, &name)?;
            add_mcp_server(proj, &server, &command, &arguments, &environment)?;
            save_config(&cfg_path, &settings)?;
            println!("Added MCP server: {}", server);
        }
        ProjectCommands::RemoveMcp { name, server } => {
            let proj = find_project_mut(&mut settings, &name)?;
            remove_mcp_server(proj, &server)?;
            save_config(&cfg_path, &settings)?;
            println!("Removed MCP server: {}", server);
        }
        ProjectCommands::ListSkills { name } => {
            print_project_skills(find_project(&settings, &name)?);
        }
        ProjectCommands::AddSkill {
            name,
            skill,
            description,
            path,
            instructions,
        } => {
            let proj = find_project_mut(&mut settings, &name)?;
            add_project_skill(
                proj,
                &skill,
                description.as_deref(),
                path.as_deref(),
                instructions.as_deref(),
            )?;
            save_config(&cfg_path, &settings)?;
            println!("Added custom skill: {}", skill);
        }
        ProjectCommands::RemoveSkill { name, skill } => {
            let proj = find_project_mut(&mut settings, &name)?;
            remove_project_skill(proj, &skill)?;
            save_config(&cfg_path, &settings)?;
            println!("Removed custom skill: {}", skill);
        }
        ProjectCommands::Import {
            name,
            repo,
            mcp_only,
            skills_only,
        } => {
            let repo_path =
                resolve_import_repo(find_project(&settings, &name)?, &repo, tendril_home)?;
            // Neither flag and both flags both mean "import everything". The original computes
            // these independently (`!skills_only` / `!mcp_only`), which makes
            // `--mcp-only --skills-only` import nothing at all — a silent no-op is not worth
            // reproducing, so both flags together run both halves.
            let import_mcp = mcp_only || !skills_only;
            let import_skills = skills_only || !mcp_only;

            let discovered_servers = if import_mcp {
                scan_repo_mcp_servers(&repo_path)
            } else {
                Vec::new()
            };
            let discovered_skills = if import_skills {
                scan_repo_skills(&repo_path)
            } else {
                Vec::new()
            };

            // Skills are copied into the project before the config is written, so a copy failure
            // leaves no config entry pointing at files that are not there.
            let mut skill_refs = Vec::new();
            for skill in &discovered_skills {
                skill_refs.push(import_skill_to_project(tendril_home, &name, skill, true)?);
            }

            let proj = find_project_mut(&mut settings, &name)?;
            for server in &discovered_servers {
                upsert_mcp_server(proj, to_project_ref(server));
            }
            for skill_ref in skill_refs {
                upsert_project_skill(proj, skill_ref);
            }
            save_config(&cfg_path, &settings)?;

            println!("Import complete from: {}", repo_path.display());
            if import_mcp {
                println!(
                    "  MCP servers imported/updated: {}",
                    discovered_servers.len()
                );
            }
            if import_skills {
                println!(
                    "  Custom skills imported/updated: {}",
                    discovered_skills.len()
                );
            }
        }
        ProjectCommands::ImportMcp { name, repo, server } => {
            let repo_path =
                resolve_import_repo(find_project(&settings, &name)?, &repo, tendril_home)?;
            let discovered: Vec<_> = scan_repo_mcp_servers(&repo_path)
                .into_iter()
                .filter(|s| match server.as_deref() {
                    Some(wanted) => s.name.eq_ignore_ascii_case(wanted),
                    None => true,
                })
                .collect();

            if discovered.is_empty() {
                println!("No matching MCP servers found in repository.");
                return Ok(());
            }

            let proj = find_project_mut(&mut settings, &name)?;
            for found in &discovered {
                upsert_mcp_server(proj, to_project_ref(found));
            }
            save_config(&cfg_path, &settings)?;

            for found in &discovered {
                println!("Imported MCP server: {} ({})", found.name, found.command);
            }
        }
        ProjectCommands::ImportSkills {
            name,
            repo,
            skill,
            no_copy,
        } => {
            let repo_path =
                resolve_import_repo(find_project(&settings, &name)?, &repo, tendril_home)?;
            let discovered: Vec<_> = scan_repo_skills(&repo_path)
                .into_iter()
                .filter(|s| match skill.as_deref() {
                    Some(wanted) => s.name.eq_ignore_ascii_case(wanted),
                    None => true,
                })
                .collect();

            if discovered.is_empty() {
                println!("No matching skills found in repository.");
                return Ok(());
            }

            let mut skill_refs = Vec::new();
            for found in &discovered {
                skill_refs.push(import_skill_to_project(
                    tendril_home,
                    &name,
                    found,
                    !no_copy,
                )?);
            }

            let proj = find_project_mut(&mut settings, &name)?;
            for skill_ref in skill_refs {
                upsert_project_skill(proj, skill_ref);
            }
            save_config(&cfg_path, &settings)?;

            for found in &discovered {
                println!("Imported skill: {} - {}", found.name, found.description);
            }
        }
        ProjectCommands::ReviewActions {
            name,
            changed_files,
            plan,
            format,
        } => {
            let proj = settings
                .projects
                .iter()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            let mut all_changed = changed_files.clone();
            if let Some(plan_id) = plan.as_deref() {
                match changed_files_for_plan(tendril_home, &settings, plan_id) {
                    Ok(mut files) => all_changed.append(&mut files),
                    Err(e) => {
                        eprintln!(
                            "Warning: could not derive changed files for plan '{}': {}. Falling back to configured order.",
                            plan_id, e
                        );
                    }
                }
            }

            let ranked = proj.rank_review_actions(&all_changed);
            print_ranked_review_actions(&ranked, &format)?;
        }
        ProjectCommands::Set { name, field, value } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            match field.as_str() {
                "color" => {
                    proj.color = value.clone();
                }
                "context" => {
                    proj.context = value.clone();
                }
                "stackHash" | "stack_hash" => {
                    proj.stack_hash = if value.trim().is_empty() {
                        None
                    } else {
                        Some(value.clone())
                    };
                }
                _ => {
                    anyhow::bail!(
                        "Unsupported project field '{}'. Supported fields: color, context, stackHash",
                        field
                    );
                }
            }
            save_config(&cfg_path, &settings)?;
            println!("Project '{}' field '{}' set to '{}'.", name, field, value);
        }
        ProjectCommands::Port(port_cmd) => match port_cmd {
            ProjectPortCommands::List { name } => {
                let proj = find_project(&settings, &name)?;
                if proj.ports.is_empty() {
                    println!("No ports configured for this project.");
                } else {
                    println!("Name\tDefault Port\tDescription");
                    for (port_name, config) in &proj.ports {
                        println!(
                            "{}\t{}\t{}",
                            port_name, config.default_port, config.description
                        );
                    }
                }
            }
            ProjectPortCommands::Add {
                name,
                port_name,
                default_port,
                description,
            } => {
                let proj = find_project_mut(&mut settings, &name)?;
                let updated = proj
                    .ports
                    .insert(
                        port_name.clone(),
                        ProjectPortConfig {
                            default_port,
                            description: description.clone(),
                        },
                    )
                    .is_some();
                save_config(&cfg_path, &settings)?;
                println!(
                    "{} port: {} -> {}",
                    if updated { "Updated" } else { "Added" },
                    port_name,
                    default_port
                );
            }
            ProjectPortCommands::Remove { name, port_name } => {
                let proj = find_project_mut(&mut settings, &name)?;
                if proj.ports.remove(&port_name).is_none() {
                    anyhow::bail!("Port not found: {}", port_name);
                }
                save_config(&cfg_path, &settings)?;
                println!("Removed port: {}", port_name);
            }
        },
        ProjectCommands::EnvFile(env_cmd) => match env_cmd {
            ProjectEnvFileCommands::List { name } => {
                let proj = find_project(&settings, &name)?;
                if proj.env_files.is_empty() {
                    println!("No environment files configured for this project.");
                } else {
                    println!("Path\tTemplate\tOverrides");
                    for file in &proj.env_files {
                        println!(
                            "{}\t{}\t{}",
                            file.path,
                            file.template.clone().unwrap_or_default(),
                            file.overrides
                                .keys()
                                .cloned()
                                .collect::<Vec<String>>()
                                .join(", ")
                        );
                    }
                }
            }
            ProjectEnvFileCommands::Add {
                name,
                path,
                template,
                overrides,
            } => {
                // Split on the first '=' only, so a value may itself contain '='.
                let mut parsed = std::collections::BTreeMap::new();
                for entry in &overrides {
                    let (key, value) = entry.split_once('=').ok_or_else(|| {
                        anyhow::anyhow!("Invalid override (expected KEY=VALUE): {}", entry)
                    })?;
                    parsed.insert(key.trim().to_string(), value.to_string());
                }

                let proj = find_project_mut(&mut settings, &name)?;
                // Re-adding the same path replaces the entry rather than appending a duplicate: two
                // configs for one file would race, with the last one written winning silently.
                let before = proj.env_files.len();
                proj.env_files
                    .retain(|f| !f.path.eq_ignore_ascii_case(&path));
                let updated = proj.env_files.len() != before;

                proj.env_files.push(ProjectEnvFileConfig {
                    path: path.clone(),
                    template: template.filter(|t| !t.trim().is_empty()),
                    overrides: parsed,
                });
                save_config(&cfg_path, &settings)?;
                println!(
                    "{} environment file: {}",
                    if updated { "Updated" } else { "Added" },
                    path
                );
            }
            ProjectEnvFileCommands::Remove { name, path } => {
                let proj = find_project_mut(&mut settings, &name)?;
                let before = proj.env_files.len();
                proj.env_files
                    .retain(|f| !f.path.eq_ignore_ascii_case(&path));
                if proj.env_files.len() == before {
                    anyhow::bail!("Environment file not found: {}", path);
                }
                save_config(&cfg_path, &settings)?;
                println!("Removed environment file: {}", path);
            }
        },
    }

    Ok(())
}

/// Where a new/re-scoped review action should be inserted: `before`/`after` name an existing
/// action, otherwise it goes at the end (today's behaviour).
fn resolve_review_action_insert_index(
    review_actions: &[ReviewActionConfig],
    before: Option<&str>,
    after: Option<&str>,
    project_name: &str,
) -> anyhow::Result<usize> {
    let available = || {
        review_actions
            .iter()
            .map(|a| a.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    };

    if let Some(target) = before {
        return review_actions
            .iter()
            .position(|a| a.name.eq_ignore_ascii_case(target))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Review action '{}' not found in project '{}'. Available: {}",
                    target,
                    project_name,
                    available()
                )
            });
    }

    if let Some(target) = after {
        return review_actions
            .iter()
            .position(|a| a.name.eq_ignore_ascii_case(target))
            .map(|idx| idx + 1)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Review action '{}' not found in project '{}'. Available: {}",
                    target,
                    project_name,
                    available()
                )
            });
    }

    Ok(review_actions.len())
}

/// Derives the changed files for `plan_id` by diffing each of the plan's repo worktrees against
/// its base branch. Never fails hard on a per-repo diff error — callers treat an empty result (or
/// this function returning `Err`) as "fall back to configured order".
fn changed_files_for_plan(
    tendril_home: &Path,
    settings: &TendrilSettings,
    plan_id: &str,
) -> anyhow::Result<Vec<String>> {
    let plans_dir = get_plans_dir_with_settings(tendril_home, Some(settings));
    let plan_folder = resolve_plan_folder(plan_id, &plans_dir)?;
    let (plan, _) = read_plan_yaml(&plan_folder)?;

    let project_repos = settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(&plan.project))
        .map(|p| p.repos.as_slice())
        .unwrap_or(&[]);

    let mut all_files = Vec::new();
    for repo in &plan.repos {
        let repo_path = Path::new(repo);
        let worktree_path = plan_folder
            .join("Worktrees")
            .join(derive_worktree_relative_path(repo_path));
        if !worktree_path.exists() {
            continue;
        }

        let base_branch = project_repos
            .iter()
            .find(|r| r.path.eq_ignore_ascii_case(repo))
            .and_then(|r| r.base_branch.as_deref())
            .unwrap_or("main");

        let base_ref = format!("origin/{}", base_branch);
        let diff_ref = if run_git(&["rev-parse", "--verify", &base_ref], &worktree_path)
            .map(|(code, _, _)| code == 0)
            .unwrap_or(false)
        {
            base_ref
        } else {
            base_branch.to_string()
        };

        let (code, stdout, stderr) = run_git(
            &["diff", "--name-only", &format!("{}...HEAD", diff_ref)],
            &worktree_path,
        )?;
        if code != 0 {
            anyhow::bail!("git diff failed in {}: {}", worktree_path.display(), stderr);
        }

        all_files.extend(
            stdout
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty()),
        );
    }

    Ok(all_files)
}

fn print_ranked_review_actions(ranked: &[&ReviewActionConfig], format: &str) -> anyhow::Result<()> {
    match format {
        "json" => {
            let json = serde_json::to_string_pretty(ranked)?;
            println!("{}", json);
        }
        "table" | "" => {
            for a in ranked {
                println!("{}\t{}\t{}", a.name, a.condition, a.command);
            }
        }
        other => {
            anyhow::bail!(
                "Unsupported format '{}'. Supported formats: table, json",
                other
            );
        }
    }
    Ok(())
}

fn find_project<'a>(
    settings: &'a tendril_core::config::TendrilSettings,
    name: &str,
) -> anyhow::Result<&'a ProjectConfig> {
    settings
        .projects
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))
}

fn find_project_mut<'a>(
    settings: &'a mut tendril_core::config::TendrilSettings,
    name: &str,
) -> anyhow::Result<&'a mut ProjectConfig> {
    settings
        .projects
        .iter_mut()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))
}
