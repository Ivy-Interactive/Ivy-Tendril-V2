//! Rewriting a question block's answers into a run of eventwire lines.

use crate::agents::eventwire::text_event;
use crate::questions::apply_question_answers;
use std::collections::HashMap;

/// Rewrites a question block's answers inside a run of eventwire lines, in place. Returns whether
/// any line changed.
///
/// Each line is reparsed so its `text` and `response` fields can be rewritten *inside* the JSON. The
/// alternative - treating the stream as one string - cannot work: a fence in an eventwire line is
/// inside a JSON string with its newlines escaped, so there is no fence to find at the top level and
/// the answer silently went nowhere.
///
/// A line that is not a JSON object, or whose fields the answers do not touch, is left byte-for-byte
/// as it was. The stream is replayed verbatim by `TurnActivity`, so re-rendering a line changes what
/// the reader sees for no reason. Port of the `RawLines` loop shared by V1's
/// `ChatExecutionService.ApplyQuestionAnswers` and `ChatHistoryService.ApplyQuestionAnswers`.
pub(super) fn patch_answers_into_wire_lines(
    lines: &mut Vec<String>,
    answers: &HashMap<String, Vec<String>>,
    answered_content: &str,
) -> bool {
    let mut any_changed = false;
    let mut has_delta_text = false;

    for line in lines.iter_mut() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        let Some(obj) = value.as_object_mut() else {
            continue;
        };

        if is_delta_text_chunk(obj) {
            has_delta_text = true;
        }

        let mut line_changed = false;
        for field in ["text", "response"] {
            let Some(current) = obj.get(field).and_then(|v| v.as_str()).map(str::to_string) else {
                continue;
            };
            let Ok(updated) = apply_question_answers(&current, answers) else {
                continue;
            };
            if updated != current {
                obj.insert(field.to_string(), serde_json::Value::String(updated));
                line_changed = true;
            }
        }

        if line_changed {
            if let Ok(rendered) = serde_json::to_string(&value) {
                *line = rendered;
                any_changed = true;
            }
        }
    }

    // Nothing matched, but the stream was built from deltas: the fence is split across chunks, so no
    // single one holds a whole block to patch. Replace the whole delta run with one settled chunk
    // carrying the answered content - the same consolidation V1 does, and the reason its
    // `ApplyQuestionAnswers_ConsolidatesDeltaTextChunksWhenPresent` exists. Non-text events keep
    // their place, so the tool calls and the result still replay in order.
    if has_delta_text && !any_changed && !answered_content.is_empty() {
        let mut rebuilt: Vec<String> = Vec::with_capacity(lines.len());
        let mut inserted = false;
        for line in lines.iter() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let is_delta_text = serde_json::from_str::<serde_json::Value>(trimmed)
                .ok()
                .and_then(|v| v.as_object().map(is_delta_text_chunk))
                .unwrap_or(false);

            if is_delta_text {
                if !inserted {
                    rebuilt.push(text_event(answered_content, false));
                    inserted = true;
                    any_changed = true;
                }
            } else {
                rebuilt.push(line.clone());
            }
        }
        if any_changed {
            *lines = rebuilt;
        }
    }

    any_changed
}

/// Whether an eventwire object is a streamed text delta - a `text` chunk that appends to what came
/// before rather than replacing it. Only these are collapsed by the consolidation above; a settled
/// chunk already holds whole content and a non-text event is not the agent's prose at all.
fn is_delta_text_chunk(obj: &serde_json::Map<String, serde_json::Value>) -> bool {
    obj.get("kind").and_then(|k| k.as_str()) == Some("text")
        && obj.get("delta").and_then(|d| d.as_bool()) == Some(true)
}
