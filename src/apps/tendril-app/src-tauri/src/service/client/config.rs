//! Daemon configuration, both as typed settings and as the raw config text the editor round-trips.

use super::TendrilClient;
use crate::error::BridgeError;
use crate::models::TendrilConfigDto;
use serde_json::json;

impl TendrilClient {
    pub async fn get_config(&self) -> Result<TendrilConfigDto, BridgeError> {
        let url = format!("{}/api/config", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "GET_CONFIG_FAILED",
                format!("Failed to get config ({status}): {text}"),
            ));
        }

        let val: serde_json::Value = resp.json().await?;
        let coding_agent = val
            .get("codingAgent")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let job_timeout = val.get("jobTimeout").and_then(|v| v.as_u64());
        let max_concurrent_jobs = val
            .get("maxConcurrentJobs")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);
        let plan_template = val
            .get("planTemplate")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let theme = val
            .get("theme")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let desktop_notifications = val.get("desktopNotifications").and_then(|v| v.as_bool());

        Ok(TendrilConfigDto {
            coding_agent,
            job_timeout,
            max_concurrent_jobs,
            plan_template,
            theme,
            desktop_notifications,
            raw: val,
        })
    }

    /// Merges a single top-level key into `config.yaml`. `PUT /api/config` takes the patch as a JSON
    /// *object* and rejects anything else, so the value is wrapped here — an earlier version sent the
    /// bare value with the key as a query parameter, which the server never read.
    pub async fn put_config(&self, key: &str, value: serde_json::Value) -> Result<(), BridgeError> {
        let url = format!("{}/api/config", self.base_url);
        let patch = json!({ key: value });
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&patch)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(BridgeError::new(
                "PUT_CONFIG_FAILED",
                format!("Failed to put config key '{key}' ({status}): {text}"),
            ));
        }

        Ok(())
    }

    /// `config.yaml` verbatim, with every secret replaced by the mask sentinel
    /// (`GET /api/config/text`).
    ///
    /// Deliberately not `get_config`, which parses into `TendrilConfigDto`: a serde round-trip loses
    /// the comments, key order and blank lines the operator wrote, and preserving those is the whole
    /// reason the raw editor exists. This route serves the file's own bytes and the app never
    /// re-renders them from a tree.
    ///
    /// A failure carries the daemon's `error` string and nothing else - no `details` with the raw
    /// body, unlike most calls here. The body of this route *is* `config.yaml`, and the daemon fails
    /// this route closed precisely when it could not mask a value confidently, so echoing the
    /// response would be the one place in the bridge that hands a credential to the webview.
    pub async fn get_config_text(&self) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/config/text", self.base_url);
        let resp = self.client.get(&url).headers(self.headers()).send().await?;

        if !resp.status().is_success() {
            let status = resp.status();
            return Err(BridgeError::new(
                "GET_CONFIG_TEXT_FAILED",
                Self::service_error(resp)
                    .await
                    .unwrap_or_else(|| format!("Failed to read config.yaml ({status})")),
            ));
        }

        Ok(resp.json().await?)
    }

    /// Writes an edited `config.yaml` back (`PUT /api/config/text`).
    ///
    /// `text` is the operator's own bytes, mask sentinels and all. Resolving those back to the stored
    /// secrets is the daemon's job because it is the only side allowed to read them, so nothing here
    /// inspects the text - and nothing traces it either. Mid-edit it can hold a credential that has
    /// been typed and not yet saved, which makes a log line the cheapest possible way to leak one.
    ///
    /// `409 CONFLICT` maps onto a `CONFLICT` code carrying the daemon's own message, the same way
    /// `expect_success` does for the plan lifecycle: it means the file changed underneath the editor,
    /// and the view offers Reload on it, so the reason has to survive the trip. A `400` is a
    /// validation failure the daemon has already re-run against the still-masked submission, so its
    /// message carries placeholders rather than credentials.
    pub async fn put_config_text(&self, text: &str) -> Result<serde_json::Value, BridgeError> {
        let url = format!("{}/api/config/text", self.base_url);
        let resp = self
            .client
            .put(&url)
            .headers(self.headers())
            .json(&json!({ "text": text }))
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let message = Self::service_error(resp)
                .await
                .unwrap_or_else(|| format!("Failed to save config.yaml ({status})"));
            let code = if status == reqwest::StatusCode::CONFLICT {
                "CONFLICT"
            } else {
                "PUT_CONFIG_TEXT_FAILED"
            };
            return Err(BridgeError::new(code, message));
        }

        Ok(resp.json().await?)
    }
}
