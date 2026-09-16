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
}
