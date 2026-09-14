use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::daemon::{
    is_pid_alive, parse_master_json, probe_daemon_health, DaemonConnectionState, MasterInfo,
};
use crate::service::compatibility::ServiceCompatibilityManager;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum ServiceOwnership {
    AdoptedExternal,
    Managed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum SupervisorStatus {
    Starting,
    Connected,
    Degraded,
    Disconnected,
    Crashed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorStateInfo {
    pub status: SupervisorStatus,
    pub ownership: Option<ServiceOwnership>,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub crash_count: u32,
    pub backoff_delay_secs: u64,
    pub message: String,
}

#[derive(Debug)]
pub struct CircuitBreaker {
    pub max_crashes: u32,
    pub window: Duration,
    pub crash_history: Vec<Instant>,
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new(5, Duration::from_secs(60))
    }
}

impl CircuitBreaker {
    pub fn new(max_crashes: u32, window: Duration) -> Self {
        Self {
            max_crashes,
            window,
            crash_history: Vec::new(),
        }
    }

    pub fn record_crash(&mut self, now: Instant) -> bool {
        self.crash_history.push(now);
        self.crash_history
            .retain(|&t| now.duration_since(t) <= self.window);
        self.is_tripped()
    }

    pub fn is_tripped(&self) -> bool {
        self.crash_history.len() > self.max_crashes as usize
    }

    pub fn reset(&mut self) {
        self.crash_history.clear();
    }
}

pub fn calculate_backoff_secs(crash_count: u32) -> u64 {
    if crash_count == 0 {
        return 0;
    }
    let shift = crash_count.saturating_sub(1).min(5);
    (1u64 << shift).min(30)
}

pub struct ServiceSupervisor {
    pub tendril_home: PathBuf,
    pub binary_path: Option<PathBuf>,
    pub compatibility_manager: ServiceCompatibilityManager,
    pub circuit_breaker: CircuitBreaker,
    pub ownership: Option<ServiceOwnership>,
    pub current_status: SupervisorStatus,
    pub managed_child: Option<Child>,
    pub crash_count: u32,
    pub current_port: Option<u16>,
    pub current_pid: Option<u32>,
    pub last_crash_time: Option<Instant>,
}

impl ServiceSupervisor {
    pub fn new(tendril_home: PathBuf, binary_path: Option<PathBuf>) -> Self {
        Self {
            tendril_home,
            binary_path,
            compatibility_manager: ServiceCompatibilityManager::default(),
            circuit_breaker: CircuitBreaker::default(),
            ownership: None,
            current_status: SupervisorStatus::Stopped,
            managed_child: None,
            crash_count: 0,
            current_port: None,
            current_pid: None,
            last_crash_time: None,
        }
    }

    pub fn master_file_path(&self) -> PathBuf {
        self.tendril_home.join(".master")
    }

    pub fn lock_file_path(&self) -> PathBuf {
        self.tendril_home.join(".managed_service.lock")
    }

    pub fn logs_file_path(&self) -> PathBuf {
        self.tendril_home.join("Logs").join("service.log")
    }

    pub fn atomic_remove_stale_master(&self) -> Result<bool, String> {
        let path = self.master_file_path();
        if !path.exists() {
            return Ok(false);
        }

        let stale_tmp = self.tendril_home.join(".master.stale.tmp");
        if let Err(e) = std::fs::rename(&path, &stale_tmp) {
            std::fs::remove_file(&path)
                .map_err(|e2| format!("Failed to delete stale .master: {e2} (rename err: {e})"))?;
        } else {
            let _ = std::fs::remove_file(&stale_tmp);
        }
        Ok(true)
    }

    pub fn write_lock_file(&self, pid: u32) -> Result<(), String> {
        let lock_path = self.lock_file_path();
        let payload = serde_json::json!({
            "supervisorPid": std::process::id(),
            "managedServicePid": pid,
            "acquiredAt": chrono::Utc::now().to_rfc3339(),
            "owner": "Tendril-App"
        });
        std::fs::write(&lock_path, payload.to_string())
            .map_err(|e| format!("Failed to write lock file {}: {e}", lock_path.display()))
    }

    pub fn remove_lock_file(&self) {
        let lock_path = self.lock_file_path();
        if lock_path.exists() {
            let _ = std::fs::remove_file(lock_path);
        }
    }

    pub fn is_external_running(&self) -> Option<MasterInfo> {
        let master_file = self.master_file_path();
        if !master_file.exists() {
            return None;
        }

        let content = std::fs::read_to_string(&master_file).ok()?;
        let info = parse_master_json(&content).ok()?;
        if is_pid_alive(info.pid) {
            Some(info)
        } else {
            None
        }
    }

    pub async fn discover_and_adopt(&mut self) -> Result<Option<SupervisorStateInfo>, String> {
        let master_file = self.master_file_path();
        if !master_file.exists() {
            return Ok(None);
        }

        let content = match std::fs::read_to_string(&master_file) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };

        let master = match parse_master_json(&content) {
            Ok(m) => m,
            Err(_) => {
                let _ = self.atomic_remove_stale_master();
                return Ok(None);
            }
        };

        if !is_pid_alive(master.pid) {
            let _ = self.atomic_remove_stale_master();
            return Ok(None);
        }

        match probe_daemon_health(&master.scheme, &master.host, master.port, &master.secret).await {
            Ok((api_ver, caps)) => {
                let version_check = if !master.version.is_empty() {
                    self.compatibility_manager
                        .check_version_compatibility(&master.version)
                } else {
                    self.compatibility_manager
                        .check_version_compatibility("0.1.0")
                };

                if !version_check.is_compatible {
                    self.current_status = SupervisorStatus::Degraded;
                    self.ownership = Some(ServiceOwnership::AdoptedExternal);
                    self.current_port = Some(master.port);
                    self.current_pid = Some(master.pid);
                    return Ok(Some(SupervisorStateInfo {
                        status: SupervisorStatus::Degraded,
                        ownership: Some(ServiceOwnership::AdoptedExternal),
                        port: Some(master.port),
                        pid: Some(master.pid),
                        crash_count: self.crash_count,
                        backoff_delay_secs: 0,
                        message: format!(
                            "Adopted external daemon on port {}, but: {}",
                            master.port, version_check.diagnostic
                        ),
                    }));
                }

                self.ownership = Some(ServiceOwnership::AdoptedExternal);
                self.current_status = SupervisorStatus::Connected;
                self.current_port = Some(master.port);
                self.current_pid = Some(master.pid);
                self.crash_count = 0;
                self.circuit_breaker.reset();

                let _ = caps;
                let _ = api_ver;

                Ok(Some(SupervisorStateInfo {
                    status: SupervisorStatus::Connected,
                    ownership: Some(ServiceOwnership::AdoptedExternal),
                    port: Some(master.port),
                    pid: Some(master.pid),
                    crash_count: 0,
                    backoff_delay_secs: 0,
                    message: format!(
                        "Adopted external daemon (PID {}, Port {})",
                        master.pid, master.port
                    ),
                }))
            }
            Err(DaemonConnectionState::Unauthenticated) => {
                self.ownership = Some(ServiceOwnership::AdoptedExternal);
                self.current_status = SupervisorStatus::Degraded;
                self.current_port = Some(master.port);
                self.current_pid = Some(master.pid);
                Ok(Some(SupervisorStateInfo {
                    status: SupervisorStatus::Degraded,
                    ownership: Some(ServiceOwnership::AdoptedExternal),
                    port: Some(master.port),
                    pid: Some(master.pid),
                    crash_count: self.crash_count,
                    backoff_delay_secs: 0,
                    message: format!("External daemon (PID {}) rejected credentials", master.pid),
                }))
            }
            Err(_) => Ok(None),
        }
    }

    pub fn start_managed_service(
        &mut self,
        binary_path: &Path,
        args: &[&str],
    ) -> Result<SupervisorStateInfo, String> {
        let _ = self.atomic_remove_stale_master();

        if self.circuit_breaker.is_tripped() {
            self.current_status = SupervisorStatus::Crashed;
            return Ok(SupervisorStateInfo {
                status: SupervisorStatus::Crashed,
                ownership: self.ownership,
                port: None,
                pid: None,
                crash_count: self.crash_count,
                backoff_delay_secs: calculate_backoff_secs(self.crash_count),
                message: "Circuit breaker tripped: over 5 crashes detected within 60 seconds. Automatic restarts suspended.".to_string(),
            });
        }

        let logs_dir = self.tendril_home.join("Logs");
        let _ = std::fs::create_dir_all(&logs_dir);
        let log_file_path = self.logs_file_path();

        let log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file_path)
            .map_err(|e| {
                format!(
                    "Failed to open service log file {}: {e}",
                    log_file_path.display()
                )
            })?;

        let log_file_err = log_file
            .try_clone()
            .map_err(|e| format!("Failed to clone log file handle: {e}"))?;

        let mut cmd = Command::new(binary_path);
        cmd.args(args)
            .env("TENDRIL_MANAGED_BY", "Tendril-App")
            .env("TENDRIL_HOME", &self.tendril_home)
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));

        let child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn companion daemon at {}: {e}",
                binary_path.display()
            )
        })?;

        let child_pid = child.id();
        self.managed_child = Some(child);
        self.ownership = Some(ServiceOwnership::Managed);
        self.current_status = SupervisorStatus::Starting;
        self.current_pid = Some(child_pid);

        if let Err(e) = self.write_lock_file(child_pid) {
            eprintln!("Warning writing service lock file: {e}");
        }

        Ok(SupervisorStateInfo {
            status: SupervisorStatus::Starting,
            ownership: Some(ServiceOwnership::Managed),
            port: self.current_port,
            pid: Some(child_pid),
            crash_count: self.crash_count,
            backoff_delay_secs: calculate_backoff_secs(self.crash_count),
            message: format!("Spawned managed daemon (PID {child_pid})"),
        })
    }

    pub fn handle_crash(&mut self, now: Instant) -> SupervisorStateInfo {
        self.crash_count += 1;
        self.last_crash_time = Some(now);
        self.managed_child = None;
        self.current_pid = None;
        self.remove_lock_file();

        let is_tripped = self.circuit_breaker.record_crash(now);
        let backoff = calculate_backoff_secs(self.crash_count);

        if is_tripped {
            self.current_status = SupervisorStatus::Crashed;
            SupervisorStateInfo {
                status: SupervisorStatus::Crashed,
                ownership: self.ownership,
                port: None,
                pid: None,
                crash_count: self.crash_count,
                backoff_delay_secs: backoff,
                message: "Managed daemon crash loop detected (> 5 crashes in 60s). Transitioned to Crashed state.".to_string(),
            }
        } else {
            self.current_status = SupervisorStatus::Disconnected;
            SupervisorStateInfo {
                status: SupervisorStatus::Disconnected,
                ownership: self.ownership,
                port: None,
                pid: None,
                crash_count: self.crash_count,
                backoff_delay_secs: backoff,
                message: format!(
                    "Managed daemon crashed (count={}). Backing off for {}s.",
                    self.crash_count, backoff
                ),
            }
        }
    }

    pub fn stop_managed_service(&mut self) -> Result<(), String> {
        if self.ownership == Some(ServiceOwnership::AdoptedExternal) {
            self.current_status = SupervisorStatus::Stopped;
            return Ok(());
        }

        if let Some(mut child) = self.managed_child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.remove_lock_file();
        self.current_status = SupervisorStatus::Stopped;
        self.current_pid = None;
        Ok(())
    }

    pub fn read_service_logs(&self, max_lines: Option<usize>) -> Result<Vec<String>, String> {
        let log_path = self.logs_file_path();
        if !log_path.exists() {
            return Ok(Vec::new());
        }

        let content = std::fs::read_to_string(&log_path)
            .map_err(|e| format!("Failed to read service logs: {e}"))?;

        let lines: Vec<String> = content.lines().map(redact_sensitive_tokens).collect();

        let limit = max_lines.unwrap_or(200);
        if lines.len() > limit {
            Ok(lines[lines.len() - limit..].to_vec())
        } else {
            Ok(lines)
        }
    }
}

pub fn redact_sensitive_tokens(line: &str) -> String {
    let mut result = line.to_string();

    if let Some(pos) = result.find("Bearer ") {
        let start = pos + 7;
        let end = result[start..]
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
            .map(|offset| start + offset)
            .unwrap_or(result.len());
        if end > start {
            result.replace_range(start..end, "[REDACTED_BEARER_TOKEN]");
        }
    }

    if let Some(pos) = result.find("\"secret\":") {
        if let Some(quote1) = result[pos..].find('"') {
            let after1 = pos + quote1 + 1;
            if let Some(quote2) = result[after1..].find('"') {
                let val_start_search = after1 + quote2 + 1;
                if let Some(val_quote1) = result[val_start_search..].find('"') {
                    let actual_start = val_start_search + val_quote1 + 1;
                    if let Some(val_quote2) = result[actual_start..].find('"') {
                        result.replace_range(
                            actual_start..actual_start + val_quote2,
                            "[REDACTED_SECRET]",
                        );
                    }
                }
            }
        }
    }

    result
}
