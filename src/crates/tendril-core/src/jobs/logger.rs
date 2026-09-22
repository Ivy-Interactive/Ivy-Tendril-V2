use crate::error::Result;
use chrono::Utc;
use std::io::Write;
use std::path::{Path, PathBuf};

/// What one incremental read of a log file produced.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LogChunk {
    /// The complete lines that started at the requested offset, newline stripped.
    pub lines: Vec<String>,
    /// Where the next read must start. Only ever advances past a terminated line, so a line the
    /// writer is still appending is read again — in full — next time.
    pub next_offset: u64,
    /// A trailing line with no newline yet. Held back from `lines` because it is not finished, and
    /// offered separately so a caller that knows nothing more is coming can still deliver it.
    pub partial: Option<String>,
}

pub fn get_job_log_path(tendril_home: &Path, job_id: &str) -> PathBuf {
    tendril_home
        .join("Logs")
        .join("Jobs")
        .join(format!("{}.md", job_id))
}

/// Highest 5-digit job id that still has artifacts under `<TendrilHome>/Logs/Jobs/`, or 0 when the
/// directory holds none (or does not exist yet).
///
/// Deleting a job drops its database row and deliberately keeps its logs — see
/// `JobManager::delete_job`, "not the forensic record of what it did". Id allocation, though, counts
/// up from the highest id in that table, so after a clear the next job is handed `00001` again and
/// its output is *appended* to the kept log of the job that held the id before it. The two runs then
/// share one file, and everything derived from it reads the pair as a single run: the metrics footer
/// anchors elapsed on the first line and shows a two-minute-old job as "20h 25m", and the usage
/// backfill sums both runs' tokens into the newer job's row.
///
/// So allocation asks the disk as well as the database, and an id whose log is still on disk is
/// never handed out a second time. Ids go sparse after a clear, which is the cost of keeping the
/// record under its own name.
pub fn max_logged_job_id(tendril_home: &Path) -> u32 {
    let dir = tendril_home.join("Logs").join("Jobs");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            // `00007.eventwire.jsonl`, `00007.raw.jsonl`, `00007.md`, `00007.prompt.txt` — every
            // artifact this module writes leads with the zero-padded id.
            let (id, _) = name.split_once('.')?;
            if id.len() == 5 && id.bytes().all(|b| b.is_ascii_digit()) {
                id.parse::<u32>().ok()
            } else {
                None
            }
        })
        .max()
        .unwrap_or(0)
}

pub fn ensure_log_dirs(tendril_home: &Path) -> Result<()> {
    let dir = tendril_home.join("Logs").join("Jobs");
    std::fs::create_dir_all(dir)?;
    Ok(())
}

pub fn get_prompt_path(tendril_home: &Path, job_id: &str) -> PathBuf {
    tendril_home
        .join("Logs")
        .join("Jobs")
        .join(format!("{}.prompt.md", job_id))
}

/// Persists the compiled firmware prompt before the agent is spawned, so it survives a job that is
/// killed or times out and can be inspected afterwards.
pub fn write_prompt(tendril_home: &Path, job_id: &str, prompt: &str) -> Result<PathBuf> {
    ensure_log_dirs(tendril_home)?;
    let path = get_prompt_path(tendril_home, job_id);
    std::fs::write(&path, prompt)?;
    Ok(path)
}

pub fn append_to_raw_log(tendril_home: &Path, job_id: &str, line: &str) -> Result<()> {
    let path = tendril_home
        .join("Logs")
        .join("Jobs")
        .join(format!("{}.raw.jsonl", job_id));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{}", line)?;
    Ok(())
}

pub fn append_to_eventwire(tendril_home: &Path, job_id: &str, event_json: &str) -> Result<()> {
    let path = tendril_home
        .join("Logs")
        .join("Jobs")
        .join(format!("{}.eventwire.jsonl", job_id));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{}", event_json)?;
    Ok(())
}

pub fn append_agent_log(
    tendril_home: &Path,
    job_id: &str,
    action: &str,
    summary: Option<&str>,
) -> Result<PathBuf> {
    ensure_log_dirs(tendril_home)?;
    let log_path = get_job_log_path(tendril_home, job_id);

    let mut content = format!(
        "\n\n## Agent Log [{}]\n**Action:** {}\n",
        Utc::now().to_rfc3339(),
        action
    );
    if let Some(s) = summary {
        content.push_str(&format!("\n{}\n", s));
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    file.write_all(content.as_bytes())?;

    Ok(log_path)
}

pub fn find_log_file(tendril_home: &Path, job_id: &str, suffix: &str) -> Option<PathBuf> {
    // 1. Direct match in Logs/Jobs/{job_id}{suffix}
    let direct_logs = tendril_home
        .join("Logs")
        .join("Jobs")
        .join(format!("{}{}", job_id, suffix));
    if direct_logs.is_file() {
        return Some(direct_logs);
    }

    // 2. Direct match in Jobs/{job_id}{suffix}
    let direct_jobs = tendril_home
        .join("Jobs")
        .join(format!("{}{}", job_id, suffix));
    if direct_jobs.is_file() {
        return Some(direct_jobs);
    }

    // 3. Prefix match in Logs/Jobs
    let logs_dir = tendril_home.join("Logs").join("Jobs");
    if let Ok(entries) = std::fs::read_dir(&logs_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(job_id) && name.ends_with(suffix) {
                if suffix == ".md" && name.ends_with(".prompt.md") {
                    continue;
                }
                return Some(entry.path());
            }
        }
    }

    // 4. Prefix match in Jobs
    let jobs_dir = tendril_home.join("Jobs");
    if let Ok(entries) = std::fs::read_dir(&jobs_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(job_id) && name.ends_with(suffix) {
                if suffix == ".md" && name.ends_with(".prompt.md") {
                    continue;
                }
                return Some(entry.path());
            }
        }
    }

    None
}

/// How much is read at a time while looking backwards for the start of the tail.
const TAIL_SCAN_CHUNK: usize = 8 * 1024;

/// Byte offset at which the last `tail` complete lines of a `len`-byte file begin.
///
/// Found by walking backwards from the end counting newlines, so the cost is the size of the window
/// asked for rather than the size of the file. That is the whole point: an agent's `.eventwire.jsonl`
/// is 6.9MB at 100k lines, and every caller of [`read_eventwire_log`] with a `tail` — the log route,
/// the recovery pass that wants the last 20 lines of every interrupted job — was reading all of it and
/// throwing away everything but the window. Reading 6.9MB to answer a question about 2KB is the
/// fetch-side half of "100k lines loaded to display 50".
///
/// A newline at the very last byte terminates the final line rather than starting another, so it is
/// not counted; a `\n` cannot occur inside a multi-byte UTF-8 sequence, so cutting the file here can
/// never split a character.
fn tail_offset(file: &mut std::fs::File, len: u64, tail: usize) -> Result<u64> {
    use std::io::{Read, Seek, SeekFrom};

    if tail == 0 {
        return Ok(len);
    }

    let mut found = 0usize;
    let mut pos = len;
    let mut buf = vec![0u8; TAIL_SCAN_CHUNK];

    while pos > 0 {
        let take = std::cmp::min(TAIL_SCAN_CHUNK as u64, pos) as usize;
        pos -= take as u64;
        file.seek(SeekFrom::Start(pos))?;
        file.read_exact(&mut buf[..take])?;
        for i in (0..take).rev() {
            if buf[i] != b'\n' {
                continue;
            }
            let at = pos + i as u64;
            if at + 1 == len {
                continue;
            }
            found += 1;
            if found == tail {
                return Ok(at + 1);
            }
        }
    }

    // Fewer lines in the file than were asked for: the whole file *is* the tail.
    Ok(0)
}

/// The last `tail` lines of a file, newline stripped, or every line when `tail` is `None`.
fn read_lines_tail(path: &Path, tail: Option<usize>) -> Result<Vec<String>> {
    use std::io::{BufRead, Seek, SeekFrom};

    let mut file = std::fs::File::open(path)?;
    let offset = match tail {
        // The caller asked for the file, so it reads the file.
        None => 0,
        Some(n) => {
            let len = file.metadata()?.len();
            tail_offset(&mut file, len, n)?
        }
    };
    file.seek(SeekFrom::Start(offset))?;

    let reader = std::io::BufReader::new(file);
    let mut lines = Vec::new();
    for line in reader.lines() {
        lines.push(line?);
    }
    Ok(lines)
}

/// Reads the lines a log file has grown by since byte `offset`.
///
/// This is what a follower — an SSE stream, a tail view — needs instead of [`read_raw_log`] and
/// friends: those return the *whole* file every time, so a stream that polled them on a timer read
/// the entire log on every tick for as long as the job ran. Here the cost of a tick is the bytes
/// actually appended since the last one.
///
/// A trailing line without its newline is reported as `partial` rather than as a line, and
/// `next_offset` stops short of it: the agent writes with `writeln!`, so a read can land between the
/// payload and its terminator, and emitting that half as a finished JSON event would hand every
/// consumer a parse error for a line that was about to be fine.
///
/// A file that has *shrunk* below `offset` was replaced, not appended to. Rather than read a new
/// file's bytes as a continuation of the old one's, this resynchronises to the new end and reports
/// nothing; the alternative is emitting the tail of an unrelated log as if the job had just
/// produced it.
pub fn read_lines_from(path: &Path, offset: u64) -> Result<LogChunk> {
    use std::io::{BufRead, BufReader, Seek, SeekFrom};

    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();

    if len < offset {
        return Ok(LogChunk {
            lines: Vec::new(),
            next_offset: len,
            partial: None,
        });
    }
    if len == offset {
        return Ok(LogChunk {
            lines: Vec::new(),
            next_offset: offset,
            partial: None,
        });
    }

    file.seek(SeekFrom::Start(offset))?;
    let mut reader = BufReader::new(file);

    let mut chunk = LogChunk {
        lines: Vec::new(),
        next_offset: offset,
        partial: None,
    };
    let mut buf: Vec<u8> = Vec::new();

    loop {
        buf.clear();
        let read = reader.read_until(b'\n', &mut buf)?;
        if read == 0 {
            break;
        }
        if buf.last() != Some(&b'\n') {
            chunk.partial = Some(String::from_utf8_lossy(&buf).into_owned());
            break;
        }
        chunk.next_offset += read as u64;
        buf.pop();
        if buf.last() == Some(&b'\r') {
            buf.pop();
        }
        chunk.lines.push(String::from_utf8_lossy(&buf).into_owned());
    }

    Ok(chunk)
}

pub fn read_job_log(tendril_home: &Path, job_id: &str) -> Result<Option<String>> {
    if let Some(path) = find_log_file(tendril_home, job_id, ".md") {
        let content = std::fs::read_to_string(path)?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

pub fn read_raw_log(
    tendril_home: &Path,
    job_id: &str,
    tail: Option<usize>,
) -> Result<Option<Vec<String>>> {
    if let Some(path) = find_log_file(tendril_home, job_id, ".raw.jsonl") {
        let lines = read_lines_tail(&path, tail)?;
        Ok(Some(lines))
    } else {
        Ok(None)
    }
}

/// A job's eventwire log, or its last `tail` lines.
///
/// `tail` is a *window*, and since [`read_lines_tail`] finds it by walking back from the end of the
/// file, asking for a window now costs the window. `None` still reads and returns the whole log, which
/// for a long run is megabytes: [`read_lines_from`] is what a follower should use, and a caller that
/// only needs the end of the run should say so.
pub fn read_eventwire_log(
    tendril_home: &Path,
    job_id: &str,
    tail: Option<usize>,
) -> Result<Option<Vec<String>>> {
    if let Some(path) = find_log_file(tendril_home, job_id, ".eventwire.jsonl") {
        let lines = read_lines_tail(&path, tail)?;
        Ok(Some(lines))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory of its own per test, the way the crate's other log tests get one.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "tendril-log-tail-{}-{}",
                label,
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&dir).expect("create temp dir");
            Self(dir)
        }

        fn file(&self, name: &str, content: &str) -> PathBuf {
            let path = self.0.join(name);
            let mut file = std::fs::File::create(&path).expect("create file");
            file.write_all(content.as_bytes()).expect("write file");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn tail_of(content: &str, tail: Option<usize>) -> Vec<String> {
        let dir = TempDir::new("case");
        let path = dir.file("log.jsonl", content);
        read_lines_tail(&path, tail).expect("read tail")
    }

    #[test]
    fn tail_returns_the_last_n_lines_in_order() {
        assert_eq!(tail_of("a\nb\nc\nd\n", Some(2)), vec!["c", "d"]);
        assert_eq!(tail_of("a\nb\nc\nd", Some(2)), vec!["c", "d"]);
        assert_eq!(tail_of("a\nb\nc\nd\n", Some(1)), vec!["d"]);
    }

    #[test]
    fn a_window_larger_than_the_file_is_the_whole_file() {
        assert_eq!(tail_of("a\nb\n", Some(9)), vec!["a", "b"]);
        assert_eq!(tail_of("only line", Some(9)), vec!["only line"]);
    }

    #[test]
    fn no_window_is_every_line() {
        assert_eq!(tail_of("a\nb\nc\n", None), vec!["a", "b", "c"]);
    }

    #[test]
    fn an_empty_window_and_an_empty_file_are_both_nothing() {
        assert!(tail_of("a\nb\n", Some(0)).is_empty());
        assert!(tail_of("", Some(3)).is_empty());
        assert!(tail_of("", None).is_empty());
    }

    #[test]
    fn crlf_terminators_are_stripped_like_lf_ones() {
        assert_eq!(tail_of("a\r\nb\r\nc\r\n", Some(2)), vec!["b", "c"]);
    }

    #[test]
    fn multi_byte_characters_survive_the_cut() {
        // A `\n` never occurs inside a UTF-8 sequence, so a cut at one cannot split a character —
        // but only if the scan cuts *at* newlines, which is what this pins.
        assert_eq!(tail_of("é\n数\n🙂\n", Some(2)), vec!["数", "🙂"]);
    }

    #[test]
    fn a_window_spanning_more_than_one_scan_chunk_is_still_correct() {
        // Lines long enough that two of them exceed `TAIL_SCAN_CHUNK`, so the backwards walk has to
        // carry its count across chunk boundaries.
        let long = "x".repeat(TAIL_SCAN_CHUNK);
        let content = format!("{long}\n{long}\n{long}\n");
        let lines = tail_of(&content, Some(2));
        assert_eq!(lines.len(), 2);
        assert!(lines.iter().all(|line| line.len() == TAIL_SCAN_CHUNK));
    }

    #[test]
    fn a_window_costs_the_window_rather_than_the_file() {
        // The fetch-side defect this replaced: the whole log was read into a `Vec<String>` and all but
        // the last few entries thrown away. A 200k-line log is ~2.6MB, and answering `tail = 50`
        // against it must touch kilobytes, not megabytes — which is exactly what the offset the scan
        // lands on measures.
        let dir = TempDir::new("big");
        let mut content = String::new();
        for i in 0..200_000 {
            content.push_str(&format!("{{\"kind\":\"text\",\"text\":\"line {i}\"}}\n"));
        }
        let path = dir.file("big.jsonl", &content);

        let len = std::fs::metadata(&path).expect("metadata").len();
        assert!(len > 2_000_000, "fixture should be megabytes, was {len}");

        let mut file = std::fs::File::open(&path).expect("open");
        let offset = tail_offset(&mut file, len, 50).expect("tail offset");
        assert!(
            len - offset < 4 * 1024,
            "reading the last 50 lines should start within a few KB of the end, not {} bytes back",
            len - offset
        );

        let lines = read_lines_tail(&path, Some(50)).expect("read tail");
        assert_eq!(lines.len(), 50);
        assert!(lines[49].contains("line 199999"));
        assert!(lines[0].contains("line 199950"));
    }

    /// The id high-water mark that keeps a cleared job's logs from being appended to.
    mod logged_job_ids {
        use super::*;

        fn home(label: &str) -> TempDir {
            let dir = TempDir::new(label);
            std::fs::create_dir_all(dir.0.join("Logs").join("Jobs")).expect("create Logs/Jobs");
            dir
        }

        fn log(home: &TempDir, name: &str) {
            let path = home.0.join("Logs").join("Jobs").join(name);
            std::fs::write(path, "{}\n").expect("write log");
        }

        #[test]
        fn is_zero_when_nothing_has_run() {
            let dir = home("empty");
            assert_eq!(max_logged_job_id(&dir.0), 0);
        }

        #[test]
        fn is_zero_when_the_log_directory_is_missing() {
            // A first launch, before `ensure_log_dirs`. Allocation must not fail here.
            let dir = TempDir::new("no-dir");
            assert_eq!(max_logged_job_id(&dir.0), 0);
        }

        #[test]
        fn finds_the_highest_id_across_every_artifact_kind() {
            let dir = home("mixed");
            log(&dir, "00001.eventwire.jsonl");
            log(&dir, "00007.raw.jsonl");
            log(&dir, "00004.md");
            log(&dir, "00012.prompt.txt");
            assert_eq!(max_logged_job_id(&dir.0), 12);
        }

        #[test]
        fn ignores_names_that_are_not_a_padded_id() {
            let dir = home("junk");
            log(&dir, "00003.eventwire.jsonl");
            log(&dir, "notes.md");
            log(&dir, "123.md");
            log(&dir, "0000x.md");
            log(&dir, "000001.md");
            assert_eq!(max_logged_job_id(&dir.0), 3);
        }

        #[test]
        fn outlives_the_database_row_it_belonged_to() {
            // The bug this exists for: the jobs table is cleared, so the next id would be 00001
            // again, but 00010's log is still on disk and an appending writer would stack the new
            // run onto it. The mark is what stops the id being reissued.
            let dir = home("cleared");
            for id in 1..=10 {
                log(&dir, &format!("{:05}.eventwire.jsonl", id));
            }
            let max_in_db: u32 = 0;
            assert_eq!(max_in_db.max(max_logged_job_id(&dir.0)) + 1, 11);
        }
    }
}
