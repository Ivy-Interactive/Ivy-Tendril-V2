//! The Windows scheduled task.
//!
//! Ported from the app's `src-tauri/src/service/platform/windows.rs`. Unlike launchd and systemd
//! there is no unit file: the definition lives in the scheduler's own store, which is why
//! `default_unit_path_with_env` returns `None` here and why `register_autostart` falls back to a
//! bare existence probe instead of a content diff.

use super::PlatformServiceConfig;

pub fn generate_task_xml(config: &PlatformServiceConfig) -> String {
    let arguments = config.args.join(" ");

    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Tendril Background Service</Description>
    <Author>SpaceCorps</Author>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{}</Command>
      <Arguments>{}</Arguments>
      <WorkingDirectory>{}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"#,
        config.binary_path.display(),
        arguments,
        config.tendril_home.display()
    )
}

pub fn generate_schtasks_create_command(config: &PlatformServiceConfig) -> Vec<String> {
    let mut tr_cmd = format!("\"{}\"", config.binary_path.display());
    for arg in &config.args {
        tr_cmd.push(' ');
        tr_cmd.push_str(arg);
    }

    vec![
        "schtasks.exe".to_string(),
        "/Create".to_string(),
        "/TN".to_string(),
        config.service_name.clone(),
        "/TR".to_string(),
        tr_cmd,
        "/SC".to_string(),
        "ONLOGON".to_string(),
        "/F".to_string(),
    ]
}

pub fn generate_schtasks_delete_command(service_name: &str) -> Vec<String> {
    vec![
        "schtasks.exe".to_string(),
        "/Delete".to_string(),
        "/TN".to_string(),
        service_name.to_string(),
        "/F".to_string(),
    ]
}

/// The argv that asks the scheduler whether the task exists. Split out from the shell-out so the
/// command line is assertable on any platform, the same way the create/delete argv are.
pub fn generate_schtasks_query_command(service_name: &str) -> Vec<String> {
    vec![
        "schtasks.exe".to_string(),
        "/Query".to_string(),
        "/TN".to_string(),
        service_name.to_string(),
    ]
}

/// The argv that asks the scheduler whether the task is currently running, in a form a script can
/// read: `/FO LIST` prints a `Status:` line, and `Status: Running` is the only value that counts.
pub fn generate_schtasks_status_command(service_name: &str) -> Vec<String> {
    vec![
        "schtasks.exe".to_string(),
        "/Query".to_string(),
        "/TN".to_string(),
        service_name.to_string(),
        "/FO".to_string(),
        "LIST".to_string(),
    ]
}

/// Whether the scheduler has a task registered under this name.
///
/// Existence, not execution. `/Query /TN <name>` exits non-zero when no such task is defined, which
/// is the whole test - a registered task that is merely idle (the normal state between logon and the
/// daemon actually starting) still exits zero. Kept apart from `scheduled_task_is_running` because
/// `ServiceStatus` reports the two separately and conflating them tells an operator their installed
/// service is not installed.
pub fn scheduled_task_exists(service_name: &str) -> bool {
    let argv = generate_schtasks_query_command(service_name);
    let (program, rest) = argv.split_first().expect("schtasks argv is never empty");
    std::process::Command::new(program)
        .args(rest)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Whether the scheduler reports the task as running.
///
/// A scheduled task differs from a launchd agent or a systemd unit in that registration and
/// execution are wholly separate: `/Query` succeeding only means the task is defined. So the status
/// line is parsed, and anything else - an absent task, a `schtasks.exe` that cannot be run, a status
/// this does not recognise - reads as not running.
#[cfg(target_os = "windows")]
pub fn scheduled_task_is_running(service_name: &str) -> bool {
    let argv = generate_schtasks_status_command(service_name);
    let (program, rest) = argv.split_first().expect("schtasks argv is never empty");
    let Ok(out) = std::process::Command::new(program).args(rest).output() else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| line.split_once(':'))
        .any(|(key, value)| key.trim() == "Status" && value.trim().eq_ignore_ascii_case("Running"))
}
