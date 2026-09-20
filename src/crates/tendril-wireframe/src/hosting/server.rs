//! The standalone dev server behind `tendril wireframe serve` and `screenshot`.
//!
//! Ported from V1's `Hosting/WireframeServer.cs`. Binds a free loopback port and serves one
//! wireframe at its root, through the same decisions Tendril's plan previews use.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as AxumPath, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::Router;

use crate::assets::{catalog, VendorManifest};
use crate::hosting::live_reload::{LiveReloadHub, CLIENT_SOURCE};
use crate::hosting::serving::{
    content_type_for, is_genuine_404, resolve_within, rewrite_css_urls, site_base, NO_STORE,
    PAYLOAD_PREFIX,
};
use crate::hosting::{index_html, WireframeSite};

#[derive(Debug, Clone)]
pub struct ServerOptions {
    pub site: WireframeSite,
    pub out_dir: PathBuf,
    /// 0 asks the OS for a free port, which is the normal case.
    pub port: u16,
}

struct ServerState {
    site: WireframeSite,
    out_dir: PathBuf,
    hub: LiveReloadHub,
    vendor: VendorManifest,
}

pub struct WireframeServer {
    pub url: String,
    pub hub: LiveReloadHub,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    joined: Option<tokio::task::JoinHandle<()>>,
}

impl WireframeServer {
    pub async fn start(options: ServerOptions) -> Result<Self> {
        let hub = LiveReloadHub::new();
        let state = Arc::new(ServerState {
            site: options.site,
            out_dir: options.out_dir,
            hub: hub.clone(),
            vendor: VendorManifest::parse(catalog::read_text("vendor.manifest.json")?)?,
        });

        let app = router(Arc::clone(&state));

        // Loopback only, and 127.0.0.1 rather than "localhost": the name means both 127.0.0.1 and
        // [::1], which with port 0 would allocate two *different* ephemeral ports. Loopback-only is
        // also deliberate -- an unreleased wireframe has no business being reachable from the
        // network.
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, options.port));
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .with_context(|| format!("Binding {addr}"))?;

        // The only race-free way to learn the port is to read it back from the bound listener.
        let bound = listener.local_addr().context("Reading the bound address")?;
        let url = format!("http://127.0.0.1:{}", bound.port());

        let (shutdown, shutdown_rx) = tokio::sync::oneshot::channel();
        let joined = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        Ok(Self {
            url,
            hub,
            shutdown: Some(shutdown),
            joined: Some(joined),
        })
    }

    pub async fn stop(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(joined) = self.joined.take() {
            let _ = joined.await;
        }
    }
}

fn router(state: Arc<ServerState>) -> Router {
    // One route per payload area rather than a `:area` parameter: a parameter segment here would
    // conflict with the literal `/out/` route below, and matchit rejects that at construction.
    let mut router = Router::new();
    for area in ["vendor", "css", "fonts"] {
        router = router.route(
            &format!("{PAYLOAD_PREFIX}/{area}/*path"),
            get(move |path| serve_payload(area, path)),
        );
    }

    router
        .route(&format!("{PAYLOAD_PREFIX}/client.js"), get(serve_client))
        .route(&format!("{PAYLOAD_PREFIX}/hmr"), get(serve_hmr))
        .route(&format!("{PAYLOAD_PREFIX}/report"), post(report_error))
        .route(
            &format!("{PAYLOAD_PREFIX}/utilities.css"),
            get(serve_utilities),
        )
        .route(&format!("{PAYLOAD_PREFIX}/out/*path"), get(serve_out))
        .route("/", get(serve_page))
        .route("/*path", get(serve_page))
        .with_state(state)
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

async fn serve_payload(area: &'static str, AxumPath(path): AxumPath<String>) -> Response {
    let Some(bytes) = catalog::try_read(&format!("{area}/{path}")) else {
        return no_store(StatusCode::NOT_FOUND.into_response());
    };

    // The standalone server has no path base, so the css rewrite is a no-op here; it matters for
    // the plan-preview host, which serves the same bytes under a prefix.
    if area == "css" {
        if let Ok(text) = std::str::from_utf8(bytes) {
            return typed(
                rewrite_css_urls(text, "").into_bytes(),
                content_type_for(&path),
            );
        }
    }
    typed(bytes.to_vec(), content_type_for(&path))
}

async fn serve_client() -> Response {
    typed(
        CLIENT_SOURCE.as_bytes().to_vec(),
        "text/javascript; charset=utf-8",
    )
}

async fn serve_utilities(State(state): State<Arc<ServerState>>) -> Response {
    match state
        .site
        .utility_css_path
        .as_ref()
        .and_then(|p| std::fs::read(p).ok())
    {
        Some(bytes) => typed(bytes, "text/css; charset=utf-8"),
        None => no_store(StatusCode::NOT_FOUND.into_response()),
    }
}

async fn serve_out(
    State(state): State<Arc<ServerState>>,
    AxumPath(path): AxumPath<String>,
) -> Response {
    match resolve_within(&state.out_dir, &path) {
        Some(full) => match std::fs::read(&full) {
            Ok(bytes) => typed(bytes, content_type_for(&path)),
            Err(_) => no_store(StatusCode::NOT_FOUND.into_response()),
        },
        None => no_store(StatusCode::NOT_FOUND.into_response()),
    }
}

/// A beacon from the page. A malformed one is not worth failing the request over.
async fn report_error(body: String) -> Response {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
        let kind = value["kind"].as_str().unwrap_or("error");
        let detail = value["detail"].as_str().unwrap_or("");
        tracing::warn!("wireframe page {kind}: {detail}");
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn serve_hmr(State(state): State<Arc<ServerState>>, upgrade: WebSocketUpgrade) -> Response {
    let hub = state.hub.clone();
    upgrade.on_upgrade(move |socket| pump_reloads(socket, hub))
}

async fn pump_reloads(mut socket: WebSocket, hub: LiveReloadHub) {
    let mut messages = hub.subscribe();
    loop {
        tokio::select! {
            // A closed or errored socket ends the pump; the page reconnects on its own.
            incoming = socket.recv() => match incoming {
                None | Some(Err(_)) => break,
                Some(Ok(_)) => continue,
            },
            outgoing = messages.recv() => match outgoing {
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                // Lagging only means this page missed an intermediate build; the next reload
                // supersedes it anyway.
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

async fn serve_page(State(state): State<Arc<ServerState>>, uri: Uri) -> Response {
    let request_path = uri.path().to_string();
    let relative = request_path.trim_start_matches('/').to_string();

    if !relative.is_empty() {
        // The wireframe's own public/ directory first.
        if let Some(full) = resolve_within(&state.site.project.public_dir(), &relative) {
            if let Ok(bytes) = std::fs::read(&full) {
                return typed(bytes, content_type_for(&relative));
            }
        }

        // A request WITH an extension that could not be satisfied is a genuine 404. Returning the
        // page here is the classic SPA-server bug.
        if is_genuine_404(&relative) {
            return no_store(StatusCode::NOT_FOUND.into_response());
        }
    }

    // The page's own relative URLs resolve against its address, so the base must end in a slash or
    // they land one level up.
    if relative.is_empty() && !request_path.ends_with('/') {
        return Redirect::temporary(&format!("{request_path}/")).into_response();
    }

    let base = site_base(&request_path, &relative);
    match index_html::build(
        &state.vendor,
        &state.site,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::WireframeProject;

    async fn serve_scratch() -> (tempfile::TempDir, WireframeServer) {
        let dir = tempfile::tempdir().unwrap();
        let project = WireframeProject::at(dir.path().join("demo"));
        std::fs::create_dir_all(project.public_dir()).unwrap();
        std::fs::write(
            project.index_html(),
            "<html><head></head><body><div id=\"root\"></div></body></html>",
        )
        .unwrap();
        std::fs::write(project.public_dir().join("logo.svg"), "<svg/>").unwrap();

        let out_dir = dir.path().join("out");
        std::fs::create_dir_all(&out_dir).unwrap();
        std::fs::write(out_dir.join("bundle.js"), "export {};").unwrap();

        let mut site = WireframeSite::new(project);
        site.live_reload = true;

        let server = WireframeServer::start(ServerOptions {
            site,
            out_dir,
            port: 0,
        })
        .await
        .unwrap();
        (dir, server)
    }

    #[tokio::test]
    async fn it_binds_a_free_loopback_port_and_serves_the_page() {
        let (_guard, server) = serve_scratch().await;
        assert!(
            server.url.starts_with("http://127.0.0.1:"),
            "got {}",
            server.url
        );

        let body = reqwest::get(format!("{}/", server.url))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(body.contains("id=\"root\""), "the user's markup is served");
        assert!(body.contains("importmap"), "the import map is injected");
        assert!(body.contains("__wireframe/out/bundle.js"));
        assert!(body.contains("__wireframe/client.js"), "live reload was on");

        server.stop().await;
    }

    #[tokio::test]
    async fn the_bundle_the_payload_and_public_files_are_all_reachable() {
        let (_guard, server) = serve_scratch().await;

        let bundle = reqwest::get(format!("{}/__wireframe/out/bundle.js", server.url))
            .await
            .unwrap();
        assert_eq!(bundle.status(), 200);
        assert_eq!(
            bundle.headers()["content-type"],
            "text/javascript; charset=utf-8"
        );

        let css = reqwest::get(format!(
            "{}/__wireframe/css/wireframe-utilities.css",
            server.url
        ))
        .await
        .unwrap();
        assert_eq!(css.status(), 200, "the embedded payload is served");

        let logo = reqwest::get(format!("{}/logo.svg", server.url))
            .await
            .unwrap();
        assert_eq!(logo.status(), 200, "the wireframe's own public/ is served");
        assert_eq!(logo.headers()["content-type"], "image/svg+xml");

        server.stop().await;
    }

    #[tokio::test]
    async fn a_missing_module_is_a_404_rather_than_the_page() {
        // The bug this guards produces "Failed to load module script: MIME type text/html", which
        // points at nothing useful.
        let (_guard, server) = serve_scratch().await;
        let response = reqwest::get(format!("{}/nope.js", server.url))
            .await
            .unwrap();
        assert_eq!(response.status(), 404);
        server.stop().await;
    }

    #[tokio::test]
    async fn an_extensionless_route_gets_the_wireframe() {
        let (_guard, server) = serve_scratch().await;
        let body = reqwest::get(format!("{}/settings", server.url))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(
            body.contains("id=\"root\""),
            "a route renders the wireframe"
        );
        server.stop().await;
    }

    #[tokio::test]
    async fn nothing_is_cached() {
        // It is a dev server; a cached bundle is a wireframe that does not update.
        let (_guard, server) = serve_scratch().await;
        let response = reqwest::get(format!("{}/", server.url)).await.unwrap();
        assert!(
            response.headers()["cache-control"]
                .to_str()
                .unwrap()
                .contains("no-store"),
            "got {:?}",
            response.headers()["cache-control"]
        );
        server.stop().await;
    }
}
