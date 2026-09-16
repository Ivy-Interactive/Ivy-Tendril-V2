//! `PUT`/`DELETE /api/auth/password` — the route the Security & Tunneling screen calls, and the one
//! thing in that screen that writes a credential.
//!
//! Four properties are load-bearing and each has a test here:
//!
//! 1. The hash it writes is **verifiable and usable**: `POST /api/auth/login` accepts the password
//!    immediately afterwards, so the write side and the read side agree on the format.
//! 2. It is **owner-only**: no bearer credential, no write.
//! 3. It is **refused over a tunnel**, share or full-access.
//! 4. It **never returns or logs the password**, and changing one requires the current one.
//!
//! Plus the coupling that gives the section its name: a full-access tunnel refuses to start without a
//! password, and the password cannot be removed while one is running.
//!
//! No tunnel is started and nothing touches the network. A tunnel's state file is written directly,
//! which is exactly what a running tunnel leaves behind.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use tendril_core::config::{save_config, TendrilSettings};
use tendril_core::tunnel::full_state::{self, FullTunnelSession};
use tendril_core::tunnel::share_state::{self, ShareSession};
use tendril_server::{create_router, AppState};
use tower::ServiceExt;

const SHARE_HOST: &str = "calm-otter-reads-plans.trycloudflare.com";
const FULL_HOST: &str = "brisk-badger-runs-it-all.trycloudflare.com";
const PASSWORD: &str = "correct horse battery staple";

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

fn harness() -> Harness {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-auth-password-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");
    let config_path = tendril_home.join("config.yaml");
    save_config(&config_path, &TendrilSettings::default()).expect("write config");

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

struct Reply {
    status: StatusCode,
    body: String,
}

impl Reply {
    fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).unwrap_or(serde_json::Value::Null)
    }
}

impl Harness {
    async fn send(&self, request: Request<Body>) -> Reply {
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
        Reply {
            status,
            body: String::from_utf8_lossy(&bytes).to_string(),
        }
    }

    /// An owner's request: the bearer secret, loopback `Host`.
    async fn as_owner(&self, method: &str, path: &str, body: serde_json::Value) -> Reply {
        self.request(method, path, body, Some(&self.secret), "127.0.0.1")
            .await
    }

    /// A request on a tunnel's hostname, still carrying the owner's secret — so a refusal can only be
    /// the host fence and not a missing credential.
    async fn on_host(
        &self,
        method: &str,
        path: &str,
        body: serde_json::Value,
        host: &str,
    ) -> Reply {
        self.request(method, path, body, Some(&self.secret), host)
            .await
    }

    async fn request(
        &self,
        method: &str,
        path: &str,
        body: serde_json::Value,
        secret: Option<&str>,
        host: &str,
    ) -> Reply {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header("host", host)
            .header("content-type", "application/json");
        if let Some(secret) = secret {
            builder = builder.header("authorization", format!("Bearer {secret}"));
        }
        self.send(
            builder
                .body(Body::from(body.to_string()))
                .expect("build request"),
        )
        .await
    }

    async fn set(&self, body: serde_json::Value) -> Reply {
        self.as_owner("PUT", "/api/auth/password", body).await
    }

    async fn clear(&self, body: serde_json::Value) -> Reply {
        self.as_owner("DELETE", "/api/auth/password", body).await
    }

    /// `POST /api/auth/login` with no credential of its own — the read side of the hash.
    async fn login(&self, password: &str) -> Reply {
        self.request(
            "POST",
            "/api/auth/login",
            serde_json::json!({ "username": "", "password": password }),
            None,
            "127.0.0.1",
        )
        .await
    }

    async fn password_enabled(&self) -> bool {
        let reply = self
            .request(
                "GET",
                "/api/auth/status",
                serde_json::Value::Null,
                None,
                "127.0.0.1",
            )
            .await;
        reply.json()["passwordAuthEnabled"] == serde_json::Value::Bool(true)
    }

    fn config_text(&self) -> String {
        std::fs::read_to_string(&self.config_path).expect("read config")
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

    fn publish_full(&self) {
        full_state::write(
            &self.tendril_home,
            &FullTunnelSession {
                url: format!("https://{FULL_HOST}"),
                host: FULL_HOST.to_string(),
                pid: 0,
                started_at: "2026-09-16T10:00:00Z".to_string(),
            },
        )
        .expect("write full state");
    }
}

/// The whole point of the route: what it writes has to be what the login route reads.
#[tokio::test]
async fn a_written_password_is_immediately_accepted_by_login() {
    let h = harness();
    assert!(!h.password_enabled().await, "nothing is configured yet");
    assert_eq!(
        h.login(PASSWORD).await.status,
        StatusCode::BAD_REQUEST,
        "login is unavailable until a password exists"
    );

    let reply = h.set(serde_json::json!({ "newPassword": PASSWORD })).await;
    assert_eq!(reply.status, StatusCode::OK, "{}", reply.body);
    assert_eq!(
        reply.json()["passwordAuthEnabled"],
        serde_json::Value::Bool(true)
    );
    assert!(h.password_enabled().await);

    let login = h.login(PASSWORD).await;
    assert_eq!(login.status, StatusCode::OK, "{}", login.body);
    assert!(
        login.json()["token"]
            .as_str()
            .is_some_and(|t| !t.is_empty()),
        "a session token is issued: {}",
        login.body
    );
    assert_eq!(
        h.login("not the password").await.status,
        StatusCode::UNAUTHORIZED
    );
}

/// The format is the one both apps read, and the plaintext is nowhere.
#[tokio::test]
async fn the_hash_is_argon2_and_the_plaintext_is_never_stored_or_echoed() {
    let h = harness();
    let reply = h
        .set(serde_json::json!({ "newPassword": "a-very-distinctive-plaintext" }))
        .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(
        !reply.body.contains("a-very-distinctive-plaintext"),
        "the reply must not echo the password: {}",
        reply.body
    );

    let config = h.config_text();
    assert!(
        !config.contains("a-very-distinctive-plaintext"),
        "config.yaml must hold only the hash: {config}"
    );
    let auth = tendril_core::config::load_config(&h.config_path)
        .expect("parse")
        .auth
        .expect("auth block");
    assert!(
        auth.password.starts_with("$argon2i$v=19$m=65536,t=3,p=1$"),
        "the parameters `tendril hash-password` and the C# app both read: {}",
        auth.password
    );
    assert!(
        tendril_core::auth::password::verify_password(
            &auth.password,
            "a-very-distinctive-plaintext",
            &auth.hash_secret
        ),
        "the hash has to verify against the pepper written beside it"
    );
    // `GET /api/auth/status` is unauthenticated, so it must say whether a password exists and no more.
    let status = h
        .request(
            "GET",
            "/api/auth/status",
            serde_json::Value::Null,
            None,
            "127.0.0.1",
        )
        .await;
    assert!(
        !status.body.contains("argon2") && !status.body.contains("hashSecret"),
        "status must not leak the hash: {}",
        status.body
    );
}

#[tokio::test]
async fn an_unauthenticated_caller_cannot_set_or_clear_a_password() {
    let h = harness();

    for (method, body) in [
        ("PUT", serde_json::json!({ "newPassword": PASSWORD })),
        ("DELETE", serde_json::json!({})),
    ] {
        // No credential at all.
        let reply = h
            .request(
                method,
                "/api/auth/password",
                body.clone(),
                None,
                "127.0.0.1",
            )
            .await;
        assert_eq!(
            reply.status,
            StatusCode::UNAUTHORIZED,
            "{method} with no credential: {}",
            reply.body
        );

        // A wrong bearer secret.
        let reply = h
            .request(
                method,
                "/api/auth/password",
                body,
                Some("not-the-secret"),
                "127.0.0.1",
            )
            .await;
        assert_eq!(
            reply.status,
            StatusCode::UNAUTHORIZED,
            "{method} with a wrong secret: {}",
            reply.body
        );
    }

    assert!(
        !h.password_enabled().await,
        "no unauthenticated call may have written anything"
    );
}

/// A share visitor's capability token authorises reads on one plan and comments. It must not reach the
/// credential — `share_token_allows` is deny-by-default and refuses `PUT` outright, and the host fence
/// refuses the path a second time.
#[tokio::test]
async fn a_share_visitor_cannot_reach_the_password_route() {
    let h = harness();
    let token = share_state::mint_token();
    share_state::write(
        &h.tendril_home,
        &ShareSession {
            url: format!("https://{SHARE_HOST}"),
            host: SHARE_HOST.to_string(),
            token: token.clone(),
            pid: 0,
            started_at: "2026-09-16T10:00:00Z".to_string(),
        },
    )
    .expect("write share state");

    for method in ["PUT", "DELETE"] {
        let reply = h
            .send(
                Request::builder()
                    .method(method)
                    .uri(format!("/api/auth/password?shareToken={token}"))
                    .header("host", SHARE_HOST)
                    .header("content-type", "application/json")
                    .header("x-tendril-share-token", &token)
                    .body(Body::from(
                        serde_json::json!({ "newPassword": "visitor-owns-you" }).to_string(),
                    ))
                    .expect("build request"),
            )
            .await;
        assert!(
            reply.status == StatusCode::UNAUTHORIZED || reply.status == StatusCode::FORBIDDEN,
            "{method} as a share visitor must be refused, got {}: {}",
            reply.status,
            reply.body
        );
    }
    assert!(!h.password_enabled().await);
}

/// Even the *owner's* secret does not open the password route over a tunnel. A session token from
/// `/api/auth/login` satisfies `auth_middleware`, so without this fence a remote caller who knew the
/// password could rotate it and lock the operator out of their own daemon.
#[tokio::test]
async fn the_password_route_is_refused_over_either_tunnel() {
    let h = harness();
    h.set(serde_json::json!({ "newPassword": PASSWORD }))
        .await
        .status
        .is_success()
        .then_some(())
        .expect("set a password from loopback");

    h.publish_share();
    h.publish_full();

    for host in [SHARE_HOST, FULL_HOST] {
        let reply = h
            .on_host(
                "PUT",
                "/api/auth/password",
                serde_json::json!({ "currentPassword": PASSWORD, "newPassword": "rotated" }),
                host,
            )
            .await;
        assert_eq!(
            reply.status,
            StatusCode::FORBIDDEN,
            "PUT on {host}: {}",
            reply.body
        );

        let reply = h
            .on_host(
                "DELETE",
                "/api/auth/password",
                serde_json::json!({ "currentPassword": PASSWORD }),
                host,
            )
            .await;
        assert_eq!(
            reply.status,
            StatusCode::FORBIDDEN,
            "DELETE on {host}: {}",
            reply.body
        );
    }

    // The password is untouched: the original one still logs in.
    assert_eq!(h.login(PASSWORD).await.status, StatusCode::OK);
}

/// The one asymmetry between the two tunnels: a reviewer has no business logging in, an operator
/// reaching their own daemon has nothing else to present.
#[tokio::test]
async fn login_is_refused_over_a_share_and_allowed_over_a_full_access_tunnel() {
    let h = harness();
    h.set(serde_json::json!({ "newPassword": PASSWORD })).await;
    h.publish_share();
    h.publish_full();

    let body = serde_json::json!({ "username": "", "password": PASSWORD });
    let over_share = h
        .request("POST", "/api/auth/login", body.clone(), None, SHARE_HOST)
        .await;
    assert_eq!(
        over_share.status,
        StatusCode::FORBIDDEN,
        "a share visitor cannot log in: {}",
        over_share.body
    );

    let over_full = h
        .request("POST", "/api/auth/login", body, None, FULL_HOST)
        .await;
    assert_eq!(
        over_full.status,
        StatusCode::OK,
        "the password is the only credential a full-access tunnel can offer: {}",
        over_full.body
    );
}

#[tokio::test]
async fn changing_a_password_requires_the_current_one() {
    let h = harness();
    h.set(serde_json::json!({ "newPassword": PASSWORD })).await;

    let no_current = h.set(serde_json::json!({ "newPassword": "second" })).await;
    assert_eq!(
        no_current.status,
        StatusCode::FORBIDDEN,
        "{}",
        no_current.body
    );

    let wrong = h
        .set(serde_json::json!({ "currentPassword": "nope", "newPassword": "second" }))
        .await;
    assert_eq!(wrong.status, StatusCode::FORBIDDEN, "{}", wrong.body);
    assert!(
        !wrong.body.contains("nope"),
        "the refusal must not echo what was sent: {}",
        wrong.body
    );
    assert_eq!(
        h.login(PASSWORD).await.status,
        StatusCode::OK,
        "a refused change changed nothing"
    );

    let ok = h
        .set(serde_json::json!({ "currentPassword": PASSWORD, "newPassword": "second-password" }))
        .await;
    assert_eq!(ok.status, StatusCode::OK, "{}", ok.body);
    assert_eq!(h.login("second-password").await.status, StatusCode::OK);
    assert_eq!(h.login(PASSWORD).await.status, StatusCode::UNAUTHORIZED);
}

/// A session token is signed with the pepper, which a change rotates. Anyone still holding a token
/// minted under the old password has to log in again.
#[tokio::test]
async fn a_password_change_invalidates_the_session_tokens_it_replaced() {
    let h = harness();
    h.set(serde_json::json!({ "newPassword": PASSWORD })).await;
    let token = h.login(PASSWORD).await.json()["token"]
        .as_str()
        .expect("a token")
        .to_string();

    // The token authenticates before the change...
    let before = h
        .request(
            "GET",
            "/api/plans",
            serde_json::Value::Null,
            Some(&token),
            "127.0.0.1",
        )
        .await;
    assert_eq!(before.status, StatusCode::OK, "{}", before.body);

    h.set(serde_json::json!({ "currentPassword": PASSWORD, "newPassword": "second-password" }))
        .await;

    // ...and not after it.
    let after = h
        .request(
            "GET",
            "/api/plans",
            serde_json::Value::Null,
            Some(&token),
            "127.0.0.1",
        )
        .await;
    assert_eq!(
        after.status,
        StatusCode::UNAUTHORIZED,
        "a token minted under the old password must stop working: {}",
        after.body
    );
}

#[tokio::test]
async fn clearing_removes_protection_and_needs_the_current_password() {
    let h = harness();
    h.set(serde_json::json!({ "newPassword": PASSWORD })).await;

    assert_eq!(
        h.clear(serde_json::json!({})).await.status,
        StatusCode::FORBIDDEN
    );
    assert!(h.password_enabled().await);

    let ok = h
        .clear(serde_json::json!({ "currentPassword": PASSWORD }))
        .await;
    assert_eq!(ok.status, StatusCode::OK, "{}", ok.body);
    assert_eq!(
        ok.json()["passwordAuthEnabled"],
        serde_json::Value::Bool(false)
    );
    assert!(!h.password_enabled().await);
    assert!(
        !h.config_text().contains("hashSecret"),
        "the whole block goes: {}",
        h.config_text()
    );
    // The bearer secret still works, so nobody is locked out by turning protection off.
    let plans = h
        .as_owner("GET", "/api/plans", serde_json::Value::Null)
        .await;
    assert_eq!(plans.status, StatusCode::OK);

    // Clearing again says so rather than pretending.
    assert_eq!(
        h.clear(serde_json::json!({ "currentPassword": PASSWORD }))
            .await
            .status,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn a_blank_password_is_refused() {
    let h = harness();
    for body in [
        serde_json::json!({ "newPassword": "" }),
        serde_json::json!({ "newPassword": "   " }),
        serde_json::json!({}),
    ] {
        let reply = h.set(body.clone()).await;
        assert_eq!(
            reply.status,
            StatusCode::BAD_REQUEST,
            "{body} should be refused: {}",
            reply.body
        );
    }
    assert!(!h.password_enabled().await);
}

/// The pairing that gives the section its name, from the other direction: protection cannot be removed
/// while a full-access tunnel is publishing the daemon, because that would leave it published with no
/// credential at all.
#[tokio::test]
async fn the_password_cannot_be_removed_while_a_full_access_tunnel_is_running() {
    let h = harness();
    h.set(serde_json::json!({ "newPassword": PASSWORD })).await;
    h.publish_full();

    let reply = h
        .clear(serde_json::json!({ "currentPassword": PASSWORD }))
        .await;
    assert_eq!(reply.status, StatusCode::CONFLICT, "{}", reply.body);
    assert!(
        reply.body.contains("full-access tunnel"),
        "the refusal has to say what to stop: {}",
        reply.body
    );
    assert!(h.password_enabled().await);

    // Stop the tunnel and it goes through.
    full_state::clear(&h.tendril_home);
    assert_eq!(
        h.clear(serde_json::json!({ "currentPassword": PASSWORD }))
            .await
            .status,
        StatusCode::OK
    );
}

/// `POST /api/tunnel/full` is where the gate is felt. `428` rather than `409`, so a client can tell
/// "you have not set a password" from "your machine has no cloudflared".
#[tokio::test]
async fn the_full_access_tunnel_refuses_to_start_without_a_password() {
    let h = harness();

    let status = h
        .as_owner("GET", "/api/tunnel/full", serde_json::Value::Null)
        .await;
    assert_eq!(status.status, StatusCode::OK, "{}", status.body);
    assert_eq!(status.json()["kind"], "fullAccess");
    assert_eq!(status.json()["status"], "disabled");
    assert_eq!(
        status.json()["passwordConfigured"],
        serde_json::Value::Bool(false)
    );

    let start = h
        .as_owner("POST", "/api/tunnel/full", serde_json::Value::Null)
        .await;
    assert_eq!(
        start.status,
        StatusCode::PRECONDITION_REQUIRED,
        "{}",
        start.body
    );
    assert!(
        start.body.contains("password"),
        "the refusal has to say what to do: {}",
        start.body
    );
    assert!(
        full_state::read(&h.tendril_home).is_none(),
        "nothing may be recorded by a refused start"
    );

    // With a password the precondition is cleared and the next failure is the environment, not the
    // decision — which is what proves the gate was the password.
    h.set(serde_json::json!({ "newPassword": PASSWORD })).await;
    let after = h
        .as_owner("GET", "/api/tunnel/full", serde_json::Value::Null)
        .await;
    assert_eq!(
        after.json()["passwordConfigured"],
        serde_json::Value::Bool(true)
    );
    let start = h
        .as_owner("POST", "/api/tunnel/full", serde_json::Value::Null)
        .await;
    assert_ne!(
        start.status,
        StatusCode::PRECONDITION_REQUIRED,
        "the password gate is cleared: {}",
        start.body
    );
}

#[tokio::test]
async fn the_full_access_control_routes_need_the_bearer_credential() {
    let h = harness();
    for method in ["GET", "POST", "DELETE"] {
        let reply = h
            .request(
                method,
                "/api/tunnel/full",
                serde_json::Value::Null,
                None,
                "127.0.0.1",
            )
            .await;
        assert_eq!(
            reply.status,
            StatusCode::UNAUTHORIZED,
            "{method} /api/tunnel/full: {}",
            reply.body
        );
    }
}

/// The switch that publishes the daemon must not be reachable from the internet it publishes to.
#[tokio::test]
async fn the_full_access_control_routes_are_refused_over_either_tunnel() {
    let h = harness();
    h.publish_share();
    h.publish_full();

    for host in [SHARE_HOST, FULL_HOST] {
        for method in ["GET", "POST", "DELETE"] {
            let reply = h
                .on_host(method, "/api/tunnel/full", serde_json::Value::Null, host)
                .await;
            assert_eq!(
                reply.status,
                StatusCode::FORBIDDEN,
                "{method} /api/tunnel/full on {host}: {}",
                reply.body
            );
        }
    }
}

/// A full-access tunnel is not a share: its host grants no capability token, and its record must not be
/// readable as one.
#[tokio::test]
async fn a_full_access_tunnel_mints_no_capability_token() {
    let h = harness();
    h.publish_full();

    assert!(
        share_state::read(&h.tendril_home).is_none(),
        "a full-access record is not a share record"
    );

    // A guessed token on the full-access host authorises nothing, even for a route a *share* allows.
    let reply = h
        .send(
            Request::builder()
                .method("GET")
                .uri("/api/plans?shareToken=guessed")
                .header("host", FULL_HOST)
                .body(Body::empty())
                .expect("build request"),
        )
        .await;
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{}", reply.body);
}

/// Loopback keeps working exactly as before while either tunnel is up — the fences are host-scoped and
/// nothing else moved.
#[tokio::test]
async fn loopback_is_unaffected_while_tunnels_are_live() {
    let h = harness();
    h.publish_share();
    h.publish_full();

    let set = h.set(serde_json::json!({ "newPassword": PASSWORD })).await;
    assert_eq!(set.status, StatusCode::OK, "{}", set.body);
    assert_eq!(h.login(PASSWORD).await.status, StatusCode::OK);
    assert_eq!(
        h.as_owner("GET", "/api/tunnel/full", serde_json::Value::Null)
            .await
            .status,
        StatusCode::OK
    );
}
