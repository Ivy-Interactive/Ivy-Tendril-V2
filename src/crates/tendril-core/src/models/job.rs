use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum JobStatus {
    Pending,
    Queued,
    Running,
    Completed,
    Failed,
    Timeout,
    Stopped,
    Blocked,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Queued => "Queued",
            Self::Running => "Running",
            Self::Completed => "Completed",
            Self::Failed => "Failed",
            Self::Timeout => "Timeout",
            Self::Stopped => "Stopped",
            Self::Blocked => "Blocked",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "pending" => Some(Self::Pending),
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "timeout" => Some(Self::Timeout),
            "stopped" => Some(Self::Stopped),
            "blocked" => Some(Self::Blocked),
            _ => None,
        }
    }
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlanArgs {
    pub description: String,
    pub project: String,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub force: bool,
    #[serde(rename = "sourcePath", skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    /// Upload session whose attachments move into the plan folder once the plan exists.
    #[serde(rename = "uploadSessionId", skip_serializing_if = "Option::is_none")]
    pub upload_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutePlanArgs {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPlanArgs {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    #[serde(rename = "changeRequest")]
    pub change_request: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpandPlanArgs {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlanArgs {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    /// Upload session whose attachments move into the plan folder when the update succeeds.
    #[serde(rename = "uploadSessionId", skip_serializing_if = "Option::is_none")]
    pub upload_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitPlanArgs {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePrArgs {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    #[serde(rename = "solveMergeConflicts", default = "default_true")]
    pub solve_merge_conflicts: bool,
    #[serde(default = "default_true")]
    pub merge: bool,
    #[serde(rename = "deleteBranch", default = "default_true")]
    pub delete_branch: bool,
    #[serde(rename = "includeArtifacts", default = "default_true")]
    pub include_artifacts: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewers: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default)]
    pub draft: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIssueArgs {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
    pub repo: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupProjectArgs {
    #[serde(rename = "folderPath")]
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRepoArgs {
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    #[serde(rename = "baseBranch")]
    pub base_branch: String,
    #[serde(rename = "planFolderPath", skip_serializing_if = "Option::is_none")]
    pub plan_folder_path: Option<String>,
    #[serde(rename = "untrackedChangesPolicy", default = "default_stash")]
    pub untracked_changes_policy: String,
}

fn default_stash() -> String {
    "Stash".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddProjectArgs {
    #[serde(rename = "projectName")]
    pub project_name: String,
    #[serde(default)]
    pub repos: Vec<crate::models::project::RepoRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum JobArgs {
    CreatePlan(CreatePlanArgs),
    ExecutePlan(ExecutePlanArgs),
    RetryPlan(RetryPlanArgs),
    ExpandPlan(ExpandPlanArgs),
    UpdatePlan(UpdatePlanArgs),
    SplitPlan(SplitPlanArgs),
    CreatePr(CreatePrArgs),
    CreateIssue(CreateIssueArgs),
    SetupProject(SetupProjectArgs),
    SyncRepo(SyncRepoArgs),
    AddProject(AddProjectArgs),
}

impl JobArgs {
    pub fn job_type(&self) -> &'static str {
        match self {
            Self::CreatePlan(_) => "CreatePlan",
            Self::ExecutePlan(_) => "ExecutePlan",
            Self::RetryPlan(_) => "RetryPlan",
            Self::ExpandPlan(_) => "ExpandPlan",
            Self::UpdatePlan(_) => "UpdatePlan",
            Self::SplitPlan(_) => "SplitPlan",
            Self::CreatePr(_) => "CreatePr",
            Self::CreateIssue(_) => "CreateIssue",
            Self::SetupProject(_) => "SetupProject",
            Self::SyncRepo(_) => "SyncRepo",
            Self::AddProject(_) => "AddProject",
        }
    }

    pub fn plan_folder(&self) -> Option<&str> {
        match self {
            Self::ExecutePlan(a) => Some(&a.folder_path),
            Self::RetryPlan(a) => Some(&a.folder_path),
            Self::ExpandPlan(a) => Some(&a.folder_path),
            Self::UpdatePlan(a) => Some(&a.folder_path),
            Self::SplitPlan(a) => Some(&a.folder_path),
            Self::CreatePr(a) => Some(&a.folder_path),
            Self::CreateIssue(a) => Some(&a.folder_path),
            Self::SetupProject(a) => Some(&a.folder_path),
            Self::SyncRepo(a) => a.plan_folder_path.as_deref(),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobItem {
    pub id: String,
    #[serde(rename = "type")]
    pub job_type: String,
    #[serde(rename = "planFile", default)]
    pub plan_file: String,
    #[serde(default)]
    pub project: String,
    pub status: JobStatus,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(rename = "executionProfile", skip_serializing_if = "Option::is_none")]
    pub execution_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(rename = "startedAt", skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(rename = "completedAt", skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(rename = "durationSeconds", skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens: Option<i64>,
    #[serde(rename = "inputTokens", skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(rename = "outputTokens", skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(rename = "cacheReadTokens", skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<i64>,
    #[serde(rename = "cacheWriteTokens", skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<i64>,
    #[serde(rename = "reasoningTokens", skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<i64>,
    #[serde(rename = "costSource", skip_serializing_if = "Option::is_none")]
    pub cost_source: Option<String>,
    #[serde(rename = "statusMessage", skip_serializing_if = "Option::is_none")]
    pub status_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    #[serde(rename = "typedArgs", skip_serializing_if = "Option::is_none")]
    pub typed_args: Option<JobArgs>,
    #[serde(rename = "workingDirectory", skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(rename = "cliCommand", skip_serializing_if = "Option::is_none")]
    pub cli_command: Option<String>,
    #[serde(rename = "processId", skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u32>,
    /// Plan state captured at launch, restored when the job fails, times out, or is cancelled.
    #[serde(rename = "previousPlanState", skip_serializing_if = "Option::is_none")]
    pub previous_plan_state: Option<String>,
    #[serde(rename = "reportedPlanId", skip_serializing_if = "Option::is_none")]
    pub reported_plan_id: Option<String>,
    #[serde(rename = "reportedPlanTitle", skip_serializing_if = "Option::is_none")]
    pub reported_plan_title: Option<String>,
    #[serde(
        rename = "reportedFailureReason",
        skip_serializing_if = "Option::is_none"
    )]
    pub reported_failure_reason: Option<String>,
    /// Tool calls the agent was refused, one summary line each. Explains a job that failed or did
    /// nothing; never a reason to fail one on its own.
    #[serde(rename = "permissionDenials", skip_serializing_if = "Option::is_none")]
    pub permission_denials: Option<Vec<String>>,
    #[serde(default)]
    pub cleared: bool,
}

fn default_provider() -> String {
    "claude".to_string()
}

impl JobItem {
    pub fn new(id: String, job_type: String, plan_file: String, project: String) -> Self {
        Self {
            id,
            job_type,
            plan_file,
            project,
            status: JobStatus::Pending,
            provider: "claude".to_string(),
            model: None,
            execution_profile: None,
            effort: None,
            started_at: None,
            completed_at: None,
            duration_seconds: None,
            cost: None,
            tokens: None,
            input_tokens: None,
            output_tokens: None,
            cache_read_tokens: None,
            cache_write_tokens: None,
            reasoning_tokens: None,
            cost_source: None,
            status_message: None,
            args: None,
            typed_args: None,
            working_directory: None,
            cli_command: None,
            process_id: None,
            previous_plan_state: None,
            reported_plan_id: None,
            reported_plan_title: None,
            reported_failure_reason: None,
            permission_denials: None,
            cleared: false,
        }
    }

    pub fn resolve_plan_id(&self) -> String {
        if let Some(id) = &self.reported_plan_id {
            if !id.is_empty() {
                return id.clone();
            }
        }
        // Extract 5-digit prefix from plan_file if present
        let file_name = std::path::Path::new(&self.plan_file)
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or(&self.plan_file);

        if file_name.len() >= 5 && file_name.chars().take(5).all(|c| c.is_ascii_digit()) {
            return file_name[..5].to_string();
        }

        String::new()
    }
}
