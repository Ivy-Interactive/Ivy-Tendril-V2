//! Reading a job log the way a follower has to: only what has been appended.
//!
//! The regression these exist for is #132. The SSE routes called `read_raw_log`/`read_eventwire_log`
//! on a 250 ms timer, and each of those returns the *whole* file — so every viewer of a running job
//! re-read the entire log four times a second for as long as the job ran, and an abandoned stream kept
//! doing it. `read_lines_from` is the primitive that makes a tick cost the appended bytes instead.

use std::io::Write;
use tendril_core::jobs::read_lines_from;

fn append(path: &std::path::Path, text: &str) {
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .expect("open log for append");
    f.write_all(text.as_bytes()).expect("append to log");
}

fn temp_log(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tendril-log-follow-{}-{}",
        label,
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir.join("00123.eventwire.jsonl")
}

#[test]
fn a_second_read_returns_only_what_was_appended() {
    let path = temp_log("incremental");
    append(&path, "{\"kind\":\"text\",\"text\":\"one\"}\n");
    append(&path, "{\"kind\":\"text\",\"text\":\"two\"}\n");

    let first = read_lines_from(&path, 0).expect("first read");
    assert_eq!(first.lines.len(), 2);
    assert!(first.next_offset > 0);

    // Nothing new: no lines, and the offset does not move. This is the tick that used to re-read the
    // entire file.
    let idle = read_lines_from(&path, first.next_offset).expect("idle read");
    assert!(idle.lines.is_empty());
    assert_eq!(idle.next_offset, first.next_offset);

    append(&path, "{\"kind\":\"text\",\"text\":\"three\"}\n");
    let second = read_lines_from(&path, first.next_offset).expect("second read");
    assert_eq!(
        second.lines,
        vec!["{\"kind\":\"text\",\"text\":\"three\"}".to_string()],
        "only the appended line, not the file"
    );
}

#[test]
fn a_half_written_line_is_held_back_until_it_has_its_newline() {
    let path = temp_log("partial");
    append(&path, "{\"kind\":\"text\",\"text\":\"done\"}\n");
    // The agent writes with `writeln!`, so a read can land between the payload and its terminator.
    // Delivering that half as a finished frame hands every consumer a JSON parse error for a line that
    // was about to be fine.
    append(&path, "{\"kind\":\"text\",\"tex");

    let first = read_lines_from(&path, 0).expect("first read");
    assert_eq!(first.lines.len(), 1);
    assert_eq!(
        first.partial.as_deref(),
        Some("{\"kind\":\"text\",\"tex"),
        "the unterminated tail is reported separately, not as a line"
    );

    append(&path, "t\":\"later\"}\n");
    let second = read_lines_from(&path, first.next_offset).expect("second read");
    assert_eq!(
        second.lines,
        vec!["{\"kind\":\"text\",\"text\":\"later\"}".to_string()],
        "the completed line is delivered once, in full"
    );
    assert!(second.partial.is_none());
}

#[test]
fn a_carriage_return_is_stripped_with_the_newline() {
    let path = temp_log("crlf");
    append(&path, "first\r\nsecond\r\n");

    let chunk = read_lines_from(&path, 0).expect("read");
    assert_eq!(chunk.lines, vec!["first".to_string(), "second".to_string()]);
}

#[test]
fn a_shrunken_file_resynchronises_instead_of_replaying_a_new_one() {
    let path = temp_log("truncated");
    append(&path, "aaaaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaaaa\n");
    let first = read_lines_from(&path, 0).expect("first read");
    assert_eq!(first.lines.len(), 2);

    // A file shorter than the cursor was replaced, not appended to. Reading its bytes as a
    // continuation would emit the tail of an unrelated log as if the job had just produced it.
    std::fs::write(&path, "short\n").expect("truncate log");
    let after = read_lines_from(&path, first.next_offset).expect("read after truncation");
    assert!(after.lines.is_empty());
    assert_eq!(after.next_offset, 6, "the cursor lands at the new end");
}
