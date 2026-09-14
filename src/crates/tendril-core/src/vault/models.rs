//! Port of `VaultModels.cs`.
//!
//! Manifest structs carry `#[serde(flatten)] extra` so keys the C# app writes but V2 does not model
//! (`meta`, `hooks`, `mcpServers`, `skills`, `securityPreset`, ...) survive an import → push round
//! trip instead of being silently dropped from a teammate's project.
//!
//! `VaultThemeManifest` and `VaultCatalog.themes` are deliberately absent — the theme subsystem is
//! a separate plan, and `themes/*.json` files in a vault are left untouched by every operation here.
//! `VaultPermissionsManifest` is not modelled either: `permissions.yaml` is copied verbatim.

use crate::models::{
    ProjectMcpServerRef, ProjectVerificationRef, ReviewActionConfig, VerificationConfig,
};
use crate::vault::compat::{
    default_timestamp, deserialize_optional_timestamp, deserialize_timestamp,
    serialize_optional_timestamp, serialize_timestamp,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

type Extra = BTreeMap<String, serde_json::Value>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum VaultItemSyncStatus {
    #[default]
    NotImported,
    UpToDate,
    UpdateAvailable,
    LocalOnly,
    Modified,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAccountOption {
    pub login: String,
    #[serde(rename = "type")]
    pub account_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredVaultRepo {
    pub full_name: String,
    pub repo_url: String,
    pub owner: String,
    pub name: String,
    pub is_private: bool,
    #[serde(default = "default_account_type")]
    pub account_type: String,
}

fn default_account_type() -> String {
    "Organization".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultManifest {
    #[serde(default = "default_schema_version")]
    pub schema_version: i32,
    #[serde(default = "default_vault_name")]
    pub name: String,
    #[serde(default = "default_vault_description")]
    pub description: String,
    #[serde(default)]
    pub version: String,
    #[serde(
        default = "default_timestamp",
        deserialize_with = "deserialize_timestamp",
        serialize_with = "serialize_timestamp"
    )]
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<String>,
    #[serde(flatten)]
    pub extra: Extra,
}

fn default_schema_version() -> i32 {
    1
}

pub fn default_vault_name() -> String {
    "Tendril-Vault".to_string()
}

fn default_vault_description() -> String {
    "Team shared configuration vault for Ivy Tendril".to_string()
}

impl Default for VaultManifest {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            name: default_vault_name(),
            description: default_vault_description(),
            version: String::new(),
            updated_at: Utc::now(),
            updated_by: None,
            extra: Extra::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultRepoRef {
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultProjectManifest {
    #[serde(default = "default_schema_version")]
    pub schema_version: i32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(
        default = "default_timestamp",
        deserialize_with = "deserialize_timestamp",
        serialize_with = "serialize_timestamp"
    )]
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<String>,
    #[serde(default)]
    pub changelog: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub context: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack_hash: Option<String>,
    #[serde(default)]
    pub repos: Vec<VaultRepoRef>,
    #[serde(default)]
    pub verifications: Vec<ProjectVerificationRef>,
    #[serde(default)]
    pub verification_definitions: Vec<VerificationConfig>,
    #[serde(default)]
    pub review_actions: Vec<ReviewActionConfig>,
    #[serde(default)]
    pub build_dependencies: Vec<String>,
    /// Always written through [`crate::vault::sanitizer`] — a vault is a shared repository.
    #[serde(default)]
    pub mcp_servers: Vec<ProjectMcpServerRef>,
    /// `meta`, `hooks`, `skills`, `securityPreset`, `outsideFileAccessPolicy`,
    /// `terminalAutoExecution`, `sandboxMode`, `autoImplementPlans` — modelled by the C# app but
    /// not by V2's `ProjectConfig`. Preserved verbatim.
    #[serde(flatten)]
    pub extra: Extra,
}

pub fn default_color() -> String {
    "Blue".to_string()
}

impl Default for VaultProjectManifest {
    fn default() -> Self {
        Self {
            schema_version: default_schema_version(),
            name: String::new(),
            version: String::new(),
            updated_at: Utc::now(),
            updated_by: None,
            changelog: String::new(),
            color: default_color(),
            context: String::new(),
            stack_hash: None,
            repos: Vec::new(),
            verifications: Vec::new(),
            verification_definitions: Vec::new(),
            review_actions: Vec::new(),
            build_dependencies: Vec::new(),
            mcp_servers: Vec::new(),
            extra: Extra::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCatalogItem {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_color")]
    pub color: String,
    pub stack_hash: Option<String>,
    pub local_version: Option<String>,
    #[serde(default)]
    pub remote_version: String,
    pub latest_changelog: Option<String>,
    #[serde(
        default = "default_timestamp",
        deserialize_with = "deserialize_timestamp",
        serialize_with = "serialize_timestamp"
    )]
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<String>,
    #[serde(default)]
    pub repos_count: i32,
    #[serde(default)]
    pub skills_count: i32,
    #[serde(default)]
    pub mcps_count: i32,
    #[serde(default)]
    pub memories_count: i32,
    #[serde(default)]
    pub review_actions_count: i32,
    #[serde(default)]
    pub verifications_count: i32,
    #[serde(default)]
    pub skill_names: Vec<String>,
    #[serde(default)]
    pub mcp_server_names: Vec<String>,
    #[serde(default)]
    pub memory_file_names: Vec<String>,
    #[serde(default)]
    pub review_action_names: Vec<String>,
    #[serde(default)]
    pub verification_names: Vec<String>,
    #[serde(default)]
    pub sync_status: VaultItemSyncStatus,
    #[serde(default)]
    pub repos: Vec<VaultRepoRef>,
    #[serde(default)]
    pub has_local_conflict: bool,
    pub conflict_reason: Option<String>,
    pub linked_vault_id: Option<String>,
    pub source_vault_id: Option<String>,
    pub source_vault_name: Option<String>,
}

impl Default for VaultCatalogItem {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: String::new(),
            color: default_color(),
            stack_hash: None,
            local_version: None,
            remote_version: String::new(),
            latest_changelog: None,
            updated_at: default_timestamp(),
            updated_by: None,
            repos_count: 0,
            skills_count: 0,
            mcps_count: 0,
            memories_count: 0,
            review_actions_count: 0,
            verifications_count: 0,
            skill_names: Vec::new(),
            mcp_server_names: Vec::new(),
            memory_file_names: Vec::new(),
            review_action_names: Vec::new(),
            verification_names: Vec::new(),
            sync_status: VaultItemSyncStatus::NotImported,
            repos: Vec::new(),
            has_local_conflict: false,
            conflict_reason: None,
            linked_vault_id: None,
            source_vault_id: None,
            source_vault_name: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultCatalog {
    pub manifest: Option<VaultManifest>,
    #[serde(default)]
    pub projects: Vec<VaultCatalogItem>,
    #[serde(default)]
    pub global_skills: Vec<String>,
    #[serde(default)]
    pub global_mcps: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub is_configured: bool,
    #[serde(default)]
    pub repo_url: String,
    #[serde(default)]
    pub local_path: String,
    #[serde(default = "default_branch")]
    pub current_branch: String,
    pub latest_commit: Option<String>,
    #[serde(default)]
    pub commits_ahead: i32,
    #[serde(default)]
    pub commits_behind: i32,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_timestamp",
        serialize_with = "serialize_optional_timestamp"
    )]
    pub last_synced_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub always_up_to_date: bool,
}

fn default_branch() -> String {
    "main".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for VaultStatus {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            is_configured: false,
            repo_url: String::new(),
            local_path: String::new(),
            current_branch: default_branch(),
            latest_commit: None,
            commits_ahead: 0,
            commits_behind: 0,
            last_synced_at: None,
            always_up_to_date: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultExportRequest {
    #[serde(default)]
    pub target_vault_id: Option<String>,
    #[serde(default)]
    pub project_names: Vec<String>,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub changelog: String,
    #[serde(default)]
    pub pr_title: String,
    #[serde(default)]
    pub pr_body: String,
    #[serde(default)]
    pub reviewers: Vec<String>,
    #[serde(default)]
    pub selected_skills: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub selected_mcps: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub selected_memories: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub selected_review_actions: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub selected_verifications: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub sync_permissions: BTreeMap<String, bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultImportRequest {
    #[serde(default)]
    pub source_vault_id: Option<String>,
    #[serde(default)]
    pub project_name: String,
    #[serde(default)]
    pub target_local_project_name: Option<String>,
    #[serde(default)]
    pub local_repo_mappings: BTreeMap<String, String>,
    #[serde(default)]
    pub selected_skills: Option<Vec<String>>,
    #[serde(default)]
    pub selected_mcps: Option<Vec<String>>,
    #[serde(default)]
    pub selected_memories: Option<Vec<String>>,
    #[serde(default)]
    pub selected_review_actions: Option<Vec<String>>,
    #[serde(default)]
    pub selected_verifications: Option<Vec<String>>,
    #[serde(default = "default_true")]
    pub import_permissions: bool,
}

impl Default for VaultImportRequest {
    fn default() -> Self {
        Self {
            source_vault_id: None,
            project_name: String::new(),
            target_local_project_name: None,
            local_repo_mappings: BTreeMap::new(),
            selected_skills: None,
            selected_mcps: None,
            selected_memories: None,
            selected_review_actions: None,
            selected_verifications: None,
            import_permissions: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultPrResult {
    pub success: bool,
    pub pr_url: Option<String>,
    pub branch_name: Option<String>,
    pub error_message: Option<String>,
}

impl VaultPrResult {
    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error_message: Some(error.into()),
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultResult {
    pub success: bool,
    #[serde(default)]
    pub message: String,
    pub error_message: Option<String>,
}

impl VaultResult {
    pub fn ok(message: impl Into<String>) -> Self {
        Self {
            success: true,
            message: message.into(),
            error_message: None,
        }
    }

    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            message: String::new(),
            error_message: Some(error.into()),
        }
    }

    /// A failure carrying both a human-facing `message` and the underlying `errorMessage`, as the C#
    /// `VaultResult` does — the CLI prints the message, the UI shows the detail.
    pub fn failure_with_message(message: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            success: false,
            message: message.into(),
            error_message: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultSyncResult {
    pub success: bool,
    #[serde(default)]
    pub updated_projects_count: i32,
    #[serde(default)]
    pub message: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAssets {
    #[serde(default)]
    pub project_name: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub mcp_servers: Vec<String>,
    #[serde(default)]
    pub memories: Vec<String>,
    #[serde(default)]
    pub review_actions: Vec<String>,
    #[serde(default)]
    pub verifications: Vec<String>,
}
