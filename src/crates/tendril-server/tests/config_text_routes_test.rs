//! `GET`/`PUT /api/config/text` — the routes behind the in-app `config.yaml` editor.
//!
//! The unit-level masking rules live in `tendril-core`'s `config_text` module and are covered by
//! `config_text_test.rs`. What is only testable here is the property that makes the feature safe to
//! ship at all: the daemon is the only side that ever holds a credential, so **no response this
//! route can produce may carry one** — not the document it serves, not the acknowledgement of a
//! save, and not an error, which is the case that is easy to get wrong because the natural way to
//! write one is to quote the offending value.
//!
//! Four properties, one test each:
//!
//! 1. A read serves the file's own bytes, comments and ordering intact, with secrets replaced.
//! 2. A save that leaves the placeholders untouched writes back the *stored* secret, not the
//!    placeholder — the "mask secrets, write-through" contract.
//! 3. A save that would leave the daemon unable to load its own config is refused, and the refusal
//!    does not quote the value that caused it.
//! 4. A file the scanner cannot mask confidently fails the read closed rather than serving a
//!    partially masked document.
//! 5. A refused save does not echo the submission, which can hold a credential the operator has
//!    just typed over a placeholder.
//!
//! The share fence for these paths is asserted separately, in `share_fence_test.rs`.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use tendril_server::{create_router, AppState};
use tower::ServiceExt;

/// A credential that cannot collide with anything structural in the document, so a substring search
/// for it in a response body is a true leak and never a coincidence.
const API_KEY: &str = "sk-ant-leak-canary-2f9d41b8";
const HASH_SECRET: &str = "pepper-leak-canary-77c03e";

struct Harness {
    tendril_home: PathBuf,
    config_path: PathBuf,
    secret: String,
    router: Router,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

/// A harness over `raw` written to `config.yaml` verbatim.
///
/// Verbatim and not through `save_config`: these routes exist to preserve comments, key order and
/// blank lines, and a fixture that had been through `serde_yaml` would have none to preserve.
fn harness(raw: &str) -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-config-text-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");
    let config_path = tendril_home.join("config.yaml");
    std::fs::write(&config_path, raw).expect("write config");

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));

    Harness {
        tendril_home,
        config_path,
        secret,
        router: create_router(state),
    }
}

/// A config with a comment, a deliberate blank line, a non-alphabetical key order and two secrets of
/// different shapes — one top-level-ish, one nested under `auth`.
fn fixture() -> String {
    format!(
        "# Tendril configuration - hand-edited, do not reorder.\n\
         llm:\n\
        \x20 provider: anthropic\n\
        \x20 apiKey: \"{API_KEY}\"\n\
        \x20 model: claude-opus-5\n\
         \n\
         auth:\n\
        \x20 hashSecret: {HASH_SECRET}\n"
    )
}

struct Reply {
    status: StatusCode,
    body: String,
}

impl Reply {
    fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).unwrap_or(serde_json::Value::Null)
    }

    fn text(&self) -> String {
        self.json()["text"].as_str().unwrap_or_default().to_string()
    }
}

impl Harness {
    async fn request(&self, method: &str, body: Option<serde_json::Value>) -> Reply {
        let builder = Request::builder()
            .method(method)
            .uri("/api/config/text")
            .header("host", "127.0.0.1")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", self.secret));
        let request = builder
            .body(match body {
                Some(value) => Body::from(value.to_string()),
                None => Body::empty(),
            })
            .expect("build request");

        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("router responds");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 256 * 1024)
            .await
            .expect("read body");
        Reply {
            status,
            body: String::from_utf8_lossy(&bytes).to_string(),
        }
    }

    async fn get(&self) -> Reply {
        self.request("GET", None).await
    }

    async fn put(&self, text: &str) -> Reply {
        self.request("PUT", Some(serde_json::json!({ "text": text })))
            .await
    }

    fn on_disk(&self) -> String {
        std::fs::read_to_string(&self.config_path).expect("read config")
    }
}

/// Neither credential may appear anywhere in a response, in full **or in prefix**.
///
/// The prefix check is the point. A response that masked `sk-ant-leak-canary-2f9d41b8` down to
/// `sk-ant-leak…` would pass a naive `contains` of the whole value while still handing over enough
/// to identify the key and, for a short secret, to guess it.
fn assert_no_credential(body: &str, context: &str) {
    for secret in [API_KEY, HASH_SECRET] {
        assert!(
            !body.contains(secret),
            "{context}: the response carries a credential in full: {body}"
        );
        // 8 characters is past `sk-ant-` and into the random part, and short enough that any
        // truncated echo of the value trips it.
        let prefix = &secret[..8];
        assert!(
            !body.contains(prefix),
            "{context}: the response carries a credential prefix ({prefix}): {body}"
        );
    }
}

#[tokio::test]
async fn a_read_preserves_the_file_and_masks_only_the_secrets() {
    let h = harness(&fixture());
    let reply = h.get().await;

    assert_eq!(reply.status, StatusCode::OK, "body: {}", reply.body);
    assert_no_credential(&reply.body, "GET /api/config/text");

    let text = reply.text();
    // The three things a `serde` round-trip would destroy, which is why this route is not
    // `GET /api/config`.
    assert!(
        text.contains("# Tendril configuration - hand-edited, do not reorder."),
        "the comment was lost: {text}"
    );
    assert!(
        text.contains("\n\nauth:"),
        "the blank line was lost: {text}"
    );
    assert!(
        text.find("provider:") < text.find("apiKey:"),
        "key order was not preserved: {text}"
    );
    // Non-secret values are untouched; secrets are not.
    assert!(text.contains("provider: anthropic"), "text: {text}");
    assert!(text.contains("model: claude-opus-5"), "text: {text}");

    let masked: Vec<String> = reply.json()["maskedPaths"]
        .as_array()
        .expect("maskedPaths is an array")
        .iter()
        .map(|v| v.as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(
        masked,
        vec!["llm.apiKey".to_string(), "auth.hashSecret".to_string()],
        "both secrets should be reported, in document order"
    );
}

#[tokio::test]
async fn saving_an_untouched_placeholder_writes_back_the_stored_secret() {
    let h = harness(&fixture());
    let text = h.get().await.text();

    // What the editor does when the operator changes something that is not a secret and saves: the
    // placeholders come back exactly as they were served.
    let edited = text.replace("model: claude-opus-5", "model: claude-sonnet-5");
    let reply = h.put(&edited).await;
    assert_eq!(reply.status, StatusCode::OK, "body: {}", reply.body);
    assert_no_credential(&reply.body, "PUT /api/config/text (ok)");

    let on_disk = h.on_disk();
    assert!(
        on_disk.contains(API_KEY) && on_disk.contains(HASH_SECRET),
        "an untouched placeholder must resolve back to the stored secret, got: {on_disk}"
    );
    assert!(
        !on_disk.contains("********"),
        "a placeholder was written to disk as though it were a credential: {on_disk}"
    );
    assert!(
        on_disk.contains("model: claude-sonnet-5"),
        "the edit was not applied: {on_disk}"
    );
    assert!(
        on_disk.contains("# Tendril configuration - hand-edited, do not reorder."),
        "the save re-rendered the file instead of writing the user's bytes: {on_disk}"
    );
}

#[tokio::test]
async fn an_invalid_save_is_refused_without_quoting_the_value_that_caused_it() {
    let h = harness(&fixture());
    let text = h.get().await.text();

    // `llm` as a scalar where the config wants a mapping: `serde_yaml` rejects it, and its message
    // names the offending region - which is where an unfiltered error would pick up the rest of the
    // document.
    let broken = format!("{text}\nllm: 12345\n");
    let reply = h.put(&broken).await;

    assert_eq!(
        reply.status,
        StatusCode::BAD_REQUEST,
        "an unloadable config must be refused: {}",
        reply.body
    );
    assert_no_credential(&reply.body, "PUT /api/config/text (invalid)");
    assert!(
        !reply.json()["error"]
            .as_str()
            .unwrap_or_default()
            .is_empty(),
        "the editor shows this string, so it cannot be empty: {}",
        reply.body
    );

    // The refusal is total. A partial write here is worse than no write: it leaves a daemon that
    // cannot load its own config, which is the V1 defect this route exists to avoid.
    let on_disk = h.on_disk();
    assert!(
        on_disk.contains(API_KEY) && on_disk.contains(HASH_SECRET),
        "a rejected save damaged the stored secrets: {on_disk}"
    );
    assert!(
        !on_disk.contains("llm: 12345"),
        "a rejected save reached disk: {on_disk}"
    );
}

#[tokio::test]
async fn a_file_the_scanner_cannot_mask_fails_the_read_closed() {
    // A block scalar under a secret key. The line scanner cannot see inside one, so it cannot
    // promise the value is masked - and serving the document anyway would put the key in the
    // webview.
    let h = harness(&format!(
        "llm:\n  provider: anthropic\n  apiKey: |\n    {API_KEY}\n"
    ));
    let reply = h.get().await;

    assert_ne!(
        reply.status,
        StatusCode::OK,
        "a document the scanner cannot mask must not be served: {}",
        reply.body
    );
    assert_no_credential(&reply.body, "GET /api/config/text (unmaskable)");
    assert!(
        reply.json()["error"]
            .as_str()
            .unwrap_or_default()
            .contains("apiKey"),
        "the error should name the path it could not mask: {}",
        reply.body
    );
}

#[tokio::test]
async fn a_missing_config_reads_as_an_empty_document() {
    // A fresh install, before anything has written `config.yaml`. The editor should open on a blank
    // document rather than refuse to open, so a first-run operator can write one.
    let h = harness("");
    std::fs::remove_file(&h.config_path).expect("remove config");

    let reply = h.get().await;
    assert_eq!(reply.status, StatusCode::OK, "body: {}", reply.body);
    assert_eq!(reply.text(), "", "body: {}", reply.body);
}

/// A rejected save must not echo the submitted document.
///
/// Separate from the test above because the two catch different mistakes, and only this one catches
/// the worst-shaped version of them. There, the credentials are the *stored* ones and the submission
/// still holds placeholders, so an implementation that returned `format!("invalid: {submitted}")`
/// would pass: there is nothing secret in the text to leak. The dangerous case is the one here — the
/// operator has overtyped a placeholder with a real new key and the save is then refused for an
/// unrelated reason. The new key has never been to disk, so no amount of masking protects it; the
/// only thing that does is the error being built from the failure rather than from the body.
///
/// This is the shape the frontend's `readError` is also written against ("deliberately never the
/// request body"), and the mutant it kills is a one-line change that every other test here accepts.
#[tokio::test]
async fn a_refused_save_does_not_echo_the_submitted_document() {
    const TYPED_KEY: &str = "sk-ant-freshly-typed-419af0c2";

    let h = harness(&fixture());
    let text = h.get().await.text();

    // The operator replaces the masked key with a new one, and separately breaks the document. The
    // break is what `serde_yaml` will complain about, so a correctly built message has no reason to
    // mention the key at all.
    let edited = text.replace("\"********\"", &format!("\"{TYPED_KEY}\""));
    assert!(
        edited.contains(TYPED_KEY),
        "fixture drift: the placeholder was not where this test expects it"
    );
    let reply = h.put(&format!("{edited}\nllm: 12345\n")).await;

    assert_eq!(
        reply.status,
        StatusCode::BAD_REQUEST,
        "body: {}",
        reply.body
    );
    assert!(
        !reply.body.contains(TYPED_KEY) && !reply.body.contains(&TYPED_KEY[..8]),
        "the refusal echoed a credential the operator had typed but not saved: {}",
        reply.body
    );
    assert_no_credential(&reply.body, "PUT /api/config/text (typed-over placeholder)");
}
