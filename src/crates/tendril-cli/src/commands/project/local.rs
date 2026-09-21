//! The filesystem path: the same subcommands applied straight to `config.yaml`.
//!
//! Used when no daemon is running, and for the subcommands the daemon does not serve at all
//! (`import`, `sync`, `port`, `env-file`), which is why this path is the more complete of the two.

use super::edits::{
    add_build_dependency, add_mcp_server, add_project_skill, print_mcp_servers, print_project,
    print_project_skills, print_sync_result, remove_build_dependency, remove_mcp_server,
    remove_project_skill, resolve_placement, upsert_mcp_server, upsert_project_skill,
};
use super::import::resolve_import_repo;
use super::{
    changed_files_for_plan, find_project, find_project_mut, print_hooks,
    print_ranked_review_actions, resolve_review_action_insert_index,
};
use super::{ProjectCommands, ProjectEnvFileCommands, ProjectPortCommands};
use std::path::Path;
use tendril_core::config::{
    get_config_path, insert_project_verification, load_config, move_project_verification,
    save_config,
};
use tendril_core::git::clone::{import_remote_repo, is_remote_url, redact_credentials};
use tendril_core::git::sync::sync_project;
use tendril_core::mcp::discovery::scan_repo_mcp_servers;
use tendril_core::mcp::discovery::to_project_ref;
use tendril_core::models::{
    ProjectConfig, ProjectEnvFileConfig, ProjectPortConfig, ProjectVerificationRef,
    PromptwareHookConfig, RepoRef, ReviewActionConfig,
};
use tendril_core::skills::import_skill_to_project;
use tendril_core::skills::scan_repo_skills;

pub(super) fn handle_project_command_fs(
    cmd: ProjectCommands,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    let cfg_path = get_config_path(tendril_home);
    let mut settings = load_config(&cfg_path)?;

    match cmd {
        ProjectCommands::List => {
            for p in &settings.projects {
                println!("{}", p.name);
            }
        }
        ProjectCommands::Get { name } => {
            let p = find_project(&settings, &name)?;
            print_project(p);
            print_hooks(p);
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

            // `config.yaml` is already saved, so neither cascade can fail the command — bailing
            // here would report failure for a rename that happened. They are reported instead,
            // because a plan or a row still naming the old project is not something a second
            // `rename` can fix: it would find the old name gone and do nothing.
            let plans_dir =
                tendril_core::config::get_plans_dir_with_settings(tendril_home, Some(&settings));
            match tendril_core::plans::rename_project_in_plans(&plans_dir, &name, &trimmed) {
                Ok(outcome) if outcome.is_partial() => {
                    eprintln!(
                        "Warning: renamed the project but {}. Edit each plan.yaml by hand to finish the rename.",
                        outcome.failure_summary()
                    );
                }
                Ok(_) => {}
                Err(e) => {
                    eprintln!(
                        "Warning: renamed the project but could not sweep {}: {}. Plans still name '{}'.",
                        plans_dir.display(),
                        e,
                        name
                    );
                }
            }

            let db_path = tendril_core::config::get_database_path(tendril_home);
            match tendril_core::db::open_database(&db_path) {
                Ok(conn) => {
                    if let Err(e) = tendril_core::db::rename_project(&conn, &name, &trimmed) {
                        eprintln!(
                            "Warning: renamed the project but could not update the database: {}. Plans, jobs and recommendations still name '{}'.",
                            e, name
                        );
                    }
                }
                Err(e) => {
                    eprintln!(
                        "Warning: renamed the project but could not open the database: {}. Plans, jobs and recommendations still name '{}'.",
                        e, name
                    );
                }
            }

            println!("Project '{}' renamed to '{}'.", name, trimmed);
        }
        // Cloning here rather than refusing the URL, because this arm's whole contract is to be the
        // daemon arm's equal: `materialize_repos` in the server's project routes turns a URL into a
        // clone before `save_config`, and an offline arm that stored the URL verbatim would write a
        // project nothing downstream can run. `resolve_working_directory` only ever picks a repo
        // whose path `is_dir()`, so the URL entry is skipped in silence and every job for the
        // project runs in TENDRIL_HOME instead of a repo. The CLI already owns the offline half of
        // this — `clone_for_import` clones a URL for the `import*` scanners through the same
        // `tendril-core` helper — so cloning costs nothing new and bailing would make `add-repo`
        // the one verb whose fallback is not a fallback.
        ProjectCommands::AddRepo { name, path } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;
            let project_name = proj.name.clone();

            // Deduped on the URL before the clone as well as on the path after it, matching
            // `add_project_repo`: pasting the same remote twice answers from config rather than
            // going back to the network.
            let already_present = proj
                .repos
                .iter()
                .any(|r| r.path.eq_ignore_ascii_case(&path));

            // `path` may carry `https://user:token@host/...`, so every line below that could reach
            // a terminal, a CI log or shell history prints the redaction, never the argument. The
            // stored path is the clone's directory, which has no userinfo in it at all.
            let stored = if already_present {
                path.clone()
            } else {
                let repo_ref = if is_remote_url(&path) {
                    let cloned = import_remote_repo(tendril_home, &project_name, &path)
                        .map_err(|e| anyhow::anyhow!("{}", e.message))?;
                    RepoRef {
                        path: cloned.path.to_string_lossy().to_string(),
                        base_branch: cloned.default_branch,
                        extra: Default::default(),
                    }
                } else {
                    RepoRef {
                        path: path.clone(),
                        base_branch: None,
                        extra: Default::default(),
                    }
                };

                // Re-found rather than reusing `proj`: the clone above borrows `settings` for its
                // project name and can run for minutes on a large repository.
                let stored = repo_ref.path.clone();
                let proj = settings
                    .projects
                    .iter_mut()
                    .find(|p| p.name.eq_ignore_ascii_case(&name))
                    .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;
                if !proj
                    .repos
                    .iter()
                    .any(|r| r.path.eq_ignore_ascii_case(&stored))
                {
                    proj.repos.push(repo_ref);
                    save_config(&cfg_path, &settings)?;
                }
                stored
            };

            println!(
                "Repo '{}' added to project '{}'.",
                redact_credentials(&stored),
                name
            );
        }
        ProjectCommands::RemoveRepo { name, path } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            proj.repos.retain(|r| !r.path.eq_ignore_ascii_case(&path));
            save_config(&cfg_path, &settings)?;
            println!(
                "Repo '{}' removed from project '{}'.",
                redact_credentials(&path),
                name
            );
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
                        extra: Default::default(),
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
                    extra: Default::default(),
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
        ProjectCommands::AddHook {
            name,
            hook,
            when,
            promptwares,
            action,
            condition,
        } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            // Upsert by name, as review actions do: re-running the command edits the hook rather
            // than leaving two entries with the same name, only one of which anyone would find.
            proj.hooks.retain(|h| !h.name.eq_ignore_ascii_case(&hook));
            proj.hooks.push(PromptwareHookConfig {
                name: hook.clone(),
                when: when.clone(),
                promptwares: promptwares.clone(),
                condition: condition.clone(),
                action: action.clone(),
                extra: Default::default(),
            });
            save_config(&cfg_path, &settings)?;
            println!("Hook '{}' added to project '{}'.", hook, name);
        }
        ProjectCommands::RemoveHook { name, hook } => {
            let proj = settings
                .projects
                .iter_mut()
                .find(|p| p.name.eq_ignore_ascii_case(&name))
                .ok_or_else(|| anyhow::anyhow!("Project '{}' not found", name))?;

            let before = proj.hooks.len();
            proj.hooks.retain(|h| !h.name.eq_ignore_ascii_case(&hook));
            if proj.hooks.len() == before {
                anyhow::bail!("Hook '{}' not found in project '{}'", hook, name);
            }
            save_config(&cfg_path, &settings)?;
            println!("Hook '{}' removed from project '{}'.", hook, name);
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
                            extra: Default::default(),
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
                    extra: Default::default(),
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
