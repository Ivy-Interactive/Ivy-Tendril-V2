use std::path::PathBuf;

pub mod linux;
pub mod macos;
pub mod windows;

#[derive(Debug, Clone)]
pub struct PlatformServiceConfig {
    pub service_name: String,
    pub binary_path: PathBuf,
    pub args: Vec<String>,
    pub tendril_home: PathBuf,
    pub log_path: PathBuf,
    pub env_vars: Vec<(String, String)>,
}

impl Default for PlatformServiceConfig {
    fn default() -> Self {
        let home = crate::daemon::resolve_tendril_home();
        Self {
            service_name: "com.spacecorps.tendril.service".to_string(),
            binary_path: home.join("bin").join("tendril"),
            args: vec!["serve".to_string()],
            log_path: home.join("Logs").join("service.log"),
            tendril_home: home,
            env_vars: vec![("TENDRIL_MANAGED_BY".to_string(), "Tendril-App".to_string())],
        }
    }
}
