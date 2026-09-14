pub mod chat;
pub mod config;
pub mod github;
pub mod jobs;
pub mod plans;
pub mod state;
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

#[tauri::command]
pub async fn cmd_repair_service() -> Result<String, BridgeError> {
    let home = resolve_tendril_home();
    let mut supervisor = crate::service::ServiceSupervisor::new(home.clone(), None);
    let cleaned = supervisor.atomic_remove_stale_master().unwrap_or(false);
    supervisor.remove_lock_file();
    supervisor.circuit_breaker.reset();

    Ok(format!(
        "Service repair completed successfully. (Cleaned stale master: {})",
        cleaned
    ))
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
