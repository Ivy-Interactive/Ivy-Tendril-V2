use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::daemon::{
    is_pid_alive, parse_master_json, probe_daemon_health, DaemonConnectionState, MasterInfo,
};
use crate::service::compatibility::ServiceCompatibilityManager;
// The `.master` classifier comes from the daemon's own crate on purpose: the app deletes that file, and
// a second implementation of "can this be read as a claim?" is how the two ends come to disagree about
// whether a running daemon's registration is wreckage.
use tendril_core::config::{inspect_master_file, MasterFileKind};

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

/// The outcome of trying to clear `.master`.
///
/// Distinct refusals rather than a bare bool because "there was nothing to clean up", "I refused to
/// unregister a running daemon" and "I cannot read this file, so I refuse to guess" are three
/// different answers, and the operator clicking Repair has to be told which one happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MasterReclaim {
    /// No `.master` file at all.
    NoClaim,
    /// The claim was stale and has been removed. `pid` is what it named; `None` for a file that was not
    /// a JSON document at all — a truncated or half-finished write, which names nobody.
    Removed { pid: Option<u32> },
    /// The claim belongs to a daemon that is still there, and was left untouched.
    RefusedLive { pid: u32, port: u16 },
    /// A JSON document that is not a claim this build understands — another Tendril's registration, or
    /// one written to a newer `.master` schema. Left untouched.
    ///
    /// This is the case that used to be *deleted*, on the reasoning that an unreadable claim names no
    /// pid and so can teach us nothing. It teaches us nothing about whether a daemon is alive either,
    /// which is exactly why it must stand: deleting a registration it could not parse is what V1's CLI
    /// did to a live V2 daemon (`MasterLock.ReadLiveMaster`), taking it off the air for the rest of its
    /// life. `tendril_core::config::inspect_master_file` draws the line between this and a truncated
    /// write, and that is deliberately the daemon's own classifier rather than a second copy here.
    RefusedUnreadable {
        /// The `schemaVersion` the file declares, when it declares one.
        schema_version: Option<u32>,
    },
}

impl MasterReclaim {
    pub fn removed(&self) -> bool {
        matches!(self, MasterReclaim::Removed { .. })
    }

    /// Whether the claim was left standing. The lock file and the circuit breaker describe the daemon
    /// the claim names, so neither may be reset while it might still be running.
    pub fn refused(&self) -> bool {
        matches!(
            self,
            MasterReclaim::RefusedLive { .. } | MasterReclaim::RefusedUnreadable { .. }
        )
    }
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

    /// Removes `.master` only when there is positive evidence the daemon it named is gone.
    ///
    /// The claim is a live daemon's registration, not a lock file, and deleting one that is very much
    /// alive unregisters it permanently: `is_master()` reads false for the rest of that process's
    /// life, so its cost backfill, issue importer and job maintenance go silently dead, every client
    /// reports "not running", and a second daemon can claim the home and run jobs concurrently.
    ///
    /// So the file is classified before anything is deleted, by
    /// [`tendril_core::config::inspect_master_file`] — the daemon's own classifier, so there is one
    /// definition of "unreadable" rather than two that can drift. Only two shapes are ever removed:
    /// a document that is not JSON at all (a truncated or half-finished write, which names nobody and
    /// blocks every future claim) and a claim whose owning process is gone. A JSON document this build
    /// cannot read as a claim is left standing: it is somebody's registration, and being unable to
    /// identify its owner is not evidence that its owner is dead.
    ///
    /// Synchronous, so it can only test the process — that is enough for the callers that just need to
    /// clear a leftover. [`ServiceSupervisor::repair_master`] is the variant that also asks the
    /// daemon whether it is answering, which is what "Repair service" needs.
    pub fn remove_master_if_stale(&self) -> Result<MasterReclaim, String> {
        match inspect_master_file(&self.tendril_home) {
            MasterFileKind::Missing => Ok(MasterReclaim::NoClaim),
            MasterFileKind::Garbage => self.clear_unreadable_write(),
            MasterFileKind::Foreign { schema_version } => {
                Ok(MasterReclaim::RefusedUnreadable { schema_version })
            }
            MasterFileKind::Claim(claim) => {
                // `owner_is_running` is the pid *and* its start token, so a recycled pid does not wedge
                // the claim forever the way a bare `kill(pid, 0)` does.
                if claim.owner_is_running() {
                    return Ok(MasterReclaim::RefusedLive {
                        pid: claim.info.pid,
                        port: claim.info.port,
                    });
                }
                self.force_remove_master()?;
                Ok(MasterReclaim::Removed {
                    pid: Some(claim.info.pid),
                })
            }
        }
    }

    /// What "Repair service" runs: clears the claim unless the daemon it names is both alive **and**
    /// answering, and never touches a claim it cannot read.
    ///
    /// A pid that is alive but not answering is precisely the wedged claim an operator cannot
    /// otherwise escape (the only other way out is the undocumented `TENDRIL_ALLOW_MASTER_TAKEOVER=1`
    /// env var), so that one is cleared — and reported, because clearing it while the process is
    /// somehow still serving would be the incident this guard exists to prevent.
    ///
    /// A file that is not a claim this build understands is the one case Repair cannot fix, because
    /// there is no one to ask whether it is answering. It is reported rather than removed; see
    /// [`MasterReclaim::RefusedUnreadable`].
    pub async fn repair_master(&self) -> Result<MasterReclaim, String> {
        match inspect_master_file(&self.tendril_home) {
            MasterFileKind::Missing => Ok(MasterReclaim::NoClaim),
            MasterFileKind::Garbage => self.clear_unreadable_write(),
            MasterFileKind::Foreign { schema_version } => {
                Ok(MasterReclaim::RefusedUnreadable { schema_version })
            }
            MasterFileKind::Claim(claim) => {
                let info = &claim.info;
                if claim.owner_is_running()
                    && probe_daemon_health(&info.scheme, &info.host, info.port, &info.secret)
                        .await
                        .is_ok()
                {
                    return Ok(MasterReclaim::RefusedLive {
                        pid: info.pid,
                        port: info.port,
                    });
                }
                self.force_remove_master()?;
                Ok(MasterReclaim::Removed {
                    pid: Some(info.pid),
                })
            }
        }
    }

    /// Clears a `.master` that is not a JSON document — the one shape that carries no information
    /// about anybody. A daemon caught between creating the file and writing it looks like this for
    /// microseconds, which is why the daemon's own claim path re-reads before believing it; the app
    /// only ever gets here on an explicit repair or before spawning, long after that window.
    fn clear_unreadable_write(&self) -> Result<MasterReclaim, String> {
        self.force_remove_master()?;
        Ok(MasterReclaim::Removed { pid: None })
    }

    /// Deletes the claim with no liveness check whatsoever. Private on purpose: every caller has to
    /// come through [`Self::remove_master_if_stale`] or [`Self::repair_master`].
    fn force_remove_master(&self) -> Result<(), String> {
        let path = self.master_file_path();
        let stale_tmp = self.tendril_home.join(".master.stale.tmp");
        if let Err(e) = std::fs::rename(&path, &stale_tmp) {
            std::fs::remove_file(&path)
                .map_err(|e2| format!("Failed to delete stale .master: {e2} (rename err: {e})"))?;
        } else {
            let _ = std::fs::remove_file(&stale_tmp);
        }
        Ok(())
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
                let _ = self.remove_master_if_stale();
                return Ok(None);
            }
        };

        if !is_pid_alive(master.pid) {
            let _ = self.remove_master_if_stale();
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
        // Only a leftover claim is cleared. Spawning a second daemon over a live one used to start by
        // deleting the live one's registration, which is the bug in issue #129; now the claim stands
        // and the child's own `MasterGuard::acquire` refuses, which is the election doing its job.
        match self.remove_master_if_stale() {
            Ok(MasterReclaim::RefusedLive { pid, port }) => {
                return Err(format!(
                    "Not starting a managed daemon: {} is claimed by a running daemon (PID {pid}, \
                     port {port}). Stop it first, or adopt it.",
                    self.master_file_path().display()
                ));
            }
            // Said rather than swallowed: the child's own `MasterGuard::acquire` would refuse this file
            // too, and it would do it after spawning, from a log the operator never opens.
            Ok(MasterReclaim::RefusedUnreadable { schema_version }) => {
                return Err(format!(
                    "Not starting a managed daemon: {} is not a registration this build can read{}. \
                     It may belong to a running daemon, so it was left alone — stop that daemon, or \
                     move the file aside once you are sure nothing is using it.",
                    self.master_file_path().display(),
                    schema_version
                        .map(|v| format!(" (schemaVersion {v})"))
                        .unwrap_or_default()
                ));
            }
            Ok(_) => {}
            Err(e) => eprintln!("Warning clearing a stale .master: {e}"),
        }

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
