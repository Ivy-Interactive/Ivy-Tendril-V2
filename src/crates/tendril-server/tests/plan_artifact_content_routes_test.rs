//! `GET /api/plans/:id/artifacts/content` — the read behind the Review app's artifact sheet.
//!
//! The containment rule itself is pinned in `tendril-core`'s `plan_review_surfaces_test`; what these
//! pin is the route: that it is wired, that it answers the listing's own paths, that each refusal
//! arrives as the status the app branches on, and that it sits behind the bearer secret like every
//! other plan read.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use tendril_core::config::{save_config, TendrilSettings};
use tendril_server::{create_router, AppState};
use tower::ServiceExt;

struct Harness {
    tendril_home: PathBuf,
    artifacts_dir: PathBuf,
    secret: String,
    router: Router,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

/// A daemon over one plan, `00031`, whose `Artifacts` folder holds a log and a binary file.
fn harness() -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-artifact-content-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let plans_dir = tendril_home.join("Plans");
    let plan_folder = plans_dir.join("00031-ArtifactSheet");
    let artifacts_dir = plan_folder.join("Artifacts");
    std::fs::create_dir_all(&artifacts_dir).expect("create artifacts dir");
    std::fs::write(plan_folder.join("plan.yaml"), "state: Review\n").expect("write plan.yaml");
    std::fs::write(artifacts_dir.join("output.log"), "build ok\n").expect("write log");
    std::fs::write(artifacts_dir.join("bundle.zip"), b"PK\x03\x04\x00").expect("write zip");
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
        artifacts_dir,
        secret,
        router: create_router(state),
    }
}

impl Harness {
    async fn get(
        &self,
        plan_id: &str,
        path: &str,
        authorized: bool,
    ) -> (StatusCode, serde_json::Value) {
        let uri = format!(
            "/api/plans/{plan_id}/artifacts/content?path={}",
            urlencode(path)
        );
        let mut request = Request::builder()
            .method("GET")
            .uri(&uri)
            .header("host", "127.0.0.1:5010");
        if authorized {
            request = request.header("authorization", format!("Bearer {}", self.secret));
        }
        let response = self
            .router
            .clone()
            .oneshot(request.body(Body::empty()).expect("build request"))
            .await
            .expect("router responds");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, body)
    }

    fn artifact(&self, name: &str) -> String {
        self.artifacts_dir.join(name).to_string_lossy().to_string()
    }
}

/// Enough percent-encoding for a filesystem path in a query string.
fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                (byte as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

#[tokio::test]
async fn a_listed_text_artifact_comes_back_as_text() {
    let h = harness();

    let (status, body) = h.get("00031", &h.artifact("output.log"), true).await;

    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(
        body,
        serde_json::json!({ "kind": "text", "text": "build ok\n", "size": 9 })
    );
}

#[tokio::test]
async fn a_binary_artifact_is_reported_without_its_bytes() {
    let h = harness();

    let (status, body) = h.get("00031", &h.artifact("bundle.zip"), true).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, serde_json::json!({ "kind": "binary", "size": 5 }));
}

#[tokio::test]
async fn a_path_outside_the_artifacts_folder_is_a_bad_request() {
    let h = harness();
    let plan_yaml = h
        .artifacts_dir
        .join("..")
        .join("plan.yaml")
        .to_string_lossy()
        .to_string();

    let (status, body) = h.get("00031", &plan_yaml, true).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body["error"]
            .as_str()
            .is_some_and(|e| e.contains("Artifacts folder")),
        "body: {body}"
    );
}

#[tokio::test]
async fn a_missing_artifact_or_plan_is_not_found() {
    let h = harness();

    let (status, _) = h.get("00031", &h.artifact("gone.txt"), true).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = h.get("09999", &h.artifact("output.log"), true).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_route_needs_the_bearer_secret() {
    let h = harness();

    let (status, _) = h.get("00031", &h.artifact("output.log"), false).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
