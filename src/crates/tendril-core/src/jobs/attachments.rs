//! `<TendrilHome>/Attachments/` — where a file the user attached lives, and what becomes of it.
//!
//! One directory, keyed by a session id, with two halves:
//!
//! * **Staging** ([`store_attachment`]). A file the user picks in the composer or drops on the window
//!   is *copied here*, and it is the copy the message references. That is not a convenience: only
//!   [`crate::security::local_file_roots`] paths can be previewed at all, and a screenshot on the
//!   user's Desktop is outside every root, so a message that kept the original path could never show
//!   a thumbnail. V1 has the same shape for the same reason — its `UseUpload` handler writes the
//!   uploaded stream into `Attachments/<sessionId>/` (`Apps/Chat/ContentView.cs`) or
//!   `Attachments/<uploadSessionId>/` (`CreatePlanDialog`) before anything references it.
//! * **Promotion** ([`move_attachments_to_plan_folder`]). A staged file belonging to a plan job is
//!   temporary storage referenced by a permanent document, so once the plan folder exists the files
//!   move into it and every reference to the old path is rewritten.
//!
//! **Lifetime.** A staged file is not owned by anything that would delete it: a chat session may never
//! be sent, a plan may never be created, and V1 deletes neither on those paths. What V1 does instead
//! is sweep on startup — `ConfigService.CleanStaleAttachmentsDirectory` removes every subdirectory of
//! `Attachments` older than 24 hours — and [`clean_stale_attachment_sessions`] is that sweep. So the
//! directory is bounded, and a staged file is guaranteed for a day rather than forever. (One
//! consequence, inherited from V1 rather than chosen here: a thumbnail in a chat older than a day
//! stops resolving after the next daemon restart and falls back to a paperclip chip.)
//!
//! Every failure in the promotion half is logged and swallowed. A plan that was created successfully
//! must not be failed because a file could not be moved. Staging, by contrast, reports its failures:
//! its caller has a user waiting to be told the file was not attached.

use crate::models::{JobArgs, JobItem};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// The largest file that may be staged, matching the cap on the preview that reads it back
/// (`TendrilClient::get_local_file_data_url`). Staging something the previewer would refuse to render
/// buys nothing, and the bytes arrive over an HTTP request that has to be bounded somewhere.
pub const MAX_ATTACHMENT_BYTES: usize = 16 * 1024 * 1024;

/// How long a staged attachment survives with nothing owning it — V1's 24 hours.
pub const STALE_ATTACHMENT_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// The session id used when a file is attached before any chat session exists, as V1's
/// `ContentView` does (`activeSessionId.Value ?? "temp"`).
pub const UNASSIGNED_SESSION: &str = "temp";

/// Why a file could not be staged. Separate variants because the caller has to answer differently:
/// a bad name or an oversized body is the request's fault, an I/O failure is the daemon's.
#[derive(Debug)]
pub enum AttachmentError {
    /// The file name could escape the session directory, or is not a usable file name at all.
    InvalidName,
    /// The session id is not a single, safe directory segment.
    InvalidSession,
    /// Larger than [`MAX_ATTACHMENT_BYTES`].
    TooLarge,
    Io(std::io::Error),
}

impl std::fmt::Display for AttachmentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidName => write!(f, "The attachment's file name is not allowed"),
            Self::InvalidSession => write!(f, "The attachment's session id is not allowed"),
            Self::TooLarge => write!(
                f,
                "The attachment is larger than {} MiB",
                MAX_ATTACHMENT_BYTES / (1024 * 1024)
            ),
            Self::Io(err) => write!(f, "The attachment could not be written: {err}"),
        }
    }
}

impl std::error::Error for AttachmentError {}

impl From<std::io::Error> for AttachmentError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

/// `<TendrilHome>/Attachments`.
pub fn attachments_dir(tendril_home: &Path) -> PathBuf {
    tendril_home.join("Attachments")
}

/// `<TendrilHome>/Attachments/<session_id>`, or `None` when the id is not one safe path segment.
///
/// The id reaches this from an HTTP request, so it is checked exactly as a file name is: a `..` or a
/// separator here would place the "session directory" anywhere on the disk, and every containment
/// guarantee below is stated relative to this directory.
pub fn attachment_session_dir(tendril_home: &Path, session_id: &str) -> Option<PathBuf> {
    let segment = safe_attachment_name(session_id)?;
    Some(attachments_dir(tendril_home).join(segment))
}

/// A caller-supplied name, accepted only if it is already a plain file name — refused otherwise.
///
/// Refusing rather than sanitising is deliberate. Stripping the offending characters out of
/// `../../.ssh/authorized_keys` leaves a name that writes *somewhere*, and "somewhere" is then a
/// property of the stripping rules; refusing leaves nothing to reason about. V1 sanitises (it strips
/// `Path.GetInvalidFileNameChars` after a `Path.GetFileName`), which is safe there and is not a
/// contract worth reproducing on this side.
///
/// Rejected: empty or whitespace, longer than 200 bytes, any `/`, `\`, NUL or `:` (a Windows drive
/// letter or NTFS alternate data stream), `.` and `..`, and anything that is not identical to its own
/// final path component — the catch-all for a shape a platform parses differently than this list
/// anticipates.
pub fn safe_attachment_name(raw: &str) -> Option<String> {
    let name = raw.trim();
    if name.is_empty() || name.len() > 200 {
        return None;
    }
    if name.contains(['/', '\\', '\0', ':']) {
        return None;
    }
    if name == "." || name == ".." {
        return None;
    }
    if Path::new(name).file_name().and_then(|n| n.to_str()) != Some(name) {
        return None;
    }
    Some(name.to_string())
}

/// Writes `bytes` into `<TendrilHome>/Attachments/<session_id>/` under `file_name`, and answers with
/// the absolute path it landed at.
///
/// The path returned is inside that directory or the call failed: the name is validated, and the
/// composed path is then checked to have the session directory as its immediate parent, so nothing
/// about how a platform interprets the name can move the write elsewhere.
///
/// An existing file of the same name is never overwritten — a second `screenshot.png` from a
/// different folder would otherwise silently replace the first, leaving two chips pointing at one
/// file. It gets a short suffix instead, as V1's `CreatePlanDialog` upload handler does.
pub fn store_attachment(
    tendril_home: &Path,
    session_id: &str,
    file_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, AttachmentError> {
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AttachmentError::TooLarge);
    }

    let dir =
        attachment_session_dir(tendril_home, session_id).ok_or(AttachmentError::InvalidSession)?;
    let name = safe_attachment_name(file_name).ok_or(AttachmentError::InvalidName)?;

    // Belt and braces over `safe_attachment_name`: whatever the name turned out to mean on this
    // platform, the file is written as a direct child of the session directory or not at all. Checked
    // before anything is created, so a refused name leaves no directory behind either.
    let target = free_target(&dir, &name);
    if target.parent() != Some(dir.as_path()) {
        return Err(AttachmentError::InvalidName);
    }

    std::fs::create_dir_all(&dir)?;
    std::fs::write(&target, bytes)?;
    Ok(target)
}

/// `dir/name`, or `dir/<stem>_<n><ext>` for the first `n` that is not taken.
fn free_target(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }

    let as_path = Path::new(name);
    let stem = as_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let extension = as_path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    for n in 1..1000 {
        let candidate = dir.join(format!("{stem}_{n}{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    // A thousand collisions on one name in one session is not a case worth a distinct answer; the
    // write overwrites the last candidate rather than failing the attachment.
    dir.join(format!("{stem}_999{extension}"))
}

/// Deletes every session directory under `Attachments` older than `max_age`, and answers with how
/// many went. A port of V1's `ConfigService.CleanStaleAttachmentsDirectory`, called on daemon start.
///
/// Age is taken from the directory's creation time where the platform reports one and its
/// modification time otherwise, so a directory whose age cannot be established is left alone rather
/// than deleted. Only directories are considered: `Attachments` itself is never removed.
pub fn clean_stale_attachment_sessions(tendril_home: &Path, max_age: Duration) -> usize {
    let root = attachments_dir(tendril_home);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return 0;
    };

    let now = SystemTime::now();
    let mut removed = 0usize;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(age) = directory_age(&path, now) else {
            continue;
        };
        if age <= max_age {
            continue;
        }
        match std::fs::remove_dir_all(&path) {
            Ok(()) => {
                removed += 1;
                tracing::info!("Removed stale attachment directory {}", path.display());
            }
            Err(e) => tracing::warn!(
                "Failed to remove stale attachment directory {}: {}",
                path.display(),
                e
            ),
        }
    }
    removed
}

fn directory_age(path: &Path, now: SystemTime) -> Option<Duration> {
    let metadata = std::fs::metadata(path).ok()?;
    let stamp = metadata.created().or_else(|_| metadata.modified()).ok()?;
    now.duration_since(stamp).ok()
}

/// Moves a job's uploaded attachments into its plan folder and rewrites the references to them.
///
/// A no-op unless the job carries an `uploadSessionId` and its plan folder resolves.
pub fn move_attachments_to_plan_folder(tendril_home: &Path, plans_dir: &Path, job: &JobItem) {
    let Some(session_id) = upload_session_id(job) else {
        return;
    };
    // Through the same helper the staging half writes with, so one function owns the layout.
    let Some(session_dir) = attachment_session_dir(tendril_home, &session_id) else {
        return;
    };
    if !session_dir.is_dir() {
        return;
    }

    let Some(plan_folder) = resolve_plan_folder(plans_dir, job) else {
        tracing::warn!(
            "Job {}: attachments left in {} — no plan folder resolved",
            job.id,
            session_dir.display()
        );
        return;
    };

    let target_dir = plan_folder.join("Attachments");
    if let Err(e) = std::fs::create_dir_all(&target_dir) {
        tracing::warn!(
            "Job {}: failed to create {}: {}",
            job.id,
            target_dir.display(),
            e
        );
        return;
    }

    let entries = match std::fs::read_dir(&session_dir) {
        Ok(entries) => entries,
        Err(e) => {
            tracing::warn!(
                "Job {}: failed to read {}: {}",
                job.id,
                session_dir.display(),
                e
            );
            return;
        }
    };

    let mut moved = 0usize;
    for entry in entries.filter_map(|e| e.ok()) {
        let from = entry.path();
        if !from.is_file() {
            continue;
        }
        let Some(name) = from.file_name() else {
            continue;
        };
        let to = target_dir.join(name);

        if let Err(e) = move_file(&from, &to) {
            tracing::warn!(
                "Job {}: failed to move {} to {}: {}",
                job.id,
                from.display(),
                to.display(),
                e
            );
            continue;
        }
        moved += 1;
        rewrite_path_references(&plan_folder, &from, &to);
    }

    if moved > 0 {
        tracing::info!(
            "Job {}: moved {} attachment(s) into {}",
            job.id,
            moved,
            target_dir.display()
        );
    }

    // Only removes the directory if it is now empty, so anything that failed to move is preserved.
    let _ = std::fs::remove_dir(&session_dir);
}

/// Rewrites `old_path` to `new_path` in every plan document, in both the native and forward-slash
/// forms — a prompt written on Windows and a plan read on macOS must both resolve.
pub fn rewrite_path_references(plan_folder: &Path, old_path: &Path, new_path: &Path) {
    let old_native = old_path.to_string_lossy().to_string();
    let new_native = new_path.to_string_lossy().to_string();
    let old_slash = old_native.replace('\\', "/");
    let new_slash = new_native.replace('\\', "/");

    for file in plan_documents(plan_folder) {
        let Ok(content) = std::fs::read_to_string(&file) else {
            continue;
        };
        let mut updated = content.replace(&old_native, &new_native);
        if old_slash != old_native {
            updated = updated.replace(&old_slash, &new_slash);
        }
        if updated == content {
            continue;
        }
        if let Err(e) = std::fs::write(&file, updated) {
            tracing::warn!(
                "Failed to rewrite attachment references in {}: {}",
                file.display(),
                e
            );
        }
    }
}

/// Every markdown and YAML document under a plan folder — the files that can carry a path reference.
fn plan_documents(plan_folder: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(plan_folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| {
            matches!(
                p.extension().and_then(|e| e.to_str()),
                Some("md") | Some("yaml") | Some("yml")
            )
        })
        .collect()
}

/// `fs::rename` first, falling back to copy-then-delete: the attachments directory and the plans
/// directory can sit on different volumes.
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    match std::fs::rename(from, to) {
        Ok(()) => Ok(()),
        Err(_) => {
            std::fs::copy(from, to)?;
            std::fs::remove_file(from)
        }
    }
}

fn upload_session_id(job: &JobItem) -> Option<String> {
    match job.typed_args.as_ref()? {
        JobArgs::CreatePlan(args) => args.upload_session_id.clone(),
        JobArgs::UpdatePlan(args) => args.upload_session_id.clone(),
        _ => None,
    }
    .filter(|id| !id.trim().is_empty())
}

/// The plan folder to move attachments into: the folder the args name, else the one recorded on the
/// job (which `verify_deliverable` fills in for a verified CreatePlan).
fn resolve_plan_folder(plans_dir: &Path, job: &JobItem) -> Option<PathBuf> {
    if let Some(JobArgs::UpdatePlan(args)) = job.typed_args.as_ref() {
        let from_args = PathBuf::from(&args.folder_path);
        if from_args.is_dir() {
            return Some(from_args);
        }
        // A relative folder path is resolved against the plans directory.
        let joined = plans_dir.join(&args.folder_path);
        if joined.is_dir() {
            return Some(joined);
        }
    }

    let from_job = PathBuf::from(&job.plan_file);
    if from_job.is_dir() {
        return Some(from_job);
    }
    None
}
