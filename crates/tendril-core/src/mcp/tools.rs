use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDefinition {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

pub fn get_mcp_tool_definitions() -> Vec<McpToolDefinition> {
    vec![
        McpToolDefinition {
            name: "tendril_get_plan".to_string(),
            description: "Get detailed information about a Tendril plan by ID or folder name".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "plan_id": {
                        "type": "string",
                        "description": "5-digit plan ID (e.g. 00042) or folder name"
                    }
                },
                "required": ["plan_id"]
            }),
        },
        McpToolDefinition {
            name: "tendril_list_plans".to_string(),
            description: "List Tendril plans with optional filters for project and status".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "project": { "type": "string" },
                    "status": { "type": "string" }
                }
            }),
        },
        McpToolDefinition {
            name: "tendril_start_job".to_string(),
            description: "Start a Tendril background job (CreatePlan, ExecutePlan, RetryPlan, etc.)".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "job_type": { "type": "string" },
                    "plan_id": { "type": "string" },
                    "description": { "type": "string" },
                    "project": { "type": "string" }
                },
                "required": ["job_type"]
            }),
        },
    ]
}
