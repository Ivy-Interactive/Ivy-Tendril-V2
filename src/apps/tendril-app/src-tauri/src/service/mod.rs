pub mod agent_terminal_bridge;
pub mod changes_bridge;
pub mod client;
pub mod compatibility;
pub mod job_events_bridge;
pub mod master;
pub mod plan_mapping;
pub mod provision;
pub mod review_action_bridge;
pub mod supervisor;
pub mod tunnel_client;
pub mod ws_bridge;

pub use changes_bridge::ChangeBridge;
pub use client::TendrilClient;
pub use compatibility::{SemVer, ServiceCompatibilityManager, VersionCheckResult};
pub use master::MasterDiscovery;
pub use plan_mapping::{map_plan_detail, map_plan_summary};
// The platform layer moved to `tendril-core` so `tendril service install` and the app write the
// same unit; re-exported here under its old path because the app's callers and tests name it.
pub use provision::{provision, AutostartOutcome, ProvisionReport};
pub use supervisor::{
    calculate_backoff_secs, redact_sensitive_tokens, CircuitBreaker, ServiceOwnership,
    ServiceSupervisor, SupervisorStateInfo, SupervisorStatus,
};
pub use tendril_core::service::platform;
pub use tendril_core::service::PlatformServiceConfig;
pub use tunnel_client::{CloudflaredInstallDto, TunnelClient, TunnelSnapshotDto};
pub use ws_bridge::WsBridge;
