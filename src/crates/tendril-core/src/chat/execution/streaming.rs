//! How the eventwire lines a turn streams accumulate into the message body.

use crate::agents::eventwire::event_wire_text;

/// The text one eventwire line adds to the answer being built, or `None` when it adds nothing.
///
/// A `delta` event is a chunk and is appended verbatim. A non-delta event is a whole message (how
/// Claude, Codex and Gemini send prose), and gets a blank line in front of it so consecutive messages
/// read as paragraphs instead of running together.
///
/// V1 *replaces* the accumulated text on a non-delta event (`ChatExecutionService`:
/// `LastText = IsDelta ? LastText + text : text`) because its `ChatWidget` renders the whole turn
/// from the raw stream and only falls back to `content`. V2's row renders prose from `content` and
/// only the tool activity from the stream, so dropping earlier messages would lose them from the
/// thread entirely — they are appended instead.
pub(super) fn next_text_delta(accumulated: &str, wire_line: &str) -> Option<String> {
    let (text, is_delta) = event_wire_text(wire_line)?;
    if text.is_empty() {
        return None;
    }
    if is_delta || accumulated.is_empty() || accumulated.ends_with('\n') {
        return Some(text);
    }
    Some(format!("\n\n{}", text))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// How the eventwire text events a turn receives accumulate into the message body.
    ///
    /// Which shapes yield a text event at all is covered by
    /// [`crate::agents::eventwire`]'s own tests, against streams captured from real CLI runs.
    #[test]
    fn test_next_text_delta_accumulation() {
        let chunk = |text: &str| crate::agents::eventwire::text_event(text, true);
        let whole = |text: &str| crate::agents::eventwire::text_event(text, false);

        // Chunks append verbatim: Antigravity's `text_delta`, and any provider streaming partials.
        assert_eq!(
            next_text_delta("", &chunk("Yes, ")).as_deref(),
            Some("Yes, ")
        );
        assert_eq!(
            next_text_delta("Yes, ", &chunk("I am alive.")).as_deref(),
            Some("I am alive.")
        );

        // Whole messages become paragraphs rather than running into the previous one.
        assert_eq!(
            next_text_delta("", &whole("Reading it.")).as_deref(),
            Some("Reading it.")
        );
        assert_eq!(
            next_text_delta("Reading it.", &whole("It says X.")).as_deref(),
            Some("\n\nIt says X.")
        );
        // ...unless the text so far already ended a line.
        assert_eq!(
            next_text_delta("Reading it.\n", &whole("It says X.")).as_deref(),
            Some("It says X.")
        );

        // Nothing else contributes to the body: tool traffic, thinking, the result echo, stderr.
        for line in [
            r#"{"kind":"tool_call","tool_use_id":"t1","tool_name":"Bash"}"#.to_string(),
            r#"{"kind":"tool_result","tool_use_id":"t1","output":"ok","is_error":false}"#
                .to_string(),
            r#"{"kind":"thinking","content":"hmm"}"#.to_string(),
            r#"{"kind":"result","response":"Yes, I am alive.","is_success":true}"#.to_string(),
            crate::agents::eventwire::text_event("[stderr] boom", true),
            crate::agents::eventwire::text_event("", true),
            "not json".to_string(),
        ] {
            assert_eq!(
                next_text_delta("Yes, I am alive.", &line),
                None,
                "line: {}",
                line
            );
        }
    }
}
