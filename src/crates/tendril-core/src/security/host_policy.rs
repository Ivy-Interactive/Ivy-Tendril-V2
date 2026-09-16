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

    // The share tunnel's own hostname, from `IsAllowedHost`'s "Active tunnel host" branch. Keeping
    // this a parameter is what lets tunnelled access work without anybody having to widen
    // `security.allowedHosts` by hand.
    //
    // The original guards this branch with `_tunnelService.IsConnected` — a host that *would* be the
    // tunnel's is not allowed unless a tunnel is actually up. The equivalent here is that the caller
    // passes `None` when there is no active share: see
    // [`tendril_core::tunnel::share_state::active_host`], which only ever reports a recorded, live
    // share. A stale or absent record therefore allows nothing.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_is_always_allowed() {
        for host in [
            "localhost",
            "LOCALHOST",
            "127.0.0.1",
            "127.1.2.3",
            "::1",
            "[::1]",
        ] {
            assert!(is_allowed_host(host, None, None), "{host}");
        }
    }

    #[test]
    fn private_ranges_and_mdns_names_are_allowed() {
        for host in [
            "10.0.0.1",
            "172.16.5.5",
            "172.31.0.1",
            "192.168.1.20",
            "mymac.local",
            "MyMac.LOCAL",
        ] {
            assert!(is_allowed_host(host, None, None), "{host}");
        }
        for host in [
            "172.15.0.1",
            "172.32.0.1",
            "192.169.0.1",
            "11.0.0.1",
            "8.8.8.8",
        ] {
            assert!(!is_allowed_host(host, None, None), "{host} is not private");
        }
    }

    #[test]
    fn an_empty_or_public_host_is_refused() {
        assert!(!is_allowed_host("", None, None));
        assert!(!is_allowed_host("   ", None, None));
        assert!(!is_allowed_host("evil.example.com", None, None));
    }

    /// The share-tunnel branch: this is what makes a shared plan's images load for the visitor.
    #[test]
    fn the_active_tunnel_host_is_allowed_and_only_that_host() {
        let tunnel = Some("calm-otter.trycloudflare.com");
        assert!(is_allowed_host(
            "calm-otter.trycloudflare.com",
            None,
            tunnel
        ));
        assert!(
            is_allowed_host("CALM-OTTER.trycloudflare.com", None, tunnel),
            "the original compares case-insensitively"
        );
        assert!(
            !is_allowed_host("other-otter.trycloudflare.com", None, tunnel),
            "a different quick tunnel is a different origin"
        );
        assert!(
            !is_allowed_host("calm-otter.trycloudflare.com.attacker.test", None, tunnel),
            "a suffix match would allow an attacker-controlled name"
        );
    }

    /// With no share running there is no tunnel host, so the same request that would be served during a
    /// share is refused — the port of the original's `IsConnected` guard.
    #[test]
    fn with_no_active_share_the_tunnel_host_is_refused() {
        assert!(!is_allowed_host("calm-otter.trycloudflare.com", None, None));
        assert!(!is_allowed_host(
            "calm-otter.trycloudflare.com",
            None,
            Some("")
        ));
    }

    #[test]
    fn configured_allowed_hosts_are_honoured_case_insensitively() {
        let allowed = vec!["tendril.example.com".to_string()];
        assert!(is_allowed_host("TENDRIL.example.com", Some(&allowed), None));
        assert!(!is_allowed_host("other.example.com", Some(&allowed), None));
    }

    #[test]
    fn strip_port_leaves_ipv6_literals_intact() {
        assert_eq!(strip_port("localhost:5010"), "localhost");
        assert_eq!(strip_port("127.0.0.1:5010"), "127.0.0.1");
        assert_eq!(strip_port("[::1]:5010"), "[::1]");
        assert_eq!(strip_port("[::1]"), "[::1]");
        assert_eq!(
            strip_port("::1"),
            "::1",
            "a bare IPv6 literal has no port to strip"
        );
        assert_eq!(
            strip_port("calm-otter.trycloudflare.com"),
            "calm-otter.trycloudflare.com"
        );
    }
}
