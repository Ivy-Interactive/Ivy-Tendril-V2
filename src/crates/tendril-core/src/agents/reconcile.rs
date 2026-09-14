//! Closes out tool calls that never received a result when an agent stream ends mid-tool.
//!
//! `AgentViewer` keys "running" purely off a missing `tool_result` for a `tool_call`, so a stream
//! that is cancelled, killed, or simply dies mid-tool leaves that tool's card spinning forever. This
//! is the port of legacy `ToolStreamReconciler`: scan the persisted lines, collect the `tool_use_id`s
//! seen on `tool_call` events, subtract those seen on `tool_result` events, and emit one synthetic
//! `tool_result` per id that is still open, in first-appearance order.
//!
//! Two wire shapes reach here, same as [`crate::jobs::failure_analysis`]: the normalised eventwire
//! form (`{"kind":"tool_call",…}`) and the provider's own form
//! (`{"type":"assistant","message":{"content":[{"type":"tool_use",…}]}}`). Every helper below accepts
//! either.

use crate::jobs::failure_analysis::parse_json_object;
use chrono::Utc;
use serde_json::Value;

/// One tool call that never received a matching result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnclosedToolCall {
    pub tool_use_id: String,
    pub tool_name: String,
}

/// Scans `lines` for `tool_call` ids that have no matching `tool_result`, in first-appearance order.
/// Malformed and non-JSON lines are skipped silently, matching the legacy reconciler's behaviour.
pub fn find_unclosed_tool_calls(lines: &[String]) -> Vec<UnclosedToolCall> {
    let mut order: Vec<String> = Vec::new();
    let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut closed: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in lines {
        let Some(v) = parse_json_object(line) else {
            continue;
        };
        record_calls(&v, &mut order, &mut names);
        record_results(&v, &mut closed);
    }

    order
        .into_iter()
        .filter(|id| !closed.contains(id))
        .map(|id| {
            let tool_name = names
                .get(&id)
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());
            UnclosedToolCall {
                tool_use_id: id,
                tool_name,
            }
        })
        .collect()
}

/// One synthetic `{"kind":"tool_result",…}` line per call in `lines` that never received a result.
/// Empty when there are none, which makes running this over already-reconciled lines a no-op.
pub fn build_missing_result_lines(lines: &[String], output: &str, is_error: bool) -> Vec<String> {
    find_unclosed_tool_calls(lines)
        .into_iter()
        .map(|call| {
            tracing::warn!(
                tool_use_id = %call.tool_use_id,
                tool_name = %call.tool_name,
                "Synthesizing missing tool_result for unclosed tool_call"
            );
            serde_json::json!({
                "kind": "tool_result",
                "timestamp": Utc::now().to_rfc3339(),
                "tool_use_id": call.tool_use_id,
                "tool_name": call.tool_name,
                "output": output,
                "is_error": is_error,
            })
            .to_string()
        })
        .collect()
}

fn record_calls(
    v: &Value,
    order: &mut Vec<String>,
    names: &mut std::collections::HashMap<String, String>,
) {
    // Eventwire form.
    if v.get("kind").and_then(|k| k.as_str()) == Some("tool_call") {
        if let Some(id) = v.get("tool_use_id").and_then(|i| i.as_str()) {
            let name = v
                .get("tool_name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown")
                .to_string();
            note_call(id, name, order, names);
        }
        return;
    }

    // Provider form: an assistant message with tool_use content blocks.
    if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
        let Some(blocks) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            return;
        };
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                continue;
            }
            let Some(id) = block.get("id").and_then(|i| i.as_str()) else {
                continue;
            };
            let name = block
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown")
                .to_string();
            note_call(id, name, order, names);
        }
    }
}

fn note_call(
    id: &str,
    name: String,
    order: &mut Vec<String>,
    names: &mut std::collections::HashMap<String, String>,
) {
    if !names.contains_key(id) {
        order.push(id.to_string());
    }
    names.insert(id.to_string(), name);
}

fn record_results(v: &Value, closed: &mut std::collections::HashSet<String>) {
    // Eventwire form.
    if v.get("kind").and_then(|k| k.as_str()) == Some("tool_result") {
        if let Some(id) = v.get("tool_use_id").and_then(|i| i.as_str()) {
            closed.insert(id.to_string());
        }
        return;
    }

    // Provider form: a user message whose content blocks are tool results.
    if v.get("type").and_then(|t| t.as_str()) == Some("user") {
        let Some(blocks) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            return;
        };
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                continue;
            }
            if let Some(id) = block.get("tool_use_id").and_then(|i| i.as_str()) {
                closed.insert(id.to_string());
            }
        }
    }
}
