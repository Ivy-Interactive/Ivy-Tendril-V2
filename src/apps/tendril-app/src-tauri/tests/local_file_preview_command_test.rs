//! `cmd_get_local_file_preview`, the webview's only way to look at a file on the machine.
//!
//! This is the one command that turns a caller-named path into bytes, so the tests that matter are the
//! ones proving a path is **refused**. They run against the daemon's real router rather than a mock:
//! the whole design rests on `tendril-server`'s `local_file_guard` staying the thing that decides, and
//! on this command's native request satisfying its six layers — the credential in `?token=`, the host,
//! the absent `Origin`, the absent `Sec-Fetch-Site`, the extension allowlist and root confinement. A
//! mock daemon would have proved only that the command believes what it is told.
//!
//! Commands resolve `TENDRIL_HOME` from the process environment, which is global, so every test takes
//! `env_lock()` for its duration.

use base64::Engine;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tempfile::TempDir;
use tendril_app_lib::commands::local_file::cmd_get_local_file_preview;
use tendril_app_lib::daemon::MasterInfo;
use tendril_core::config::{save_config, TendrilSettings};
use tendril_server::{create_router, AppState};
use tokio::net::TcpListener;

/// A one-pixel PNG. The bytes only have to be exactly recoverable from the data URL.
const PNG_BYTES: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE,
];

async fn env_lock() -> tokio::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

struct Daemon {
    /// Doubles as the app's `TENDRIL_HOME` and as the guard's local-file root.
    home: TempDir,
    addr: SocketAddr,
    secret: String,
    _server: tokio::task::JoinHandle<()>,
}

impl Daemon {
    fn path(&self, name: &str) -> PathBuf {
        self.home.path().join(name)
    }

    /// Points the app at this daemon, optionally with a credential that is not the daemon's.
    fn write_master(&self, secret: &str) {
        self.write_master_on_port(secret, self.addr.port());
    }

    fn write_master_on_port(&self, secret: &str, port: u16) {
        let master = MasterInfo {
            port,
            pid: std::process::id(),
            secret: secret.to_string(),
            started_at: "2026-09-16T10:41:11Z".to_string(),
            host: "127.0.0.1".to_string(),
            scheme: "http".to_string(),
            version: "0.1.0".to_string(),
            api_version: 1,
            capabilities: vec!["plans".to_string()],
        };
        std::fs::write(
            self.home.path().join(".master"),
            serde_json::to_string_pretty(&master).expect("serialize master"),
        )
        .expect("write master");
    }
}

/// The real daemon router on a loopback port, with a temp `TendrilHome` that is also the only
/// local-file root. `TENDRIL_HOME` is set so `get_client_from_master` finds the `.master` written here.
async fn spawn_daemon() -> Daemon {
    let home = tempfile::tempdir().expect("tempdir");
    let plans_dir = home.path().join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");
    save_config(
        &home.path().join("config.yaml"),
        &TendrilSettings::default(),
    )
    .expect("write config");

    let secret = tendril_core::config::generate_bearer_secret();
    let state = Arc::new(AppState::with_plans_dir(
        home.path().to_path_buf(),
        plans_dir,
        secret.clone(),
    ));

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let addr = listener.local_addr().expect("local addr");
    let server = tokio::spawn(async move {
        axum07::serve(listener, create_router(state)).await.ok();
    });

    std::env::set_var("TENDRIL_HOME", home.path());

    let daemon = Daemon {
        home,
        addr,
        secret: secret.clone(),
        _server: server,
    };
    daemon.write_master(&secret);
    daemon
}

fn write_file(path: &Path, bytes: &[u8]) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create parent");
    }
    std::fs::write(path, bytes).expect("write file");
}

#[tokio::test]
async fn an_image_inside_a_root_comes_back_as_a_data_url() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;
    let screenshot = daemon.path("Attachments/session-1/shot.png");
    write_file(&screenshot, PNG_BYTES);

    let data_url = cmd_get_local_file_preview(screenshot.to_string_lossy().to_string())
        .await
        .expect("a png inside the Tendril home is servable");

    // The media type the route reported, and the file's own bytes: this is what an `<img src>` gets.
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .expect("a png data URL");
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("valid base64"),
        PNG_BYTES,
    );

    // The bearer secret travels in the request's query string, so the one thing that must never come
    // back with the bytes is the secret.
    assert!(!data_url.contains(&daemon.secret));
}

#[tokio::test]
async fn a_path_outside_every_root_is_refused() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;

    // A real, readable PNG the user might well have picked in the file dialog — and outside the
    // Tendril home, the plans folder and every configured project, so the guard will not serve it.
    let elsewhere = tempfile::tempdir().expect("tempdir");
    let outside = elsewhere.path().join("desktop-shot.png");
    write_file(&outside, PNG_BYTES);

    let err = cmd_get_local_file_preview(outside.to_string_lossy().to_string())
        .await
        .expect_err("a path outside every root must be refused");

    // The endpoint deliberately answers 404 rather than 403 so a caller cannot tell "outside the roots"
    // from "does not exist"; the command keeps that answer instead of explaining it.
    assert_eq!(err.code, "NOT_FOUND");
    assert!(!err.message.contains(&daemon.secret));
    assert!(!format!("{err:?}").contains(&daemon.secret));
}

#[tokio::test]
async fn a_forbidden_extension_inside_a_root_is_refused() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;

    // Readable, inside the root, and none of them an allow-listed image or PDF. `.env` is the one that
    // would matter most: it is a name, not an extension.
    for name in ["notes.txt", "id_rsa", "settings.yaml", ".env"] {
        let path = daemon.path(name);
        write_file(&path, b"not an image");
        match cmd_get_local_file_preview(path.to_string_lossy().to_string()).await {
            Ok(_) => panic!("{name} must not be servable"),
            // Not `403`: a blocked extension is answered exactly as a missing file is.
            Err(err) => assert_eq!(err.code, "NOT_FOUND", "{name}"),
        }
    }
}

#[tokio::test]
async fn a_traversal_out_of_a_root_is_refused() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;

    let elsewhere = tempfile::tempdir().expect("tempdir");
    let outside = elsewhere.path().join("climbed.png");
    write_file(&outside, PNG_BYTES);

    // Absolute, inside a root by string prefix, and pointing out of it.
    let climbing = format!(
        "{}/../{}",
        daemon.home.path().to_string_lossy(),
        outside.to_string_lossy().trim_start_matches('/')
    );

    let err = cmd_get_local_file_preview(climbing)
        .await
        .expect_err("a `..` climb must be refused");
    assert_eq!(err.code, "NOT_FOUND");
}

#[tokio::test]
async fn a_relative_path_never_reaches_the_daemon() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;
    write_file(&daemon.path("shot.png"), PNG_BYTES);

    // Relative to *what* is the daemon's working directory, which nothing here can reason about, so it
    // is refused on this side rather than resolved into whatever it happens to name.
    let err = cmd_get_local_file_preview("shot.png".to_string())
        .await
        .expect_err("a relative path must be refused");
    assert_eq!(err.code, "VALIDATION_ERROR");
}

#[tokio::test]
async fn a_credential_the_daemon_does_not_know_is_refused() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;
    let screenshot = daemon.path("shot.png");
    write_file(&screenshot, PNG_BYTES);

    // A stale `.master` — the previous daemon's secret. The guard's first layer runs before it looks at
    // the host, the extension or the filesystem, so this says nothing about the file.
    daemon.write_master("not-this-daemons-secret");

    let err = cmd_get_local_file_preview(screenshot.to_string_lossy().to_string())
        .await
        .expect_err("a wrong credential must be refused");
    assert_eq!(err.code, "UNAUTHENTICATED");
    assert!(!err.message.contains("not-this-daemons-secret"));

    // And the same file is served once the app is pointed back at the running daemon's credential.
    daemon.write_master(&daemon.secret.clone());
    assert!(
        cmd_get_local_file_preview(screenshot.to_string_lossy().to_string())
            .await
            .is_ok(),
        "only the credential was wrong"
    );
}

/// The credential travels in the request's query string, because that is where the guard reads it from.
/// So the one thing that must never happen is that URL turning up in something the webview can read —
/// and `reqwest`'s own errors print the whole request URL by default, which is exactly the case a
/// daemon that has gone away produces.
#[tokio::test]
async fn a_transport_failure_does_not_carry_the_credential() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;
    let screenshot = daemon.path("shot.png");
    write_file(&screenshot, PNG_BYTES);

    // A port nothing is listening on, with the real secret recorded against it.
    let dead_port = {
        let probe = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        probe.local_addr().expect("addr").port()
    };
    daemon.write_master_on_port(&daemon.secret.clone(), dead_port);

    let err = cmd_get_local_file_preview(screenshot.to_string_lossy().to_string())
        .await
        .expect_err("a daemon that is not there must fail");
    let rendered = format!(
        "{err:?} {} {}",
        err.message,
        err.details.clone().unwrap_or_default()
    );
    assert!(
        !rendered.contains(&daemon.secret),
        "the request URL, and with it the bearer secret, must not survive into the error"
    );
}
