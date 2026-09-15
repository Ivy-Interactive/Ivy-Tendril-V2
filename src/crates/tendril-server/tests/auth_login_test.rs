//! `POST /api/auth/login`, end to end: a token it issues is accepted by `auth_middleware`, failures
//! are indistinguishable from each other, the backoff engages, and — the backward-compatibility
//! assertion — an install with no usable `auth` block has login unavailable while its bearer secret
//! keeps working.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use tendril_core::auth::password::{generate_hash_secret, hash_password};
use tendril_core::config::{save_config, AuthConfig, LoginRateLimitConfig, TendrilSettings};
use tendril_server::{create_router, AppState};
use tower::ServiceExt;

const PASSWORD: &str = "correct horse battery staple";

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

fn harness(auth: Option<AuthConfig>) -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-auth-login-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");

    let settings = TendrilSettings {
        auth,
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

/// A configured install: username `admin`, the password above, and a tight rate limit so the backoff
/// is reached without 20 requests.
fn configured_auth() -> AuthConfig {
    let hash_secret = generate_hash_secret();
    let password = hash_password(PASSWORD, &hash_secret).expect("hash the fixture password");

    AuthConfig {
        username: Some("admin".to_string()),
        password,
        hash_secret,
        rate_limit: Some(LoginRateLimitConfig {
            threshold: 1,
            base_delay_seconds: 30.0,
            max_delay_seconds: 60.0,
        }),
        ..AuthConfig::default()
    }
}

impl Harness {
    async fn login(
        &self,
        username: &str,
        password: &str,
    ) -> (StatusCode, serde_json::Value, Option<String>) {
        let body = serde_json::json!({ "username": username, "password": password });
        let request = Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("host", "localhost:5010")
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .expect("build request");

        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("router responds");
        let status = response.status();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("read body");
        let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, json, retry_after)
    }

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
}

#[tokio::test]
async fn test_successful_login_returns_a_token_the_bearer_layer_accepts() {
    let h = harness(Some(configured_auth()));

    let (status, body, _) = h.login("admin", PASSWORD).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    let token = body["token"].as_str().expect("a token").to_string();
    assert_eq!(body["tokenType"], "Bearer");
    assert_eq!(body["expiresIn"], 900);

    // The token is a credential for the protected routes, alongside the bearer secret.
    assert_eq!(
        h.get(
            "/api/plans",
            &[("authorization", &format!("Bearer {token}"))]
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(
        h.get(
            "/api/plans",
            &[("authorization", &format!("Bearer {}", h.secret))]
        )
        .await,
        StatusCode::OK,
        "the original bearer secret must keep working"
    );

    // A tampered token is not.
    let tampered = format!("{}x", &token[..token.len() - 1]);
    assert_eq!(
        h.get(
            "/api/plans",
            &[("authorization", &format!("Bearer {tampered}"))]
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

/// A wrong username and a wrong password are answered identically, so the endpoint does not confirm
/// which half was right.
#[tokio::test]
async fn test_wrong_credentials_are_401_and_indistinguishable() {
    let h = harness(Some(configured_auth()));

    let (wrong_password_status, wrong_password_body, _) =
        h.login("admin", "not-the-password").await;
    assert_eq!(wrong_password_status, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong_password_body["error"], "Invalid credentials");

    // A second harness, so the first failure's backoff does not colour this one.
    let h2 = harness(Some(configured_auth()));
    let (wrong_user_status, wrong_user_body, _) = h2.login("nobody", PASSWORD).await;
    assert_eq!(wrong_user_status, StatusCode::UNAUTHORIZED);
    assert_eq!(wrong_user_body, wrong_password_body);
}

/// The regression guard the task asks for: past the configured threshold the endpoint stops answering
/// at all, with a `Retry-After` telling the caller how long for.
#[tokio::test]
async fn test_repeated_failures_are_rate_limited_with_retry_after() {
    let h = harness(Some(configured_auth()));

    // threshold 1: the first failure is free, the second crosses it.
    let (status, _, _) = h.login("admin", "wrong-1").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = h.login("admin", "wrong-2").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (status, body, retry_after) = h.login("admin", "wrong-3").await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS, "body: {body}");
    assert_eq!(retry_after.as_deref(), Some("30"));
    assert_eq!(body["retryAfterSeconds"], 30);

    // Even the correct password is refused while the backoff is in force — the limiter runs before any
    // password comparison.
    let (status, _, _) = h.login("admin", PASSWORD).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

/// Nobody is locked out: with no `auth` block, or the inherited `auth: {enabled: true}` shape that
/// carries no password, login is unavailable and the bearer secret is unaffected.
#[tokio::test]
async fn test_login_unavailable_without_a_configured_password() {
    for auth in [
        None,
        Some(AuthConfig::default()),
        // The `auth: {enabled: true}` shape: unknown keys are preserved, but there is still no
        // password, so `is_active()` is false.
        Some(AuthConfig {
            username: Some("admin".to_string()),
            ..AuthConfig::default()
        }),
        // A password with no hashSecret cannot be verified against anything.
        Some(AuthConfig {
            password: "$argon2i$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2E$aGFzaA".to_string(),
            ..AuthConfig::default()
        }),
    ] {
        let h = harness(auth);

        let (status, body, _) = h.login("admin", PASSWORD).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
        assert_eq!(body["error"], "Password authentication is not configured");

        assert_eq!(
            h.get(
                "/api/plans",
                &[("authorization", &format!("Bearer {}", h.secret))]
            )
            .await,
            StatusCode::OK,
            "the bearer secret must keep working"
        );
    }
}

#[tokio::test]
async fn test_auth_status_reports_whether_a_password_is_configured() {
    let configured = harness(Some(configured_auth()));
    let request = Request::builder()
        .uri("/api/auth/status")
        .header("host", "localhost:5010")
        .body(Body::empty())
        .expect("build request");
    let response = configured
        .router
        .clone()
        .oneshot(request)
        .await
        .expect("router responds");
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("read body");
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("json body");
    assert_eq!(body["passwordAuthEnabled"], true);

    let bare = harness(None);
    let request = Request::builder()
        .uri("/api/auth/status")
        .header("host", "localhost:5010")
        .body(Body::empty())
        .expect("build request");
    let response = bare
        .router
        .clone()
        .oneshot(request)
        .await
        .expect("router responds");
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
        .await
        .expect("read body");
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("json body");
    assert_eq!(body["passwordAuthEnabled"], false);
}

/// A username is only checked when one is configured, matching the original.
#[tokio::test]
async fn test_username_is_optional() {
    let mut auth = configured_auth();
    auth.username = None;
    let h = harness(Some(auth));

    let (status, body, _) = h.login("anything-at-all", PASSWORD).await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert!(body["token"].is_string());
}
