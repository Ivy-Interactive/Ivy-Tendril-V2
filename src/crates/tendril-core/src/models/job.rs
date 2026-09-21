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

    /// Issue title, when the issue is *not* about the plan itself. The promptware normally builds
    /// title and body out of `plan.yaml` plus the latest revision; a caller that has its own subject
    /// — today, a recommendation being filed for later — passes it here and the plan read is
    /// skipped.
    ///
    /// `folder_path` stays required even then: the job is still plan-scoped, because that is what
    /// resolves the working directory, the project and the plan column in the Jobs view. The
    /// override changes what the issue *says*, not which plan the job belongs to.
    #[serde(rename = "titleOverride", skip_serializing_if = "Option::is_none")]
    pub title_override: Option<String>,
    /// Issue body to use instead of the plan's Problem / Solution / Tests sections. Paired with
    /// [`Self::title_override`]; supplying one without the other is accepted and leaves the other
    /// side to the plan.
    #[serde(rename = "bodyOverride", skip_serializing_if = "Option::is_none")]
    pub body_override: Option<String>,
    /// What the override came from, for the issue's footer and the job log: `"planId::title"` for a
    /// recommendation. Opaque to the promptware beyond being echoed, so a future caller can use its
    /// own spelling.
    #[serde(rename = "issueSource", skip_serializing_if = "Option::is_none")]
    pub issue_source: Option<String>,
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

    /// Replaces the plan reference with the resolved folder, so everything downstream reads one
    /// spelling of it. Used by [`crate::jobs::manager::JobManager::start_job_with`] to canonicalize a
    /// submission that named a plan by its bare id.
    ///
    /// Deliberately does **not** cover `SetupProject`, whose `folder_path` holds a *project name* and
    /// not a plan reference — `resolve_project` reads it as one and `resolve_working_directory` looks
    /// the project up by it, so rewriting it would point a setup job at a plan folder.
    pub fn set_plan_folder(&mut self, folder: String) {
        match self {
            Self::ExecutePlan(a) => a.folder_path = folder,
            Self::RetryPlan(a) => a.folder_path = folder,
            Self::ExpandPlan(a) => a.folder_path = folder,
            Self::UpdatePlan(a) => a.folder_path = folder,
            Self::SplitPlan(a) => a.folder_path = folder,
            Self::CreatePr(a) => a.folder_path = folder,
            Self::CreateIssue(a) => a.folder_path = folder,
            Self::SyncRepo(a) => a.plan_folder_path = Some(folder),
            Self::SetupProject(_) | Self::CreatePlan(_) | Self::AddProject(_) => {}
        }
    }

    /// Canonical identity of the *work* this submission asks for, or `None` for a job type that is
    /// not deduplicated. Two submissions with equal keys are the same work, so the second one is a
    /// conflict rather than a second job, worktree and agent.
    ///
    /// This is narrower than [`crate::jobs::manager::conflict_group`], which asks whether two job
    /// types would *fight* over one plan. Both gates run: the group check catches an `ExecutePlan`
    /// launched while a `CreatePr` holds the same plan, and this key catches the same work submitted
    /// twice — including `CreatePlan`, which has no plan folder to group on at all.
    pub fn dedupe_key(&self) -> Option<String> {
        match self {
            // A plan does not exist yet, so the work is identified by what was asked for.
            Self::CreatePlan(a) => Some(format!(
                "CreatePlan|{}|{}",
                a.project.trim().to_lowercase(),
                normalize_description(&a.description)
            )),
            // CreateIssue is the one plan-scoped type that can legitimately run more than once
            // against the same plan, so it cannot key on the folder alone.
            //
            // Recommendations live *inside* their source plan's `plan.yaml`, and one completed plan
            // routinely yields several. Filing two of them as issues is two different pieces of
            // work, but on the folder-only key below both submissions hash to
            // `CreateIssue|<folder>` and the second is refused as duplicate work — which the
            // operator sees as a button that silently stops responding after the first click.
            //
            // So the subject joins the key. `issue_source` is the stable identity when the caller
            // has one (`planId::title` for a recommendation); the title is the fallback, normalized
            // the same way a CreatePlan description is so that two spellings of one request still
            // collide. With neither, the key degrades to the folder and the old behaviour stands:
            // one issue per plan, which is right for an issue that *is* about the plan.
            Self::CreateIssue(a) => {
                let folder = a.folder_path.trim_end_matches(['/', '\\']).trim();
                if folder.is_empty() {
                    return None;
                }
                let subject = a
                    .issue_source
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(normalize_description)
                    .or_else(|| {
                        a.title_override
                            .as_deref()
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(normalize_description)
                    });
                Some(match subject {
                    Some(subject) => format!("CreateIssue|{}|{}", folder, subject),
                    None => format!("CreateIssue|{}", folder),
                })
            }
            // Every plan-scoped type keys on its folder: one plan, one in-flight job of that type.
            // The type is part of the key, so an ExpandPlan and an ExecutePlan on the same plan do
            // not collide here. The folder is *not* lowercased — Linux paths are case-sensitive, and
            // two genuinely different plans could differ only in case.
            _ => self.plan_folder().and_then(|f| {
                let folder = f.trim_end_matches(['/', '\\']).trim();
                (!folder.is_empty()).then(|| format!("{}|{}", self.job_type(), folder))
            }),
        }
    }

    /// The operator's explicit "yes, again" for this submission. Only `CreatePlan` carries it in its
    /// own args; every other type is forced through [`crate::jobs::StartOptions::force`].
    pub fn force_flag(&self) -> bool {
        matches!(self, Self::CreatePlan(a) if a.force)
    }
}

/// Trim, collapse internal whitespace runs to one space, lowercase. Two descriptions that differ
/// only in how they were typed are the same request.
fn normalize_description(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
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
    /// Set when this job's `Running` row was restored across a daemon restart with its PID still
    /// alive. Never persisted: like `typed_args`, it is rehydrated in memory only, by
    /// [`crate::jobs::manager::JobManager::supervise_detached`], so a row loaded straight from SQLite
    /// always reads `false` here even for a job that is in fact detached.
    #[serde(default)]
    pub detached: bool,
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
    /// Higher runs first. Taken from `CreatePlanArgs.priority`, else the plan's `plan.yaml` priority.
    #[serde(default)]
    pub priority: i32,
    /// Last time the agent emitted a line. `None` until first output; the watchdog then anchors on
    /// `started_at`.
    #[serde(rename = "lastOutputAt", skip_serializing_if = "Option::is_none")]
    pub last_output_at: Option<DateTime<Utc>>,
    /// Job ids this job waits on before it may be queued.
    #[serde(
        rename = "waitForJobIds",
        default,
        skip_serializing_if = "Vec::is_empty"
    )]
    pub wait_for_job_ids: Vec<String>,
    /// Identity of the work this job does, from [`JobArgs::dedupe_key`]. `None` for a job type that
    /// is not deduplicated and for a forced submission, which opts out of dedupe entirely.
    #[serde(rename = "dedupeKey", skip_serializing_if = "Option::is_none")]
    pub dedupe_key: Option<String>,
    /// Client-supplied identity of the *submission* that created this job, from
    /// [`crate::jobs::manager::StartOptions::idempotency_key`]. Unlike `dedupe_key`, which the server
    /// derives from the work, this one is the caller's own handle on its request: a second start
    /// carrying a key already recorded here is answered with this job instead of a new one. Written
    /// once, at insert.
    #[serde(rename = "idempotencyKey", skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    /// The chat conversation this job was started from, so that conversation can list the job in its
    /// header and be told when it finishes. Supplied by `tendril job start --chat-session` (or the
    /// `TENDRIL_CHAT_SESSION_ID` the chat exports into its agent's environment); inherited from the
    /// plan the job names when neither was given. `None` for a job started from a terminal or by the
    /// scheduler, which have no conversation to report to.
    #[serde(rename = "chatSessionId", skip_serializing_if = "Option::is_none")]
    pub chat_session_id: Option<String>,
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
            detached: false,
            previous_plan_state: None,
            reported_plan_id: None,
            reported_plan_title: None,
            reported_failure_reason: None,
            permission_denials: None,
            cleared: false,
            priority: 0,
            last_output_at: None,
            wait_for_job_ids: Vec::new(),
            dedupe_key: None,
            idempotency_key: None,
            chat_session_id: None,
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
