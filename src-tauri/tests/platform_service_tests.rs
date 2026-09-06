use std::path::PathBuf;
use tendril_app_lib::service::platform::linux::generate_systemd_unit;
use tendril_app_lib::service::platform::macos::generate_launchd_plist;
use tendril_app_lib::service::platform::windows::{
    generate_schtasks_create_command, generate_task_xml,
};
use tendril_app_lib::service::platform::PlatformServiceConfig;

fn sample_config() -> PlatformServiceConfig {
    PlatformServiceConfig {
        service_name: "com.spacecorps.tendril.service".to_string(),
        binary_path: PathBuf::from("/usr/local/bin/tendril"),
        args: vec!["serve".to_string(), "--port".to_string(), "5010".to_string()],
        tendril_home: PathBuf::from("/Users/test/.tendril"),
        log_path: PathBuf::from("/Users/test/.tendril/Logs/service.log"),
        env_vars: vec![
            ("TENDRIL_HOME".to_string(), "/Users/test/.tendril".to_string()),
            ("TENDRIL_MANAGED_BY".to_string(), "Tendril-App".to_string()),
        ],
    }
}

#[test]
fn test_macos_launchd_plist_generation() {
    let cfg = sample_config();
    let plist = generate_launchd_plist(&cfg);

    assert!(plist.contains("<key>Label</key>"));
    assert!(plist.contains("<string>com.spacecorps.tendril.service</string>"));
    assert!(plist.contains("<string>/usr/local/bin/tendril</string>"));
    assert!(plist.contains("<string>serve</string>"));
    assert!(plist.contains("<key>RunAtLoad</key>"));
    assert!(plist.contains("<true/>"));
    assert!(plist.contains("<key>StandardOutPath</key>"));
    assert!(plist.contains("/Users/test/.tendril/Logs/service.log"));
    assert!(plist.contains("<key>TENDRIL_MANAGED_BY</key>"));
}

#[test]
fn test_linux_systemd_unit_generation() {
    let cfg = sample_config();
    let unit = generate_systemd_unit(&cfg);

    assert!(unit.contains("[Unit]"));
    assert!(unit.contains("Description=Tendril Background Service Daemon"));
    assert!(unit.contains("ExecStart=/usr/local/bin/tendril serve --port 5010"));
    assert!(unit.contains("WorkingDirectory=/Users/test/.tendril"));
    assert!(unit.contains("StandardOutput=append:/Users/test/.tendril/Logs/service.log"));
    assert!(unit.contains("Environment=\"TENDRIL_HOME=/Users/test/.tendril\""));
    assert!(unit.contains("Environment=\"TENDRIL_MANAGED_BY=Tendril-App\""));
    assert!(unit.contains("WantedBy=default.target"));
}

#[test]
fn test_windows_task_xml_and_schtasks_generation() {
    let cfg = sample_config();
    let xml = generate_task_xml(&cfg);

    assert!(xml.contains("<Task version=\"1.2\""));
    assert!(xml.contains("<Description>Tendril Background Service</Description>"));
    assert!(xml.contains("<LogonTrigger>"));
    assert!(xml.contains("<Command>/usr/local/bin/tendril</Command>"));
    assert!(xml.contains("<Arguments>serve --port 5010</Arguments>"));
    assert!(xml.contains("<WorkingDirectory>/Users/test/.tendril</WorkingDirectory>"));

    let schtasks_cmd = generate_schtasks_create_command(&cfg);
    assert_eq!(schtasks_cmd[0], "schtasks.exe");
    assert_eq!(schtasks_cmd[1], "/Create");
    assert_eq!(schtasks_cmd[3], "com.spacecorps.tendril.service");
    assert_eq!(schtasks_cmd[7], "ONLOGON");
}
