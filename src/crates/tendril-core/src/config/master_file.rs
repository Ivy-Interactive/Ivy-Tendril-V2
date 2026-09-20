//! Reading, classifying and writing `<home>/.master`.
//!
//! The distinction [`MasterFileKind`] draws is the load-bearing one: a file this build cannot read is
//! not evidence that its owner is dead, so only outright garbage is ever discarded here.

use super::master_info::{default_capabilities, MasterClaim, MasterInfo, MASTER_SCHEMA_VERSION};
// Imported solely so the MasterGuard::acquire doc links below — written when this code and the
// guard shared one file — still resolve.
#[allow(unused_imports)]
use super::master_guard::MasterGuard;
use crate::error::{Result, TendrilError};
use std::path::Path;

/// What is actually sitting at `<home>/.master`, for the two callers that may otherwise be tempted to
/// delete it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MasterFileKind {
    /// No file.
    Missing,
    /// Not a JSON document at all: empty, truncated, or half-written. This is what a racing daemon's
    /// claim looks like for the microseconds between `create_new` and its first write, and it is the
    /// only shape that carries no information about anybody — so it is the only one safe to discard.
    Garbage,
    /// A JSON document this build cannot read as a claim, or one that says it was written to a newer
    /// schema than [`MASTER_SCHEMA_VERSION`]. Somebody's registration, whose owner we cannot identify:
    /// never deleted on a guess.
    Foreign {
        /// The `schemaVersion` it declares, when it declares one.
        schema_version: Option<u32>,
    },
    /// A claim this build understands. Boxed only because it dwarfs the other three variants.
    Claim(Box<MasterClaim>),
}

/// Classifies `<home>/.master` without touching it.
///
/// The distinction that matters is *unparseable* versus *unintelligible*: "not JSON" is a broken write
/// and can be cleared, whereas a JSON document with fields we do not understand is a live claim as far
/// as anyone can prove, and deleting it is the destructive move this exists to refuse.
pub fn inspect_master_file(tendril_home: &Path) -> MasterFileKind {
    let master_file = tendril_home.join(".master");
    let Ok(content) = std::fs::read_to_string(&master_file) else {
        return MasterFileKind::Missing;
    };

    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return MasterFileKind::Garbage;
    };
    if !value.is_object() {
        return MasterFileKind::Garbage;
    }

    let schema_version = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .map(|v| v as u32);
    if schema_version.is_some_and(|v| v > MASTER_SCHEMA_VERSION) {
        return MasterFileKind::Foreign { schema_version };
    }

    match serde_json::from_value::<MasterClaim>(value) {
        Ok(claim) => MasterFileKind::Claim(Box::new(claim)),
        Err(_) => MasterFileKind::Foreign { schema_version },
    }
}

pub fn read_master(tendril_home: &Path) -> Option<MasterInfo> {
    read_master_claim(tendril_home).map(|claim| claim.info)
}

/// [`read_master`] plus the lifecycle fields. `None` when there is no claim or it cannot be parsed.
pub fn read_master_claim(tendril_home: &Path) -> Option<MasterClaim> {
    let master_file = tendril_home.join(".master");
    let content = std::fs::read_to_string(&master_file).ok()?;
    serde_json::from_str(&content).ok()
}

/// [`read_master_claim`], retried briefly.
///
/// [`try_claim_master`] creates the file and then writes it, so a racing daemon can catch it empty.
/// Treating that as "unreadable, discard it" would hand mastership to both of them, which is the
/// whole thing the exclusive create exists to prevent — so an unreadable claim is only believed once
/// it has stayed unreadable.
pub(super) fn read_master_claim_settled(tendril_home: &Path) -> Option<MasterClaim> {
    const ATTEMPTS: u32 = 3;
    const INTERVAL: std::time::Duration = std::time::Duration::from_millis(50);

    for attempt in 0..ATTEMPTS {
        if let Some(claim) = read_master_claim(tendril_home) {
            return Some(claim);
        }
        if !tendril_home.join(".master").exists() {
            return None;
        }
        if attempt + 1 < ATTEMPTS {
            std::thread::sleep(INTERVAL);
        }
    }
    None
}

/// True when this process owns the `.master` file. [`MasterGuard::acquire`] wrote our pid there;
/// anything else — a foreign pid, or no file at all — means we lost the race or were superseded, so
/// we must not write to anything the master owns.
///
/// Checked per pass rather than once at spawn: a daemon can be superseded while running. Being a
/// function of the file rather than of process-wide environment state, it is testable without the
/// cross-thread interference an env-var seam would cause.
pub fn is_master(tendril_home: &Path) -> bool {
    read_master(tendril_home).is_some_and(|m| m.pid == std::process::id())
}

/// Claims `.master` for `claim`, or reports that somebody else already holds it.
///
/// `create_new` is the whole point, and it is why this is not a tmp-file-plus-rename like
/// [`write_master_claim`]: `rename` silently overwrites, so two daemons racing through a
/// read-then-write both "win" and both start the master-only subsystems. `create_new` is one
/// syscall that exactly one racer can win.
///
/// `Ok(false)` means the file already existed — the caller decides whether that claim is live (leave
/// it alone) or stale (clear it and retry). `Err` is a real filesystem failure.
pub fn try_claim_master(tendril_home: &Path, claim: &MasterClaim) -> Result<bool> {
    use std::io::Write;

    // `ensure_home_directories` normally got here first, but a daemon must not fail to claim just
    // because it did not.
    std::fs::create_dir_all(tendril_home)?;

    let master_file = tendril_home.join(".master");
    let json = serde_json::to_string_pretty(claim)?;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = match options.open(&master_file) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return Ok(false),
        Err(e) => return Err(TendrilError::Io(e)),
    };

    // A claim that could not be written is worse than no claim: it would read as a foreign,
    // unparseable one and block every later attempt until something cleaned it up.
    if let Err(e) = file.write_all(json.as_bytes()).and_then(|_| file.flush()) {
        drop(file);
        let _ = std::fs::remove_file(&master_file);
        return Err(TendrilError::Io(e));
    }

    Ok(true)
}

/// Overwrites `.master` with `claim`, atomically from a reader's point of view.
///
/// Only for a process that has already won the claim (republishing its bound port, or re-asserting a
/// claim that vanished). Use [`try_claim_master`] to take it in the first place.
pub fn write_master_claim(tendril_home: &Path, claim: &MasterClaim) -> Result<()> {
    write_master_document(
        tendril_home,
        claim.info.pid,
        &serde_json::to_string_pretty(claim)?,
    )
}

pub fn write_master_info(tendril_home: &Path, info: &MasterInfo) -> Result<()> {
    write_master_document(tendril_home, info.pid, &serde_json::to_string_pretty(info)?)
}

fn write_master_document(tendril_home: &Path, pid: u32, json: &str) -> Result<()> {
    let tmp_file = tendril_home.join(format!(".master.tmp.{}", pid));
    let master_file = tendril_home.join(".master");

    if let Err(e) = std::fs::write(&tmp_file, json) {
        let _ = std::fs::remove_file(&tmp_file);
        return Err(TendrilError::Io(e));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        if let Err(e) = std::fs::set_permissions(&tmp_file, perms) {
            let _ = std::fs::remove_file(&tmp_file);
            return Err(TendrilError::Io(e));
        }
    }

    if let Err(e) = std::fs::rename(&tmp_file, &master_file) {
        let _ = std::fs::remove_file(&tmp_file);
        return Err(TendrilError::Io(e));
    }

    Ok(())
}

pub fn write_master(
    tendril_home: &Path,
    port: u16,
    secret: &str,
    host: &str,
    scheme: &str,
) -> Result<()> {
    let info = MasterInfo {
        port,
        pid: std::process::id(),
        secret: secret.to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        host: host.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
        scheme: scheme.to_string(),
    };
    write_master_info(tendril_home, &info)
}

pub fn delete_master(tendril_home: &Path) {
    let master_file = tendril_home.join(".master");
    if master_file.exists() {
        let _ = std::fs::remove_file(master_file);
    }
}

/// Removes `.master` only if it still names `pid`, and only if that pid is not the live owner.
///
/// The pid re-check is what keeps a stale-cleanup from deleting a *third* process's claim: between
/// deciding "this one is stale" and acting on it, the rightful owner may already have replaced it.
/// Returns true when a file was removed.
///
/// A file this build cannot read is **not** removed. It used to be, on the grounds that nothing can be
/// learned from it — but "I cannot read this" is not "the daemon that wrote it is dead", and acting on
/// that confusion is precisely how a foreign CLI takes a live daemon off the air. Clearing one is a
/// deliberate act, and [`MasterGuard::acquire`] is where that decision is made and explained.
pub fn delete_master_if_pid(tendril_home: &Path, pid: u32) -> bool {
    match read_master_claim(tendril_home) {
        Some(claim) if claim.info.pid == pid => {
            let master_file = tendril_home.join(".master");
            std::fs::remove_file(master_file).is_ok()
        }
        None if tendril_home.join(".master").exists() => {
            tracing::warn!(
                "Leaving {}/.master alone: it no longer reads as a claim this build understands, \
                 which is not evidence that its owner is gone",
                tendril_home.display()
            );
            false
        }
        _ => false,
    }
}
