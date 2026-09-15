//! The guard in front of `GET /ivy/local-file` — a port of `Controllers/LocalFileGuardMiddleware.cs`.
//!
//! This is the one endpoint in the daemon that reads a caller-named path off the filesystem, so it is
//! guarded in depth and every layer fails closed:
//!
//! 0. **Token** — `?token=` must match the bearer secret or be a valid session token. The route
//!    cannot sit behind [`crate::auth::auth_middleware`] (an `<img src>` sends no `Authorization`
//!    header), so this is its equivalent, and it runs before anything else touches the request.
//! 1. **Host** allowlist, 2. **Origin** same-host, 3. **`Sec-Fetch-Site`** — a page on another origin
//!    must not be able to make the browser read local files through the daemon.
//! 4. **Extension** allowlist, 5. **Root confinement** — see
//!    [`tendril_core::security::local_file_roots`].
//! 6. **Response hardening** on the way out.
//!
//! A blocked *path* is answered `404 {"error":"File not found"}`, never `403`: the original
//! deliberately does not let a caller tell "outside the roots" from "does not exist", so the endpoint
//! cannot be used to probe the filesystem.

use crate::auth::{secrets_match, validate_session_token};
use crate::state::AppState;
use axum::{
    extract::{Request, State},
    http::{header, HeaderName, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tendril_core::security::host_policy::{is_allowed_host, strip_port};

/// Extensions `GET /ivy/local-file` will serve, from `LocalFileGuardMiddleware.AllowedFileExtensions`.
/// Anything else — including no extension at all — is a 404.
pub const ALLOWED_FILE_EXTENSIONS: [&str; 10] = [
    "png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "ico", "avif", "pdf",
];

/// One `error!` line per process for an empty root list, matching `_loggedEmptyRoots`. Every request
/// is rejected in that state, so it is worth saying once and pointless to say per request.
static LOGGED_EMPTY_ROOTS: AtomicBool = AtomicBool::new(false);

/// `404` with the original's body. Used for a blocked extension and for a path outside every root
/// alike, so the two are indistinguishable from outside.
fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": "File not found" })),
    )
        .into_response()
}

fn forbidden(message: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": message }))).into_response()
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Unauthorized" })),
    )
        .into_response()
}

/// Whether `path`'s extension is in the allowlist. Case-insensitive; a path with no extension, or one
/// whose "extension" is really a dotfile name, is not allowed.
pub fn has_allowed_extension(path: &str) -> bool {
    let file_name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return false;
    };
    if stem.is_empty() {
        // `.env` is a name, not an extension.
        return false;
    }
    let extension = extension.to_ascii_lowercase();
    ALLOWED_FILE_EXTENSIONS.contains(&extension.as_str())
}

fn query_param(query: Option<&str>, key: &str) -> Option<String> {
    let query = query?;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if k == key {
            return Some(percent_decode(v));
        }
    }
    None
}

/// Minimal `application/x-www-form-urlencoded` decode for the two parameters this endpoint takes.
/// `%00` decodes to a real null byte on purpose: the root policy rejects it, and silently dropping it
/// here would hide the attempt.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or_default();
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The host the request was addressed to, with any port stripped.
fn request_host(req: &Request) -> String {
    req.headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(|host| strip_port(host).to_string())
        .unwrap_or_default()
}

/// Host of an `Origin` header, or `None` when it is absent or not an absolute URL — which passes, as
/// in the original: a same-origin `<img>` load sends no `Origin` at all.
fn origin_host(req: &Request) -> Option<String> {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())?;
    let url = reqwest::Url::parse(origin).ok()?;
    url.host_str().map(|host| host.to_string())
}

pub async fn local_file_guard(
    State(state): State<Arc<AppState>>,
    req: Request,
    next: Next,
) -> Response {
    let snapshot = state.settings_snapshot();

    // 0. Token. Before every other check, so an unauthenticated caller learns nothing about hosts,
    //    extensions or the filesystem.
    let token = query_param(req.uri().query(), "token").unwrap_or_default();
    let token_ok = secrets_match(&token, &state.secret)
        || validate_session_token(snapshot.settings.auth.as_ref(), &token);
    if !token_ok {
        return unauthorized();
    }

    // 1. Host allowlist.
    let host = request_host(&req);
    let allowed_hosts = snapshot
        .settings
        .security
        .as_ref()
        .and_then(|security| security.allowed_hosts.as_deref());
    // TODO: pass the share-tunnel host once V2 has one.
    if !is_allowed_host(&host, allowed_hosts, None) {
        return forbidden("Access denied: invalid host");
    }

    // 2. Origin must name the same host the request was addressed to.
    if let Some(origin) = origin_host(&req) {
        if !origin.eq_ignore_ascii_case(strip_port(&host)) {
            return forbidden("Access denied: cross-origin request");
        }
    }

    // 3. An explicit cross-site fetch, as reported by the browser.
    let cross_site = req
        .headers()
        .get(HeaderName::from_static("sec-fetch-site"))
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("cross-site"));
    if cross_site {
        return forbidden("Access denied: cross-site request");
    }

    let requested_path = query_param(req.uri().query(), "path").unwrap_or_default();

    // 4. Extension allowlist.
    if !has_allowed_extension(&requested_path) {
        return not_found();
    }

    // 5. Root confinement. Fails closed: with no roots computed nothing is servable.
    let roots = snapshot.local_file_roots.clone();
    if roots.is_empty() && !LOGGED_EMPTY_ROOTS.swap(true, Ordering::Relaxed) {
        tracing::error!(
            "No local-file roots could be computed; every /ivy/local-file request will be rejected"
        );
    }
    let Some(resolved) =
        tendril_core::security::local_file_roots::try_resolve(&requested_path, &roots)
    else {
        return not_found();
    };

    // The handler is given the path the policy approved, not the raw query value, so there is no
    // second parse of caller input behind the guard.
    let mut req = req;
    req.extensions_mut().insert(ApprovedPath(resolved));

    let mut response = next.run(req).await;

    // 6. Response hardening. Applied to every response that gets this far, including the 404 for a
    //    file inside a root that does not exist.
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; sandbox"),
    );

    response
}

/// The confined, absolute path the guard approved, handed to the handler through request extensions.
#[derive(Clone, Debug)]
pub struct ApprovedPath(pub std::path::PathBuf);
