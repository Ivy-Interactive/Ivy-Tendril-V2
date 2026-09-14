use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PlanStatus {
    Draft,
    Creating,
    Updating,
    Executing,
    Completed,
    Failed,
    Review,
    Skipped,
    Icebox,
    Blocked,
}

impl PlanStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "Draft",
            Self::Creating => "Creating",
            Self::Updating => "Updating",
            Self::Executing => "Executing",
            Self::Completed => "Completed",
            Self::Failed => "Failed",
            Self::Review => "Review",
            Self::Skipped => "Skipped",
            Self::Icebox => "Icebox",
            Self::Blocked => "Blocked",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "draft" => Some(Self::Draft),
            "creating" => Some(Self::Creating),
            "updating" => Some(Self::Updating),
            "executing" => Some(Self::Executing),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "review" => Some(Self::Review),
            "skipped" => Some(Self::Skipped),
            "icebox" => Some(Self::Icebox),
            "blocked" => Some(Self::Blocked),
            _ => None,
        }
    }
}

impl std::fmt::Display for PlanStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum VerificationStatus {
    Pending,
    Pass,
    Fail,
    Skipped,
}

impl VerificationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "Pending",
            Self::Pass => "Pass",
            Self::Fail => "Fail",
            Self::Skipped => "Skipped",
        }
    }

    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "pending" => Some(Self::Pending),
            "pass" => Some(Self::Pass),
            "fail" => Some(Self::Fail),
            "skipped" => Some(Self::Skipped),
            _ => None,
        }
    }
}

impl std::fmt::Display for VerificationStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanVerificationEntry {
    pub name: String,
    #[serde(default = "default_verification_status")]
    pub status: VerificationStatus,
}

fn default_verification_status() -> VerificationStatus {
    VerificationStatus::Pending
}

pub struct RecommendationStatus;
impl RecommendationStatus {
    pub const PENDING: &'static str = "Pending";
    pub const ACCEPTED: &'static str = "Accepted";
    pub const ACCEPTED_WITH_NOTES: &'static str = "AcceptedWithNotes";
    pub const DECLINED: &'static str = "Declined";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recommendation {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_recommendation_state")]
    pub state: String,
    #[serde(rename = "declineReason", skip_serializing_if = "Option::is_none")]
    pub decline_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact: Option<String>,
}

fn default_recommendation_state() -> String {
    RecommendationStatus::PENDING.to_string()
}

/// A worktree created for a plan, as recorded in `plan.yaml`. Written when the worktree is created
/// and dropped when it is reclaimed, so the reaper knows which repo and branch a directory belongs
/// to without having to parse its `.git` file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanWorktreeEntry {
    /// Repo root the worktree was cut from.
    pub repo: String,
    /// Absolute worktree path.
    pub path: String,
    /// `tendril/<planFolderName>`.
    pub branch: String,
    pub created: DateTime<Utc>,
}

pub const CURRENT_SCHEMA_VERSION: i32 = 3;

fn default_schema_version() -> i32 {
    CURRENT_SCHEMA_VERSION
}

fn default_state() -> String {
    "Draft".to_string()
}

fn default_project() -> String {
    "Auto".to_string()
}

fn default_level() -> String {
    "Feature".to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanYaml {
    #[serde(rename = "schemaVersion", default = "default_schema_version")]
    pub schema_version: i32,

    #[serde(default = "default_state")]
    pub state: String,

    #[serde(default = "default_project")]
    pub project: String,

    #[serde(default = "default_level")]
    pub level: String,

    #[serde(default)]
    pub title: String,

    #[serde(default)]
    pub repos: Vec<String>,

    #[serde(default = "Utc::now")]
    pub created: DateTime<Utc>,

    #[serde(default = "Utc::now")]
    pub updated: DateTime<Utc>,

    #[serde(default)]
    pub prs: Vec<String>,

    #[serde(default)]
    pub commits: Vec<String>,

    /// Worktrees created for this plan. Absent on every plan written before the registry existed,
    /// which is why the reaper also finds worktrees by directory scan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktrees: Option<Vec<PlanWorktreeEntry>>,

    #[serde(default)]
    pub verifications: Vec<PlanVerificationEntry>,

    #[serde(rename = "relatedPlans", default)]
    pub related_plans: Vec<String>,

    #[serde(rename = "dependsOn", default)]
    pub depends_on: Vec<String>,

    #[serde(default)]
    pub priority: i32,

    #[serde(rename = "partialDelivery", default)]
    pub partial_delivery: bool,

    #[serde(rename = "executionProfile", skip_serializing_if = "Option::is_none")]
    pub execution_profile: Option<String>,

    #[serde(rename = "initialPrompt", skip_serializing_if = "Option::is_none")]
    pub initial_prompt: Option<String>,

    #[serde(rename = "sourceUrl", skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommendations: Option<Vec<Recommendation>>,

    #[serde(rename = "chatSessionId", skip_serializing_if = "Option::is_none")]
    pub chat_session_id: Option<String>,

    /// The TCP port assigned to each of the project's named service ports for this plan. Absent for
    /// plans whose project configures no ports, so `plan.yaml` is unchanged for them.
    #[serde(
        rename = "allocatedPorts",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub allocated_ports: Option<std::collections::BTreeMap<String, u16>>,

    #[serde(flatten)]
    pub extra: std::collections::BTreeMap<String, serde_yaml::Value>,
}

impl Default for PlanYaml {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            state: "Draft".to_string(),
            project: "Auto".to_string(),
            level: "Feature".to_string(),
            title: String::new(),
            repos: Vec::new(),
            created: Utc::now(),
            updated: Utc::now(),
            prs: Vec::new(),
            commits: Vec::new(),
            worktrees: None,
            verifications: Vec::new(),
            related_plans: Vec::new(),
            depends_on: Vec::new(),
            priority: 0,
            partial_delivery: false,
            execution_profile: None,
            initial_prompt: None,
            source_url: None,
            recommendations: None,
            chat_session_id: None,
            allocated_ports: None,
            extra: std::collections::BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanMetadata {
    pub id: i32,
    pub project: String,
    pub level: String,
    pub title: String,
    pub state: PlanStatus,
    pub repos: Vec<String>,
    pub commits: Vec<String>,
    pub prs: Vec<String>,
    pub verifications: Vec<PlanVerificationEntry>,
    pub related_plans: Vec<String>,
    pub depends_on: Vec<String>,
    pub created: DateTime<Utc>,
    pub updated: DateTime<Utc>,
    pub initial_prompt: Option<String>,
    pub source_url: Option<String>,
    pub partial_delivery: bool,
    pub chat_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanFile {
    pub metadata: PlanMetadata,
    pub latest_revision_content: String,
    pub folder_path: String,
    pub folder_name: String,
    pub yaml_raw: String,
    pub revision_count: i32,
}

impl PlanFile {
    pub fn id(&self) -> i32 {
        self.metadata.id
    }

    pub fn title(&self) -> &str {
        &self.metadata.title
    }

    pub fn project(&self) -> &str {
        &self.metadata.project
    }

    pub fn level(&self) -> &str {
        &self.metadata.level
    }

    pub fn status(&self) -> PlanStatus {
        self.metadata.state
    }

    pub fn is_pull_request_source(&self) -> bool {
        self.metadata
            .source_url
            .as_ref()
            .is_some_and(|u| u.contains("/pull/"))
    }

    pub fn chat_session_id(&self) -> Option<&str> {
        self.metadata.chat_session_id.as_deref()
    }
}
