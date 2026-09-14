//! The one place a client for the local daemon is built.
//!
//! `reqwest::Client::new()` sets neither a request timeout nor a read timeout, so a CLI built on it
//! hangs forever against a wedged daemon instead of failing. Every CLI and MCP call to the daemon
//! goes through [`daemon_client`] so there is a single, configurable bound on how long that wait can
//! be — and a single place to classify what a transport failure actually means, because "the daemon
//! never answered" and "the daemon is not running" call for opposite responses from the caller.

use crate::config::{get_config_path, load_config, read_master, MasterInfo, TendrilSettings};
use std::path::Path;
use std::time::Duration;

/// Seconds the CLI and the MCP layer wait for the local daemon before giving up. Every daemon
/// endpoint these clients call returns promptly by design — job start enqueues and replies, chat
/// execute only starts the turn and streams over a separate WebSocket — so this bounds a hang, not
/// legitimate work.
pub const DEFAULT_DAEMON_REQUEST_TIMEOUT_SECS: u64 = 30;

/// The advice half of a timeout message, kept as a const so a test can assert on it without
/// duplicating the wording. Paired with [`describe_transport_error`].
pub const DAEMON_TIMEOUT_HINT: &str = "The daemon is running but busy — the request may already \
                                       have been applied. Check 'tendril job list' before retrying.";

/// The configured wait, or `None` when the operator disabled the timeout (`daemonRequestTimeout
/// <= 0`), mirroring `job_timeout_duration` in `jobs/manager.rs`.
pub fn daemon_request_timeout(settings: &TendrilSettings) -> Option<Duration> {
    if settings.daemon_request_timeout > 0 {
        Some(Duration::from_secs(settings.daemon_request_timeout as u64))
    } else {
        None
    }
}

/// The configured wait for `tendril_home`. A missing or unreadable config falls back to the
/// default rather than to no timeout — an unparseable config is not consent to hang forever.
pub fn daemon_request_timeout_for(tendril_home: &Path) -> Option<Duration> {
    match load_config(&get_config_path(tendril_home)) {
        Ok(settings) => daemon_request_timeout(&settings),
        Err(e) => {
            tracing::debug!(
                "Could not read daemonRequestTimeout from config, using the {}s default: {}",
                DEFAULT_DAEMON_REQUEST_TIMEOUT_SECS,
                e
            );
            Some(Duration::from_secs(DEFAULT_DAEMON_REQUEST_TIMEOUT_SECS))
        }
    }
}

/// The client every daemon call must use.
///
/// Reads `.master` for the scheme too: when the daemon is serving TLS with the self-signed pair
/// `tendril generate-certs` writes, no certificate store will vouch for it, so a client built
/// without knowing that would fail every request against an https daemon.
pub fn daemon_client(tendril_home: &Path) -> reqwest::Client {
    let timeout = daemon_request_timeout_for(tendril_home);
    match read_master(tendril_home) {
        Some(master) => daemon_client_with_timeout_and_master(timeout, &master),
        None => daemon_client_with_timeout(timeout),
    }
}

/// Explicit-timeout form, for tests and for the shortened reconciliation budget.
pub fn daemon_client_with_timeout(timeout: Option<Duration>) -> reqwest::Client {
    build_daemon_client(timeout, false)
}

/// Explicit-timeout form for a known master, so the certificate check can be relaxed for a
/// loopback https daemon without every caller re-deriving that condition.
pub fn daemon_client_with_timeout_and_master(
    timeout: Option<Duration>,
    master: &MasterInfo,
) -> reqwest::Client {
    build_daemon_client(timeout, accepts_self_signed(master))
}

fn build_daemon_client(timeout: Option<Duration>, accept_invalid_certs: bool) -> reqwest::Client {
    let mut builder = reqwest::Client::builder().danger_accept_invalid_certs(accept_invalid_certs);
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    match builder.build() {
        Ok(client) => client,
        // Unreachable in practice — this builder has no fallible options set. Losing the timeout is
        // still better than losing the ability to talk to the daemon at all, so it is a warning
        // rather than a panic.
        Err(e) => {
            tracing::warn!(
                "Could not build the daemon HTTP client with a timeout, falling back to an \
                 untimed client: {}",
                e
            );
            reqwest::Client::new()
        }
    }
}

/// Whether the daemon described by `master` is one whose certificate cannot be verified but also
/// cannot be forged: TLS on a loopback address. A remote or non-loopback daemon is verified
/// normally — relaxing it there would accept any certificate at all from anyone able to answer on
/// that address.
pub fn accepts_self_signed(master: &MasterInfo) -> bool {
    let is_loopback = matches!(master.host.as_str(), "127.0.0.1" | "::1" | "localhost");
    master.scheme.eq_ignore_ascii_case("https") && is_loopback
}

/// Why a daemon call failed at the transport level. The distinction matters because only
/// [`Unreachable`](DaemonTransportFailure::Unreachable) proves the request was never received.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DaemonTransportFailure {
    /// The daemon accepted the connection but did not answer inside the budget. The request may
    /// already have been applied.
    Timeout,
    /// The connection never established, so the daemon never saw the request.
    Unreachable,
    /// Anything else — a body that failed mid-read, a decode error. Ambiguous, like `Timeout`.
    Other,
}

/// Classifies a `reqwest` transport error.
///
/// Order matters: reqwest sets `is_connect()` *and* `is_timeout()` on a connect timeout, so
/// `is_timeout()` is tested first. A connect timeout against a daemon that is listening but not
/// accepting is ambiguous in exactly the way a read timeout is, and must not be filed as
/// `Unreachable`.
pub fn classify_transport_error(err: &reqwest::Error) -> DaemonTransportFailure {
    if err.is_timeout() {
        DaemonTransportFailure::Timeout
    } else if err.is_connect() {
        DaemonTransportFailure::Unreachable
    } else {
        DaemonTransportFailure::Other
    }
}

/// An accurate one-line message for a transport failure, naming host and port.
///
/// `timeout` is the budget the failed client was built with; it is only used to name the number of
/// seconds in the `Timeout` message, and may be `None` when the caller does not know it.
pub fn describe_transport_error(
    err: &reqwest::Error,
    master: &MasterInfo,
    timeout: Option<Duration>,
) -> String {
    match classify_transport_error(err) {
        DaemonTransportFailure::Unreachable => {
            format!("{}: {}", crate::mcp::dispatch::DAEMON_OFFLINE_MESSAGE, err)
        }
        DaemonTransportFailure::Timeout => {
            let budget = match timeout {
                Some(t) => format!("within {}s", t.as_secs()),
                None => "in time".to_string(),
            };
            format!(
                "Tendril daemon at {}:{} did not respond {}. {}",
                master.host, master.port, budget, DAEMON_TIMEOUT_HINT
            )
        }
        DaemonTransportFailure::Other => format!(
            "Request to Tendril daemon at {}:{} failed: {}",
            master.host, master.port, err
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn master(scheme: &str, host: &str) -> MasterInfo {
        MasterInfo {
            port: 5010,
            pid: 1,
            secret: "s".to_string(),
            started_at: String::new(),
            host: host.to_string(),
            version: "0.1.0".to_string(),
            api_version: 1,
            capabilities: Vec::new(),
            scheme: scheme.to_string(),
        }
    }

    #[test]
    fn certificate_verification_is_relaxed_only_for_a_loopback_https_daemon() {
        for host in ["127.0.0.1", "::1", "localhost"] {
            assert!(
                accepts_self_signed(&master("https", host)),
                "{host} is this machine, and generate-certs writes a self-signed pair"
            );
            assert!(
                !accepts_self_signed(&master("http", host)),
                "there is no certificate to accept over plaintext"
            );
        }
        for host in ["tendril.example.com", "10.0.0.5", "0.0.0.0"] {
            assert!(
                !accepts_self_signed(&master("https", host)),
                "{host} is reached over a network and must be verified"
            );
        }
    }

    /// Construction only — building a client opens no connection, and nothing here makes a request.
    #[test]
    fn a_client_is_built_for_every_scheme_and_host() {
        for (scheme, host) in [
            ("http", "127.0.0.1"),
            ("https", "127.0.0.1"),
            ("https", "tendril.example.com"),
        ] {
            let _ = daemon_client_with_timeout_and_master(None, &master(scheme, host));
        }
    }
}
