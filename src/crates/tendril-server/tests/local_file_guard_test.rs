//! Route-level tests for `GET /ivy/local-file`. This endpoint reads a caller-named path off disk, so
//! the tests that matter are the ones asserting a request is **refused**: a suite that only proved the
//! happy path would pass just as happily against an unguarded file server.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use tendril_core::config::{save_config, SecuritySettings, TendrilSettings};
use tendril_server::{create_router, AppState};
use tower::ServiceExt;

struct Harness {
    tendril_home: PathBuf,
    plans_dir: PathBuf,
    secret: String,
    router: Router,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

fn harness(allowed_hosts: Option<Vec<String>>) -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-local-file-guard-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");

    let settings = TendrilSettings {
        security: Some(SecuritySettings {
            allowed_hosts,
            ..SecuritySettings::default()
        }),
        ..TendrilSettings::default()
    };
    save_config(&tendril_home.join("config.yaml"), &settings).expect("write config");

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir.clone(),
        secret.clone(),
    ));

    Harness {
        tendril_home,
        plans_dir,
        secret,
        router: create_router(state),
    }
}

impl Harness {
    /// A PNG inside the plans folder — a legitimate plan screenshot, and the file every rejection
    /// test points at so a refusal can only be the guard's doing.
    fn fixture_png(&self) -> PathBuf {
        let path = self.plans_dir.join("00001-Test/Artifacts/screenshot.png");
        write_file(&path, "not really a png");
        path
    }

    async fn get(
        &self,
        uri: &str,
        headers: &[(&str, &str)],
    ) -> (StatusCode, Vec<(String, String)>) {
        let mut builder = Request::builder().uri(uri);
        // Every request is addressed to localhost unless a test overrides it.
        if !headers.iter().any(|(name, _)| *name == "host") {
            builder = builder.header("host", "localhost:5010");
        }
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        let request = builder.body(Body::empty()).expect("build request");

        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("router responds");
        let status = response.status();
        let headers = response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.as_str().to_string(),
                    value.to_str().unwrap_or_default().to_string(),
                )
            })
            .collect();
        (status, headers)
    }

    fn uri(&self, path: &Path, token: &str) -> String {
        format!("/ivy/local-file?path={}&token={}", path.display(), token)
    }
}

fn write_file(path: &Path, contents: &str) {
    std::fs::create_dir_all(path.parent().expect("has a parent")).expect("create parent");
    std::fs::write(path, contents).expect("write fixture");
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

/// The credential check runs before everything else, so an unauthenticated caller cannot use the
/// endpoint's other answers to probe hosts, extensions or the filesystem.
#[tokio::test]
async fn test_missing_or_wrong_token_is_401_before_any_other_check() {
    let h = harness(None);
    let png = h.fixture_png();

    let (status, _) = h
        .get(
            &format!("/ivy/local-file?path={}", png.display()),
            &[("host", "localhost")],
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "no token at all");

    let (status, _) = h.get(&h.uri(&png, "not-the-secret"), &[]).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "wrong token");

    // Wrong token *and* a disallowed host: still 401, proving the token check comes first.
    let (status, _) = h
        .get(
            &h.uri(&png, "not-the-secret"),
            &[("host", "evil.example.com")],
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Wrong token and a traversal path: 401, not the 404 the path would otherwise earn.
    let (status, _) = h
        .get(
            &format!(
                "/ivy/local-file?path={}/../../../../etc/hosts&token=nope",
                h.plans_dir.display()
            ),
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_disallowed_host_is_403() {
    let h = harness(None);
    let png = h.fixture_png();

    let (status, _) = h
        .get(&h.uri(&png, &h.secret), &[("host", "evil.example.com")])
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = h.get(&h.uri(&png, &h.secret), &[("host", "")]).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "an empty Host is not allowed"
    );
}

#[tokio::test]
async fn test_allowed_hosts_are_served() {
    let h = harness(Some(vec!["tendril.example.com".to_string()]));
    let png = h.fixture_png();

    for host in [
        "localhost:5010",
        "127.0.0.1:5010",
        "[::1]:5010",
        "10.1.2.3:5010",
        "192.168.0.9",
        "mymac.local",
        // From security.allowedHosts, case-insensitively.
        "TENDRIL.example.com",
    ] {
        let (status, _) = h.get(&h.uri(&png, &h.secret), &[("host", host)]).await;
        assert_eq!(status, StatusCode::OK, "host {host} should be served");
    }
}

#[tokio::test]
async fn test_cross_origin_and_cross_site_requests_are_403() {
    let h = harness(None);
    let png = h.fixture_png();

    let (status, _) = h
        .get(
            &h.uri(&png, &h.secret),
            &[
                ("host", "localhost:5010"),
                ("origin", "http://evil.example.com"),
            ],
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "cross-origin Origin");

    let (status, _) = h
        .get(
            &h.uri(&png, &h.secret),
            &[("host", "localhost:5010"), ("sec-fetch-site", "cross-site")],
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Sec-Fetch-Site: cross-site");

    // Same-origin and same-site requests are unaffected.
    let (status, _) = h
        .get(
            &h.uri(&png, &h.secret),
            &[
                ("host", "localhost:5010"),
                ("origin", "http://localhost:5010"),
                ("sec-fetch-site", "same-origin"),
            ],
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

/// A blocked extension is answered exactly like an absent file, so the endpoint cannot be used to
/// find out what exists.
#[tokio::test]
async fn test_disallowed_extension_is_404_even_when_the_file_exists() {
    let h = harness(None);

    for name in [
        "notes.txt",
        ".env",
        "config.yaml",
        "Makefile",
        "archive.tar.gz",
    ] {
        let path = h.plans_dir.join(format!("00001-Test/Artifacts/{name}"));
        write_file(&path, "sensitive");
        assert!(path.exists());

        let (status, _) = h.get(&h.uri(&path, &h.secret), &[]).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{name} must not be served");
    }
}

#[tokio::test]
async fn test_traversal_and_symlink_escape_are_404() {
    let h = harness(None);
    let _ = h.fixture_png();

    // Traversal out of the plans folder.
    let (status, _) = h
        .get(
            &format!(
                "/ivy/local-file?path={}/../../../../etc/hosts&token={}",
                h.plans_dir.display(),
                h.secret
            ),
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // A file outside every root, with an allowed extension, requested directly.
    let outside_dir = std::env::temp_dir().join(format!(
        "tendril-local-file-outside-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let outside = outside_dir.join("secret.png");
    write_file(&outside, "secret");
    let (status, _) = h.get(&h.uri(&outside, &h.secret), &[]).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // A symlink *inside* a root whose target is outside it, and whose extension is allowed — the case
    // an extension check plus a string-prefix containment check would happily serve.
    #[cfg(unix)]
    {
        let link = h.plans_dir.join("00001-Test/Artifacts/link.png");
        std::os::unix::fs::symlink(&outside, &link).expect("symlink created");
        assert!(std::fs::read(&link).is_ok(), "the link resolves on disk");
        let (status, _) = h.get(&h.uri(&link, &h.secret), &[]).await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "symlink escape must be refused"
        );
    }

    let _ = std::fs::remove_dir_all(&outside_dir);
}

#[tokio::test]
async fn test_allowed_image_is_served_with_hardening_headers() {
    let h = harness(None);
    let png = h.fixture_png();

    let (status, headers) = h.get(&h.uri(&png, &h.secret), &[]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(header(&headers, "x-content-type-options"), Some("nosniff"));
    assert_eq!(
        header(&headers, "content-security-policy"),
        Some("default-src 'none'; sandbox")
    );
    assert_eq!(header(&headers, "content-type"), Some("image/png"));
}

/// A screenshot that has been deleted is a 404, not a 500 — and it is still hardened, so the failure
/// mode of the guard's last step cannot be told apart from a refusal.
#[tokio::test]
async fn test_missing_file_inside_a_root_is_404_and_still_hardened() {
    let h = harness(None);
    let missing = h.plans_dir.join("00001-Test/Artifacts/gone.png");

    let (status, headers) = h.get(&h.uri(&missing, &h.secret), &[]).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(header(&headers, "x-content-type-options"), Some("nosniff"));
    assert_eq!(
        header(&headers, "content-security-policy"),
        Some("default-src 'none'; sandbox")
    );
}

/// The endpoint must not be reachable through the bearer layer's credentials alone, and a directory
/// is not a file.
#[tokio::test]
async fn test_directory_and_empty_path_are_refused() {
    let h = harness(None);

    let (status, _) = h.get(&h.uri(&h.plans_dir.clone(), &h.secret), &[]).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "no extension on a directory");

    let (status, _) = h
        .get(&format!("/ivy/local-file?path=&token={}", h.secret), &[])
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
