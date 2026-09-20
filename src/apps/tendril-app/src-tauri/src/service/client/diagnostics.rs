//! Is the daemon reachable, healthy and current — ping, doctor and version checks.

use super::TendrilClient;
use crate::error::BridgeError;
use crate::models::{DoctorCheckDto, VersionInfoDto};

impl TendrilClient {
    pub async fn ping(&self) -> Result<String, BridgeError> {
        let url = format!("{}/api/ping", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            return Err(BridgeError::new(
                "PING_FAILED",
                format!("Ping failed with status {}", resp.status()),
            ));
        }

        Ok(resp.text().await.unwrap_or_else(|_| "pong".to_string()))
    }

    pub async fn run_doctor(&self) -> Result<Vec<DoctorCheckDto>, BridgeError> {
        let url = format!("{}/api/doctor", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "RUN_DOCTOR_FAILED",
                format!("Failed to run health checks ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn get_version_info(&self) -> Result<VersionInfoDto, BridgeError> {
        let url = format!("{}/api/version", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_VERSION_INFO_FAILED",
                format!("Failed to get version info ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }

    pub async fn check_version_now(&self) -> Result<VersionInfoDto, BridgeError> {
        let url = format!("{}/api/version/check", self.base_url);
        let resp = self
            .client
            .post(&url)
            .headers(self.headers())
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "CHECK_VERSION_NOW_FAILED",
                format!("Failed to check version ({status}): {text}"),
            ));
        }

        Ok(resp.json().await?)
    }
}
