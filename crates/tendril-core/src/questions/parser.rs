use crate::questions::models::{QuestionBlock, QuestionItem};
use serde::Deserialize;
use serde_yaml::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CanonicalWrapper {
    questions: Vec<QuestionItem>,
}

pub fn parse_question_blocks(markdown: &str) -> Vec<QuestionBlock> {
    let mut blocks = Vec::new();
    let lines: Vec<&str> = markdown.lines().collect();

    let mut in_fence: Option<(usize, bool)> = None; // (fence_len, is_questions)
    let mut current_body_lines: Vec<&str> = Vec::new();
    let mut current_start_line = 0;
    let mut current_fence_len = 0;

    for (idx, line) in lines.iter().enumerate() {
        let line_num = idx + 1;
        let trimmed = line.trim_start();

        if let Some((open_len, is_questions)) = in_fence {
            // Check if closing fence
            if trimmed.starts_with('`') {
                let ticks = trimmed.chars().take_while(|c| *c == '`').count();
                let rest = trimmed[ticks..].trim();
                if ticks >= open_len && rest.is_empty() {
                    // Close fence
                    if is_questions {
                        let block_index = blocks.len() + 1;
                        let raw_body = current_body_lines.join("\n");
                        let (questions, is_legacy, parse_error) = parse_body(&raw_body);

                        blocks.push(QuestionBlock {
                            block_index,
                            line_number: current_start_line,
                            fence_len: current_fence_len,
                            raw_body,
                            questions,
                            is_legacy,
                            parse_error,
                            start_line: current_start_line,
                            end_line: line_num,
                        });
                    }
                    in_fence = None;
                    current_body_lines.clear();
                    continue;
                }
            }

            if is_questions {
                current_body_lines.push(line);
            }
        } else {
            // Check for opening fence
            if trimmed.starts_with("```") {
                let ticks = trimmed.chars().take_while(|c| *c == '`').count();
                let info = trimmed[ticks..].trim();

                if info.eq_ignore_ascii_case("questions") {
                    in_fence = Some((ticks, true));
                    current_start_line = line_num;
                    current_fence_len = ticks;
                    current_body_lines.clear();
                } else {
                    in_fence = Some((ticks, false));
                }
            }
        }
    }

    blocks
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
