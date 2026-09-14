//! `tendril vault` — ported from `VaultCommand.cs`, minus the `theme` subcommand.
//!
//! Follows `project.rs`: when a master daemon is reachable every subcommand goes over HTTP so it sees
//! the same in-memory state as the app, and a *transport* failure falls back to driving
//! `tendril_core::vault` directly against the filesystem. An HTTP status error is a real error, not a
//! fallback — a 404 from the daemon means the vault genuinely does not exist, and silently re-answering
//! from disk would hide that.
//!
//! The argument-parsing helpers are public so tests can exercise them without a daemon or a vault.

use clap::Subcommand;
use std::collections::BTreeMap;
use std::path::Path;
use tendril_core::config::{get_config_path, load_config, read_master, MasterInfo};
use tendril_core::vault::{
    self, VaultCatalog, VaultExportRequest, VaultImportRequest, VaultPrResult, VaultResult,
    VaultStatus, VaultSyncResult,
};

#[derive(Subcommand)]
pub enum VaultCommands {
    #[command(about = "List connected vaults")]
    List {
        #[arg(long)]
        json: bool,
    },

    #[command(about = "Show vault status")]
    Status {
        #[arg(value_name = "VAULT_ID")]
        vault_id: Option<String>,
        #[arg(long)]
        json: bool,
    },

    #[command(about = "Discover vault repositories on GitHub")]
    Discover {
        #[arg(long)]
        json: bool,
    },

    #[command(about = "Connect an existing vault repository")]
    Connect {
        #[arg(value_name = "REPO_URL")]
        repo_url: String,
        #[arg(short, long)]
        name: Option<String>,
    },

    #[command(about = "Create a new vault repository on GitHub")]
    Create {
        #[arg(value_name = "REPO_NAME")]
        repo_name: String,
        #[arg(long, help = "Create a public repository instead of a private one")]
        public: bool,
        #[arg(long)]
        org: Option<String>,
    },

    #[command(about = "Disconnect a vault (the local clone is kept)")]
    Disconnect {
        #[arg(value_name = "VAULT_ID")]
        vault_id: Option<String>,
        #[arg(short, long)]
        yes: bool,
    },

    #[command(about = "Pull the latest vault changes and update tracked projects")]
    Sync {
        #[arg(value_name = "VAULT_ID")]
        vault_id: Option<String>,
    },

    #[command(about = "Alias of 'sync'")]
    Pull {
        #[arg(value_name = "VAULT_ID")]
        vault_id: Option<String>,
    },

    #[command(name = "set-auto-sync", about = "Enable or disable vault auto-sync")]
    SetAutoSync {
        #[arg(value_name = "ENABLED")]
        enabled: String,
        #[arg(long)]
        vault: Option<String>,
    },

    #[command(about = "List the projects available in a vault")]
    Catalog {
        #[arg(value_name = "VAULT_ID")]
        vault_id: Option<String>,
        #[arg(long)]
        json: bool,
    },

    #[command(about = "Import a project from a vault")]
    Import {
        #[arg(value_name = "PROJECT_NAME")]
        project_name: String,
        #[arg(long = "target-name")]
        target_name: Option<String>,
        #[arg(long)]
        vault: Option<String>,
        #[arg(
            long = "repo",
            value_name = "NAME=PATH",
            help = "Map a vault repository to a local path; repeatable"
        )]
        repo: Vec<String>,
        #[arg(long = "no-permissions")]
        no_permissions: bool,
        #[arg(long, help = "Merge into an existing local project instead of replacing it")]
        merge: bool,
    },

    #[command(about = "Push projects to a vault and open a pull request")]
    Push {
        #[arg(value_name = "PROJECTS", required = true)]
        projects: Vec<String>,
        #[arg(long)]
        vault: Option<String>,
        #[arg(long)]
        version: Option<String>,
        #[arg(long)]
        changelog: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        body: Option<String>,
        #[arg(long = "reviewer", value_name = "LOGINS", help = "Repeatable; also accepts a comma-separated list")]
        reviewer: Vec<String>,
    },

    #[command(about = "Delete a project from a vault via a pull request")]
    Delete {
        #[arg(value_name = "PROJECT_NAME")]
        project_name: String,
        #[arg(long)]
        vault: Option<String>,
        #[arg(short, long)]
        yes: bool,
    },
}

enum DaemonOutcome {
    Handled,
    Fallback,
}

pub async fn handle_vault_command(cmd: VaultCommands, tendril_home: &Path) -> anyhow::Result<()> {
    if let Some(master) = read_master(tendril_home) {
        match handle_vault_command_daemon(&cmd, &master).await {
            Ok(DaemonOutcome::Handled) => return Ok(()),
            Ok(DaemonOutcome::Fallback) => {
                tracing::debug!("Failed to reach master daemon, falling back to filesystem");
            }
            Err(e) => return Err(e),
        }
    }

    handle_vault_command_fs(cmd, tendril_home).await
}

// ---------------------------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------------------------

/// Parses a boolean argument, accepting the spellings the C# command accepted.
///
/// Returns `None` rather than defaulting to `false`, so `set-auto-sync maybe` is an error instead of
/// quietly turning auto-sync *off*.
pub fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_lowercase().as_str() {
        "true" | "1" | "yes" | "y" => Some(true),
        "false" | "0" | "no" | "n" => Some(false),
        _ => None,
    }
}

/// Parses `--repo <repoName>=<localPath>` entries. Splits on the *first* `=` only, so a Windows path
/// or a query string on the right-hand side survives.
pub fn parse_repo_mappings(entries: &[String]) -> anyhow::Result<BTreeMap<String, String>> {
    let mut mappings = BTreeMap::new();

    for entry in entries {
        let invalid = || {
            anyhow::anyhow!(
                "Invalid repo mapping format '{}'. Expected '<repoName>=<localPath>'.",
                entry
            )
        };

        let (name, path) = entry.split_once('=').ok_or_else(invalid)?;
        let (name, path) = (name.trim(), path.trim());
        if name.is_empty() || path.is_empty() {
            return Err(invalid());
        }

        mappings.insert(name.to_string(), path.to_string());
    }

    Ok(mappings)
}

/// Asks for confirmation on stdin. Only `y` / `yes` consents; `--yes` skips the prompt entirely.
///
/// Anything else — including EOF, which is what a non-interactive caller produces — declines, so a
/// scripted `disconnect` or `delete` cannot destroy configuration by accident.
pub fn confirm(prompt: &str, assume_yes: bool) -> anyhow::Result<bool> {
    use std::io::Write;

    if assume_yes {
        return Ok(true);
    }

    print!("{} [y/N]: ", prompt);
    std::io::stdout().flush()?;

    let mut answer = String::new();
    if std::io::stdin().read_line(&mut answer)? == 0 {
        return Ok(false);
    }

    Ok(matches!(answer.trim().to_lowercase().as_str(), "y" | "yes"))
}

/// Splits `--reviewer` values on `,` so both `--reviewer a --reviewer b` and `--reviewer a,b` work.
pub fn parse_reviewers(values: &[String]) -> Vec<String> {
    values
        .iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|reviewer| !reviewer.is_empty())
        .map(|reviewer| reviewer.to_string())
        .collect()
}

/// Resolves the requested project names against the local config, deduping case-insensitively while
/// keeping the config's own spelling. An unknown name is an error listing what is available.
pub fn resolve_project_names(
    settings: &tendril_core::config::TendrilSettings,
    requested: &[String],
) -> anyhow::Result<Vec<String>> {
    let mut resolved: Vec<String> = Vec::new();

    for name in requested {
        let canonical = vault::service::require_project(settings, name)
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        if !resolved
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&canonical))
        {
            resolved.push(canonical);
        }
    }

    Ok(resolved)
}

/// The `vault push` flags that shape the pull request rather than its contents.
///
/// Grouped into a struct because both the daemon and the filesystem path forward the same six flags,
/// and a positional list of five `Option<&str>` is easy to transpose at a call site.
#[derive(Default)]
pub struct PushOptions<'a> {
    pub vault_id: Option<&'a str>,
    pub version: Option<&'a str>,
    pub changelog: Option<&'a str>,
    pub title: Option<&'a str>,
    pub body: Option<&'a str>,
    pub reviewers: Vec<String>,
}

/// Builds the export request for `vault push`, filling in the reference's defaults for version, PR
/// title and PR body, and selecting every asset each project currently has.
pub fn build_export_request(
    tendril_home: &Path,
    settings: &tendril_core::config::TendrilSettings,
    projects: &[String],
    options: PushOptions<'_>,
) -> VaultExportRequest {
    let PushOptions {
        vault_id,
        version,
        changelog,
        title,
        body,
        reviewers,
    } = options;

    let version = version
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(|version| version.to_string())
        .unwrap_or_else(vault::generate_version_timestamp);
    let changelog = changelog.unwrap_or_default().to_string();

    let mut request = VaultExportRequest {
        target_vault_id: vault_id.map(|id| id.to_string()),
        project_names: projects.to_vec(),
        version: version.clone(),
        changelog: changelog.clone(),
        pr_title: title
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(|title| title.to_string())
            .unwrap_or_else(|| {
                format!(
                    "feat(vault): update {} to v{}",
                    projects.join(", "),
                    version
                )
            }),
        pr_body: body
            .map(str::trim)
            .filter(|body| !body.is_empty())
            .map(|body| body.to_string())
            .unwrap_or_else(|| {
                format!(
                    "### Vault Version Update: v{}\n\n**Changelog:**\n{}\n\n**Projects:**\n{}",
                    version,
                    changelog,
                    projects
                        .iter()
                        .map(|project| format!("- {}", project))
                        .collect::<Vec<_>>()
                        .join("\n")
                )
            }),
        reviewers,
        ..Default::default()
    };

    for project in projects {
        let assets = vault::collect_project_assets(tendril_home, settings, project);
        request
            .selected_skills
            .insert(project.clone(), assets.skills);
        request
            .selected_mcps
            .insert(project.clone(), assets.mcp_servers);
        request
            .selected_memories
            .insert(project.clone(), assets.memories);
        request
            .selected_review_actions
            .insert(project.clone(), assets.review_actions);
        request
            .selected_verifications
            .insert(project.clone(), assets.verifications);
        request.sync_permissions.insert(project.clone(), true);
    }

    request
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

fn print_json<T: serde::Serialize>(value: &T) -> anyhow::Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

/// Prints aligned columns, sizing each one to its widest cell.
fn print_table(headers: &[&str], rows: &[Vec<String>]) {
    let mut widths: Vec<usize> = headers.iter().map(|header| header.len()).collect();
    for row in rows {
        for (index, cell) in row.iter().enumerate() {
            if index < widths.len() {
                widths[index] = widths[index].max(cell.len());
            }
        }
    }

    let line = |cells: &[String]| {
        cells
            .iter()
            .enumerate()
            .map(|(index, cell)| format!("{:<width$}", cell, width = widths[index]))
            .collect::<Vec<_>>()
            .join("  ")
            .trim_end()
            .to_string()
    };

    let header_cells: Vec<String> = headers.iter().map(|header| header.to_string()).collect();
    println!("{}", line(&header_cells));
    println!(
        "{}",
        widths
            .iter()
            .map(|width| "-".repeat(*width))
            .collect::<Vec<_>>()
            .join("  ")
    );
    for row in rows {
        println!("{}", line(row));
    }
}

fn print_vault_list(statuses: &[VaultStatus]) {
    if statuses.is_empty() {
        println!("No vaults are connected.");
        return;
    }

    let rows: Vec<Vec<String>> = statuses
        .iter()
        .map(|status| {
            vec![
                status.id.clone(),
                status.name.clone(),
                status.repo_url.clone(),
                status.current_branch.clone(),
                status.commits_ahead.to_string(),
                status.commits_behind.to_string(),
                status
                    .last_synced_at
                    .map(|synced| synced.format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_else(|| "never".to_string()),
                if status.always_up_to_date { "on" } else { "off" }.to_string(),
            ]
        })
        .collect();

    print_table(
        &[
            "Id",
            "Name",
            "Repository",
            "Branch",
            "Ahead",
            "Behind",
            "Last Synced",
            "Auto Sync",
        ],
        &rows,
    );
}

fn print_status(status: &VaultStatus) {
    if !status.is_configured {
        println!("No vault is configured.");
        if !status.repo_url.is_empty() {
            println!("Repository: {}", status.repo_url);
            println!("Local path: {}", status.local_path);
        }
        return;
    }

    println!("Vault:       {} ({})", status.name, status.id);
    println!("Repository:  {}", status.repo_url);
    println!("Local path:  {}", status.local_path);
    println!("Branch:      {}", status.current_branch);
    if let Some(commit) = &status.latest_commit {
        println!("Commit:      {}", commit);
    }
    println!(
        "Ahead:       {}   Behind: {}",
        status.commits_ahead, status.commits_behind
    );
    println!(
        "Last synced: {}",
        status
            .last_synced_at
            .map(|synced| synced.format("%Y-%m-%d %H:%M:%S UTC").to_string())
            .unwrap_or_else(|| "never".to_string())
    );
    println!(
        "Auto sync:   {}",
        if status.always_up_to_date {
            "enabled"
        } else {
            "disabled"
        }
    );
}

fn print_discovered(repos: &[vault::DiscoveredVaultRepo]) {
    if repos.is_empty() {
        println!("No vault repositories were found.");
        return;
    }

    let rows: Vec<Vec<String>> = repos
        .iter()
        .map(|repo| {
            vec![
                repo.full_name.clone(),
                repo.repo_url.clone(),
                repo.owner.clone(),
                repo.account_type.clone(),
                if repo.is_private { "private" } else { "public" }.to_string(),
            ]
        })
        .collect();

    print_table(
        &["Full Name", "Repo URL", "Owner", "Account Type", "Visibility"],
        &rows,
    );
}

fn print_catalog(catalog: &VaultCatalog) {
    if catalog.projects.is_empty() {
        println!("The vault contains no projects.");
        return;
    }

    let rows: Vec<Vec<String>> = catalog
        .projects
        .iter()
        .map(|item| {
            vec![
                item.name.clone(),
                if item.remote_version.is_empty() {
                    "-".to_string()
                } else {
                    item.remote_version.clone()
                },
                format!("{:?}", item.sync_status),
                item.repos_count.to_string(),
                item.skills_count.to_string(),
                item.mcps_count.to_string(),
                item.memories_count.to_string(),
                item.review_actions_count.to_string(),
                item.verifications_count.to_string(),
            ]
        })
        .collect();

    print_table(
        &[
            "Project",
            "Version",
            "Sync Status",
            "Repos",
            "Skills",
            "MCPs",
            "Memories",
            "Actions",
            "Verifications",
        ],
        &rows,
    );
}

/// Reports a [`VaultResult`], turning a failure into a non-zero exit.
fn report_result(result: &VaultResult) -> anyhow::Result<()> {
    if !result.success {
        anyhow::bail!(
            "{}",
            result
                .error_message
                .clone()
                .filter(|error| !error.is_empty())
                .or_else(|| Some(result.message.clone()).filter(|message| !message.is_empty()))
                .unwrap_or_else(|| "Vault operation failed".to_string())
        );
    }

    println!("{}", result.message);
    Ok(())
}

fn report_pr_result(result: &VaultPrResult) -> anyhow::Result<()> {
    if !result.success {
        anyhow::bail!(
            "{}",
            result
                .error_message
                .clone()
                .unwrap_or_else(|| "Vault operation failed".to_string())
        );
    }

    if let Some(branch) = &result.branch_name {
        println!("Branch: {}", branch);
    }
    match &result.pr_url {
        Some(url) => println!("Pull request: {}", url),
        None => println!("The branch was pushed, but no pull request URL was returned."),
    }
    Ok(())
}

fn report_sync_result(result: &VaultSyncResult) -> anyhow::Result<()> {
    if !result.success {
        anyhow::bail!(
            "{}",
            result
                .error_message
                .clone()
                .filter(|error| !error.is_empty())
                .unwrap_or_else(|| result.message.clone())
        );
    }

    println!(
        "{} ({} project(s) updated)",
        result.message, result.updated_projects_count
    );
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Filesystem path
// ---------------------------------------------------------------------------------------------

async fn handle_vault_command_fs(
    cmd: VaultCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    match cmd {
        VaultCommands::List { json } => {
            let statuses = vault::get_vaults(tendril_home)?;
            if json {
                print_json(&statuses)?;
            } else {
                print_vault_list(&statuses);
            }
        }
        VaultCommands::Status { vault_id, json } => {
            let status = vault::get_status(tendril_home, vault_id.as_deref())?;
            if json {
                print_json(&status)?;
            } else {
                print_status(&status);
            }
        }
        VaultCommands::Discover { json } => {
            let repos = vault::discover_existing_vaults(tendril_home).await?;
            if json {
                print_json(&repos)?;
            } else {
                print_discovered(&repos);
            }
        }
        VaultCommands::Connect { repo_url, name } => {
            let result = vault::connect_vault(tendril_home, &repo_url, name.as_deref()).await?;
            report_result(&result)?;
        }
        VaultCommands::Create {
            repo_name,
            public,
            org,
        } => {
            let result =
                vault::create_vault_repo(tendril_home, &repo_name, !public, org.as_deref()).await?;
            report_result(&result)?;
        }
        VaultCommands::Disconnect { vault_id, yes } => {
            if !confirm(
                "Disconnect this vault? The local clone and imported projects are kept.",
                yes,
            )? {
                println!("Cancelled.");
                return Ok(());
            }
            let result = vault::disconnect_vault(tendril_home, vault_id.as_deref())?;
            report_result(&result)?;
        }
        VaultCommands::Sync { vault_id } | VaultCommands::Pull { vault_id } => {
            let result = vault::pull_latest(tendril_home, vault_id.as_deref()).await?;
            report_sync_result(&result)?;
        }
        VaultCommands::SetAutoSync { enabled, vault } => {
            let enabled = parse_bool(&enabled).ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid value '{}'. Expected one of: true, false, 1, 0, yes, no, y, n.",
                    enabled
                )
            })?;
            let result = vault::set_always_up_to_date(tendril_home, enabled, vault.as_deref())?;
            report_result(&result)?;
        }
        VaultCommands::Catalog { vault_id, json } => {
            let catalog = vault::get_catalog(tendril_home, vault_id.as_deref())?;
            if json {
                print_json(&catalog)?;
            } else {
                print_catalog(&catalog);
            }
        }
        VaultCommands::Import {
            project_name,
            target_name,
            vault: vault_id,
            repo,
            no_permissions,
            merge,
        } => {
            let request = VaultImportRequest {
                source_vault_id: vault_id.clone(),
                project_name,
                target_local_project_name: target_name,
                local_repo_mappings: parse_repo_mappings(&repo)?,
                import_permissions: !no_permissions,
                ..Default::default()
            };

            let result = if merge {
                vault::merge_project(tendril_home, &request, vault_id.as_deref())?
            } else {
                vault::import_project(tendril_home, &request, vault_id.as_deref()).await?
            };
            report_result(&result)?;
        }
        VaultCommands::Push {
            projects,
            vault: vault_id,
            version,
            changelog,
            title,
            body,
            reviewer,
        } => {
            let settings = load_config(&get_config_path(tendril_home))?;
            let projects = resolve_project_names(&settings, &projects)?;
            let request = build_export_request(
                tendril_home,
                &settings,
                &projects,
                PushOptions {
                    vault_id: vault_id.as_deref(),
                    version: version.as_deref(),
                    changelog: changelog.as_deref(),
                    title: title.as_deref(),
                    body: body.as_deref(),
                    reviewers: parse_reviewers(&reviewer),
                },
            );

            let result =
                vault::push_and_create_pr(tendril_home, &request, vault_id.as_deref()).await?;
            report_pr_result(&result)?;
        }
        VaultCommands::Delete {
            project_name,
            vault: vault_id,
            yes,
        } => {
            if !confirm(
                &format!(
                    "Open a pull request deleting '{}' from the vault?",
                    project_name
                ),
                yes,
            )? {
                println!("Cancelled.");
                return Ok(());
            }
            let result = vault::delete_project_from_vault(
                tendril_home,
                &project_name,
                vault_id.as_deref(),
            )
            .await?;
            report_pr_result(&result)?;
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Daemon path
// ---------------------------------------------------------------------------------------------

/// `default` is the route contract's stand-in for "the primary vault", so a missing id becomes it
/// rather than producing `/api/vaults//catalog`.
fn vault_segment(vault_id: Option<&str>) -> String {
    vault_id
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .unwrap_or("default")
        .to_string()
}

async fn handle_vault_command_daemon(
    cmd: &VaultCommands,
    master: &MasterInfo,
) -> anyhow::Result<DaemonOutcome> {
    let client = reqwest::Client::new();
    let base_url = format!("http://{}:{}", master.host, master.port);

    /// A transport failure means the daemon is gone; anything else is a real error.
    macro_rules! send {
        ($builder:expr) => {
            match $builder.bearer_auth(&master.secret).send().await {
                Ok(response) => response,
                Err(_) => return Ok(DaemonOutcome::Fallback),
            }
        };
    }

    macro_rules! parse {
        ($response:expr, $what:expr) => {{
            let response = $response;
            if !response.status().is_success() {
                let status = response.status();
                let detail = response.text().await.unwrap_or_default();
                anyhow::bail!("Failed to {}: HTTP {} {}", $what, status, detail.trim());
            }
            response.json().await?
        }};
    }

    match cmd {
        VaultCommands::List { json } => {
            let response = send!(client.get(format!("{}/api/vaults", base_url)));
            let statuses: Vec<VaultStatus> = parse!(response, "list vaults");
            if *json {
                print_json(&statuses)?;
            } else {
                print_vault_list(&statuses);
            }
        }
        VaultCommands::Status { vault_id, json } => {
            let response = send!(client.get(format!(
                "{}/api/vaults/{}",
                base_url,
                vault_segment(vault_id.as_deref())
            )));
            let status: VaultStatus = parse!(response, "get vault status");
            if *json {
                print_json(&status)?;
            } else {
                print_status(&status);
            }
        }
        VaultCommands::Discover { json } => {
            let response = send!(client.get(format!("{}/api/vaults/discover", base_url)));
            let repos: Vec<vault::DiscoveredVaultRepo> = parse!(response, "discover vaults");
            if *json {
                print_json(&repos)?;
            } else {
                print_discovered(&repos);
            }
        }
        VaultCommands::Connect { repo_url, name } => {
            let response = send!(client
                .post(format!("{}/api/vaults", base_url))
                .json(&serde_json::json!({ "repoUrl": repo_url, "name": name })));
            let result: VaultResult = parse!(response, "connect vault");
            report_result(&result)?;
        }
        VaultCommands::Create {
            repo_name,
            public,
            org,
        } => {
            let response = send!(client
                .post(format!("{}/api/vaults/create", base_url))
                .json(&serde_json::json!({
                    "repoName": repo_name,
                    "private": !public,
                    "org": org,
                })));
            let result: VaultResult = parse!(response, "create vault repository");
            report_result(&result)?;
        }
        VaultCommands::Disconnect { vault_id, yes } => {
            if !confirm(
                "Disconnect this vault? The local clone and imported projects are kept.",
                *yes,
            )? {
                println!("Cancelled.");
                return Ok(DaemonOutcome::Handled);
            }
            let response = send!(client.delete(format!(
                "{}/api/vaults/{}",
                base_url,
                vault_segment(vault_id.as_deref())
            )));
            let result: VaultResult = parse!(response, "disconnect vault");
            report_result(&result)?;
        }
        VaultCommands::Sync { vault_id } | VaultCommands::Pull { vault_id } => {
            let response = send!(client.post(format!(
                "{}/api/vaults/{}/pull",
                base_url,
                vault_segment(vault_id.as_deref())
            )));
            let result: VaultSyncResult = parse!(response, "pull vault changes");
            report_sync_result(&result)?;
        }
        VaultCommands::SetAutoSync { enabled, vault } => {
            let enabled = parse_bool(enabled).ok_or_else(|| {
                anyhow::anyhow!(
                    "Invalid value '{}'. Expected one of: true, false, 1, 0, yes, no, y, n.",
                    enabled
                )
            })?;
            let response = send!(client
                .put(format!(
                    "{}/api/vaults/{}",
                    base_url,
                    vault_segment(vault.as_deref())
                ))
                .json(&serde_json::json!({ "alwaysUpToDate": enabled })));
            let result: VaultResult = parse!(response, "set vault auto-sync");
            report_result(&result)?;
        }
        VaultCommands::Catalog { vault_id, json } => {
            let response = send!(client.get(format!(
                "{}/api/vaults/{}/catalog",
                base_url,
                vault_segment(vault_id.as_deref())
            )));
            let catalog: VaultCatalog = parse!(response, "read vault catalog");
            if *json {
                print_json(&catalog)?;
            } else {
                print_catalog(&catalog);
            }
        }
        VaultCommands::Import {
            project_name,
            target_name,
            vault: vault_id,
            repo,
            no_permissions,
            merge,
        } => {
            let mut payload = serde_json::to_value(VaultImportRequest {
                source_vault_id: vault_id.clone(),
                project_name: project_name.clone(),
                target_local_project_name: target_name.clone(),
                local_repo_mappings: parse_repo_mappings(repo)?,
                import_permissions: !no_permissions,
                ..Default::default()
            })?;
            if let Some(object) = payload.as_object_mut() {
                object.insert("merge".to_string(), serde_json::Value::Bool(*merge));
            }

            let response = send!(client
                .post(format!(
                    "{}/api/vaults/{}/projects",
                    base_url,
                    vault_segment(vault_id.as_deref())
                ))
                .json(&payload));
            let result: VaultResult = parse!(response, "import vault project");
            report_result(&result)?;
        }
        VaultCommands::Push {
            projects,
            vault: vault_id,
            version,
            changelog,
            title,
            body,
            reviewer,
        } => {
            // The selection is built from the local config either way: it names what to push, and the
            // daemon shares the same `config.yaml`.
            let tendril_home = tendril_core::config::get_tendril_home();
            let settings = load_config(&get_config_path(&tendril_home))?;
            let projects = resolve_project_names(&settings, projects)?;
            let request = build_export_request(
                &tendril_home,
                &settings,
                &projects,
                PushOptions {
                    vault_id: vault_id.as_deref(),
                    version: version.as_deref(),
                    changelog: changelog.as_deref(),
                    title: title.as_deref(),
                    body: body.as_deref(),
                    reviewers: parse_reviewers(reviewer),
                },
            );

            let response = send!(client
                .post(format!(
                    "{}/api/vaults/{}/push",
                    base_url,
                    vault_segment(vault_id.as_deref())
                ))
                .json(&request));
            let result: VaultPrResult = parse!(response, "push to vault");
            report_pr_result(&result)?;
        }
        VaultCommands::Delete {
            project_name,
            vault: vault_id,
            yes,
        } => {
            if !confirm(
                &format!(
                    "Open a pull request deleting '{}' from the vault?",
                    project_name
                ),
                *yes,
            )? {
                println!("Cancelled.");
                return Ok(DaemonOutcome::Handled);
            }
            let response = send!(client.delete(format!(
                "{}/api/vaults/{}/projects/{}",
                base_url,
                vault_segment(vault_id.as_deref()),
                project_name
            )));
            let result: VaultPrResult = parse!(response, "delete vault project");
            report_pr_result(&result)?;
        }
    }

    Ok(DaemonOutcome::Handled)
}
