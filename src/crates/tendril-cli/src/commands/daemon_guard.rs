use std::path::Path;
use tendril_core::config::{probe_health, read_master, MasterInfo};

/// Returns the master daemon's info when one is recorded *and* reachable. A stale `.master` file
/// left behind by a crashed daemon does not count.
pub fn running_daemon(tendril_home: &Path) -> Option<MasterInfo> {
    let master = read_master(tendril_home)?;
    if probe_health(&master.host, master.port) {
        Some(master)
    } else {
        None
    }
}

/// Prints a refusal and returns `true` when a reachable daemon must stop the caller. `force`
/// overrides the guard. `action` is the gerund used in the message, e.g. `"resetting"`.
///
/// Not in the original implementation: it exists because V2's daemon holds an open SQLite handle on
/// `<home>/tendril.db`, so deleting or rewriting the database underneath it corrupts that handle.
/// The guard only ever narrows what these commands will do.
pub fn refuse_if_daemon_running(tendril_home: &Path, force: bool, action: &str) -> bool {
    if force {
        return false;
    }

    match running_daemon(tendril_home) {
        Some(master) => {
            println!(
                "A Tendril daemon is running on port {} (pid {}). Stop it before {}.",
                master.port, master.pid, action
            );
            println!("Re-run with --force to proceed anyway.");
            true
        }
        None => false,
    }
}
