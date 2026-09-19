use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use sysinfo::{Pid, System};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MasterInfo {
    pub port: u16,
    pub pid: u32,
    #[serde(default)]
    pub secret: String,
    #[serde(rename = "startedAt", alias = "started_at", default)]
    pub started_at: String,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_scheme")]
    pub scheme: String,
    #[serde(default)]
    pub version: String,
    #[serde(
        rename = "apiVersion",
        alias = "api_version",
        default = "default_api_version"
    )]
    pub api_version: u32,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_scheme() -> String {
    "http".to_string()
}

fn default_api_version() -> u32 {
    1
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum DaemonConnectionState {
    Connected,
    Disconnected,
    Unauthenticated,
    NotRunning,
    ForeignMaster,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatusResponse {
    pub state: DaemonConnectionState,
    pub tendril_home: String,
    pub port: Option<u16>,
    pub host: Option<String>,
    pub scheme: Option<String>,
    /// Bearer secret from `.master`. Never serialized: `get_daemon_status` is a
    /// Tauri command, so serializing this would hand the daemon credential to
    /// the webview. Native callers read the field directly instead.
    #[serde(skip_serializing, default)]
    pub secret: Option<String>,
    pub pid: Option<u32>,
    pub api_version: Option<u32>,
    pub capabilities: Vec<String>,
    pub message: String,
}

pub fn resolve_tendril_home() -> PathBuf {
    if let Ok(path_str) = std::env::var("TENDRIL_HOME") {
        let trimmed = path_str.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Some(home_dir) = dirs::home_dir() {
        return home_dir.join(".tendril");
    }

    PathBuf::from(".tendril")
}

/// The first `.master` schema that names itself. A file declaring this or higher was written by a V2
/// daemon; V1 wrote no such field, which is the only thing that now separates the two.
const FIRST_SELF_DESCRIBING_MASTER_SCHEMA: u64 = 2;

/// Why this `.master` does not belong to a daemon this app can talk to, or `None` when it does.
///
/// `heartbeat` used to be the V1 marker on its own, and is not one any more: V2's claim writes a field
/// of exactly that name on purpose — it is the name V1's `MasterLock.ReadLiveMaster` ages a claim by,
/// and a V2 claim that lacked it read as infinitely stale and got deleted by any V1 CLI on the machine
/// (see `tendril_core::config::MasterClaim::heartbeat`). Since that change, a V2 daemon's own
/// registration matched this check, so the app refused to talk to the daemon it had just launched.
/// `schemaVersion` is the discriminator instead: V1 never wrote one.
pub fn detect_foreign_master(content: &str) -> Option<String> {
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(obj) = val.as_object() {
            let declares_v2_schema = obj
                .get("schemaVersion")
                .and_then(serde_json::Value::as_u64)
                .is_some_and(|version| version >= FIRST_SELF_DESCRIBING_MASTER_SCHEMA);

            if obj.contains_key("heartbeat") && !declares_v2_schema {
                return Some(
                    "Detected foreign Ivy Tendril daemon (.master contains 'heartbeat' field)"
                        .to_string(),
                );
            }
            let has_secret = obj
                .get("secret")
                .and_then(|s| s.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            let has_version = obj
                .get("version")
                .and_then(|v| v.as_str())
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false);
            if !has_secret || !has_version {
                return Some("Detected foreign or legacy daemon (.master is missing required 'secret' or 'version' fields)".to_string());
            }
        }
    }
    None
}

pub fn parse_master_json(content: &str) -> Result<MasterInfo, String> {
    serde_json::from_str(content).map_err(|e| format!("Failed to parse .master json: {e}"))
}

pub fn read_master(tendril_home: &Path) -> Result<MasterInfo, String> {
    let master_file = tendril_home.join(".master");
    if !master_file.exists() {
        return Err(format!(
            "Master file not found at {}",
            master_file.display()
        ));
    }

    let content = std::fs::read_to_string(&master_file)
        .map_err(|e| format!("Failed to read .master file: {e}"))?;

    if let Some(foreign_reason) = detect_foreign_master(&content) {
        return Err(format!("Foreign daemon detected: {foreign_reason}"));
    }

    parse_master_json(&content)
}

pub fn is_pid_alive(pid: u32) -> bool {
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.process(Pid::from(pid as usize)).is_some()
}

pub async fn probe_daemon_health(
    scheme: &str,
    host: &str,
    port: u16,
    secret: &str,
) -> Result<(u32, Vec<String>), DaemonConnectionState> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(2000))
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // Try /api/health with secret
    let health_url = format!("{scheme}://{host}:{port}/api/health");
    let health_res = client
        .get(&health_url)
        .header("Authorization", format!("Bearer {secret}"))
        .send()
        .await;

    if let Ok(resp) = health_res {
        if resp.status().is_success() {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct HealthPayload {
                #[serde(default = "default_api_version")]
                api_version: u32,
                #[serde(default)]
                capabilities: Vec<String>,
            }

            let payload = resp.json::<HealthPayload>().await.ok();
            let api_ver = payload.as_ref().map(|p| p.api_version).unwrap_or(1);
            let caps = payload.map(|p| p.capabilities).unwrap_or_default();
            return Ok((api_ver, caps));
        } else if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(DaemonConnectionState::Unauthenticated);
        }
    }

    // Try fallback ping
    let ping_url = format!("{scheme}://{host}:{port}/api/ping");
    let ping_res = client
        .get(&ping_url)
        .header("Authorization", format!("Bearer {secret}"))
        .send()
        .await;

    match ping_res {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok((1, Vec::new()))
            } else if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                Err(DaemonConnectionState::Unauthenticated)
            } else {
                Err(DaemonConnectionState::Disconnected)
            }
        }
        Err(_) => Err(DaemonConnectionState::Disconnected),
    }
}

pub async fn discover_daemon_status() -> DaemonStatusResponse {
    let tendril_home = resolve_tendril_home();
    let tendril_home_str = tendril_home.to_string_lossy().to_string();

    let master_path = tendril_home.join(".master");
    if !master_path.exists() {
        return DaemonStatusResponse {
            state: DaemonConnectionState::NotRunning,
            tendril_home: tendril_home_str,
            port: None,
            host: None,
            scheme: None,
            secret: None,
            pid: None,
            api_version: None,
            capabilities: Vec::new(),
            message: format!(
                "Tendril daemon metadata (.master) not found at {}",
                master_path.display()
            ),
        };
    }

    let content = match std::fs::read_to_string(&master_path) {
        Ok(c) => c,
        Err(err) => {
            return DaemonStatusResponse {
                state: DaemonConnectionState::NotRunning,
                tendril_home: tendril_home_str,
                port: None,
                host: None,
                scheme: None,
                secret: None,
                pid: None,
                api_version: None,
                capabilities: Vec::new(),
                message: format!("Failed to read .master file: {err}"),
            };
        }
    };

    if let Some(foreign_reason) = detect_foreign_master(&content) {
        return DaemonStatusResponse {
            state: DaemonConnectionState::ForeignMaster,
            tendril_home: tendril_home_str,
            port: None,
            host: None,
            scheme: None,
            secret: None,
            pid: None,
            api_version: None,
            capabilities: Vec::new(),
            message: format!(
                "Foreign or legacy daemon detected: {foreign_reason}. The SpaceCorps desktop app requires the Rust Tendril-Service daemon with bearer authentication."
            ),
        };
    }

    let master_info = match parse_master_json(&content) {
        Ok(info) => info,
        Err(err) => {
            return DaemonStatusResponse {
                state: DaemonConnectionState::NotRunning,
                tendril_home: tendril_home_str,
                port: None,
                host: None,
                scheme: None,
                secret: None,
                pid: None,
                api_version: None,
                capabilities: Vec::new(),
                message: format!("Tendril daemon metadata (.master) malformed: {err}"),
            };
        }
    };

    let pid_alive = is_pid_alive(master_info.pid);
    if !pid_alive {
        return DaemonStatusResponse {
            state: DaemonConnectionState::NotRunning,
            tendril_home: tendril_home_str,
            port: Some(master_info.port),
            host: Some(master_info.host),
            scheme: Some(master_info.scheme),
            secret: Some(master_info.secret),
            pid: Some(master_info.pid),
            api_version: Some(master_info.api_version),
            capabilities: master_info.capabilities,
            message: format!(
                "Daemon process (PID {}) is not active according to OS process table",
                master_info.pid
            ),
        };
    }

    let probe_res = probe_daemon_health(
        &master_info.scheme,
        &master_info.host,
        master_info.port,
        &master_info.secret,
    )
    .await;

    match probe_res {
        Ok((api_ver, caps)) => {
            let capabilities = if caps.is_empty() {
                master_info.capabilities
            } else {
                caps
            };
            DaemonStatusResponse {
                state: DaemonConnectionState::Connected,
                tendril_home: tendril_home_str,
                port: Some(master_info.port),
                host: Some(master_info.host),
                scheme: Some(master_info.scheme),
                secret: Some(master_info.secret),
                pid: Some(master_info.pid),
                api_version: Some(api_ver),
                capabilities,
                message: "Daemon is online, healthy, and authenticated".to_string(),
            }
        }
        Err(DaemonConnectionState::Unauthenticated) => DaemonStatusResponse {
            state: DaemonConnectionState::Unauthenticated,
            tendril_home: tendril_home_str,
            port: Some(master_info.port),
            host: Some(master_info.host),
            scheme: Some(master_info.scheme),
            secret: Some(master_info.secret),
            pid: Some(master_info.pid),
            api_version: Some(master_info.api_version),
            capabilities: master_info.capabilities,
            message: "Daemon rejected authentication credentials in .master".to_string(),
        },
        Err(_) => DaemonStatusResponse {
            state: DaemonConnectionState::Disconnected,
            tendril_home: tendril_home_str,
            port: Some(master_info.port),
            host: Some(master_info.host),
            scheme: Some(master_info.scheme),
            secret: Some(master_info.secret),
            pid: Some(master_info.pid),
            api_version: Some(master_info.api_version),
            capabilities: master_info.capabilities,
            message: format!(
                "Daemon PID {} is running, but failed HTTP ping at port {}",
                master_info.pid, master_info.port
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_master_json() {
        let json = r#"{
            "port": 5010,
            "pid": 12345,
            "secret": "test-secret-abc",
            "startedAt": "2026-09-06T07:00:00Z",
            "host": "127.0.0.1",
            "scheme": "https",
            "version": "0.1.0",
            "apiVersion": 1,
            "capabilities": ["plans", "jobs"]
        }"#;

        let info = parse_master_json(json).expect("should parse valid json");
        assert_eq!(info.port, 5010);
        assert_eq!(info.pid, 12345);
        assert_eq!(info.secret, "test-secret-abc");
        assert_eq!(info.host, "127.0.0.1");
        assert_eq!(info.scheme, "https");
        assert_eq!(info.api_version, 1);
        assert_eq!(info.capabilities, vec!["plans", "jobs"]);
    }

    #[test]
    fn test_parse_malformed_master_json() {
        let json = r#"{ "port": "invalid-port-type" }"#;
        assert!(parse_master_json(json).is_err());
    }

    #[test]
    fn test_resolve_tendril_home_env() {
        let test_val = "/tmp/test-tendril-home-custom";
        std::env::set_var("TENDRIL_HOME", test_val);
        let resolved = resolve_tendril_home();
        assert_eq!(resolved, PathBuf::from(test_val));
    }

    #[test]
    fn test_liveness_check_for_current_process() {
        let current_pid = std::process::id();
        assert!(is_pid_alive(current_pid));
    }

    #[test]
    fn test_liveness_check_for_nonexistent_process() {
        // High unlikely PID
        assert!(!is_pid_alive(9999999));
    }
}
