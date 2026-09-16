use crate::questions::models::{QuestionBlock, QuestionItem};
use serde::Deserialize;
use serde_yaml::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CanonicalWrapper {
    questions: Vec<QuestionItem>,
}

/// One code fence delimiter line, as [`match_fence`] reads it.
struct Fence<'a> {
    delimiter: u8,
    length: usize,
    indent: usize,
    info: &'a str,
}

/// The fence currently open, and whether its body is a `questions` block.
struct OpenFence {
    delimiter: u8,
    length: usize,
    indent: usize,
    is_questions: bool,
    start_line: usize,
}

/// Every `questions` fence in `markdown`, in document order.
///
/// **Fence tracking follows CommonMark, and has to.** A fence is closed only by a bare run of the
/// *same* delimiter that is *at least as long* as the opener and indented no more than three spaces.
/// Anything less than all four of those conditions truncates real documents:
///
/// - Length, so a `questions` fence written inside a longer fence is documentation rather than a
///   question — which is how `plan_reference.md` documents the format without failing its own
///   validator.
/// - Indentation, so a ` ```rust ` sample inside a `description: |` block scalar — indented, as a
///   block scalar's content must be — does not end the block early. Without this rule a question
///   that illustrates its options with code loses every option after the sample, and since the
///   write path bounds its edits by the same `end_line`, an answer then lands *inside* the code
///   sample and corrupts the YAML.
/// - Delimiter, so a `~~~` fence's contents are not scanned for backtick fences and vice versa.
/// - A bare run, so a line that opens a nested fence is content, not a close.
///
/// This matches V1's `QuestionBlockParser.Scan` and the frontend's `scanQuestionsFences`; all three
/// must agree, or the UI offers options the validator cannot see.
pub fn parse_question_blocks(markdown: &str) -> Vec<QuestionBlock> {
    let mut blocks = Vec::new();
    let lines: Vec<&str> = markdown.lines().collect();

    let mut open: Option<OpenFence> = None;
    let mut body: Vec<&str> = Vec::new();

    for (idx, line) in lines.iter().enumerate() {
        let line_num = idx + 1;
        let fence = match_fence(line);

        let Some(current) = open.as_ref() else {
            if let Some(opening) = fence {
                open = Some(OpenFence {
                    delimiter: opening.delimiter,
                    length: opening.length,
                    indent: opening.indent,
                    is_questions: is_questions_info(opening.info),
                    start_line: line_num,
                });
                body.clear();
            }
            continue;
        };

        if let Some(closing) = &fence {
            if closing.delimiter == current.delimiter
                && closing.length >= current.length
                && closing.info.is_empty()
            {
                if current.is_questions {
                    push_block(&mut blocks, current, &body, line_num);
                }
                open = None;
                body.clear();
                continue;
            }
        }

        if current.is_questions {
            body.push(dedent(line, current.indent));
        }
    }

    // An unterminated fence runs to the end of the document (CommonMark). Reporting it is what keeps
    // a missing closing fence from silently discarding the questions above it.
    if let Some(current) = open {
        if current.is_questions {
            push_block(&mut blocks, &current, &body, lines.len());
        }
    }

    blocks
}

fn push_block(blocks: &mut Vec<QuestionBlock>, open: &OpenFence, body: &[&str], end_line: usize) {
    let raw_body = body.join("\n");
    let (questions, is_legacy, parse_error) = parse_body(&raw_body);

    blocks.push(QuestionBlock {
        block_index: blocks.len() + 1,
        line_number: open.start_line,
        fence_len: open.length,
        raw_body,
        questions,
        is_legacy,
        parse_error,
        start_line: open.start_line,
        end_line,
    });
}

/// The fence `line` is, or `None` when it is not a fence delimiter at all.
fn match_fence(line: &str) -> Option<Fence<'_>> {
    let bytes = line.as_bytes();

    // CommonMark allows up to three characters of leading whitespace; a fourth makes the line
    // indented content instead.
    let mut indent = 0;
    while indent < 4 && indent < bytes.len() && (bytes[indent] == b' ' || bytes[indent] == b'\t') {
        indent += 1;
    }
    if indent > 3 || indent >= bytes.len() {
        return None;
    }

    let delimiter = bytes[indent];
    if delimiter != b'`' && delimiter != b'~' {
        return None;
    }

    let mut end = indent;
    while end < bytes.len() && bytes[end] == delimiter {
        end += 1;
    }

    let length = end - indent;
    if length < 3 {
        return None;
    }

    let info = line[end..].trim();

    // A backtick fence's info string may not contain a backtick (CommonMark), which is what keeps
    // inline code such as ``a ``` b`` from being read as a fence.
    if delimiter == b'`' && info.contains('`') {
        return None;
    }

    Some(Fence {
        delimiter,
        length,
        indent,
        info,
    })
}

/// Whether an info string names a questions block. Only the first word is read, so
/// ` ```questions {highlight} ` still opens one — matching the frontend, which keys its renderer off
/// the same first word.
fn is_questions_info(info: &str) -> bool {
    info.split_whitespace()
        .next()
        .is_some_and(|word| word.eq_ignore_ascii_case("questions"))
}

/// Strips up to `indent` characters of the opening fence's own indentation, so an indented block's
/// YAML reaches the parser at column zero.
fn dedent(line: &str, indent: usize) -> &str {
    let bytes = line.as_bytes();
    let mut strip = 0;
    while strip < indent && strip < bytes.len() && (bytes[strip] == b' ' || bytes[strip] == b'\t') {
        strip += 1;
    }
    &line[strip..]
}

fn parse_body(raw_body: &str) -> (Vec<QuestionItem>, bool, Option<String>) {
    let trimmed = raw_body.trim();
    if trimmed.is_empty() {
        return (Vec::new(), false, None);
    }

    let val_result: std::result::Result<Value, _> = serde_yaml::from_str(raw_body);

    let has_id_or_questions = trimmed.contains("id:") || trimmed.contains("questions:");
    if !has_id_or_questions {
        // Pre-schema plain text: legacy block
        return (Vec::new(), true, None);
    }

    // Try canonical wrapper
    if let Ok(mut wrapper) = serde_yaml::from_str::<CanonicalWrapper>(raw_body) {
        check_null_answers_wrapper(&val_result, &mut wrapper.questions);
        return (wrapper.questions, false, None);
    }

    // Try bare sequence
    if let Ok(mut seq) = serde_yaml::from_str::<Vec<QuestionItem>>(raw_body) {
        check_null_answers_seq(&val_result, &mut seq);
        return (seq, false, None);
    }

    // Try lone question mapping
    if let Ok(mut item) = serde_yaml::from_str::<QuestionItem>(raw_body) {
        if !item.id.is_empty() || !item.title.is_empty() {
            check_null_answers_lone(&val_result, &mut item);
            return (vec![item], false, None);
        }
    }

    // Parse error
    let err_msg = match serde_yaml::from_str::<CanonicalWrapper>(raw_body) {
        Err(e) => e.to_string(),
        Ok(_) => "Failed to parse question block".to_string(),
    };

    (Vec::new(), false, Some(err_msg))
}

fn check_null_answers_wrapper(
    val_res: &std::result::Result<Value, serde_yaml::Error>,
    questions: &mut [QuestionItem],
) {
    if let Ok(Value::Mapping(map)) = val_res {
        let q_key = Value::String("questions".to_string());
        if let Some(Value::Sequence(seq)) = map.get(&q_key) {
            for (idx, item_val) in seq.iter().enumerate() {
                if idx < questions.len() {
                    if let Value::Mapping(item_map) = item_val {
                        let ans_key = Value::String("answer".to_string());
                        if let Some(Value::Null) = item_map.get(&ans_key) {
                            questions[idx].has_null_answer = true;
                        }
                    }
                }
            }
        }
    }
}

fn check_null_answers_seq(
    val_res: &std::result::Result<Value, serde_yaml::Error>,
    questions: &mut [QuestionItem],
) {
    if let Ok(Value::Sequence(seq)) = val_res {
        for (idx, item_val) in seq.iter().enumerate() {
            if idx < questions.len() {
                if let Value::Mapping(item_map) = item_val {
                    let ans_key = Value::String("answer".to_string());
                    if let Some(Value::Null) = item_map.get(&ans_key) {
                        questions[idx].has_null_answer = true;
                    }
                }
            }
        }
    }
}

fn check_null_answers_lone(
    val_res: &std::result::Result<Value, serde_yaml::Error>,
    item: &mut QuestionItem,
) {
    if let Ok(Value::Mapping(map)) = val_res {
        let ans_key = Value::String("answer".to_string());
        if let Some(Value::Null) = map.get(&ans_key) {
            item.has_null_answer = true;
        }
    }
}
