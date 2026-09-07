use crate::questions::models::{IssueSeverity, QuestionAnswerValue, QuestionBlock, QuestionIssue};
use std::collections::HashSet;

pub fn is_valid_slug(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }
    for c in chars {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '-' {
            return false;
        }
    }
    true
}

pub fn validate_question_blocks(blocks: &[QuestionBlock]) -> Vec<QuestionIssue> {
    let mut issues = Vec::new();
    let multi_block = blocks.len() > 1;
    let mut seen_question_ids: HashSet<String> = HashSet::new();

    for block in blocks {
        let block_prefix = if multi_block {
            format!("block {}: ", block.block_index)
        } else {
            String::new()
        };

        if block.is_legacy {
            issues.push(QuestionIssue {
                severity: IssueSeverity::Warning,
                line_number: block.line_number,
                message: format!(
                    "{}legacy question block format detected; use schema-compliant questions block",
                    block_prefix
                ),
            });
            continue;
        }

        if let Some(ref err) = block.parse_error {
            issues.push(QuestionIssue {
                severity: IssueSeverity::Error,
                line_number: block.line_number,
                message: format!("{}parse error: {}", block_prefix, err),
            });
            continue;
        }

        if block.questions.is_empty() || block.questions.len() > 4 {
            issues.push(QuestionIssue {
                severity: IssueSeverity::Error,
                line_number: block.line_number,
                message: format!(
                    "{}block must contain between 1 and 4 questions",
                    block_prefix
                ),
            });
        }

        for (q_idx_0, q) in block.questions.iter().enumerate() {
            let q_num = q_idx_0 + 1;
            let q_prefix = format!("{}question {}: ", block_prefix, q_num);

            // 1. id is required
            if q.id.trim().is_empty() {
                issues.push(QuestionIssue {
                    severity: IssueSeverity::Error,
                    line_number: block.line_number,
                    message: format!("{}id is required", q_prefix),
                });
            } else if !is_valid_slug(&q.id) {
                issues.push(QuestionIssue {
                    severity: IssueSeverity::Error,
                    line_number: block.line_number,
                    message: format!(
                        "{}invalid id '{}', must match ^[a-z0-9][a-z0-9-]*$",
                        q_prefix, q.id
                    ),
                });
            } else if !seen_question_ids.insert(q.id.clone()) {
                issues.push(QuestionIssue {
                    severity: IssueSeverity::Error,
                    line_number: block.line_number,
                    message: format!("{}duplicate question id '{}'", q_prefix, q.id),
                });
            }

            // 2. title is required
            if q.title.trim().is_empty() {
                issues.push(QuestionIssue {
                    severity: IssueSeverity::Error,
                    line_number: block.line_number,
                    message: format!("{}title is required", q_prefix),
                });
            }

            // 3. header <= 12 chars
            if let Some(ref h) = q.header {
                if h.chars().count() > 12 {
                    issues.push(QuestionIssue {
                        severity: IssueSeverity::Error,
                        line_number: block.line_number,
                        message: format!("{}header must be 12 characters or fewer", q_prefix),
                    });
                }
            }

            // 4. options count (if options present, 2 to 4)
            if !q.options.is_empty() && (q.options.len() < 2 || q.options.len() > 4) {
                issues.push(QuestionIssue {
                    severity: IssueSeverity::Error,
                    line_number: block.line_number,
                    message: format!("{}question must have between 2 and 4 options", q_prefix),
                });
            }

            // 5. other: false with no options
            if !q.other && q.options.is_empty() {
                issues.push(QuestionIssue {
                    severity: IssueSeverity::Error,
                    line_number: block.line_number,
                    message: format!("{}other: false with no options is unanswerable", q_prefix),
                });
            }

            // 6. options checks
            let mut recommended_count = 0;
            let mut seen_option_values: HashSet<String> = HashSet::new();

            for opt in &q.options {
                if opt.recommended {
                    recommended_count += 1;
                }

                let title_trimmed = opt.title.trim();
                if title_trimmed.is_empty() {
                    issues.push(QuestionIssue {
                        severity: IssueSeverity::Error,
                        line_number: block.line_number,
                        message: format!("{}option title is required", q_prefix),
                    });
                } else {
                    let lower = title_trimmed.to_ascii_lowercase();
                    if lower == "other" || lower == "something else" || lower == "custom" {
                        issues.push(QuestionIssue {
                            severity: IssueSeverity::Error,
                            line_number: block.line_number,
                            message: format!(
                                "{}option '{}' duplicates what other: true provides",
                                q_prefix, opt.title
                            ),
                        });
                    }
                }

                if opt.value.trim().is_empty() || !is_valid_slug(&opt.value) {
                    issues.push(QuestionIssue {
                        severity: IssueSeverity::Error,
                        line_number: block.line_number,
                        message: format!(
                            "{}option value '{}' must match ^[a-z0-9][a-z0-9-]*$",
                            q_prefix, opt.value
                        ),
                    });
                } else if !seen_option_values.insert(opt.value.clone()) {
                    issues.push(QuestionIssue {
                        severity: IssueSeverity::Error,
                        line_number: block.line_number,
                        message: format!("{}duplicate option value '{}'", q_prefix, opt.value),
                    });
                }
            }

            if recommended_count > 1 {
                issues.push(QuestionIssue {
                    severity: IssueSeverity::Error,
                    line_number: block.line_number,
                    message: format!("{}more than one option is recommended", q_prefix),
                });
            }

            // 7. answer: null
            if q.has_null_answer {
                issues.push(QuestionIssue {
                    severity: IssueSeverity::Error,
                    line_number: block.line_number,
                    message: format!(
                        "{}answer: null is not a state; omit the key, or mark the question optional",
                        q_prefix
                    ),
                });
            }

            // 8. answer type consistency
            if let Some(ref ans) = q.answer {
                match ans {
                    QuestionAnswerValue::Single(val) => {
                        if q.multiple {
                            issues.push(QuestionIssue {
                                severity: IssueSeverity::Error,
                                line_number: block.line_number,
                                message: format!(
                                    "{}multiple: true requires a list answer",
                                    q_prefix
                                ),
                            });
                        }
                        if !q.other && !q.options.iter().any(|o| o.value == *val) {
                            issues.push(QuestionIssue {
                                severity: IssueSeverity::Error,
                                line_number: block.line_number,
                                message: format!(
                                    "{}answer '{}' matches no option and other is false",
                                    q_prefix, val
                                ),
                            });
                        }
                    }
                    QuestionAnswerValue::Multiple(vals) => {
                        if !q.multiple {
                            issues.push(QuestionIssue {
                                severity: IssueSeverity::Error,
                                line_number: block.line_number,
                                message: format!(
                                    "{}answer must be a scalar when multiple is false",
                                    q_prefix
                                ),
                            });
                        }
                        if !q.other {
                            for val in vals {
                                if !q.options.iter().any(|o| o.value == *val) {
                                    issues.push(QuestionIssue {
                                        severity: IssueSeverity::Error,
                                        line_number: block.line_number,
                                        message: format!(
                                            "{}answer '{}' matches no option and other is false",
                                            q_prefix, val
                                        ),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    issues
}
