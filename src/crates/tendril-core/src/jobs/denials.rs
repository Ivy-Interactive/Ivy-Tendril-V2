//! Surfaces the permission denials an agent hit during a run.
//!
//! A job crippled by a missing allowlist entry looks, from the outside, like a job that decided to
//! do nothing. The provider records every refused tool call in its terminal result event, so the
//! evidence is already on disk — it just has to be read out and put in front of the user.
//!
//! Denials never fail a job by themselves. They explain a job that failed or produced nothing.

use crate::jobs::failure_analysis::parse_json_object;
use serde_json::Value;

/// One refused tool call: what was asked for, and enough of the input to recognise it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionDenial {
    pub tool_name: String,
    pub input_summary: Option<String>,
}

/// Longest input summary kept for a denial, matching the frontend's tool-input summarisation.
const MAX_INPUT_SUMMARY: usize = 80;

/// Every denial recorded in the output stream, deduplicated on tool name plus input summary.
///
/// Reads the `permission_denials` array off any event line that carries one — the provider puts it on
/// its terminal result event — and requires a non-empty `tool_name`, so a malformed entry is dropped
/// rather than reported as an anonymous denial.
pub fn extract_permission_denials(lines: &[String]) -> Vec<PermissionDenial> {
    let mut denials: Vec<PermissionDenial> = Vec::new();

    for line in lines {
        let Some(v) = parse_json_object(line) else {
            continue;
        };

        // The eventwire form emits one denial per event; the provider form nests an array on the
        // result event. Handle both.
        if v.get("kind").and_then(|k| k.as_str()) == Some("permission_denial") {
            if let Some(denial) = denial_from_value(&v) {
                push_unique(&mut denials, denial);
            }
            continue;
        }

        let Some(items) = v.get("permission_denials").and_then(|d| d.as_array()) else {
            continue;
        };
        for item in items {
            if let Some(denial) = denial_from_value(item) {
                push_unique(&mut denials, denial);
            }
        }
    }

    denials
}

/// A one-line summary for the Jobs UI, e.g. `Permission denied: Bash, Write (3 calls)`.
pub fn summarize_denials(denials: &[PermissionDenial]) -> String {
    let mut tool_names: Vec<&str> = Vec::new();
    for d in denials {
        if !tool_names.contains(&d.tool_name.as_str()) {
            tool_names.push(&d.tool_name);
        }
    }

    format!(
        "Permission denied: {} ({} call{})",
        tool_names.join(", "),
        denials.len(),
        if denials.len() == 1 { "" } else { "s" }
    )
}

/// Appends the detail lines a job log should carry: up to five denials, then a count of the rest.
pub fn describe_denials(denials: &[PermissionDenial]) -> Vec<String> {
    let mut out: Vec<String> = denials
        .iter()
        .take(5)
        .map(|d| match &d.input_summary {
            Some(summary) => format!("{}({})", d.tool_name, summary),
            None => d.tool_name.clone(),
        })
        .collect();

    if denials.len() > 5 {
        out.push(format!("... and {} more", denials.len() - 5));
    }
    out
}

fn denial_from_value(v: &Value) -> Option<PermissionDenial> {
    let tool_name = v
        .get("tool_name")
        .or_else(|| v.get("toolName"))
        .and_then(|n| n.as_str())
        .unwrap_or_default()
        .trim();
    if tool_name.is_empty() {
        return None;
    }

    Some(PermissionDenial {
        tool_name: tool_name.to_string(),
        input_summary: summarize_input(v),
    })
}

/// The most recognisable part of a refused call: the file it touched, or the command it ran.
fn summarize_input(v: &Value) -> Option<String> {
    if let Some(summary) = v.get("input_summary").and_then(|s| s.as_str()) {
        let trimmed = summary.trim();
        if !trimmed.is_empty() {
            return Some(truncate(trimmed));
        }
    }

    let input = v.get("tool_input").or_else(|| v.get("toolInput"))?;
    for field in ["file_path", "filePath", "command"] {
        if let Some(value) = input.get(field).and_then(|f| f.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(truncate(trimmed));
            }
        }
    }
    None
}

fn truncate(text: &str) -> String {
    if text.chars().count() <= MAX_INPUT_SUMMARY {
        return text.to_string();
    }
    text.chars().take(MAX_INPUT_SUMMARY).collect()
}

fn push_unique(denials: &mut Vec<PermissionDenial>, denial: PermissionDenial) {
    if !denials.contains(&denial) {
        denials.push(denial);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_denials_off_the_provider_result_event() {
        let line = r#"{"type":"result","subtype":"success","permission_denials":[{"tool_name":"Bash","tool_use_id":"t1","tool_input":{"command":"rm -rf /"}},{"tool_name":"Write","tool_use_id":"t2","tool_input":{"file_path":"/etc/hosts"}}]}"#;
        let denials = extract_permission_denials(&[line.to_string()]);
        assert_eq!(denials.len(), 2);
        assert_eq!(denials[0].tool_name, "Bash");
        assert_eq!(denials[0].input_summary.as_deref(), Some("rm -rf /"));
        assert_eq!(denials[1].input_summary.as_deref(), Some("/etc/hosts"));
        assert_eq!(
            summarize_denials(&denials),
            "Permission denied: Bash, Write (2 calls)"
        );
    }

    #[test]
    fn reads_denials_off_the_eventwire_form_and_deduplicates() {
        let line = r#"{"kind":"permission_denial","tool_name":"Bash","input_summary":"git push"}"#;
        let denials = extract_permission_denials(&[line.to_string(), line.to_string()]);
        assert_eq!(denials.len(), 1);
        assert_eq!(
            summarize_denials(&denials),
            "Permission denied: Bash (1 call)"
        );
    }

    #[test]
    fn an_entry_without_a_tool_name_is_dropped() {
        let line =
            r#"{"type":"result","permission_denials":[{"tool_use_id":"t1"},{"tool_name":"  "}]}"#;
        assert!(extract_permission_denials(&[line.to_string()]).is_empty());
    }

    #[test]
    fn describes_at_most_five_denials() {
        let denials: Vec<PermissionDenial> = (0..7)
            .map(|i| PermissionDenial {
                tool_name: format!("Tool{}", i),
                input_summary: None,
            })
            .collect();
        let described = describe_denials(&denials);
        assert_eq!(described.len(), 6);
        assert_eq!(described[5], "... and 2 more");
    }

    #[test]
    fn a_long_command_summary_is_truncated_on_a_char_boundary() {
        let command = "é".repeat(200);
        let line = format!(
            r#"{{"type":"result","permission_denials":[{{"tool_name":"Bash","tool_input":{{"command":"{}"}}}}]}}"#,
            command
        );
        let denials = extract_permission_denials(&[line]);
        assert_eq!(
            denials[0].input_summary.as_ref().unwrap().chars().count(),
            80
        );
    }
}
