//! The plumbing every vault operation shares: the injectable `gh` seam, the `git` and YAML
//! wrappers, vault-state load/persist, and the handful of selection and branch helpers more than one
//! operation needs.
//!
//! Nothing here is a vault *operation* — these are the primitives the operation modules in
//! `service::*` are written in terms of, kept together so there is one spelling of "run git in the
//! vault clone" and one of "write this manifest".

use crate::config::{get_config_path, load_config, save_config, TendrilSettings};
use crate::error::Result;
use crate::git::coauthor_hooks::trailer_line;
use crate::git::issues::run_gh_command_raw;
use crate::git::service::run_git;
use crate::models::RepoRef;
use crate::vault::assets::{file_names, file_stems};
use crate::vault::models::VaultManifest;
use crate::vault::settings::{
    ensure_vaults_initialized, load_vaults, save_vaults, split_owner_and_name, vault_index,
    VaultSettings, VaultState,
};
use chrono::Utc;
use futures_util::future::BoxFuture;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// A `gh` invocation yielding `(exit_code, stdout, stderr)`.
///
/// `'static` because the arguments are owned: a runner borrows nothing from its caller, which keeps the
/// future's lifetime out of [`GhRunner`] and lets a test pass a stub held in a local variable.
pub type GhFuture = BoxFuture<'static, Result<(i32, String, String)>>;

/// The injectable `gh` seam. Production code passes [`production_gh`]; tests pass a stub, and a
/// *panicking* stub on any path that must not touch `gh` at all.
pub type GhRunner<'a> = &'a (dyn Fn(Vec<String>, Option<PathBuf>) -> GhFuture + Send + Sync);

/// The real `gh` CLI, via the shared [`run_gh_command_raw`] entry point.
pub fn production_gh(argv: Vec<String>, working_dir: Option<PathBuf>) -> GhFuture {
    Box::pin(async move { run_gh_command_raw(&argv, working_dir.as_deref()).await })
}

pub(super) fn argv(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

/// `yyyy.MM.dd.HHmmss` in UTC, matching the versions already written by the C# app.
pub fn generate_version_timestamp() -> String {
    Utc::now().format("%Y.%m.%d.%H%M%S").to_string()
}

pub(super) fn branch_timestamp() -> String {
    Utc::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Loads settings plus healed vault state.
pub fn load_state(tendril_home: &Path) -> Result<(TendrilSettings, VaultState)> {
    let settings = load_config(&get_config_path(tendril_home))?;
    let mut state = load_vaults(&settings);
    ensure_vaults_initialized(&mut state);
    Ok((settings, state))
}

/// Writes vault state — and any project or verification edits — back into `config.yaml`.
pub fn persist(
    tendril_home: &Path,
    settings: &mut TendrilSettings,
    state: &VaultState,
) -> Result<()> {
    save_vaults(settings, state);
    save_config(&get_config_path(tendril_home), settings)
}

/// Applies a mutation to the stored vault *and* to the `vault:` primary alias when it points at the
/// same vault, keeping the two copies of a primary vault in step.
pub(super) fn update_vault(
    state: &mut VaultState,
    vault_id: &str,
    mutate: impl Fn(&mut VaultSettings),
) {
    if let Some(index) = vault_index(state, vault_id) {
        mutate(&mut state.vaults[index]);
    }
    if let Some(primary) = state.primary.as_mut() {
        if primary.id.eq_ignore_ascii_case(vault_id) {
            mutate(primary);
        }
    }
}

pub(super) fn git_out(dir: &Path, args: &[&str]) -> String {
    match run_git(args, dir) {
        Ok((0, stdout, _)) => stdout.trim().to_string(),
        _ => String::new(),
    }
}

pub(super) fn git_run(dir: &Path, args: &[&str]) -> (i32, String, String) {
    run_git(args, dir).unwrap_or((-1, String::new(), String::new()))
}

/// `git commit` in the vault, carrying the configured `Co-Authored-By` trailer.
///
/// The vault's commits cannot be reached by the hook shim in [`crate::git::coauthor_hooks`]: they run
/// in this daemon process via [`git_run`], not in an agent Tendril spawns, so no `GIT_CONFIG_*`
/// override is in effect. Since these are Rust building an argv rather than an LLM composing a
/// command, `--trailer` is exact and needs no hook at all.
///
/// `--trailer` rather than appending to the `-m` text so that git owns the placement: the trailer
/// lands in the existing trailer block when the message already has one, and the vault's two-`-m`
/// form (subject plus changelog) keeps its blank-line separation.
pub(super) fn git_commit(
    dir: &Path,
    settings: &TendrilSettings,
    message_args: &[&str],
) -> (i32, String, String) {
    let mut args: Vec<&str> = vec!["commit"];
    args.extend_from_slice(message_args);

    let trailer = settings.co_author_identity().map(trailer_line);
    if let Some(trailer) = trailer.as_deref() {
        args.push("--trailer");
        args.push(trailer);
    }

    git_run(dir, &args)
}

pub(super) fn write_yaml<T: serde::Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_yaml::to_string(value)?)?;
    Ok(())
}

pub(super) fn read_yaml<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    Ok(serde_yaml::from_str(&std::fs::read_to_string(path)?)?)
}

/// A GitHub compare URL, used when `gh pr create` fails — the reference treats that as success with a
/// link the user can click.
pub(super) fn compare_url(repo_url: &str, base_branch: &str, branch: &str) -> Option<String> {
    let (owner, name) = split_owner_and_name(repo_url)?;
    Some(format!(
        "https://github.com/{}/{}/compare/{}...{}?expand=1",
        owner, name, base_branch, branch
    ))
}

pub(super) fn repo_paths_by_folder(repos: &[RepoRef]) -> BTreeMap<String, String> {
    repos
        .iter()
        .filter_map(|repo| {
            PathBuf::from(&repo.path)
                .file_name()
                .map(|name| (name.to_string_lossy().to_string(), repo.path.clone()))
        })
        .collect()
}

/// Opens the PR, falling back to a compare URL when `gh pr create` fails — the branch is already
/// pushed, so handing the user a link is more useful than reporting a failure.
#[allow(clippy::too_many_arguments)]
pub(super) async fn create_vault_pr(
    gh: GhRunner<'_>,
    dir: &Path,
    title: &str,
    body: &str,
    base_branch: &str,
    branch: &str,
    reviewers: &[String],
    repo_url: &str,
) -> Result<Option<String>> {
    let mut args = argv(&[
        "pr",
        "create",
        "--title",
        title,
        "--body",
        body,
        "--base",
        base_branch,
        "--head",
        branch,
    ]);
    if !reviewers.is_empty() {
        args.push("--reviewer".to_string());
        args.push(reviewers.join(","));
    }

    let (code, stdout, stderr) = gh(args, Some(dir.to_path_buf())).await?;
    if code != 0 {
        tracing::warn!("gh pr create error in vault: {}", stderr.trim());
    }

    let url = stdout.trim().to_string();
    if url.to_lowercase().starts_with("http") {
        return Ok(Some(url));
    }

    Ok(compare_url(repo_url, base_branch, branch))
}

/// `None` means "everything"; otherwise keep the entries whose name is selected.
pub(super) fn filter_by_name<T: Clone>(
    items: &[T],
    selected: Option<&Vec<String>>,
    name_of: impl Fn(&T) -> String,
) -> Vec<T> {
    match selected {
        None => items.to_vec(),
        Some(selected) => {
            let allowed: BTreeSet<String> =
                selected.iter().map(|name| name.to_lowercase()).collect();
            items
                .iter()
                .filter(|item| allowed.contains(&name_of(item).to_lowercase()))
                .cloned()
                .collect()
        }
    }
}

/// Copies `*.<extension>` between directories, honouring a selection. `by_stem` selects on the name
/// without its extension (skills) rather than the full file name (memories).
pub(super) fn copy_selected(
    from: &Path,
    to: &Path,
    extension: &str,
    selected: Option<&Vec<String>>,
    by_stem: bool,
) -> Result<()> {
    if !from.exists() {
        return Ok(());
    }

    let allowed: Option<BTreeSet<String>> =
        selected.map(|names| names.iter().map(|name| name.to_lowercase()).collect());

    let names = if by_stem {
        file_stems(from, extension)
    } else {
        file_names(from, extension)
    };
    if names.is_empty() {
        return Ok(());
    }

    std::fs::create_dir_all(to)?;
    for name in names {
        if let Some(allowed) = &allowed {
            if !allowed.contains(&name.to_lowercase()) {
                continue;
            }
        }
        let file_name = if by_stem {
            format!("{}.{}", name, extension)
        } else {
            name
        };
        std::fs::copy(from.join(&file_name), to.join(&file_name))?;
    }

    Ok(())
}

/// Resolves the vault's base branch, bootstrapping `main` when the remote has neither `main` nor
/// `master` yet — a freshly created repository has no branches at all, and every other operation here
/// needs something to branch from.
pub(super) async fn ensure_base_branch(
    dir: &Path,
    vault: &mut VaultSettings,
    _gh: GhRunner<'_>,
) -> Result<String> {
    if !git_out(dir, &["ls-remote", "--heads", "origin", "main"]).is_empty() {
        git_run(dir, &["fetch", "origin", "main"]);
        return Ok("main".to_string());
    }

    if !git_out(dir, &["ls-remote", "--heads", "origin", "master"]).is_empty() {
        git_run(dir, &["fetch", "origin", "master"]);
        return Ok("master".to_string());
    }

    let (code, head, _) = git_run(dir, &["rev-parse", "--verify", "HEAD"]);
    if code != 0 || head.trim().is_empty() {
        std::fs::create_dir_all(dir.join("projects"))?;
        std::fs::create_dir_all(dir.join("global").join("skills"))?;
        write_yaml(
            &dir.join("vault.yaml"),
            &VaultManifest {
                name: vault.name.clone(),
                version: generate_version_timestamp(),
                updated_at: Utc::now(),
                ..Default::default()
            },
        )?;
        std::fs::write(
            dir.join("README.md"),
            format!("# {}\n\nTendril Team Configuration Vault.\n", vault.name),
        )?;
        std::fs::write(dir.join(".gitignore"), ".DS_Store\n*.local.yaml\n")?;

        git_run(dir, &["checkout", "-B", "main"]);
        git_run(dir, &["add", "-A"]);
        git_run(dir, &["commit", "-m", "Initial Tendril Vault setup"]);
    } else {
        git_run(dir, &["checkout", "-B", "main"]);
    }
    git_run(dir, &["push", "-u", "origin", "main"]);

    Ok("main".to_string())
}
