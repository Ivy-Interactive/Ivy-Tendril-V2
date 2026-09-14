//! Polishes agent-authored plan markdown: shortens verbose `file:///` link text, strips line-number
//! anchors from `file:///` URLs, converts plan-revision links and bare `Plan NNNNN` mentions into
//! `plan://` links, and collapses a plan link whose text was corrupted into containing a second
//! nested plan link. Port of the legacy `MarkdownLinkPolisher`.
//!
//! All four rewrites skip fenced code, inline code, and — via [`parse_question_blocks`] — `questions`
//! YAML fences, whose option `value` slugs are matched literally against answers and would be
//! corrupted by a bare-number rewrite.

use crate::questions::parse_question_blocks;
use regex::{Captures, Regex};
use std::path::Path;
use std::sync::LazyLock;

static MARKDOWN_LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[([^\]]*)\]\(([^)]+)\)").unwrap());

static FILE_LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^file:///(.+?)(?:(?:#L?|:)(\d+(?:-\d+)?))?$").unwrap());

static PLAN_REVISION_LINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)file:///.*?/Plans/(\d{5})-[^/]+/revisions/\d{3}\.md$").unwrap()
});

static PLAN_CONTEXT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bPlans?\s+((?:\d{5})(?:\s*,\s*\d{5})*)").unwrap());

static BACKTICK_LINK_TEXT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[`([^`\]]+)`\]\((file:///[^)]+)\)").unwrap());

static NESTED_PLAN_LINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\[([^\[\]]*)\[([^\[\]]*)\]\(plan://\d{1,5}\)([^\[\]]*)\]\((plan://\d{1,5})\)")
        .unwrap()
});

static MULTI_SLASH_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new("/{2,}").unwrap());

// Fenced/inline code patterns, shared by both protected-span regexes below — the sample must
// survive verbatim wherever it appears.
const PROTECTED_CODE_SPAN_PATTERN: &str = concat!(
    r"```[\s\S]*?```",  // fenced code (```)
    r"|~~~[\s\S]*?~~~", // fenced code (~~~)
    r"|``[^\n]*?``",    // double-backtick inline code
    r"|`[^`\n]*`",      // single-backtick inline code
);

// Spans the nested-link-collapse pass must not rewrite: code only. It deliberately does NOT
// reuse PROTECTED_SPAN_RE's link alternative below — that pass's own target *is* a link, and the
// non-recursive "whole link" alternative would greedily consume the inner link and misreport the
// nested match's start as already protected.
static PROTECTED_CODE_SPAN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(PROTECTED_CODE_SPAN_PATTERN).unwrap());

// Spans the bare-number pass must not rewrite: code (above) plus existing markdown links/images
// (the link text is where the corruption happens — protecting only the URL is not enough).
static PROTECTED_SPAN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        "{}{}",
        PROTECTED_CODE_SPAN_PATTERN,
        r"|!?\[[^\]]*\]\([^)]*\)" // markdown link or image: link text AND url
    ))
    .unwrap()
});

/// Polishes markdown links: file-link anchor stripping, verbose link-text shortening,
/// plan:// conversion, bare-plan-number linking. Idempotent.
pub fn polish_links(markdown: &str, plans_dir: &Path) -> String {
    if markdown.is_empty() {
        return markdown.to_string();
    }

    let blocks = parse_question_blocks(markdown);
    if blocks.is_empty() {
        return polish(markdown, plans_dir);
    }

    // A `questions` fence is machine-read YAML — option values are slugs matched literally
    // against answers — so polishing one would corrupt the block (a bare 5-digit value would
    // become a plan link). Everything around it is polished as before. Splitting and rejoining
    // on '\n' (not `.lines()`) is byte-preserving for CRLF too, because each line keeps its own
    // trailing '\r'.
    let lines: Vec<&str> = markdown.split('\n').collect();
    let mut result = String::new();
    let mut pending: Vec<&str> = Vec::new();
    let mut wrote_any = false;
    let mut block_idx = 0;

    for (idx, line) in lines.iter().enumerate() {
        let line_number = idx + 1;
        while block_idx < blocks.len() && blocks[block_idx].end_line < line_number {
            block_idx += 1;
        }

        let inside_fence = block_idx < blocks.len()
            && line_number >= blocks[block_idx].start_line
            && line_number <= blocks[block_idx].end_line;

        if !inside_fence {
            pending.push(line);
            continue;
        }

        flush_pending(&mut pending, plans_dir, &mut result, &mut wrote_any);
        append_segment(line, &mut result, &mut wrote_any);
    }

    flush_pending(&mut pending, plans_dir, &mut result, &mut wrote_any);

    result
}

fn flush_pending(
    pending: &mut Vec<&str>,
    plans_dir: &Path,
    result: &mut String,
    wrote_any: &mut bool,
) {
    if pending.is_empty() {
        return;
    }

    let joined = pending.join("\n");
    let polished = polish(&joined, plans_dir);
    append_segment(&polished, result, wrote_any);
    pending.clear();
}

// Tracked with a flag rather than `result.is_empty()`: the first segment is the empty string
// whenever the document opens with a blank line, and testing emptiness would swallow the
// separator and silently drop that line.
fn append_segment(text: &str, result: &mut String, wrote_any: &mut bool) {
    if *wrote_any {
        result.push('\n');
    }
    *wrote_any = true;
    result.push_str(text);
}

fn polish(content: &str, plans_dir: &Path) -> String {
    let result = remove_backticks_from_file_link_text(content);
    let result = polish_markdown_links(&result);
    let result = collapse_nested_plan_links(&result);
    convert_bare_plan_numbers(&result, plans_dir)
}

fn remove_backticks_from_file_link_text(content: &str) -> String {
    BACKTICK_LINK_TEXT_RE
        .replace_all(content, |caps: &Captures| {
            format!("[{}]({})", &caps[1], &caps[2])
        })
        .into_owned()
}

fn polish_markdown_links(content: &str) -> String {
    MARKDOWN_LINK_RE
        .replace_all(content, |caps: &Captures| {
            let whole = caps.get(0).unwrap().as_str();
            let link_text = &caps[1];
            let url = &caps[2];

            if url.len() >= 7 && url[..7].eq_ignore_ascii_case("plan://") {
                return whole.to_string();
            }

            if let Some(rev_caps) = PLAN_REVISION_LINK_RE.captures(url) {
                let plan_id = &rev_caps[1];
                return format!("[{link_text}](plan://{plan_id})");
            }

            let Some(file_caps) = FILE_LINK_RE.captures(url) else {
                return whole.to_string();
            };

            let file_path = normalize_path(&file_caps[1]);
            let anchor = file_caps.get(2).map(|m| m.as_str());

            // Normalize the path and strip the line anchor, but never repo-scan to redirect a
            // missing path onto a same-basename file: that silently points at the wrong file and
            // is expensive on the render thread. Links to files that don't exist are left as
            // authored and surfaced by display-time annotation instead.
            let simplified_text = simplify_link_text(link_text, &file_path, anchor);
            format!("[{simplified_text}](file:///{file_path})")
        })
        .into_owned()
}

fn simplify_link_text(link_text: &str, file_path: &str, anchor: Option<&str>) -> String {
    let file_name = basename(file_path);

    // Pattern: link text is verbose file:///path or file:///path:line
    if link_text.len() >= 8 && link_text[..8].eq_ignore_ascii_case("file:///") {
        if let Some(text_caps) = FILE_LINK_RE.captures(link_text) {
            let text_anchor = text_caps.get(2).map(|m| m.as_str());
            let inner_name = basename(&text_caps[1]);
            return match text_anchor {
                Some(a) => format!("{inner_name}:{a}"),
                None => inner_name,
            };
        }
    }

    // Pattern: link text contains directory separators (full path without file:/// prefix).
    // Deliberate cross-platform divergence from V1: V1 tests only its own OS's separator
    // (`Path.DirectorySeparatorChar`), so a Windows-style path is left alone on macOS/Linux. This
    // port checks both separators unconditionally, so behavior is identical on every platform.
    if link_text.contains('/') || link_text.contains('\\') {
        return match anchor {
            Some(a) => format!("{file_name}:{a}"),
            None => file_name,
        };
    }

    // Already simplified or no simplification needed
    link_text.to_string()
}

fn basename(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

fn convert_bare_plan_numbers(content: &str, plans_dir: &Path) -> String {
    if !plans_dir.is_dir() {
        return content.to_string();
    }

    let protected_spans = collect_spans(content, &PROTECTED_SPAN_RE);

    PLAN_CONTEXT_RE
        .replace_all(content, |caps: &Captures| {
            let whole = caps.get(0).unwrap();
            if is_within_protected_span(whole.start(), &protected_spans) {
                return whole.as_str().to_string();
            }

            let prefix = if whole.as_str().starts_with("Plans") {
                "Plans "
            } else {
                "Plan "
            };
            let numbers_text = &caps[1];

            let converted: Vec<String> = numbers_text
                .split(',')
                .map(str::trim)
                .map(|num| {
                    let plan_exists = plan_folder_exists(plans_dir, num);
                    if plan_exists {
                        format!("[{num}](plan://{num})")
                    } else {
                        num.to_string()
                    }
                })
                .collect();

            format!("{prefix}{}", converted.join(", "))
        })
        .into_owned()
}

fn plan_folder_exists(plans_dir: &Path, padded_id: &str) -> bool {
    let prefix = format!("{padded_id}-");
    std::fs::read_dir(plans_dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .any(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        })
        .unwrap_or(false)
}

// Rewrites a plan link whose text was corrupted into containing a second nested plan link
// (e.g. `[Plan [00050](plan://00050)](plan://00050)`) back to the authored form
// (`[Plan 00050](plan://00050)`), keeping the outer URL since that's the one the author wrote.
// Loops until the string stops changing so doubly nested content also settles.
fn collapse_nested_plan_links(content: &str) -> String {
    let mut content = content.to_string();
    loop {
        let previous = content.clone();
        let protected_spans = collect_spans(&content, &PROTECTED_CODE_SPAN_RE);

        content = NESTED_PLAN_LINK_RE
            .replace_all(&content, |caps: &Captures| {
                let whole = caps.get(0).unwrap();
                if is_within_protected_span(whole.start(), &protected_spans) {
                    return whole.as_str().to_string();
                }

                let text = format!("{}{}{}", &caps[1], &caps[2], &caps[3]);
                let url = &caps[4];
                format!("[{text}]({url})")
            })
            .into_owned();

        if content == previous {
            break;
        }
    }
    content
}

fn collect_spans(content: &str, re: &Regex) -> Vec<(usize, usize)> {
    re.find_iter(content)
        .map(|m| (m.start(), m.end()))
        .collect()
}

fn is_within_protected_span(index: usize, spans: &[(usize, usize)]) -> bool {
    spans
        .iter()
        .any(|&(start, end)| index >= start && index < end)
}

/// Normalizes a file path: backslashes to forward slashes, collapses repeated
/// separators, resolves `.` and `..` segments lexically.
pub fn normalize_path(path: &str) -> String {
    let path = path.replace('\\', "/");
    let path = MULTI_SLASH_RE.replace_all(&path, "/");

    let mut stack: Vec<&str> = Vec::new();
    for part in path.split('/') {
        if part == ".." && !stack.is_empty() && *stack.last().unwrap() != ".." {
            stack.pop();
        } else if part != "." {
            stack.push(part);
        }
    }

    stack.join("/")
}
