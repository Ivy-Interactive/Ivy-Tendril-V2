//! The HTTP client the app talks to the local daemon with.
//!
//! [`TendrilClient`] is one struct with a large surface — every daemon route the webview can reach
//! goes through it — so the routes live in submodules, one per daemon resource, each adding its own
//! `impl TendrilClient` block. This module keeps what they all share: the struct itself, the
//! authenticated request headers, and the two response-to-`BridgeError` helpers.

mod agents;
mod annotations;
mod attachments;
mod chat;
mod config;
mod dashboard;
mod diagnostics;
mod diff_comments;
mod inbox;
mod jobs;
mod local_file;
mod onboarding;
mod plans;
mod projects;
mod pull_requests;
mod terminals;
mod vault;

use crate::error::BridgeError;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};

/// How long a request that may clone is given. Long enough for a real repository over a slow link,
/// short enough that a wedged daemon still returns something.
const CLONE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

#[derive(Debug, Clone)]
pub struct TendrilClient {
    base_url: String,
    secret: Option<String>,
    client: reqwest::Client,
}

impl TendrilClient {
    pub fn new(base_url: impl Into<String>, secret: Option<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            base_url,
            secret,
            client,
        }
    }

    fn headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(ref sec) = self.secret {
            if let Ok(val) = HeaderValue::from_str(&format!("Bearer {sec}")) {
                headers.insert(AUTHORIZATION, val);
            }
        }
        headers
    }

    /// Turn a non-2xx response into a `BridgeError`, mapping `409 CONFLICT` onto
    /// a `CONFLICT` code and the service's `error` message verbatim. The
    /// lifecycle dialogs render that message, so it must survive the trip.
    async fn expect_success(
        resp: reqwest::Response,
        failure_code: &str,
        action: &str,
    ) -> Result<(), BridgeError> {
        if resp.status().is_success() {
            return Ok(());
        }

        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let service_message = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.as_str())
                    .map(|s| s.to_string())
            });

        if status == reqwest::StatusCode::CONFLICT {
            return Err(BridgeError::new(
                "CONFLICT",
                service_message.unwrap_or_else(|| format!("Could not {action} ({status})")),
            ));
        }

        Err(BridgeError::with_details(
            failure_code,
            service_message.unwrap_or_else(|| format!("Could not {action} ({status})")),
            text,
        ))
    }

    /// The `error` field of a failed response, and nothing else from the body.
    ///
    /// `expect_success` reads the same field, but keeps the raw body as `details` as well. The
    /// config-text routes cannot: their bodies are the config file, so `error` is the only part the
    /// daemon promises is free of credentials.
    async fn service_error(resp: reqwest::Response) -> Option<String> {
        let text = resp.text().await.ok()?;
        serde_json::from_str::<serde_json::Value>(&text)
            .ok()?
            .get("error")
            .and_then(|e| e.as_str())
            .map(|s| s.to_string())
    }
}

/// Where a job's `suffix` artifact is on this machine, or `None` when it was never written.
///
/// The daemon does not publish these paths, so they are resolved with the daemon's own lookup —
/// `tendril_core::jobs::logger::find_log_file`, which knows both the `Logs/Jobs/<id><suffix>` layout and
/// the prefixed variants it also has to find. Resolving them by hand here would be a second copy of a
/// layout that is not this crate's to know.
///
/// Only an existing file is reported: a debug panel offering a path to a log that was never created
/// sends the reader to an empty `tail`.
fn job_artifact_path(job_id: &str, suffix: &str) -> Option<String> {
    let home = crate::daemon::resolve_tendril_home();
    tendril_core::jobs::logger::find_log_file(&home, job_id, suffix)
        .map(|path| path.to_string_lossy().to_string())
}

/// The 5-digit plan id a job's `planFile` names, or `None` if it names no plan.
///
/// `planFile` is whatever the dispatch passed, so it is a bare id (`00681`) as often as a folder name
/// (`00610-PortTunnelAndShareSubsys`), and occasionally an absolute path. Only the leading digit run
/// matters, zero-padded to five so it compares equal to `PlanSummary.id`.
///
/// Empty is `None` rather than `Some("00000")`: a CreatePlan job holds no plan until it has made one,
/// and a job claiming to hold plan zero would be filtered against a plan that cannot exist.
pub(crate) fn plan_id_from_folder(plan_file: &str) -> Option<String> {
    let name = plan_file
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(plan_file)
        .trim();
    let digits: String = name.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    Some(format!("{:0>5}", digits.parse::<u32>().ok()?))
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Percent-encode one path segment.
///
/// `urlencoding` is form encoding, which turns a space into `+`. That is correct
/// in a query string and wrong in a path: `+` is a literal plus there, so a
/// recommendation titled "Deep Link Protocol Handler" would be looked up as
/// "Deep+Link+Protocol+Handler" and never found. Plan and job ids are digits, so
/// only the title-keyed recommendation route is affected.
fn path_segment(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char)
            }
            other => encoded.push_str(&format!("%{other:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_segment_encodes_spaces_as_percent_20_not_plus() {
        assert_eq!(
            path_segment("Deep Link Protocol Handler"),
            "Deep%20Link%20Protocol%20Handler"
        );
        // A `+` in the title survives as a `+`, which form encoding would have
        // turned into a space on the way back out.
        assert_eq!(path_segment("C++ bindings"), "C%2B%2B%20bindings");
        assert_eq!(path_segment("00021"), "00021");
        assert_eq!(path_segment("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn a_path_segment_cannot_smuggle_in_extra_path_or_query() {
        assert_eq!(path_segment("../../etc/passwd"), "..%2F..%2Fetc%2Fpasswd");
        assert_eq!(path_segment("title?admin=1"), "title%3Fadmin%3D1");
    }

    #[test]
    fn a_path_segment_encodes_non_ascii_as_utf8_bytes() {
        assert_eq!(path_segment("résumé"), "r%C3%A9sum%C3%A9");
    }
}
