use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHealthDto {
    pub status: String,
    pub is_healthy: bool,
    pub port: Option<u16>,
    pub api_version: Option<u32>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfoDto {
    pub state: String,
    pub tendril_home: String,
    pub port: Option<u16>,
    pub host: Option<String>,
    pub scheme: Option<String>,
    pub version: Option<String>,
    pub api_version: Option<u32>,
    pub pid: Option<u32>,
    pub capabilities: Vec<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ownership: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_badge: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crash_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogStatusDto {
    pub source: String,
    pub total_model_count: usize,
    pub dynamic_model_count: usize,
    pub static_model_count: usize,
    pub enrich_models: bool,
    pub cached_at: Option<String>,
    pub cache_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanVerificationDto {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSummaryDto {
    pub id: String,
    pub title: String,
    pub state: String,
    pub project: String,
    pub level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(default)]
    pub verifications: Vec<PlanVerificationDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allocated_ports: Option<std::collections::HashMap<String, u16>>,
}

/// Mirrors `Recommendation` in tendril-core `models/plan.rs`. Sourced from the
/// `recommendations` block of the plan's `plan.yaml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationDto {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_recommendation_state")]
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decline_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact: Option<String>,
}

fn default_recommendation_state() -> String {
    "Pending".to_string()
}

/// One verification report read from `<planFolder>/Verification/<name>.md`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReportDto {
    pub name: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDetailDto {
    pub id: String,
    pub title: String,
    pub state: String,
    pub project: String,
    pub level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(default)]
    pub repos: Vec<String>,
    #[serde(default)]
    pub verifications: Vec<PlanVerificationDto>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub related_plans: Vec<String>,
    #[serde(default)]
    pub commits: Vec<String>,
    #[serde(default)]
    pub prs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_revision_content: Option<String>,
    /// Absolute plan folder path (`PlanFile.folder_path`), used to locate
    /// verification reports on disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
    /// `PlanFile.revision_count` — bounds the Diff View revision selectors.
    #[serde(default)]
    pub revision_count: i32,
    #[serde(default)]
    pub recommendations: Vec<RecommendationDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allocated_ports: Option<std::collections::HashMap<String, u16>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionResultDto {
    pub revision: i32,
    pub message: String,
}

/// One repo of a plan, as reported by `GET /api/plans/:id/repo-status`.
///
/// A repo that could not be inspected carries `error` and `is_dirty: false`:
/// the dirty-repo guard degrades to "nothing known to be dirty" rather than
/// blocking execution on an unreadable repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatusDto {
    pub path: String,
    #[serde(default)]
    pub is_dirty: bool,
    /// `git status --porcelain` lines, capped service-side.
    #[serde(default)]
    pub changes: Vec<String>,
    /// Total number of changed entries, which may exceed `changes.len()`.
    #[serde(default)]
    pub change_count: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobDto {
    pub id: String,
    #[serde(rename = "type")]
    pub job_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_title: Option<String>,
    pub project: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobDetailDto {
    pub id: String,
    #[serde(rename = "type")]
    pub job_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_title: Option<String>,
    pub project: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reported_failure_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartJobResponseDto {
    pub job_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewActionDto {
    pub name: String,
    #[serde(default)]
    pub condition: String,
    #[serde(default)]
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryDto {
    pub name: String,
    #[serde(default)]
    pub repos: Vec<String>,
    #[serde(default)]
    pub verifications: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub review_actions: Vec<ReviewActionDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TendrilConfigDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coding_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_timeout: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_concurrent_jobs: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<String>,
    #[serde(default)]
    pub raw: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlanQueryDto {
    pub status: Option<String>,
    pub project: Option<String>,
    pub q: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUserDto {
    pub login: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLabelDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepositoryDto {
    pub name: String,
    pub name_with_owner: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssueDto {
    pub number: u64,
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<GitHubUserDto>,
    #[serde(default)]
    pub assignees: Vec<GitHubUserDto>,
    #[serde(default)]
    pub labels: Vec<GitHubLabelDto>,
    #[serde(default)]
    pub comments_count: u64,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<GitHubRepositoryDto>,
    #[serde(default)]
    pub is_pull_request: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssuesPageDto {
    pub issues: Vec<GitHubIssueDto>,
    pub total_count: Option<u64>,
    pub page: u32,
    pub per_page: u32,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachmentDto {
    #[serde(alias = "Name")]
    pub name: String,
    #[serde(alias = "Path")]
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "MimeType")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(alias = "Role")]
    pub role: String,
    #[serde(alias = "Content")]
    pub content: String,
    #[serde(alias = "Timestamp")]
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "AgentId")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "ModelId")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "RawStream")]
    pub raw_stream: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "Effort")]
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatQueuedItemDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(alias = "Prompt")]
    pub prompt: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "Attachments"
    )]
    pub attachments: Option<Vec<ChatAttachmentDto>>,
    #[serde(alias = "CreatedAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(alias = "Title")]
    pub title: String,
    #[serde(alias = "CreatedAt")]
    pub created_at: String,
    #[serde(alias = "UpdatedAt")]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "AgentId")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "ModelId")]
    pub model_id: Option<String>,
    #[serde(default, alias = "Messages")]
    pub messages: Vec<ChatMessageDto>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "Effort")]
    pub effort: Option<String>,
    #[serde(default, alias = "SpawnedJobIds")]
    pub spawned_job_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionDto {
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "Title")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "AgentId")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "ModelId")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "Effort")]
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PostMessageDto {
    #[serde(alias = "Prompt")]
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "Enqueue")]
    pub enqueue: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "Attachments"
    )]
    pub attachments: Option<Vec<ChatAttachmentDto>>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "Role")]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteTurnDto {
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "Prompt")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "AgentId")]
    pub agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "ModelId")]
    pub model_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "Effort")]
    pub effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueItemDto {
    #[serde(alias = "Prompt")]
    pub prompt: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "Attachments"
    )]
    pub attachments: Option<Vec<ChatAttachmentDto>>,
}

/// One tracked pull request as the daemon last saw it. `status` is `Open` / `Closed` / `Merged` /
/// `Unknown`; `lastChecked` is absent until the first reconciliation pass has seen the PR.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusDto {
    #[serde(default)]
    pub pr_url: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub number: u64,
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_checked: Option<String>,
    #[serde(default)]
    pub plan_id: String,
    #[serde(default)]
    pub plan_folder: String,
    #[serde(default)]
    pub plan_title: String,
    #[serde(default)]
    pub project: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrTransitionDto {
    #[serde(default)]
    pub pr_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default)]
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrSyncReportDto {
    #[serde(default)]
    pub tracked: usize,
    #[serde(default)]
    pub checked: usize,
    #[serde(default)]
    pub skipped_merged: usize,
    #[serde(default)]
    pub skipped_fresh: usize,
    #[serde(default)]
    pub transitions: Vec<PrTransitionDto>,
    #[serde(default)]
    pub completed_plans: Vec<String>,
    #[serde(default)]
    pub refused_completions: Vec<String>,
    #[serde(default)]
    pub unblocked_plans: Vec<String>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelOptionDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(alias = "DisplayName")]
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EffortOptionDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(alias = "DisplayName")]
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentOptionDto {
    #[serde(alias = "Id")]
    pub id: String,
    #[serde(alias = "Label")]
    pub label: String,
    #[serde(default, alias = "Models")]
    pub models: Vec<ModelOptionDto>,
    #[serde(default, alias = "SupportsEffort")]
    pub supports_effort: bool,
    #[serde(default, alias = "Efforts")]
    pub efforts: Vec<EffortOptionDto>,
}
