//! Which `Host` values `GET /ivy/local-file` may be reached on — a port of
//! `LocalFileGuardMiddleware.IsAllowedHost`.
//!
//! This is deliberately *not* a global `Host` check in front of the whole router. The original's
//! allowlist has exactly one caller, the local-file guard, and widening it to every route would
//! start returning 403 for container DNS names and public hostnames on installs that work today —
//! a lockout risk with no matching gain for a loopback-bound daemon.

use std::net::Ipv4Addr;

/// Whether `host` (a `Host` header with any `:port` already stripped) may reach the local-file
/// endpoint. Checked in the original's order: loopback, the active tunnel host, private IPv4,
/// `*.local`, then `security.allowedHosts`.
pub fn is_allowed_host(host: &str, allowed: Option<&[String]>, tunnel_host: Option<&str>) -> bool {
    let host = host.trim();
    if host.is_empty() {
        return false;
    }

    if is_loopback(host) {
        return true;
    }

    // The share tunnel's own hostname. Keeping this a parameter is what lets tunnelled access work
    // without anybody having to widen `security.allowedHosts` by hand.
    if let Some(tunnel) = tunnel_host {
        if !tunnel.is_empty() && tunnel.eq_ignore_ascii_case(host) {
            return true;
        }
    }

    if is_private_ipv4(host) {
        return true;
    }

    if host.to_ascii_lowercase().ends_with(".local") {
        return true;
    }

    allowed.is_some_and(|hosts| hosts.iter().any(|entry| entry.eq_ignore_ascii_case(host)))
}

fn is_loopback(host: &str) -> bool {
    let lower = host.to_ascii_lowercase();
    lower == "localhost"
        || lower == "127.0.0.1"
        || lower == "::1"
        || lower == "[::1]"
        || lower.starts_with("127.")
        || lower.starts_with("[::1")
}

/// `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
fn is_private_ipv4(host: &str) -> bool {
    let Ok(ip) = host.parse::<Ipv4Addr>() else {
        return false;
    };
    let [a, b, ..] = ip.octets();
    a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
}

/// Strips a `:port` suffix from a `Host` header, leaving a bracketed IPv6 literal intact.
pub fn strip_port(host: &str) -> &str {
    let host = host.trim();
    if host.starts_with('[') {
        // `[::1]:5010` -> `[::1]`
        return match host.find(']') {
            Some(end) => &host[..=end],
            None => host,
        };
    }

    // Only a single colon is a port separator; a bare IPv6 literal has several and no port.
    match (host.find(':'), host.rfind(':')) {
        (Some(first), Some(last)) if first == last => &host[..first],
        _ => host,
    }
}
