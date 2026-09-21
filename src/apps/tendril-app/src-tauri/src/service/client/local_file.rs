//! Reading a local file through the daemon's guarded `/ivy/local-file` route.

use super::{urlencoding, TendrilClient};
use crate::error::BridgeError;
use base64::Engine;

impl TendrilClient {
    /// Fetches a local file through the daemon's guarded `GET /ivy/local-file` and returns it as a
    /// `data:` URL the webview can put in an `<img src>`.
    ///
    /// The daemon decides what may be read — `tendril-server`'s `local_file_guard` checks the
    /// credential, the extension allowlist and root confinement, and this call carries no opinion of
    /// its own about the path. Nothing is read off the filesystem here, so the app gains no
    /// file-reading surface of its own: it can only ask for what the guard already serves.
    ///
    /// The bytes come back rather than a URL because the guard's own layers make a URL unusable from
    /// the webview: the packaged app's page is `tauri://localhost`, so an `<img>` pointed at
    /// `http://127.0.0.1:<port>` is a cross-site subresource (`Sec-Fetch-Site: cross-site`, layer 3)
    /// whose `Origin` names a different host than the request (layer 2), and the route's `?token=`
    /// would have to be the daemon's bearer secret — the credential `commands::get_client_from_master`
    /// exists to keep out of the webview. Handing over the bytes keeps both invariants.
    pub async fn get_local_file_data_url(&self, path: &str) -> Result<String, BridgeError> {
        /// Enough for a screenshot or a plan attachment, and small enough that a stray large file
        /// cannot be turned into a data URL big enough to wedge the webview.
        const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;

        let Some(secret) = self.secret.as_deref() else {
            return Err(BridgeError::unauthenticated(
                "No daemon credential is available to read a local file",
            ));
        };

        // The guard reads the credential from `?token=` — it sits outside the bearer middleware
        // because an `<img src>` sends no `Authorization` header. So the secret is in this URL, and
        // the URL must not reach a log, an error message or the webview: every failure below is
        // reported from `path` alone, and `without_url` strips it out of reqwest's own errors, which
        // otherwise print the whole request URL.
        let url = format!(
            "{}/ivy/local-file?path={}&token={}",
            self.base_url,
            urlencoding(path),
            urlencoding(secret)
        );

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|err| BridgeError::from(err.without_url()))?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(BridgeError::unauthenticated(
                "The daemon refused the credential for a local file read",
            ));
        }
        if !status.is_success() {
            // 403 (host/origin/cross-site) and 404 (extension, or outside every allowed root) are the
            // guard's answers, and it deliberately does not distinguish "outside the roots" from
            // "does not exist" — so neither does this.
            return Err(BridgeError::not_found(format!(
                "Tendril will not serve '{path}' ({status})"
            )));
        }

        if resp
            .content_length()
            .is_some_and(|len| len > MAX_PREVIEW_BYTES)
        {
            return Err(BridgeError::validation(format!(
                "'{path}' is too large to preview"
            )));
        }

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.split(';').next().unwrap_or(value).trim().to_string())
            .unwrap_or_default();
        // The route only serves the extensions in its allowlist, so this is always an image or a PDF.
        // It is checked anyway: the media type goes into a `data:` URL the webview will load, and
        // nothing else belongs there.
        if !content_type.starts_with("image/") && content_type != "application/pdf" {
            return Err(BridgeError::validation(format!(
                "'{path}' is not a previewable file"
            )));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|err| BridgeError::from(err.without_url()))?;
        if bytes.len() as u64 > MAX_PREVIEW_BYTES {
            return Err(BridgeError::validation(format!(
                "'{path}' is too large to preview"
            )));
        }

        Ok(format!(
            "data:{content_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        ))
    }
}
