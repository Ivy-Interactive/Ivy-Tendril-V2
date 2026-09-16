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

fn read_lines_tail(path: &Path, tail: Option<usize>) -> Result<Vec<String>> {
    use std::io::BufRead;
    let file = std::fs::File::open(path)?;
    let reader = std::io::BufReader::new(file);
    let mut lines = Vec::new();
    for line in reader.lines() {
        lines.push(line?);
    }
    if let Some(n) = tail {
        if lines.len() > n {
            lines = lines[lines.len() - n..].to_vec();
        }
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
