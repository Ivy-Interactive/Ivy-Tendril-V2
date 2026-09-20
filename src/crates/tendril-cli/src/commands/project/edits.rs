//! The edits and the printing both command paths share.
//!
//! Every mutation here takes a `&mut ProjectConfig` and knows nothing about where that config came
//! from, which is what lets the daemon path and the filesystem path apply the identical change: see
//! the note on the list mutations below.

use tendril_core::config::VerificationPlacement;
use tendril_core::git::clone::redact_credentials;
use tendril_core::git::sync::{diagnostic_prompt, ProjectSyncResult};
use tendril_core::models::{ProjectConfig, ProjectMcpServerRef, ProjectSkillRef};

/// Both the daemon and filesystem paths need the same "exactly one placement" rule, so they share
/// this resolution rather than each deciding for itself.
pub(super) fn resolve_placement(
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

pub(super) fn add_build_dependency(
    proj: &mut ProjectConfig,
    dependency: &str,
) -> anyhow::Result<()> {
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

pub(super) fn remove_build_dependency(
    proj: &mut ProjectConfig,
    dependency: &str,
) -> anyhow::Result<()> {
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
pub(super) fn parse_env_entries(entries: &[String]) -> std::collections::HashMap<String, String> {
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

pub(super) fn add_mcp_server(
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
        extra: Default::default(),
    });
    Ok(())
}

pub(super) fn remove_mcp_server(proj: &mut ProjectConfig, server: &str) -> anyhow::Result<()> {
    let before = proj.mcp_servers.len();
    proj.mcp_servers
        .retain(|m| !m.name.eq_ignore_ascii_case(server));
    if proj.mcp_servers.len() == before {
        anyhow::bail!("MCP server not found: {}", server);
    }
    Ok(())
}

pub(super) fn add_project_skill(
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
        extra: Default::default(),
    });
    Ok(())
}

pub(super) fn remove_project_skill(proj: &mut ProjectConfig, skill: &str) -> anyhow::Result<()> {
    let before = proj.skills.len();
    proj.skills.retain(|s| !s.name.eq_ignore_ascii_case(skill));
    if proj.skills.len() == before {
        anyhow::bail!("Skill not found: {}", skill);
    }
    Ok(())
}

/// Replaces an entry of the same name in place, so re-importing a repo refreshes its servers
/// instead of appending duplicates or reshuffling the list.
pub(super) fn upsert_mcp_server(proj: &mut ProjectConfig, entry: ProjectMcpServerRef) {
    match proj
        .mcp_servers
        .iter()
        .position(|m| m.name.eq_ignore_ascii_case(&entry.name))
    {
        Some(idx) => proj.mcp_servers[idx] = entry,
        None => proj.mcp_servers.push(entry),
    }
}

pub(super) fn upsert_project_skill(proj: &mut ProjectConfig, entry: ProjectSkillRef) {
    match proj
        .skills
        .iter()
        .position(|s| s.name.eq_ignore_ascii_case(&entry.name))
    {
        Some(idx) => proj.skills[idx] = entry,
        None => proj.skills.push(entry),
    }
}

pub(super) fn print_mcp_servers(proj: &ProjectConfig) {
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

pub(super) fn print_project_skills(proj: &ProjectConfig) {
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
pub(super) fn print_project(p: &ProjectConfig) {
    println!("Project: {}", p.name);
    println!("Color: {}", p.color);
    println!("Repos:");
    for r in &p.repos {
        // `add-repo` clones a remote and stores the clone's directory, so a well-formed config has
        // nothing here to redact. A config written before that was true, or hand-edited, still can
        // — and `project get` is exactly the command whose output gets pasted into an issue.
        println!("  - {}", redact_credentials(&r.path));
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
pub(super) fn print_sync_result(result: &ProjectSyncResult) -> bool {
    let branch_info = result
        .base_branch
        .as_deref()
        .filter(|b| !b.is_empty())
        .map(|b| format!(" ({})", b))
        .unwrap_or_default();

    // `git_error_details` is git's own stderr, and git echoes the remote URL it was handed straight
    // back into it — including the userinfo. That is the case `redact_credentials` exists for, and
    // `repo_path` goes through it for the same reason `print_project` does.
    let repo_path = redact_credentials(&result.repo_path);

    if result.success {
        println!("✓ {}{}: {}", repo_path, branch_info, result.message);
        return true;
    }

    println!("✗ {}{}: {}", repo_path, branch_info, result.message);
    if let Some(details) = result.git_error_details.as_deref() {
        if !details.trim().is_empty() {
            println!("  {}", redact_credentials(details.trim()));
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
