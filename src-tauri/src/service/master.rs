use crate::daemon::{
    detect_foreign_master, is_pid_alive, parse_master_json, probe_daemon_health,
    resolve_tendril_home, DaemonConnectionState, MasterInfo,
};
use crate::models::{ServiceHealthDto, ServiceInfoDto};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct MasterDiscovery {
    pub tendril_home: PathBuf,
}

impl Default for MasterDiscovery {
    fn default() -> Self {
        Self::new()
    }
}

impl MasterDiscovery {
    pub fn new() -> Self {
        Self {
            tendril_home: resolve_tendril_home(),
        }
    }

    pub fn with_home(home: impl Into<PathBuf>) -> Self {
        Self {
            tendril_home: home.into(),
        }
    }

    pub fn master_path(&self) -> PathBuf {
        self.tendril_home.join(".master")
    }

    pub fn read_master(&self) -> Result<MasterInfo, String> {
        crate::daemon::read_master(&self.tendril_home)
    }

    pub async fn check_service_health(&self) -> Result<ServiceHealthDto, String> {
        let path = self.master_path();
        if !path.exists() {
            return Err(format!("Master file not found at {}", path.display()));
        }

        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read .master file: {e}"))?;

        if let Some(foreign_reason) = detect_foreign_master(&content) {
            return Ok(ServiceHealthDto {
                status: format!("ForeignMaster: {foreign_reason}"),
                is_healthy: false,
                port: None,
                api_version: None,
                capabilities: Vec::new(),
            });
        }

        let master = parse_master_json(&content)?;

        if !is_pid_alive(master.pid) {
            return Ok(ServiceHealthDto {
                status: format!("Daemon process (PID {}) is not alive", master.pid),
                is_healthy: false,
                port: Some(master.port),
                api_version: Some(master.api_version),
                capabilities: master.capabilities,
            });
        }

        match probe_daemon_health(&master.scheme, &master.host, master.port, &master.secret).await {
            Ok((api_ver, caps)) => Ok(ServiceHealthDto {
                status: "Healthy".to_string(),
                is_healthy: true,
                port: Some(master.port),
                api_version: Some(api_ver),
                capabilities: if caps.is_empty() {
                    master.capabilities
                } else {
                    caps
                },
            }),
            Err(DaemonConnectionState::Unauthenticated) => Ok(ServiceHealthDto {
                status: "Unauthenticated".to_string(),
                is_healthy: false,
                port: Some(master.port),
                api_version: Some(master.api_version),
                capabilities: master.capabilities,
            }),
            Err(_) => Ok(ServiceHealthDto {
                status: "Disconnected".to_string(),
                is_healthy: false,
                port: Some(master.port),
                api_version: Some(master.api_version),
                capabilities: master.capabilities,
            }),
        }
    }

    pub async fn get_service_info(&self) -> ServiceInfoDto {
        let tendril_home_str = self.tendril_home.to_string_lossy().to_string();
        let path = self.master_path();

        if !path.exists() {
            return ServiceInfoDto {
                state: "NotRunning".to_string(),
                tendril_home: tendril_home_str,
                port: None,
                host: None,
                scheme: None,
                version: None,
                api_version: None,
                pid: None,
                capabilities: Vec::new(),
                message: format!(
                    "Tendril daemon metadata (.master) not found at {}",
                    path.display()
                ),
                ownership: None,
                status_badge: Some("NotRunning".to_string()),
                crash_count: None,
            };
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(err) => {
                return ServiceInfoDto {
                    state: "NotRunning".to_string(),
                    tendril_home: tendril_home_str,
                    port: None,
                    host: None,
                    scheme: None,
                    version: None,
                    api_version: None,
                    pid: None,
                    capabilities: Vec::new(),
                    message: format!("Failed to read .master file: {err}"),
                    ownership: None,
                    status_badge: Some("NotRunning".to_string()),
                    crash_count: None,
                };
            }
        };

        if let Some(foreign_reason) = detect_foreign_master(&content) {
            return ServiceInfoDto {
                state: "ForeignMaster".to_string(),
                tendril_home: tendril_home_str,
                port: None,
                host: None,
                scheme: None,
                version: None,
                api_version: None,
                pid: None,
                capabilities: Vec::new(),
                message: format!(
                    "Foreign or legacy daemon detected: {foreign_reason}. The SpaceCorps desktop app requires the Rust Tendril-Service daemon with bearer authentication."
                ),
                ownership: None,
                status_badge: Some("ForeignMaster".to_string()),
                crash_count: None,
            };
        }

        let master = match parse_master_json(&content) {
            Ok(m) => m,
            Err(err) => {
                return ServiceInfoDto {
                    state: "NotRunning".to_string(),
                    tendril_home: tendril_home_str,
                    port: None,
                    host: None,
                    scheme: None,
                    version: None,
                    api_version: None,
                    pid: None,
                    capabilities: Vec::new(),
                    message: format!("Tendril daemon metadata (.master) malformed: {err}"),
                    ownership: None,
                    status_badge: Some("NotRunning".to_string()),
                    crash_count: None,
                };
            }
        };

        if !is_pid_alive(master.pid) {
            return ServiceInfoDto {
                state: "NotRunning".to_string(),
                tendril_home: tendril_home_str,
                port: Some(master.port),
                host: Some(master.host),
                scheme: Some(master.scheme),
                version: Some(master.version),
                api_version: Some(master.api_version),
                pid: Some(master.pid),
                capabilities: master.capabilities,
                message: format!("Daemon PID {} is inactive", master.pid),
                ownership: None,
                status_badge: Some("NotRunning".to_string()),
                crash_count: None,
            };
        }

        let is_managed = self.tendril_home.join(".managed_service.lock").exists();
        let ownership_str = if is_managed {
            "Managed"
        } else {
            "AdoptedExternal"
        };

        match probe_daemon_health(&master.scheme, &master.host, master.port, &master.secret).await {
            Ok((api_ver, caps)) => {
                let badge = if is_managed {
                    "Connected (Managed)"
                } else {
                    "Connected (External)"
                };
                ServiceInfoDto {
                    state: "Connected".to_string(),
                    tendril_home: tendril_home_str,
                    port: Some(master.port),
                    host: Some(master.host),
                    scheme: Some(master.scheme),
                    version: Some(master.version),
                    api_version: Some(api_ver),
                    pid: Some(master.pid),
                    capabilities: if caps.is_empty() {
                        master.capabilities
                    } else {
                        caps
                    },
                    message: format!("Daemon is online and healthy ({badge})"),
                    ownership: Some(ownership_str.to_string()),
                    status_badge: Some(badge.to_string()),
                    crash_count: Some(0),
                }
            }
            Err(DaemonConnectionState::Unauthenticated) => ServiceInfoDto {
                state: "Unauthenticated".to_string(),
                tendril_home: tendril_home_str,
                port: Some(master.port),
                host: Some(master.host),
                scheme: Some(master.scheme),
                version: Some(master.version),
                api_version: Some(master.api_version),
                pid: Some(master.pid),
                capabilities: master.capabilities,
                message: "Daemon rejected authorization credentials".to_string(),
                ownership: Some(ownership_str.to_string()),
                status_badge: Some("Degraded".to_string()),
                crash_count: None,
            },
            Err(_) => ServiceInfoDto {
                state: "Disconnected".to_string(),
                tendril_home: tendril_home_str,
                port: Some(master.port),
                host: Some(master.host),
                scheme: Some(master.scheme),
                version: Some(master.version),
                api_version: Some(master.api_version),
                pid: Some(master.pid),
                capabilities: master.capabilities,
                message: format!("Daemon PID {} is active, but HTTP ping failed", master.pid),
                ownership: Some(ownership_str.to_string()),
                status_badge: Some("Disconnected".to_string()),
                crash_count: None,
            },
        }
    }
}
