//! Wires the filesystem watcher to the SQLite mirror and to connected clients.
//!
//! The ordering here is the point of the module: the mirror is updated **before** the event reaches
//! a client, so a client that refetches the moment it is woken cannot read a row older than the
//! event that woke it. Doing the re-sync client-side would make that race unfixable.

use crate::state::AppState;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tendril_core::db::{delete_plan, get_plans, open_database, sync_plan};
use tendril_core::plans::reader::read_plan_file_locked;
use tendril_core::watcher::{ChangeEvent, ChangeTarget, FsWatcher, WatchConfig};

/// Starts the watcher and the task that reacts to its events.
///
/// Called from `run_server` after `MasterGuard::acquire`, so only the master daemon watches — the
/// same reason `reconcile_after_restart` lives there. The returned handle must be kept alive:
/// dropping it stops watching.
pub fn spawn_change_watcher(state: Arc<AppState>) -> anyhow::Result<FsWatcher> {
    let cfg = WatchConfig::new(
        state.plans_dir.clone(),
        state.config_path.clone(),
        state.tendril_home.join("Inbox"),
    );

    // The watcher's own channel, not `state.change_tx`: every event passes through the re-sync
    // below and is re-broadcast from there, so a client never sees one that has not been applied.
    let (raw_tx, mut raw_rx) = tokio::sync::broadcast::channel::<ChangeEvent>(256);
    let watcher = FsWatcher::spawn(cfg, raw_tx)?;

    tokio::spawn(async move {
        loop {
            let event = match raw_rx.recv().await {
                Ok(event) => event,
                // The watcher outpaced the re-sync. Whatever was dropped is recovered by treating
                // the gap as a full rescan, which is cheaper than reasoning about what was lost.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("Change re-sync lagged by {n} events; forcing a full rescan");
                    ChangeEvent::full_rescan()
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            };

            if let ChangeTarget::Plans { ref folder } = event.target {
                let db_path = state.db_path.clone();
                let plans_dir = state.plans_dir.clone();
                let folder = folder.clone();
                // rusqlite is blocking, and a full rescan parses every plan.yaml on disk.
                let synced = tokio::task::spawn_blocking(move || match folder {
                    Some(name) => sync_one(&db_path, &plans_dir, &name),
                    None => sync_all(&db_path, &plans_dir),
                })
                .await;
                match synced {
                    Ok(Ok(())) => {}
                    // A stale mirror is worth reporting but not worth withholding the event over:
                    // the client's own refetch reads the filesystem-backed routes too.
                    Ok(Err(e)) => tracing::warn!("Change re-sync failed: {}", e),
                    Err(e) => tracing::warn!("Change re-sync task failed: {}", e),
                }
            }

            // Only now is it safe to wake clients.
            let _ = state.change_tx.send(event);
        }
    });

    Ok(watcher)
}

/// Re-syncs one plan folder, or deletes its row if the folder has gone.
fn sync_one(db_path: &Path, plans_dir: &Path, folder_name: &str) -> anyhow::Result<()> {
    let conn = open_database(db_path)?;
    let folder = plans_dir.join(folder_name);

    if !folder.is_dir() {
        if let Some(id) = plan_id_from_folder_name(folder_name) {
            delete_plan(&conn, id)?;
            tracing::debug!("Removed plan {} whose folder disappeared", id);
        }
        return Ok(());
    }

    // Locked: the write that woke us may still be in flight, and parsing a half-written plan.yaml
    // would either fail or (worse) mirror a truncated document.
    match read_plan_file_locked(&folder) {
        Ok(plan) => sync_plan(&conn, &plan)?,
        // A folder mid-creation has no plan.yaml yet. The watcher's catch-up passes come back to it.
        Err(e) => tracing::debug!("Skipping {}: {}", folder.display(), e),
    }

    Ok(())
}

/// Full rescan: mirrors every plan on disk and drops rows whose folder no longer exists.
fn sync_all(db_path: &Path, plans_dir: &Path) -> anyhow::Result<()> {
    let conn = open_database(db_path)?;

    let mut on_disk: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(plans_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() && path.join("plan.yaml").is_file() {
                on_disk.push(path);
            }
        }
    }

    for folder in &on_disk {
        match read_plan_file_locked(folder) {
            Ok(plan) => sync_plan(&conn, &plan)?,
            Err(e) => tracing::debug!("Skipping {}: {}", folder.display(), e),
        }
    }

    // Orphans: a plan folder deleted or renamed outside the daemon leaves a row behind, and a
    // rescan is the only thing that notices. `FolderPath` is the authority, not the id, because a
    // rename keeps the id.
    for row in get_plans(&conn, None, None, None)? {
        if !Path::new(&row.folder_path).is_dir() {
            delete_plan(&conn, row.metadata.id)?;
            tracing::debug!(
                "Removed plan {} ({}): folder no longer exists",
                row.metadata.id,
                row.folder_name
            );
        }
    }

    Ok(())
}

/// `00576-PortFilesystemWatcher` -> `576`. Returns `None` for a folder that is not plan-shaped.
fn plan_id_from_folder_name(folder_name: &str) -> Option<i32> {
    if folder_name.len() < 5 {
        return None;
    }
    folder_name[..5].parse::<i32>().ok()
}
