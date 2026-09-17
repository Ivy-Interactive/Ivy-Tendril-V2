//! The MCP tool catalog.
//!
//! Names keep the legacy `tendril_*` prefix so existing client configs keep working. Every schema
//! sets `additionalProperties: false` and uses only the keywords [`crate::mcp::validate`]
//! implements — `mcp_tools_test` enforces both.
//!
//! **Deliberately not ported from legacy:**
//! - `tendril_set_config` — config is read-only over MCP; a config write from an IDE agent would
//!   silently retarget the coding agent, plan folder or concurrency limit for the whole machine.
//! - `tendril_plan_verification_add` — V2 seeds verification rows from the project config at
//!   plan creation, so adding a row no project defines yields a plan ExecutePlan cannot verify.
//!   `tendril_plan_set_verification` covers the real need (Pending <-> Skipped).
//!   `tendril_plan_verification_remove` has no such problem and is registered below.
//! - `tendril_plan_rec_set` — no V2 core equivalent; `rec_accept` / `_decline` / `_remove` cover
//!   the recommendation lifecycle.
//! - `tendril_plan_update` (whole-YAML replace) — bypasses every guard by construction.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

fn tool(name: &str, description: &str, properties: Value, required: &[&str]) -> McpToolDefinition {
    McpToolDefinition {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: json!({
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        }),
    }
}

fn plan_id_prop() -> Value {
    json!({
        "type": "string",
        "description": "5-digit plan ID (e.g. 00042), folder name, or absolute plan folder path"
    })
}

/// Looks a tool definition up by name.
pub fn find_mcp_tool(name: &str) -> Option<McpToolDefinition> {
    get_mcp_tool_definitions()
        .into_iter()
        .find(|t| t.name == name)
}

pub fn get_mcp_tool_definitions() -> Vec<McpToolDefinition> {
    let mut tools = Vec::new();
    tools.extend(plan_read_tools());
    tools.extend(plan_write_tools());
    tools.extend(job_tools());
    tools.extend(config_tools());
    tools
}

fn plan_read_tools() -> Vec<McpToolDefinition> {
    vec![
        tool(
            "tendril_get_plan",
            "Get a Tendril plan's metadata and latest revision by ID or folder name",
            json!({
                "plan_id": plan_id_prop(),
                "field": {
                    "type": "string",
                    "description": "Return only this field",
                    "enum": ["title", "state", "project", "level", "id", "initialPrompt", "sourceUrl", "priority", "repos", "commits", "prs", "verifications", "relatedPlans", "dependsOn", "revision"]
                }
            }),
            &["plan_id"],
        ),
        tool(
            "tendril_list_plans",
            "List Tendril plans, optionally filtered by state, project, title/ID search or update time",
            json!({
                "state": { "type": "string", "description": "Plan state, e.g. Draft, Executing, Review, Completed" },
                "project": { "type": "string" },
                "search": { "type": "string", "description": "Substring of the title, or a plan ID" },
                "since": { "type": "string", "description": "RFC 3339 timestamp; only plans updated at or after it" },
                "limit": { "type": "integer", "description": "Maximum number of plans to return" }
            }),
            &[],
        ),
        tool(
            "tendril_get_revision",
            "Get the markdown of a plan revision (the latest, or a specific number)",
            json!({
                "plan_id": plan_id_prop(),
                "number": { "type": "integer", "description": "Revision number; omit for the latest" }
            }),
            &["plan_id"],
        ),
        tool(
            "tendril_plan_validate",
            "Check a plan's health and report any structural issues",
            json!({ "plan_id": plan_id_prop() }),
            &["plan_id"],
        ),
        tool(
            "tendril_plan_verification_list",
            "List a plan's verifications and their statuses",
            json!({ "plan_id": plan_id_prop() }),
            &["plan_id"],
        ),
        tool(
            "tendril_plan_rec_list",
            "List a plan's recommendations",
            json!({
                "plan_id": plan_id_prop(),
                "state": { "type": "string", "enum": ["Pending", "Accepted", "AcceptedWithNotes", "Declined"] }
            }),
            &["plan_id"],
        ),
    ]
}

fn plan_write_tools() -> Vec<McpToolDefinition> {
    vec![
        tool(
            "tendril_plan_create",
            "Create a new Tendril plan. Verifications are seeded from the project configuration",
            json!({
                "title": { "type": "string", "description": "Human-readable title in Title Case with spaces" },
                "project": { "type": "string" },
                "level": { "type": "string", "description": "Priority level, e.g. Bug, Feature, Epic, Chore, Nitpick" },
                "initial_prompt": { "type": "string" },
                "source_url": { "type": "string", "description": "GitHub issue or PR URL" },
                "execution_profile": { "type": "string", "enum": ["deep", "balanced"] },
                "priority": { "type": "integer" },
                "related_plans": { "type": "array", "items": { "type": "string" }, "description": "Related plan folder names" },
                "depends_on": { "type": "array", "items": { "type": "string" }, "description": "Dependency plan folder names" }
            }),
            &["title", "project"],
        ),
        tool(
            "tendril_plan_write_revision",
            "Write a new revision of a plan. Question blocks are validated; terminal plans are refused",
            json!({
                "plan_id": plan_id_prop(),
                "content": { "type": "string", "description": "Full markdown of the new revision" },
                "reason": { "type": "string", "description": "Why this edit was made" }
            }),
            &["plan_id", "content"],
        ),
        tool(
            "tendril_plan_set",
            "Set a scalar field on a plan. State transitions go through the completion guard",
            json!({
                "plan_id": plan_id_prop(),
                "field": {
                    "type": "string",
                    "enum": ["state", "title", "level", "project", "executionProfile", "initialPrompt", "sourceUrl", "priority"]
                },
                "value": { "type": "string" }
            }),
            &["plan_id", "field", "value"],
        ),
        tool(
            "tendril_plan_set_verification",
            "Set a plan verification's status",
            json!({
                "plan_id": plan_id_prop(),
                "name": { "type": "string" },
                "status": { "type": "string", "enum": ["Pending", "Pass", "Fail", "Skipped"] }
            }),
            &["plan_id", "name", "status"],
        ),
        tool(
            "tendril_plan_verification_remove",
            "Remove a verification from a plan",
            json!({ "plan_id": plan_id_prop(), "name": { "type": "string" } }),
            &["plan_id", "name"],
        ),
        tool(
            "tendril_plan_add_repo",
            "Add a repository path to a plan",
            json!({ "plan_id": plan_id_prop(), "path": { "type": "string" } }),
            &["plan_id", "path"],
        ),
        tool(
            "tendril_plan_remove_repo",
            "Remove a repository path from a plan",
            json!({ "plan_id": plan_id_prop(), "path": { "type": "string" } }),
            &["plan_id", "path"],
        ),
        tool(
            "tendril_plan_add_pr",
            "Record a pull request URL on a plan",
            json!({ "plan_id": plan_id_prop(), "url": { "type": "string" } }),
            &["plan_id", "url"],
        ),
        tool(
            "tendril_plan_add_commit",
            "Record a commit SHA on a plan",
            json!({ "plan_id": plan_id_prop(), "sha": { "type": "string" } }),
            &["plan_id", "sha"],
        ),
        tool(
            "tendril_plan_add_related_plan",
            "Link another plan as related",
            json!({ "plan_id": plan_id_prop(), "folder": { "type": "string", "description": "Related plan folder name" } }),
            &["plan_id", "folder"],
        ),
        tool(
            "tendril_plan_remove_related_plan",
            "Unlink a related plan",
            json!({ "plan_id": plan_id_prop(), "folder": { "type": "string", "description": "Related plan folder name" } }),
            &["plan_id", "folder"],
        ),
        tool(
            "tendril_plan_add_depends_on",
            "Add a dependency plan. The plan will not execute until the dependency is Completed and its PRs merged",
            json!({ "plan_id": plan_id_prop(), "folder": { "type": "string", "description": "Dependency plan folder name" } }),
            &["plan_id", "folder"],
        ),
        tool(
            "tendril_plan_remove_depends_on",
            "Remove a dependency plan",
            json!({ "plan_id": plan_id_prop(), "folder": { "type": "string", "description": "Dependency plan folder name" } }),
            &["plan_id", "folder"],
        ),
        tool(
            "tendril_plan_rec_add",
            "Add a recommendation to a plan",
            json!({
                "plan_id": plan_id_prop(),
                "title": { "type": "string" },
                "description": { "type": "string", "description": "Markdown description with context and location" },
                "impact": { "type": "string", "enum": ["Small", "Medium", "High"] }
            }),
            &["plan_id", "title", "description"],
        ),
        tool(
            "tendril_plan_rec_accept",
            "Accept a plan recommendation",
            json!({ "plan_id": plan_id_prop(), "title": { "type": "string" } }),
            &["plan_id", "title"],
        ),
        tool(
            "tendril_plan_rec_decline",
            "Decline a plan recommendation",
            json!({
                "plan_id": plan_id_prop(),
                "title": { "type": "string" },
                "reason": { "type": "string" }
            }),
            &["plan_id", "title"],
        ),
        tool(
            "tendril_plan_rec_remove",
            "Remove a plan recommendation",
            json!({ "plan_id": plan_id_prop(), "title": { "type": "string" } }),
            &["plan_id", "title"],
        ),
    ]
}

fn job_tools() -> Vec<McpToolDefinition> {
    vec![
        tool(
            "tendril_inbox",
            "Send a task description to the Tendril inbox, which starts a CreatePlan job",
            json!({
                "description": { "type": "string" },
                "project": { "type": "string", "description": "Target project; omit to let Tendril pick" },
                "source_path": { "type": "string" }
            }),
            &["description"],
        ),
        tool(
            "tendril_start_job",
            "Start a Tendril background job on the running daemon",
            json!({
                "job_type": {
                    "type": "string",
                    "enum": ["CreatePlan", "ExecutePlan", "RetryPlan", "UpdatePlan", "ExpandPlan", "SplitPlan", "CreatePr", "CreateIssue", "SetupProject", "AddProject", "SyncRepo"]
                },
                "plan_id": { "type": "string", "description": "Plan ID or folder (or project name for SetupProject/AddProject)" },
                "description": { "type": "string", "description": "Task description (CreatePlan)" },
                "project": { "type": "string", "description": "Target project (CreatePlan)" },
                "note": { "type": "string", "description": "Execution note (ExecutePlan)" },
                "instructions": { "type": "string", "description": "Refinement instructions (UpdatePlan)" },
                "change_request": { "type": "string", "description": "Reviewer feedback (RetryPlan)" },
                "source_path": { "type": "string", "description": "Source path (CreatePlan)" },
                "repo": { "type": "string", "description": "Repository (CreateIssue)" },
                "assignee": { "type": "string", "description": "Assignee (CreateIssue / CreatePr)" },
                "reviewers": { "type": "array", "items": { "type": "string" }, "description": "Reviewers (CreatePr)" },
                "comment": { "type": "string", "description": "Comment (CreateIssue / CreatePr)" },
                "labels": { "type": "string", "description": "Labels (CreateIssue)" },
                "repo_path": { "type": "string", "description": "Repository path (SyncRepo)" },
                "base_branch": { "type": "string", "description": "Base branch (SyncRepo)" },
                "untracked_policy": { "type": "string", "enum": ["Stash", "Commit", "PullRequest"], "description": "Untracked policy (SyncRepo)" },
                "priority": { "type": "integer", "description": "Priority (CreatePlan)" },
                "force": { "type": "boolean", "description": "Skip the duplicate check (CreatePlan)" },
                "no_merge": { "type": "boolean", "description": "Skip merge (CreatePr)" },
                "no_delete_branch": { "type": "boolean", "description": "Skip branch deletion (CreatePr)" },
                "no_artifacts": { "type": "boolean", "description": "Skip artifacts (CreatePr)" },
                "draft": { "type": "boolean", "description": "Create a draft PR (CreatePr)" },
                "idempotency_key": { "type": "string", "description": "Resubmitting the same key returns the original job instead of starting a second one" },
                "chat_session_id": { "type": "string", "description": "Chat session that asked for this job, so it is tracked in that conversation. Defaults to $TENDRIL_CHAT_SESSION_ID" }
            }),
            &["job_type"],
        ),
        tool(
            "tendril_list_jobs",
            "List Tendril jobs on the running daemon",
            json!({
                "status": { "type": "string", "description": "Job status, e.g. Running, Completed, Failed" },
                "limit": { "type": "integer" }
            }),
            &[],
        ),
        tool(
            "tendril_get_job",
            "Get a Tendril job's status and details",
            json!({ "job_id": { "type": "string" } }),
            &["job_id"],
        ),
        tool(
            "tendril_cancel_job",
            "Cancel a running Tendril job",
            json!({ "job_id": { "type": "string" }, "message": { "type": "string" } }),
            &["job_id"],
        ),
        tool(
            "tendril_job_add_log",
            "Append a narrative log entry to a job's log",
            json!({
                "job_id": { "type": "string" },
                "action": { "type": "string" },
                "summary": { "type": "string" }
            }),
            &["job_id", "action"],
        ),
    ]
}

fn config_tools() -> Vec<McpToolDefinition> {
    vec![
        tool(
            "tendril_get_config",
            "Read a public Tendril configuration value (secrets are never returned)",
            json!({
                "key": { "type": "string", "description": "Config key; omit for every public key" }
            }),
            &[],
        ),
        tool(
            "tendril_list_projects",
            "List configured Tendril projects with their repos and verifications",
            json!({}),
            &[],
        ),
        tool(
            "tendril_list_verifications",
            "List configured verification definitions, or one by name",
            json!({ "name": { "type": "string" } }),
            &[],
        ),
    ]
}
