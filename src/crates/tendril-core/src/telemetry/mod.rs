//! Anonymous, strictly opt-in usage telemetry.
//!
//! Gated by the `telemetry` key in `config.yaml`, read in exactly one place
//! ([`crate::config::TendrilSettings::telemetry_enabled`]). Absent or `false` means no client is
//! constructed and no network call is ever attempted; only an explicit `telemetry: true` enables it.
//! This is a deliberate divergence from the original app, which is opt-out — see `docs/TELEMETRY.md`.
//!
//! What may and may not be sent is a policy, not a convention: see `docs/TELEMETRY.md` for the
//! classification rules, and [`events`] for the typed contexts that encode them.

pub mod client;
pub mod events;

pub use client::*;
pub use events::*;
