//! `cmd_upload_chat_attachment` — and the thing it exists for: the preview that then resolves.
//!
//! The gap this closes is not visible from either command alone. `cmd_get_local_file_preview` will only
//! serve a file inside a configured local-file root, and a screenshot the user drags in from their
//! Desktop is outside every one of them — so the interesting assertion is the pair: the same path is
//! refused before staging and served after it, with the file's own bytes coming back.
//!
//! Run against the real daemon router, for the reason `local_file_preview_command_test` gives: the
//! whole design rests on `tendril-server` staying the thing that decides, and a mock would prove only
//! that the command believes what it is told.
//!
//! Commands resolve `TENDRIL_HOME` from the process environment, which is global, so every test takes
//! `env_lock()` for its duration.

use base64::Engine;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tempfile::TempDir;
use tendril_app_lib::commands::attachments::cmd_upload_chat_attachment;
use tendril_app_lib::commands::local_file::cmd_get_local_file_preview;
use tendril_app_lib::daemon::MasterInfo;
use tendril_core::config::{save_config, TendrilSettings};
use tendril_core::jobs::attachments::MAX_ATTACHMENT_BYTES;
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
    /// Doubles as the app's `TENDRIL_HOME` and as the guard's only local-file root.
    home: TempDir,
    secret: String,
    _server: tokio::task::JoinHandle<()>,
}

/// The real daemon router on a loopback port, with a temp `TendrilHome` that is also the only
/// local-file root, and a `.master` pointing the app at it.
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
    let addr: SocketAddr = listener.local_addr().expect("local addr");
    let server = tokio::spawn(async move {
        axum07::serve(listener, create_router(state)).await.ok();
    });

    std::env::set_var("TENDRIL_HOME", home.path());
    write_master(home.path(), &secret, addr.port());

    Daemon {
        home,
        secret,
        _server: server,
    }
}

fn write_master(home: &Path, secret: &str, port: u16) {
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
        home.join(".master"),
        serde_json::to_string_pretty(&master).expect("serialize master"),
    )
    .expect("write master");
}

/// A file somewhere the daemon will never serve from — the user's Desktop, for the purposes of this
/// suite. Kept alive by the returned `TempDir`.
fn file_outside_every_root(name: &str, bytes: &[u8]) -> (TempDir, PathBuf) {
    let elsewhere = tempfile::tempdir().expect("tempdir");
    let path = elsewhere.path().join(name);
    std::fs::write(&path, bytes).expect("write file");
    (elsewhere, path)
}

/// The whole feature, in one test: a screenshot from outside every local-file root is unpreviewable,
/// staging it makes it previewable, and what comes back is the file's own bytes.
#[tokio::test]
async fn a_staged_file_is_what_the_preview_command_then_resolves() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;
    let (_desktop, picked) = file_outside_every_root("desktop-shot.png", PNG_BYTES);
    let picked = picked.to_string_lossy().to_string();

    // Precondition, and the reason this command exists: as picked, the file cannot be previewed.
    assert_eq!(
        cmd_get_local_file_preview(picked.clone())
            .await
            .expect_err("a path outside every root is refused")
            .code,
        "NOT_FOUND"
    );

    let staged = cmd_upload_chat_attachment(picked.clone(), Some("session-1".to_string()))
        .await
        .expect("a picked file stages");

    // The chip keeps the name the user picked the file by; the path is the copy.
    assert_eq!(staged.name, "desktop-shot.png");
    assert_eq!(
        PathBuf::from(&staged.path),
        daemon
            .home
            .path()
            .join("Attachments")
            .join("session-1")
            .join("desktop-shot.png")
    );

    // And the preview the message renders now resolves, with the picked file's own bytes.
    let data_url = cmd_get_local_file_preview(staged.path.clone())
        .await
        .expect("the staged copy is inside the Tendril home, so it is servable");
    let encoded = data_url
        .strip_prefix("data:image/png;base64,")
        .expect("a png data URL");
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("valid base64"),
        PNG_BYTES
    );
    assert!(!data_url.contains(&daemon.secret));
}

/// Without a session id — a file attached before the chat session exists — the copy goes under `temp`,
/// which is inside the same root, so the preview resolves just the same. V1's `ContentView` stages
/// those under `temp` too.
#[tokio::test]
async fn a_file_attached_before_a_session_exists_stages_under_temp() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;
    let (_desktop, picked) = file_outside_every_root("no-session.png", PNG_BYTES);

    let staged = cmd_upload_chat_attachment(picked.to_string_lossy().to_string(), None)
        .await
        .expect("a file with no session stages");

    assert_eq!(
        PathBuf::from(&staged.path),
        daemon
            .home
            .path()
            .join("Attachments")
            .join("temp")
            .join("no-session.png")
    );
    assert!(cmd_get_local_file_preview(staged.path).await.is_ok());
}

/// The destination name comes from the source file's own final component, never from the caller, so a
/// path this command copies does not become previewable unless it already was: `/etc/passwd` stages as
/// `passwd`, and the preview route's extension allowlist refuses that exactly as it refused the
/// original.
#[tokio::test]
async fn staging_does_not_make_an_unpreviewable_file_previewable() {
    let _guard = env_lock().await;
    let _daemon = spawn_daemon().await;
    let (_elsewhere, secret_file) =
        file_outside_every_root("id_rsa", b"-----BEGIN PRIVATE KEY-----");

    let staged = cmd_upload_chat_attachment(secret_file.to_string_lossy().to_string(), None)
        .await
        .expect("any file may be attached");

    assert!(
        staged.path.ends_with("id_rsa"),
        "the source's own name is what it is stored under: {}",
        staged.path
    );
    assert_eq!(
        cmd_get_local_file_preview(staged.path)
            .await
            .expect_err("a staged non-image is still not previewable")
            .code,
        "NOT_FOUND"
    );
}

/// A second file of the same name gets its own copy rather than replacing the first — two chips must
/// never end up pointing at one file.
#[tokio::test]
async fn a_second_file_of_the_same_name_gets_its_own_copy() {
    let _guard = env_lock().await;
    let _daemon = spawn_daemon().await;
    let (_first_dir, first) = file_outside_every_root("shot.png", PNG_BYTES);
    let (_second_dir, second) =
        file_outside_every_root("shot.png", &[0x89, 0x50, 0x4E, 0x47, 0x01]);

    let first_staged =
        cmd_upload_chat_attachment(first.to_string_lossy().to_string(), Some("s".to_string()))
            .await
            .expect("first stages");
    let second_staged =
        cmd_upload_chat_attachment(second.to_string_lossy().to_string(), Some("s".to_string()))
            .await
            .expect("second stages");

    assert_ne!(first_staged.path, second_staged.path);
    // Both chips still read the way the user picked them.
    assert_eq!(first_staged.name, "shot.png");
    assert_eq!(second_staged.name, "shot.png");
    assert_ne!(
        cmd_get_local_file_preview(first_staged.path).await.unwrap(),
        cmd_get_local_file_preview(second_staged.path)
            .await
            .unwrap(),
        "each chip previews its own file"
    );
}

#[tokio::test]
async fn a_relative_path_a_directory_and_a_missing_file_are_refused_here() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;

    // Relative to *what* is nobody's decision to make; refused before a request is built.
    assert_eq!(
        cmd_upload_chat_attachment("shot.png".to_string(), None)
            .await
            .expect_err("a relative path is refused")
            .code,
        "VALIDATION_ERROR"
    );
    assert_eq!(
        cmd_upload_chat_attachment("   ".to_string(), None)
            .await
            .expect_err("an empty path is refused")
            .code,
        "VALIDATION_ERROR"
    );
    assert_eq!(
        cmd_upload_chat_attachment(daemon.home.path().to_string_lossy().to_string(), None)
            .await
            .expect_err("a directory is refused")
            .code,
        "VALIDATION_ERROR"
    );
    assert_eq!(
        cmd_upload_chat_attachment(
            daemon
                .home
                .path()
                .join("never-written.png")
                .to_string_lossy()
                .to_string(),
            None
        )
        .await
        .expect_err("a missing file is refused")
        .code,
        "NOT_FOUND"
    );
}

/// The cap is checked from the file's metadata, before the bytes are read: refusing a huge file must not
/// mean loading it first.
#[tokio::test]
async fn a_file_over_the_cap_is_refused_without_being_uploaded() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;
    let (_desktop, oversized) =
        file_outside_every_root("huge.png", &vec![0u8; MAX_ATTACHMENT_BYTES + 1]);

    let err = cmd_upload_chat_attachment(oversized.to_string_lossy().to_string(), None)
        .await
        .expect_err("a file over the cap is refused");
    assert_eq!(err.code, "VALIDATION_ERROR");
    assert!(
        !daemon.home.path().join("Attachments").exists(),
        "nothing was uploaded, so no attachment directory was created"
    );
}

/// A stale `.master` — the previous daemon's secret. The upload route is bearer-credentialled, so this
/// is refused, and the refusal must not carry the credential it was refused for.
#[tokio::test]
async fn a_credential_the_daemon_does_not_know_is_refused() {
    let _guard = env_lock().await;
    let daemon = spawn_daemon().await;
    let (_desktop, picked) = file_outside_every_root("shot.png", PNG_BYTES);
    let picked = picked.to_string_lossy().to_string();

    let port = {
        let master: MasterInfo = serde_json::from_str(
            &std::fs::read_to_string(daemon.home.path().join(".master")).expect("read master"),
        )
        .expect("parse master");
        master.port
    };
    write_master(daemon.home.path(), "not-this-daemons-secret", port);

    let err = cmd_upload_chat_attachment(picked.clone(), None)
        .await
        .expect_err("a wrong credential must be refused");
    assert_eq!(err.code, "UNAUTHENTICATED");
    assert!(!format!("{err:?}").contains("not-this-daemons-secret"));

    // And the same file stages once the app is pointed back at the running daemon's credential.
    write_master(daemon.home.path(), &daemon.secret.clone(), port);
    assert!(
        cmd_upload_chat_attachment(picked, None).await.is_ok(),
        "only the credential was wrong"
    );
}
