//! End-to-end coverage for the WebViewer proxy endpoints.
//!
//! Every request here is made WITHOUT an `Authorization` header, which is the point: the endpoints
//! are mounted outside `auth_middleware` because a browser cannot attach one to an `<iframe src>`
//! navigation. A test that authenticated itself would pass even if the routes were accidentally moved
//! behind the middleware, and the component would then break in the app.
//!
//! Both servers — the Tendril router under test and the fixture "upstream" it proxies — bind
//! 127.0.0.1:0, so the fixture is a real loopback target the allow-list admits.

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use base64::Engine;
use std::path::PathBuf;
use std::sync::Arc;
use tendril_server::{create_router, AppState};

// ---- harness --------------------------------------------------------------

struct Server {
    port: u16,
    tendril_home: Option<PathBuf>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(home) = &self.tendril_home {
            let _ = std::fs::remove_dir_all(home);
        }
    }
}

async fn serve(app: Router, tendril_home: Option<PathBuf>) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (shutdown, rx) = tokio::sync::oneshot::channel::<()>();

    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
    });

    Server {
        port,
        tendril_home,
        shutdown: Some(shutdown),
    }
}

/// The Tendril router itself. No `MasterGuard`: nothing these endpoints touch reads the master file,
/// and acquiring one would contend with every other test binary.
async fn start_tendril() -> Server {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-webviewer-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        tendril_home.join("Plans"),
        tendril_core::config::generate_bearer_secret(),
    ));
    serve(create_router(state), Some(tendril_home)).await
}

const PAGE: &str = r#"<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'">
<base href="/app/">
<link rel="stylesheet" href="style.css" integrity="sha384-nope">
</head><body>
<a href="/next.html">next</a>
<img srcset="a.png 1x, /b.png 2x">
<style>body { background: url(bg.png) }</style>
<script src="/chunks/main.js"></script>
</body></html>
"#;

const STYLESHEET: &str = "@import \"theme.css\";\nbody { background: url('/img/bg.png') }\n";

/// A one-segment map: generated line 1 column 0 comes from `src/app.ts` line 1 column 0.
fn source_map() -> String {
    serde_json::json!({
        "version": 3,
        "file": "app.js",
        "sources": ["src/app.ts"],
        "sourcesContent": ["const a = 1;\nfunction boom() {\n  throw new Error('boom');\n}\n"],
        "names": [],
        "mappings": "AAAA",
    })
    .to_string()
}

fn script() -> String {
    format!(
        "function boom(){{throw new Error('boom')}}\n//# sourceMappingURL=data:application/json;base64,{}\n",
        base64::engine::general_purpose::STANDARD.encode(source_map())
    )
}

/// The site being reviewed. Serves just enough to exercise each content branch of the proxy.
async fn start_upstream() -> Server {
    let app = Router::new()
        .route("/page.html", get(|| async { axum::response::Html(PAGE) }))
        .route(
            "/app/style.css",
            get(|| async { ([(header::CONTENT_TYPE, "text/css")], STYLESHEET) }),
        )
        .route(
            "/app.js",
            get(|| async { ([(header::CONTENT_TYPE, "application/javascript")], script()) }),
        )
        .route(
            "/logo.png",
            get(|| async { ([(header::CONTENT_TYPE, "image/png")], PNG.to_vec()) }),
        )
        // Sends the proxy somewhere the allow-list refuses.
        .route(
            "/offsite",
            get(|| async {
                (
                    StatusCode::FOUND,
                    [(header::LOCATION, "http://example.com/")],
                )
                    .into_response()
            }),
        )
        .route(
            "/echo-headers",
            get(|headers: HeaderMap| async move {
                let seen: Vec<_> = headers
                    .iter()
                    .map(|(name, value)| {
                        serde_json::json!([name.as_str(), value.to_str().unwrap_or("")])
                    })
                    .collect();
                (
                    [(header::CONTENT_TYPE, "application/json")],
                    serde_json::Value::from(seen).to_string(),
                )
            }),
        );
    serve(app, None).await
}

/// Smallest valid PNG: an 8-bit greyscale 1x1.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x3A, 0x7E, 0x9B,
    0x55, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
];

/// No redirect following and no auth header, so what the endpoint answered is what is asserted on.
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
}

// ---- tests ----------------------------------------------------------------

#[tokio::test]
async fn view_path_rewrites_html_without_authentication() {
    let upstream = start_upstream().await;
    let tendril = start_tendril().await;
    let target = format!("http://127.0.0.1:{}/page.html", upstream.port);

    let response = client()
        .get(format!(
            "http://127.0.0.1:{}/__view/@v1/desktop/{}",
            tendril.port, target
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "text/html; charset=utf-8"
    );
    // The proxy copies no upstream header it was not asked to, so a CSP cannot survive the trip.
    assert!(response.headers().get("content-security-policy").is_none());

    let meta = response
        .headers()
        .get("x-proxy-meta")
        .expect("the service worker's HAR side channel is present")
        .to_str()
        .unwrap()
        .to_string();
    let html = response.text().await.unwrap();

    let origin = format!("http://127.0.0.1:{}", upstream.port);

    // The page's own <base href="/app/"> is consumed and replaced by the view-space equivalent, so
    // its relative URLs keep resolving the way the upstream page meant them to.
    assert!(
        html.contains(&format!("<base href=\"/__view/{origin}/app/\">")),
        "{html}"
    );
    assert!(!html.contains("href=\"/app/\""), "{html}");

    // The agent runs before page scripts, with the real URL substituted in.
    assert!(html.contains(&format!("\"{target}\"")), "{html}");
    assert!(!html.contains("@@REAL_URL@@"), "{html}");

    assert!(
        html.contains(&format!("href=\"/__view/{origin}/next.html\"")),
        "{html}"
    );
    assert!(
        html.contains(&format!(
            "srcset=\"/__view/{origin}/app/a.png 1x, /__view/{origin}/b.png 2x\""
        )),
        "{html}"
    );
    assert!(
        html.contains(&format!("url(/__view/{origin}/app/bg.png)")),
        "{html}"
    );
    // A same-origin script keeps the site's own path: a module-chunk runtime derives the chunk id
    // from it.
    assert!(html.contains("src=\"/chunks/main.js\""), "{html}");
    // The rewritten stylesheet no longer matches the upstream hash.
    assert!(!html.contains("integrity="), "{html}");
    assert!(
        !html.to_lowercase().contains("content-security-policy"),
        "{html}"
    );

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(meta)
        .expect("x-proxy-meta is base64");
    let meta: serde_json::Value = serde_json::from_slice(&decoded).expect("x-proxy-meta is JSON");
    assert_eq!(meta["status"], 200);
    assert_eq!(meta["url"], serde_json::Value::String(target));
    assert!(meta["headers"]["content-type"]
        .as_str()
        .unwrap()
        .contains("text/html"));
}

#[tokio::test]
async fn proxy_query_rewrites_css_urls() {
    let upstream = start_upstream().await;
    let tendril = start_tendril().await;
    let origin = format!("http://127.0.0.1:{}", upstream.port);

    let response = client()
        .get(format!(
            "http://127.0.0.1:{}/__proxy?url={origin}/app/style.css",
            tendril.port
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "text/css; charset=utf-8"
    );

    let css = response.text().await.unwrap();
    // Relative to the stylesheet's own URL, not the page's.
    assert!(
        css.contains(&format!("@import \"/__view/{origin}/app/theme.css\"")),
        "{css}"
    );
    assert!(
        css.contains(&format!("url('/__view/{origin}/img/bg.png')")),
        "{css}"
    );
}

#[tokio::test]
async fn non_text_bodies_pass_through_untouched() {
    let upstream = start_upstream().await;
    let tendril = start_tendril().await;

    let response = client()
        .get(format!(
            "http://127.0.0.1:{}/__proxy?url=http://127.0.0.1:{}/logo.png",
            tendril.port, upstream.port
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "image/png"
    );
    assert_eq!(response.bytes().await.unwrap().as_ref(), PNG);
}

#[tokio::test]
async fn device_emulation_rewrites_the_client_hints() {
    let upstream = start_upstream().await;
    let tendril = start_tendril().await;

    let response = client()
        .get(format!(
            "http://127.0.0.1:{}/__view/@v1/mobile/http://127.0.0.1:{}/echo-headers",
            tendril.port, upstream.port
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let seen: Vec<(String, String)> =
        serde_json::from_str::<Vec<(String, String)>>(&response.text().await.unwrap()).unwrap();
    let header_value = |name: &str| {
        seen.iter()
            .find(|(header, _)| header == name)
            .map(|(_, value)| value.clone())
    };

    assert!(header_value("user-agent").unwrap().contains("iPhone"));
    assert_eq!(header_value("sec-ch-ua-mobile").as_deref(), Some("?1"));
    assert_eq!(
        header_value("sec-ch-ua-platform").as_deref(),
        Some("\"iOS\"")
    );
    // Never relayed: one shared origin would mean one shared cookie jar for every proxied site.
    assert_eq!(header_value("cookie"), None);
}

#[tokio::test]
async fn targets_outside_the_allow_list_are_refused() {
    let tendril = start_tendril().await;

    for target in [
        "http://example.com/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/internal",
    ] {
        let response = client()
            .get(format!(
                "http://127.0.0.1:{}/__proxy?url={target}",
                tendril.port
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::FORBIDDEN,
            "{target} should be refused"
        );
    }

    // A missing or unusable target never reaches the network either.
    let missing = client()
        .get(format!("http://127.0.0.1:{}/__proxy", tendril.port))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::BAD_REQUEST);

    let scheme = client()
        .get(format!(
            "http://127.0.0.1:{}/__proxy?url=file:///etc/passwd",
            tendril.port
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(scheme.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_redirect_off_the_allow_list_is_refused_too() {
    let upstream = start_upstream().await;
    let tendril = start_tendril().await;

    // The first hop is allowed; the second is the upstream's choice, and the allow-list gets a say
    // in it rather than the client following it blindly.
    let response = client()
        .get(format!(
            "http://127.0.0.1:{}/__proxy?url=http://127.0.0.1:{}/offsite",
            tendril.port, upstream.port
        ))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(
        response.text().await.unwrap().contains("example.com"),
        "the refused authority is named"
    );
}

#[tokio::test]
async fn a_capture_round_trips_through_the_captures_endpoint() {
    let tendril = start_tendril().await;
    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(PNG)
    );

    let response = client()
        .post(format!("http://127.0.0.1:{}/__capture", tendril.port))
        .json(&serde_json::json!({
            "dataUrl": data_url,
            "mode": "viewport",
            "w": 1,
            "h": 1,
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = response.json().await.unwrap();

    // `saveCapture` in WebViewer.tsx reads exactly this field.
    let filename = body["filename"].as_str().expect("filename is returned");
    assert!(filename.ends_with("-viewport.png"), "{filename}");
    assert_eq!(body["url"], format!("/__captures/{filename}"));

    let served = client()
        .get(format!(
            "http://127.0.0.1:{}/__captures/{filename}",
            tendril.port
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(
        served
            .headers()
            .get(header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "image/png"
    );
    assert_eq!(served.bytes().await.unwrap().as_ref(), PNG);

    let missing = client()
        .get(format!(
            "http://127.0.0.1:{}/__captures/nothing-here.png",
            tendril.port
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    let rejected = client()
        .post(format!("http://127.0.0.1:{}/__capture", tendril.port))
        .json(&serde_json::json!({ "dataUrl": "data:image/jpeg;base64,AAAA" }))
        .send()
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn resolve_maps_a_frame_back_to_the_original_source() {
    let upstream = start_upstream().await;
    let tendril = start_tendril().await;

    let response = client()
        .post(format!("http://127.0.0.1:{}/__resolve", tendril.port))
        .json(&serde_json::json!({
            "frames": [{
                "url": format!("http://127.0.0.1:{}/app.js", upstream.port),
                "line": 1,
                "col": 0,
            }],
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = response.json().await.unwrap();

    assert_eq!(body["source"]["file"], "src/app.ts");
    assert_eq!(body["source"]["line"], 1);
    assert_eq!(body["confidence"], "high");
    // The code frame is the point of the endpoint: the original text, without another round trip.
    let frame = body["codeFrame"].as_str().expect("a code frame is built");
    assert!(frame.contains("> 1 | const a = 1;"), "{frame}");
    assert_eq!(body["frames"][0]["isThirdParty"], false);
}

#[tokio::test]
async fn resolve_will_not_fetch_a_frame_off_the_allow_list() {
    let tendril = start_tendril().await;

    let response = client()
        .post(format!("http://127.0.0.1:{}/__resolve", tendril.port))
        .json(&serde_json::json!({
            "frames": [{ "url": "http://example.com/app.js", "line": 1, "col": 0 }],
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["source"], serde_json::Value::Null);
    assert_eq!(body["confidence"], "none");
    assert_eq!(body["frames"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn the_page_side_assets_are_served() {
    let tendril = start_tendril().await;

    for path in ["/sw.js", "/__lib/snapdom.mjs"] {
        let response = client()
            .get(format!("http://127.0.0.1:{}{path}", tendril.port))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            response
                .headers()
                .get(header::CONTENT_TYPE)
                .unwrap()
                .to_str()
                .unwrap(),
            "application/javascript",
            "{path}"
        );
        // The worker is registered at the narrower /__view/ scope, so it needs no scope widening —
        // and must not be granted any, or it would see the host app's own traffic.
        assert!(
            response.headers().get("service-worker-allowed").is_none(),
            "{path}"
        );
        assert!(!response.text().await.unwrap().is_empty(), "{path}");
    }

    let unknown = client()
        .get(format!(
            "http://127.0.0.1:{}/__lib/anything.mjs",
            tendril.port
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_api_routes_still_require_a_token() {
    let tendril = start_tendril().await;

    // The proxy endpoints are unauthenticated; merging them must not have taken the auth layer off
    // anything else.
    let response = client()
        .get(format!("http://127.0.0.1:{}/api/plans", tendril.port))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
