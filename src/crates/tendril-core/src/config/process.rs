//! Liveness primitives the mastership election is built on: is a pid running, does a daemon answer
//! `/api/ping`, and the per-process start token that makes a recycled pid detectable.

#[cfg(unix)]
pub fn is_process_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let res = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if res == 0 {
        true
    } else {
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

#[cfg(windows)]
pub fn is_process_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    use std::process::Command;
    let output = Command::new("cmd")
        .args(["/C", &format!("tasklist /FI \"PID eq {}\" /NH", pid)])
        .output();
    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        text.contains(&pid.to_string())
    } else {
        false
    }
}

#[cfg(not(any(unix, windows)))]
pub fn is_process_running(_pid: u32) -> bool {
    true
}

pub fn probe_health(host: &str, port: u16) -> bool {
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let host_norm = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    let addr_str = format!("{}:{}", host_norm, port);
    let addrs: Vec<_> = match addr_str.to_socket_addrs() {
        Ok(iter) => iter.collect(),
        Err(_) => return false,
    };

    for addr in addrs {
        if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));
            let req = format!(
                "GET /api/ping HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
                addr
            );
            if stream.write_all(req.as_bytes()).is_ok() {
                let mut buf = [0u8; 1024];
                if let Ok(n) = stream.read(&mut buf) {
                    let resp = String::from_utf8_lossy(&buf[..n]);
                    if resp.contains("200 OK") || resp.contains("pong") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// A per-process token that changes when a pid is recycled: the kernel's recorded start time.
///
/// Read through `ps` rather than a crate so this needs no new dependency, and only ever compared
/// against a token produced the same way on the same machine — the format is irrelevant as long as
/// it is stable for the life of a process. `None` on any failure, which callers must read as
/// "cannot tell" rather than "not running": `kill_tree` signals a whole process group, so a
/// wrongly-negative liveness answer is not harmless.
#[cfg(unix)]
pub fn process_start_token(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    let output = std::process::Command::new("ps")
        .args(["-o", "lstart=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// Windows has no cheap equivalent of `ps -o lstart=` (`tasklist`, which [`is_process_running`]
/// uses, does not report a start time), so the PID-reuse guard is a no-op there and mastership falls
/// back to the plain pid check.
#[cfg(not(unix))]
pub fn process_start_token(_pid: u32) -> Option<String> {
    None
}

/// Number of `/api/ping` attempts before a running master is declared unresponsive.
pub const HEALTH_PROBE_ATTEMPTS: u32 = 3;
const HEALTH_PROBE_INTERVAL: std::time::Duration = std::time::Duration::from_millis(300);

/// Probes `/api/ping` repeatedly, so one dropped probe on a loaded machine cannot decide mastership.
pub fn probe_health_with_retries(host: &str, port: u16, attempts: u32) -> bool {
    for attempt in 0..attempts.max(1) {
        if probe_health(host, port) {
            return true;
        }
        if attempt + 1 < attempts {
            std::thread::sleep(HEALTH_PROBE_INTERVAL);
        }
    }
    false
}
