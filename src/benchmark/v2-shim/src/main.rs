//! Benchmark-only IPC shim for Tendril V2.
//!
//! The V2 frontend only talks to its Tauri host, so a plain browser cannot run it. This process
//! stands in for that host: it serves the built `dist` (with SPA fallback) and answers the page's
//! `invoke()` calls by running the app's *real* `cmd_*` handlers inside a MockRuntime Tauri app, and
//! it forwards the events the app's own WS/SSE bridges emit to the page over SSE. What it measures
//! is therefore the app's command, mapping and bridge code, with a loopback hop in place of Tauri's
//! custom protocol, rendered by Blink instead of WKWebView. Its memory is not `tendril-app` memory.
//!
//! Usage:
//!   v2shim <dist-dir> <port> [--home <tendril-home>] [--host <ip>] [--allow-no-master]
//!   v2shim --describe
//!
//! Start it only after the daemon answers /api/health: like the app's setup, the bridges read
//! `<home>/.master` once. Restart it whenever the daemon restarts (the bearer secret changes).
//! On success it prints exactly one stdout line, `shim listening on http://<host>:<port>`.

use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as UrlPath, State};
use axum::http::{header, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use base64::Engine as _;
use futures_util::stream::Stream;
use futures_util::{SinkExt, StreamExt};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponse, InvokeResponseBody};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{AppHandle, Listener, Manager, Webview};
use tokio::sync::{broadcast, mpsc, oneshot};

mod command_info {
    include!(concat!(env!("OUT_DIR"), "/command_info.rs"));
}

/// Commands whose signatures take `tauri::AppHandle` (the Wry runtime), which MockRuntime cannot
/// provide. Neither is on a benchmark path (they start a review action / stream a job's events); they
/// fail loudly, and the failure shows up in `window.__SHIM_IPC__`, instead of pretending to work.
#[allow(dead_code)]
mod stubs {
    fn unsupported(cmd: &str) -> String {
        format!("{cmd} is not available under the benchmark IPC shim: it needs the Wry runtime (a real Tauri window)")
    }

    #[tauri::command]
    pub async fn cmd_execute_review_action() -> Result<(), String> {
        Err(unsupported("cmd_execute_review_action"))
    }

    #[tauri::command]
    pub async fn cmd_subscribe_job_events() -> Result<(), String> {
        Err(unsupported("cmd_subscribe_job_events"))
    }
}

/// Every event the app's bridges emit today. They are subscribed up front so nothing emitted
/// between page load and the page's own `listen()` is lost to a late registration; names the page
/// listens to beyond these are registered on demand.
const KNOWN_EVENTS: &[&str] = &[
    "plan-event",
    "job-event",
    "chat-event",
    "service-status",
    "change-event",
    "change-stream-status",
    "job-stream-event",
    "agent-terminal-event",
    "agent-terminal-stream-status",
    "review-action-event",
    "review-action-stream-status",
];

struct Asset {
    body: Bytes,
    mime: &'static str,
}

#[derive(Clone)]
struct Shim {
    app: AppHandle<MockRuntime>,
    webview: Webview<MockRuntime>,
    events: broadcast::Sender<String>,
    listening: Arc<Mutex<HashSet<String>>>,
    assets: Arc<HashMap<String, Asset>>,
    info: Arc<serde_json::Value>,
}

struct Args {
    dist: PathBuf,
    port: u16,
    host: String,
    home: Option<String>,
    allow_no_master: bool,
}

fn die(code: i32, msg: &str) -> ! {
    eprintln!("v2shim: {msg}");
    std::process::exit(code);
}

fn parse_args() -> Args {
    let mut positional = Vec::new();
    let mut host = "127.0.0.1".to_string();
    let mut home = None;
    let mut allow_no_master = false;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--describe" => {
                let d = serde_json::json!({
                    "registered": command_info::REGISTERED,
                    "stubbed": command_info::STUBBED,
                    "tendrilAppDir": command_info::TENDRIL_APP_DIR,
                    "knownEvents": KNOWN_EVENTS,
                });
                println!("{d}");
                std::process::exit(0);
            }
            "--host" => host = it.next().unwrap_or_else(|| die(2, "--host needs a value")),
            "--home" => home = Some(it.next().unwrap_or_else(|| die(2, "--home needs a value"))),
            "--allow-no-master" => allow_no_master = true,
            "-h" | "--help" => {
                println!("usage: v2shim <dist-dir> <port> [--home <tendril-home>] [--host <ip>] [--allow-no-master]\n       v2shim --describe");
                std::process::exit(0);
            }
            s if s.starts_with("--") => die(2, &format!("unknown flag {s}")),
            _ => positional.push(a),
        }
    }
    if positional.len() != 2 {
        die(2, "usage: v2shim <dist-dir> <port> [--home <tendril-home>] [--host <ip>] [--allow-no-master]");
    }
    let port = positional[1].parse::<u16>().unwrap_or_else(|_| die(2, &format!("bad port {}", positional[1])));
    Args { dist: PathBuf::from(&positional[0]), port, host, home, allow_no_master }
}

/// Every app module resolves the home from TENDRIL_HOME (else ~/.tendril), so the variable is the
/// single switch; it is pinned before anything reads it and never allowed to be the real home.
fn pin_home(flag: Option<String>) -> PathBuf {
    let home = flag.or_else(|| std::env::var("TENDRIL_HOME").ok()).map(|h| h.trim().to_string()).unwrap_or_default();
    if home.is_empty() {
        die(2, "no Tendril home: pass --home <dir> or set TENDRIL_HOME (the shim never falls back to ~/.tendril)");
    }
    let home = std::fs::canonicalize(&home).unwrap_or_else(|e| die(2, &format!("home {home}: {e}")));
    if let Ok(user) = std::env::var("HOME") {
        let real = Path::new(&user).join(".tendril");
        if std::fs::canonicalize(&real).map(|r| r == home).unwrap_or(false) {
            die(2, &format!("refusing to run against the real Tendril home {}", real.display()));
        }
    }
    // Still single-threaded here: no runtime or app exists yet.
    std::env::set_var("TENDRIL_HOME", &home);
    home
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// The whole dist, in memory, like the assets Tauri compiles into the app binary: serving never
/// touches the disk, so disk caches cannot make one cold load look different from the next.
fn load_dist(root: &Path) -> HashMap<String, Asset> {
    fn walk(root: &Path, dir: &Path, out: &mut HashMap<String, Asset>) {
        let rd = std::fs::read_dir(dir).unwrap_or_else(|e| die(2, &format!("read {}: {e}", dir.display())));
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(root, &p, out);
            } else {
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                let body = std::fs::read(&p).unwrap_or_else(|e| die(2, &format!("read {}: {e}", p.display())));
                out.insert(format!("/{rel}"), Asset { body: Bytes::from(body), mime: mime_for(&p) });
            }
        }
    }
    let mut out = HashMap::new();
    walk(root, root, &mut out);
    if !out.contains_key("/index.html") {
        die(2, &format!("{} has no index.html (build the frontend first)", root.display()));
    }
    out
}

fn main() {
    let args = parse_args();
    let home = pin_home(args.home.clone());
    let dist = std::fs::canonicalize(&args.dist).unwrap_or_else(|e| die(2, &format!("dist {}: {e}", args.dist.display())));
    let assets = load_dist(&dist);

    let app = mock_builder()
        .manage(tendril_app_lib::commands::state::init_ui_state_store())
        .invoke_handler(include!(concat!(env!("OUT_DIR"), "/handlers.rs")))
        .build(mock_context(noop_assets()))
        .unwrap_or_else(|e| die(1, &format!("mock app: {e}")));
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap_or_else(|e| die(1, &format!("mock window: {e}")));
    let webview: Webview<MockRuntime> = window.as_ref().clone();

    // The same wiring as tendril_app_lib::run()'s setup: the WS bridge reads `.master` once and
    // keeps its secret; the change bridge re-reads it on every attempt.
    let master = tendril_app_lib::service::MasterDiscovery::new().read_master();
    let master_json = match &master {
        Ok(m) => {
            let ws_scheme = if m.scheme == "https" { "wss" } else { "ws" };
            let ws_url = format!("{ws_scheme}://{}:{}/api/ws", m.host, m.port);
            app.manage(tendril_app_lib::service::WsBridge::new(app.handle().clone(), ws_url, Some(m.secret.clone())));
            let base = format!("{}://{}:{}", m.scheme, m.host, m.port);
            app.manage(tendril_app_lib::service::ChangeBridge::new(app.handle().clone(), base, Some(m.secret.clone())));
            serde_json::json!({ "port": m.port, "pid": m.pid, "scheme": m.scheme, "host": m.host })
        }
        Err(e) => {
            if !args.allow_no_master {
                die(3, &format!("cannot read {}/.master ({e}); start the daemon and wait for /api/health first", home.display()));
            }
            eprintln!("v2shim: WebSocket bridge not started: {e}");
            app.manage(tendril_app_lib::service::ChangeBridge::new(app.handle().clone(), String::new(), None));
            serde_json::Value::Null
        }
    };

    let (tx, _) = broadcast::channel::<String>(4096);
    let info = serde_json::json!({
        "pid": std::process::id(),
        "home": home,
        "dist": dist,
        "master": master_json,
        "registered": command_info::REGISTERED.len(),
        "stubbed": command_info::STUBBED,
        "tendrilAppDir": command_info::TENDRIL_APP_DIR,
        "bridges": if master.is_ok() { "ws+changes" } else { "changes" },
    });
    let shim = Shim {
        app: app.handle().clone(),
        webview,
        events: tx,
        listening: Arc::new(Mutex::new(HashSet::new())),
        assets: Arc::new(assets),
        info: Arc::new(info),
    };
    for name in KNOWN_EVENTS {
        ensure_listening(&shim, name);
    }
    eprintln!("v2shim: {}", shim.info);

    let rt = tokio::runtime::Runtime::new().unwrap_or_else(|e| die(1, &format!("tokio: {e}")));
    rt.block_on(async move {
        let router = Router::new()
            .route("/__shim/ws", get(ws_upgrade))
            .route("/__shim/ipc/{cmd}", post(ipc_post))
            .route("/__shim/events", get(events))
            .route("/__shim/health", get(health))
            .fallback(static_file)
            .with_state(shim);
        let listener = tokio::net::TcpListener::bind((args.host.as_str(), args.port))
            .await
            .unwrap_or_else(|e| die(4, &format!("bind {}:{}: {e}", args.host, args.port)));
        let local = listener.local_addr().unwrap_or_else(|e| die(4, &format!("local_addr: {e}")));
        println!("shim listening on http://{}:{}", args.host, local.port());

        // Exit at once on a stop signal: open SSE and WebSocket streams would otherwise hold a
        // graceful shutdown open until the harness escalates to SIGKILL.
        tokio::spawn(async {
            use tokio::signal::unix::{signal, SignalKind};
            let mut term = signal(SignalKind::terminate()).expect("SIGTERM handler");
            let mut int = signal(SignalKind::interrupt()).expect("SIGINT handler");
            tokio::select! {
                _ = term.recv() => {}
                _ = int.recv() => {}
            }
            std::process::exit(0);
        });
        if let Err(e) = axum::serve(listener, router).await {
            die(1, &format!("serve: {e}"));
        }
    });
    drop(app);
}

fn ensure_listening(s: &Shim, name: &str) {
    let mut set = s.listening.lock().unwrap();
    if !set.insert(name.to_string()) {
        return;
    }
    let tx = s.events.clone();
    let event = serde_json::to_string(name).unwrap();
    s.app.listen_any(name.to_string(), move |e| {
        let payload = if e.payload().is_empty() { "null" } else { e.payload() };
        let _ = tx.send(format!("{{\"event\":{event},\"payload\":{payload}}}"));
    });
}

enum Outcome {
    Json(String),
    Raw(Vec<u8>),
    Err(String),
    /// The command never answered (its responder was dropped).
    Dropped,
}

async fn invoke(s: &Shim, cmd: String, args: serde_json::Value) -> Outcome {
    let (tx, rx) = oneshot::channel();
    let req = InvokeRequest {
        cmd,
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: "tauri://localhost".parse().unwrap(),
        body: InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    };
    s.webview.clone().on_message(
        req,
        Box::new(move |_w, _c, resp, _cb, _e| {
            let _ = tx.send(resp);
        }),
    );
    match rx.await {
        Ok(InvokeResponse::Ok(InvokeResponseBody::Json(j))) => Outcome::Json(j),
        Ok(InvokeResponse::Ok(InvokeResponseBody::Raw(b))) => Outcome::Raw(b),
        Ok(InvokeResponse::Err(e)) => Outcome::Err(e.0.to_string()),
        Err(_) => Outcome::Dropped,
    }
}

async fn ws_upgrade(State(s): State<Shim>, ws: WebSocketUpgrade) -> Response {
    ws.max_message_size(256 * 1024 * 1024).on_upgrade(move |socket| ws_session(s, socket))
}

/// One page's IPC channel. Every request runs concurrently, as Tauri runs async commands, and
/// answers are matched to requests by id.
async fn ws_session(s: Shim, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(m) = out_rx.recv().await {
            if sink.send(Message::Text(m.into())).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(msg)) = stream.next().await {
        let text = match msg {
            Message::Text(t) => t.as_str().to_owned(),
            Message::Close(_) => break,
            _ => continue,
        };
        let s = s.clone();
        let out = out_tx.clone();
        tokio::spawn(async move {
            let _ = out.send(handle_frame(&s, &text).await);
        });
    }
    drop(out_tx);
    let _ = writer.await;
}

async fn handle_frame(s: &Shim, text: &str) -> String {
    let frame: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => return serde_json::json!({ "id": null, "ok": false, "error": format!("bad frame: {e}") }).to_string(),
    };
    let id = frame.get("id").cloned().unwrap_or(serde_json::Value::Null);
    if let Some(name) = frame.get("listen").and_then(|v| v.as_str()) {
        ensure_listening(s, name);
        return serde_json::json!({ "id": id, "ok": true, "value": null }).to_string();
    }
    let Some(cmd) = frame.get("cmd").and_then(|v| v.as_str()) else {
        return serde_json::json!({ "id": id, "ok": false, "error": "frame has neither cmd nor listen" }).to_string();
    };
    let args = frame.get("args").cloned().filter(|a| !a.is_null()).unwrap_or_else(|| serde_json::json!({}));
    match invoke(s, cmd.to_string(), args).await {
        // `j` is already serialized JSON: splice it in rather than parse and re-serialize it.
        Outcome::Json(j) => format!("{{\"id\":{id},\"ok\":true,\"value\":{j}}}"),
        Outcome::Err(e) => format!("{{\"id\":{id},\"ok\":false,\"error\":{e}}}"),
        Outcome::Raw(b) => serde_json::json!({ "id": id, "ok": true, "raw": base64::engine::general_purpose::STANDARD.encode(b) }).to_string(),
        Outcome::Dropped => serde_json::json!({ "id": id, "ok": false, "error": format!("{cmd}: the command never answered") }).to_string(),
    }
}

/// The same IPC over plain HTTP, for tools and debugging (the page uses the WebSocket).
async fn ipc_post(State(s): State<Shim>, UrlPath(cmd): UrlPath<String>, body: Bytes) -> Response {
    let args: serde_json::Value = if body.is_empty() {
        serde_json::json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return (StatusCode::BAD_REQUEST, format!("bad JSON body: {e}")).into_response(),
        }
    };
    match invoke(&s, cmd, args).await {
        Outcome::Json(j) => ([(header::CONTENT_TYPE, "application/json")], j).into_response(),
        Outcome::Raw(b) => ([(header::CONTENT_TYPE, "application/octet-stream")], b).into_response(),
        Outcome::Err(e) => (StatusCode::UNPROCESSABLE_ENTITY, [(header::CONTENT_TYPE, "application/json")], e).into_response(),
        Outcome::Dropped => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn events(State(s): State<Shim>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = s.events.subscribe();
    let stream = futures_util::stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(m) => return Some((Ok(Event::default().data(m)), rx)),
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    eprintln!("v2shim: an SSE client fell behind; {n} event(s) dropped");
                }
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

async fn health(State(s): State<Shim>) -> Response {
    let mut v = (*s.info).clone();
    v["ok"] = serde_json::Value::Bool(true);
    v["listening"] = serde_json::json!(s.listening.lock().unwrap().len());
    ([(header::CONTENT_TYPE, "application/json")], v.to_string()).into_response()
}

async fn static_file(State(s): State<Shim>, uri: Uri) -> Response {
    let path = uri.path();
    let key = if path == "/" { "/index.html" } else { path };
    if let Some(a) = s.assets.get(key) {
        // Hashed asset names never change content, so they may be cached like any static host (and
        // V1's Kestrel) caches /assets; the document itself is always revalidated.
        let cache = if key.starts_with("/assets/") { "public, max-age=31536000" } else { "no-cache" };
        return ([(header::CONTENT_TYPE, a.mime), (header::CACHE_CONTROL, cache)], a.body.clone()).into_response();
    }
    // A missing file is a 404 (so a broken asset reference is visible); anything else is an app
    // route such as /plan-00037, which the SPA resolves itself.
    let last = key.rsplit('/').next().unwrap_or("");
    if last.contains('.') {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    let index = &s.assets["/index.html"];
    ([(header::CONTENT_TYPE, index.mime), (header::CACHE_CONTROL, "no-cache")], index.body.clone()).into_response()
}
