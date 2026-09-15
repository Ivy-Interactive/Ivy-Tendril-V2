//! The `api.apiKey` layer. The assertion that matters most is the first one: an install that has
//! never configured a key must behave exactly as it does today, because that is every install.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use tendril_core::config::{save_config, ApiSettings, TendrilSettings};
use tendril_server::{create_router, AppState};
use tower::ServiceExt;

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

fn harness(api_key: Option<&str>) -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-api-key-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");

    let settings = TendrilSettings {
        api: api_key.map(|key| ApiSettings {
            api_key: Some(key.to_string()),
            ..ApiSettings::default()
        }),
        ..TendrilSettings::default()
    };
    save_config(&tendril_home.join("config.yaml"), &settings).expect("write config");

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

impl Harness {
    async fn get(&self, uri: &str, headers: &[(&str, &str)]) -> StatusCode {
        let mut builder = Request::builder().uri(uri).header("host", "localhost:5010");
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        let request = builder.body(Body::empty()).expect("build request");
        self.router
            .clone()
            .oneshot(request)
            .await
            .expect("router responds")
            .status()
    }

    fn bearer(&self) -> String {
        format!("Bearer {}", self.secret)
    }
}

/// Backward compatibility: with no key configured, the bearer path is untouched.
#[tokio::test]
async fn test_no_api_key_configured_leaves_bearer_requests_alone() {
    let h = harness(None);

    assert_eq!(
        h.get("/api/plans", &[("authorization", &h.bearer())]).await,
        StatusCode::OK
    );
    assert_eq!(h.get("/api/plans", &[]).await, StatusCode::UNAUTHORIZED);
    assert_eq!(
        h.get("/api/plans", &[("authorization", "Bearer wrong")])
            .await,
        StatusCode::UNAUTHORIZED
    );
    // An X-Api-Key nobody asked for is simply ignored.
    assert_eq!(
        h.get(
            "/api/plans",
            &[("authorization", &h.bearer()), ("x-api-key", "whatever")]
        )
        .await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn test_configured_api_key_is_required_in_addition_to_the_bearer_credential() {
    let h = harness(Some("s3cret-api-key"));

    // Bearer alone is no longer enough.
    assert_eq!(
        h.get("/api/plans", &[("authorization", &h.bearer())]).await,
        StatusCode::UNAUTHORIZED,
        "missing X-Api-Key"
    );
    assert_eq!(
        h.get(
            "/api/plans",
            &[("authorization", &h.bearer()), ("x-api-key", "wrong-key")]
        )
        .await,
        StatusCode::UNAUTHORIZED,
        "wrong X-Api-Key"
    );

    // The key alone is not enough either — it is an "and", not an "or".
    assert_eq!(
        h.get("/api/plans", &[("x-api-key", "s3cret-api-key")])
            .await,
        StatusCode::UNAUTHORIZED,
        "API key without a bearer credential"
    );
    assert_eq!(
        h.get(
            "/api/plans",
            &[
                ("authorization", "Bearer wrong"),
                ("x-api-key", "s3cret-api-key")
            ]
        )
        .await,
        StatusCode::UNAUTHORIZED,
        "API key with a wrong bearer credential"
    );

    // Both together get through.
    assert_eq!(
        h.get(
            "/api/plans",
            &[
                ("authorization", &h.bearer()),
                ("x-api-key", "s3cret-api-key")
            ]
        )
        .await,
        StatusCode::OK
    );
}

/// The readiness probes stay usable by a process holding no credentials — that is what they are for.
#[tokio::test]
async fn test_ping_and_health_stay_open_with_a_key_configured() {
    let h = harness(Some("s3cret-api-key"));

    assert_eq!(h.get("/api/ping", &[]).await, StatusCode::OK);
    assert_eq!(h.get("/api/health", &[]).await, StatusCode::OK);
}

/// `GET /api/auth/status` is unauthenticated, but a configured key still applies to it, as it does to
/// every `/api` path in the original.
#[tokio::test]
async fn test_auth_status_requires_a_configured_api_key() {
    let h = harness(Some("s3cret-api-key"));

    assert_eq!(
        h.get("/api/auth/status", &[]).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        h.get("/api/auth/status", &[("x-api-key", "s3cret-api-key")])
            .await,
        StatusCode::OK
    );
}

/// A blank key is treated as no key: an install that wrote `apiKey: ""` is not locked out.
#[tokio::test]
async fn test_blank_api_key_is_treated_as_unset() {
    let h = harness(Some("   "));

    assert_eq!(
        h.get("/api/plans", &[("authorization", &h.bearer())]).await,
        StatusCode::OK
    );
}
