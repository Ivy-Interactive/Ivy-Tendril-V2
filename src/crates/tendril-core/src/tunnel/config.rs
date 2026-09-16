//! Port of `Services/Tunnel/TunnelConfig.cs`, read out of `config.yaml`'s `shareTunnel:` block.
//!
//! The block is read from [`TendrilSettings::extra`] rather than being added as a typed section,
//! because the typed sections are owned elsewhere and an unknown key already round-trips through
//! `extra` unharmed. A malformed block is ignored rather than fatal: a typo in an optional tuning
//! knob must not stop a share from starting.
//!
//! `enabled` is parsed for round-trip fidelity with the original's file format but is **never acted
//! on** — see the module docs on [`crate::tunnel`] for why a share is not auto-started.

use crate::config::TendrilSettings;
use serde::{Deserialize, Serialize};

/// The key `shareTunnel` lives under in `config.yaml`.
pub const SHARE_TUNNEL_KEY: &str = "shareTunnel";

fn default_port() -> u16 {
    5010
}

fn default_max_restarts() -> u32 {
    10
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TunnelConfig {
    /// Present for format compatibility with the original. Read, reported, and not obeyed.
    #[serde(default)]
    pub enabled: bool,

    #[serde(default = "default_port")]
    pub port: u16,

    /// An explicit `cloudflared` to use instead of searching. Empty means "search".
    #[serde(rename = "binaryPath", alias = "binary_path", default)]
    pub binary_path: String,

    /// How many consecutive failed sessions before the supervisor gives up.
    #[serde(
        rename = "maxRestarts",
        alias = "max_restarts",
        default = "default_max_restarts"
    )]
    pub max_restarts: u32,
}

impl Default for TunnelConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: default_port(),
            binary_path: String::new(),
            max_restarts: default_max_restarts(),
        }
    }
}

impl TunnelConfig {
    /// Reads `shareTunnel:` out of settings. Absent, null or unparseable all yield the defaults.
    pub fn from_settings(settings: &TendrilSettings) -> Self {
        let Some(value) = settings.extra.get(SHARE_TUNNEL_KEY) else {
            return Self::default();
        };
        match serde_json::from_value::<Self>(value.clone()) {
            Ok(config) => config,
            Err(err) => {
                tracing::warn!(
                    "Ignoring malformed `{SHARE_TUNNEL_KEY}` block in config.yaml: {err}"
                );
                Self::default()
            }
        }
    }

    /// `binaryPath` as an actual override, or `None` when it is blank.
    pub fn binary_override(&self) -> Option<&str> {
        let trimmed = self.binary_path.trim();
        (!trimmed.is_empty()).then_some(trimmed)
    }

    /// At least one attempt, whatever the file says. The original coerces `0` to `10`; coercing to
    /// `1` instead keeps an explicit "don't retry" meaningful while still never being zero.
    pub fn effective_max_restarts(&self) -> u32 {
        self.max_restarts.max(1)
    }
}

/// Port of `ShareTunnelService.SharePort`: a configured share port wins unless it collides with the
/// daemon's own, in which case the next port up is used.
///
/// Kept because it is part of the original's public surface, but note that the original then ignores
/// it — `SupervisorLoopAsync` publishes the *server's* bound address, not this port. V2 does the same
/// (see [`crate::tunnel::service::ShareTunnelService`]), so this is reported by the status route for
/// parity and is not what gets tunnelled.
pub fn share_port(daemon_port: u16, configured: u16) -> u16 {
    if configured > 0 && configured != daemon_port {
        configured
    } else {
        daemon_port.saturating_add(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_from(yaml: &str) -> TendrilSettings {
        serde_yaml::from_str(yaml).expect("settings parse")
    }

    #[test]
    fn an_absent_block_is_the_default() {
        let config = TunnelConfig::from_settings(&settings_from("codingAgent: claude\n"));
        assert_eq!(config, TunnelConfig::default());
        assert!(!config.enabled);
        assert_eq!(config.max_restarts, 10);
        assert!(config.binary_override().is_none());
    }

    #[test]
    fn reads_the_original_file_shape() {
        let config = TunnelConfig::from_settings(&settings_from(
            "shareTunnel:\n  enabled: true\n  port: 5011\n  binaryPath: /opt/cloudflared\n  maxRestarts: 3\n",
        ));
        assert!(
            config.enabled,
            "the key is read even though it is not obeyed"
        );
        assert_eq!(config.port, 5011);
        assert_eq!(config.binary_override(), Some("/opt/cloudflared"));
        assert_eq!(config.effective_max_restarts(), 3);
    }

    #[test]
    fn a_malformed_block_falls_back_instead_of_failing() {
        let config = TunnelConfig::from_settings(&settings_from("shareTunnel: \"yes please\"\n"));
        assert_eq!(config, TunnelConfig::default());
    }

    #[test]
    fn a_blank_binary_path_is_not_an_override() {
        let config =
            TunnelConfig::from_settings(&settings_from("shareTunnel:\n  binaryPath: '   '\n"));
        assert!(config.binary_override().is_none());
    }

    #[test]
    fn max_restarts_is_never_zero() {
        let config =
            TunnelConfig::from_settings(&settings_from("shareTunnel:\n  maxRestarts: 0\n"));
        assert_eq!(config.effective_max_restarts(), 1);
    }

    #[test]
    fn share_port_avoids_the_daemons_own_port() {
        assert_eq!(share_port(5010, 0), 5011, "unset falls to the next port up");
        assert_eq!(
            share_port(5010, 5010),
            5011,
            "a collision falls to the next port up"
        );
        assert_eq!(
            share_port(5010, 7000),
            7000,
            "a distinct configured port wins"
        );
    }
}
