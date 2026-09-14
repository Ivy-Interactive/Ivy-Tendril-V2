use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemVer {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub pre_release: Option<String>,
}

impl SemVer {
    pub fn parse(input: &str) -> Result<Self, String> {
        let trimmed = input.trim();
        let version_token = trimmed
            .split_whitespace()
            .find(|token| {
                let cleaned = token.trim_start_matches('v');
                let parts: Vec<&str> = cleaned.split('.').collect();
                parts.len() >= 2 && parts[0].chars().all(|c| c.is_ascii_digit())
            })
            .or_else(|| {
                if trimmed.contains('.') {
                    Some(trimmed)
                } else {
                    None
                }
            })
            .ok_or_else(|| format!("No semver pattern found in '{input}'"))?;

        let cleaned = version_token
            .trim_start_matches('v')
            .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-');
        let (num_part, pre_part) = match cleaned.split_once('-') {
            Some((num, pre)) => (num, Some(pre.to_string())),
            None => (cleaned, None),
        };

        let parts: Vec<&str> = num_part.split('.').collect();
        if parts.is_empty() {
            return Err(format!("Invalid version format: '{input}'"));
        }

        let major = parts[0]
            .parse::<u64>()
            .map_err(|_| format!("Invalid major version in '{input}'"))?;
        let minor = if parts.len() > 1 {
            parts[1]
                .parse::<u64>()
                .map_err(|_| format!("Invalid minor version in '{input}'"))?
        } else {
            0
        };
        let patch = if parts.len() > 2 {
            parts[2]
                .parse::<u64>()
                .map_err(|_| format!("Invalid patch version in '{input}'"))?
        } else {
            0
        };

        Ok(Self {
            major,
            minor,
            patch,
            pre_release: pre_part,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionCheckResult {
    pub is_compatible: bool,
    pub detected_version: Option<String>,
    pub required_version: String,
    pub diagnostic: String,
    pub repair_options: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ServiceCompatibilityManager {
    pub expected_major: u64,
    pub min_minor: u64,
    pub min_patch: u64,
}

impl Default for ServiceCompatibilityManager {
    fn default() -> Self {
        Self::new(0, 1, 0)
    }
}

impl ServiceCompatibilityManager {
    pub fn new(expected_major: u64, min_minor: u64, min_patch: u64) -> Self {
        Self {
            expected_major,
            min_minor,
            min_patch,
        }
    }

    pub fn required_version_string(&self) -> String {
        format!(
            "^{}.{}.{}",
            self.expected_major, self.min_minor, self.min_patch
        )
    }

    pub fn check_version_compatibility(&self, version_str: &str) -> VersionCheckResult {
        let req_str = self.required_version_string();
        let semver = match SemVer::parse(version_str) {
            Ok(v) => v,
            Err(err) => {
                return VersionCheckResult {
                    is_compatible: false,
                    detected_version: Some(version_str.to_string()),
                    required_version: req_str,
                    diagnostic: format!("Unrecognized version string format: {err}"),
                    repair_options: vec![
                        "Verify Tendril daemon version reporting.".to_string(),
                        "Upgrade daemon to a supported release version.".to_string(),
                    ],
                };
            }
        };

        if semver.major != self.expected_major {
            return VersionCheckResult {
                is_compatible: false,
                detected_version: Some(version_str.to_string()),
                required_version: req_str,
                diagnostic: format!(
                    "Incompatible major version: daemon is v{} but desktop requires v{}",
                    semver.major, self.expected_major
                ),
                repair_options: vec![
                    "Update Tendril desktop app to match daemon major version.".to_string(),
                    "Or install matching companion service binary.".to_string(),
                ],
            };
        }

        if semver.minor < self.min_minor
            || (semver.minor == self.min_minor && semver.patch < self.min_patch)
        {
            return VersionCheckResult {
                is_compatible: false,
                detected_version: Some(version_str.to_string()),
                required_version: req_str,
                diagnostic: format!(
                    "Daemon version {}.{}.{} is older than required minimum {}.{}.{}",
                    semver.major,
                    semver.minor,
                    semver.patch,
                    self.expected_major,
                    self.min_minor,
                    self.min_patch
                ),
                repair_options: vec![
                    "Upgrade Tendril background daemon via CLI or in-app updater.".to_string(),
                ],
            };
        }

        VersionCheckResult {
            is_compatible: true,
            detected_version: Some(version_str.to_string()),
            required_version: req_str,
            diagnostic: "Daemon version is fully compatible.".to_string(),
            repair_options: Vec::new(),
        }
    }

    pub fn check_binary_health(&self, binary_path: &Path) -> VersionCheckResult {
        let req_str = self.required_version_string();
        if !binary_path.exists() {
            return VersionCheckResult {
                is_compatible: false,
                detected_version: None,
                required_version: req_str,
                diagnostic: format!("Daemon binary not found at {}", binary_path.display()),
                repair_options: vec![
                    "Reinstall Tendril application to restore bundled companion binary."
                        .to_string(),
                    "Configure external daemon in Settings.".to_string(),
                ],
            };
        }

        let metadata = match std::fs::metadata(binary_path) {
            Ok(m) => m,
            Err(e) => {
                return VersionCheckResult {
                    is_compatible: false,
                    detected_version: None,
                    required_version: req_str,
                    diagnostic: format!("Failed to read binary metadata: {e}"),
                    repair_options: vec!["Check file permissions on companion binary.".to_string()],
                };
            }
        };

        if metadata.len() == 0 {
            return VersionCheckResult {
                is_compatible: false,
                detected_version: None,
                required_version: req_str,
                diagnostic: format!(
                    "Companion binary is empty or truncated (0 bytes) at {}",
                    binary_path.display()
                ),
                repair_options: vec![
                    "Re-run packaging or reinstall Tendril to replace corrupted binary."
                        .to_string(),
                ],
            };
        }

        let output = match Command::new(binary_path).arg("--version").output() {
            Ok(out) => out,
            Err(e) => {
                return VersionCheckResult {
                    is_compatible: false,
                    detected_version: None,
                    required_version: req_str,
                    diagnostic: format!("Failed to execute daemon binary: {e}"),
                    repair_options: vec![
                        "Verify binary execution permissions (chmod +x).".to_string(),
                        "Check for missing dynamic libraries or architecture mismatch.".to_string(),
                    ],
                };
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return VersionCheckResult {
                is_compatible: false,
                detected_version: None,
                required_version: req_str,
                diagnostic: format!("Daemon --version exited with error: {}", stderr.trim()),
                repair_options: vec![
                    "Run daemon manually from CLI to inspect crash output.".to_string(),
                    "Repair companion service installation.".to_string(),
                ],
            };
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        self.check_version_compatibility(&stdout)
    }
}
