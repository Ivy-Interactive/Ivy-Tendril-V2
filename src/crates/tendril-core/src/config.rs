//! `config.yaml` and the Tendril home: the settings document, where everything lives under the
//! home directory, and the `.master` mastership election that decides which process owns it.
//!
//! The modules are grouped by responsibility rather than by layer. `settings` and `sections`
//! are the document itself; `env`, `home`, `expansion` and `paths` resolve where things
//! live; `persistence` reads and writes the file. The mastership half stacks in one direction —
//! `process` answers "is that pid alive", `master_info` is the `.master` document,
//! `master_file` reads and writes it, and `master_guard` is the election built on all three.
//! `verifications` operates on the verification lists inside a project.
//!
//! Every public item is re-exported here, so `crate::config::*` — which `lib.rs` re-exports in turn
//! — is the same surface it has always been.

mod env;
mod expansion;
mod home;
mod master_file;
mod master_guard;
mod master_info;
mod paths;
mod persistence;
mod process;
mod sections;
mod settings;
mod verifications;

pub use env::{dirs_home, dirs_home_with_env, EnvSource, SystemEnv};
pub use expansion::{expand_config_path, expand_variables, expand_variables_with_env};
pub use home::{
    ensure_not_real_home, get_default_tendril_home, get_default_tendril_home_with_env,
    get_tendril_home, get_tendril_home_with_env, in_test_context, real_user_tendril_home,
};
pub use master_file::{
    delete_master, delete_master_if_pid, inspect_master_file, is_master, read_master,
    read_master_claim, try_claim_master, write_master, write_master_claim, write_master_info,
    MasterFileKind,
};
pub use master_guard::{MasterCheck, MasterGuard};
pub use master_info::{
    default_capabilities, generate_bearer_secret, MasterClaim, MasterInfo, MASTER_SCHEMA_VERSION,
};
pub use paths::{
    ensure_home_directories, get_config_path, get_config_path_with_env, get_database_path,
    get_hooks_dir, get_plans_dir, get_plans_dir_with_env, get_plans_dir_with_settings,
    get_project_mcp_dir, get_project_memory_dir, get_project_repos_dir, get_project_root_dir,
    get_project_skills_dir, normalize_slashes, sanitize_project_name,
};
pub use persistence::{load_config, save_config, update_config_raw};
pub use process::{
    is_process_running, probe_health, probe_health_with_retries, process_start_token,
    HEALTH_PROBE_ATTEMPTS,
};
pub use sections::{
    AgentConfig, AgentProfileConfig, ApiSettings, AuthConfig, InboxConfig, LlmConfig,
    LoginRateLimitConfig, OnboardingConfig, PromptwareConfig, SecuritySettings,
};
pub use settings::{chat_mode_is_terminal, TendrilSettings, CHAT_MODE_CHAT, CHAT_MODE_TERMINAL};
pub use verifications::{
    find_projects_referencing_verification, insert_project_verification, move_project_verification,
    remove_verification_from_projects, VerificationPlacement,
};
