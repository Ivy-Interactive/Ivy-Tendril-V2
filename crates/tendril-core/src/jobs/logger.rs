use crate::error::Result;
use chrono::Utc;
use std::io::Write;
use std::path::{Path, PathBuf};

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
