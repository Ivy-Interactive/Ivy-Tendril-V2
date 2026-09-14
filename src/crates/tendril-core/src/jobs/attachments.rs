//! Moves uploaded files out of their session temp directory and into the plan they belong to.
//!
//! A user attaches a screenshot when they ask for a plan; the upload lands in
//! `<TendrilHome>/Attachments/<uploadSessionId>/` and the prompt references it from there. Once the
//! plan folder exists, that path is temporary storage referenced by a permanent document — so the
//! files move into the plan and every reference to the old path is rewritten.
//!
//! Every failure here is logged and swallowed. A plan that was created successfully must not be
//! failed because a file could not be moved.

use crate::models::{JobArgs, JobItem};
use std::path::{Path, PathBuf};

/// Moves a job's uploaded attachments into its plan folder and rewrites the references to them.
///
/// A no-op unless the job carries an `uploadSessionId` and its plan folder resolves.
pub fn move_attachments_to_plan_folder(tendril_home: &Path, plans_dir: &Path, job: &JobItem) {
    let Some(session_id) = upload_session_id(job) else {
        return;
    };
    let session_dir = tendril_home.join("Attachments").join(&session_id);
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
