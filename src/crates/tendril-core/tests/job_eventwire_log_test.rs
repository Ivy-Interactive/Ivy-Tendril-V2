//! A job's `.eventwire.jsonl` has to actually be eventwire.
//!
//! `parseEventWireStream` (`packages/components/.../parse-events.ts`) keeps only lines carrying a
//! `kind` and silently drops everything else, and both `TurnActivity` and `AgentViewer` read through
//! it. The job path wrote the *provider's own* line into a file named `.eventwire.jsonl`, so
//! `JobSessionView` had nothing to render — for every provider, not one. The chat turn normalises
//! through `EventWireNormalizer`; this pins that the job path uses the same layer, since a file name
//! is not a format and nothing else was catching the difference.

use tendril_core::agents::eventwire::EventWireNormalizer;

/// Real `claude --output-format stream-json` lines, and real `agy` lines, as the CLIs emit them.
const CLAUDE_LINES: &[&str] = &[
    r#"{"type":"system","subtype":"init","session_id":"abc","tools":["Read"]}"#,
    r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/etc/hostname"}}]}}"#,
    r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"host"}]}}"#,
    r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}"#,
    r#"{"type":"result","subtype":"success","result":"Done.","total_cost_usd":0.01}"#,
];

/// Antigravity ties a tool call's two halves together only by `step_index`, which is why the
/// normalizer is stateful and why the job path must hold one instance across the whole run.
const ANTIGRAVITY_LINES: &[&str] = &[
    r#"{"event":"init","conversation_id":"c1","init":{"cwd":"/repo","permission_mode":"always-proceed"}}"#,
    r#"{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"parameters":{"path":"a.txt"}}}}"#,
    r#"{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool","tool_name":"view_file","tool_info":{"output":"1 lines"}}}"#,
    r#"{"event":"step_update","step_update":{"step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"Yes."}}"#,
    r#"{"event":"result","result":{"status":"SUCCESS","response":"Yes.","num_turns":1}}"#,
];

/// Normalises a whole run through one normalizer, as the job path's `FnMut` closure does.
fn normalize_run(lines: &[&str]) -> Vec<serde_json::Value> {
    let mut normalizer = EventWireNormalizer::new();
    let mut out = Vec::new();
    for line in lines {
        for produced in normalizer.normalize(line, false) {
            out.push(
                serde_json::from_str(&produced)
                    .unwrap_or_else(|_| panic!("normalizer emitted non-JSON: {produced}")),
            );
        }
    }
    out
}

fn kinds(events: &[serde_json::Value]) -> Vec<&str> {
    events
        .iter()
        .filter_map(|e| e.get("kind").and_then(|k| k.as_str()))
        .collect()
}

/// The regression itself: a provider line carries no `kind`, so appending it raw renders nothing.
#[test]
fn a_providers_own_line_is_not_eventwire() {
    for line in CLAUDE_LINES.iter().chain(ANTIGRAVITY_LINES) {
        let value: serde_json::Value = serde_json::from_str(line).expect("fixture is JSON");
        assert!(
            value.get("kind").is_none(),
            "fixture must be a raw provider line, not eventwire: {line}"
        );
    }
}

#[test]
fn every_line_a_job_persists_is_parseable_eventwire() {
    for (provider, lines) in [("claude", CLAUDE_LINES), ("antigravity", ANTIGRAVITY_LINES)] {
        let events = normalize_run(lines);
        assert!(
            !events.is_empty(),
            "{provider}: the run produced no eventwire at all"
        );
        for event in &events {
            assert!(
                event.get("kind").and_then(|k| k.as_str()).is_some(),
                "{provider}: a persisted line without `kind` renders as nothing: {event}"
            );
        }
    }
}

/// A tool card that never closes spins forever, so the pairing is the part worth pinning.
#[test]
fn a_tool_call_is_paired_with_its_result_for_both_providers() {
    for (provider, lines) in [("claude", CLAUDE_LINES), ("antigravity", ANTIGRAVITY_LINES)] {
        let events = normalize_run(lines);
        let id_of = |kind: &str| {
            events
                .iter()
                .find(|e| e.get("kind").and_then(|k| k.as_str()) == Some(kind))
                .and_then(|e| e.get("tool_use_id"))
                .and_then(|i| i.as_str())
                .map(str::to_string)
        };

        let call = id_of("tool_call");
        let result = id_of("tool_result");
        assert!(call.is_some(), "{provider}: no tool_call on the stream");
        assert_eq!(
            call, result,
            "{provider}: the tool result must close the call it belongs to"
        );
        assert!(
            kinds(&events).contains(&"text"),
            "{provider}: the model's prose must reach the stream"
        );
    }
}

/// stderr is kept — an agent's diagnostics are why a reader opens this pane — but marked, so it can
/// never be mistaken for the model's answer.
#[test]
fn stderr_is_preserved_and_marked_rather_than_dropped() {
    let mut normalizer = EventWireNormalizer::new();
    let events: Vec<serde_json::Value> = normalizer
        .normalize("warning: rate limit approaching", true)
        .iter()
        .map(|line| serde_json::from_str(line).expect("eventwire is JSON"))
        .collect();

    assert_eq!(kinds(&events), vec!["text"]);
    let text = events[0]
        .get("text")
        .and_then(|t| t.as_str())
        .expect("a text event carries text");
    assert!(
        text.contains("rate limit approaching") && text.contains("stderr"),
        "stderr must be kept and marked, got: {text}"
    );
}

/// An unknown provider must degrade to "renders nothing" rather than losing the line or panicking.
#[test]
fn an_unrecognised_line_survives_without_pretending_to_be_an_event() {
    let mut normalizer = EventWireNormalizer::new();
    let produced = normalizer.normalize(r#"{"some":"future-provider-shape"}"#, false);

    for line in &produced {
        let value: serde_json::Value = serde_json::from_str(line).expect("still JSON");
        assert!(
            value.get("kind").is_none(),
            "an unrecognised line must not be dressed up as an event: {line}"
        );
    }
}
