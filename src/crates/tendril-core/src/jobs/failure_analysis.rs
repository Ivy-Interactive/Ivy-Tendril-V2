//! Turns an agent's output stream into an actionable failure reason.
//!
//! A job that exits non-zero carries `Process exited with code 1` and nothing else unless someone
//! reads the stream. This is the port of the legacy `JobFailureAnalyzer`: a tier list, highest
//! signal first, where a structured terminal event from the agent beats a scraped line, and a git
//! transport failure beats an incidental JSON `"error"` object further down the output.
//!
//! Two output shapes reach here, because [`crate::jobs::manager::finish_job`] reads both logs: the
//! normalised eventwire form (`{"kind":"text",…}`) and the provider's own form
//! (`{"type":"assistant","message":{…}}`). Every helper accepts either.

use regex::Regex;
use serde_json::Value;
use std::sync::LazyLock;

/// Longest failure reason recorded on a job. Legacy caps at the same width.
const MAX_REASON_LEN: usize = 300;

/// How far back from the end of the stream a pattern tier looks.
const PATTERN_WINDOW: usize = 50;

static ANSI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*[A-Za-z]").unwrap());
static MULTI_SPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(" {2,}").unwrap());
static MESSAGE_FIELD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""message":\s*"([^"]+)""#).unwrap());
static FAILURE_ARTIFACT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Failure artifact written:\s*(.+)").unwrap());
static USAGE_LIMIT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)hit your (?:session|usage) limit|usage limit reached|limit reached").unwrap()
});
static CLAUDE_API_MARKER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)rate_limit_error|overloaded_error|authentication_error|api_error").unwrap()
});

/// Transient git / `gh` transport failures. These are the real, actionable cause and must outrank an
/// incidental JSON `"error"` object further down the output (a `gh api` response body, say), which
/// would otherwise be mislabelled as a Claude API problem.
static GIT_GH_PATTERNS: &[&str] = &[
    r"\bfatal:\s",
    "could not resolve host",
    "connection reset",
    "connection timed out",
    "could not connect",
    "failed to connect",
    "kex_exchange_identification",
    r"\bearly EOF\b",
    "RPC failed",
];

/// Claude API errors from the JSON stream. Only specific, unambiguous markers — never a bare
/// `"error": { … }` object, which any tool's JSON output can contain.
static CLAUDE_API_PATTERNS: &[&str] = &[
    r#""type":\s*"error""#,
    "rate_limit_error",
    "overloaded_error",
    "authentication_error",
];

static CREATE_PLAN_PATTERNS: &[&str] = &[
    "ERROR: Plan",
    "WARNING: TENDRIL_HOME",
    "Failed to parse",
    "Repository path does not exist",
];

static VALIDATION_PATTERNS: &[&str] = &[
    r"validation\s+failed",
    r"assertion\s+failed",
    "Repository path does not exist",
    r"\[stderr\].*ERROR:",
];

static PROGRESS_PATTERNS: &[&str] = &[
    "Creating Plan",
    "Executing Plan",
    "Building",
    "Researching",
    "Reading",
    "Analyzing",
    "Writing",
    "Searching",
    r"^\d+%",
    r"^\[.*\]\s+(Starting|Running|Completed)",
];

/// The single entry point: the most specific reason the output supports, or a bare exit-code
/// message when it supports nothing.
pub fn extract_failure_reason(lines: &[String], job_type: &str, exit_code: Option<i32>) -> String {
    let fallback = || match exit_code {
        Some(code) => format!("Process exited with code {}", code),
        None => "Unknown error (exit code non-zero)".to_string(),
    };

    if lines.is_empty() {
        return fallback();
    }

    // 0. A terminal event in the agent's own JSON stream: structured and authoritative, so it wins
    //    over every text-scraping heuristic below.
    if let Some(reason) = try_extract_error_event(lines) {
        return cap(reason);
    }

    if let Some(reason) = find_pattern(lines, GIT_GH_PATTERNS) {
        return cap(reason);
    }

    if let Some(line) = find_pattern(lines, CLAUDE_API_PATTERNS) {
        return cap(parse_claude_api_error(&line));
    }

    if job_type == "CreatePlan" {
        if let Some(reason) = find_pattern(lines, CREATE_PLAN_PATTERNS) {
            return cap(reason);
        }
        if let Some(reason) = try_read_failure_artifact(lines) {
            return cap(reason);
        }
    }

    if let Some(reason) = find_pattern(lines, VALIDATION_PATTERNS) {
        return cap(reason);
    }

    // Search backwards for the last few stderr lines.
    let mut stderr_lines: Vec<String> = Vec::new();
    for line in lines.iter().rev() {
        if stderr_lines.len() >= 3 {
            break;
        }
        if let Some(rest) = line.strip_prefix("[stderr] ") {
            let content = rest.trim();
            if !content.is_empty() && !is_progress_message(content) {
                stderr_lines.insert(0, content.to_string());
            }
        }
    }
    if !stderr_lines.is_empty() {
        return cap(sanitize_for_display(&stderr_lines.join(" | ")));
    }

    // Fall back to the last line that says something.
    for line in lines.iter().rev() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !is_progress_message(trimmed) {
            return cap(sanitize_for_display(trimmed));
        }
    }

    fallback()
}

/// Strips ANSI escapes and control characters, collapses runs of spaces, and drops a leading
/// `undefined:` — the shapes that make a scraped line unreadable in the Jobs UI.
pub fn sanitize_for_display(text: &str) -> String {
    let no_ansi = ANSI_RE.replace_all(text, "");
    let no_control: String = no_ansi
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let collapsed = MULTI_SPACE_RE.replace_all(&no_control, " ");
    let trimmed = collapsed.trim();
    let without_prefix = if trimmed.len() >= "undefined:".len()
        && trimmed[.."undefined:".len()].eq_ignore_ascii_case("undefined:")
    {
        &trimmed["undefined:".len()..]
    } else {
        trimmed
    };
    without_prefix.trim().to_string()
}

/// The agent's own terminal event, scanned from the end: an `error` event with a message, or a
/// result event that reports failure.
pub fn try_extract_error_event(lines: &[String]) -> Option<String> {
    for line in lines.iter().rev() {
        let Some(v) = parse_json_object(line) else {
            continue;
        };

        if is_kind(&v, "error") {
            if let Some(msg) = error_event_message(&v) {
                if !msg.trim().is_empty() {
                    return Some(sanitize_for_display(&msg));
                }
            }
        }

        if is_kind(&v, "result") || is_kind(&v, "turn.completed") {
            if !result_event_failed(&v) {
                continue;
            }
            for field in ["error", "response", "result"] {
                if let Some(text) = v.get(field).and_then(|e| e.as_str()) {
                    if !text.trim().is_empty() {
                        return Some(format_failed_result_message(text));
                    }
                }
            }
        }
    }
    None
}

/// Reads the `## Error Output` section of a failure artifact the agent wrote and pointed at from its
/// output. Absent, unreadable or empty artifacts yield `None`.
pub fn try_read_failure_artifact(lines: &[String]) -> Option<String> {
    let artifact_line = lines
        .iter()
        .find(|l| l.contains("Failure artifact written:") && l.contains("Failed"))?;

    let path = FAILURE_ARTIFACT_RE
        .captures(artifact_line)?
        .get(1)?
        .as_str()
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_string();

    let content = std::fs::read_to_string(&path).ok()?;

    let mut in_error_output = false;
    let mut error_lines: Vec<String> = Vec::new();
    for line in content.lines() {
        if line.starts_with("## Error Output") {
            in_error_output = true;
            continue;
        }
        if line.starts_with("## Investigation Steps") {
            break;
        }
        if in_error_output && !line.starts_with("```") {
            error_lines.push(line.trim().to_string());
        }
    }

    let summary = error_lines
        .into_iter()
        .filter(|l| !l.is_empty())
        .take(3)
        .collect::<Vec<_>>()
        .join(" | ");

    if summary.trim().is_empty() {
        None
    } else {
        Some(sanitize_for_display(&summary))
    }
}

/// The agent's own words carried by one event line: a `text` event, an assistant message, or the
/// terminal result's response. Never a tool result — a run that merely *reads* a file quoting a
/// marker must not be able to claim it.
pub fn agent_text(line: &str) -> Option<String> {
    let v = parse_json_object(line)?;

    if is_kind(&v, "text") {
        return v.get("text").and_then(|t| t.as_str()).map(str::to_string);
    }

    if is_kind(&v, "result") || is_kind(&v, "turn.completed") {
        for field in ["response", "result"] {
            if let Some(text) = v.get(field).and_then(|t| t.as_str()) {
                return Some(text.to_string());
            }
        }
        return None;
    }

    // Provider form: an assistant message with text blocks.
    if v.get("type").and_then(|t| t.as_str()) == Some("assistant") {
        let blocks = v.get("message")?.get("content")?.as_array()?;
        let joined = blocks
            .iter()
            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
        return if joined.is_empty() {
            None
        } else {
            Some(joined)
        };
    }

    None
}

/// The command output carried by one event line, if it is a tool result.
pub fn tool_result_output(line: &str) -> Option<String> {
    let v = parse_json_object(line)?;

    if is_kind(&v, "tool_result") {
        return v.get("output").and_then(|o| o.as_str()).map(str::to_string);
    }

    // Provider form: a user message whose content blocks are tool results.
    if v.get("type").and_then(|t| t.as_str()) == Some("user") {
        let blocks = v.get("message")?.get("content")?.as_array()?;
        let mut parts: Vec<String> = Vec::new();
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                continue;
            }
            match block.get("content") {
                Some(Value::String(s)) => parts.push(s.clone()),
                Some(Value::Array(items)) => {
                    for item in items {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            parts.push(text.to_string());
                        }
                    }
                }
                _ => {}
            }
        }
        return if parts.is_empty() {
            None
        } else {
            Some(parts.join("\n"))
        };
    }

    None
}

/// Parses one output line as a JSON object, cheaply rejecting the many lines that are not.
pub(crate) fn parse_json_object(line: &str) -> Option<Value> {
    let trimmed = line.trim().trim_start_matches('\u{feff}');
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

/// Matches an event line's discriminator in either wire shape (`kind` or `type`).
fn is_kind(v: &Value, kind: &str) -> bool {
    v.get("kind").and_then(|k| k.as_str()) == Some(kind)
        || v.get("type").and_then(|t| t.as_str()) == Some(kind)
}

fn error_event_message(v: &Value) -> Option<String> {
    if let Some(msg) = v.get("message").and_then(|m| m.as_str()) {
        return Some(msg.to_string());
    }
    v.get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
        .map(str::to_string)
}

/// Whether a result event reports failure. `is_error`, an explicit `is_success: false`, a non-null
/// `error`, or a `subtype` other than `success` all count.
fn result_event_failed(v: &Value) -> bool {
    if v.get("is_error")
        .or_else(|| v.get("isError"))
        .and_then(|b| b.as_bool())
        == Some(true)
    {
        return true;
    }
    if v.get("is_success")
        .or_else(|| v.get("isSuccess"))
        .and_then(|b| b.as_bool())
        == Some(false)
    {
        return true;
    }
    if let Some(subtype) = v.get("subtype").and_then(|s| s.as_str()) {
        if subtype != "success" {
            return true;
        }
    }
    v.get("error").map(|e| !e.is_null()).unwrap_or(false)
}

fn format_failed_result_message(response: &str) -> String {
    let first_line = response
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");

    let sanitized = truncate(&sanitize_for_display(first_line), MAX_REASON_LEN);

    if USAGE_LIMIT_RE.is_match(&sanitized) {
        format!("Claude usage limit reached: {}", sanitized)
    } else {
        sanitized
    }
}

/// Frames a message as a Claude API/usage problem only when the line genuinely carries one of its
/// error tokens. A bare `"type":"error"` event is reported as its plain message instead, so the user
/// is not misled toward a quota explanation.
fn parse_claude_api_error(json_error_line: &str) -> String {
    let is_claude_api_error = CLAUDE_API_MARKER_RE.is_match(json_error_line);

    if let Some(caps) = MESSAGE_FIELD_RE.captures(json_error_line) {
        let message = sanitize_for_display(caps.get(1).map(|m| m.as_str()).unwrap_or_default());
        return if is_claude_api_error {
            format!("Claude API: {}", message)
        } else {
            message
        };
    }

    if is_claude_api_error {
        "Claude API error (see output for details)".to_string()
    } else {
        sanitize_for_display(json_error_line)
    }
}

fn is_progress_message(line: &str) -> bool {
    static COMPILED: LazyLock<Vec<Regex>> = LazyLock::new(|| {
        PROGRESS_PATTERNS
            .iter()
            .map(|p| Regex::new(&format!("(?i){}", p)).unwrap())
            .collect()
    });
    COMPILED.iter().any(|re| re.is_match(line))
}

/// Scans backwards over the tail of the output for the first line matching any pattern, and returns
/// it with a line of context either side — the surrounding lines usually carry the detail.
fn find_pattern(lines: &[String], patterns: &[&str]) -> Option<String> {
    let compiled: Vec<Regex> = patterns
        .iter()
        .map(|p| Regex::new(&format!("(?i){}", p)).unwrap())
        .collect();

    let start_bound = lines.len().saturating_sub(PATTERN_WINDOW);
    for i in (start_bound..lines.len()).rev() {
        if compiled.iter().any(|re| re.is_match(&lines[i])) {
            let start = i.saturating_sub(2);
            let end = (i + 1).min(lines.len() - 1);
            let context = lines[start..=end].join(" | ");
            return Some(sanitize_for_display(&context));
        }
    }
    None
}

fn cap(reason: String) -> String {
    truncate(&reason, MAX_REASON_LEN)
}

/// Truncates on a character boundary, so a multi-byte reason cannot panic.
fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn error_event_tier_beats_a_gh_api_json_body() {
        let out = lines(&[
            r#"{"kind":"tool_result","tool_use_id":"t1","output":"{\"error\":{\"message\":\"Not Found\"}}","is_error":false}"#,
            r#"{"kind":"error","message":"Agent aborted: context exhausted"}"#,
        ]);
        assert_eq!(
            extract_failure_reason(&out, "ExecutePlan", Some(1)),
            "Agent aborted: context exhausted"
        );
    }

    #[test]
    fn git_transport_tier_beats_a_bare_error_object() {
        let out = lines(&[
            r#"{"error": {"code": 42}}"#,
            "fatal: could not read from remote repository",
        ]);
        let reason = extract_failure_reason(&out, "ExecutePlan", Some(1));
        assert!(
            reason.contains("could not read from remote repository"),
            "unexpected reason: {}",
            reason
        );
    }

    #[test]
    fn claude_api_marker_is_framed_as_a_usage_problem() {
        // A marker scraped out of a log line, which is what this tier exists for. A well-formed
        // terminal `error` event outranks it and is covered by the tier-0 test above.
        let out = lines(&[
            r#"[stderr] anthropic request failed: {"type":"rate_limit_error","message":"Rate limited"}"#,
        ]);
        let reason = extract_failure_reason(&out, "ExecutePlan", Some(1));
        assert!(
            reason.starts_with("Claude API: Rate limited"),
            "unexpected reason: {}",
            reason
        );
    }

    #[test]
    fn a_terminal_error_event_outranks_the_claude_api_marker_tier() {
        // The same rate-limit payload as a structured terminal event: tier 0 reports the message as
        // the agent framed it, without the scraped-line prefix.
        let out = lines(&[
            r#"{"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}"#,
        ]);
        assert_eq!(
            extract_failure_reason(&out, "ExecutePlan", Some(1)),
            "Rate limited"
        );
    }

    #[test]
    fn stderr_fallback_takes_the_last_three_lines_and_skips_progress() {
        let out = lines(&[
            "[stderr] Reading files",
            "[stderr] first problem",
            "[stderr] second problem",
        ]);
        assert_eq!(
            extract_failure_reason(&out, "ExecutePlan", Some(2)),
            "first problem | second problem"
        );
    }

    #[test]
    fn last_line_fallback_skips_progress_messages() {
        let out = lines(&["something broke badly", "Analyzing results"]);
        assert_eq!(
            extract_failure_reason(&out, "ExecutePlan", Some(1)),
            "something broke badly"
        );
    }

    #[test]
    fn empty_output_falls_back_to_the_exit_code() {
        assert_eq!(
            extract_failure_reason(&[], "ExecutePlan", Some(7)),
            "Process exited with code 7"
        );
        assert_eq!(
            extract_failure_reason(&[], "ExecutePlan", None),
            "Unknown error (exit code non-zero)"
        );
    }

    #[test]
    fn sanitize_strips_ansi_control_chars_and_undefined_prefix() {
        assert_eq!(
            sanitize_for_display("undefined: \u{1b}[31mboom\u{1b}[0m\tand   more"),
            "boom and more"
        );
    }

    #[test]
    fn failed_result_event_reports_its_response_with_usage_framing() {
        let out = lines(&[
            r#"{"kind":"result","is_success":false,"response":"You have hit your usage limit. Try later."}"#,
        ]);
        let reason = extract_failure_reason(&out, "ExecutePlan", Some(1));
        assert_eq!(
            reason,
            "Claude usage limit reached: You have hit your usage limit. Try later."
        );
    }

    #[test]
    fn a_successful_result_event_is_not_a_failure_signal() {
        let out = lines(&[
            r#"{"type":"result","subtype":"success","is_error":false,"result":"all good"}"#,
            "[stderr] the real problem",
        ]);
        assert_eq!(
            extract_failure_reason(&out, "ExecutePlan", Some(1)),
            "the real problem"
        );
    }

    #[test]
    fn agent_text_reads_both_wire_shapes_and_ignores_tool_results() {
        assert_eq!(
            agent_text(r#"{"kind":"text","text":"hello","delta":false}"#).as_deref(),
            Some("hello")
        );
        assert_eq!(
            agent_text(
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi there"}]}}"#
            )
            .as_deref(),
            Some("hi there")
        );
        assert_eq!(
            agent_text(
                r#"{"kind":"tool_result","tool_use_id":"t","output":"hi","is_error":false}"#
            ),
            None
        );
    }

    #[test]
    fn tool_result_output_reads_both_wire_shapes() {
        assert_eq!(
            tool_result_output(
                r#"{"kind":"tool_result","tool_use_id":"t","output":"PlanId: 00042","is_error":false}"#
            )
            .as_deref(),
            Some("PlanId: 00042")
        );
        assert_eq!(
            tool_result_output(
                r#"{"type":"user","message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"PlanId: 00042"}]}]}}"#
            )
            .as_deref(),
            Some("PlanId: 00042")
        );
        assert_eq!(tool_result_output(r#"{"kind":"text","text":"nope"}"#), None);
    }
}
