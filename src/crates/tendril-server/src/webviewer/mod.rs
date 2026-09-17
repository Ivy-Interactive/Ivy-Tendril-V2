//! Server half of the `WebViewer` component: the endpoints that fetch, rewrite and serve proxied
//! content on the Tendril app's own origin, plus the service worker and page agent the component
//! needs. `WebViewer.tsx` cannot load anything without these.
//!
//! Endpoints, all reserved outside `/api`:
//!
//! - `/__proxy?url=<abs>&dev=<mobile|tablet>` — fetch + rewrite (used by the service worker)
//! - `/__view/[@<viewer>[/<device>]/]<abs>` — the same, with the target carried in the path
//!   (bootstrap + navigations); the optional token names the mounted component and its device
//! - `/__lib/snapdom.mjs` — the screenshot library, loaded inside the proxied page
//! - `POST /__capture` — store a screenshot; `/__captures/<file>` serves it back
//! - `POST /__resolve` — raw JS frames in, original file:line + code frame out
//! - `/sw.js` — the service worker
//!
//! # Unauthenticated by design
//!
//! Every other route in [`crate::routes`] sits behind [`crate::auth::auth_middleware`]. These cannot:
//! the `<iframe src="/__view/...">` bootstrap is a plain browser navigation and cannot carry an
//! `Authorization` header, subresource requests reissued by the service worker inherit none either,
//! and `WebViewer.tsx`'s own `fetch("/__capture")` / `fetch("/__resolve")` calls send none. So
//! [`is_target_allowed`] — not a bearer token — is what stops the proxy being an open SSRF relay:
//! only loopback targets are fetched, which is every target a review action can actually produce,
//! since a review action is always a shell command run in a plan's worktree.
//!
//! # No cookies, in either direction
//!
//! Requests go upstream without them and `Set-Cookie` is not relayed back, so a site that needs a
//! session cannot be reviewed signed in — point the viewer at a dev server, or at pages that render
//! logged out. This is not an oversight: every proxied site is served from the Tendril app's single
//! origin, so one cookie jar would be shared by all of them and readable by script on any page any
//! viewer is pointed at, and the app's own cookies would ride along on every upstream request.

pub(crate) mod capture;
pub(crate) mod http;
pub(crate) mod rewriter;
pub(crate) mod sourcemap;

use axum::body::{Body, Bytes};
use axum::extract::{Path, Query};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::Router;
use base64::Engine;
use regex::Regex;
use reqwest::Url;
use serde::Deserialize;
use std::sync::{Arc, LazyLock};

use crate::state::AppState;
use rewriter::VIEW_PREFIX;

/// Assets are compiled into the binary, so a deployment needs no files on disk.
const AGENT_TEMPLATE: &str = include_str!("../../assets/webviewer/agent.js");
const SERVICE_WORKER: &[u8] = include_bytes!("../../assets/webviewer/sw.js");
const SNAPDOM: &[u8] = include_bytes!("../../assets/webviewer/snapdom.mjs");

/// Headers the service worker's HAR log actually reads back. Relaying the upstream's full header set
/// base64'd into a single response header sounds harmless until a site ships a multi-kilobyte CSP:
/// the header balloons past what the browser will accept on a service worker fetch, the fetch
/// rejects, `respondWith` rejects, and the frame dies with a bare network error while the very same
/// URL fetches fine outside the worker.
const META_HEADERS: [&str; 2] = ["content-length", "content-type"];

pub(crate) struct Device {
    ua: &'static str,
    platform: &'static str,
    mobile: bool,
    ch_platform: &'static str,
}

/// `desktop` has no override and falls through to whatever the caller's own headers say.
static DEVICES: [(&str, Device); 2] = [
    (
        "mobile",
        Device {
            ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            platform: "iPhone",
            mobile: true,
            ch_platform: "\"iOS\"",
        },
    ),
    (
        "tablet",
        Device {
            ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            platform: "iPad",
            mobile: false,
            ch_platform: "\"iOS\"",
        },
    ),
];

fn device_for(key: &str) -> Option<&'static Device> {
    DEVICES
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, device)| device)
}

/// The optional `@<viewer>[/<device>]/` segment that may sit between [`VIEW_PREFIX`] and the absolute
/// URL — for example `/__view/@v3/mobile/https://example.com/`.
///
/// It exists because several WebViewers can be mounted on one Tendril page, sharing one origin and
/// therefore one service worker. The token is what tells them apart: it names the component a
/// document belongs to (so a network entry is reported by that viewer alone) and the device it
/// emulates (so one viewer's phone viewport is not every viewer's).
///
/// Only DOCUMENT urls carry it — the parent component builds those. Rewritten subresource URLs stay
/// bare, and the service worker resolves them through the client that asked. The same grammar is
/// implemented in `assets/webviewer/sw.js` and `assets/webviewer/agent.js`.
///
/// The device is a path segment of its own, not the `.mobile` dot suffix the upstream C# widget used:
/// `toViewUrl` in `WebViewer.tsx` already ships the slash form.
static VIEW_TOKEN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^@([A-Za-z0-9]{1,16})(?:/(desktop|tablet|mobile))?/").unwrap());

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ViewToken {
    /// Byte length to strip off the front of the view-space path.
    pub length: usize,
    pub viewer: String,
    pub device: Option<String>,
}

pub(crate) fn match_view_token(rest: &str) -> Option<ViewToken> {
    let captures = VIEW_TOKEN.captures(rest)?;
    Some(ViewToken {
        length: captures.get(0)?.end(),
        viewer: captures.get(1)?.as_str().to_string(),
        device: captures.get(2).map(|m| m.as_str().to_string()),
    })
}

/// The app under review: loopback only.
///
/// The endpoints are unauthenticated (see the module docs), so this is the only thing standing
/// between the proxy and being an open SSRF relay to the internet or the host's own network. Every
/// review action starts a local process, so every real target is on loopback; anything else is
/// refused rather than made configurable, which would be new schema and a new settings surface for
/// no case this app has.
///
/// `*.localhost` is accepted because RFC 6761 reserves it for loopback too, and some dev servers
/// print URLs in that form.
fn is_loopback_target(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".localhost") {
        return true;
    }
    // host_str() keeps the brackets on an IPv6 literal.
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    bare.parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_loopback())
}

/// The public hosts an app under review may pull static assets from.
///
/// A local app is not a self-contained one: it links its fonts, its icon set and often a library or
/// two from a CDN. With only [`is_loopback_target`] in force those are refused, and the page renders
/// in fallback fonts with its icons missing — which is not the app the reviewer was asked to review,
/// and a review of the wrong thing is worse than no review.
///
/// A fixed list rather than "anything, so long as it is a subresource": the proxy fetches as this
/// machine. Every host here serves versioned static files to whoever asks, so relaying them gives up
/// nothing that was not already public. HTTPS is required — there is no reason for one of these to be
/// addressed over http, and insisting costs nothing.
///
/// This does not widen what a tunnel visitor can reach. `share_exposure::refuse_on_any_tunnel_host`
/// turns the whole proxy away on either tunnel host before any of this is consulted.
const ASSET_HOSTS: &[&str] = &[
    // Fonts
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "use.typekit.net",
    "p.typekit.net",
    // Script and stylesheet CDNs
    "cdn.jsdelivr.net",
    "fastly.jsdelivr.net",
    "unpkg.com",
    "cdnjs.cloudflare.com",
    "ajax.googleapis.com",
    "code.jquery.com",
    "esm.sh",
    "cdn.skypack.dev",
    "cdn.tailwindcss.com",
    // Icons
    "kit.fontawesome.com",
    "ka-f.fontawesome.com",
];

fn is_asset_host(url: &Url) -> bool {
    url.scheme() == "https"
        && url
            .host_str()
            .is_some_and(|host| ASSET_HOSTS.iter().any(|a| host.eq_ignore_ascii_case(a)))
}

/// Whether the proxy may fetch `url` at all: the app under review ([`is_loopback_target`]), or one of
/// the asset hosts it links ([`ASSET_HOSTS`]).
pub(crate) fn is_target_allowed(url: &Url) -> bool {
    is_loopback_target(url) || is_asset_host(url)
}

/// Routes the Tendril app must hand to this proxy rather than route as API endpoints. Merged into the
/// outer router in [`crate::routes::create_router`], outside the auth layer.
pub(crate) fn routes() -> Router<Arc<AppState>> {
    Router::new()
        // Proxied content can hit these with any method, so none of them is method-restricted
        // beyond what the upstream widget restricted.
        .route("/__proxy", any(handle_proxy_query))
        .route("/__view/*rest", any(handle_proxy_path))
        .route("/__lib/:file", get(handle_lib))
        .route("/__capture", any(capture::handle_capture))
        .route("/__captures/:file", get(capture::handle_serve_capture))
        .route("/__resolve", any(handle_resolve))
        .route("/sw.js", get(handle_sw))
}

#[derive(Deserialize)]
struct ProxyQuery {
    url: Option<String>,
    dev: Option<String>,
}

async fn handle_proxy_query(
    Query(query): Query<ProxyQuery>,
    headers: HeaderMap,
    method: Method,
    body: Bytes,
) -> Response {
    let target = query.url.unwrap_or_default();
    let device = query.dev.as_deref().and_then(device_for);
    handle_proxy_core(method, headers, body, &target, device).await
}

/// Bootstrap path: the target rides in the path, so the browser's own relative-URL resolution keeps
/// working before the service worker controls the iframe. An optional `@<viewer>[/<device>]/` token in
/// front of it names the mounted WebViewer the document belongs to and the device it emulates (see
/// [`ViewToken`]).
async fn handle_proxy_path(
    Query(query): Query<ProxyQuery>,
    headers: HeaderMap,
    method: Method,
    uri: Uri,
    body: Bytes,
) -> Response {
    // Read the raw path rather than the matched `*rest` capture: the target keeps its own `//` and
    // its own percent-encoding that way, which is what makes it parse back to the URL the component
    // built.
    let path = uri.path();
    let mut raw = if path.len() > VIEW_PREFIX.len() {
        &path[VIEW_PREFIX.len()..]
    } else {
        ""
    };

    let token = match_view_token(raw);
    if let Some(token) = &token {
        raw = &raw[token.length..];
    }

    // The target's own query string rides as this request's query string.
    let target = match uri.query() {
        Some(query) if !query.is_empty() => format!("{}?{}", rewriter::fix_protocol(raw), query),
        _ => rewriter::fix_protocol(raw),
    };

    let device = token
        .as_ref()
        .and_then(|t| t.device.as_deref())
        .and_then(device_for)
        .or_else(|| query.dev.as_deref().and_then(device_for));

    handle_proxy_core(method, headers, body, &target, device).await
}

async fn handle_proxy_core(
    method: Method,
    headers: HeaderMap,
    body: Bytes,
    target: &str,
    device: Option<&'static Device>,
) -> Response {
    if target.is_empty() {
        return text(StatusCode::BAD_REQUEST, "Missing url parameter");
    }
    let Ok(target_uri) = Url::parse(target) else {
        return text(StatusCode::BAD_REQUEST, "Invalid url parameter");
    };
    if target_uri.scheme() != "http" && target_uri.scheme() != "https" {
        return text(StatusCode::BAD_REQUEST, "Invalid url parameter");
    }
    if !is_target_allowed(&target_uri) {
        return text(
            StatusCode::FORBIDDEN,
            "Blocked by the target allow-list: only a loopback app, or one of the known static-asset hosts over https, may be proxied",
        );
    }

    let upstream_body = if method == Method::GET || method == Method::HEAD {
        None
    } else {
        Some(body)
    };

    // The incoming Cookie header is deliberately not forwarded — see the module docs.
    let incoming = headers.clone();
    let configure = move |request: reqwest::RequestBuilder| {
        let mut request = request
            .header(
                header::USER_AGENT,
                device
                    .map(|d| d.ua)
                    .or_else(|| header_str(&incoming, header::USER_AGENT))
                    .unwrap_or("Mozilla/5.0"),
            )
            .header(
                header::ACCEPT,
                header_str(&incoming, header::ACCEPT).unwrap_or("*/*"),
            )
            .header(
                header::ACCEPT_LANGUAGE,
                header_str(&incoming, header::ACCEPT_LANGUAGE).unwrap_or("en-US,en;q=0.9"),
            );
        if let Some(device) = device {
            request = request
                .header("sec-ch-ua-mobile", if device.mobile { "?1" } else { "?0" })
                .header("sec-ch-ua-platform", device.ch_platform);
        }
        request
    };

    let response = match http::send(
        &http::UPSTREAM,
        method,
        target_uri,
        upstream_body,
        configure,
        is_target_allowed,
    )
    .await
    {
        Ok(response) => response,
        Err(http::SendError::RedirectBlocked(message)) => {
            return text(StatusCode::FORBIDDEN, &message.to_string())
        }
        Err(e) => return text(StatusCode::BAD_GATEWAY, &format!("Proxy fetch failed: {e}")),
    };

    let final_url = response.url().to_string();
    let status = response.status();
    let media_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_lowercase())
        .unwrap_or_default();
    let content_type_raw = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let cache_control = response
        .headers()
        .get(header::CACHE_CONTROL)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());
    let proxy_meta = proxy_meta(&response, &final_url);

    // Every other upstream header, a Content-Security-Policy included, is dropped by never being
    // copied. This is what strips the CSP HTTP header; the CSP meta tag goes separately, in the HTML
    // rewriter.
    let mut builder = Response::builder().status(status);
    if let Some(value) = cache_control {
        builder = builder.header(header::CACHE_CONTROL, value);
    }
    // Side-channel the real upstream status and headers for the service worker's HAR log, which
    // cannot see them once we have re-emitted the response.
    builder = builder.header("x-proxy-meta", proxy_meta);

    // Bodiless statuses: 304 is routine when the service worker revalidates during a screenshot.
    // Writing a body for one faults the connection.
    if status == StatusCode::NO_CONTENT
        || status == StatusCode::NOT_MODIFIED
        || status.is_informational()
    {
        return builder.body(Body::empty()).unwrap_or_else(internal_error);
    }

    let is_html = media_type == "text/html" || media_type == "application/xhtml+xml";
    let is_css = media_type == "text/css";

    if is_html || is_css {
        // We re-encode as UTF-8, so the declared charset has to say so — relaying the upstream one
        // verbatim turns a Latin-1 page into mojibake.
        builder = builder.header(
            header::CONTENT_TYPE,
            if is_html {
                "text/html; charset=utf-8"
            } else {
                "text/css; charset=utf-8"
            },
        );

        let text_body = match response.text().await {
            Ok(text) => text,
            Err(e) => return text(StatusCode::BAD_GATEWAY, &format!("Proxy read failed: {e}")),
        };
        let rewritten = if is_html {
            rewriter::rewrite_html(
                &text_body,
                &final_url,
                Some(&agent_script(&final_url, device)),
            )
        } else {
            match Url::parse(&final_url) {
                Ok(base) => rewriter::rewrite_css(&text_body, &base),
                Err(_) => text_body,
            }
        };
        return builder
            .body(Body::from(rewritten))
            .unwrap_or_else(internal_error);
    }

    builder = builder.header(
        header::CONTENT_TYPE,
        if content_type_raw.is_empty() {
            "application/octet-stream".to_string()
        } else {
            content_type_raw
        },
    );
    builder
        .body(Body::from_stream(response.bytes_stream()))
        .unwrap_or_else(internal_error)
}

fn proxy_meta(response: &reqwest::Response, final_url: &str) -> String {
    let mut headers = serde_json::Map::new();
    for name in META_HEADERS {
        if let Some(value) = response.headers().get(name).and_then(|v| v.to_str().ok()) {
            headers.insert(
                name.to_string(),
                serde_json::Value::String(value.to_string()),
            );
        }
    }

    let meta = serde_json::json!({
        "status": response.status().as_u16(),
        "statusText": response.status().canonical_reason().unwrap_or(""),
        "url": final_url,
        "headers": headers,
    });
    base64::engine::general_purpose::STANDARD.encode(meta.to_string())
}

fn agent_script(real_url: &str, device: Option<&'static Device>) -> String {
    let device_json = match device {
        Some(device) => serde_json::json!({
            "ua": device.ua,
            "platform": device.platform,
            "mobile": device.mobile,
        })
        .to_string(),
        None => "null".to_string(),
    };

    AGENT_TEMPLATE
        .replace(
            "@@REAL_URL@@",
            &serde_json::to_string(real_url).unwrap_or_else(|_| "\"\"".to_string()),
        )
        .replace("@@DEVICE@@", &device_json)
}

// ---- source attribution ---------------------------------------------------

#[derive(Deserialize)]
struct ResolveRequest {
    #[serde(default)]
    frames: Vec<sourcemap::StackFrame>,
}

/// Turns the raw JS frames the page agent collected into original file:line, with a slice of the real
/// source. Gated by the SAME allow-list as the proxy itself: it fetches caller-named URLs, so without
/// that it is a second, less obvious SSRF door.
async fn handle_resolve(body: Bytes) -> Response {
    let Ok(request) = serde_json::from_slice::<ResolveRequest>(&body) else {
        return text(StatusCode::BAD_REQUEST, "Bad JSON");
    };
    if request.frames.is_empty() {
        return axum::Json(serde_json::json!({ "frames": [] })).into_response();
    }

    let resolved = sourcemap::resolve(&request.frames, is_target_allowed).await;

    // The top frames are framework internals; the first frame that is the app's own is the answer,
    // and the rest are ranked alternates for an ambiguous hit.
    let app_frames: Vec<_> = resolved
        .iter()
        .filter(|(_, frame)| !frame.is_third_party)
        .collect();
    let primary = app_frames.first().map(|(_, frame)| frame);

    let position = |frame: &sourcemap::ResolvedFrame| {
        serde_json::json!({
            "file": frame.file,
            "line": frame.line,
            "col": frame.col,
            "name": frame.name,
        })
    };

    axum::Json(serde_json::json!({
        "source": primary.map(position),
        "codeFrame": primary.and_then(|frame| frame.code_frame.clone()),
        "confidence": match primary {
            None => "none",
            Some(_) if app_frames.len() == 1 => "high",
            Some(_) => "medium",
        },
        "candidates": app_frames
            .iter()
            .skip(1)
            .take(5)
            .map(|(_, frame)| position(frame))
            .collect::<Vec<_>>(),
        "frames": resolved
            .iter()
            .map(|(_, frame)| serde_json::json!({
                "file": frame.file,
                "line": frame.line,
                "col": frame.col,
                "name": frame.name,
                "isThirdParty": frame.is_third_party,
            }))
            .collect::<Vec<_>>(),
    }))
    .into_response()
}

// ---- assets ---------------------------------------------------------------

async fn handle_lib(Path(file): Path<String>) -> Response {
    if file != "snapdom.mjs" {
        return text(StatusCode::NOT_FOUND, "Not found");
    }
    asset(SNAPDOM)
}

/// No `Service-Worker-Allowed` header: the component registers this at scope `/__view/`, which is
/// narrower than the script's own path, so it needs no scope widening — and must not get any. A
/// worker at `/` would see the whole host app's traffic.
async fn handle_sw() -> Response {
    asset(SERVICE_WORKER)
}

fn asset(bytes: &'static [u8]) -> Response {
    (
        [
            (header::CONTENT_TYPE, "application/javascript"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        bytes,
    )
        .into_response()
}

// ---- helpers --------------------------------------------------------------

fn header_str(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn text(status: StatusCode, body: &str) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, HeaderValue::from_static("text/plain"))],
        body.to_string(),
    )
        .into_response()
}

fn internal_error(_: axum::http::Error) -> Response {
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_token_reads_the_slash_grammar() {
        let token = match_view_token("@abc123/mobile/http://127.0.0.1:1/").expect("matches");
        assert_eq!(token.viewer, "abc123");
        assert_eq!(token.device.as_deref(), Some("mobile"));
        assert_eq!(token.length, "@abc123/mobile/".len());

        let token = match_view_token("@abc123/http://127.0.0.1:1/").expect("matches");
        assert_eq!(token.viewer, "abc123");
        assert_eq!(token.device, None);
        assert_eq!(token.length, "@abc123/".len());

        for device in ["desktop", "tablet", "mobile"] {
            let token = match_view_token(&format!("@v1/{device}/http://127.0.0.1:1/")).unwrap();
            assert_eq!(token.device.as_deref(), Some(device));
        }
    }

    #[test]
    fn view_token_rejects_the_upstream_dot_grammar_and_overlong_ids() {
        // The C# widget's "@v1.mobile/" form: the viewer id would swallow the dot, which the
        // [A-Za-z0-9] class forbids, so there is no match at all.
        assert_eq!(match_view_token("@abc123.mobile/http://127.0.0.1:1/"), None);
        assert_eq!(
            match_view_token("@toolongviewerid1234567/http://127.0.0.1:1/"),
            None
        );
        assert_eq!(match_view_token("http://127.0.0.1:1/"), None);
        assert_eq!(match_view_token("@/http://127.0.0.1:1/"), None);
        // An unknown device is not a device segment, so it stays part of the target.
        assert_eq!(
            match_view_token("@v1/watch/http://127.0.0.1:1/")
                .unwrap()
                .device,
            None
        );
    }

    #[test]
    fn allow_list_admits_loopback_apps_only() {
        for allowed in [
            "http://127.0.0.1:5173/",
            "http://127.0.0.1/",
            "http://localhost:3000/x",
            "http://LOCALHOST/x",
            "https://app.localhost/x",
            "http://[::1]:8080/",
            "http://127.9.9.9/",
        ] {
            assert!(
                is_target_allowed(&Url::parse(allowed).unwrap()),
                "should allow {allowed}"
            );
        }

        for blocked in [
            "http://93.184.216.34/",
            "http://example.com/",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5/",
            "http://[fe80::1]/",
            "http://localhost.evil.test/",
            "http://notlocalhost/",
        ] {
            assert!(
                !is_target_allowed(&Url::parse(blocked).unwrap()),
                "should block {blocked}"
            );
        }
    }

    #[test]
    fn allow_list_admits_asset_hosts_over_https_only() {
        // A proxied app that links its fonts or icon set from a CDN renders without them otherwise,
        // which is not the app the reviewer was asked to look at.
        for allowed in [
            "https://fonts.googleapis.com/css2?family=Inter",
            "https://fonts.gstatic.com/s/inter/v13/font.woff2",
            "https://cdn.jsdelivr.net/npm/chart.js",
            "https://unpkg.com/react@19/umd/react.production.min.js",
            "https://KIT.FontAwesome.com/abc.js",
        ] {
            assert!(
                is_target_allowed(&Url::parse(allowed).unwrap()),
                "should allow {allowed}"
            );
        }

        for blocked in [
            // http, not https: no asset host needs it, and insisting costs nothing.
            "http://fonts.googleapis.com/css2?family=Inter",
            // Not on the list, however asset-shaped it looks.
            "https://evil.test/font.woff2",
            // The list is matched whole: a subdomain of an allowed host is a different host.
            "https://attacker.unpkg.com/x.js",
            // And it must not have opened a door to the metadata endpoint.
            "https://169.254.169.254/latest/meta-data/",
        ] {
            assert!(
                !is_target_allowed(&Url::parse(blocked).unwrap()),
                "should block {blocked}"
            );
        }
    }

    #[test]
    fn device_lookup_is_case_insensitive_and_has_no_desktop_entry() {
        assert!(device_for("mobile").is_some());
        assert!(device_for("MOBILE").is_some());
        assert!(device_for("tablet").is_some());
        assert!(device_for("desktop").is_none());
        assert!(device_for("").is_none());
    }

    #[test]
    fn agent_script_substitutes_the_real_url_and_device() {
        let script = agent_script("http://127.0.0.1:5173/a", device_for("mobile"));
        assert!(!script.contains("@@REAL_URL@@"));
        assert!(!script.contains("@@DEVICE@@"));
        assert!(script.contains(r#""http://127.0.0.1:5173/a""#));
        assert!(script.contains(r#""platform":"iPhone""#));

        let script = agent_script("http://127.0.0.1:5173/a", None);
        assert!(
            script.contains("var DEVICE = null"),
            "device placeholder replaced with null"
        );
    }

    #[test]
    fn assets_carry_the_slash_grammar_the_rust_parser_uses() {
        let sw = std::str::from_utf8(SERVICE_WORKER).unwrap();
        assert!(
            sw.contains(r"(?:\/(desktop|tablet|mobile))?\/"),
            "sw.js token grammar"
        );
        assert!(
            AGENT_TEMPLATE.contains(r"(?:\/(desktop|tablet|mobile))?\/"),
            "agent.js token grammar"
        );
    }
}
