//! Append-only record of what happened to each plan worktree.
//!
//! A worktree and its `tendril/*` branch are often the only place a run's commits live, so when one
//! disappears the question "who removed it, and why" has to be answerable after the fact. Every
//! write here is best-effort: a logging failure must never fail a job or abort a reaper pass.

use chrono::{SecondsFormat, Utc};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One line per event, appended under a mutex, in `<TendrilHome>/Logs/worktrees.log`.
pub struct WorktreeLifecycleLog {
    path: PathBuf,
    lock: Mutex<()>,
}

impl WorktreeLifecycleLog {
    /// The operator-visible log at `<tendril_home>/Logs/worktrees.log`, next to `Logs/Jobs/`.
    pub fn new(tendril_home: &Path) -> Self {
        let dir = tendril_home.join("Logs");
        let _ = std::fs::create_dir_all(&dir);
        Self::at(dir.join("worktrees.log"))
    }

    /// A log at an explicit path. The seam tests use to keep out of the operator's real home.
    pub fn at(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn creation(&self, plan_id: &str, repo: &Path, worktree: &Path, branch: &str) {
        self.write(
            plan_id,
            "Creation",
            &format!(
                "repo=\"{}\" worktree=\"{}\" branch=\"{}\"",
                show(repo),
                show(worktree),
                escape(branch)
            ),
        );
    }

    pub fn creation_failed(&self, plan_id: &str, repo: &Path, worktree: &Path, error: &str) {
        self.write(
            plan_id,
            "CreationFailed",
            &format!(
                "repo=\"{}\" worktree=\"{}\" error=\"{}\"",
                show(repo),
                show(worktree),
                escape(error)
            ),
        );
    }

    pub fn reuse(&self, plan_id: &str, repo: &Path, worktree: &Path, branch: &str) {
        self.write(
            plan_id,
            "Reuse",
            &format!(
                "repo=\"{}\" worktree=\"{}\" branch=\"{}\"",
                show(repo),
                show(worktree),
                escape(branch)
            ),
        );
    }

    pub fn reap_attempt(&self, plan_id: &str, worktree: &Path, trigger: &str, git_file: bool) {
        self.write(
            plan_id,
            "ReapAttempt",
            &format!(
                "worktree=\"{}\" trigger=\"{}\" gitFileExists=\"{}\"",
                show(worktree),
                escape(trigger),
                git_file
            ),
        );
    }

    pub fn reap_skipped(&self, plan_id: &str, worktree: &Path, reason: &str) {
        self.write(
            plan_id,
            "ReapSkipped",
            &format!(
                "worktree=\"{}\" reason=\"{}\"",
                show(worktree),
                escape(reason)
            ),
        );
    }

    pub fn reclaimed(&self, plan_id: &str, worktree: &Path, branch_disposition: &str) {
        self.write(
            plan_id,
            "Reclaimed",
            &format!(
                "worktree=\"{}\" branch=\"{}\"",
                show(worktree),
                escape(branch_disposition)
            ),
        );
    }

    pub fn reap_failed(&self, plan_id: &str, worktree: &Path, error: &str) {
        self.write(
            plan_id,
            "ReapFailed",
            &format!(
                "worktree=\"{}\" error=\"{}\"",
                show(worktree),
                escape(error)
            ),
        );
    }

    fn write(&self, plan_id: &str, event: &str, metadata: &str) {
        let line = format!(
            "[{}] [{}] [{}] {}\n",
            Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true),
            plan_id,
            event,
            metadata
        );

        // A poisoned mutex still guards a valid file handle: keep logging rather than panicking.
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
        {
            let _ = file.write_all(line.as_bytes());
        }
    }
}

impl std::fmt::Debug for WorktreeLifecycleLog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorktreeLifecycleLog")
            .field("path", &self.path)
            .finish()
    }
}

/// The 5 digits before the first `-` of a plan folder name, e.g. `00554`, else `unknown`.
pub fn extract_plan_id(plan_folder: &Path) -> String {
    let Some(name) = plan_folder.file_name().and_then(|n| n.to_str()) else {
        return "unknown".to_string();
    };
    let head = name.split('-').next().unwrap_or_default();
    if head.len() == 5 && head.chars().all(|c| c.is_ascii_digit()) {
        head.to_string()
    } else {
        "unknown".to_string()
    }
}

fn show(path: &Path) -> String {
    escape(&path.to_string_lossy())
}

fn escape(value: &str) -> String {
    value.replace('"', "\\\"").replace(['\n', '\r'], " ")
}
