//! The desktop app's client for the daemon's share-tunnel routes.
//!
//! The original Tendril has no equivalent of this file: there, the share tunnel lives in the same
//! process as the UI and `ShareTunnelModal` calls `IShareTunnelService` directly. In V2 the tunnel is
//! owned by the daemon — see `tendril_core::tunnel` for why — so the app is a client of
//! `/api/tunnel/share`, exactly as it is a client of every other daemon capability.
//!
//! A separate client rather than more methods on [`crate::service::TendrilClient`]: that file is
//! shared ground and this is a self-contained surface. The two follow the same rules — the bearer
//! secret is read from `.master` natively and never reaches the webview.

use crate::error::BridgeError;
use crate::service::MasterDiscovery;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

/// `GET/POST/DELETE /api/tunnel/share`'s payload — `tendril_core::tunnel::TunnelSnapshot` as JSON.
///
/// `share_token` is present only while a share is live. It travels app-side because the *owner* needs
/// it to build the link they are about to send someone; it is not a credential for anything the app
/// itself does.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShareTunnelDto {
    /// `"disabled" | "connecting" | "connected"`.
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(
        rename = "shareToken",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub share_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub installed: bool,
    #[serde(rename = "startedAt", default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(rename = "sharePort", default)]
    pub share_port: u16,
}

/// `GET /api/tunnel/share/install` — whether `cloudflared` is there, and what to install if not.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CloudflaredInstallDto {
    #[serde(default)]
    pub installed: bool,
    #[serde(
        rename = "binaryPath",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub binary_path: Option<String>,
    #[serde(rename = "expectedPath", default)]
    pub expected_path: String,
    #[serde(rename = "assetName", default)]
    pub asset_name: String,
    #[serde(rename = "downloadUrl", default)]
    pub download_url: String,
}

#[derive(Debug, Clone)]
pub struct TunnelClient {
    base_url: String,
    secret: Option<String>,
    client: reqwest::Client,
}

impl TunnelClient {
    pub fn new(base_url: impl Into<String>, secret: Option<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        // Longer than `TendrilClient`'s 10s: starting a share spawns a process and waits for it to
        // announce itself, and a request that times out mid-start would leave the UI unable to tell
        // "failed" from "still going".
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            base_url,
            secret,
            client,
        }
    }

    /// Reads the daemon's origin and bearer secret from `.master`, like every other command does.
    pub fn from_master() -> Result<Self, BridgeError> {
        let master = MasterDiscovery::new().read_master().map_err(|e| {
            BridgeError::with_details(
                "DISCONNECTED",
                "Tendril service is not running: daemon metadata (.master) not found",
                e,
            )
        })?;
        Ok(Self::new(
            format!("{}://{}:{}", master.scheme, master.host, master.port),
            Some(master.secret),
        ))
    }

    fn headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(secret) = &self.secret {
            if let Ok(value) = HeaderValue::from_str(&format!("Bearer {secret}")) {
                headers.insert(AUTHORIZATION, value);
            }
        }
        headers
    }

    pub async fn status(&self) -> Result<ShareTunnelDto, BridgeError> {
        self.send(reqwest::Method::GET, "/api/tunnel/share").await
    }

    /// Returns as soon as the daemon has accepted the start, with `status: "connecting"`. The caller
    /// polls [`Self::status`] from there, which is what the original's modal does with its
    /// `StatusChanged` subscription.
    pub async fn start(&self) -> Result<ShareTunnelDto, BridgeError> {
        self.send(reqwest::Method::POST, "/api/tunnel/share").await
    }

    pub async fn stop(&self) -> Result<ShareTunnelDto, BridgeError> {
        self.send(reqwest::Method::DELETE, "/api/tunnel/share")
            .await
    }

    pub async fn install_state(&self) -> Result<CloudflaredInstallDto, BridgeError> {
        self.send(reqwest::Method::GET, "/api/tunnel/share/install")
            .await
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<T, BridgeError> {
        let url = format!("{}{path}", self.base_url);
        let response = self
            .client
            .request(method.clone(), &url)
            .headers(self.headers())
            .send()
            .await
            .map_err(|err| {
                // A connection error here is a daemon that is not up, which the UI has to say plainly
                // rather than as "HTTP request failed".
                if err.is_connect() || err.is_timeout() {
                    BridgeError::with_details(
                        "DISCONNECTED",
                        "Could not reach the Tendril daemon",
                        err.to_string(),
                    )
                } else {
                    BridgeError::from(err)
                }
            })?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(map_error(status, &body, &method, path));
        }

        serde_json::from_str(&body).map_err(|err| {
            BridgeError::with_details(
                "TUNNEL_FAILED",
                format!("Could not read the daemon's reply to {method} {path}"),
                err.to_string(),
            )
        })
    }
}

/// Turns the daemon's `{"error": "..."}` into a `BridgeError` the dialog can branch on.
///
/// The daemon's message is passed through untouched. For a missing `cloudflared` it *is* the install
/// instruction, and rewording it here would mean maintaining that text twice.
fn map_error(
    status: reqwest::StatusCode,
    body: &str,
    method: &reqwest::Method,
    path: &str,
) -> BridgeError {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.as_str())
                .map(str::to_string)
        })
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| format!("{method} {path} failed with status {status}"));

    match status.as_u16() {
        401 => BridgeError::unauthenticated(message),
        // The daemon is fine and the request was fine; the environment is not. `cloudflared` being
        // absent is the case this exists for, and the dialog shows the message verbatim.
        409 => BridgeError::new("TUNNEL_PRECONDITION", message),
        503 => BridgeError::new("DISCONNECTED", message),
        404 => BridgeError::with_details(
            "TUNNEL_UNSUPPORTED",
            "This Tendril daemon is too old to support sharing. Restart or update the daemon.",
            message,
        ),
        _ => BridgeError::new("TUNNEL_FAILED", message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_connected_snapshot_round_trips() {
        let dto: ShareTunnelDto = serde_json::from_str(
            r#"{"status":"connected","url":"https://x.trycloudflare.com","shareToken":"tok",
                "installed":true,"startedAt":"2026-09-16T10:00:00Z","sharePort":5011}"#,
        )
        .expect("parse");
        assert_eq!(dto.status, "connected");
        assert_eq!(dto.share_token.as_deref(), Some("tok"));
        assert_eq!(dto.share_port, 5011);
        assert!(dto.error.is_none());
    }

    /// The disabled snapshot omits every optional field, so the DTO must not require them.
    #[test]
    fn a_disabled_snapshot_needs_no_optional_fields() {
        let dto: ShareTunnelDto =
            serde_json::from_str(r#"{"status":"disabled","installed":false,"sharePort":5011}"#)
                .expect("parse");
        assert_eq!(dto.status, "disabled");
        assert!(dto.url.is_none() && dto.share_token.is_none() && dto.started_at.is_none());
    }

    #[test]
    fn a_missing_cloudflared_becomes_a_precondition_error_with_the_daemons_own_message() {
        let err = map_error(
            reqwest::StatusCode::CONFLICT,
            r#"{"error":"cloudflared is not installed. Tendril looked for it at /tmp/tools/cloudflared"}"#,
            &reqwest::Method::POST,
            "/api/tunnel/share",
        );
        assert_eq!(err.code, "TUNNEL_PRECONDITION");
        assert!(
            err.message.contains("cloudflared is not installed"),
            "{err}"
        );
        assert!(err.message.contains("/tmp/tools/cloudflared"), "{err}");
    }

    #[test]
    fn an_old_daemon_is_reported_as_unsupported_rather_than_as_a_bare_404() {
        let err = map_error(
            reqwest::StatusCode::NOT_FOUND,
            "",
            &reqwest::Method::GET,
            "/api/tunnel/share",
        );
        assert_eq!(err.code, "TUNNEL_UNSUPPORTED");
        assert!(err.message.contains("too old"), "{err}");
    }

    #[test]
    fn other_statuses_keep_their_message_and_a_generic_code() {
        let err = map_error(
            reqwest::StatusCode::UNAUTHORIZED,
            r#"{"error":"Unauthorized"}"#,
            &reqwest::Method::GET,
            "/api/tunnel/share",
        );
        assert_eq!(err.code, "UNAUTHENTICATED");

        let err = map_error(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            "not json at all",
            &reqwest::Method::DELETE,
            "/api/tunnel/share",
        );
        assert_eq!(err.code, "TUNNEL_FAILED");
        assert!(err.message.contains("status 500"), "{err}");
    }
}
