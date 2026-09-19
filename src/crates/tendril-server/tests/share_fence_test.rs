//! What a share's capability token buys against the *API*, and what the share tunnel closes off.
//!
//! `share_tunnel_routes_test` covers the tunnel's own routes and the local-file guard. This covers the
//! two changes that make a share actually usable, both of which are the security boundary rather than
//! a feature:
//!
//! - `auth_middleware` accepts the token, bound to the tunnel's host and to the deny-by-default
//!   route allow-list.
//! - The two routers that deliberately sit *outside* `auth_middleware` are refused when the request
//!   arrives over the tunnel.
//!
//! V1 fenced a share by filtering the sidebar, which is sufficient there because V1 renders the UI on
//! the server. V2 ships a bundle the visitor controls, so every assertion here is about the route,
//! not the navigation.
//!
//! No tunnel is started and nothing touches the network: the state file is written directly, which is
//! exactly what a running share leaves behind.

use std::path::PathBuf;
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
    router: Router,
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

fn harness() -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-share-fence-{}",
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
        secret,
    ));

    Harness {
        tendril_home,
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

    async fn status(&self, request: Request<Body>) -> StatusCode {
        self.router
            .clone()
            .oneshot(request)
            .await
            .expect("router responds")
            .status()
    }

    /// A visitor's request: the share host, the token in the query string, no other credential.
    async fn as_visitor(&self, method: &str, path_and_query: &str, token: &str) -> StatusCode {
        let joiner = if path_and_query.contains('?') {
            '&'
        } else {
            '?'
        };
        let uri = format!("{path_and_query}{joiner}shareToken={token}");
        self.status(
            Request::builder()
                .method(method)
                .uri(&uri)
                .header("host", TUNNEL_HOST)
                .body(Body::empty())
                .expect("build request"),
        )
        .await
    }
}

/// The token has to actually work, or the share is a foundation and not a feature.
#[tokio::test]
async fn a_share_token_on_the_tunnel_host_reaches_an_allowed_read() {
    let h = harness();
    let token = h.publish_share();

    assert_ne!(
        h.as_visitor("GET", "/api/plans", &token).await,
        StatusCode::UNAUTHORIZED,
        "an allow-listed read is what the share exists to serve"
    );
}

/// The deny-by-default half. `/api/jobs` is the canonical thing a visitor must never see.
#[tokio::test]
async fn a_share_token_does_not_reach_anything_off_the_allow_list() {
    let h = harness();
    let token = h.publish_share();

    for path in [
        "/api/jobs",
        "/api/projects",
        "/api/config",
        "/api/chat/sessions",
        "/api/vaults",
        "/api/dashboard",
    ] {
        assert_eq!(
            h.as_visitor("GET", path, &token).await,
            StatusCode::UNAUTHORIZED,
            "{path} is not part of a share"
        );
    }
}

/// A share is read-only and comment-only: no method that mutates a plan is on the list.
#[tokio::test]
async fn a_share_token_cannot_mutate_a_plan() {
    let h = harness();
    let token = h.publish_share();

    for (method, path) in [
        ("PUT", "/api/plans/00001"),
        ("POST", "/api/plans"),
        ("DELETE", "/api/plans/00001"),
        ("POST", "/api/jobs"),
        ("PUT", "/api/plans/00001/revisions/latest"),
    ] {
        assert_eq!(
            h.as_visitor(method, path, &token).await,
            StatusCode::UNAUTHORIZED,
            "{method} {path} must not be reachable with a share token"
        );
    }
}

/// The replay binding. A link leaks; it must not become a credential for the daemon on loopback.
#[tokio::test]
async fn a_share_token_is_refused_on_any_host_but_the_tunnels_own() {
    let h = harness();
    let token = h.publish_share();

    for host in ["127.0.0.1:5010", "localhost:5010", "192.168.1.20:5010"] {
        let status = h
            .status(
                Request::builder()
                    .method("GET")
                    .uri(format!("/api/plans?shareToken={token}"))
                    .header("host", host)
                    .body(Body::empty())
                    .expect("build request"),
            )
            .await;
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "a leaked link must not authenticate against {host}"
        );
    }
}

/// Stopping a share is the revocation, so the same token must stop working the moment the state goes.
#[tokio::test]
async fn a_token_stops_working_when_the_share_stops() {
    let h = harness();
    let token = h.publish_share();
    assert_ne!(
        h.as_visitor("GET", "/api/plans", &token).await,
        StatusCode::UNAUTHORIZED,
        "precondition: the token works while the share is live"
    );

    share_state::clear(&h.tendril_home);

    assert_eq!(
        h.as_visitor("GET", "/api/plans", &token).await,
        StatusCode::UNAUTHORIZED,
        "a stopped share must revoke its token"
    );
}

/// A guessed or stale token must not pass while some *other* share is live.
#[tokio::test]
async fn a_wrong_token_is_refused_while_a_share_is_live() {
    let h = harness();
    let real = h.publish_share();

    for candidate in ["", "not-the-token", &real[..real.len() - 1]] {
        assert_eq!(
            h.as_visitor("GET", "/api/plans", candidate).await,
            StatusCode::UNAUTHORIZED,
            "only the minted token authenticates"
        );
    }
}

/// The WebViewer proxy is unauthenticated on purpose — an `<iframe src>` carries no header — and its
/// safety rests on being confined to loopback targets. Published on a public hostname that inverts:
/// it would let an anonymous visitor reach services bound to the daemon host's own localhost.
#[tokio::test]
async fn the_webviewer_proxy_is_refused_over_a_share() {
    let h = harness();
    let token = h.publish_share();

    for path in [
        "/__proxy?url=http://127.0.0.1:9999/",
        "/__view/anything",
        "/__resolve",
        "/sw.js",
    ] {
        let status = h.as_visitor("GET", path, &token).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "{path} must be refused over the tunnel, not merely unauthenticated"
        );
    }
}

/// The same surface must keep working for the desktop app on loopback, which is the whole reason it
/// sits outside the auth layer.
#[tokio::test]
async fn the_webviewer_proxy_still_serves_loopback_while_a_share_is_live() {
    let h = harness();
    h.publish_share();

    let status = h
        .status(
            Request::builder()
                .method("GET")
                .uri("/sw.js")
                .header("host", "127.0.0.1:5010")
                .body(Body::empty())
                .expect("build request"),
        )
        .await;
    assert_ne!(
        status,
        StatusCode::FORBIDDEN,
        "a live share must not break the app's own proxy on loopback"
    );
}

/// A visitor has no business logging in, and a credential check is not something to publish.
#[tokio::test]
async fn password_auth_is_refused_over_a_share() {
    let h = harness();
    let token = h.publish_share();

    assert_eq!(
        h.as_visitor("GET", "/api/auth/status", &token).await,
        StatusCode::FORBIDDEN,
        "the login surface is not shared"
    );
}

/// With no share recorded, none of this changes anything: the token path is inert and the two
/// refused routers behave exactly as they did before.
#[tokio::test]
async fn nothing_changes_when_no_share_is_recorded() {
    let h = harness();

    assert_eq!(
        h.as_visitor("GET", "/api/plans", "any-token").await,
        StatusCode::UNAUTHORIZED,
        "a token means nothing with no share"
    );
    assert_ne!(
        h.as_visitor("GET", "/sw.js", "any-token").await,
        StatusCode::FORBIDDEN,
        "the proxy is only refused when a share is actually live"
    );
}
