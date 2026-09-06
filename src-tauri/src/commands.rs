use crate::daemon::{discover_daemon_status, resolve_tendril_home, DaemonStatusResponse};

#[tauri::command]
pub async fn get_daemon_status() -> Result<DaemonStatusResponse, String> {
    Ok(discover_daemon_status().await)
}

#[tauri::command]
pub fn get_tendril_home() -> Result<String, String> {
    Ok(resolve_tendril_home().to_string_lossy().to_string())
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
