//! Port of `Services/Tunnel/TunnelStatus.cs`.

use serde::{Deserialize, Serialize};

/// The three states a share tunnel can be in. There is deliberately no `Error` state: a failure
/// leaves the tunnel `Connecting` while the supervisor retries, and only a give-up drops it back to
/// `Disabled` — with [`crate::tunnel::TunnelSnapshot::error`] carrying the reason. That is the
/// original's shape, and it is what stops a transient DNS failure from looking terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TunnelStatus {
    /// Not running.
    Disabled,
    /// The process is starting, or a URL exists but nothing routes to it yet.
    Connecting,
    /// Established and verified routable.
    Connected,
}

impl TunnelStatus {
    pub fn is_connected(self) -> bool {
        matches!(self, TunnelStatus::Connected)
    }

    /// The wire spelling, also used in log lines.
    pub fn as_str(self) -> &'static str {
        match self {
            TunnelStatus::Disabled => "disabled",
            TunnelStatus::Connecting => "connecting",
            TunnelStatus::Connected => "connected",
        }
    }
}

impl std::fmt::Display for TunnelStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Which of the original's two tunnels a [`crate::tunnel::TunnelService`] is running.
///
/// V1 ships these as two near-identical classes — `ShareTunnelService` and `CloudflaredService` — and
/// `TunnelSetupView` renders a block for each. They are one service here with this discriminator,
/// because the supervisor, the backoff, the health probe and the binary resolution are genuinely the
/// same and only three things differ: what the record on disk grants, whether a credential is required
/// before starting, and how loud the log line is.
///
/// The difference is not cosmetic. See [`Self::Share`] and [`Self::FullAccess`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TunnelKind {
    /// Deny-by-default. Mints a capability token bound to the tunnel host and to
    /// [`crate::share::policy::share_token_allows`] — reads on one plan's surfaces plus comments, no
    /// writes beyond those, and the daemon's unauthenticated surface refused outright. Safe to hand to
    /// somebody who is not the operator, which is the whole point of it.
    Share,
    /// Publishes the *whole* authenticated daemon. Grants nothing on its own: there is no token, and
    /// every route still needs the bearer secret (which lives in `.master`, on the daemon's machine) or
    /// a session token from `/api/auth/login`. A password is therefore both the safety rail and the only
    /// way to use it remotely, which is why
    /// [`crate::tunnel::TunnelService::start`] refuses to start one without a password configured.
    FullAccess,
}

impl TunnelKind {
    /// The wire spelling, also used in log lines and as the registry key's discriminator.
    pub fn as_str(self) -> &'static str {
        match self {
            TunnelKind::Share => "share",
            TunnelKind::FullAccess => "fullAccess",
        }
    }

    /// Human-facing name, for the one place an error message has to say which tunnel it means.
    pub fn label(self) -> &'static str {
        match self {
            TunnelKind::Share => "share tunnel",
            TunnelKind::FullAccess => "full-access tunnel",
        }
    }
}

impl std::fmt::Display for TunnelKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_lowercase_so_the_wire_shape_is_stable() {
        assert_eq!(
            serde_json::to_string(&TunnelStatus::Connecting).unwrap(),
            "\"connecting\""
        );
        assert_eq!(
            serde_json::from_str::<TunnelStatus>("\"connected\"").unwrap(),
            TunnelStatus::Connected
        );
    }

    #[test]
    fn only_connected_counts_as_connected() {
        assert!(TunnelStatus::Connected.is_connected());
        assert!(!TunnelStatus::Connecting.is_connected());
        assert!(!TunnelStatus::Disabled.is_connected());
    }

    #[test]
    fn the_kind_has_a_stable_wire_spelling() {
        assert_eq!(
            serde_json::to_string(&TunnelKind::FullAccess).unwrap(),
            "\"fullAccess\""
        );
        assert_eq!(
            serde_json::to_string(&TunnelKind::Share).unwrap(),
            "\"share\""
        );
        assert_eq!(
            serde_json::from_str::<TunnelKind>("\"share\"").unwrap(),
            TunnelKind::Share
        );
        assert_eq!(TunnelKind::FullAccess.label(), "full-access tunnel");
    }
}
