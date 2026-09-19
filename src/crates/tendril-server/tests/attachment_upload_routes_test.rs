//! `POST /api/attachments/:session_id` — the route that writes a file into the daemon's own home.
//!
//! Two kinds of assertion, and both are the security boundary rather than a description of it:
//!
//! * **Where the bytes land.** Inside `<TendrilHome>/Attachments/<session_id>/` and nowhere else, for
//!   every file name and session id a caller can put on the wire.
//! * **Who may ask.** The bearer credential, and not over a tunnel — a route that writes files must not
//!   be one middleware away from being reachable from the internet a tunnel publishes.
//!
//! The router is the real one from `create_router`, so the middleware order under test is the shipped
//! order. Nothing touches the network: a tunnel is simulated by writing the state file a live one
//! leaves behind and addressing the request to its host, exactly as `share_fence_test` does.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use tendril_core::config::{save_config, TendrilSettings};
use tendril_core::jobs::attachments::MAX_ATTACHMENT_BYTES;
use tendril_core::tunnel::full_state::{self, FullTunnelSession};
use tendril_core::tunnel::share_state::{self, ShareSession};
use tendril_server::{create_router, AppState};
use tower::ServiceExt;

const SHARE_HOST: &str = "calm-otter-reads-plans.trycloudflare.com";
const FULL_HOST: &str = "brave-heron-runs-jobs.trycloudflare.com";

/// Percent-encodes a file name for the query string. Written out rather than pulled from a crate
/// because the names under test are exactly the ones an encoder would mangle differently — a `/` or a
/// `..` has to arrive at the handler intact to be refused *there*.
fn encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(*byte as char)
            }
            other => encoded.push_str(&format!("%{other:02X}")),
        }
    }
    encoded
}

struct Harness {
    tendril_home: PathBuf,
    secret: String,
    router: Router,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

fn harness() -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-attachment-upload-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");
    save_config(
        &tendril_home.join("config.yaml"),
        &TendrilSettings::default(),
    )
    .expect("write config");

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));

    Harness {
        tendril_home,
        secret,
        router: create_router(state),
    }
}

/// One upload, as the app makes it: the bearer header, a loopback host, the bytes as the body.
struct Uploaded {
    status: StatusCode,
    body: serde_json::Value,
}

impl Harness {
    async fn send(&self, request: Request<Body>) -> Uploaded {
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("router responds");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        Uploaded {
            status,
            body: serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        }
    }

    fn request(&self, session: &str, file_name: &str, body: Vec<u8>) -> Request<Body> {
        Request::builder()
            .method("POST")
            .uri(format!(
                "/api/attachments/{session}?fileName={}",
                encode(file_name)
            ))
            .header("host", "127.0.0.1:5010")
            .header("authorization", format!("Bearer {}", self.secret))
            .body(Body::from(body))
            .expect("build request")
    }

    async fn upload(&self, session: &str, file_name: &str, body: &[u8]) -> Uploaded {
        self.send(self.request(session, file_name, body.to_vec()))
            .await
    }

    fn publish_share(&self) {
        share_state::write(
            &self.tendril_home,
            &ShareSession {
                url: format!("https://{SHARE_HOST}"),
                host: SHARE_HOST.to_string(),
                token: share_state::mint_token(),
                pid: 0,
                started_at: "2026-09-16T10:00:00Z".to_string(),
            },
        )
        .expect("write share state");
    }

    fn publish_full_tunnel(&self) {
        full_state::write(
            &self.tendril_home,
            &FullTunnelSession {
                url: format!("https://{FULL_HOST}"),
                host: FULL_HOST.to_string(),
                pid: 0,
                started_at: "2026-09-16T10:00:00Z".to_string(),
            },
        )
        .expect("write full tunnel state");
    }

    /// Everything under the Tendril home, relative and slash-separated — used to assert that an upload
    /// created exactly one file, in exactly one place.
    fn files(&self) -> Vec<String> {
        let mut found = Vec::new();
        let mut stack = vec![self.tendril_home.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if let Ok(relative) = path.strip_prefix(&self.tendril_home) {
                    found.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        found.sort();
        found
    }
}

#[tokio::test]
async fn an_upload_lands_in_the_session_directory_and_nowhere_else() {
    let h = harness();

    let response = h
        .upload("session-1", "shot.png", b"pretend png bytes")
        .await;
    assert_eq!(response.status, StatusCode::CREATED);

    let stored = response.body["path"].as_str().expect("a path comes back");
    assert_eq!(
        PathBuf::from(stored),
        h.tendril_home
            .join("Attachments")
            .join("session-1")
            .join("shot.png")
    );
    assert_eq!(
        std::fs::read(stored).expect("the file exists at the path reported"),
        b"pretend png bytes"
    );

    // `config.yaml` is the fixture's; the upload accounts for the only other file.
    assert_eq!(
        h.files(),
        vec![
            "Attachments/session-1/shot.png".to_string(),
            "config.yaml".to_string()
        ]
    );
}

#[tokio::test]
async fn a_file_name_that_could_escape_the_attachment_directory_is_refused() {
    let h = harness();

    for name in [
        "../escaped.png",
        "../../escaped.png",
        "..",
        "sub/escaped.png",
        "sub\\escaped.png",
        "/etc/passwd",
        "/tmp/escaped.png",
        "C:\\Windows\\escaped.png",
        "shot.png:stream",
        "",
    ] {
        let response = h.upload("session-1", name, b"payload").await;
        assert_eq!(
            response.status,
            StatusCode::BAD_REQUEST,
            "{name:?} must be refused"
        );
    }

    // The decisive assertion: not one of them wrote anything, anywhere under the home.
    assert_eq!(h.files(), vec!["config.yaml".to_string()]);
}

/// The session id is the other half of the path, and arrives on the same request.
#[tokio::test]
async fn a_session_id_that_could_escape_the_attachment_directory_is_refused() {
    let h = harness();

    // `..` and `a/b` change which route matches (`:session_id` is one segment), so those are answered
    // 404/405 by the router rather than 400 — either way nothing is written. The percent-encoded forms
    // do reach the handler, and are what the assertion below is really about.
    for session in ["..", "%2e%2e", "%2E%2E%2F..", "a%2Fb", "a%5Cb", "%2Ftmp"] {
        let response = h.upload(session, "shot.png", b"payload").await;
        assert!(
            response.status.is_client_error(),
            "session {session:?} must be refused, got {}",
            response.status
        );
    }

    assert_eq!(h.files(), vec!["config.yaml".to_string()]);
}

#[tokio::test]
async fn the_size_cap_holds() {
    let h = harness();

    let at_cap = vec![7u8; MAX_ATTACHMENT_BYTES];
    assert_eq!(
        h.upload("session-1", "at-cap.png", &at_cap).await.status,
        StatusCode::CREATED,
        "a file exactly at the cap is stored"
    );

    let over_cap = vec![7u8; MAX_ATTACHMENT_BYTES + 1];
    assert_eq!(
        h.upload("session-1", "over-cap.png", &over_cap)
            .await
            .status,
        StatusCode::PAYLOAD_TOO_LARGE,
        "one byte over the cap is refused"
    );
    assert!(
        !h.tendril_home
            .join("Attachments/session-1/over-cap.png")
            .exists(),
        "a refused upload must not be partly written"
    );
}

#[tokio::test]
async fn an_empty_body_is_refused() {
    let h = harness();
    assert_eq!(
        h.upload("session-1", "empty.png", b"").await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(h.files(), vec!["config.yaml".to_string()]);
}

#[tokio::test]
async fn an_upload_without_the_bearer_credential_is_refused() {
    let h = harness();

    let response = h
        .send(
            Request::builder()
                .method("POST")
                .uri("/api/attachments/session-1?fileName=shot.png")
                .header("host", "127.0.0.1:5010")
                .body(Body::from("pretend png bytes"))
                .expect("build request"),
        )
        .await;

    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
    assert_eq!(h.files(), vec!["config.yaml".to_string()]);
}

/// A wrong credential is not a different answer from no credential.
#[tokio::test]
async fn an_upload_with_the_wrong_credential_is_refused() {
    let h = harness();

    let response = h
        .send(
            Request::builder()
                .method("POST")
                .uri("/api/attachments/session-1?fileName=shot.png")
                .header("host", "127.0.0.1:5010")
                .header("authorization", "Bearer not-this-daemons-secret")
                .body(Body::from("pretend png bytes"))
                .expect("build request"),
        )
        .await;

    assert_eq!(response.status, StatusCode::UNAUTHORIZED);
    assert_eq!(h.files(), vec!["config.yaml".to_string()]);
}

/// Not published over either tunnel, credential or no credential. A share visitor is already refused by
/// `auth_middleware`'s deny-by-default allow-list; this is the second fence, and it is the one that
/// holds even for a caller that has somehow obtained the bearer secret.
#[tokio::test]
async fn an_upload_over_a_tunnel_host_is_refused() {
    let h = harness();
    h.publish_share();
    h.publish_full_tunnel();

    for host in [SHARE_HOST, FULL_HOST] {
        let response = h
            .send(
                Request::builder()
                    .method("POST")
                    .uri("/api/attachments/session-1?fileName=shot.png")
                    .header("host", host)
                    .header("authorization", format!("Bearer {}", h.secret))
                    .body(Body::from("pretend png bytes"))
                    .expect("build request"),
            )
            .await;

        assert_eq!(
            response.status,
            StatusCode::FORBIDDEN,
            "{host} must not reach the upload route"
        );
    }

    // Only the two tunnel records the fixture wrote, and the config: no upload happened.
    assert_eq!(
        h.files(),
        vec![
            ".full-tunnel.json".to_string(),
            ".share-tunnel.json".to_string(),
            "config.yaml".to_string()
        ]
    );

    // And the same request on loopback still works, so the refusal above is about the host and not
    // about the request.
    assert_eq!(
        h.upload("session-1", "shot.png", b"pretend png bytes")
            .await
            .status,
        StatusCode::CREATED
    );
}
