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
