use std::time::Duration;

/// Terminates `pid` and every process it spawned.
///
/// Agents shell out freely, so killing only the direct child leaves grandchildren running: still
/// writing to the log, still spending tokens. On unix the agent is spawned into its own process
/// group (see `agents::runner`), so signalling the negated PID reaches the whole tree.
///
/// Blocking: the grace period is a real sleep. Call it from `spawn_blocking` on an async path.
#[cfg(unix)]
pub fn kill_tree(pid: u32, grace: Duration) {
    use std::time::Instant;

    if pid == 0 {
        return;
    }

    let group = -(pid as i32);
    signal(group, pid, libc::SIGTERM);

    let deadline = Instant::now() + grace;
    while Instant::now() < deadline {
        if !crate::config::is_process_running(pid) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    signal(group, pid, libc::SIGKILL);
}

#[cfg(unix)]
fn signal(group: i32, pid: u32, sig: libc::c_int) {
    // Prefer the group so grandchildren are included; fall back to the process itself when the
    // child was never placed in its own group (ESRCH on the group).
    let sent = unsafe { libc::kill(group, sig) };
    if sent != 0 {
        unsafe {
            libc::kill(pid as libc::pid_t, sig);
        }
    }
}

#[cfg(windows)]
pub fn kill_tree(pid: u32, _grace: Duration) {
    if pid == 0 {
        return;
    }

    let output = std::process::Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .output();

    if let Err(e) = output {
        tracing::warn!("taskkill failed for pid {}: {}", pid, e);
    }
}

#[cfg(not(any(unix, windows)))]
pub fn kill_tree(pid: u32, _grace: Duration) {
    tracing::warn!(
        "kill_tree is not implemented on this platform; pid {} left running",
        pid
    );
}

/// The default grace period between `SIGTERM` and `SIGKILL`.
pub const DEFAULT_KILL_GRACE: Duration = Duration::from_secs(3);
