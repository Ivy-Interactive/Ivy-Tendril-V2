//! The Tendril Vault: a git repository (usually a private GitHub repo) holding the shareable parts of
//! a team's Tendril configuration — projects, skills, MCP servers, memories, review actions and
//! verification definitions.
//!
//! Ported from `Ivy.Tendril/Services/Vault/`. The on-disk layout is shared with the shipped C# app, so
//! [`compat`] is deliberately lenient about how timestamps are spelled and every manifest carries an
//! `extra` passthrough map: a teammate running either implementation must be able to import, edit and
//! push a project without silently dropping configuration the other one models.
//!
//! [`sanitizer`] is the safety boundary — nothing reaches a shared repository without going through it.
//!
//! The vault *theme* subsystem and the Settings UI dialogs are out of scope here; `themes/*.json` in a
//! vault is left untouched by every operation in this module.

pub mod assets;
pub mod compat;
pub mod models;
pub mod sanitizer;
pub mod service;
pub mod settings;

pub use assets::collect_project_assets;
pub use models::*;
pub use sanitizer::{
    is_sensitive_key, normalize_env_var_name, redact_secrets, sanitize_env_value,
    sanitize_environment, sanitize_environment_map, sanitize_mcp_server, sanitize_mcp_servers,
    sanitize_mcp_servers_value,
};
pub use service::{
    connect_vault, connect_vault_with, create_vault_repo, create_vault_repo_with,
    delete_project_from_vault, delete_project_from_vault_with, disconnect_vault,
    discover_existing_vaults, discover_existing_vaults_with, generate_version_timestamp,
    get_catalog, get_status, get_vaults, import_project, import_project_with,
    import_project_with_mappings, list_github_accounts, list_github_accounts_with, merge_project,
    production_gh, project_assets, pull_latest, pull_latest_with, push_and_create_pr,
    push_and_create_pr_with, set_always_up_to_date, vault_project_dir, GhFuture, GhRunner,
};
pub use settings::{
    ensure_vaults_initialized, extract_repo_name, find_vault, load_vaults, new_vault_id,
    normalize_repo_url, resolve_vault, save_vaults, split_owner_and_name, strip_git_suffix,
    vault_dir, vault_index, ProjectVaultTracking, VaultSettings, VaultState, VAULTS_KEY, VAULT_KEY,
};
