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
