//! JSON-RPC 2.0 envelope handling and the MCP method surface.
//!
//! One JSON object per message. [`McpSession::handle_message`] takes a line and returns the line to
//! write back, or `None` when the message is a notification — a JSON-RPC notification carries no
//! `id` and MUST NOT be answered.
//!
//! The transport (`tendril-cli`) owns stdin/stdout; nothing here touches either, so the whole
//! protocol surface is unit-testable.

use crate::mcp::auth::{McpAuth, TOKEN_META_KEY};
use crate::mcp::dispatch::{McpDispatcher, ToolCallError};
use crate::mcp::tools::get_mcp_tool_definitions;
use serde_json::{json, Value};
use std::path::Path;

/// The revision this server implements.
pub const PREFERRED_PROTOCOL_VERSION: &str = "2025-06-18";

/// Revisions this server will speak if a client asks for one of them. A client's version is echoed
/// back when it is in this set, and [`PREFERRED_PROTOCOL_VERSION`] is answered otherwise, which is
/// how the spec says to signal "I cannot speak yours, here is mine".
pub const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

pub const SERVER_NAME: &str = "tendril";

pub const INSTRUCTIONS: &str = "Tendril plan and job orchestration. Plan mutations respect the same terminal-state guards as the CLI.";

// JSON-RPC error codes. -32001 is in the implementation-defined server range.
pub const PARSE_ERROR: i32 = -32700;
pub const INVALID_REQUEST: i32 = -32600;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const UNAUTHORIZED: i32 = -32001;

/// One client connection: the dispatcher it calls, its authenticator, and the state negotiated by
/// `initialize`.
pub struct McpSession {
    dispatcher: McpDispatcher,
    auth: McpAuth,
    negotiated_version: String,
    initialized: bool,
}

impl McpSession {
    pub fn new(tendril_home: &Path, auth: McpAuth) -> Self {
        Self::with_dispatcher(McpDispatcher::new(tendril_home), auth)
    }

    pub fn with_dispatcher(dispatcher: McpDispatcher, auth: McpAuth) -> Self {
        Self {
            dispatcher,
            auth,
            negotiated_version: PREFERRED_PROTOCOL_VERSION.to_string(),
            initialized: false,
        }
    }

    pub fn negotiated_version(&self) -> &str {
        &self.negotiated_version
    }

    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Handles one line of input. `None` means "write nothing back": either the line was blank or
    /// the message was a notification.
    pub async fn handle_message(&mut self, line: &str) -> Option<String> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return None;
        }

        let message: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(e) => {
                // Parse errors are answered with a null id, since there is no id to echo.
                tracing::warn!("MCP parse error: {}", e);
                return Some(render(error_response(
                    Value::Null,
                    PARSE_ERROR,
                    "Parse error",
                )));
            }
        };

        let id = message.get("id").cloned();
        let is_notification = id.is_none();

        let method = message.get("method").and_then(|m| m.as_str());
        let jsonrpc_ok = message.get("jsonrpc").and_then(|v| v.as_str()) == Some("2.0");

        let Some(method) = method.filter(|_| jsonrpc_ok) else {
            if is_notification {
                tracing::warn!("Ignoring malformed MCP notification");
                return None;
            }
            return Some(render(error_response(
                id.unwrap_or(Value::Null),
                INVALID_REQUEST,
                "Invalid Request",
            )));
        };

        let params = message.get("params").cloned().unwrap_or(Value::Null);

        // A client that presents a token does so per request; on stdio the token comes from the
        // environment instead and this check is inert.
        if let Some(token) = presented_token(&params) {
            if !self.auth.validate(Some(token)) {
                tracing::warn!("Rejected MCP request to {}: unauthorized", method);
                if is_notification {
                    return None;
                }
                return Some(render(error_response(
                    id.unwrap_or(Value::Null),
                    UNAUTHORIZED,
                    "Unauthorized",
                )));
            }
        }

        if is_notification {
            self.handle_notification(method);
            return None;
        }
        let id = id.unwrap_or(Value::Null);

        let response = match method {
            "initialize" => success(id, self.initialize(&params)),
            "ping" => success(id, json!({})),
            "tools/list" => success(id, json!({ "tools": get_mcp_tool_definitions() })),
            "tools/call" => self.tools_call(id, &params).await,
            // Advertised capabilities do not include resources or prompts, so their list methods
            // answer empty rather than "method not found" — clients probe them unconditionally.
            "resources/list" => success(id, json!({ "resources": [] })),
            "resources/templates/list" => success(id, json!({ "resourceTemplates": [] })),
            "prompts/list" => success(id, json!({ "prompts": [] })),
            other => error_response(
                id,
                METHOD_NOT_FOUND,
                &format!("Method not found: {}", other),
            ),
        };

        Some(render(response))
    }

    fn handle_notification(&mut self, method: &str) {
        match method {
            "notifications/initialized" => {
                self.initialized = true;
                tracing::debug!("MCP client reported initialized");
            }
            "notifications/cancelled" => tracing::debug!("MCP client cancelled a request"),
            other => tracing::debug!("Ignoring MCP notification {}", other),
        }
    }

    fn initialize(&mut self, params: &Value) -> Value {
        let requested = params.get("protocolVersion").and_then(|v| v.as_str());
        self.negotiated_version = negotiate_version(requested).to_string();
        if let Some(requested) = requested {
            if requested != self.negotiated_version {
                tracing::warn!(
                    "Client requested unsupported MCP protocol version {}; answering {}",
                    requested,
                    self.negotiated_version
                );
            }
        }

        json!({
            "protocolVersion": self.negotiated_version,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
            "instructions": INSTRUCTIONS,
        })
    }

    async fn tools_call(&mut self, id: Value, params: &Value) -> Value {
        if !self.initialized {
            // Not fatal: some clients pipeline `tools/call` behind `initialize` without waiting for
            // the notification. Worth a log line, not a refusal.
            tracing::warn!("tools/call arrived before notifications/initialized");
        }

        let Some(name) = params.get("name").and_then(|n| n.as_str()) else {
            return error_response(
                id,
                INVALID_PARAMS,
                "Invalid params: 'name' is required and must be a string",
            );
        };

        let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);

        match self.dispatcher.call(name, &arguments).await {
            Ok(outcome) => {
                let mut result = json!({
                    "content": [ { "type": "text", "text": outcome.text } ],
                    "isError": outcome.is_error,
                });
                if let Some(structured) = outcome.structured {
                    result["structuredContent"] = structured;
                }
                success(id, result)
            }
            Err(ToolCallError::UnknownTool(name)) => {
                error_response(id, INVALID_PARAMS, &format!("Unknown tool: {}", name))
            }
            Err(ToolCallError::InvalidParams(detail)) => {
                error_response(id, INVALID_PARAMS, &format!("Invalid params: {}", detail))
            }
        }
    }
}

/// Echoes the client's version when it is supported, and answers the preferred one otherwise.
pub fn negotiate_version(requested: Option<&str>) -> &str {
    match requested {
        Some(version) => SUPPORTED_PROTOCOL_VERSIONS
            .iter()
            .find(|v| **v == version)
            .copied()
            .unwrap_or(PREFERRED_PROTOCOL_VERSION),
        None => PREFERRED_PROTOCOL_VERSION,
    }
}

/// The token a client presented in `params._meta`, if any.
fn presented_token(params: &Value) -> Option<&str> {
    params
        .get("_meta")
        .and_then(|m| m.get(TOKEN_META_KEY))
        .and_then(|t| t.as_str())
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
}

fn success(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn render(response: Value) -> String {
    // Compact, single-line: the framing is one JSON object per line.
    response.to_string()
}
