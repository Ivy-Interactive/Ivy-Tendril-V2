pub mod agents;
pub mod attachments;
pub mod chat;
pub mod config;
pub mod dashboard;
pub mod github;
pub mod inbox;
pub mod jobs;
pub mod local_file;
pub mod plans;
pub mod promptwares;
pub mod pull_requests;
pub mod state;
pub mod tables;
pub mod tunnel;
pub mod vault;

use crate::daemon::{discover_daemon_status, resolve_tendril_home, DaemonStatusResponse};
use crate::error::BridgeError;
use crate::models::{ServiceHealthDto, ServiceInfoDto};
use crate::service::{MasterDiscovery, TendrilClient};

/// Build an authenticated client from the daemon's `.master` file.
///
/// The bearer secret is read here, on the native side, and stays inside the
/// `TendrilClient`. It is never returned to the webview.
pub fn get_client_from_master() -> Result<TendrilClient, BridgeError> {
    let discovery = MasterDiscovery::new();
    let master = discovery.read_master().map_err(|e| {
        BridgeError::with_details(
            "DISCONNECTED",
            "Tendril service is not running: daemon metadata (.master) not found",
            e,
        )
    })?;
    let base_url = format!("{}://{}:{}", master.scheme, master.host, master.port);
    Ok(TendrilClient::new(base_url, Some(master.secret)))
}

#[tauri::command]
pub async fn cmd_check_service_health() -> Result<ServiceHealthDto, BridgeError> {
    let discovery = MasterDiscovery::new();
    discovery
        .check_service_health()
        .await
        .map_err(BridgeError::disconnected)
}

#[tauri::command]
pub async fn cmd_get_service_info() -> Result<ServiceInfoDto, BridgeError> {
    let discovery = MasterDiscovery::new();
    Ok(discovery.get_service_info().await)
}

#[tauri::command]
pub async fn get_daemon_status() -> Result<DaemonStatusResponse, BridgeError> {
    Ok(discover_daemon_status().await)
}

#[tauri::command]
pub fn get_tendril_home() -> Result<String, BridgeError> {
    Ok(resolve_tendril_home().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cmd_get_service_logs(lines: Option<usize>) -> Result<Vec<String>, BridgeError> {
    let home = resolve_tendril_home();
    let supervisor = crate::service::ServiceSupervisor::new(home, None);
    supervisor
        .read_service_logs(lines)
        .map_err(BridgeError::internal)
}

#[tauri::command]
pub async fn cmd_restart_service() -> Result<ServiceInfoDto, BridgeError> {
    let home = resolve_tendril_home();
    let mut supervisor = crate::service::ServiceSupervisor::new(home.clone(), None);
    let _ = supervisor.stop_managed_service();
    let discovery = MasterDiscovery::with_home(home);
    Ok(discovery.get_service_info().await)
}

/// Clears the leftovers that can stop the app reaching a daemon: a stale `.master`, an orphaned
/// managed-service lock, and a tripped circuit breaker.
///
/// It does **not** unregister a daemon that is alive and answering. Deleting a live daemon's `.master`
/// is what broke every client in the 2026-09-14 incident: the daemon keeps running but reads
/// `is_master()` as false forever, so its master-only sweeps stop, every client reports "not running",
/// and a second daemon can claim the same home. Repair is for wreckage, not for running processes.
#[tauri::command]
pub async fn cmd_repair_service() -> Result<String, BridgeError> {
    use crate::service::supervisor::MasterReclaim;

    let home = resolve_tendril_home();
    let mut supervisor = crate::service::ServiceSupervisor::new(home.clone(), None);
    let reclaim = supervisor
        .repair_master()
        .await
        .map_err(BridgeError::internal)?;

    // The lock file and the breaker are the app's own state, so they are always safe to reset — but
    // not while the daemon they describe may still be the one running.
    if !reclaim.refused() {
        supervisor.remove_lock_file();
    }
    supervisor.circuit_breaker.reset();

    Ok(match reclaim {
        MasterReclaim::NoClaim => {
            "Service repair completed. (No daemon registration to clean up.)".to_string()
        }
        MasterReclaim::Removed { pid: Some(pid) } => {
            format!("Service repair completed. (Cleaned a stale registration left by PID {pid}.)")
        }
        MasterReclaim::Removed { pid: None } => {
            "Service repair completed. (Cleaned a truncated daemon registration.)".to_string()
        }
        MasterReclaim::RefusedLive { pid, port } => format!(
            "Nothing to repair: the daemon on port {port} (PID {pid}) is running and answering, so \
             its registration was left intact. Stop it if you want it replaced."
        ),
        // Deliberately the one thing Repair will not do. An unreadable registration cannot be shown to
        // be wreckage — there is nobody to ask whether it is answering — and deleting one that turned
        // out to be live is the incident this guard exists to prevent.
        MasterReclaim::RefusedUnreadable { schema_version } => format!(
            "Nothing was repaired: {} is not a daemon registration this version of Tendril can \
             read{}. It may belong to a daemon that is still running, so it was left intact. Stop \
             that daemon, update Tendril, or move the file aside once you are sure nothing is using \
             it.",
            home.join(".master").display(),
            schema_version
                .map(|v| format!(" (it declares schemaVersion {v})"))
                .unwrap_or_default()
        ),
    })
}

/// Installs the bundled daemon and its autostart unit on demand.
///
/// The same work startup does on its own, exposed so the Service settings pane can retry it: the
/// startup run is best-effort and silent, and a machine that refused it the first time (a locked
/// executable, a LaunchAgents directory that was not writable yet) has no other way back.
#[tauri::command]
pub async fn cmd_install_service() -> Result<crate::service::ProvisionReport, BridgeError> {
    let home = resolve_tendril_home();
    // Blocking file IO, up to ~250 MB of it, so it does not belong on the async runtime's thread.
    tokio::task::spawn_blocking(move || crate::service::provision(&home))
        .await
        .map_err(|e| BridgeError::internal(format!("service install task failed: {e}")))
}

/// Removes the autostart registration, leaving `<home>/bin` and every byte of user data in place.
///
/// Deliberately asymmetric with install: the binaries stay. They are what an already-running daemon
/// is executing and what `agent_path` puts on a coding agent's `PATH`, so deleting them from under a
/// live process to satisfy a settings toggle is not something this should do. "Do not start at
/// login" is the whole intent.
#[tauri::command]
pub async fn cmd_uninstall_service_autostart() -> Result<String, BridgeError> {
    tokio::task::spawn_blocking(|| {
        crate::service::provision::unregister_autostart("com.spacecorps.tendril.service")
    })
    .await
    .map_err(|e| BridgeError::internal(format!("service uninstall task failed: {e}")))?
    .map_err(BridgeError::internal)
}

#[tauri::command]
pub async fn cmd_switch_service_mode(mode: String) -> Result<ServiceInfoDto, BridgeError> {
    let home = resolve_tendril_home();
    let mut supervisor = crate::service::ServiceSupervisor::new(home.clone(), None);
    if mode == "external" {
        let _ = supervisor.stop_managed_service();
    }
    let discovery = MasterDiscovery::with_home(home);
    Ok(discovery.get_service_info().await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::DaemonConnectionState;

    #[test]
    fn test_daemon_status_serialization() {
        let status = DaemonStatusResponse {
            state: DaemonConnectionState::Connected,
            tendril_home: "/Users/test/.tendril".to_string(),
            port: Some(5010),
            host: Some("127.0.0.1".to_string()),
            scheme: Some("http".to_string()),
            secret: Some("test-secret".to_string()),
            pid: Some(1234),
            api_version: Some(1),
            capabilities: vec!["plans".to_string(), "jobs".to_string()],
            message: "Daemon ready".to_string(),
        };

        let json = serde_json::to_string(&status).expect("Serialization must succeed");
        assert!(json.contains("\"state\":\"Connected\""));
        assert!(json.contains("\"port\":5010"));
        assert!(json.contains("\"tendrilHome\":\"/Users/test/.tendril\""));
    }

    #[test]
    fn test_get_tendril_home_command() {
        let home = get_tendril_home().expect("tendril home command must return Ok");
        assert!(!home.is_empty());
    }
}
