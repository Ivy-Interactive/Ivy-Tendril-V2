//! Plan wireframe previews, served from Tendril's own origin at `/__wireframes/{scope}/{name}/`.
//!
//! Ported from the routing half of V1's `Hosting/WireframeHost.cs` and `WireframeEndpoints.cs`.
//!
//! Serving these from the daemon rather than from a separate port is what makes a preview work over
//! HTTPS, in the desktop window, and through a share link -- the same reason the WebViewer frames the
//! proxy's own origin.
//!
//! The payload (vendor bundle, stylesheets, fonts) is identical for every wireframe, so it is served
//! once at an absolute prefix; only a wireframe's own page, bundle, public files and reload socket
//! live under its base.

use std::sync::Arc;

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::{Json, Router};
use tendril_wireframe::hosting::live_reload::CLIENT_SOURCE;
use tendril_wireframe::hosting::serving::{
    content_type_for, is_genuine_404, resolve_within, rewrite_css_urls, NO_STORE, PAYLOAD_PREFIX,
};
use tendril_wireframe::hosting::{index_html, WireframeStatus};

use crate::state::AppState;

/// The two prefixes the app's own router must not claim.
pub const ROUTE_PREFIX: &str = tendril_core::wireframes::ROUTE_PREFIX;

pub fn routes() -> Router<Arc<AppState>> {
    let mut router = Router::new();

    // The shared payload, at one absolute prefix. One literal route per area, because a parameter
    // segment would conflict with the wireframe-scoped routes below.
    for area in ["vendor", "css", "fonts"] {
        router = router.route(
            &format!("{PAYLOAD_PREFIX}/{area}/*path"),
            get(move |uri| serve_payload(area, uri)),
        );
    }

    router
        .route(
            &format!("{ROUTE_PREFIX}/:scope/:name{PAYLOAD_PREFIX}/client.js"),
            get(serve_client),
        )
        .route(
            &format!("{ROUTE_PREFIX}/:scope/:name{PAYLOAD_PREFIX}/status"),
            get(serve_status),
        )
        .route(
            &format!("{ROUTE_PREFIX}/:scope/:name{PAYLOAD_PREFIX}/hmr"),
            get(serve_hmr),
        )
        .route(
            &format!("{ROUTE_PREFIX}/:scope/:name{PAYLOAD_PREFIX}/out/*path"),
            get(serve_out),
        )
        .route(&format!("{ROUTE_PREFIX}/:scope/:name"), get(serve_page))
        .route(&format!("{ROUTE_PREFIX}/:scope/:name/"), get(serve_page))
        .route(
            &format!("{ROUTE_PREFIX}/:scope/:name/*path"),
            get(serve_page),
        )
}

fn no_store(mut response: Response) -> Response {
    for (name, value) in NO_STORE {
        response
            .headers_mut()
            .insert(name, HeaderValue::from_static(value));
    }
    response
}

fn typed(body: Vec<u8>, content_type: &str) -> Response {
    let mut response = Response::new(Body::from(body));
    if let Ok(value) = HeaderValue::from_str(content_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, value);
    }
    no_store(response)
}

fn not_found() -> Response {
    no_store(StatusCode::NOT_FOUND.into_response())
}

async fn serve_payload(area: &'static str, uri: Uri) -> Response {
    let prefix = format!("{PAYLOAD_PREFIX}/{area}/");
    let Some(path) = uri.path().split_once(&prefix).map(|(_, rest)| rest) else {
        return not_found();
    };
    let Some(bytes) = tendril_wireframe::assets::catalog::try_read(&format!("{area}/{path}"))
    else {
        return not_found();
    };

    // fonts.css names its files by absolute URL, and they are already absolute here, so there is no
    // base to add. The rewrite stays for a deployment that mounts the daemon under a path prefix.
    if area == "css" {
        if let Ok(text) = std::str::from_utf8(bytes) {
            return typed(
                rewrite_css_urls(text, "").into_bytes(),
                content_type_for(path),
            );
        }
    }
    typed(bytes.to_vec(), content_type_for(path))
}

async fn serve_client() -> Response {
    typed(
        CLIENT_SOURCE.as_bytes().to_vec(),
        "text/javascript; charset=utf-8",
    )
}

async fn serve_status(
    State(state): State<Arc<AppState>>,
    Path((scope, name)): Path<(String, String)>,
) -> Response {
    if !valid(&scope, &name) {
        return no_store(Json(WireframeStatus::missing()).into_response());
    }
    let status = state.wireframe_host.status(&scope, &name).await;
    no_store(Json(status).into_response())
}

async fn serve_out(
    State(state): State<Arc<AppState>>,
    Path((scope, name, path)): Path<(String, String, String)>,
) -> Response {
    if !valid(&scope, &name) {
        return not_found();
    }
    // `find`, not `open`: an asset request must never start a build. Only a page load does that.
    let Some((_, out_dir)) = state.wireframe_host.find(&scope, &name).await else {
        return not_found();
    };
    match resolve_within(&out_dir, &path).and_then(|full| std::fs::read(full).ok()) {
        Some(bytes) => typed(bytes, content_type_for(&path)),
        None => not_found(),
    }
}

async fn serve_hmr(
    State(state): State<Arc<AppState>>,
    Path((scope, name)): Path<(String, String)>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !valid(&scope, &name) {
        return not_found();
    }
    let Some(hub) = state.wireframe_host.hub(&scope, &name).await else {
        return not_found();
    };
    upgrade.on_upgrade(move |socket| pump(socket, hub))
}

async fn pump(mut socket: WebSocket, hub: tendril_wireframe::hosting::LiveReloadHub) {
    let mut messages = hub.subscribe();
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                None | Some(Err(_)) => break,
                Some(Ok(_)) => continue,
            },
            outgoing = messages.recv() => match outgoing {
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Ok(message) => {
                    let Ok(json) = serde_json::to_string(&message) else { continue };
                    if socket.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
            },
        }
    }
}

async fn serve_page(State(state): State<Arc<AppState>>, uri: Uri) -> Response {
    let Some((scope, name, relative)) = split_route(uri.path()) else {
        return not_found();
    };
    if !valid(&scope, &name) {
        return not_found();
    }

    if !relative.is_empty() {
        // The wireframe's own public/ directory, without starting a build.
        if let Some((site, _)) = state.wireframe_host.find(&scope, &name).await {
            if let Some(bytes) = resolve_within(&site.project.public_dir(), &relative)
                .and_then(|full| std::fs::read(full).ok())
            {
                return typed(bytes, content_type_for(&relative));
            }
        }
        if is_genuine_404(&relative) {
            return not_found();
        }
    }

    // The page's relative URLs resolve against its address, so the base must end in a slash.
    if relative.is_empty() && !uri.path().ends_with('/') {
        return Redirect::temporary(&format!("{}/", uri.path())).into_response();
    }

    let Some((site, _)) = state.wireframe_host.open(&scope, &name).await else {
        return no_store(
            (
                StatusCode::NOT_FOUND,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                "There is no wireframe at this address.",
            )
                .into_response(),
        );
    };

    let base = format!("{ROUTE_PREFIX}/{scope}/{name}/");
    match index_html::build(
        state.wireframe_host.vendor(),
        &site,
        &base,
        &format!("{PAYLOAD_PREFIX}/"),
    ) {
        Ok(html) => typed(html.into_bytes(), "text/html; charset=utf-8"),
        Err(e) => no_store(
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Could not build the wireframe page: {e}"),
            )
                .into_response(),
        ),
    }
}

fn valid(scope: &str, name: &str) -> bool {
    tendril_core::wireframes::is_valid_scope(scope) && tendril_core::wireframes::is_valid_name(name)
}

/// Splits `/__wireframes/{scope}/{name}/rest` into its parts.
///
/// Done by hand rather than with three path parameters, because the same handler serves the bare
/// address, the trailing-slash address and any path under it, and axum's extractors would need a
/// different signature for each.
fn split_route(path: &str) -> Option<(String, String, String)> {
    let rest = path.strip_prefix(ROUTE_PREFIX)?.trim_start_matches('/');
    let mut parts = rest.splitn(3, '/');
    let scope = parts.next()?.to_string();
    let name = parts.next()?.to_string();
    let relative = parts.next().unwrap_or("").to_string();
    if scope.is_empty() || name.is_empty() {
        return None;
    }
    Some((scope, name, relative))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_route_splits_into_scope_name_and_the_rest() {
        assert_eq!(
            split_route("/__wireframes/99/checkout/"),
            Some(("99".into(), "checkout".into(), "".into()))
        );
        assert_eq!(
            split_route("/__wireframes/99/checkout"),
            Some(("99".into(), "checkout".into(), "".into()))
        );
        assert_eq!(
            split_route("/__wireframes/99/checkout/img/logo.png"),
            Some(("99".into(), "checkout".into(), "img/logo.png".into()))
        );
        assert_eq!(split_route("/__wireframes/99"), None);
        assert_eq!(split_route("/api/plans"), None);
    }

    #[test]
    fn a_crafted_scope_or_name_is_refused_before_it_reaches_the_filesystem() {
        assert!(valid("99", "checkout"));
        assert!(!valid("99", "../../etc/passwd"));
        assert!(!valid("../99", "checkout"));
        assert!(!valid("99", "Checkout"));
        assert!(!valid("abc", "checkout"));
    }
}
