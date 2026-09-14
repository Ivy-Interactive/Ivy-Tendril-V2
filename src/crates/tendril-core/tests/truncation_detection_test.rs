use tendril_core::agents::truncation::{
    check_markdown_truncation, has_unclosed_code_fence, has_unclosed_question_block,
    is_event_line_truncated,
};

#[test]
fn test_unclosed_code_fence_detected() {
    let unclosed_code = r#"
# Title

Here is some code:
```rust
fn main() {
    println!("Hello, world!");

"#;

    assert!(has_unclosed_code_fence(unclosed_code));
    let result = check_markdown_truncation(unclosed_code);
    assert!(result.is_some());
    assert!(result.unwrap().contains("Unclosed code fence"));
}

#[test]
fn test_unclosed_question_block_detected() {
    let unclosed_questions = r#"
# Title

## Questions
````questions
questions:
  - id: choice
    title: What to choose?
    options:
      - title: Option A
        value: a
"#;

    assert!(has_unclosed_question_block(unclosed_questions));
    assert!(has_unclosed_code_fence(unclosed_questions));
    let result = check_markdown_truncation(unclosed_questions);
    assert!(result.is_some());
    assert!(result.unwrap().contains("question block"));
}

#[test]
fn test_stop_reason_length_detected() {
    let event1 = r#"{"type":"message_stop","stop_reason":"max_tokens"}"#;
    assert!(is_event_line_truncated(event1));

    let event2 = r#"{"type":"chat.completion.chunk","choices":[{"finish_reason":"length"}]}"#;
    assert!(is_event_line_truncated(event2));

    let event3 = r#"{"kind":"turn.completed","reason":"length"}"#;
    assert!(is_event_line_truncated(event3));

    let event4 = r#"{"error":{"code":"output_truncated","message":"Response truncated"}}"#;
    assert!(is_event_line_truncated(event4));

    let normal_event = r#"{"type":"message_stop","stop_reason":"end_turn"}"#;
    assert!(!is_event_line_truncated(normal_event));
}

#[test]
fn test_valid_output_passes() {
    let valid_markdown = r#"
# Title

## Problem
This is a description.

## Solution
```rust
fn valid() {
    let x = 42;
}
```

````questions
questions:
  - id: q1
    title: Question?
    options:
      - title: Yes
        value: yes
````

All done!
"#;

    assert!(!has_unclosed_code_fence(valid_markdown));
    assert!(!has_unclosed_question_block(valid_markdown));
    assert!(check_markdown_truncation(valid_markdown).is_none());
}
