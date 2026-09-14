//! Tool dispatch for the MCP server.
//!
//! Plan and config tools call `tendril-core` directly on disk. Job tools go over HTTP to the
//! running daemon, because the `JobManager` and its live job map exist only in the server process —
//! that keeps the daemon's manager the single gate for conflict rejection, priority ordering and
//! concurrency. Neither path shells out to the `tendril` CLI, and nothing here writes to stdout.
//!
//! Every plan-mutating tool passes through [`PlanCompletionGuard::terminal_refusal`] first, so a
//! `Completed` or `Skipped` plan is read-only over MCP. State transitions additionally go through
//! [`PlanCompletionGuard::apply_state`] with `allow_failed_verifications: false` — that flag exists
//! so a human can record a deliberate partial delivery and is not reachable from a model.

use crate::config::{
    get_config_path, get_database_path, get_plans_dir, load_config, read_master, MasterInfo,
};
use crate::db::{open_database, sync_plan};
use crate::http::describe_transport_error;
use crate::mcp::redact::{redact_named, redact_value};
use crate::mcp::tools::find_mcp_tool;
use crate::mcp::validate::validate_arguments;
use crate::models::{
    CreateIssueArgs, CreatePlanArgs, CreatePrArgs, ExecutePlanArgs, ExpandPlanArgs, JobArgs,
    PlanStatus, PlanVerificationEntry, PlanYaml, RetryPlanArgs, SetupProjectArgs, SplitPlanArgs,
    SyncRepoArgs, UpdatePlanArgs, VerificationStatus,
};
use crate::plans::{
    add_recommendation, check_plan_health, create_plan, get_revision, list_plan_verifications,
    list_recommendations, read_plan_file, read_plan_yaml, remove_plan_verification,
    remove_recommendation, resolve_plan_folder, set_plan_verification_status,
    set_recommendation_state, write_plan_yaml, write_revision, CreatePlanOptions,
    PlanCompletionGuard,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

/// Config keys `tendril_get_config` serves. Anything else is refused rather than falling through to
/// the settings' flattened `extra` map, which an operator can put arbitrary secrets in.
pub const PUBLIC_CONFIG_KEYS: &[&str] = &[
    "codingAgent",
    "jobTimeout",
    "staleOutputTimeout",
    "gitTimeout",
    "daemonRequestTimeout",
    "maxConcurrentJobs",
    "planTemplate",
    "planFolder",
    "theme",
    "themeMode",
    "telemetry",
    "beta",
    "levels",
];

/// Correct only when the connection never established. A daemon that accepted the connection and
/// then failed to answer in time is running, so a transport error is classified before it is
/// described — see [`describe_transport_error`].
pub const DAEMON_OFFLINE_MESSAGE: &str =
    "Tendril server is not running. Start it with 'tendril serve' first.";

/// A tool that ran. `is_error` is a *tool execution* error, which the model sees and can adapt to —
/// as distinct from a protocol error, which [`ToolCallError`] carries.
#[derive(Debug, Clone)]
pub struct ToolOutcome {
    pub text: String,
    pub structured: Option<Value>,
    pub is_error: bool,
}

impl ToolOutcome {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            structured: None,
            is_error: false,
        }
    }

    /// A structured payload, serialized into the text block as the spec recommends for clients that
    /// do not read `structuredContent`.
    pub fn structured(value: Value) -> Self {
        Self {
            text: serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string()),
            structured: Some(value),
            is_error: false,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            text: message.into(),
            structured: None,
            is_error: true,
        }
    }
}

/// A protocol-level failure of `tools/call`, reported as a JSON-RPC error rather than a result.
#[derive(Debug, Clone)]
pub enum ToolCallError {
    UnknownTool(String),
    InvalidParams(String),
}

/// A tool execution: `Err` becomes a result with `isError: true`.
type Exec = std::result::Result<ToolOutcome, String>;

pub struct McpDispatcher {
    tendril_home: PathBuf,
    plans_dir: PathBuf,
    http: reqwest::Client,
    /// The budget `http` was built with, kept so a timeout message can name it.
    http_timeout: Option<std::time::Duration>,
}

impl McpDispatcher {
    pub fn new(tendril_home: &Path) -> Self {
        let plans_dir = get_plans_dir(tendril_home);
        Self::with_plans_dir(tendril_home, &plans_dir)
    }

    /// Builds a dispatcher against an explicit plans directory, so a test never depends on an
    /// ambient `TENDRIL_PLANS`.
    pub fn with_plans_dir(tendril_home: &Path, plans_dir: &Path) -> Self {
        let http_timeout = crate::http::daemon_request_timeout_for(tendril_home);
        Self {
            tendril_home: tendril_home.to_path_buf(),
            plans_dir: plans_dir.to_path_buf(),
            http: crate::http::daemon_client_with_timeout(http_timeout),
            http_timeout,
        }
    }

    pub fn tendril_home(&self) -> &Path {
        &self.tendril_home
    }

    pub fn plans_dir(&self) -> &Path {
        &self.plans_dir
    }

    /// Validates `arguments` against the tool's advertised schema, then runs it.
    pub async fn call(
        &self,
        name: &str,
        arguments: &Value,
    ) -> std::result::Result<ToolOutcome, ToolCallError> {
        let definition =
            find_mcp_tool(name).ok_or_else(|| ToolCallError::UnknownTool(name.to_string()))?;

        let arguments = if arguments.is_null() {
            Value::Object(Map::new())
        } else {
            arguments.clone()
        };

        validate_arguments(&definition.input_schema, &arguments)
            .map_err(ToolCallError::InvalidParams)?;

        Ok(match self.execute(name, &arguments).await {
            Ok(outcome) => outcome,
            Err(message) => ToolOutcome::error(message),
        })
    }

    async fn execute(&self, name: &str, args: &Value) -> Exec {
        match name {
            // Plan reads
            "tendril_get_plan" => self.get_plan(args),
            "tendril_list_plans" => self.list_plans(args),
            "tendril_get_revision" => self.get_plan_revision(args),
            "tendril_plan_validate" => self.plan_validate(args),
            "tendril_plan_verification_list" => self.verification_list(args),
            "tendril_plan_rec_list" => self.rec_list(args),

            // Plan writes
            "tendril_plan_create" => self.plan_create(args),
            "tendril_plan_write_revision" => self.plan_write_revision(args),
            "tendril_plan_set" => self.plan_set(args),
            "tendril_plan_set_verification" => self.plan_set_verification(args),
            "tendril_plan_verification_remove" => self.verification_remove(args),
            "tendril_plan_add_repo"
            | "tendril_plan_remove_repo"
            | "tendril_plan_add_pr"
            | "tendril_plan_add_commit"
            | "tendril_plan_add_related_plan"
            | "tendril_plan_remove_related_plan"
            | "tendril_plan_add_depends_on"
            | "tendril_plan_remove_depends_on" => self.plan_list_edit(name, args),
            "tendril_plan_rec_add" => self.rec_add(args),
            "tendril_plan_rec_accept" => self.rec_state(args, "Accepted"),
            "tendril_plan_rec_decline" => self.rec_state(args, "Declined"),
            "tendril_plan_rec_remove" => self.rec_remove(args),

            // Jobs
            "tendril_inbox" => self.inbox(args).await,
            "tendril_start_job" => self.start_job(args).await,
            "tendril_list_jobs" => self.list_jobs(args).await,
            "tendril_get_job" => self.get_job(args).await,
            "tendril_cancel_job" => self.cancel_job(args).await,
            "tendril_job_add_log" => self.job_add_log(args).await,

            // Config reads
            "tendril_get_config" => self.get_config(args),
            "tendril_list_projects" => self.list_projects(),
            "tendril_list_verifications" => self.list_verifications(args),

            // `call` resolves the name against the catalog first, so this is unreachable.
            other => Err(format!("Tool '{}' has no implementation", other)),
        }
    }

    // -----------------------------------------------------------------------
    // Plan reads
    // -----------------------------------------------------------------------

    fn get_plan(&self, args: &Value) -> Exec {
        let folder = self.resolve(args)?;
        let plan_file = read_plan_file(&folder).map_err(|e| e.to_string())?;
        let metadata = serde_json::to_value(&plan_file.metadata).map_err(|e| e.to_string())?;

        if let Some(field) = str_arg(args, "field") {
            let value = match field {
                "revision" => Value::String(plan_file.latest_revision_content.clone()),
                other => {
                    let key = camel_key(other);
                    metadata.get(&key).cloned().ok_or_else(|| {
                        format!(
                            "Plan has no field '{}'. Omit 'field' for the whole plan.",
                            other
                        )
                    })?
                }
            };
            let text = match &value {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            return Ok(ToolOutcome {
                text,
                structured: Some(json!({ field: value })),
                is_error: false,
            });
        }

        Ok(ToolOutcome::structured(json!({
            "folderName": plan_file.folder_name,
            "folderPath": plan_file.folder_path,
            "revisionCount": plan_file.revision_count,
            "metadata": metadata,
            "latestRevision": plan_file.latest_revision_content,
        })))
    }

    fn list_plans(&self, args: &Value) -> Exec {
        let state_filter = str_arg(args, "state")
            .map(|s| {
                PlanStatus::from_str_loose(s).ok_or_else(|| format!("Unknown plan state: {}", s))
            })
            .transpose()?;
        let project = str_arg(args, "project");
        let search = str_arg(args, "search");
        let since = str_arg(args, "since")
            .map(|s| {
                DateTime::parse_from_rfc3339(s)
                    .map(|d| d.with_timezone(&Utc))
                    .map_err(|e| format!("'since' must be an RFC 3339 timestamp: {}", e))
            })
            .transpose()?;

        let db_path = get_database_path(&self.tendril_home);
        let mut plans = if db_path.exists() {
            let conn = open_database(&db_path).map_err(|e| e.to_string())?;
            crate::db::get_plans(&conn, state_filter, project, search).map_err(|e| e.to_string())?
        } else {
            let mut disk = Vec::new();
            if self.plans_dir.exists() {
                let entries = std::fs::read_dir(&self.plans_dir).map_err(|e| e.to_string())?;
                for entry in entries.flatten() {
                    if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                        if let Ok(plan) = read_plan_file(&entry.path()) {
                            disk.push(plan);
                        }
                    }
                }
            }
            disk.retain(|p| {
                if let Some(state) = state_filter {
                    if p.metadata.state != state {
                        return false;
                    }
                }
                if let Some(proj) = project {
                    if !p.metadata.project.eq_ignore_ascii_case(proj) {
                        return false;
                    }
                }
                if let Some(term) = search {
                    let id_str = format!("{:05}", p.metadata.id);
                    let lower = term.to_lowercase();
                    if !p.metadata.title.to_lowercase().contains(&lower) && !id_str.contains(term) {
                        return false;
                    }
                }
                true
            });
            disk.sort_by_key(|p| std::cmp::Reverse(p.metadata.updated));
            disk
        };

        if let Some(cutoff) = since {
            plans.retain(|p| p.metadata.updated >= cutoff);
        }
        if let Some(limit) = usize_arg(args, "limit") {
            plans.truncate(limit);
        }

        let rendered: Vec<Value> = plans
            .iter()
            .map(|p| {
                json!({
                    "id": format!("{:05}", p.metadata.id),
                    "title": p.metadata.title,
                    "state": p.metadata.state.to_string(),
                    "project": p.metadata.project,
                    "level": p.metadata.level,
                    "updated": p.metadata.updated,
                    "folderName": p.folder_name,
                })
            })
            .collect();

        Ok(ToolOutcome::structured(json!({
            "count": rendered.len(),
            "plans": rendered
        })))
    }

    fn get_plan_revision(&self, args: &Value) -> Exec {
        let folder = self.resolve(args)?;
        let number = args
            .get("number")
            .and_then(|n| n.as_i64())
            .map(|n| n as i32);
        let content = get_revision(&folder, number).map_err(|e| e.to_string())?;
        Ok(ToolOutcome::text(content))
    }

    fn plan_validate(&self, args: &Value) -> Exec {
        let folder = self.resolve(args)?;
        let issues = check_plan_health(&folder);
        let rendered: Vec<Value> = issues
            .iter()
            .map(|i| json!({ "severity": i.severity, "message": i.message }))
            .collect();
        Ok(ToolOutcome::structured(json!({
            "healthy": issues.is_empty(),
            "issues": rendered
        })))
    }

    fn verification_list(&self, args: &Value) -> Exec {
        let folder = self.resolve(args)?;
        let entries = list_plan_verifications(&folder).map_err(|e| e.to_string())?;
        let rendered: Vec<Value> = entries
            .iter()
            .map(|v| json!({ "name": v.name, "status": v.status.to_string() }))
            .collect();
        Ok(ToolOutcome::structured(
            json!({ "verifications": rendered }),
        ))
    }

    fn rec_list(&self, args: &Value) -> Exec {
        let folder = self.resolve(args)?;
        let mut recs = list_recommendations(&folder).map_err(|e| e.to_string())?;
        if let Some(state) = str_arg(args, "state") {
            recs.retain(|r| r.state.eq_ignore_ascii_case(state));
        }
        let rendered = serde_json::to_value(&recs).map_err(|e| e.to_string())?;
        Ok(ToolOutcome::structured(
            json!({ "recommendations": rendered }),
        ))
    }

    // -----------------------------------------------------------------------
    // Plan writes
    // -----------------------------------------------------------------------

    fn plan_create(&self, args: &Value) -> Exec {
        let title = required_str(args, "title")?;
        let project = required_str(args, "project")?;

        // Seed the verification rows from the project's configuration, so the plan is verifiable by
        // ExecutePlan without a second call.
        let settings =
            load_config(&get_config_path(&self.tendril_home)).map_err(|e| e.to_string())?;
        let verifications: Vec<PlanVerificationEntry> = settings
            .projects
            .iter()
            .find(|p| p.name.eq_ignore_ascii_case(project))
            .map(|p| {
                p.verifications
                    .iter()
                    .map(|v| PlanVerificationEntry {
                        name: v.name.clone(),
                        status: VerificationStatus::Pending,
                    })
                    .collect()
            })
            .unwrap_or_default();

        let opts = CreatePlanOptions {
            title: title.to_string(),
            project: project.to_string(),
            level: str_arg(args, "level").map(|s| s.to_string()),
            initial_prompt: str_arg(args, "initial_prompt").map(|s| s.to_string()),
            source_url: str_arg(args, "source_url").map(|s| s.to_string()),
            execution_profile: str_arg(args, "execution_profile").map(|s| s.to_string()),
            priority: args
                .get("priority")
                .and_then(|p| p.as_i64())
                .map(|p| p as i32),
            repos: Vec::new(),
            verifications,
            depends_on: string_list(args, "depends_on"),
            related_plans: string_list(args, "related_plans"),
            chat_session_id: None,
        };

        let plan_file = create_plan(&self.plans_dir, opts).map_err(|e| e.to_string())?;
        self.sync(Path::new(&plan_file.folder_path));

        Ok(ToolOutcome::structured(json!({
            "planId": format!("{:05}", plan_file.metadata.id),
            "folderPath": plan_file.folder_path,
            "folderName": plan_file.folder_name,
            "verifications": plan_file
                .metadata
                .verifications
                .iter()
                .map(|v| json!({ "name": v.name, "status": v.status.to_string() }))
                .collect::<Vec<Value>>(),
        })))
    }

    fn plan_write_revision(&self, args: &Value) -> Exec {
        let (folder, _) = self.open_for_write(args, None)?;
        let content = required_str(args, "content")?;
        // check_questions is always on: `--no-question-check` is not exposed over MCP.
        let number = write_revision(&folder, content, true).map_err(|e| e.to_string())?;
        self.sync(&folder);
        Ok(ToolOutcome::structured(json!({
            "revision": format!("{:03}.md", number),
            "number": number,
            "reason": str_arg(args, "reason"),
        })))
    }

    fn plan_set(&self, args: &Value) -> Exec {
        let field = required_str(args, "field")?;
        let value = required_str(args, "value")?;
        let requested = if field.eq_ignore_ascii_case("state") {
            Some(
                PlanStatus::from_str_loose(value)
                    .ok_or_else(|| format!("Invalid state: {}", value))?,
            )
        } else {
            None
        };

        let (folder, mut plan) = self.open_for_write(args, requested)?;
        let plan_id = folder_name(&folder);
        let mut warning = None;

        match field.to_ascii_lowercase().as_str() {
            "state" => {
                let new_state = requested.expect("state parsed above");
                // allow_failed_verifications is hard-coded false: recording a partial delivery is a
                // human's call, not a model's.
                warning = PlanCompletionGuard::apply_state(&mut plan, new_state, false, &plan_id)
                    .map_err(|e| e.to_string())?;
            }
            "title" => plan.title = value.to_string(),
            "level" => plan.level = value.to_string(),
            "project" => plan.project = value.to_string(),
            "executionprofile" => plan.execution_profile = Some(value.to_string()),
            "initialprompt" => plan.initial_prompt = Some(value.to_string()),
            "sourceurl" => plan.source_url = Some(value.to_string()),
            "priority" => {
                plan.priority = value
                    .parse::<i32>()
                    .map_err(|_| format!("priority must be an integer, got '{}'", value))?
            }
            other => return Err(format!("Field '{}' cannot be set over MCP", other)),
        }

        self.commit(&folder, &mut plan)?;
        Ok(ToolOutcome::structured(json!({
            "planId": plan_id,
            "field": field,
            "value": value,
            "warning": warning,
        })))
    }

    fn plan_set_verification(&self, args: &Value) -> Exec {
        let (folder, _) = self.open_for_write(args, None)?;
        let name = required_str(args, "name")?;
        let status_str = required_str(args, "status")?;
        let status = VerificationStatus::from_str_loose(status_str)
            .ok_or_else(|| format!("Invalid verification status: {}", status_str))?;
        let entry =
            set_plan_verification_status(&folder, name, status).map_err(|e| e.to_string())?;
        self.sync(&folder);
        Ok(ToolOutcome::structured(json!({
            "name": entry.name,
            "status": entry.status.to_string()
        })))
    }

    fn verification_remove(&self, args: &Value) -> Exec {
        let (folder, plan) = self.open_for_write(args, None)?;
        let name = required_str(args, "name")?;
        remove_plan_verification(&folder, name).map_err(|e| {
            let current = plan
                .verifications
                .iter()
                .map(|v| v.name.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            format!("{}. Current verifications: {}", e, current)
        })?;
        self.sync(&folder);
        Ok(ToolOutcome::structured(
            json!({ "name": name, "state": "Removed" }),
        ))
    }

    /// The list-valued plan edits: repos, PRs, commits, related plans and dependencies.
    fn plan_list_edit(&self, tool: &str, args: &Value) -> Exec {
        let (folder, mut plan) = self.open_for_write(args, None)?;

        let (field, item) = match tool {
            "tendril_plan_add_repo" | "tendril_plan_remove_repo" => {
                ("repos", required_str(args, "path")?)
            }
            "tendril_plan_add_pr" => ("prs", required_str(args, "url")?),
            "tendril_plan_add_commit" => ("commits", required_str(args, "sha")?),
            "tendril_plan_add_related_plan" | "tendril_plan_remove_related_plan" => {
                ("relatedPlans", required_str(args, "folder")?)
            }
            "tendril_plan_add_depends_on" | "tendril_plan_remove_depends_on" => {
                ("dependsOn", required_str(args, "folder")?)
            }
            other => return Err(format!("Tool '{}' has no implementation", other)),
        };
        let removing = tool.contains("_remove_");

        let list: &mut Vec<String> = match field {
            "repos" => &mut plan.repos,
            "prs" => &mut plan.prs,
            "commits" => &mut plan.commits,
            "relatedPlans" => &mut plan.related_plans,
            _ => &mut plan.depends_on,
        };

        if removing {
            list.retain(|existing| existing != item);
        } else if !list.iter().any(|existing| existing == item) {
            list.push(item.to_string());
        }
        let values = list.clone();

        self.commit(&folder, &mut plan)?;
        Ok(ToolOutcome::structured(json!({
            "planId": folder_name(&folder),
            "field": field,
            "action": if removing { "removed" } else { "added" },
            "item": item,
            "values": values,
        })))
    }

    fn rec_add(&self, args: &Value) -> Exec {
        let (folder, _) = self.open_for_write(args, None)?;
        let title = required_str(args, "title")?;
        add_recommendation(
            &folder,
            title,
            required_str(args, "description")?,
            str_arg(args, "impact"),
        )
        .map_err(|e| e.to_string())?;
        self.sync(&folder);
        Ok(ToolOutcome::structured(
            json!({ "title": title, "state": "Pending" }),
        ))
    }

    fn rec_state(&self, args: &Value, state: &str) -> Exec {
        let (folder, _) = self.open_for_write(args, None)?;
        let title = required_str(args, "title")?;
        set_recommendation_state(&folder, title, state, str_arg(args, "reason"))
            .map_err(|e| e.to_string())?;
        self.sync(&folder);
        Ok(ToolOutcome::structured(
            json!({ "title": title, "state": state }),
        ))
    }

    fn rec_remove(&self, args: &Value) -> Exec {
        let (folder, _) = self.open_for_write(args, None)?;
        let title = required_str(args, "title")?;
        remove_recommendation(&folder, title).map_err(|e| e.to_string())?;
        self.sync(&folder);
        Ok(ToolOutcome::structured(
            json!({ "title": title, "state": "Removed" }),
        ))
    }

    // -----------------------------------------------------------------------
    // Jobs (over HTTP to the daemon)
    // -----------------------------------------------------------------------

    async fn inbox(&self, args: &Value) -> Exec {
        let body = json!({
            "description": required_str(args, "description")?,
            "project": str_arg(args, "project"),
            "sourcePath": str_arg(args, "source_path"),
        });
        let response = self.post("/api/inbox", &body).await?;
        Ok(ToolOutcome::structured(response))
    }

    async fn start_job(&self, args: &Value) -> Exec {
        let request = JobStartRequest {
            job_type: required_str(args, "job_type")?.to_string(),
            plan_id: str_arg(args, "plan_id").map(|s| s.to_string()),
            description: str_arg(args, "description").map(|s| s.to_string()),
            project: str_arg(args, "project").map(|s| s.to_string()),
            note: str_arg(args, "note").map(|s| s.to_string()),
            instructions: str_arg(args, "instructions").map(|s| s.to_string()),
            change_request: str_arg(args, "change_request").map(|s| s.to_string()),
            source_path: str_arg(args, "source_path").map(|s| s.to_string()),
            repo: str_arg(args, "repo").map(|s| s.to_string()),
            assignee: str_arg(args, "assignee").map(|s| s.to_string()),
            reviewers: string_list(args, "reviewers"),
            comment: str_arg(args, "comment").map(|s| s.to_string()),
            labels: str_arg(args, "labels").map(|s| s.to_string()),
            repo_path: str_arg(args, "repo_path").map(|s| s.to_string()),
            base_branch: str_arg(args, "base_branch").map(|s| s.to_string()),
            untracked_policy: str_arg(args, "untracked_policy").map(|s| s.to_string()),
            priority: args
                .get("priority")
                .and_then(|p| p.as_i64())
                .map(|p| p as i32),
            force: bool_arg(args, "force"),
            no_merge: bool_arg(args, "no_merge"),
            no_delete_branch: bool_arg(args, "no_delete_branch"),
            no_artifacts: bool_arg(args, "no_artifacts"),
            draft: bool_arg(args, "draft"),
        };

        let job_args = build_job_args(&request, &self.plans_dir)?;
        let body = serde_json::to_value(&job_args).map_err(|e| e.to_string())?;
        let response = self.post("/api/jobs", &body).await?;
        Ok(ToolOutcome::structured(response))
    }

    async fn list_jobs(&self, args: &Value) -> Exec {
        let mut path = format!("/api/jobs?limit={}", usize_arg(args, "limit").unwrap_or(20));
        if let Some(status) = str_arg(args, "status") {
            path.push_str(&format!("&status={}", status));
        }
        let response = self.get(&path).await?;
        Ok(ToolOutcome::structured(json!({ "jobs": response })))
    }

    async fn get_job(&self, args: &Value) -> Exec {
        let job_id = required_str(args, "job_id")?;
        let response = self.get(&format!("/api/jobs/{}", job_id)).await?;
        Ok(ToolOutcome::structured(response))
    }

    async fn cancel_job(&self, args: &Value) -> Exec {
        let job_id = required_str(args, "job_id")?;
        let body = json!({ "message": str_arg(args, "message") });
        let response = self
            .post(&format!("/api/jobs/{}/cancel", job_id), &body)
            .await?;
        Ok(ToolOutcome::structured(response))
    }

    async fn job_add_log(&self, args: &Value) -> Exec {
        let job_id = required_str(args, "job_id")?;
        let body = json!({
            "action": required_str(args, "action")?,
            "summary": str_arg(args, "summary"),
        });
        let response = self
            .post(&format!("/api/jobs/{}/logs", job_id), &body)
            .await?;
        Ok(ToolOutcome::structured(response))
    }

    // -----------------------------------------------------------------------
    // Config reads
    // -----------------------------------------------------------------------

    fn get_config(&self, args: &Value) -> Exec {
        let settings =
            load_config(&get_config_path(&self.tendril_home)).map_err(|e| e.to_string())?;
        let serialized = serde_json::to_value(&settings).map_err(|e| e.to_string())?;

        if let Some(requested) = str_arg(args, "key") {
            let canonical = PUBLIC_CONFIG_KEYS
                .iter()
                .find(|k| k.eq_ignore_ascii_case(requested))
                .ok_or_else(|| format!("Unknown or non-public config key: {}", requested))?;
            let value = serialized.get(*canonical).cloned().unwrap_or(Value::Null);
            return Ok(ToolOutcome::structured(
                json!({ *canonical: redact_named(canonical, &value) }),
            ));
        }

        let mut out = Map::new();
        for key in PUBLIC_CONFIG_KEYS {
            if let Some(value) = serialized.get(*key) {
                out.insert(key.to_string(), redact_named(key, value));
            }
        }
        Ok(ToolOutcome::structured(Value::Object(out)))
    }

    fn list_projects(&self) -> Exec {
        let settings =
            load_config(&get_config_path(&self.tendril_home)).map_err(|e| e.to_string())?;
        let projects = serde_json::to_value(&settings.projects).map_err(|e| e.to_string())?;
        Ok(ToolOutcome::structured(
            json!({ "projects": redact_value(&projects) }),
        ))
    }

    fn list_verifications(&self, args: &Value) -> Exec {
        let settings =
            load_config(&get_config_path(&self.tendril_home)).map_err(|e| e.to_string())?;
        let mut verifications = settings.verifications;
        if let Some(name) = str_arg(args, "name") {
            verifications.retain(|v| v.name.eq_ignore_ascii_case(name));
            if verifications.is_empty() {
                return Err(format!("No verification named '{}' is configured", name));
            }
        }
        let rendered = serde_json::to_value(&verifications).map_err(|e| e.to_string())?;
        Ok(ToolOutcome::structured(
            json!({ "verifications": redact_value(&rendered) }),
        ))
    }

    // -----------------------------------------------------------------------
    // Shared helpers
    // -----------------------------------------------------------------------

    fn resolve(&self, args: &Value) -> std::result::Result<PathBuf, String> {
        let plan_id = required_str(args, "plan_id")?;
        resolve_plan_folder(plan_id, &self.plans_dir).map_err(|e| e.to_string())
    }

    /// Resolves the plan and refuses the write when the plan is terminal. Every mutating tool goes
    /// through here — not only the state transitions.
    fn open_for_write(
        &self,
        args: &Value,
        requested: Option<PlanStatus>,
    ) -> std::result::Result<(PathBuf, PlanYaml), String> {
        let folder = self.resolve(args)?;
        let (plan, _) = read_plan_yaml(&folder).map_err(|e| e.to_string())?;
        if let Some(reason) = PlanCompletionGuard::terminal_refusal(
            PlanStatus::from_str_loose(&plan.state),
            requested,
        ) {
            return Err(format!(
                "Refused: {} for plan {}. Terminal plans are read-only over MCP.",
                reason,
                folder_name(&folder)
            ));
        }
        Ok((folder, plan))
    }

    fn commit(&self, folder: &Path, plan: &mut PlanYaml) -> std::result::Result<(), String> {
        plan.updated = Utc::now();
        write_plan_yaml(folder, plan).map_err(|e| e.to_string())?;
        self.sync(folder);
        Ok(())
    }

    /// Mirrors the plan into the database, matching the CLI. Best-effort: a missing database is not
    /// a tool failure.
    fn sync(&self, folder: &Path) {
        if let Ok(plan_file) = read_plan_file(folder) {
            if let Ok(conn) = open_database(&get_database_path(&self.tendril_home)) {
                let _ = sync_plan(&conn, &plan_file);
            }
        }
    }

    fn master(&self) -> std::result::Result<MasterInfo, String> {
        read_master(&self.tendril_home).ok_or_else(|| DAEMON_OFFLINE_MESSAGE.to_string())
    }

    async fn get(&self, path: &str) -> std::result::Result<Value, String> {
        let master = self.master()?;
        let url = format!("{}{}", master.base_url(), path);
        let response = self
            .http
            .get(&url)
            .bearer_auth(&master.secret)
            .send()
            .await
            .map_err(|e| describe_transport_error(&e, &master, self.http_timeout))?;
        read_daemon_response(response, &master).await
    }

    async fn post(&self, path: &str, body: &Value) -> std::result::Result<Value, String> {
        let master = self.master()?;
        let url = format!("{}{}", master.base_url(), path);
        let response = self
            .http
            .post(&url)
            .bearer_auth(&master.secret)
            .json(body)
            .send()
            .await
            .map_err(|e| describe_transport_error(&e, &master, self.http_timeout))?;
        read_daemon_response(response, &master).await
    }
}

async fn read_daemon_response(
    response: reqwest::Response,
    master: &MasterInfo,
) -> std::result::Result<Value, String> {
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(format!(
            "Authentication failed: unauthorized request to Tendril daemon at {}",
            master.base_url()
        ));
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Tendril daemon returned {}: {}", status, body));
    }
    serde_json::from_str(&body).map_err(|e| format!("Malformed response from daemon: {}", e))
}

/// The arguments `tendril_start_job` and `tendril job start` share.
#[derive(Debug, Clone, Default)]
pub struct JobStartRequest {
    pub job_type: String,
    pub plan_id: Option<String>,
    pub description: Option<String>,
    pub project: Option<String>,
    pub note: Option<String>,
    pub instructions: Option<String>,
    pub change_request: Option<String>,
    pub source_path: Option<String>,
    pub repo: Option<String>,
    pub assignee: Option<String>,
    pub reviewers: Vec<String>,
    pub comment: Option<String>,
    pub labels: Option<String>,
    pub repo_path: Option<String>,
    pub base_branch: Option<String>,
    pub untracked_policy: Option<String>,
    pub priority: Option<i32>,
    pub force: bool,
    pub no_merge: bool,
    pub no_delete_branch: bool,
    pub no_artifacts: bool,
    pub draft: bool,
}

/// Builds the `JobArgs` for a job start request. The CLI and the MCP dispatcher both call this, so
/// the per-type required-argument rules cannot diverge between them.
pub fn build_job_args(
    request: &JobStartRequest,
    plans_dir: &Path,
) -> std::result::Result<JobArgs, String> {
    let folder = |what: &str| -> std::result::Result<String, String> {
        let plan_id = request
            .plan_id
            .as_deref()
            .ok_or_else(|| format!("<plan-id> is required for {}", what))?;
        resolve_plan_folder(plan_id, plans_dir)
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| e.to_string())
    };

    Ok(match request.job_type.to_ascii_lowercase().as_str() {
        "createplan" => JobArgs::CreatePlan(CreatePlanArgs {
            description: request
                .description
                .clone()
                .ok_or("--description is required for CreatePlan")?,
            project: request
                .project
                .clone()
                .ok_or("--project is required for CreatePlan")?,
            priority: request.priority.unwrap_or(0),
            force: request.force,
            source_path: request.source_path.clone(),
            upload_session_id: None,
        }),
        "executeplan" => JobArgs::ExecutePlan(ExecutePlanArgs {
            folder_path: folder("ExecutePlan")?,
            note: request.note.clone(),
        }),
        "retryplan" => {
            let change_request = request
                .change_request
                .clone()
                .ok_or("--change-request is required for RetryPlan")?;
            JobArgs::RetryPlan(RetryPlanArgs {
                folder_path: folder("RetryPlan")?,
                change_request,
            })
        }
        "expandplan" => JobArgs::ExpandPlan(ExpandPlanArgs {
            folder_path: folder("ExpandPlan")?,
        }),
        "updateplan" => {
            let instructions = request
                .instructions
                .clone()
                .ok_or("--instructions is required for UpdatePlan")?;
            JobArgs::UpdatePlan(UpdatePlanArgs {
                folder_path: folder("UpdatePlan")?,
                instructions: Some(instructions),
                upload_session_id: None,
            })
        }
        "splitplan" => JobArgs::SplitPlan(SplitPlanArgs {
            folder_path: folder("SplitPlan")?,
        }),
        "createpr" => {
            let folder_path = folder("CreatePr")?;
            let mut reviewers = Vec::new();
            for entry in &request.reviewers {
                for part in entry.split(',') {
                    let trimmed = part.trim();
                    if !trimmed.is_empty() {
                        reviewers.push(trimmed.to_string());
                    }
                }
            }
            if reviewers.is_empty() {
                if let Some(assignee) = &request.assignee {
                    reviewers.push(assignee.clone());
                }
            }
            JobArgs::CreatePr(CreatePrArgs {
                folder_path,
                solve_merge_conflicts: true,
                merge: !request.no_merge,
                delete_branch: !request.no_delete_branch,
                include_artifacts: !request.no_artifacts,
                reviewers: if reviewers.is_empty() {
                    None
                } else {
                    Some(reviewers)
                },
                comment: request.comment.clone(),
                draft: request.draft,
            })
        }
        "createissue" => JobArgs::CreateIssue(CreateIssueArgs {
            folder_path: folder("CreateIssue")?,
            repo: request
                .repo
                .clone()
                .ok_or("--repo is required for CreateIssue")?,
            assignee: request.assignee.clone(),
            comment: request.comment.clone(),
            labels: request.labels.clone(),
        }),
        "setupproject" => JobArgs::SetupProject(SetupProjectArgs {
            folder_path: request
                .plan_id
                .clone()
                .ok_or("<project-name> is required for SetupProject")?,
        }),
        "addproject" => JobArgs::AddProject(crate::models::AddProjectArgs {
            project_name: request
                .plan_id
                .clone()
                .ok_or("<project-name> is required for AddProject")?,
            repos: Vec::new(),
        }),
        "syncrepo" => JobArgs::SyncRepo(SyncRepoArgs {
            repo_path: request
                .repo_path
                .clone()
                .ok_or("--repo-path is required for SyncRepo")?,
            base_branch: request
                .base_branch
                .clone()
                .unwrap_or_else(|| "main".to_string()),
            plan_folder_path: None,
            untracked_changes_policy: request
                .untracked_policy
                .clone()
                .unwrap_or_else(|| "Stash".to_string()),
        }),
        other => return Err(format!("Unsupported job type: {}", other)),
    })
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
}

fn required_str<'a>(args: &'a Value, key: &str) -> std::result::Result<&'a str, String> {
    str_arg(args, key).ok_or_else(|| format!("'{}' is required and must not be blank", key))
}

fn bool_arg(args: &Value, key: &str) -> bool {
    args.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn usize_arg(args: &Value, key: &str) -> Option<usize> {
    args.get(key)
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .filter(|v| *v > 0)
}

fn string_list(args: &Value, key: &str) -> Vec<String> {
    args.get(key)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

fn folder_name(folder: &Path) -> String {
    folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Maps a `field` argument onto the camelCase key the serialized plan metadata uses.
fn camel_key(field: &str) -> String {
    match field.to_ascii_lowercase().as_str() {
        "initialprompt" => "initialPrompt".to_string(),
        "sourceurl" => "sourceUrl".to_string(),
        "relatedplans" => "relatedPlans".to_string(),
        "dependson" => "dependsOn".to_string(),
        other => other.to_string(),
    }
}
