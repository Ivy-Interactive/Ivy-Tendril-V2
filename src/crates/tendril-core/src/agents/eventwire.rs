//! Turns each coding agent's own output format into Tendril's eventwire form.
//!
//! Every provider streams structured JSON, and no two of them agree on the shape. `AgentViewer` and
//! `TurnActivity` read exactly one shape — the eventwire line, `{"kind":"tool_call",…}` — because
//! `parseEventWireStream` skips any line without a `kind`. Nothing in V2 produced those lines, so a
//! turn's tool calls, thinking and (for every provider whose prose is not at a top-level `text` key)
//! its answer were all discarded: the chat thread showed a bare "Task completed successfully." and no
//! activity at all.
//!
//! This is the port of V1's `IEventParser` implementations plus `JsonEventSerializer`: V1 parses each
//! provider line into a normalised `AgentEvent`, serializes *that* onto the raw stream, and renders
//! from it. The field names below are the ones
//! `packages/components/src/components/AgentViewer/types.ts` declares, which are in turn V1's
//! `AgentEventSchema` snake_case names — the two must not drift.
//!
//! The normalizer is stateful because Antigravity's tool steps are identified by `step_index` rather
//! than by an id, so the `ACTIVE` and `DONE` halves of one call have to be tied together across
//! lines. Construct one per agent run.

use crate::agents::model_specs;
use chrono::Utc;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Prefix marking a line the agent wrote to stderr. V1's parsers skip these, and
/// `parseEventWireStream` drops `text` events that start with it, so a stderr line stays in the
/// persisted stream without being rendered as part of the answer.
pub const STDERR_PREFIX: &str = "[stderr] ";

/// Normalises one agent's output stream into eventwire lines. One per run.
#[derive(Debug, Default)]
pub struct EventWireNormalizer {
    /// Antigravity `step_index` → the `tool_use_id` allocated for it.
    step_tool_ids: HashMap<String, String>,
    next_tool_id: usize,
    /// The model `session_init` named, remembered so a `result` that reports tokens without naming a
    /// model can still be priced. Every provider announces its model at the start of a run and most
    /// of them never mention it again.
    model: Option<String>,
    opencode_input_tokens: i64,
    opencode_output_tokens: i64,
    opencode_cache_read_tokens: i64,
    opencode_cache_write_tokens: i64,
    opencode_reasoning_tokens: i64,
    opencode_cost: Option<f64>,
}

impl EventWireNormalizer {
    pub fn new() -> Self {
        Self::default()
    }

    /// The eventwire lines one raw output line becomes. Empty when the line carries nothing.
    ///
    /// A line whose shape is not recognised is passed through verbatim rather than dropped: it has no
    /// `kind`, so it renders as nothing, but it is still there for anyone reading the persisted
    /// stream — and that is also how a provider Tendril has never seen degrades.
    pub fn normalize(&mut self, line: &str, is_stderr: bool) -> Vec<String> {
        if is_stderr {
            let text = line.trim_end();
            if text.trim().is_empty() {
                return Vec::new();
            }
            return vec![text_event(&format!("{}{}", STDERR_PREFIX, text), true)];
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        // Prose from a provider that streams plain text, and the shape a CLI's own error messages
        // arrive in ("API Error (…): 400 …" on stdout). The newline is kept because consecutive lines
        // are accumulated into one answer.
        if !trimmed.starts_with('{') {
            return vec![text_event(&format!("{}\n", line.trim_end()), true)];
        }

        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            return vec![line.to_string()];
        };

        // Already normalised: a synthetic line from `crate::agents::reconcile`, a stream replayed from
        // disk, or a provider that speaks eventwire natively.
        if value.get("kind").and_then(|k| k.as_str()).is_some() {
            return vec![trimmed.to_string()];
        }

        if value.get("event").and_then(|e| e.as_str()).is_some() {
            return self.antigravity(&value);
        }

        if let Some(kind) = value.get("type").and_then(|t| t.as_str()) {
            return self.typed(kind, &value, trimmed);
        }

        // `{"delta": …}` / `{"text": …}`: what a thin wrapper around a provider emits.
        if let Some(text) = simple_text(&value) {
            return vec![text_event(&text, true)];
        }

        vec![trimmed.to_string()]
    }

    // ── Antigravity (`agy`) ────────────────────────────────────────────────────────────────────
    // `{"event":"init"|"step_update"|"result", "<event>": {…}}`. Port of `AntigravityEventParser`.

    fn antigravity(&mut self, value: &Value) -> Vec<String> {
        match value.get("event").and_then(|e| e.as_str()) {
            Some("init") => {
                let init = value.get("init");
                let model = init.and_then(|i| i.get("model")).and_then(|m| m.as_str());
                self.remember_model(model);
                vec![session_init_event(
                    value
                        .get("conversation_id")
                        .and_then(|c| c.as_str())
                        .unwrap_or_default(),
                    model,
                    init.and_then(|i| i.get("tools")),
                )]
            }
            Some("step_update") => match value.get("step_update") {
                Some(step) => self.antigravity_step(step),
                None => Vec::new(),
            },
            Some("result") => {
                let Some(result) = value.get("result") else {
                    return Vec::new();
                };
                let status = result
                    .get("status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("SUCCESS");
                let response = result.get("response").and_then(|r| r.as_str());
                let has_response = response.is_some_and(|r| !r.trim().is_empty());
                // A recovered mid-turn tool error makes Antigravity report `ERROR` for a turn that
                // did answer, so a response outranks the status — `AntigravityEventParser.ParseResult`
                // makes the same call.
                let is_success = !status.eq_ignore_ascii_case("ERROR") || has_response;
                // Antigravity carries its usage on the nested result, and a wrapper around it on the
                // root; `AntigravityEventParser.ParseResult` looks in both, and so does this.
                let usage = self.result_usage(&[result, value]);
                vec![result_event(
                    response,
                    if is_success {
                        None
                    } else {
                        result.get("error").and_then(|e| e.as_str())
                    },
                    is_success,
                    result
                        .get("duration_seconds")
                        .and_then(|d| d.as_f64())
                        .map(|s| (s * 1000.0) as i64),
                    result.get("num_turns").and_then(|t| t.as_i64()),
                    usage,
                )]
            }
            _ => Vec::new(),
        }
    }

    fn antigravity_step(&mut self, step: &Value) -> Vec<String> {
        let step_type = step.get("step_type").and_then(|s| s.as_str());
        let state = step.get("state").and_then(|s| s.as_str());

        match step_type {
            Some("tool") => {
                let key = match step.get("step_index") {
                    Some(Value::Number(n)) => n.to_string(),
                    Some(Value::String(s)) => s.clone(),
                    _ => {
                        let key = format!("unknown_{}", self.next_tool_id);
                        self.next_tool_id += 1;
                        key
                    }
                };
                let tool_name = step
                    .get("tool_name")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown");
                let info = step.get("tool_info");
                let input = info.and_then(|i| i.get("parameters"));
                let description = info
                    .and_then(|i| i.get("description"))
                    .and_then(|d| d.as_str());

                if state == Some("ACTIVE") {
                    let tool_use_id = self.allocate_tool_id(&key);
                    return vec![tool_call_event(&tool_use_id, tool_name, input, description)];
                }

                // Any other state is terminal: DONE, and also CANCELLED / FAILED / TIMEOUT.
                let state = state.unwrap_or("DONE");
                let orphan = !self.step_tool_ids.contains_key(&key);
                let tool_use_id = self.allocate_tool_id(&key);

                let mut is_error = state != "DONE";
                let mut output = info
                    .and_then(|i| i.get("output"))
                    .map(value_to_text)
                    .filter(|o| !o.is_empty());
                if output.is_none() {
                    if let Some(err) = info.and_then(|i| i.get("error")) {
                        output = Some(value_to_text(err));
                        is_error = true;
                    }
                }
                let output = output.unwrap_or_else(|| {
                    if is_error {
                        format!("[{}]", state)
                    } else {
                        String::new()
                    }
                });

                let result = tool_result_event(&tool_use_id, Some(tool_name), &output, is_error);
                // A terminal state with no preceding `ACTIVE` still has to open its own card.
                if orphan {
                    vec![
                        tool_call_event(&tool_use_id, tool_name, input, description),
                        result,
                    ]
                } else {
                    vec![result]
                }
            }
            Some("thinking") => {
                let text = step
                    .get("text")
                    .and_then(|t| t.as_str())
                    .or_else(|| step.get("thinking_delta").and_then(|t| t.as_str()))
                    .unwrap_or_default();
                if text.is_empty() {
                    Vec::new()
                } else {
                    vec![thinking_event(text)]
                }
            }
            Some("agent_response") => {
                let text = step
                    .get("text_delta")
                    .and_then(|t| t.as_str())
                    .or_else(|| step.get("text").and_then(|t| t.as_str()))
                    .unwrap_or_default();
                if text.is_empty() {
                    Vec::new()
                } else {
                    vec![text_event(text, true)]
                }
            }
            _ => Vec::new(),
        }
    }

    /// Keeps the first model a run names. First rather than last because that is the model the turn
    /// was launched on; a later mention is a sub-agent's or a fallback's.
    pub fn remember_model(&mut self, model: Option<&str>) {
        if self.model.is_some() {
            return;
        }
        if let Some(model) = model.map(str::trim).filter(|m| !m.is_empty()) {
            self.model = Some(priceable_model_name(model));
        }
    }

    /// The `usage` object for a terminal result, from whichever of `sources` is the first to report
    /// anything. A provider that reports nothing gets no `usage` key at all, which is how the viewer
    /// tells "this run consumed nothing worth reporting" from "this provider does not say".
    fn result_usage(&self, sources: &[&Value]) -> Option<Value> {
        sources
            .iter()
            .find_map(|source| usage_facts(source))
            .and_then(|facts| usage_value(&facts, self.model.as_deref()))
    }

    fn allocate_tool_id(&mut self, step_key: &str) -> String {
        if let Some(existing) = self.step_tool_ids.get(step_key) {
            return existing.clone();
        }
        let id = format!("ag-tool-{}", self.next_tool_id);
        self.next_tool_id += 1;
        self.step_tool_ids.insert(step_key.to_string(), id.clone());
        id
    }

    // ── Providers keyed on a top-level `type` ──────────────────────────────────────────────────

    fn typed(&mut self, kind: &str, value: &Value, raw: &str) -> Vec<String> {
        match kind {
            // Claude Code / anything sharing its `stream-json`.
            "system" => {
                if value.get("subtype").and_then(|s| s.as_str()) != Some("init") {
                    return Vec::new();
                }
                let model = value.get("model").and_then(|m| m.as_str());
                self.remember_model(model);
                vec![session_init_event(
                    value
                        .get("session_id")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default(),
                    model,
                    value.get("tools"),
                )]
            }
            "assistant" => claude_blocks(value),
            "user" => claude_tool_results(value),
            "result" => {
                // Claude names the answer `result`; Gemini names it `response`.
                let response = value
                    .get("result")
                    .and_then(|r| r.as_str())
                    .or_else(|| value.get("response").and_then(|r| r.as_str()));
                let is_error = value
                    .get("is_error")
                    .and_then(|e| e.as_bool())
                    .unwrap_or(false);
                vec![result_event(
                    response,
                    value.get("error").and_then(|e| e.as_str()),
                    !is_error,
                    value.get("duration_ms").and_then(|d| d.as_i64()),
                    value.get("num_turns").and_then(|t| t.as_i64()),
                    self.result_usage(&[value]),
                )]
            }

            // Codex.
            "thread.started" => vec![session_init_event(
                value
                    .get("thread_id")
                    .and_then(|t| t.as_str())
                    .unwrap_or_default(),
                None,
                None,
            )],
            "item.completed" => codex_item(value),
            "turn.completed" => vec![result_event(
                None,
                None,
                true,
                None,
                None,
                self.result_usage(&[value]),
            )],
            "turn.failed" => vec![result_event(
                None,
                codex_error_message(value),
                false,
                None,
                None,
                self.result_usage(&[value]),
            )],
            "error" => vec![error_event(
                codex_error_message(value).unwrap_or("The agent reported an error."),
            )],

            // Gemini.
            "init" => {
                let model = value.get("model").and_then(|m| m.as_str());
                self.remember_model(model);
                vec![session_init_event(
                    value
                        .get("session_id")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default(),
                    model,
                    value.get("tools"),
                )]
            }
            "message" => {
                if value.get("role").and_then(|r| r.as_str()) == Some("user") {
                    return Vec::new();
                }
                match value.get("content").and_then(|c| c.as_str()) {
                    Some(text) if !text.is_empty() => vec![text_event(text, false)],
                    _ => Vec::new(),
                }
            }
            "tool_use" => gemini_or_opencode_tool_call(value),
            "tool_result" => {
                let id = value
                    .get("tool_id")
                    .and_then(|t| t.as_str())
                    .unwrap_or_default();
                if id.is_empty() {
                    return Vec::new();
                }
                let status = value.get("status").and_then(|s| s.as_str());
                let is_error = status.is_some_and(|s| !s.eq_ignore_ascii_case("success"));
                let output = value.get("output").map(value_to_text).unwrap_or_default();
                vec![tool_result_event(id, None, &output, is_error)]
            }

            // OpenCode (and the `ivy` / `openaiproxy` wrappers around it).
            "step_start" => vec![session_init_event(
                value
                    .get("sessionID")
                    .and_then(|s| s.as_str())
                    .unwrap_or_default(),
                None,
                None,
            )],
            "text" => match value
                .get("part")
                .and_then(|p| p.get("text"))
                .and_then(|t| t.as_str())
            {
                Some(text) if !text.is_empty() => vec![text_event(text, false)],
                // `{"type":"text","text":"…"}` rather than OpenCode's nested `part`.
                _ => match simple_text(value) {
                    Some(text) => vec![text_event(&text, true)],
                    None => Vec::new(),
                },
            },

            "step_finish" => self.opencode_step_finish(value),

            // Cursor. `{"type":"thinking","subtype":"delta"|"completed","text":…}` -- the deltas
            // carry the reasoning a token at a time and the `completed` line carries no text at
            // all, so it closes the block rather than adding to it.
            "thinking" => match value.get("text").and_then(|t| t.as_str()) {
                Some(text) if !text.is_empty() => vec![thinking_event(text)],
                _ => Vec::new(),
            },
            "tool_call" => cursor_tool_call(value),

            // Not a shape any provider Tendril launches is known to emit. Kept verbatim.
            _ => vec![raw.to_string()],
        }
    }

    fn opencode_step_finish(&mut self, value: &Value) -> Vec<String> {
        let part = value.get("part");
        if let Some(cost) = part.and_then(|p| p.get("cost")).and_then(|c| c.as_f64()) {
            let current = self.opencode_cost.unwrap_or(0.0);
            self.opencode_cost = Some(current + cost);
        }

        if let Some(tokens) = part.and_then(|p| p.get("tokens")) {
            if let Some(inp) = tokens.get("input").and_then(|i| i.as_i64()) {
                self.opencode_input_tokens += inp;
            }
            if let Some(out) = tokens.get("output").and_then(|o| o.as_i64()) {
                self.opencode_output_tokens += out;
            }
            if let Some(reasoning) = tokens.get("reasoning").and_then(|r| r.as_i64()) {
                self.opencode_reasoning_tokens += reasoning;
            }
            let cache = tokens.get("cache");
            if let Some(read) = cache.and_then(|c| c.get("read")).and_then(|r| r.as_i64()) {
                self.opencode_cache_read_tokens += read;
            }
            if let Some(write) = cache.and_then(|c| c.get("write")).and_then(|w| w.as_i64()) {
                self.opencode_cache_write_tokens += write;
            }
        }

        let reason = part
            .and_then(|p| p.get("reason"))
            .and_then(|r| r.as_str())
            .unwrap_or("stop");

        // Only "tool-calls" is an intermediate step; every other reason ends generation
        if reason == "tool-calls" {
            return Vec::new();
        }

        let facts = UsageFacts {
            input_tokens: self.opencode_input_tokens,
            output_tokens: self.opencode_output_tokens,
            cache_read_tokens: self.opencode_cache_read_tokens,
            cache_write_tokens: self.opencode_cache_write_tokens,
            reasoning_tokens: self.opencode_reasoning_tokens,
            cost_usd: self.opencode_cost,
            model: self.model.clone(),
        };

        let is_error = reason == "error";
        vec![result_event(
            None,
            if is_error {
                Some("OpenCode reported an error")
            } else {
                None
            },
            !is_error,
            None,
            None,
            usage_value(&facts, self.model.as_deref()),
        )]
    }
}

// ── Claude Code content blocks ──────────────────────────────────────────────────────────────────

/// Port of `ClaudeEventParser.ParseAssistant`: text, thinking and tool_use blocks of one assistant
/// message, in the order they appear.
fn claude_blocks(value: &Value) -> Vec<String> {
    let Some(blocks) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for block in blocks {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        out.push(text_event(text, false));
                    }
                }
            }
            Some("thinking") => {
                if let Some(text) = block.get("thinking").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        out.push(thinking_event(text));
                    }
                }
            }
            Some("tool_use") => {
                let id = block.get("id").and_then(|i| i.as_str()).unwrap_or_default();
                let name = block
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown");
                let description = block
                    .get("input")
                    .and_then(|i| i.get("description"))
                    .and_then(|d| d.as_str());
                out.push(tool_call_event(id, name, block.get("input"), description));
            }
            // A tool_result can arrive on an assistant message as well as on a user one.
            Some("tool_result") => {
                if let Some(line) = claude_tool_result_block(block) {
                    out.push(line);
                }
            }
            _ => {}
        }
    }
    out
}

/// Port of `ClaudeEventParser.ParseUser`: a user message whose content blocks are tool results.
fn claude_tool_results(value: &Value) -> Vec<String> {
    let Some(blocks) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
    else {
        return Vec::new();
    };
    blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
        .filter_map(claude_tool_result_block)
        .collect()
}

fn claude_tool_result_block(block: &Value) -> Option<String> {
    let id = block.get("tool_use_id").and_then(|i| i.as_str())?;
    let is_error = block
        .get("is_error")
        .and_then(|e| e.as_bool())
        .unwrap_or(false);
    let output = block.get("content").map(value_to_text).unwrap_or_default();
    Some(tool_result_event(id, None, &output, is_error))
}

// ── Codex items ─────────────────────────────────────────────────────────────────────────────────

/// Port of `CodexEventParser.ParseItemCompleted`.
fn codex_item(value: &Value) -> Vec<String> {
    let Some(item) = value.get("item") else {
        return Vec::new();
    };
    let item_id = item.get("id").and_then(|i| i.as_str()).unwrap_or_default();

    match item.get("type").and_then(|t| t.as_str()) {
        Some("agent_message") => match item.get("text").and_then(|t| t.as_str()) {
            Some(text) if !text.is_empty() => vec![text_event(text, false)],
            _ => Vec::new(),
        },
        Some("command_execution") => {
            let command = item
                .get("command")
                .and_then(|c| c.as_str())
                .unwrap_or_default();
            let output = item
                .get("aggregated_output")
                .map(value_to_text)
                .unwrap_or_default();
            vec![
                tool_call_event(item_id, "bash", Some(&json!({ "command": command })), None),
                tool_result_event(item_id, Some("bash"), &output, false),
            ]
        }
        Some("error") => vec![error_event(
            item.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("The agent reported an error."),
        )],
        _ => Vec::new(),
    }
}

/// Codex reports an error message at the top level or nested under `error`.
fn codex_error_message(value: &Value) -> Option<&str> {
    value
        .get("message")
        .and_then(|m| m.as_str())
        .or_else(|| value.get("error").and_then(|e| e.as_str()))
        .or_else(|| {
            value
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
        })
}

/// Gemini spells a call `tool_id`/`tool_name`/`parameters`; OpenCode nests it under `part` as
/// `callID`/`tool`/`state.input`, and carries the result on the same line once it has completed.
fn gemini_or_opencode_tool_call(value: &Value) -> Vec<String> {
    if let Some(part) = value.get("part") {
        let id = part
            .get("callID")
            .and_then(|c| c.as_str())
            .unwrap_or_default();
        if id.is_empty() {
            return Vec::new();
        }
        let name = part
            .get("tool")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");
        let state = part.get("state");
        let input = state.and_then(|s| s.get("input"));
        let description = input
            .and_then(|i| i.get("description"))
            .and_then(|d| d.as_str());
        let mut out = vec![tool_call_event(id, name, input, description)];
        if state.and_then(|s| s.get("status")).and_then(|s| s.as_str()) == Some("completed") {
            let output = state
                .and_then(|s| s.get("output"))
                .map(value_to_text)
                .unwrap_or_default();
            out.push(tool_result_event(id, Some(name), &output, false));
        }
        return out;
    }

    let id = value
        .get("tool_id")
        .and_then(|t| t.as_str())
        .unwrap_or_default();
    if id.is_empty() {
        return Vec::new();
    }
    let name = value
        .get("tool_name")
        .and_then(|t| t.as_str())
        .unwrap_or("unknown");
    let input = value.get("parameters");
    let description = input
        .and_then(|i| i.get("description"))
        .and_then(|d| d.as_str());
    vec![tool_call_event(id, name, input, description)]
}

// ── Usage, and the difference between a reported cost and a priced one ──────────────────────────

/// What a provider said one finished turn consumed.
///
/// `cost_usd` is **only** ever the provider's own charge. Tendril can price the tokens itself and
/// does, but that figure is stamped `cost_source: "estimated"` on the way out and never lands here,
/// because a number divided out of a price list is not a number anybody was billed.
#[derive(Debug, Default, Clone, PartialEq)]
struct UsageFacts {
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    reasoning_tokens: i64,
    /// The provider's own charge in USD, when it reported one.
    cost_usd: Option<f64>,
    /// The model the turn ran on, when the result itself names it.
    model: Option<String>,
}

impl UsageFacts {
    /// What the turn is priced on. Reasoning tokens are deliberately out: Codex counts them *inside*
    /// `output_tokens` — a turn reporting 47 output with 28 reasoning totals 47, not 75 — so adding
    /// them would bill the same tokens twice. `CodexEventParser` says the same thing.
    fn billable_tokens(&self) -> i64 {
        self.input_tokens + self.output_tokens + self.cache_read_tokens + self.cache_write_tokens
    }

    fn is_empty(&self) -> bool {
        self.billable_tokens() == 0 && self.reasoning_tokens == 0 && self.cost_usd.is_none()
    }
}

/// The first of `names` this object carries as a number.
fn number_at(value: &Value, names: &[&str]) -> Option<f64> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(|n| n.as_f64()))
}

fn tokens_at(value: &Value, names: &[&str]) -> i64 {
    number_at(value, names).unwrap_or(0.0) as i64
}

/// Every spelling of a cost a provider has been seen to use, checked on both the result and its
/// nested `usage`. `total_cost_usd` is the one Claude Code actually emits.
const COST_KEYS: &[&str] = &[
    "total_cost_usd",
    "cost_usd",
    "total_cost",
    "cost",
    "costUSD",
];

/// A provider's usage report, in whichever of the known shapes it arrived in.
///
/// Port of the `usage` half of V1's five `IEventParser.ParseResult` implementations, which each read
/// their own provider's spelling. Reading every spelling in one place is what keeps a provider Tendril
/// has not seen from silently reporting nothing: Claude's `cache_read_input_tokens`, Codex's
/// `cached_input_tokens` and the camelCase a wrapper produces all land in the same field.
fn usage_facts(source: &Value) -> Option<UsageFacts> {
    if let Some(usage) = source.get("usage").filter(|u| u.is_object()) {
        let facts = UsageFacts {
            input_tokens: tokens_at(
                usage,
                &[
                    "input_tokens",
                    "inputTokens",
                    "prompt_tokens",
                    "promptTokens",
                ],
            ),
            output_tokens: tokens_at(
                usage,
                &[
                    "output_tokens",
                    "outputTokens",
                    "completion_tokens",
                    "completionTokens",
                ],
            ),
            // `cache_read_input_tokens` is what Claude Code's result event actually calls this, and on
            // a long run it dominates the bill: without the alias a 227k-token cache read counted 0.
            cache_read_tokens: tokens_at(
                usage,
                &[
                    "cache_read_tokens",
                    "cacheReadTokens",
                    "cached_input_tokens",
                    "cache_read_input_tokens",
                    "cacheReadInputTokens",
                ],
            ),
            // Likewise `cache_creation_input_tokens` for the write side.
            cache_write_tokens: tokens_at(
                usage,
                &[
                    "cache_write_tokens",
                    "cacheWriteTokens",
                    "cache_write_input_tokens",
                    "cache_creation_input_tokens",
                    "cacheCreationInputTokens",
                ],
            ),
            reasoning_tokens: tokens_at(
                usage,
                &[
                    "reasoning_tokens",
                    "reasoningTokens",
                    "reasoning_output_tokens",
                ],
            ),
            // The charge is reported beside the usage as often as inside it.
            cost_usd: number_at(source, COST_KEYS).or_else(|| number_at(usage, COST_KEYS)),
            model: string_at(usage, &["model", "modelId"])
                .or_else(|| string_at(source, &["model", "modelId"]))
                .or_else(|| model_usage_name(source)),
        };
        // A `usage` object of all zeros with no charge beside it says nothing, and is dropped rather
        // than rendered as a run that consumed nothing.
        return Some(facts).filter(|f| !f.is_empty());
    }

    if let Some(facts) = gemini_usage(source) {
        return Some(facts);
    }

    // A charge with no token counts at all — an Antigravity wrapper reports this.
    number_at(source, COST_KEYS).map(|cost| UsageFacts {
        cost_usd: Some(cost),
        model: string_at(source, &["model", "modelId"]).or_else(|| model_usage_name(source)),
        ..UsageFacts::default()
    })
}

fn string_at(value: &Value, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        value
            .get(*name)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

/// Claude Code's result carries a `modelUsage` object keyed by model id, which is the only place a
/// finished Claude turn names the model it ran on.
fn model_usage_name(source: &Value) -> Option<String> {
    source
        .get("modelUsage")
        .or_else(|| source.get("model_usage"))
        .and_then(|m| m.as_object())
        .and_then(|m| m.keys().next())
        .map(|k| k.to_string())
}

/// Gemini reports per-model counters under `stats.models` rather than a `usage` object — an array in
/// the shape `GeminiEventParser` reads, or a map keyed by model id. Both carry the same three fields.
fn gemini_usage(source: &Value) -> Option<UsageFacts> {
    let models = source.get("stats").and_then(|s| s.get("models"))?;
    let entries: Vec<(Option<String>, &Value)> = match models {
        Value::Array(items) => items.iter().map(|item| (None, item)).collect(),
        Value::Object(map) => map
            .iter()
            .map(|(name, item)| (Some(name.clone()), item))
            .collect(),
        _ => return None,
    };

    let mut facts = UsageFacts::default();
    for (name, entry) in entries {
        // The counters sit on the entry itself or under a `tokens` object, depending on the version.
        let counters = entry
            .get("tokens")
            .filter(|t| t.is_object())
            .unwrap_or(entry);
        facts.input_tokens += tokens_at(counters, &["prompt", "promptTokens", "input"]);
        facts.output_tokens += tokens_at(counters, &["candidates", "candidatesTokens", "output"]);
        facts.cache_read_tokens += tokens_at(counters, &["cacheRead", "cached", "cache_read"]);
        facts.reasoning_tokens += tokens_at(counters, &["thoughts", "thoughtsTokens"]);
        if facts.model.is_none() {
            facts.model = name.or_else(|| string_at(entry, &["model", "name"]));
        }
    }
    facts.cost_usd = number_at(source, COST_KEYS);

    Some(facts).filter(|f| !f.is_empty())
}

/// The `usage` object an eventwire `result` carries, or `None` when nothing was reported.
///
/// `cost_source` is the honest half of this and the reason it exists: `"agent"` means the provider
/// billed that amount, `"estimated"` means Tendril multiplied the token counts by `model_specs`'
/// list price for the model. The viewer prefixes an estimate with `~`, the same way `JobsView`
/// distinguishes `JobCostSources.Estimated` — a figure nobody was charged must never present itself
/// as one that they were.
///
/// An estimate is only offered when the model actually resolves in the price list. Pricing an unknown
/// model off the fallback rate would produce a number with no provenance at all, which is worse than
/// no number.
fn usage_value(facts: &UsageFacts, fallback_model: Option<&str>) -> Option<Value> {
    if facts.is_empty() {
        return None;
    }

    let model = facts.model.as_deref().or(fallback_model);
    let mut map = Map::new();
    // All five counters are always present: `UsageWire` in `AgentViewer/types.ts` declares them
    // non-optional, and a missing count is not the same claim as a zero one.
    map.insert("input_tokens".into(), json!(facts.input_tokens));
    map.insert("output_tokens".into(), json!(facts.output_tokens));
    map.insert("cache_read_tokens".into(), json!(facts.cache_read_tokens));
    map.insert("cache_write_tokens".into(), json!(facts.cache_write_tokens));
    map.insert("reasoning_tokens".into(), json!(facts.reasoning_tokens));

    if let Some(cost) = facts.cost_usd {
        if cost > 0.0 {
            map.insert("cost_usd".into(), json!(cost));
            map.insert("cost_source".into(), json!("agent"));
        } else if let Some(spec) = model.and_then(model_specs::find) {
            if spec.model_id == "apple/system" {
                map.insert("cost_usd".into(), json!(0.0));
                map.insert("cost_source".into(), json!("agent"));
            } else if model_specs::is_priced(&spec) {
                // Subscription / subsidized run: price the tokens at list rates
                map.insert(
                    "cost_usd".into(),
                    json!(spec.calculate_cost(
                        facts.input_tokens,
                        facts.output_tokens,
                        facts.cache_read_tokens,
                        facts.cache_write_tokens,
                    )),
                );
                map.insert("cost_source".into(), json!("estimated"));
            } else {
                map.insert("cost_usd".into(), json!(0.0));
                map.insert("cost_source".into(), json!("agent"));
            }
        } else {
            map.insert("cost_usd".into(), json!(cost));
            map.insert("cost_source".into(), json!("agent"));
        }
    } else if facts.billable_tokens() > 0 {
        if let Some(spec) = model.and_then(model_specs::find) {
            if spec.model_id == "apple/system" {
                map.insert("cost_usd".into(), json!(0.0));
                map.insert("cost_source".into(), json!("agent"));
            } else if model_specs::is_priced(&spec) {
                map.insert(
                    "cost_usd".into(),
                    json!(spec.calculate_cost(
                        facts.input_tokens,
                        facts.output_tokens,
                        facts.cache_read_tokens,
                        facts.cache_write_tokens,
                    )),
                );
                map.insert("cost_source".into(), json!("estimated"));
            }
        }
    }

    if let Some(model) = model {
        map.insert("model".into(), json!(model));
    }

    Some(Value::Object(map))
}

// ── Cursor (`cursor-agent`) ─────────────────────────────────────────────────────────────────────

/// The model name a `session_init` should carry, resolved onto something the price list can match
/// when the provider announced a human-readable name instead of an id.
///
/// Every other provider names its model the way it was launched: Claude says `claude-opus-5`, Codex
/// says `gpt-5.6-terra`. Cursor says **"Claude Opus 5 300K Low No Thinking"** -- a display name
/// carrying the context window and the reasoning rung. `model_specs::find` is id-shaped, so that
/// string resolves to nothing and a run that cost real money reports no cost at all.
///
/// Lowercasing and replacing spaces with dashes is enough to reach `find`'s longest-substring tier:
/// `claude-opus-5-300k-low-no-thinking` contains `claude-opus-5`, and `gpt-5.6-terra-272k-medium`
/// contains `gpt-5.6-terra`. Matching the *longest* key is `find`'s own rule, so "Claude Opus 4.8 …"
/// cannot be mistaken for Opus 5.
///
/// A name is only rewritten when it contains a space, because no model id does -- an id-shaped name
/// is already what every other provider sends and is left exactly alone. That test matters more
/// than it looks: the raw `"Claude Opus 5 300K Low No Thinking"` *does* resolve, onto the bare
/// `opus` alias, at Sonnet-ish rates. Resolving to the wrong row is worse than resolving to none,
/// so the spaced form is never the one that gets priced. And when the dashed form resolves to
/// nothing -- Composer, Muse Spark, anything Cursor ships that has no published rate -- the display
/// name is kept verbatim and the run reports no cost at all, which is the honest answer.
fn priceable_model_name(model: &str) -> String {
    if !model.contains(' ') {
        return model.to_string();
    }
    let dashed = model.trim().to_ascii_lowercase().replace(' ', "-");
    if model_specs::find(&dashed).is_some() {
        return dashed;
    }
    model.to_string()
}

/// A Cursor `tool_call` line, which carries both halves of a tool's life under one `type`.
///
/// `{"type":"tool_call","subtype":"started"|"completed","tool_call":{"<name>ToolCall":{…},
/// "toolCallId":…}}`. The tool's name is the *key*, not a value: `readToolCall`, `editToolCall`,
/// `shellToolCall`, and whichever of Cursor's sixty-odd tools a future run reaches for. So the key
/// is discovered by its `ToolCall` suffix rather than matched against a list that would go stale --
/// an unknown tool still opens and closes a card, named after itself.
///
/// `toolCallId` rather than the line's own `call_id`: on some models the latter is two ids joined by
/// a **newline** (`call_311mRT…\nfc_0a3dd82c…`), which is not something to put in a `tool_use_id`
/// that has to match across two events. `toolCallId` is clean on the runs where `call_id` is not,
/// and it is sanitised anyway, because a provider that did it once can do it again.
fn cursor_tool_call(value: &Value) -> Vec<String> {
    let Some(call) = value.get("tool_call").and_then(|c| c.as_object()) else {
        return Vec::new();
    };

    // The one key naming the tool. `hookAdditionalContexts`, `toolCallId`, `startedAtMs` and
    // `completedAtMs` are the fixed siblings; anything ending `ToolCall` is the payload.
    let Some((key, payload)) = call.iter().find(|(key, _)| key.ends_with("ToolCall")) else {
        return Vec::new();
    };
    // `readToolCall` → `read`, which is the name the card shows. A tool whose key is exactly
    // `ToolCall` keeps the key, rather than being named the empty string.
    let name = key
        .strip_suffix("ToolCall")
        .filter(|n| !n.is_empty())
        .unwrap_or(key);

    let id = call
        .get("toolCallId")
        .and_then(|i| i.as_str())
        .or_else(|| value.get("call_id").and_then(|i| i.as_str()))
        .map(sanitize_tool_use_id)
        .unwrap_or_default();
    if id.is_empty() {
        return Vec::new();
    }

    let args = payload.get("args");
    // Cursor puts the human-readable summary beside `args` on some tools and inside it on others.
    let description = payload
        .get("description")
        .and_then(|d| d.as_str())
        .or_else(|| {
            args.and_then(|a| a.get("description"))
                .and_then(|d| d.as_str())
        });

    match value.get("subtype").and_then(|s| s.as_str()) {
        Some("completed") => {
            let (output, is_error) = cursor_tool_result(payload.get("result"));
            vec![
                // `completed` repeats the arguments, so a run whose `started` line was lost still
                // opens a card with them rather than an empty one.
                tool_call_event(&id, name, args, description),
                tool_result_event(&id, Some(name), &output, is_error),
            ]
        }
        // `started`, and any subtype Cursor adds later: opening the card is the safe reading.
        _ => vec![tool_call_event(&id, name, args, description)],
    }
}

/// A Cursor tool's `result`, as the output text and whether it failed.
///
/// `{"success":{…}}` or `{"error":{"errorMessage":"File not found"}}`. The success payload differs
/// per tool -- a read carries `content`, a shell carries `stdout`, an edit carries `message` -- so
/// the text is taken from whichever of those the tool actually filled in, and falls back to the
/// whole object rather than showing an empty card.
fn cursor_tool_result(result: Option<&Value>) -> (String, bool) {
    let Some(result) = result else {
        return (String::new(), false);
    };

    if let Some(error) = result.get("error") {
        let message = error
            .get("errorMessage")
            .and_then(|m| m.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| value_to_text(error));
        return (message, true);
    }

    let Some(success) = result.get("success") else {
        return (value_to_text(result), false);
    };

    for key in ["content", "stdout", "message", "diffString", "output"] {
        if let Some(text) = success.get(key).and_then(|t| t.as_str()) {
            if !text.is_empty() {
                return (text.to_string(), false);
            }
        }
    }
    (value_to_text(success), false)
}

/// A `tool_use_id` with anything that would break a single-line id taken out.
///
/// Cursor's ids are sometimes two ids joined by a newline. The id is what pairs a `tool_call` with
/// its `tool_result`, and it is written into a newline-delimited stream, so an embedded newline
/// would split one event into two unparseable halves. Trimmed at the first line break rather than
/// having the break stripped, because the first id is the stable one -- the suffix varies per model.
fn sanitize_tool_use_id(id: &str) -> String {
    id.split(['\n', '\r'])
        .next()
        .unwrap_or(id)
        .trim()
        .to_string()
}

// ── Event builders ──────────────────────────────────────────────────────────────────────────────

fn timestamp() -> String {
    Utc::now().to_rfc3339()
}

/// `delta: true` appends to the answer being built; `delta: false` replaces it, which is what a
/// provider that sends whole messages rather than chunks means.
pub fn text_event(text: &str, delta: bool) -> String {
    json!({
        "kind": "text",
        "timestamp": timestamp(),
        "text": text,
        "delta": delta,
    })
    .to_string()
}

fn thinking_event(content: &str) -> String {
    json!({
        "kind": "thinking",
        "timestamp": timestamp(),
        "content": content,
    })
    .to_string()
}

fn session_init_event(session_id: &str, model: Option<&str>, tools: Option<&Value>) -> String {
    let mut map = Map::new();
    map.insert("kind".into(), json!("session_init"));
    map.insert("timestamp".into(), json!(timestamp()));
    map.insert("session_id".into(), json!(session_id));
    if let Some(model) = model {
        map.insert("model".into(), json!(model));
    }
    if let Some(Value::Array(tools)) = tools {
        map.insert("tools".into(), json!(tools));
    }
    Value::Object(map).to_string()
}

fn tool_call_event(
    tool_use_id: &str,
    tool_name: &str,
    input: Option<&Value>,
    description: Option<&str>,
) -> String {
    let mut map = Map::new();
    map.insert("kind".into(), json!("tool_call"));
    map.insert("timestamp".into(), json!(timestamp()));
    map.insert("tool_use_id".into(), json!(tool_use_id));
    map.insert("tool_name".into(), json!(tool_name));
    if let Some(description) = description {
        map.insert("description".into(), json!(description));
    }
    // `ToolCallWire.input` is an object; a provider that sends a bare string or array is wrapped so
    // the card has something to show rather than silently rendering no arguments.
    match input {
        Some(Value::Object(obj)) => {
            map.insert("input".into(), Value::Object(obj.clone()));
        }
        Some(Value::Null) | None => {}
        Some(other) => {
            map.insert("input".into(), json!({ "value": value_to_text(other) }));
        }
    }
    Value::Object(map).to_string()
}

fn tool_result_event(
    tool_use_id: &str,
    tool_name: Option<&str>,
    output: &str,
    is_error: bool,
) -> String {
    let mut map = Map::new();
    map.insert("kind".into(), json!("tool_result"));
    map.insert("timestamp".into(), json!(timestamp()));
    map.insert("tool_use_id".into(), json!(tool_use_id));
    if let Some(tool_name) = tool_name {
        map.insert("tool_name".into(), json!(tool_name));
    }
    map.insert("output".into(), json!(output));
    map.insert("is_error".into(), json!(is_error));
    Value::Object(map).to_string()
}

fn error_event(message: &str) -> String {
    json!({
        "kind": "error",
        "timestamp": timestamp(),
        "message": message,
        "is_retryable": false,
        "is_auth_error": false,
    })
    .to_string()
}

fn result_event(
    response: Option<&str>,
    error: Option<&str>,
    is_success: bool,
    duration_ms: Option<i64>,
    turn_count: Option<i64>,
    usage: Option<Value>,
) -> String {
    let mut map = Map::new();
    map.insert("kind".into(), json!("result"));
    map.insert("timestamp".into(), json!(timestamp()));
    if let Some(response) = response {
        map.insert("response".into(), json!(response));
    }
    if let Some(error) = error {
        map.insert("error".into(), json!(error));
    }
    map.insert("is_success".into(), json!(is_success));
    if let Some(duration_ms) = duration_ms {
        map.insert("duration_ms".into(), json!(duration_ms));
    }
    if let Some(turn_count) = turn_count {
        map.insert("turn_count".into(), json!(turn_count));
    }
    // The run's own account of what it consumed. Absent rather than zeroed when the provider said
    // nothing: `ResultSummary` and the viewer's metrics footer both read an absent `usage` as "not
    // reported" and a present one as a figure they may show.
    if let Some(usage) = usage {
        map.insert("usage".into(), usage);
    }
    Value::Object(map).to_string()
}

/// The text carried by a value that may be a string, an array of `{type:"text",text}` blocks (how
/// Claude and OpenCode spell a tool's output), or any other JSON. Port of `ContentExtractor`.
fn value_to_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => {
            let parts: Vec<String> = items
                .iter()
                .filter_map(|item| match item {
                    Value::String(s) => Some(s.clone()),
                    other => other
                        .get("text")
                        .and_then(|t| t.as_str())
                        .map(str::to_string),
                })
                .collect();
            if parts.is_empty() {
                value.to_string()
            } else {
                parts.join("\n")
            }
        }
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// The `{"delta": …}` / `{"text": …}` / `{"content": …}` / `{"message": …}` shapes a wrapper emits.
fn simple_text(value: &Value) -> Option<String> {
    if let Some(delta) = value.get("delta") {
        if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
            return Some(text.to_string());
        }
        if let Some(text) = delta.as_str() {
            return Some(text.to_string());
        }
    }
    for field in ["text", "content", "message"] {
        if let Some(text) = value.get(field).and_then(|t| t.as_str()) {
            return Some(text.to_string());
        }
    }
    None
}

/// The prose an eventwire line contributes to the answer, and whether it appends or replaces.
///
/// `None` for every line that is not the agent talking — tool traffic, thinking, session metadata,
/// and the terminal result, whose `response` repeats prose that has already been streamed.
pub fn event_wire_text(line: &str) -> Option<(String, bool)> {
    let value = serde_json::from_str::<Value>(line.trim()).ok()?;
    if value.get("kind").and_then(|k| k.as_str()) != Some("text") {
        return None;
    }
    let text = value.get("text").and_then(|t| t.as_str())?;
    if text.starts_with(STDERR_PREFIX) {
        return None;
    }
    let delta = value.get("delta").and_then(|d| d.as_bool()).unwrap_or(true);
    Some((text.to_string(), delta))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(lines: &[String]) -> Vec<String> {
        lines
            .iter()
            .map(|l| {
                serde_json::from_str::<Value>(l)
                    .ok()
                    .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_string))
                    .unwrap_or_else(|| "<raw>".to_string())
            })
            .collect()
    }

    fn field(line: &str, name: &str) -> String {
        let v: Value = serde_json::from_str(line).expect("json");
        match v.get(name) {
            Some(Value::String(s)) => s.clone(),
            Some(other) => other.to_string(),
            None => String::new(),
        }
    }

    /// Captured from a real `agy 1.2.4` run: `agy --dangerously-skip-permissions --output-format
    /// stream-json --print @prompt.md` answering "bro are you alive?".
    #[test]
    fn test_antigravity_live_stream() {
        let mut n = EventWireNormalizer::new();

        let init = n.normalize(
            r#"{"event":"init","conversation_id":"ce897762","init":{"cwd":"/tmp","tools":["view_file","run_command"],"permission_mode":"always-proceed"}}"#,
            false,
        );
        assert_eq!(kinds(&init), vec!["session_init"]);
        assert_eq!(field(&init[0], "session_id"), "ce897762");

        // A `user_input` step contributes nothing.
        assert!(n
            .normalize(
                r#"{"event":"step_update","step_update":{"step_index":0,"state":"DONE","step_type":"user_input"}}"#,
                false
            )
            .is_empty());

        // An `agent_response` step with no text yet contributes nothing either.
        assert!(n
            .normalize(
                r#"{"event":"step_update","step_update":{"step_index":1,"state":"DONE","step_type":"agent_response","duration_seconds":1.2}}"#,
                false
            )
            .is_empty());

        let call = n.normalize(
            r#"{"event":"step_update","step_update":{"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/tmp/p.md"}}}}"#,
            false,
        );
        assert_eq!(kinds(&call), vec!["tool_call"]);
        assert_eq!(field(&call[0], "tool_name"), "view_file");
        assert_eq!(field(&call[0], "input"), r#"{"AbsolutePath":"/tmp/p.md"}"#);
        let call_id = field(&call[0], "tool_use_id");

        let result = n.normalize(
            r#"{"event":"step_update","step_update":{"step_index":2,"state":"DONE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"/tmp/p.md"},"output":"1 lines, 18 bytes"}}}"#,
            false,
        );
        assert_eq!(kinds(&result), vec!["tool_result"]);
        // The DONE half has to close the card the ACTIVE half opened, which is the whole reason this
        // normalizer is stateful.
        assert_eq!(field(&result[0], "tool_use_id"), call_id);
        assert_eq!(field(&result[0], "output"), "1 lines, 18 bytes");
        assert_eq!(field(&result[0], "is_error"), "false");

        let text = n.normalize(
            r#"{"event":"step_update","step_update":{"step_index":3,"state":"DONE","step_type":"agent_response","text_delta":"Yes, I'm alive and ready to help!"}}"#,
            false,
        );
        assert_eq!(kinds(&text), vec!["text"]);
        assert_eq!(
            event_wire_text(&text[0]),
            Some(("Yes, I'm alive and ready to help!".to_string(), true))
        );

        let done = n.normalize(
            r#"{"event":"result","result":{"status":"SUCCESS","response":"Yes, I'm alive and ready to help!","duration_seconds":3.88,"num_turns":1}}"#,
            false,
        );
        assert_eq!(kinds(&done), vec!["result"]);
        assert_eq!(field(&done[0], "is_success"), "true");
        assert_eq!(field(&done[0], "duration_ms"), "3880");
        // The result's response is not prose to append: it repeats the text already streamed.
        assert_eq!(event_wire_text(&done[0]), None);
    }

    #[test]
    fn test_antigravity_tool_failure_and_orphan_result() {
        let mut n = EventWireNormalizer::new();
        // A terminal state with no preceding ACTIVE has to open and close its own card.
        let orphan = n.normalize(
            r#"{"event":"step_update","step_update":{"step_index":7,"state":"FAILED","step_type":"tool","tool_name":"run_command","tool_info":{"error":"exit status 127"}}}"#,
            false,
        );
        assert_eq!(kinds(&orphan), vec!["tool_call", "tool_result"]);
        assert_eq!(
            field(&orphan[0], "tool_use_id"),
            field(&orphan[1], "tool_use_id")
        );
        assert_eq!(field(&orphan[1], "is_error"), "true");
        assert_eq!(field(&orphan[1], "output"), "exit status 127");

        // A terminal state that is neither DONE nor carrying output still reports why.
        let cancelled = n.normalize(
            r#"{"event":"step_update","step_update":{"step_index":8,"state":"CANCELLED","step_type":"tool","tool_name":"run_command"}}"#,
            false,
        );
        assert_eq!(field(&cancelled[1], "output"), "[CANCELLED]");

        // A failed turn with no response is not a success, whatever the status says.
        let failed = n.normalize(
            r#"{"event":"result","result":{"status":"ERROR","error":"tool loop"}}"#,
            false,
        );
        assert_eq!(field(&failed[0], "is_success"), "false");
        assert_eq!(field(&failed[0], "error"), "tool loop");
        // ...but a response outranks an ERROR status, as a recovered mid-turn tool error is not fatal.
        let recovered = n.normalize(
            r#"{"event":"result","result":{"status":"ERROR","error":"recovered","response":"here you go"}}"#,
            false,
        );
        assert_eq!(field(&recovered[0], "is_success"), "true");
    }

    #[test]
    fn test_claude_stream_json() {
        let mut n = EventWireNormalizer::new();

        let init = n.normalize(
            r#"{"type":"system","subtype":"init","session_id":"s1","model":"claude-opus-5","tools":["Bash"]}"#,
            false,
        );
        assert_eq!(kinds(&init), vec!["session_init"]);
        assert_eq!(field(&init[0], "model"), "claude-opus-5");

        let assistant = n.normalize(
            r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"Reading it."},{"type":"tool_use","id":"tu1","name":"Read","input":{"file_path":"/a.rs"}}]}}"#,
            false,
        );
        assert_eq!(kinds(&assistant), vec!["thinking", "text", "tool_call"]);
        assert_eq!(field(&assistant[2], "tool_use_id"), "tu1");
        assert_eq!(field(&assistant[2], "tool_name"), "Read");
        // Whole-message prose replaces rather than appends.
        assert_eq!(
            event_wire_text(&assistant[1]),
            Some(("Reading it.".to_string(), false))
        );

        let tool_result = n.normalize(
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":[{"type":"text","text":"fn main() {}"}],"is_error":false}]}}"#,
            false,
        );
        assert_eq!(kinds(&tool_result), vec!["tool_result"]);
        assert_eq!(field(&tool_result[0], "output"), "fn main() {}");

        let result = n.normalize(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done.","num_turns":2,"duration_ms":1863}"#,
            false,
        );
        assert_eq!(field(&result[0], "is_success"), "true");
        assert_eq!(field(&result[0], "turn_count"), "2");
    }

    #[test]
    fn test_codex_gemini_and_opencode() {
        let mut n = EventWireNormalizer::new();

        assert_eq!(
            kinds(&n.normalize(r#"{"type":"thread.started","thread_id":"t1"}"#, false)),
            vec!["session_init"]
        );
        let codex_text = n.normalize(
            r#"{"type":"item.completed","item":{"type":"agent_message","id":"i1","text":"codex says"}}"#,
            false,
        );
        assert_eq!(
            event_wire_text(&codex_text[0]),
            Some(("codex says".to_string(), false))
        );
        let codex_cmd = n.normalize(
            r#"{"type":"item.completed","item":{"type":"command_execution","id":"i2","command":"ls -la","aggregated_output":"a\nb"}}"#,
            false,
        );
        assert_eq!(kinds(&codex_cmd), vec!["tool_call", "tool_result"]);
        assert_eq!(field(&codex_cmd[0], "tool_name"), "bash");
        assert_eq!(field(&codex_cmd[0], "input"), r#"{"command":"ls -la"}"#);
        assert_eq!(field(&codex_cmd[1], "output"), "a\nb");

        let gemini_tool = n.normalize(
            r#"{"type":"tool_use","tool_id":"g1","tool_name":"read_file","parameters":{"path":"/a"}}"#,
            false,
        );
        assert_eq!(kinds(&gemini_tool), vec!["tool_call"]);
        let gemini_result = n.normalize(
            r#"{"type":"tool_result","tool_id":"g1","status":"error","output":"nope"}"#,
            false,
        );
        assert_eq!(field(&gemini_result[0], "is_error"), "true");
        assert_eq!(
            kinds(&n.normalize(
                r#"{"type":"message","role":"assistant","content":"gemini says"}"#,
                false
            )),
            vec!["text"]
        );
        assert!(n
            .normalize(
                r#"{"type":"message","role":"user","content":"echo"}"#,
                false
            )
            .is_empty());

        let oc_tool = n.normalize(
            r#"{"type":"tool_use","part":{"callID":"c1","tool":"bash","state":{"status":"completed","input":{"command":"ls"},"output":"out"}}}"#,
            false,
        );
        assert_eq!(kinds(&oc_tool), vec!["tool_call", "tool_result"]);
        assert_eq!(field(&oc_tool[1], "output"), "out");
        assert_eq!(
            kinds(&n.normalize(r#"{"type":"text","part":{"text":"opencode says"}}"#, false)),
            vec!["text"]
        );
    }

    #[test]
    fn test_passthrough_shapes() {
        let mut n = EventWireNormalizer::new();

        // Already eventwire: byte-identical passthrough, so a replayed stream is stable.
        let wire = r#"{"kind":"tool_result","tool_use_id":"t1","output":"ok","is_error":false}"#;
        assert_eq!(n.normalize(wire, false), vec![wire.to_string()]);

        // Plain prose, and a wrapper's `{"delta": …}`.
        assert_eq!(
            event_wire_text(&n.normalize("API Error: 400 bad model", false)[0]),
            Some(("API Error: 400 bad model\n".to_string(), true))
        );
        assert_eq!(
            event_wire_text(&n.normalize(r#"{"delta":"chunk"}"#, false)[0]),
            Some(("chunk".to_string(), true))
        );

        // stderr is preserved but never rendered as part of the answer.
        let err = n.normalize("Error: Session ID abc is already in use.", true);
        assert_eq!(kinds(&err), vec!["text"]);
        assert_eq!(
            field(&err[0], "text"),
            "[stderr] Error: Session ID abc is already in use."
        );
        assert_eq!(event_wire_text(&err[0]), None);

        // Blank lines and unrecognised JSON.
        assert!(n.normalize("   ", false).is_empty());
        assert!(n.normalize("", true).is_empty());
        let unknown = r#"{"totally":"unknown"}"#;
        assert_eq!(n.normalize(unknown, false), vec![unknown.to_string()]);
        assert_eq!(
            n.normalize("{not json", false),
            vec!["{not json".to_string()]
        );
    }

    // ── Usage and cost ──────────────────────────────────────────────────────────────────────────

    /// The `usage` object of a normalized line, or `None` when it carries none.
    fn usage_of(line: &str) -> Option<Value> {
        let v: Value = serde_json::from_str(line).expect("json");
        v.get("usage").cloned()
    }

    fn num(usage: &Value, name: &str) -> i64 {
        usage.get(name).and_then(|n| n.as_i64()).unwrap_or(-1)
    }

    #[test]
    fn claude_reported_cost_is_carried_as_the_agents_own() {
        let mut n = EventWireNormalizer::new();
        n.normalize(
            r#"{"type":"system","subtype":"init","session_id":"s1","model":"claude-3-5-sonnet"}"#,
            false,
        );

        // The shape a real Claude Code run ends on: the cache counters carry Claude's own names and
        // the charge sits beside the usage rather than inside it.
        let done = n.normalize(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done.","duration_ms":3880,"total_cost_usd":0.9412,
                "usage":{"input_tokens":120,"output_tokens":4200,"cache_read_input_tokens":640000,"cache_creation_input_tokens":4459},
                "modelUsage":{"claude-opus-4-1":{"inputTokens":120}}}"#,
            false,
        );
        let usage = usage_of(&done[0]).expect("a reported usage reaches the result event");
        assert_eq!(num(&usage, "input_tokens"), 120);
        assert_eq!(num(&usage, "output_tokens"), 4200);
        // Without the alias this counted 0, and on a long run it is most of the bill.
        assert_eq!(num(&usage, "cache_read_tokens"), 640_000);
        assert_eq!(num(&usage, "cache_write_tokens"), 4459);
        assert_eq!(usage.get("cost_usd").and_then(|c| c.as_f64()), Some(0.9412));
        // Measured, not priced — and labelled so the viewer can say which.
        assert_eq!(
            usage.get("cost_source").and_then(|s| s.as_str()),
            Some("agent")
        );
        // `modelUsage` is the only place a finished Claude turn names its model, and it outranks the
        // one `session_init` announced.
        assert_eq!(
            usage.get("model").and_then(|m| m.as_str()),
            Some("claude-opus-4-1")
        );
    }

    #[test]
    fn a_run_that_reports_no_cost_is_priced_and_labelled_as_an_estimate() {
        let mut n = EventWireNormalizer::new();
        n.normalize(
            r#"{"type":"system","subtype":"init","session_id":"s1","model":"claude-3-5-sonnet"}"#,
            false,
        );

        let done = n.normalize(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done.",
                "usage":{"input_tokens":1000,"output_tokens":2000,"cache_read_input_tokens":3000,"cache_creation_input_tokens":4000}}"#,
            false,
        );
        let usage = usage_of(&done[0]).expect("usage");
        assert_eq!(
            usage.get("cost_source").and_then(|s| s.as_str()),
            Some("estimated")
        );
        // The same price list `jobs::manager` estimates a job's cost from, so the two cannot disagree.
        let expected =
            crate::agents::pricing::calculate_cost("claude-3-5-sonnet", 1000, 2000, 3000, 4000);
        assert_eq!(
            usage.get("cost_usd").and_then(|c| c.as_f64()),
            Some(expected)
        );
        // The model came from `session_init`, which is the only place this provider named it.
        assert_eq!(
            usage.get("model").and_then(|m| m.as_str()),
            Some("claude-3-5-sonnet")
        );
    }

    #[test]
    fn an_unpriceable_model_reports_tokens_and_no_cost_at_all() {
        let mut n = EventWireNormalizer::new();
        n.normalize(
            r#"{"type":"system","subtype":"init","session_id":"s1","model":"some-model-nobody-has-priced"}"#,
            false,
        );
        let done = n.normalize(
            r#"{"type":"result","is_error":false,"usage":{"input_tokens":10,"output_tokens":20}}"#,
            false,
        );
        let usage = usage_of(&done[0]).expect("usage");
        assert_eq!(num(&usage, "input_tokens"), 10);
        // Pricing an unknown model off the fallback rate would invent a figure with no provenance.
        assert!(usage.get("cost_usd").is_none());
        assert!(usage.get("cost_source").is_none());
    }

    #[test]
    fn a_provider_that_reports_nothing_carries_no_usage_key() {
        let mut n = EventWireNormalizer::new();
        // Absent is not zero: the viewer shows "not reported" rather than "consumed nothing".
        let done = n.normalize(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done.","duration_ms":1863}"#,
            false,
        );
        assert!(usage_of(&done[0]).is_none());
        // An all-zero usage object says nothing either.
        let zeros = n.normalize(
            r#"{"type":"result","is_error":false,"usage":{"input_tokens":0,"output_tokens":0}}"#,
            false,
        );
        assert!(usage_of(&zeros[0]).is_none());
    }

    #[test]
    fn opencode_step_finish_accumulates_and_emits_terminal_result() {
        let mut n = EventWireNormalizer::new();
        n.remember_model(Some("claude-3-5-sonnet"));

        // Intermediate tool-calls step should produce no events
        let intermediate = n.normalize(
            r#"{"type":"step_finish","part":{"reason":"tool-calls","cost":0.005,"tokens":{"input":1000,"output":200}}}"#,
            false,
        );
        assert!(intermediate.is_empty());

        // Terminal stop step accumulates previous tokens and cost
        let done = n.normalize(
            r#"{"type":"step_finish","part":{"reason":"stop","cost":0.010,"tokens":{"input":2000,"output":300}}}"#,
            false,
        );
        assert_eq!(done.len(), 1);
        let usage = usage_of(&done[0]).expect("opencode usage");
        assert_eq!(num(&usage, "input_tokens"), 3000);
        assert_eq!(num(&usage, "output_tokens"), 500);
        assert!((usage.get("cost_usd").and_then(|c| c.as_f64()).unwrap() - 0.015).abs() < 1e-6);
        assert_eq!(usage.get("cost_source").and_then(|s| s.as_str()), Some("agent"));
    }

    #[test]
    fn apple_system_on_device_reports_zero_cost() {
        let mut n = EventWireNormalizer::new();
        n.remember_model(Some("apple/system"));

        let done = n.normalize(
            r#"{"type":"step_finish","part":{"reason":"stop","cost":0.0,"tokens":{"input":43,"output":20}}}"#,
            false,
        );
        assert_eq!(done.len(), 1);
        let usage = usage_of(&done[0]).expect("apple usage");
        assert_eq!(num(&usage, "input_tokens"), 43);
        assert_eq!(num(&usage, "output_tokens"), 20);
        assert_eq!(usage.get("cost_usd").and_then(|c| c.as_f64()), Some(0.0));
        assert_eq!(usage.get("cost_source").and_then(|s| s.as_str()), Some("agent"));
    }

    #[test]
    fn subsidized_zero_cost_run_on_priced_model_is_estimated() {
        let mut n = EventWireNormalizer::new();
        n.normalize(
            r#"{"type":"system","subtype":"init","session_id":"s1","model":"claude-3-5-sonnet"}"#,
            false,
        );

        // Claude on subscription: reports 0 cost
        let done = n.normalize(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Done.",
                "usage":{"input_tokens":1000,"output_tokens":2000,"cost_usd":0.0}}"#,
            false,
        );
        let usage = usage_of(&done[0]).expect("usage");
        assert_eq!(usage.get("cost_source").and_then(|s| s.as_str()), Some("estimated"));
        let expected = crate::agents::pricing::calculate_cost("claude-3-5-sonnet", 1000, 2000, 0, 0);
        assert_eq!(usage.get("cost_usd").and_then(|c| c.as_f64()), Some(expected));
    }

    #[test]
    fn codex_gemini_and_antigravity_usage_all_land_in_the_same_fields() {
        // Codex: `cached_input_tokens`, and reasoning counted *inside* output_tokens.
        let mut codex = EventWireNormalizer::new();
        let turn = codex.normalize(
            r#"{"type":"turn.completed","usage":{"input_tokens":900,"output_tokens":47,"cached_input_tokens":128,"reasoning_output_tokens":28}}"#,
            false,
        );
        let usage = usage_of(&turn[0]).expect("codex usage");
        assert_eq!(num(&usage, "cache_read_tokens"), 128);
        assert_eq!(num(&usage, "reasoning_tokens"), 28);
        // Reasoning is not added to the billable total; Codex already counted it in `output_tokens`.
        assert!(usage.get("cost_source").is_none(), "no model was named");

        // Gemini: per-model counters under `stats.models`, summed across the models it used.
        let mut gemini = EventWireNormalizer::new();
        let result = gemini.normalize(
            r#"{"type":"result","response":"Done.","stats":{"models":[{"name":"gemini-2.5-pro","prompt":500,"candidates":250,"cacheRead":100},{"name":"gemini-2.5-flash","prompt":50,"candidates":25,"cacheRead":0}]}}"#,
            false,
        );
        let usage = usage_of(&result[0]).expect("gemini usage");
        assert_eq!(num(&usage, "input_tokens"), 550);
        assert_eq!(num(&usage, "output_tokens"), 275);
        assert_eq!(num(&usage, "cache_read_tokens"), 100);
        assert_eq!(
            usage.get("model").and_then(|m| m.as_str()),
            Some("gemini-2.5-pro")
        );

        // Antigravity: nested under its own `result`, with `prompt_tokens`/`completion_tokens` names.
        let mut agy = EventWireNormalizer::new();
        let done = agy.normalize(
            r#"{"event":"result","result":{"status":"SUCCESS","response":"ok","duration_seconds":2.5,"usage":{"prompt_tokens":300,"completion_tokens":40,"total_cost_usd":0.02}}}"#,
            false,
        );
        let usage = usage_of(&done[0]).expect("antigravity usage");
        assert_eq!(num(&usage, "input_tokens"), 300);
        assert_eq!(num(&usage, "output_tokens"), 40);
        assert_eq!(usage.get("cost_usd").and_then(|c| c.as_f64()), Some(0.02));
        assert_eq!(
            usage.get("cost_source").and_then(|s| s.as_str()),
            Some("agent")
        );
        assert_eq!(field(&done[0], "duration_ms"), "2500");
    }

    /// Captured from a real `cursor-agent 2026.09.18` run: `cursor-agent --print --output-format
    /// stream-json --trust --force --model claude-opus-5-low`, asked to run a shell command and
    /// then read a file that does not exist. Trimmed to the fields the normaliser reads.
    #[test]
    fn test_cursor_live_stream() {
        let mut n = EventWireNormalizer::new();

        // Cursor names the model the way a *person* reads it, not the way it is launched. The
        // session card should still show that name, and the cost path should still find a price.
        let init = n.normalize(
            r#"{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/tmp","session_id":"e07e1fbb","model":"Claude Opus 5 300K Low No Thinking","permissionMode":"default"}"#,
            false,
        );
        assert_eq!(kinds(&init), vec!["session_init"]);
        assert_eq!(field(&init[0], "session_id"), "e07e1fbb");

        // Reasoning arrives a delta at a time, and the `completed` line closes it with no text.
        let thinking = n.normalize(
            r#"{"type":"thinking","subtype":"delta","text":"Let me run that."}"#,
            false,
        );
        assert_eq!(kinds(&thinking), vec!["thinking"]);
        assert_eq!(field(&thinking[0], "content"), "Let me run that.");
        assert!(n
            .normalize(r#"{"type":"thinking","subtype":"completed"}"#, false)
            .is_empty());

        // A tool opens on `started`. The tool's *name* is the key -- `shellToolCall` -- and the id
        // that pairs the two halves is `toolCallId`.
        let started = n.normalize(
            r#"{"type":"tool_call","subtype":"started","call_id":"toolu_vrtx_01WL","tool_call":{"shellToolCall":{"args":{"command":"echo hi","toolCallId":"toolu_vrtx_01WL"},"description":"Echo hi"},"toolCallId":"toolu_vrtx_01WL","startedAtMs":"1789943048258"}}"#,
            false,
        );
        assert_eq!(kinds(&started), vec!["tool_call"]);
        assert_eq!(field(&started[0], "tool_use_id"), "toolu_vrtx_01WL");
        assert_eq!(field(&started[0], "tool_name"), "shell");
        assert_eq!(field(&started[0], "description"), "Echo hi");

        // ...and closes on `completed`, which carries both halves so a dropped `started` still
        // produces a whole card.
        let completed = n.normalize(
            r#"{"type":"tool_call","subtype":"completed","call_id":"toolu_vrtx_01WL","tool_call":{"shellToolCall":{"args":{"command":"echo hi"},"result":{"success":{"command":"echo hi","exitCode":0,"stdout":"hi\n","stderr":""},"isBackground":false},"description":"Echo hi"},"toolCallId":"toolu_vrtx_01WL","completedAtMs":"1789943049133"}}"#,
            false,
        );
        assert_eq!(kinds(&completed), vec!["tool_call", "tool_result"]);
        assert_eq!(field(&completed[1], "tool_use_id"), "toolu_vrtx_01WL");
        assert_eq!(field(&completed[1], "output"), "hi\n");
        assert_eq!(field(&completed[1], "is_error"), "false");

        // A failed read carries *only* a result -- no `args` at all -- and the message is the card.
        let failed = n.normalize(
            r#"{"type":"tool_call","subtype":"completed","call_id":"toolu_vrtx_01Mj","tool_call":{"readToolCall":{"result":{"error":{"errorMessage":"File not found"}}},"toolCallId":"toolu_vrtx_01Mj","completedAtMs":"1789943050762"}}"#,
            false,
        );
        assert_eq!(kinds(&failed), vec!["tool_call", "tool_result"]);
        assert_eq!(field(&failed[1], "tool_name"), "read");
        assert_eq!(field(&failed[1], "output"), "File not found");
        assert_eq!(field(&failed[1], "is_error"), "true");

        // Cursor's assistant and result lines are Claude's shapes, so they need no arm of their own.
        let assistant = n.normalize(
            r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done."}]},"session_id":"e07e1fbb"}"#,
            false,
        );
        assert_eq!(kinds(&assistant), vec!["text"]);

        let result = n.normalize(
            r#"{"type":"result","subtype":"success","duration_ms":8262,"is_error":false,"result":"Done.","session_id":"e07e1fbb","usage":{"inputTokens":6,"outputTokens":190,"cacheReadTokens":0,"cacheWriteTokens":68868}}"#,
            false,
        );
        let usage = usage_of(&result[0]).expect("cursor usage");
        assert_eq!(num(&usage, "input_tokens"), 6);
        assert_eq!(num(&usage, "output_tokens"), 190);
        assert_eq!(num(&usage, "cache_write_tokens"), 68868);
        // Cursor reports no cost of its own, so the cost is the one Tendril prices -- which it can
        // only do because the display name from `init` was resolved onto a real id.
        assert_eq!(
            usage.get("model").and_then(|m| m.as_str()),
            Some("claude-opus-5-300k-low-no-thinking")
        );
        assert!(
            usage
                .get("cost_usd")
                .and_then(|c| c.as_f64())
                .unwrap_or(0.0)
                > 0.0,
            "a priced Cursor run should carry a cost: {usage:?}"
        );
    }

    /// The display name `init` reports is not a model id, and a run whose model cannot be priced
    /// must report *no* cost rather than a confident zero.
    #[test]
    fn test_cursor_model_names_are_resolved_or_left_unpriced() {
        // The names really seen on the wire, and the ids they have to reach.
        for (display, resolved) in [
            ("GPT-5.6 Terra 272K Medium", "gpt-5.6-terra"),
            ("Claude Opus 5 300K Low No Thinking", "claude-opus-5"),
            ("Claude Opus 4.8 Thinking Max", "claude-opus-4-8"),
            ("Gemini 3.8 Flash High", "gemini-3.8-flash"),
            ("GPT-5.5 272K Extra High", "gpt-5.5"),
        ] {
            let name = priceable_model_name(display);
            let spec = model_specs::find(&name)
                .unwrap_or_else(|| panic!("{display} should resolve to a priced row"));
            assert_eq!(spec.model_id, resolved, "{display}");
            assert!(model_specs::is_priced(&spec), "{display} should be priced");
        }

        // An id-shaped name is never rewritten...
        assert_eq!(priceable_model_name("claude-opus-5"), "claude-opus-5");
        // ...and a model with no rate card keeps its name and prices nothing, which is what makes
        // the missing cost read as "unknown" instead of "free".
        for unpriced in ["Auto", "Some Model Cursor Has Not Shipped Yet"] {
            let name = priceable_model_name(unpriced);
            assert!(
                model_specs::find(&name)
                    .filter(model_specs::is_priced)
                    .is_none(),
                "{unpriced} has no rate card, so it must not resolve to a priced row"
            );
        }

        // Cursor's own house models are not in the `cursor` catalog -- the picker does not offer
        // them -- but a run can still arrive on one, from a `config.yaml` naming it or from Auto
        // routing there. They carry rates, so they price rather than reporting a silent zero, and
        // the display name has to survive the rewrite to reach them.
        for (display, resolved, input_rate) in [
            ("Composer 2.5", "composer-2.5", 0.5),
            ("Muse Spark 1.3 1M High", "muse-spark-1.3", 1.25),
            ("Cursor Grok 4.6 Medium", "cursor-grok-4.6", 2.0),
            ("Cursor Grok 4.5", "cursor-grok-4.5", 2.0),
        ] {
            let spec = model_specs::find(&priceable_model_name(display))
                .unwrap_or_else(|| panic!("{display} should resolve"));
            assert_eq!(spec.model_id, resolved, "{display}");
            assert!(model_specs::is_priced(&spec), "{display} should be priced");
            assert_eq!(spec.input_per_million, input_rate, "{display}");
        }

        // Grok 4.6 and 4.5 are rated identically, so the only thing keeping them apart is the
        // longest-key rule. A run on 4.5 must not be priced as 4.6 even though the rates agree
        // today -- if Cursor ever repriced one, that would become a silent mischarge.
        assert_eq!(
            model_specs::find(&priceable_model_name("Cursor Grok 4.5 Low"))
                .map(|s| s.model_id.to_string()),
            Some("cursor-grok-4.5".to_string())
        );

        // `kimi-k3` is the interesting middle case: the row exists, the rates are all zero, and
        // `is_priced` is what stops a real run being reported as free.
        let mut n = EventWireNormalizer::new();
        n.normalize(
            r#"{"type":"system","subtype":"init","session_id":"s","model":"Kimi K3 Low"}"#,
            false,
        );
        let result = n.normalize(
            r#"{"type":"result","subtype":"success","duration_ms":10,"result":"ok","usage":{"inputTokens":1000,"outputTokens":1000,"cacheReadTokens":0,"cacheWriteTokens":0}}"#,
            false,
        );
        let usage = usage_of(&result[0]).expect("kimi usage");
        assert_eq!(num(&usage, "input_tokens"), 1000);
        assert!(
            !usage
                .as_object()
                .is_some_and(|u| u.contains_key("cost_usd")),
            "an unpriced model must omit the cost rather than report zero: {usage:?}"
        );
    }

    /// The parser must not depend on a list of Cursor's sixty-odd tool names, and must not break on
    /// the ids Cursor sometimes malforms.
    #[test]
    fn test_cursor_tool_calls_are_parsed_structurally() {
        let mut n = EventWireNormalizer::new();

        // A tool nobody has heard of still opens a card, named after itself.
        let unknown = n.normalize(
            r#"{"type":"tool_call","subtype":"started","tool_call":{"somethingBrandNewToolCall":{"args":{"x":1}},"toolCallId":"tc-1"}}"#,
            false,
        );
        assert_eq!(kinds(&unknown), vec!["tool_call"]);
        assert_eq!(field(&unknown[0], "tool_name"), "somethingBrandNew");

        // **`call_id` is sometimes two ids joined by a newline**, which would split one event into
        // two unparseable lines. `toolCallId` is preferred, and both are sanitised.
        let dirty = n.normalize(
            "{\"type\":\"tool_call\",\"subtype\":\"started\",\"call_id\":\"call_311mRT\\nfc_0a3dd8\",\"tool_call\":{\"shellToolCall\":{\"args\":{}},\"toolCallId\":\"call_311mRT\\nfc_0a3dd8\"}}",
            false,
        );
        assert_eq!(field(&dirty[0], "tool_use_id"), "call_311mRT");
        for line in &dirty {
            assert!(!line.trim_end().contains('\n'), "an event must be one line");
        }

        // A `tool_call` with no id at all, or no tool key, is dropped rather than emitting a card
        // that can never be closed.
        assert!(n
            .normalize(
                r#"{"type":"tool_call","subtype":"started","tool_call":{"shellToolCall":{"args":{}}}}"#,
                false
            )
            .is_empty());
        assert!(n
            .normalize(
                r#"{"type":"tool_call","subtype":"started","tool_call":{"toolCallId":"tc-2"}}"#,
                false
            )
            .is_empty());
    }
}
