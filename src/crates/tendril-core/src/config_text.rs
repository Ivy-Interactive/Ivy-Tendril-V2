//! Masked, text-preserving reads and writes of `config.yaml` for the in-app raw editor.
//!
//! V1 shipped this screen as `RawConfigEditorView.cs`: the whole file in a YAML code box, written
//! back verbatim on Save. Two things were wrong with it, and both are fixed here rather than in the
//! view. The first is that every credential in `config.yaml` — `llm.apiKey`, `api.apiKey`,
//! `auth.hashSecret`, every coding agent's `environmentVariables` — was rendered in cleartext, and
//! in V2 that page is a webview somebody screen-shares. The second is that Save wrote whatever was
//! in the box, so a typo left a daemon that no longer loads its own config.
//!
//! The editor is therefore served a *masked* copy and writes back through [`unmask_config_text`]:
//! the secret never crosses into the webview, and a placeholder the user did not touch resolves
//! back to the stored value on save.
//!
//! # Why this is a line scanner and not `serde_yaml`
//!
//! `serde_yaml::from_str` followed by `to_string` would be three lines, and it destroys comments,
//! blank lines and key order — which is the entire reason somebody opens a raw config editor
//! instead of the Settings screen. Everything here works on the text instead: a line that is not a
//! plain `key: value` pair passes through byte for byte, and the only edit ever made to a line is
//! the replacement of one value span. `mask` then `unmask` with nothing touched in between is the
//! identity function, down to the bytes.
//!
//! # Failing closed
//!
//! A line scanner cannot see inside a block scalar, a flow mapping, or a value that runs over
//! several lines. Where it cannot be certain it is looking at one whole plain scalar, it does not
//! guess: if a secret could be hiding there, the scan returns an error and the editor refuses to
//! open the file. A config that cannot be edited in the app is a nuisance; a config that renders an
//! API key into a webview because a `|` confused the scanner is an incident.

use crate::config::TendrilSettings;
use crate::error::{Result, TendrilError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ops::Range;
use std::path::Path;

/// The literal that stands in for a secret, emitted **quoted** (`apiKey: "********"`).
///
/// The quoting is load-bearing. An unquoted `[REDACTED]`-style sentinel parses as a YAML flow
/// sequence and fails validation against a `String` field, so the masked document the editor is
/// handed would not itself be a loadable config.
pub const SECRET_MASK: &str = "********";

/// Key names whose value is a secret.
///
/// Copied verbatim from `SECRET_KEY_SUFFIXES` in
/// `src/crates/tendril-cli/src/commands/report_bug.rs`, which is the list the bug reporter has been
/// redacting attachments with. Duplicated rather than shared on purpose: the two call sites answer
/// different questions (that one sanitises a tree it is about to throw away, this one rewrites text
/// it must give back unchanged), and a refactor that merged them would have to touch the bug
/// reporter's redaction path in the same change that introduces this one.
///
/// Compared with `-` and `_` stripped and case folded, and matched as a suffix, so `hashSecret`,
/// `hash_secret` and `AUTH-SECRET` all hit `secret`.
const SECRET_KEY_SUFFIXES: [&str; 11] = [
    "password",
    "hashsecret",
    "secret",
    "apikey",
    "token",
    "accesstoken",
    "refreshtoken",
    "clientsecret",
    "privatekey",
    "credential",
    "passphrase",
];

/// Mapping names whose values are all secrets regardless of their own names: an agent's environment
/// block is where API keys are configured, and the variable names are the agent's own. Also copied
/// from `report_bug.rs` (`REDACT_EVERY_VALUE_MAPPINGS`).
const REDACT_EVERY_VALUE_MAPPINGS: [&str; 2] = ["environmentvariables", "env"];

/// `config.yaml` as the editor should see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskedConfig {
    /// `config.yaml` verbatim — comments, key order and blank lines intact — with every secret
    /// value replaced by [`SECRET_MASK`].
    pub text: String,
    /// Dotted paths that were masked, e.g. `llm.apiKey` or
    /// `codingAgents[2].environmentVariables.ANTHROPIC_API_KEY`, in document order.
    pub masked_paths: Vec<String>,
}

/// `raw` with every secret value replaced by a quoted [`SECRET_MASK`], and nothing else changed.
///
/// Returns an error rather than a partially masked document whenever the scanner meets a shape it
/// cannot read with confidence — see the module header on failing closed.
pub fn mask_config_text(raw: &str) -> Result<MaskedConfig> {
    let scan = scan_document(raw)?;
    let mut lines: Vec<String> = raw.split('\n').map(str::to_string).collect();
    let mut masked_paths = Vec::new();
    let replacement = format!("\"{}\"", SECRET_MASK);

    for scalar in &scan.scalars {
        if !scalar.secret {
            continue;
        }
        // An unset `apiKey:` or `apiKey: ""` holds nothing worth hiding, and showing `********`
        // over it would tell the user a credential is configured when none is.
        if strip_one_quote_layer(lines[scalar.line][scalar.span.clone()].trim()).is_empty() {
            continue;
        }
        // At most one scalar is recorded per line, so splicing in place cannot invalidate a span
        // that is still to be used.
        lines[scalar.line].replace_range(scalar.span.clone(), &replacement);
        masked_paths.push(render_path(&scalar.path));
    }

    Ok(MaskedConfig {
        text: lines.join("\n"),
        masked_paths,
    })
}

/// `edited` with every [`SECRET_MASK`] placeholder resolved back to the value `original_raw` holds
/// **at the same path**.
///
/// By path, never by position: two different credentials both render as `********`, so walking the
/// two documents in parallel and substituting the n-th secret for the n-th placeholder silently
/// swaps them the moment the user reorders, adds or deletes a key — and a swapped credential is a
/// failure that looks like a working save. A placeholder at a path `original_raw` does not have is
/// an error, because the only alternatives are writing `********` to disk as though it were a
/// credential or guessing which one the user meant.
pub fn unmask_config_text(edited: &str, original_raw: &str) -> Result<String> {
    let scan = scan_document(edited)?;
    let mut lines: Vec<String> = edited.split('\n').map(str::to_string).collect();

    let placeholders: Vec<&ScalarLine> = scan
        .scalars
        .iter()
        .filter(|s| is_mask_sentinel(&lines[s.line][s.span.clone()]))
        .collect();
    if placeholders.is_empty() {
        // Nothing to resolve, so the original is never parsed. That matters: a raw editor's main
        // job is fixing a config.yaml too broken for `serde_yaml`, and demanding that the broken
        // original parse before any save would lock the user out of the one screen that helps.
        return Ok(edited.to_string());
    }

    let original_scan = scan_document(original_raw)?;
    let original_lines: Vec<&str> = original_raw.split('\n').collect();
    // A repeated key overwrites its earlier twin here, but that case never reaches resolution:
    // `serde_yaml` refuses a duplicate key outright, so the tree parse below fails first and the
    // save is refused rather than resolved to whichever of the two happened to land last.
    let mut stored: HashMap<&[Segment], &str> = HashMap::new();
    for scalar in &original_scan.scalars {
        stored.insert(
            scalar.path.as_slice(),
            &original_lines[scalar.line][scalar.span.clone()],
        );
    }

    let tree: serde_yaml::Value = serde_yaml::from_str(original_raw).map_err(|_| {
        // The parse error is dropped rather than wrapped: `serde_yaml` quotes the offending text,
        // and the offending text here can be a credential.
        TendrilError::Config(
            "the config.yaml on disk cannot be parsed, so the masked values in it cannot be \
             resolved. Retype the masked values, or fix the file on disk first."
                .to_string(),
        )
    })?;

    for placeholder in placeholders {
        let path = render_path(&placeholder.path);
        let unresolved =
            || TendrilError::Config(format!("cannot resolve masked value for {}", path));

        let text = *stored
            .get(placeholder.path.as_slice())
            .ok_or_else(unresolved)?;
        // The parsed tree is consulted as well as the text index, and the two must agree. They are
        // built by different code — an indentation stack here, a YAML parser there — so a scanner
        // that mis-numbered a sequence item disagrees with the tree and the save is refused,
        // instead of resolving a placeholder from the wrong `codingAgents[n]`.
        let node = resolve_in_tree(&tree, &placeholder.path).ok_or_else(unresolved)?;
        let parsed: serde_yaml::Value = serde_yaml::from_str(text).map_err(|_| unresolved())?;
        if &parsed != node {
            return Err(unresolved());
        }

        lines[placeholder.line].replace_range(placeholder.span.clone(), text);
    }

    Ok(lines.join("\n"))
}

/// `config.yaml` read from disk and masked for the editor.
///
/// No lock is taken. `write_atomic` publishes by rename, so a reader either sees the whole old file
/// or the whole new one; holding the lock here would only make a concurrent save wait on a
/// keystroke. A file that is not there yet reads as empty rather than as an error, so the editor
/// opens on a blank document on a fresh install instead of refusing to open at all.
pub fn read_config_text_masked(config_path: &Path) -> Result<MaskedConfig> {
    if !config_path.exists() {
        return Ok(MaskedConfig {
            text: String::new(),
            masked_paths: Vec::new(),
        });
    }
    let raw = std::fs::read_to_string(config_path).map_err(|e| {
        TendrilError::Config(format!(
            "Failed to read config file {}: {}",
            config_path.display(),
            e
        ))
    })?;
    mask_config_text(&raw)
}

/// Resolves the masked values in `edited` against what is on disk, validates the result, and writes
/// the user's own bytes.
///
/// One lock spans read-original, unmask, validate and write. Releasing it between the halves is how
/// two concurrent edits drop each other, and it is also how the unmasked placeholders could resolve
/// against a file that no longer exists in that form — see the same discipline in
/// [`crate::config::update_config_raw`].
///
/// `write_atomic` and not `save_config` or `update_config_raw`: both of those acquire this lock
/// themselves, and `FileLock` does not nest — a nested acquire burns its whole retry budget and
/// fails (see the caveat on [`crate::fs_lock::FileLock::acquire`]).
pub fn write_config_text_unmasked(config_path: &Path, edited: &str) -> Result<()> {
    let _lock = crate::fs_lock::FileLock::acquire(config_path)?;

    let original_raw = if config_path.exists() {
        std::fs::read_to_string(config_path).map_err(|e| {
            TendrilError::Config(format!("Failed to read {}: {}", config_path.display(), e))
        })?
    } else {
        String::new()
    };

    let unmasked = unmask_config_text(edited, &original_raw)?;

    if serde_yaml::from_str::<TendrilSettings>(&unmasked).is_err() {
        return Err(validation_error_without_secrets(edited));
    }

    // The user's own bytes, never `serde_yaml::to_string` of a parsed tree: re-serialising is what
    // would throw away the comments and ordering this whole module exists to keep.
    crate::fs_lock::write_atomic(config_path, unmasked.as_bytes())
}

/// A validation failure phrased so that it cannot carry a credential.
///
/// Validation runs on the UNMASKED text, and `serde_yaml` quotes the offending value in its message
/// ("invalid type: integer `1234`, expected a string"), so the offending value can be the API key
/// itself. Re-running the same validation against what the user actually submitted — still masked —
/// produces the same complaint about a placeholder instead. When the masked text validates cleanly,
/// the failure came from the shape of a stored secret and there is nothing safe left to quote, so
/// the message names the problem without it.
fn validation_error_without_secrets(submitted: &str) -> TendrilError {
    match serde_yaml::from_str::<TendrilSettings>(submitted) {
        Err(e) => TendrilError::Config(format!("config.yaml is not valid: {}", e)),
        Ok(_) => TendrilError::Config(
            "config.yaml is not valid once the masked secrets are filled back in: one of the \
             stored secret values has a type this config does not accept. Retype it in the editor."
                .to_string(),
        ),
    }
}

// ---------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------

/// One step of a YAML path.
///
/// Kept structured rather than as a dotted string until the last moment, because a mapping key may
/// itself contain a `.` (`env.PATH` is a legal variable name) and re-splitting a dotted string
/// would resolve such a placeholder against the wrong node.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Segment {
    Key(String),
    Index(usize),
}

/// The dotted, bracketed rendering the editor and error messages use: `codingAgents[2].env.KEY`.
fn render_path(path: &[Segment]) -> String {
    let mut out = String::new();
    for segment in path {
        match segment {
            Segment::Key(key) => {
                if !out.is_empty() {
                    out.push('.');
                }
                out.push_str(key);
            }
            Segment::Index(index) => {
                out.push('[');
                out.push_str(&index.to_string());
                out.push(']');
            }
        }
    }
    out
}

fn resolve_in_tree<'a>(
    root: &'a serde_yaml::Value,
    path: &[Segment],
) -> Option<&'a serde_yaml::Value> {
    let mut node = root;
    for segment in path {
        node = match segment {
            Segment::Key(key) => node.get(key.as_str())?,
            Segment::Index(index) => node.get(*index)?,
        };
    }
    Some(node)
}

// ---------------------------------------------------------------------------------------------
// Secret classification
// ---------------------------------------------------------------------------------------------

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|c| *c != '-' && *c != '_')
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_secret_key(normalized: &str) -> bool {
    SECRET_KEY_SUFFIXES
        .iter()
        .any(|suffix| normalized.ends_with(suffix))
}

fn is_redact_every_value_mapping(normalized: &str) -> bool {
    REDACT_EVERY_VALUE_MAPPINGS.contains(&normalized)
}

/// Whether a value, as it appears in the text, is the placeholder.
///
/// Trim, strip one layer of matching quotes, compare exactly: the editor emits `"********"`, but a
/// user who retypes the line by hand may well drop the quotes, and both mean "I did not touch this".
fn is_mask_sentinel(value: &str) -> bool {
    strip_one_quote_layer(value.trim()) == SECRET_MASK
}

fn strip_one_quote_layer(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        if (first == b'"' || first == b'\'') && bytes[bytes.len() - 1] == first {
            return &value[1..value.len() - 1];
        }
    }
    value
}

// ---------------------------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------------------------

/// One plain scalar the scanner was able to place, ready to be rewritten in situ.
struct ScalarLine {
    /// Index into the document's `\n`-separated lines.
    line: usize,
    path: Vec<Segment>,
    /// Byte range of the value within that line: quotes included, trailing comment excluded.
    span: Range<usize>,
    /// Whether this value is a credential and must be masked.
    secret: bool,
}

struct Scan {
    scalars: Vec<ScalarLine>,
}

enum FrameKind {
    Map,
    Seq { next_index: usize },
}

/// One open container on the indentation stack.
struct Frame {
    /// The column its entries start at.
    indent: usize,
    kind: FrameKind,
    /// Path of the container node itself; the root mapping's is empty.
    path: Vec<Segment>,
    /// Whether every value inside is a secret whatever its own key is — the
    /// `environmentVariables` / `env` rule.
    redact_all: bool,
}

/// A node whose contents begin on a later line, recorded when `key:` is seen with no value.
struct Pending {
    /// Column of the line that declared it. A mapping child must be deeper than this; a sequence
    /// item may sit at exactly this column, which is the shape `projects:` followed by unindented
    /// `- name: ...` takes.
    declared_at: usize,
    path: Vec<Segment>,
    redact_all: bool,
}

/// What follows a `:` (or a `- `) on one line.
enum ValueShape {
    /// Whitespace and perhaps a comment: the value, if any, is the block below.
    Empty,
    /// A scalar that begins and ends on this line, quotes included, comment excluded.
    Scalar(Range<usize>),
    /// A block scalar, or a quoted scalar whose closing quote is on a later line: the value runs
    /// past this line, so the caller has to skip the block below as well.
    Continued,
    /// On one line, but not text the scanner may rewrite: an anchor, an alias, a tag, or a quoted
    /// scalar with something after its closing quote. Rewriting past an anchor or a tag changes
    /// what the node means, and an alias's value is not on this line at all.
    Unreadable,
    /// A flow collection. `risky` marks the ones that could hide a mapping key — and therefore a
    /// secret — from a scanner that only ever looks at one line.
    Flow { empty: bool, risky: bool },
}

fn scan_document(text: &str) -> Result<Scan> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut scalars: Vec<ScalarLine> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut pending: Option<Pending> = None;
    let mut i = 0usize;

    while i < lines.len() {
        let raw = strip_cr(lines[i]);
        let trimmed = raw.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            i += 1;
            continue;
        }
        if trimmed == "---" || trimmed == "..." || trimmed.starts_with("--- ") {
            stack.clear();
            pending = None;
            i += 1;
            continue;
        }

        let indent = indent_of(raw);
        let content = &raw[indent..];
        // Taken unconditionally: whichever branch runs, this is the line the pending declaration
        // was peeked at, so leaving it set would let it be consumed twice.
        let opened_by = pending.take();

        while stack.last().is_some_and(|frame| frame.indent > indent) {
            stack.pop();
        }

        // Where the entry's key or scalar starts, the path it hangs off, and whether the container
        // makes it a secret whatever it is called.
        let entry_column: usize;
        let parent_path: Vec<Segment>;
        let parent_redact_all: bool;

        if is_sequence_entry(content) {
            let reuse = matches!(stack.last(), Some(frame)
                if frame.indent == indent && matches!(frame.kind, FrameKind::Seq { .. }));
            if !reuse {
                let (path, redact_all) = match opened_by {
                    Some(p) if p.declared_at <= indent => (p.path, p.redact_all),
                    // A document whose root node is a sequence is not a Tendril config, but it
                    // scans cleanly and there is no reason to refuse it here.
                    _ if stack.is_empty() => (Vec::new(), false),
                    _ => return Err(structure_error(i)),
                };
                stack.push(Frame {
                    indent,
                    kind: FrameKind::Seq { next_index: 0 },
                    path,
                    redact_all,
                });
            }

            let frame = stack
                .last_mut()
                .expect("a sequence frame was just established");
            let index = match &mut frame.kind {
                FrameKind::Seq { next_index } => {
                    let index = *next_index;
                    *next_index += 1;
                    index
                }
                FrameKind::Map => return Err(structure_error(i)),
            };
            let mut item_path = frame.path.clone();
            item_path.push(Segment::Index(index));
            let seq_redact_all = frame.redact_all;

            let after_dash = &content[1..];
            let lead = after_dash.len() - after_dash.trim_start().len();
            let item_column = indent + 1 + lead;

            if after_dash.trim().is_empty() {
                pending = Some(Pending {
                    declared_at: indent,
                    path: item_path,
                    redact_all: seq_redact_all,
                });
                i += 1;
                continue;
            }

            let item_content = &raw[item_column..];
            if is_sequence_entry(item_content) {
                // `- - x`. Legal YAML, but nothing in a Tendril config is shaped like it, and
                // guessing at the nesting is exactly the kind of confidence this module avoids.
                return Err(structure_error(i));
            }

            if split_key(item_content, item_column).is_some() {
                // A compact block mapping: `- name: claude` opens a mapping whose entries start at
                // the column after the dash.
                stack.push(Frame {
                    indent: item_column,
                    kind: FrameKind::Map,
                    path: item_path,
                    redact_all: seq_redact_all,
                });
                entry_column = item_column;
                parent_path = stack
                    .last()
                    .expect("the compact mapping frame was just pushed")
                    .path
                    .clone();
                parent_redact_all = seq_redact_all;
            } else {
                // A bare scalar item. It has no key of its own, so the only thing that can make it
                // a secret is sitting inside an `env` block.
                let declared_at = indent;
                let outcome = classify_value(
                    &lines,
                    i,
                    raw,
                    item_column,
                    &item_path,
                    seq_redact_all,
                    declared_at,
                )?;
                apply_outcome(outcome, &mut scalars, &mut pending, &mut i);
                continue;
            }
        } else {
            if matches!(stack.last(), Some(frame)
                if frame.indent == indent && matches!(frame.kind, FrameKind::Seq { .. }))
            {
                // A key back at the sequence's own column ends the sequence.
                stack.pop();
            }

            let have_frame = matches!(stack.last(), Some(frame)
                if frame.indent == indent && matches!(frame.kind, FrameKind::Map));
            if !have_frame {
                match opened_by {
                    Some(p) if p.declared_at < indent => stack.push(Frame {
                        indent,
                        kind: FrameKind::Map,
                        path: p.path,
                        redact_all: p.redact_all,
                    }),
                    _ if stack.is_empty() => stack.push(Frame {
                        indent,
                        kind: FrameKind::Map,
                        path: Vec::new(),
                        redact_all: false,
                    }),
                    _ => return Err(structure_error(i)),
                }
            }

            let frame = stack.last().expect("a mapping frame was just established");
            entry_column = indent;
            parent_path = frame.path.clone();
            parent_redact_all = frame.redact_all;
        }

        // Both branches converge here on a `key: ...` entry starting at `entry_column`.
        let entry_content = &raw[entry_column..];
        let Some((key, value_from)) = split_key(entry_content, entry_column) else {
            return Err(structure_error(i));
        };
        let normalized = normalize_key(&key);
        let secret = parent_redact_all || is_secret_key(&normalized);
        let child_redact_all = is_redact_every_value_mapping(&normalized);

        let mut path = parent_path;
        path.push(Segment::Key(key));

        let outcome = classify_value(&lines, i, raw, value_from, &path, secret, entry_column)?;
        let outcome = match outcome {
            // Only a mapping key opens a container whose name can switch on the `env` rule.
            Outcome::Opens(mut declaration) => {
                declaration.redact_all = child_redact_all;
                Outcome::Opens(declaration)
            }
            other => other,
        };
        apply_outcome(outcome, &mut scalars, &mut pending, &mut i);
    }

    Ok(Scan { scalars })
}

/// What the scanner decided about one entry's value.
enum Outcome {
    /// Nothing to record; carry on at the next line.
    Skip,
    /// Record this scalar and carry on at the next line.
    Record(ScalarLine),
    /// The value is the block below; carry on at the next line with this declaration pending.
    Opens(Pending),
    /// The value runs to this line index; resume there.
    ResumeAt(usize),
}

fn apply_outcome(
    outcome: Outcome,
    scalars: &mut Vec<ScalarLine>,
    pending: &mut Option<Pending>,
    cursor: &mut usize,
) {
    match outcome {
        Outcome::Skip => *cursor += 1,
        Outcome::Record(scalar) => {
            scalars.push(scalar);
            *cursor += 1;
        }
        Outcome::Opens(declaration) => {
            *pending = Some(declaration);
            *cursor += 1;
        }
        Outcome::ResumeAt(next) => *cursor = next,
    }
}

/// Decides what an entry's value is, and refuses the document when a secret could be hiding in a
/// shape the scanner cannot read.
///
/// `owner_indent` is the column of the thing that owns the value — the key for a mapping entry, the
/// dash for a sequence item — which is what decides whether the lines below belong to it.
fn classify_value(
    lines: &[&str],
    index: usize,
    raw: &str,
    value_from: usize,
    path: &[Segment],
    secret: bool,
    owner_indent: usize,
) -> Result<Outcome> {
    match analyse_value(raw, value_from) {
        ValueShape::Empty => {
            let Some((_, next_indent, next_is_item)) = next_content_line(lines, index + 1) else {
                return Ok(Outcome::Skip);
            };
            let opens_block =
                next_indent > owner_indent || (next_indent == owner_indent && next_is_item);
            if !opens_block {
                // An unset key. Nothing to hide and nothing to open.
                return Ok(Outcome::Skip);
            }
            if secret {
                return Err(subtree_error(path));
            }
            Ok(Outcome::Opens(Pending {
                declared_at: owner_indent,
                path: path.to_vec(),
                redact_all: false,
            }))
        }
        ValueShape::Scalar(span) => {
            // Deeper lines under what looked like a finished scalar mean one of two things, and
            // the scanner cannot tell them apart: a plain scalar continued over several lines, or a
            // line it misread as a scalar that is really a mapping key — `- name:claude`, with the
            // space after the colon missing, is the shape that found this. It is refused either
            // way, and refused whether or not THIS key is a secret: the danger is not this value
            // but the block below it, which would otherwise be stepped over unscanned, secrets and
            // all.
            if next_content_line(lines, index + 1).is_some_and(|(_, ind, _)| ind > owner_indent) {
                return Err(multiline_error(path));
            }
            Ok(Outcome::Record(ScalarLine {
                line: index,
                path: path.to_vec(),
                span,
                secret,
            }))
        }
        ValueShape::Continued => {
            if secret {
                return Err(multiline_error(path));
            }
            Ok(Outcome::ResumeAt(end_of_block(
                lines,
                index + 1,
                owner_indent,
            )))
        }
        ValueShape::Unreadable => {
            if secret {
                return Err(unreadable_error(path));
            }
            Ok(Outcome::Skip)
        }
        ValueShape::Flow { empty, risky } => {
            // A flow collection is refused even under an innocuous key, because the secret it hides
            // is inside it rather than on a line of its own: `llm: {apiKey: sk-live-...}` never
            // presents the scanner with an `apiKey:` line to mask.
            if risky {
                return Err(flow_error(path));
            }
            if !empty && secret {
                return Err(subtree_error(path));
            }
            Ok(Outcome::Skip)
        }
    }
}

fn analyse_value(raw: &str, from: usize) -> ValueShape {
    let rest = &raw[from..];
    let lead = rest.len() - rest.trim_start().len();
    let body = &rest[lead..];
    let start = from + lead;

    if body.is_empty() || body.starts_with('#') {
        return ValueShape::Empty;
    }

    // Tested before the first byte is dispatched on, because an unquoted `********` begins with
    // `*`, the alias indicator, and would otherwise be refused as a node written elsewhere. Letting
    // the sentinel through where a real `*alias` is refused is safe in the one direction that
    // matters: it is definitionally not a credential, and unmasking substitutes the stored value
    // for it before anything is validated or written.
    let unadorned = strip_trailing_comment(body).trim_end();
    if is_mask_sentinel(unadorned) {
        return ValueShape::Scalar(start..start + unadorned.len());
    }

    match body.as_bytes()[0] {
        // `|`, `>` and their chomping / indentation modifiers.
        b'|' | b'>' => ValueShape::Continued,
        b'&' | b'*' | b'!' => ValueShape::Unreadable,
        open @ (b'{' | b'[') => {
            let value = strip_trailing_comment(body).trim_end();
            let closer = if open == b'{' { b'}' } else { b']' };
            if value.as_bytes().last() != Some(&closer) {
                return ValueShape::Flow {
                    empty: false,
                    risky: true,
                };
            }
            let inner = &value[1..value.len() - 1];
            if inner.trim().is_empty() {
                return ValueShape::Flow {
                    empty: true,
                    risky: false,
                };
            }
            ValueShape::Flow {
                empty: false,
                // A `:` or a nested opener means there could be a mapping key in there, and a
                // mapping key is how a secret gets named.
                risky: inner.contains(':') || inner.contains('{') || inner.contains('['),
            }
        }
        b'"' | b'\'' => match find_closing_quote(body, 0) {
            Some(close) => {
                let tail = &body[close + 1..];
                let tail = tail.trim_start();
                if tail.is_empty() || tail.starts_with('#') {
                    ValueShape::Scalar(start..start + close + 1)
                } else {
                    ValueShape::Unreadable
                }
            }
            None => ValueShape::Continued,
        },
        _ => {
            let value = strip_trailing_comment(body).trim_end();
            ValueShape::Scalar(start..start + value.len())
        }
    }
}

/// The next line carrying content, as `(index, indent, is_sequence_entry)`.
///
/// Blank lines and comments are skipped. Skipping comments is safe for the continuation test a
/// caller uses this for: a continuation line of a plain scalar cannot begin with `#`, because that
/// is where the scalar ends and a comment begins.
fn next_content_line(lines: &[&str], from: usize) -> Option<(usize, usize, bool)> {
    lines
        .iter()
        .enumerate()
        .skip(from)
        .find_map(|(index, line)| {
            let raw = strip_cr(line);
            let trimmed = raw.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let indent = indent_of(raw);
            Some((index, indent, is_sequence_entry(&raw[indent..])))
        })
}

/// The index of the first line that is no longer part of a block owned by something at
/// `owner_indent`.
fn end_of_block(lines: &[&str], from: usize, owner_indent: usize) -> usize {
    let mut index = from;
    while index < lines.len() {
        let raw = strip_cr(lines[index]);
        if raw.trim().is_empty() {
            index += 1;
            continue;
        }
        if indent_of(raw) <= owner_indent {
            break;
        }
        index += 1;
    }
    index
}

/// Splits `key:` off the front of a mapping entry, returning the key with one layer of quotes
/// removed and the byte offset just past the colon.
///
/// The colon only separates a key from a value when whitespace or the end of the line follows it,
/// which is what keeps `endpoint: https://host` from being read as the key `endpoint: https`.
fn split_key(content: &str, base: usize) -> Option<(String, usize)> {
    let first = *content.as_bytes().first()?;

    if first == b'"' || first == b'\'' {
        let close = find_closing_quote(content, 0)?;
        let after = &content[close + 1..];
        let gap = after.len() - after.trim_start().len();
        let colon = close + 1 + gap;
        if content.as_bytes().get(colon) != Some(&b':') {
            return None;
        }
        if !followed_by_space_or_end(content, colon) {
            return None;
        }
        return Some((content[1..close].to_string(), base + colon + 1));
    }

    let mut cursor = 0usize;
    while let Some(offset) = content[cursor..].find(':') {
        let colon = cursor + offset;
        if followed_by_space_or_end(content, colon) {
            let key = content[..colon].trim_end();
            if key.is_empty() {
                return None;
            }
            return Some((key.to_string(), base + colon + 1));
        }
        cursor = colon + 1;
    }
    None
}

fn followed_by_space_or_end(content: &str, colon: usize) -> bool {
    match content.as_bytes().get(colon + 1) {
        None => true,
        Some(b' ' | b'\t') => true,
        Some(_) => false,
    }
}

/// The index of the quote that closes the one at `open`, honouring `''` inside single quotes and
/// `\"` inside double ones.
fn find_closing_quote(text: &str, open: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let quote = bytes[open];
    let mut index = open + 1;
    while index < bytes.len() {
        if bytes[index] == quote {
            if quote == b'\'' && bytes.get(index + 1) == Some(&b'\'') {
                index += 2;
                continue;
            }
            return Some(index);
        }
        if quote == b'"' && bytes[index] == b'\\' {
            index += 2;
            continue;
        }
        index += 1;
    }
    None
}

/// The text before an unquoted trailing comment. A `#` only opens one when whitespace precedes it,
/// so a value like `sk-a#b` stays whole.
fn strip_trailing_comment(body: &str) -> &str {
    let bytes = body.as_bytes();
    for index in 1..bytes.len() {
        if bytes[index] == b'#' && matches!(bytes[index - 1], b' ' | b'\t') {
            return &body[..index];
        }
    }
    body
}

fn is_sequence_entry(content: &str) -> bool {
    content == "-" || content.starts_with("- ") || content.starts_with("-\t")
}

/// Leading whitespace, counted in bytes so that it doubles as an offset into the line.
///
/// A tab counts as one, which is not what YAML would make of it — but YAML forbids tabs in
/// indentation outright, so such a file fails validation on save anyway, and a miscounted column
/// only ever produces a wrong *path*. Masking is decided by the key on the line, so the secret is
/// still hidden; the wrong path simply makes the next save refuse to resolve it.
fn indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// `\r` is kept out of the parse but left in the line, so a CRLF file rejoins byte for byte.
fn strip_cr(line: &str) -> &str {
    line.strip_suffix('\r').unwrap_or(line)
}

fn structure_error(line: usize) -> TendrilError {
    TendrilError::Config(format!(
        "config.yaml line {}: the config editor cannot follow the structure of this document, so \
         it cannot guarantee that every secret in it is masked.",
        line + 1
    ))
}

fn subtree_error(path: &[Segment]) -> TendrilError {
    TendrilError::Config(format!(
        "{} is a secret, but its value is not a plain scalar on one line, so the config editor \
         cannot mask it. Give it a single-line value, or edit config.yaml outside the app.",
        render_path(path)
    ))
}

fn multiline_error(path: &[Segment]) -> TendrilError {
    TendrilError::Config(format!(
        "the value of {} runs over more than one line, so the config editor cannot tell what is \
         underneath it or guarantee that the secrets there are masked. Put the value on one line, \
         or edit config.yaml outside the app.",
        render_path(path)
    ))
}

fn unreadable_error(path: &[Segment]) -> TendrilError {
    TendrilError::Config(format!(
        "{} is a secret, but its value is not written as a plain scalar the config editor can \
         rewrite. Give it a single-line quoted or unquoted value, or edit config.yaml outside the \
         app.",
        render_path(path)
    ))
}

fn flow_error(path: &[Segment]) -> TendrilError {
    TendrilError::Config(format!(
        "{} is written in flow style ({{...}} or [...]), which the config editor cannot scan for \
         secrets. Rewrite it as an indented block.",
        render_path(path)
    ))
}
