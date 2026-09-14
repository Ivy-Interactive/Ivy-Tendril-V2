use serde_json::Value;

/// Checks whether a single event line from eventwire or raw jsonl logs indicates truncation.
pub fn is_event_line_truncated(line: &str) -> bool {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return false;
    }

    // Fast substring checks
    if trimmed.contains("\"reason\":\"length\"")
        || trimmed.contains("\"reason\": \"length\"")
        || trimmed.contains("\"finish_reason\":\"length\"")
        || trimmed.contains("\"finish_reason\": \"length\"")
        || trimmed.contains("\"stop_reason\":\"max_tokens\"")
        || trimmed.contains("\"stop_reason\": \"max_tokens\"")
        || trimmed.contains("\"code\":\"output_truncated\"")
        || trimmed.contains("\"code\": \"output_truncated\"")
    {
        return true;
    }

    // JSON structure check
    if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
        if check_json_value_for_truncation(&val) {
            return true;
        }
    }

    false
}

fn check_json_value_for_truncation(val: &Value) -> bool {
    match val {
        Value::Object(map) => {
            if let Some(reason) = map.get("reason").and_then(|v| v.as_str()) {
                if reason == "length" {
                    return true;
                }
            }
            if let Some(reason) = map.get("finish_reason").and_then(|v| v.as_str()) {
                if reason == "length" {
                    return true;
                }
            }
            if let Some(reason) = map.get("stop_reason").and_then(|v| v.as_str()) {
                if reason == "max_tokens" || reason == "length" {
                    return true;
                }
            }
            if let Some(code) = map.get("code").and_then(|v| v.as_str()) {
                if code == "output_truncated" {
                    return true;
                }
            }

            for (_, child) in map {
                if check_json_value_for_truncation(child) {
                    return true;
                }
            }
            false
        }
        Value::Array(arr) => arr.iter().any(check_json_value_for_truncation),
        _ => false,
    }
}

/// Checks the full event log for truncation signals.
pub fn check_event_log_truncation(log_content: &str) -> Option<String> {
    for line in log_content.lines() {
        if is_event_line_truncated(line) {
            return Some("Detected truncation stop reason in event log".to_string());
        }
    }
    None
}

/// Helper struct representing an active fence during markdown scanning.
struct OpenFence {
    fence_char: char,
    length: usize,
    is_question_block: bool,
}

/// Checks markdown text for unclosed code fences or unclosed question blocks.
pub fn check_markdown_truncation(content: &str) -> Option<String> {
    let mut current_fence: Option<OpenFence> = None;

    for line in content.lines() {
        let trimmed_start = line.trim_start();
        let indent = line.len() - trimmed_start.len();

        if indent <= 3 {
            let first_char = trimmed_start.chars().next();
            if let Some(fc @ ('`' | '~')) = first_char {
                let fence_len = trimmed_start.chars().take_while(|&c| c == fc).count();
                if fence_len >= 3 {
                    let remainder = trimmed_start[fence_len..].trim();

                    if let Some(open) = &current_fence {
                        // Check if this closes the open fence
                        if open.fence_char == fc && fence_len >= open.length && remainder.is_empty()
                        {
                            current_fence = None;
                        }
                    } else {
                        // Opening a new fence
                        let is_q = remainder.starts_with("questions") || remainder == "questions";
                        current_fence = Some(OpenFence {
                            fence_char: fc,
                            length: fence_len,
                            is_question_block: is_q,
                        });
                    }
                }
            }
        }
    }

    if let Some(open) = current_fence {
        if open.is_question_block {
            Some("Unclosed question block fence detected".to_string())
        } else {
            Some("Unclosed code fence detected".to_string())
        }
    } else {
        None
    }
}

/// Returns true if markdown content contains any unclosed code fence.
pub fn has_unclosed_code_fence(content: &str) -> bool {
    check_markdown_truncation(content).is_some()
}

/// Returns true if markdown content specifically contains an unclosed questions block.
pub fn has_unclosed_question_block(content: &str) -> bool {
    matches!(
        check_markdown_truncation(content),
        Some(msg) if msg.contains("question block")
    )
}
