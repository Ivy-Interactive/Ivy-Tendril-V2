//! `/api/tunnel/share`, and what a share's capability token does — and does not — buy at
//! `GET /ivy/local-file`.
//!
//! No tunnel is ever started here: the state file is written directly, which is exactly what a running
//! share leaves behind, so the guard and the routes are exercised against real state without a
//! `cloudflared` and without touching the network.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use tendril_core::config::{save_config, TendrilSettings};
use tendril_core::tunnel::share_state::{self, ShareSession};
use tendril_server::{create_router, AppState};
use tower::ServiceExt;

const TUNNEL_HOST: &str = "calm-otter-reads-plans.trycloudflare.com";

struct Harness {
    tendril_home: PathBuf,
    plans_dir: PathBuf,
    secret: String,
    router: Router,
}

impl Drop for Harness {
    fn drop(&mut self) {
        // Nothing was started, so there is nothing to stop; only the fixture has to go.
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

fn harness() -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-share-tunnel-routes-{}",
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
    /// The state a live share leaves on disk. Returns the capability token.
    fn publish_share(&self) -> String {
        let token = share_state::mint_token();
        share_state::write(
            &self.tendril_home,
            &ShareSession {
                url: format!("https://{TUNNEL_HOST}"),
                host: TUNNEL_HOST.to_string(),
                token: token.clone(),
                pid: 0,
                started_at: "2026-09-16T10:00:00Z".to_string(),
            },
        )
        .expect("write share state");
        token
    }

    fn fixture_png(&self) -> PathBuf {
        let path = self.plans_dir.join("00001-Test/Artifacts/screenshot.png");
        std::fs::create_dir_all(path.parent().unwrap()).expect("create parent");
        std::fs::write(&path, "not really a png").expect("write fixture");
        path
    }

    async fn send(&self, request: Request<Body>) -> (StatusCode, String) {
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("router responds");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("read body");
        (status, String::from_utf8_lossy(&bytes).to_string())
    }

    async fn request(
        &self,
        method: &str,
        uri: &str,
        headers: &[(&str, &str)],
    ) -> (StatusCode, String) {
        let mut builder = Request::builder().method(method).uri(uri);
        if !headers.iter().any(|(name, _)| *name == "host") {
            builder = builder.header("host", "localhost:5010");
        }
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        self.send(builder.body(Body::empty()).expect("build request"))
            .await
    }

    fn bearer(&self) -> String {
        format!("Bearer {}", self.secret)
    }

    fn local_file_uri(&self, path: &Path, token: &str) -> String {
        format!("/ivy/local-file?path={}&token={}", path.display(), token)
    }
}

// ---------------------------------------------------------------------------
// The control routes
// ---------------------------------------------------------------------------

#[tokio::test]
async fn status_reports_disabled_before_anything_is_shared() {
    let h = harness();
    let (status, body) = h
        .request(
            "GET",
            "/api/tunnel/share",
            &[("authorization", &h.bearer())],
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    assert_eq!(json["status"], "disabled");
    assert!(json.get("url").is_none(), "no URL before a share exists");
    assert!(
        json.get("shareToken").is_none(),
        "no token before a share exists"
    );
    assert!(json["installed"].is_boolean());
}

/// Every control route is owner-only. A visitor must not be able to read the token, and certainly not
/// start or stop a share.
#[tokio::test]
async fn the_control_routes_require_the_bearer_credential() {
    let h = harness();
    let share_token = h.publish_share();

    for (method, uri) in [
        ("GET", "/api/tunnel/share"),
        ("POST", "/api/tunnel/share"),
        ("DELETE", "/api/tunnel/share"),
        ("GET", "/api/tunnel/share/install"),
        // Without the bearer, an anonymous caller could make the daemon fetch a binary or abort an
        // operator's install. Both are owner-only, exactly like starting a tunnel.
        ("POST", "/api/tunnel/share/install"),
        ("DELETE", "/api/tunnel/share/install"),
    ] {
        let (status, _) = h.request(method, uri, &[]).await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{method} {uri} with no credential"
        );

        // The share's own capability token is not a credential for these routes, whether it is offered
        // as a bearer or in the query string.
        let (status, _) = h
            .request(
                method,
                uri,
                &[("authorization", &format!("Bearer {share_token}"))],
            )
            .await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{method} {uri} with a share token"
        );

        let (status, _) = h
            .request(method, &format!("{uri}?token={share_token}"), &[])
            .await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{method} {uri} with a share token in the query"
        );
    }
}

/// The install check has to be actionable even when nothing is installed, because that is the state a
/// fresh machine is in and the message is the only install instruction the UI has.
#[tokio::test]
async fn the_install_check_says_what_to_install_and_where() {
    let h = harness();
    let (status, body) = h
        .request(
            "GET",
            "/api/tunnel/share/install",
            &[("authorization", &h.bearer())],
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    assert!(json["installed"].is_boolean());
    let expected = json["expectedPath"].as_str().expect("expectedPath");
    assert!(
        expected.ends_with("cloudflared") || expected.ends_with("cloudflared.exe"),
        "{expected}"
    );
    assert!(
        expected.contains(&h.tendril_home.display().to_string()),
        "the expected path is inside this install's home: {expected}"
    );
    let url = json["downloadUrl"].as_str().expect("downloadUrl");
    assert!(
        url.starts_with("https://github.com/cloudflare/cloudflared/releases/"),
        "{url}"
    );
    assert!(url.ends_with(json["assetName"].as_str().expect("assetName")));

    // The manual instructions are still the fallback, and the state now also says whether the daemon
    // can fetch it, so the pane can offer Install rather than only quoting a URL.
    assert!(
        json["downloadable"].is_boolean(),
        "the pane needs to know whether Install is on offer: {json}"
    );
}

/// The install endpoints exist, are reachable by the owner, and do nothing until asked.
///
/// The fresh-install regression this feature fixes: a `GET` alone must never start a download, and the
/// `POST` that does is a background job the caller watches through the same `GET`.
#[tokio::test]
async fn an_install_starts_only_when_it_is_asked_for_and_reports_progress_through_the_get() {
    let h = harness();

    // Reading the state is not an install. Nothing is in flight because nothing asked for one.
    let (status, body) = h
        .request(
            "GET",
            "/api/tunnel/share/install",
            &[("authorization", &h.bearer())],
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let json: serde_json::Value = serde_json::from_str(&body).expect("json");
    let phase = json["progress"]["phase"].as_str().unwrap_or("idle");
    assert_eq!(
        phase, "idle",
        "a status read must not start a download: {json}"
    );

    // Cancelling when nothing runs is not an error: the caller wanted no install running, and there is
    // none. It is also the way out of one, so it must never 404 or 500.
    let (status, body) = h
        .request(
            "DELETE",
            "/api/tunnel/share/install",
            &[("authorization", &h.bearer())],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

/// An operator-set `shareTunnel.binaryPath` that does not resolve is refused rather than quietly
/// downloading a second copy into `tools/` that `resolve_binary` would never use. The distinction
/// between "your configured path is wrong" and "cloudflared is missing" has to survive the download.
#[tokio::test]
async fn an_install_is_refused_when_the_operator_configured_a_binary_path() {
    let h = harness();
    std::fs::write(
        h.tendril_home.join("config.yaml"),
        "shareTunnel:\n  binaryPath: /definitely/not/here/cloudflared\n",
    )
    .expect("write config");

    let (status, body) = h
        .request(
            "POST",
            "/api/tunnel/share/install",
            &[("authorization", &h.bearer())],
        )
        .await;

    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert!(
        body.contains("shareTunnel.binaryPath"),
        "the operator's own setting must be named, not 'cloudflared is not installed': {body}"
    );
}

/// Starting with a `binaryPath` that does not exist must be a clear refusal, not a 500 and not a
/// half-started share. `409` because the request is fine and the environment is not.
#[tokio::test]
async fn starting_with_a_missing_binary_is_a_conflict_with_an_actionable_message() {
    let h = harness();
    std::fs::write(
        h.tendril_home.join("config.yaml"),
        "shareTunnel:\n  binaryPath: /definitely/not/here/cloudflared\n",
    )
    .expect("write config");

    let (status, body) = h
        .request(
            "POST",
            "/api/tunnel/share",
            &[("authorization", &h.bearer())],
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("shareTunnel.binaryPath"), "{body}");

    // And nothing was published.
    assert!(share_state::read(&h.tendril_home).is_none());
    let (_, body) = h
        .request(
            "GET",
            "/api/tunnel/share",
            &[("authorization", &h.bearer())],
        )
        .await;
    assert!(body.contains("\"disabled\""), "{body}");
}

/// Stopping when nothing is running is a no-op that still revokes any recorded share — the important
/// half, because a stale record is a live capability.
#[tokio::test]
async fn stopping_revokes_a_recorded_share_even_with_no_supervisor_running() {
    let h = harness();
    let token = h.publish_share();
    assert!(share_state::accepts_token(&h.tendril_home, &token));

    let (status, body) = h
        .request(
            "DELETE",
            "/api/tunnel/share",
            &[("authorization", &h.bearer())],
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("\"disabled\""), "{body}");
    assert!(
        !share_state::accepts_token(&h.tendril_home, &token),
        "the token must stop working"
    );
    assert!(share_state::read(&h.tendril_home).is_none());
}

// ---------------------------------------------------------------------------
// What the share token buys at /ivy/local-file
// ---------------------------------------------------------------------------

/// The point of the whole host-policy hook: a shared plan's screenshots have to load for the visitor.
#[tokio::test]
async fn a_share_token_on_the_tunnel_host_can_read_a_plan_image() {
    let h = harness();
    let png = h.fixture_png();
    let token = h.publish_share();

    let (status, _) = h
        .request(
            "GET",
            &h.local_file_uri(&png, &token),
            &[("host", TUNNEL_HOST)],
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

/// Without an active share the exact same request is refused, host and all. This is the port of the
/// original's `IsConnected` guard on the tunnel-host branch.
#[tokio::test]
async fn the_tunnel_host_is_not_allowed_when_no_share_is_running() {
    let h = harness();
    let png = h.fixture_png();
    let token = h.publish_share();

    // Take the share down, keep the link.
    share_state::clear(&h.tendril_home);

    let (status, _) = h
        .request(
            "GET",
            &h.local_file_uri(&png, &token),
            &[("host", TUNNEL_HOST)],
        )
        .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "a revoked token is not a credential"
    );

    // Even with the owner's own secret, the tunnel host is no longer an allowed host.
    let (status, _) = h
        .request(
            "GET",
            &h.local_file_uri(&png, &h.secret),
            &[("host", TUNNEL_HOST)],
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// A share token is scoped to the share's host. A leaked link must not be replayable against loopback
/// or a LAN address, which are reachable by anyone already inside the network.
#[tokio::test]
async fn a_share_token_is_refused_on_any_other_host() {
    let h = harness();
    let png = h.fixture_png();
    let token = h.publish_share();

    for host in [
        "localhost:5010",
        "127.0.0.1:5010",
        "192.168.1.20",
        "mymac.local",
    ] {
        let (status, _) = h
            .request("GET", &h.local_file_uri(&png, &token), &[("host", host)])
            .await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "a share token must not work on {host}"
        );
    }
}

/// A near-miss token is not a token, and neither is a prefix of one.
#[tokio::test]
async fn a_wrong_share_token_is_refused_on_the_tunnel_host() {
    let h = harness();
    let png = h.fixture_png();
    let token = h.publish_share();

    for wrong in [
        String::new(),
        "not-the-token".to_string(),
        token[..token.len() - 1].to_string(),
        format!("{token}x"),
        token.to_uppercase(),
    ] {
        let (status, _) = h
            .request(
                "GET",
                &h.local_file_uri(&png, &wrong),
                &[("host", TUNNEL_HOST)],
            )
            .await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "token {wrong:?} must be refused"
        );
    }
}

/// Being on the tunnel host with a valid share token does not relax any of the guard's other layers:
/// the extension allowlist, root confinement and the cross-site checks all still apply. A share that
/// served `~/.ssh/id_rsa` because the visitor asked nicely would be worse than no share at all.
#[tokio::test]
async fn a_share_token_does_not_widen_the_rest_of_the_guard() {
    let h = harness();
    let token = h.publish_share();
    let tunnel = [("host", TUNNEL_HOST)];

    // A disallowed extension inside a root.
    let secret_file = h.plans_dir.join("00001-Test/Artifacts/notes.txt");
    std::fs::create_dir_all(secret_file.parent().unwrap()).unwrap();
    std::fs::write(&secret_file, "sensitive").unwrap();
    let (status, _) = h
        .request("GET", &h.local_file_uri(&secret_file, &token), &tunnel)
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "extension allowlist still applies"
    );

    // A traversal out of every root.
    let (status, _) = h
        .request(
            "GET",
            &format!(
                "/ivy/local-file?path={}/../../../../etc/hosts&token={token}",
                h.plans_dir.display()
            ),
            &tunnel,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "root confinement still applies"
    );

    // An image outside every root.
    let outside_dir = std::env::temp_dir().join(format!(
        "tendril-share-outside-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let outside = outside_dir.join("secret.png");
    std::fs::create_dir_all(&outside_dir).unwrap();
    std::fs::write(&outside, "secret").unwrap();
    let (status, _) = h
        .request("GET", &h.local_file_uri(&outside, &token), &tunnel)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(&outside_dir);

    // A cross-site fetch, i.e. another page embedding the tunnel's files.
    let png = h.fixture_png();
    let (status, _) = h
        .request(
            "GET",
            &h.local_file_uri(&png, &token),
            &[("host", TUNNEL_HOST), ("sec-fetch-site", "cross-site")],
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // And a cross-origin one.
    let (status, _) = h
        .request(
            "GET",
            &h.local_file_uri(&png, &token),
            &[("host", TUNNEL_HOST), ("origin", "http://evil.example.com")],
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// A share token is *only* a local-file credential. It must not open the API — which is the whole
/// difference between V2 and the original, where the API was open and the nav filter was the fence.
#[tokio::test]
async fn a_share_token_does_not_authenticate_the_api() {
    let h = harness();
    let token = h.publish_share();

    for uri in [
        "/api/plans",
        "/api/config",
        "/api/jobs",
        "/api/chat/sessions",
        "/api/projects",
        "/api/vaults",
    ] {
        // As a bearer.
        let (status, _) = h
            .request(
                "GET",
                uri,
                &[
                    ("host", TUNNEL_HOST),
                    ("authorization", &format!("Bearer {token}")),
                ],
            )
            .await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "GET {uri} with a share bearer"
        );

        // As `?token=`, the spelling the local-file endpoint accepts.
        let (status, _) = h
            .request(
                "GET",
                &format!("{uri}?token={token}"),
                &[("host", TUNNEL_HOST)],
            )
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "GET {uri}?token=");

        // And as an X-Api-Key, the other alias the middleware honours.
        let (status, _) = h
            .request("GET", uri, &[("host", TUNNEL_HOST), ("x-api-key", &token)])
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "GET {uri} with X-Api-Key");
    }
}

/// The owner opening their own share link still works: a first-party credential is accepted on the
/// tunnel host too, rather than the tunnel host being reserved for share tokens.
#[tokio::test]
async fn the_owners_secret_still_works_on_the_tunnel_host() {
    let h = harness();
    let png = h.fixture_png();
    h.publish_share();

    let (status, _) = h
        .request(
            "GET",
            &h.local_file_uri(&png, &h.secret),
            &[("host", TUNNEL_HOST)],
        )
        .await;
    assert_eq!(status, StatusCode::OK);
}

/// A corrupt state file must fail closed: no host allowance, no token.
#[tokio::test]
async fn a_corrupt_share_record_grants_nothing() {
    let h = harness();
    let png = h.fixture_png();
    let token = h.publish_share();
    std::fs::write(
        share_state::state_path(&h.tendril_home),
        b"{ this is not json",
    )
    .unwrap();

    let (status, _) = h
        .request(
            "GET",
            &h.local_file_uri(&png, &token),
            &[("host", TUNNEL_HOST)],
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
