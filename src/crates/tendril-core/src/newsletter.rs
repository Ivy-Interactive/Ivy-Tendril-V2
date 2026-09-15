//! Newsletter signup, ported from the original app's `NewsletterView`/`InputSanitizer`.
//!
//! The UI is a webview whose CSP only allows outbound connections to the local daemon, so the
//! subscribe POST to the Ivy newsletter endpoint runs on the daemon side rather than from React —
//! see `tendril-server::routes::newsletter`.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::time::Duration;

pub const SUBSCRIBERS_URL: &str = "https://tendril-api.ivy.app/subscribers";

fn email_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)^[^@\s]+@[^@\s]+\.[^@\s]+$").expect("static email pattern is valid")
    })
}

/// Port of `InputSanitizer.IsValidEmail`: non-blank, and `^[^@\s]+@[^@\s]+\.[^@\s]+$`
/// case-insensitively. Deliberately the original's regex and not a stricter one — a validator that
/// rejects an address the API would have accepted is the worse failure.
pub fn is_valid_email(email: &str) -> bool {
    let trimmed = email.trim();
    !trimmed.is_empty() && email_pattern().is_match(trimmed)
}

/// What the UI needs to render, and nothing else.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeOutcome {
    pub subscribed: bool,
    /// `None` when `subscribed`. Already user-facing English — the UI does not map codes.
    pub error: Option<String>,
}

fn outcome(subscribed: bool, error: Option<&str>) -> SubscribeOutcome {
    SubscribeOutcome {
        subscribed,
        error: error.map(str::to_string),
    }
}

/// Never returns `Err`: every failure is a `SubscribeOutcome` the UI can show. `endpoint` exists so
/// the tests can point at a local stub; production passes `SUBSCRIBERS_URL`.
pub async fn subscribe(
    endpoint: &str,
    email: &str,
    anonymous_id: Option<&str>,
) -> SubscribeOutcome {
    let trimmed = email.trim();
    if !is_valid_email(trimmed) {
        return outcome(false, Some("Please enter a valid email address."));
    }

    let mut body = serde_json::Map::new();
    body.insert("email".to_string(), serde_json::json!(trimmed));
    if let Some(id) = anonymous_id {
        body.insert("anonymousId".to_string(), serde_json::json!(id));
    }
    body.insert("source".to_string(), serde_json::json!("tendril"));

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return outcome(
                false,
                Some("Could not connect. Please check your internet connection."),
            )
        }
    };

    let response = client
        .post(endpoint)
        .json(&serde_json::Value::Object(body))
        .send()
        .await;

    match response {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() || status.as_u16() == 409 {
                outcome(true, None)
            } else if status.as_u16() == 429 {
                outcome(false, Some("Too many attempts. Please try again later."))
            } else {
                outcome(false, Some("Something went wrong. Please try again later."))
            }
        }
        Err(_) => outcome(
            false,
            Some("Could not connect. Please check your internet connection."),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn accepts_valid_addresses() {
        assert!(is_valid_email("a@b.co"));
        assert!(is_valid_email("First.Last+tag@sub.example.com"));
        assert!(is_valid_email("MiXeD@CaSe.io"));
    }

    #[test]
    fn rejects_invalid_addresses() {
        assert!(!is_valid_email(""));
        assert!(!is_valid_email("   "));
        assert!(!is_valid_email("no-at-sign"));
        assert!(!is_valid_email("a@b"));
        assert!(!is_valid_email("a b@c.d"));
        assert!(!is_valid_email("a@ b.c"));
        assert!(!is_valid_email("@b.co"));
        assert!(!is_valid_email("a@"));
    }

    /// Minimal HTTP/1.1 stub: reads the request, records the body, and replies with a fixed status
    /// and empty body. Modelled on the raw-TCP stub pattern used elsewhere in this crate's tests
    /// (`plan_env_test.rs`, `master_lifecycle_test.rs`).
    struct StubServer {
        addr: SocketAddr,
        requests: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    }

    impl StubServer {
        async fn start(status_line: &'static str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
            let requests_clone = requests.clone();

            tokio::spawn(async move {
                loop {
                    let (mut socket, _) = match listener.accept().await {
                        Ok(pair) => pair,
                        Err(_) => break,
                    };
                    let requests = requests_clone.clone();
                    tokio::spawn(async move {
                        let mut buf = vec![0u8; 8192];
                        let mut total = Vec::new();
                        while let Ok(n) = socket.read(&mut buf).await {
                            if n == 0 {
                                break;
                            }
                            total.extend_from_slice(&buf[..n]);
                            let text = String::from_utf8_lossy(&total);
                            if let Some(header_end) = text.find("\r\n\r\n") {
                                let content_length = text
                                    .lines()
                                    .find_map(|line| {
                                        line.to_lowercase()
                                            .strip_prefix("content-length:")
                                            .and_then(|v| v.trim().parse::<usize>().ok())
                                    })
                                    .unwrap_or(0);
                                if total.len() >= header_end + 4 + content_length {
                                    break;
                                }
                            }
                        }
                        requests
                            .lock()
                            .unwrap()
                            .push(String::from_utf8_lossy(&total).to_string());
                        let _ = socket.write_all(status_line.as_bytes()).await;
                    });
                }
            });

            Self { addr, requests }
        }

        fn endpoint(&self) -> String {
            format!("http://{}/subscribers", self.addr)
        }

        fn request_count(&self) -> usize {
            self.requests.lock().unwrap().len()
        }

        fn last_body(&self) -> Option<String> {
            let reqs = self.requests.lock().unwrap();
            let last = reqs.last()?;
            let idx = last.find("\r\n\r\n")?;
            Some(last[idx + 4..].to_string())
        }
    }

    #[tokio::test]
    async fn subscribe_success_on_200() {
        let stub = StubServer::start("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await;
        let result = subscribe(&stub.endpoint(), "a@b.co", None).await;
        assert!(result.subscribed);
        assert_eq!(result.error, None);
    }

    #[tokio::test]
    async fn subscribe_success_on_409_already_subscribed() {
        let stub = StubServer::start("HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\n\r\n").await;
        let result = subscribe(&stub.endpoint(), "a@b.co", None).await;
        assert!(result.subscribed);
        assert_eq!(result.error, None);
    }

    #[tokio::test]
    async fn subscribe_rate_limited_on_429() {
        let stub =
            StubServer::start("HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\n\r\n").await;
        let result = subscribe(&stub.endpoint(), "a@b.co", None).await;
        assert!(!result.subscribed);
        assert_eq!(
            result.error,
            Some("Too many attempts. Please try again later.".to_string())
        );
    }

    #[tokio::test]
    async fn subscribe_generic_failure_on_500() {
        let stub =
            StubServer::start("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n")
                .await;
        let result = subscribe(&stub.endpoint(), "a@b.co", None).await;
        assert!(!result.subscribed);
        assert_eq!(
            result.error,
            Some("Something went wrong. Please try again later.".to_string())
        );
    }

    #[tokio::test]
    async fn subscribe_connection_failure_on_unroutable_endpoint() {
        // Port 0 as a *destination* refuses the connection immediately rather than binding.
        let result = subscribe("http://127.0.0.1:1/subscribers", "a@b.co", None).await;
        assert!(!result.subscribed);
        assert_eq!(
            result.error,
            Some("Could not connect. Please check your internet connection.".to_string())
        );
    }

    #[tokio::test]
    async fn subscribe_posts_body_with_anonymous_id() {
        let stub = StubServer::start("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await;
        let result = subscribe(&stub.endpoint(), "  a@b.co  ", Some("anon-123")).await;
        assert!(result.subscribed);

        let body = stub.last_body().expect("request body captured");
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("valid JSON body");
        assert_eq!(parsed["email"], "a@b.co");
        assert_eq!(parsed["anonymousId"], "anon-123");
        assert_eq!(parsed["source"], "tendril");
    }

    #[tokio::test]
    async fn subscribe_omits_anonymous_id_key_when_none() {
        let stub = StubServer::start("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await;
        let result = subscribe(&stub.endpoint(), "a@b.co", None).await;
        assert!(result.subscribed);

        let body = stub.last_body().expect("request body captured");
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("valid JSON body");
        assert!(parsed.get("anonymousId").is_none());
    }

    #[tokio::test]
    async fn subscribe_rejects_invalid_address_without_a_network_call() {
        let stub = StubServer::start("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await;
        let result = subscribe(&stub.endpoint(), "not-an-email", None).await;
        assert!(!result.subscribed);
        assert_eq!(
            result.error,
            Some("Please enter a valid email address.".to_string())
        );
        assert_eq!(stub.request_count(), 0);
    }
}
