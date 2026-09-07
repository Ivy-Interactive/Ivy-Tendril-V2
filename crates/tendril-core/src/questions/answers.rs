use crate::error::Result;
use crate::questions::models::QuestionBlock;
use crate::questions::parser::parse_question_blocks;
use std::collections::HashMap;

pub fn apply_question_answers(
    markdown: &str,
    answers: &HashMap<String, Vec<String>>,
) -> Result<String> {
    if answers.is_empty() {
        return Ok(markdown.to_string());
    }

    let blocks = parse_question_blocks(markdown);
    if blocks.is_empty() {
        return Ok(markdown.to_string());
    }

    // Work on lines
    let mut lines: Vec<String> = markdown.lines().map(|s| s.to_string()).collect();
    let had_trailing_newline = markdown.ends_with('\n');

    // Process blocks in reverse order so line index changes don't shift earlier blocks
    let mut sorted_blocks = blocks;
    sorted_blocks.sort_by_key(|a| std::cmp::Reverse(a.start_line));

    for block in sorted_blocks {
        apply_answers_to_block(&mut lines, &block, answers);
    }

    let mut result = lines.join("\n");
    if had_trailing_newline {
        result.push('\n');
    }

    Ok(result)
}

fn apply_answers_to_block(
    lines: &mut Vec<String>,
    block: &QuestionBlock,
    answers: &HashMap<String, Vec<String>>,
) {
    if block.is_legacy || block.parse_error.is_some() {
        return;
    }

    // Check if any question in this block is targeted by answers
    let mut targeted_questions: Vec<_> = block
        .questions
        .iter()
        .filter(|q| answers.contains_key(&q.id))
        .collect();

    if targeted_questions.is_empty() {
        return;
    }

    // Sort targeted questions in reverse order (bottom to top)
    // so changes to later questions don't shift line indices for earlier questions
    targeted_questions.reverse();

    // Block body line indices (0-based)
    let body_start = block.start_line; // line after opening fence (0-based)
    let body_end = block.end_line - 1; // line before closing fence (0-based)

    if body_start >= body_end || body_start >= lines.len() {
        return;
    }

    for target_q in targeted_questions {
        let ans_values = match answers.get(&target_q.id) {
            Some(v) => v,
            None => continue,
        };

        // Find the question slice in lines[body_start..body_end]
        if let Some((q_start, q_end, prop_indent)) =
            find_question_range(lines, body_start, body_end, &target_q.id)
        {
            let formatted_answer = format_answer(ans_values, target_q.multiple, &prop_indent);

            // Check if existing answer lines exist in lines[q_start..q_end]
            if let Some((ans_start, ans_end)) =
                find_existing_answer(lines, q_start, q_end, &prop_indent)
            {
                // Replace existing answer lines
                lines.splice(ans_start..ans_end, formatted_answer);
            } else {
                // Insert at the end of the question range (before trailing empty lines)
                let mut insert_pos = q_end;
                while insert_pos > q_start && lines[insert_pos - 1].trim().is_empty() {
                    insert_pos -= 1;
                }
                lines.splice(insert_pos..insert_pos, formatted_answer);
            }
        }
    }
}

fn find_question_range(
    lines: &[String],
    body_start: usize,
    body_end: usize,
    target_id: &str,
) -> Option<(usize, usize, String)> {
    // 1. Find line index where `id: <target_id>` occurs
    let mut id_line_opt = None;
    for (idx, line) in lines.iter().enumerate().take(body_end).skip(body_start) {
        let trimmed = line.trim();
        let stripped = trimmed.trim_start_matches("- ").trim();
        if let Some(rest) = stripped.strip_prefix("id:") {
            let val = rest.trim().trim_matches(['\'', '"']);
            if val == target_id {
                id_line_opt = Some(idx);
                break;
            }
        }
    }

    let id_line_idx = id_line_opt?;

    // 2. Check if this question is part of a list (starts with or belongs to `- `)
    let mut list_start_opt = None;
    let mut list_indent = 0;

    let id_trimmed = lines[id_line_idx].trim_start();
    if id_trimmed.starts_with("- ") {
        list_start_opt = Some(id_line_idx);
        list_indent = lines[id_line_idx].len() - id_trimmed.len();
    } else {
        // Walk backwards to find parent list item
        let id_indent = lines[id_line_idx].len() - id_trimmed.len();
        for prev in (body_start..id_line_idx).rev() {
            let prev_trimmed = lines[prev].trim_start();
            if prev_trimmed.starts_with("- ") {
                let prev_indent = lines[prev].len() - prev_trimmed.len();
                if prev_indent < id_indent {
                    list_start_opt = Some(prev);
                    list_indent = prev_indent;
                    break;
                }
            }
        }
    }

    if let Some(start_idx) = list_start_opt {
        // Find next item at the same list_indent
        let mut end_idx = body_end;
        for (next, line) in lines
            .iter()
            .enumerate()
            .take(body_end)
            .skip(id_line_idx + 1)
        {
            let next_trimmed = line.trim_start();
            if next_trimmed.starts_with("- ") {
                let next_indent = line.len() - next_trimmed.len();
                if next_indent == list_indent {
                    end_idx = next;
                    break;
                }
            }
        }
        let prop_indent = detect_property_indent(&lines[start_idx..end_idx], list_indent);
        Some((start_idx, end_idx, prop_indent))
    } else {
        // Lone question mapping
        let prop_indent = detect_property_indent(&lines[body_start..body_end], 0);
        Some((body_start, body_end, prop_indent))
    }
}

fn detect_property_indent(lines: &[String], base_indent: usize) -> String {
    for line in lines {
        let trimmed = line.trim_start();
        if !trimmed.starts_with("- ") && !trimmed.is_empty() && trimmed.contains(':') {
            let indent = line.len() - trimmed.len();
            return " ".repeat(indent);
        }
    }
    " ".repeat(base_indent + 2)
}

fn find_existing_answer(
    lines: &[String],
    q_start: usize,
    q_end: usize,
    prop_indent: &str,
) -> Option<(usize, usize)> {
    let target_prefix = format!("{}answer:", prop_indent);
    for idx in q_start..q_end {
        let line = &lines[idx];
        if line.starts_with(&target_prefix)
            || (line.trim_start().starts_with("answer:")
                && line.len() - line.trim_start().len() == prop_indent.len())
        {
            let mut end = idx + 1;
            while end < q_end {
                let next_line = &lines[end];
                let next_indent = next_line.len() - next_line.trim_start().len();
                if !next_line.trim().is_empty() && next_indent <= prop_indent.len() {
                    break;
                }
                end += 1;
            }
            return Some((idx, end));
        }
    }
    None
}

fn format_answer(values: &[String], is_multiple: bool, prop_indent: &str) -> Vec<String> {
    if values.is_empty() {
        return Vec::new();
    }

    if is_multiple || values.len() > 1 {
        let mut lines = Vec::new();
        lines.push(format!("{}answer:", prop_indent));
        let item_indent = format!("{}  ", prop_indent);
        for v in values {
            lines.push(format!("{}- {}", item_indent, format_scalar_value(v)));
        }
        lines
    } else {
        vec![format!(
            "{}answer: {}",
            prop_indent,
            format_scalar_value(&values[0])
        )]
    }
}

fn format_scalar_value(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".to_string();
    }
    if s.contains(':')
        || s.contains('#')
        || s.contains('"')
        || s.contains('\'')
        || s.contains('\n')
        || s.starts_with('-')
        || s.contains(' ')
    {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        s.to_string()
    }
}
