use std::collections::HashMap;
use tendril_core::plans::{get_revision, write_revision};
use tendril_core::questions::{
    apply_question_answers, parse_question_blocks, validate_question_blocks, IssueSeverity,
};

#[test]
fn test_parse_shapes() {
    // 1. Canonical wrapper
    let canonical = r#"
# Test Plan

```questions
questions:
  - id: cache-type
    title: Which cache?
    options:
      - title: Memory
        value: mem
      - title: Redis
        value: redis
```
"#;
    let blocks = parse_question_blocks(canonical);
    assert_eq!(blocks.len(), 1);
    assert!(!blocks[0].is_legacy);
    assert_eq!(blocks[0].questions.len(), 1);
    assert_eq!(blocks[0].questions[0].id, "cache-type");
    assert_eq!(blocks[0].questions[0].options.len(), 2);

    // 2. Bare sequence
    let bare_seq = r#"
```questions
- id: storage-engine
  title: Storage Engine?
  options:
    - title: SQLite
      value: sqlite
    - title: Postgres
      value: postgres
```
"#;
    let blocks = parse_question_blocks(bare_seq);
    assert_eq!(blocks.len(), 1);
    assert!(!blocks[0].is_legacy);
    assert_eq!(blocks[0].questions.len(), 1);
    assert_eq!(blocks[0].questions[0].id, "storage-engine");

    // 3. Lone question mapping
    let lone_mapping = r#"
```questions
id: confirm-action
title: Confirm deletion?
options:
  - title: Yes
    value: yes
  - title: No
    value: no
```
"#;
    let blocks = parse_question_blocks(lone_mapping);
    assert_eq!(blocks.len(), 1);
    assert!(!blocks[0].is_legacy);
    assert_eq!(blocks[0].questions.len(), 1);
    assert_eq!(blocks[0].questions[0].id, "confirm-action");

    // 4. Legacy block
    let legacy = r#"
```questions
Should we proceed with migration now?
This is just arbitrary text.
```
"#;
    let blocks = parse_question_blocks(legacy);
    assert_eq!(blocks.len(), 1);
    assert!(blocks[0].is_legacy);
    let issues = validate_question_blocks(&blocks);
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].severity, IssueSeverity::Warning);

    // 5. Nested fence inside code block is NOT a questions block
    let nested = r#"
````markdown
Here is documentation:
```questions
id: doc-only
title: Should not be parsed
```
````
"#;
    let blocks = parse_question_blocks(nested);
    assert_eq!(blocks.len(), 0);
}

/// The shape of plan 00681: an option's `description: |` block scalar illustrates itself with a
/// ` ```rust ` sample. The sample's own closing fence is indented, as a block scalar's content must
/// be, and CommonMark only lets a fence be closed from three spaces or less — so it is content, and
/// every option after it survives.
///
/// This was silent truncation. The block closed at the inner fence, one option reached the
/// validator, and the answer was refused for `question must have between 2 and 4 options` naming a
/// block the user could see two options in.
#[test]
fn test_indented_code_sample_inside_description_does_not_close_the_block() {
    let markdown = r#"### Pagination guard

```questions
- id: pagination-panic
  title: Fix the pagination underflow, or pin the current behaviour?
  header: Pagination
  optional: true
  description: |
    A test cannot assert a page count without changing the formula.
  options:
    - title: Fix the formula
      value: fix
      recommended: true
      description: |
        Replace the expression with

        ```rust
        paging.total_items.div_ceil(paging.page_size.max(1)).max(1),
        ```

        `u32::div_ceil` is stable and also settles clippy's `manual_div_ceil`.
    - title: Pin it with should_panic
      value: pin
      description: |
        Leave the formula alone and document the bug instead.
```

Trailing prose that is outside the block.
"#;

    let blocks = parse_question_blocks(markdown);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].start_line, 3);
    assert_eq!(blocks[0].end_line, 26);
    assert_eq!(blocks[0].parse_error, None);
    assert!(!blocks[0].is_legacy);
    assert_eq!(blocks[0].questions.len(), 1);
    assert_eq!(blocks[0].questions[0].options.len(), 2);
    assert_eq!(blocks[0].questions[0].options[1].value, "pin");

    // The sample survives inside the description it belongs to, rather than being cut off with it.
    let description = blocks[0].questions[0].options[0]
        .description
        .as_deref()
        .expect("first option keeps its description");
    assert!(description.contains("```rust"));
    assert!(description.contains("manual_div_ceil"));

    // Two options is legal, so the block that used to be refused now validates clean.
    assert!(validate_question_blocks(&blocks).is_empty());

    // And the write path, which bounds its edits by the same `end_line`, puts the answer after the
    // last option instead of inside the code sample.
    let mut answers = HashMap::new();
    answers.insert("pagination-panic".to_string(), vec!["fix".to_string()]);
    let answered = apply_question_answers(markdown, &answers).expect("answer applies");
    assert!(answered.contains(
        "        Leave the formula alone and document the bug instead.\n  answer: fix\n```"
    ));

    // Round-trip: parsing what was written sees the same block, and answering again is idempotent.
    let reparsed = parse_question_blocks(&answered);
    assert_eq!(reparsed.len(), 1);
    assert_eq!(reparsed[0].questions.len(), 1);
    assert_eq!(reparsed[0].questions[0].options.len(), 2);
    assert!(validate_question_blocks(&reparsed).is_empty());
    assert_eq!(
        apply_question_answers(&answered, &answers).expect("re-answer applies"),
        answered
    );
}

/// The four-backtick outer form the reference document recommends. It is belt and braces now that
/// indentation is honoured, but it is what agents are told to write, so it has to work.
#[test]
fn test_four_backtick_block_survives_a_three_backtick_sample() {
    let markdown = r#"````questions
- id: sample-shape
  title: Which shape?
  options:
    - title: Struct
      value: struct
      description: |
        Like this:

        ```rust
        struct Paging { page: u32 }
        ```
    - title: Tuple
      value: tuple
````
"#;

    let blocks = parse_question_blocks(markdown);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].fence_len, 4);
    assert_eq!(blocks[0].end_line, 15);
    assert_eq!(blocks[0].parse_error, None);
    assert_eq!(blocks[0].questions[0].options.len(), 2);

    // And the length rule alone carries a bare run at column zero, where the indentation rule cannot
    // help. Such a body is not valid YAML inside a block scalar, so this is the pre-schema
    // plain-text form — but the fence geometry is the point: the block ends at its own `````.
    let legacy = r#"````questions
Here is how a fenced sample looks:

```
paging.total_items.div_ceil(paging.page_size)
```

That is all.
````
"#;
    let blocks = parse_question_blocks(legacy);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].end_line, 9);
    assert!(blocks[0].is_legacy);
}

/// An inner fence *longer* than the outer one does close it, because CommonMark says a run of at
/// least the opener's length closes a fence wherever it sits. That is the format's own rule rather
/// than a defect in the scanner, and it is why the reference document tells agents to open the block
/// with more backticks than anything inside it.
///
/// Pinned so the behaviour is a decision rather than an accident: nothing here can be fixed in the
/// scanner without disagreeing with every CommonMark renderer that displays the same plan.
#[test]
fn test_inner_fence_longer_than_the_opener_closes_the_block() {
    let markdown = r#"```questions
- id: too-long
  title: Truncated?
  description: |
   ````
   A sample fenced longer than the block that holds it.
   ````
  options:
    - title: A
      value: a
    - title: B
      value: b
```
"#;

    let blocks = parse_question_blocks(markdown);
    assert_eq!(blocks.len(), 1);
    // A run of four backticks closes a three-backtick opener, so the block ends on line 5.
    assert_eq!(blocks[0].end_line, 5);
    assert_eq!(blocks[0].questions.len(), 1);
    assert!(blocks[0].questions[0].options.is_empty());
}

/// A `questions` fence that is never closed runs to the end of the document, so its questions are
/// still read and still validated. Dropping it — which is what a scanner that requires a close does
/// — would silently discard every question in it.
#[test]
fn test_unterminated_block_runs_to_end_of_document() {
    // The inner sample is opened and never closed. Being indented, it is content either way, so the
    // block simply has no closing fence of its own.
    let markdown = r#"# A plan

```questions
- id: unclosed
  title: Which one?
  options:
    - title: A
      value: a
      description: |
        ```rust
        let a = 1;
    - title: B
      value: b
"#;

    let blocks = parse_question_blocks(markdown);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].start_line, 3);
    assert_eq!(blocks[0].end_line, 13);
    assert_eq!(blocks[0].questions.len(), 1);
    assert_eq!(blocks[0].questions[0].options.len(), 2);
    assert!(validate_question_blocks(&blocks).is_empty());
}

/// A tilde fence is a different delimiter, so a backtick run inside it is content and a `questions`
/// block inside it is documentation.
#[test]
fn test_delimiters_do_not_close_each_other() {
    let tilde_block = r#"~~~questions
- id: tilde-block
  title: Which one?
  description: |
    ```
    A backtick run cannot close a tilde fence.
    ```
  options:
    - title: A
      value: a
    - title: B
      value: b
~~~
"#;
    let blocks = parse_question_blocks(tilde_block);
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].end_line, 13);
    assert_eq!(blocks[0].questions[0].options.len(), 2);

    let inside_tilde = r#"~~~
```questions
- id: documented
  title: An example, not a real question.
```
~~~
"#;
    assert_eq!(parse_question_blocks(inside_tilde).len(), 0);
}

/// An indented `questions` fence is dedented by its own indentation, so its YAML reaches the parser
/// at column zero.
#[test]
fn test_indented_block_is_dedented() {
    let markdown = "Context:\n\n   ```questions\n   - id: indented\n     title: Which one?\n     options:\n       - title: A\n         value: a\n       - title: B\n         value: b\n   ```\n";

    let blocks = parse_question_blocks(markdown);
    assert_eq!(blocks.len(), 1);
    assert!(blocks[0].raw_body.starts_with("- id: indented"));
    assert_eq!(blocks[0].questions.len(), 1);
    assert_eq!(blocks[0].questions[0].options.len(), 2);
}

#[test]
fn test_lint_rules() {
    // Duplicate question IDs across document
    let dup_id = r#"
```questions
questions:
  - id: retry-limit
    title: Retry limit?
    options:
      - title: One
        value: one
      - title: Two
        value: two
  - id: retry-limit
    title: Duplicate ID question
    options:
      - title: Three
        value: three
      - title: Four
        value: four
```
"#;
    let blocks = parse_question_blocks(dup_id);
    let issues = validate_question_blocks(&blocks);
    assert!(issues.iter().any(|i| i.severity == IssueSeverity::Error
        && i.message.contains("duplicate question id 'retry-limit'")));

    // Invalid slug in id
    let invalid_slug = r#"
```questions
id: Invalid_Slug!
title: Bad slug?
options:
  - title: Option A
    value: a
  - title: Option B
    value: b
```
"#;
    let blocks = parse_question_blocks(invalid_slug);
    let issues = validate_question_blocks(&blocks);
    assert!(issues
        .iter()
        .any(|i| i.severity == IssueSeverity::Error && i.message.contains("invalid id")));

    // Header length exceeding 12 chars
    let long_header = r#"
```questions
id: header-test
title: Header test
header: ExceedsTwelveCharsHere
options:
  - title: Opt A
    value: a
  - title: Opt B
    value: b
```
"#;
    let blocks = parse_question_blocks(long_header);
    let issues = validate_question_blocks(&blocks);
    assert!(issues.iter().any(|i| i.severity == IssueSeverity::Error
        && i.message.contains("header must be 12 characters or fewer")));

    // Reserved option titles ("Other", "Custom")
    let reserved_title = r#"
```questions
id: reserved-test
title: Reserved title test
options:
  - title: Option 1
    value: opt-1
  - title: Other
    value: other-val
```
"#;
    let blocks = parse_question_blocks(reserved_title);
    let issues = validate_question_blocks(&blocks);
    assert!(issues.iter().any(|i| i.severity == IssueSeverity::Error
        && i.message.contains("duplicates what other: true provides")));

    // other: false with no options
    let other_false_no_opts = r#"
```questions
id: unanswerable-test
title: No options and other false
other: false
```
"#;
    let blocks = parse_question_blocks(other_false_no_opts);
    let issues = validate_question_blocks(&blocks);
    assert!(issues.iter().any(|i| i.severity == IssueSeverity::Error
        && i.message
            .contains("other: false with no options is unanswerable")));

    // Multiple answers on single-select
    let multi_on_single = r#"
```questions
id: single-test
title: Single select
multiple: false
options:
  - title: Opt 1
    value: opt-1
  - title: Opt 2
    value: opt-2
answer:
  - opt-1
  - opt-2
```
"#;
    let blocks = parse_question_blocks(multi_on_single);
    let issues = validate_question_blocks(&blocks);
    assert!(issues.iter().any(|i| i.severity == IssueSeverity::Error
        && i.message
            .contains("answer must be a scalar when multiple is false")));

    // Answer null
    let null_ans = r#"
```questions
id: null-test
title: Null answer test
options:
  - title: Opt 1
    value: opt-1
  - title: Opt 2
    value: opt-2
answer: null
```
"#;
    let blocks = parse_question_blocks(null_ans);
    let issues = validate_question_blocks(&blocks);
    assert!(issues
        .iter()
        .any(|i| i.severity == IssueSeverity::Error
            && i.message.contains("answer: null is not a state")));
}

#[test]
fn test_surgical_answer_application() {
    let original = r#"# My Plan

<!-- Important comment before questions -->
```questions
questions:
  - id: cache-backend
    title: Select Cache Backend
    header: Caching
    description: |
      Choose a fast in-memory or durable cache.
    options:
      - title: Memory Cache
        value: memory-cache
        recommended: true
      - title: Redis Cache
        value: redis-cache
  - id: log-destinations
    title: Log destinations?
    multiple: true
    options:
      - title: Console
        value: console
      - title: File
        value: file
      - title: Network
        value: network
```
<!-- End of questions -->

Some trailing markdown notes.
"#;

    let mut answers = HashMap::new();
    answers.insert("cache-backend".to_string(), vec!["redis-cache".to_string()]);
    answers.insert(
        "log-destinations".to_string(),
        vec!["console".to_string(), "file".to_string()],
    );

    let updated = apply_question_answers(original, &answers).expect("Failed to apply answers");

    assert!(updated.contains("<!-- Important comment before questions -->"));
    assert!(updated.contains("<!-- End of questions -->"));
    assert!(updated.contains("Some trailing markdown notes."));
    assert!(updated.contains("answer: redis-cache"));
    assert!(updated.contains("answer:\n      - console\n      - file"));

    // Now test re-applying different answers (replacement of existing answers)
    let mut new_answers = HashMap::new();
    new_answers.insert(
        "cache-backend".to_string(),
        vec!["memory-cache".to_string()],
    );

    let updated_twice =
        apply_question_answers(&updated, &new_answers).expect("Failed to re-apply answers");
    assert!(updated_twice.contains("answer: memory-cache"));
    assert!(!updated_twice.contains("answer: redis-cache"));
}

#[test]
fn test_revision_validation_integration() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-question-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).expect("Failed to create test dir");
    let plan_folder = &test_dir;

    let invalid_content = r#"# Invalid Plan
```questions
id: Invalid_Slug
title: Bad slug
options:
  - title: One
    value: one
  - title: Two
    value: two
```
"#;

    // By default, validate_questions = true rejects invalid question blocks
    let res = write_revision(plan_folder, invalid_content, true);
    assert!(res.is_err());
    let err_msg = res.unwrap_err().to_string();
    assert!(err_msg.contains("Question block validation failed"));

    // With validate_questions = false (e.g. --no-question-check), write succeeds
    let res_bypass = write_revision(plan_folder, invalid_content, false);
    assert!(res_bypass.is_ok());
    assert_eq!(res_bypass.unwrap(), 1);

    let content = get_revision(plan_folder, Some(1)).unwrap();
    assert_eq!(content, invalid_content);
}
