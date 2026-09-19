//! The desktop app's client for the daemon's tunnel and session-password routes.
//!
//! The original Tendril has no equivalent of this file: there, both tunnels live in the same process as
//! the UI and `TunnelSetupView`/`ShareTunnelModal` call `ICloudflaredService`/`IShareTunnelService`
//! directly, and `SecuritySetupView` writes `config.yaml` itself. In V2 all three are owned by the
//! daemon — see `tendril_core::tunnel` for why the tunnels are, and `tendril_core::auth::credentials`
//! for why the credential format must not live in the frontend — so the app is a client of
//! `/api/tunnel/**` and `/api/auth/password`, exactly as it is a client of every other capability.
//!
//! A separate client rather than more methods on [`crate::service::TendrilClient`]: that file is
//! shared ground and this is a self-contained surface. The two follow the same rules — the bearer
//! secret is read from `.master` natively and never reaches the webview.

use crate::error::BridgeError;
use crate::service::MasterDiscovery;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

/// `GET/POST/DELETE /api/tunnel/share` and `/api/tunnel/full`'s payload —
/// `tendril_core::tunnel::TunnelSnapshot` as JSON. One DTO for both, because it is one struct on the
/// daemon side and `kind` says which tunnel answered.
///
/// `share_token` is present only while a *share* is live. It travels app-side because the *owner* needs
/// it to build the link they are about to send someone; it is not a credential for anything the app
/// itself does. A full-access tunnel mints none.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TunnelSnapshotDto {
    /// `"share" | "fullAccess"`. Defaulted, so a snapshot from an older daemon that predates the field
    /// still parses as the share tunnel it must have been.
    #[serde(default = "default_kind")]
    pub kind: String,
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
    /// Whether a session password is configured. Only meaningful for the full-access tunnel, where it is
    /// the precondition for starting — the settings screen reads it to explain why Activate is
    /// unavailable rather than just greying it out.
    #[serde(rename = "passwordConfigured", default)]
    pub password_configured: bool,
}

fn default_kind() -> String {
    "share".to_string()
}

/// `GET /api/auth/status` and the reply from `PUT`/`DELETE /api/auth/password`.
///
/// Carries a boolean and, for a write, a confirmation message. Deliberately nothing else: the hash, the
/// pepper and the plaintext all stay on the daemon side.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PasswordStatusDto {
    #[serde(rename = "passwordAuthEnabled", default)]
    pub password_auth_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
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

    pub async fn status(&self) -> Result<TunnelSnapshotDto, BridgeError> {
        self.send(reqwest::Method::GET, "/api/tunnel/share").await
    }

    /// Returns as soon as the daemon has accepted the start, with `status: "connecting"`. The caller
    /// polls [`Self::status`] from there, which is what the original's modal does with its
    /// `StatusChanged` subscription.
    pub async fn start(&self) -> Result<TunnelSnapshotDto, BridgeError> {
        self.send(reqwest::Method::POST, "/api/tunnel/share").await
    }

    pub async fn stop(&self) -> Result<TunnelSnapshotDto, BridgeError> {
        self.send(reqwest::Method::DELETE, "/api/tunnel/share")
            .await
    }

    pub async fn install_state(&self) -> Result<CloudflaredInstallDto, BridgeError> {
        self.send(reqwest::Method::GET, "/api/tunnel/share/install")
            .await
    }

    /// `GET /api/tunnel/full`. The full-access tunnel's status — V1's `ICloudflaredService` reads.
    pub async fn full_status(&self) -> Result<TunnelSnapshotDto, BridgeError> {
        self.send(reqwest::Method::GET, "/api/tunnel/full").await
    }

    /// `POST /api/tunnel/full`. Fails with `TUNNEL_PASSWORD_REQUIRED` when no session password is
    /// configured, which is the daemon's `428` — see `tendril_core::tunnel::TunnelService::start`.
    pub async fn full_start(&self) -> Result<TunnelSnapshotDto, BridgeError> {
        self.send(reqwest::Method::POST, "/api/tunnel/full").await
    }

    pub async fn full_stop(&self) -> Result<TunnelSnapshotDto, BridgeError> {
        self.send(reqwest::Method::DELETE, "/api/tunnel/full").await
    }

    /// `GET /api/auth/status`. Whether a session password is configured; deliberately says no more than
    /// that, and is the only auth read the settings screen needs.
    pub async fn password_status(&self) -> Result<PasswordStatusDto, BridgeError> {
        self.send(reqwest::Method::GET, "/api/auth/status").await
    }

    /// `PUT /api/auth/password`. Sets or changes the session password.
    ///
    /// The plaintext crosses the IPC boundary because the operator typed it into the webview and it has
    /// to reach the daemon somehow; it is put straight into a request body and is never logged, stored or
    /// returned. Hashing stays on the daemon — see `tendril_core::auth::credentials` for why the
    /// credential format must not live in the frontend.
    pub async fn set_password(
        &self,
        current: Option<String>,
        new_password: String,
    ) -> Result<PasswordStatusDto, BridgeError> {
        self.send_with_body(
            reqwest::Method::PUT,
            "/api/auth/password",
            serde_json::json!({ "currentPassword": current, "newPassword": new_password }),
        )
        .await
    }

    /// `DELETE /api/auth/password`. Removes password protection.
    pub async fn clear_password(
        &self,
        current: Option<String>,
    ) -> Result<PasswordStatusDto, BridgeError> {
        self.send_with_body(
            reqwest::Method::DELETE,
            "/api/auth/password",
            serde_json::json!({ "currentPassword": current }),
        )
        .await
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> Result<T, BridgeError> {
        self.dispatch(method, path, None).await
    }

    async fn send_with_body<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: serde_json::Value,
    ) -> Result<T, BridgeError> {
        self.dispatch(method, path, Some(body)).await
    }

    async fn dispatch<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T, BridgeError> {
        let url = format!("{}{path}", self.base_url);
        let mut request = self
            .client
            .request(method.clone(), &url)
            .headers(self.headers());
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|err| {
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
        // A decision the operator has not made yet rather than a machine that is not set up: no session
        // password, so the full-access tunnel will not start. The settings screen branches on this to
        // point at the password form instead of just showing the message.
        428 => BridgeError::new("TUNNEL_PASSWORD_REQUIRED", message),
        // A wrong or missing *current* password on `/api/auth/password`, or a route refused because the
        // request arrived over a tunnel. Not `401`: the caller is authenticated, they simply have not
        // proved they know the credential they are replacing, and telling a client to re-authenticate
        // would be the wrong instruction.
        403 => BridgeError::new("FORBIDDEN", message),
        400 => BridgeError::new("BAD_REQUEST", message),
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
        let dto: TunnelSnapshotDto = serde_json::from_str(
            r#"{"status":"connected","url":"https://x.trycloudflare.com","shareToken":"tok",
                "installed":true,"startedAt":"2026-09-16T10:00:00Z","sharePort":5011}"#,
        )
        .expect("parse");
        assert_eq!(dto.status, "connected");
        assert_eq!(dto.share_token.as_deref(), Some("tok"));
        assert_eq!(dto.share_port, 5011);
        assert!(dto.error.is_none());
        assert_eq!(
            dto.kind, "share",
            "a payload from a daemon that predates `kind` is the share tunnel"
        );
    }

    #[test]
    fn a_full_access_snapshot_names_its_kind_and_its_precondition() {
        let dto: TunnelSnapshotDto = serde_json::from_str(
            r#"{"kind":"fullAccess","status":"disabled","installed":true,"sharePort":5011,
                "passwordConfigured":false}"#,
        )
        .expect("parse");
        assert_eq!(dto.kind, "fullAccess");
        assert!(!dto.password_configured);
        assert!(
            dto.share_token.is_none(),
            "a full-access tunnel mints no capability token"
        );
    }

    /// The two codes the settings screen branches on have to be distinct: one means "set a password",
    /// the other means "install cloudflared".
    #[test]
    fn the_password_precondition_is_its_own_error_code() {
        let password_required = map_error(
            reqwest::StatusCode::PRECONDITION_REQUIRED,
            r#"{"error":"A full-access tunnel publishes this whole daemon"}"#,
            &reqwest::Method::POST,
            "/api/tunnel/full",
        );
        assert_eq!(password_required.code, "TUNNEL_PASSWORD_REQUIRED");
        assert!(password_required.message.contains("full-access tunnel"));

        let not_installed = map_error(
            reqwest::StatusCode::CONFLICT,
            r#"{"error":"cloudflared is not installed."}"#,
            &reqwest::Method::POST,
            "/api/tunnel/full",
        );
        assert_eq!(not_installed.code, "TUNNEL_PRECONDITION");

        let wrong_current = map_error(
            reqwest::StatusCode::FORBIDDEN,
            r#"{"error":"Current password is incorrect"}"#,
            &reqwest::Method::PUT,
            "/api/auth/password",
        );
        assert_eq!(wrong_current.code, "FORBIDDEN");
    }

    /// The disabled snapshot omits every optional field, so the DTO must not require them.
    #[test]
    fn a_disabled_snapshot_needs_no_optional_fields() {
        let dto: TunnelSnapshotDto =
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
