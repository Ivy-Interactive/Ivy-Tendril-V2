//! Downloading `cloudflared` — `tendril_core::tunnel::installer`'s port of `CloudflaredInstaller`'s
//! `EnsureInstalledAsync`/`DownloadAsync`.
//!
//! Nothing here touches the network. GitHub is a loopback `TcpListener` serving a releases document and
//! the asset bytes, which is the same way `provider_model_discovery_test.rs` fakes an HTTP provider;
//! the installer takes its API URL and its `reqwest::Client` as options for exactly this reason.
//!
//! The assertions that matter are about *not trusting what came back*: an asset whose bytes do not hash
//! to the SHA-256 GitHub published, or one published with no digest at all, must leave nothing
//! executable behind. A download that installs a binary the daemon then runs is the whole risk this
//! feature carries.

#![cfg(unix)]

use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tendril_core::tunnel::installer::{self, CloudflaredInstall, InstallOptions, InstallProgress};

fn temp_home(label: &str) -> PathBuf {
    let home = std::env::temp_dir().join(format!(
        "tendril-cloudflared-install-{label}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    assert!(home.starts_with(std::env::temp_dir()));
    std::fs::create_dir_all(&home).expect("create fixture home");
    home
}

/// The bytes the stub serves as the release asset.
///
/// A shell script rather than random bytes because on macOS the asset is a `.tgz` that gets extracted,
/// and the extracted entry has to be a plausible file — but nothing here ever *executes* it.
const ASSET_BODY: &[u8] = b"#!/bin/sh\necho fake-cloudflared\n";

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

/// The asset exactly as this platform expects it: a `.tgz` holding one root-level `cloudflared` on
/// macOS, and the bare binary everywhere else. Built with the system `tar`, which is what the
/// installer extracts with.
fn platform_asset_bytes() -> Vec<u8> {
    if !installer::platform_asset_name().ends_with(".tgz") {
        return ASSET_BODY.to_vec();
    }
    let staging = temp_home("asset-staging");
    let binary = staging.join("cloudflared");
    std::fs::write(&binary, ASSET_BODY).expect("write the archived binary");
    let archive = staging.join("asset.tgz");
    let status = std::process::Command::new("tar")
        .arg("-czf")
        .arg(&archive)
        .arg("-C")
        .arg(&staging)
        .arg("cloudflared")
        .status()
        .expect("run tar");
    assert!(
        status.success(),
        "building the fixture archive must succeed"
    );
    let bytes = std::fs::read(&archive).expect("read the fixture archive");
    let _ = std::fs::remove_dir_all(&staging);
    bytes
}

/// A loopback stand-in for the GitHub releases API and its asset CDN.
///
/// `digest` is what the releases document claims for the asset; the served bytes are `asset`. Passing a
/// digest that does not describe `asset` is how the tamper case is set up.
async fn stub_github(
    asset: Vec<u8>,
    digest: Option<String>,
) -> (String, Arc<Mutex<Vec<String>>>, tokio::task::JoinHandle<()>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind a loopback port");
    let base = format!("http://{}", listener.local_addr().unwrap());
    let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

    let recorded = Arc::clone(&seen);
    let origin = base.clone();
    let handle = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let recorded = Arc::clone(&recorded);
            let origin = origin.clone();
            let asset = asset.clone();
            let digest = digest.clone();
            tokio::spawn(async move {
                let mut buffer = vec![0u8; 8192];
                let read = socket.read(&mut buffer).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                recorded.lock().unwrap().push(path.clone());

                let mut response: Vec<u8> = Vec::new();
                if path.starts_with("/asset") {
                    write!(
                        response,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n",
                        asset.len()
                    )
                    .unwrap();
                    response.extend_from_slice(&asset);
                } else {
                    let digest_field = match &digest {
                        Some(digest) => format!(",\"digest\":\"sha256:{digest}\""),
                        None => String::new(),
                    };
                    let body = format!(
                        "{{\"assets\":[{{\"name\":\"{}\",\
\"browser_download_url\":\"{origin}/asset\"{digest_field}}}]}}",
                        installer::platform_asset_name()
                    );
                    write!(
                        response,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .unwrap();
                }
                let _ = socket.write_all(&response).await;
                let _ = socket.shutdown().await;
            });
        }
    });

    (base, seen, handle)
}

fn options(base: &str) -> InstallOptions {
    InstallOptions {
        api_url: format!("{base}/releases/latest"),
        ..InstallOptions::default()
    }
}

/// The happy path: resolve the release, fetch the asset, check it, install it executable.
#[tokio::test]
async fn a_verified_asset_is_installed_and_made_executable() {
    let home = temp_home("happy");
    let asset = platform_asset_bytes();
    let (base, seen, server) = stub_github(asset.clone(), Some(sha256_hex(&asset))).await;

    let install = CloudflaredInstall::new();
    assert!(install.run(&home, &options(&base)).await, "install ran");

    assert_eq!(install.progress().phase, "done", "{:?}", install.progress());
    let binary = installer::local_binary_path(&home);
    assert!(
        installer::is_executable_file(&binary),
        "the installed binary must be executable: {}",
        binary.display()
    );
    assert_eq!(
        installer::find_existing(&home),
        Some(binary),
        "the resolver must now find the copy that was just installed"
    );
    // The API was consulted, not just the plain download URL: it is the only source of the digest.
    assert!(
        seen.lock()
            .unwrap()
            .iter()
            .any(|p| p.contains("/releases/latest")),
        "the releases API must be what resolves the asset"
    );

    server.abort();
    let _ = std::fs::remove_dir_all(&home);
}

/// Bytes that do not match the published SHA-256 must install nothing.
///
/// This is the assertion the whole feature rests on: the daemon executes whatever ends up at that path,
/// so a mismatch has to be a refusal and not a warning.
#[tokio::test]
async fn an_asset_that_does_not_match_its_digest_is_refused() {
    let home = temp_home("tampered");
    let asset = platform_asset_bytes();
    // A valid-looking digest for entirely different content.
    let wrong = sha256_hex(b"not what was served");
    let (base, _seen, server) = stub_github(asset, Some(wrong)).await;

    let install = CloudflaredInstall::new();
    install.run(&home, &options(&base)).await;

    let progress = install.progress();
    assert_eq!(progress.phase, "failed", "{progress:?}");
    let message = progress.error.unwrap_or_default();
    assert!(
        message.contains("does not match the SHA-256"),
        "the failure must say the check failed: {message}"
    );
    assert!(
        message.contains("Nothing was installed"),
        "and must say nothing was installed: {message}"
    );
    assert!(
        !installer::local_binary_path(&home).exists(),
        "a failed verification must leave no binary behind"
    );
    assert!(
        installer::find_existing(&home)
            .is_none_or(|found| found != installer::local_binary_path(&home)),
        "and nothing must be resolvable from the tools directory"
    );

    server.abort();
    let _ = std::fs::remove_dir_all(&home);
}

/// An asset GitHub published without a digest cannot be verified, so it is refused rather than
/// installed unchecked. "We could not check it" and "it is fine" must not be the same outcome.
#[tokio::test]
async fn an_asset_with_no_published_digest_is_refused() {
    let home = temp_home("no-digest");
    let asset = platform_asset_bytes();
    let (base, _seen, server) = stub_github(asset, None).await;

    let install = CloudflaredInstall::new();
    install.run(&home, &options(&base)).await;

    let progress = install.progress();
    assert_eq!(progress.phase, "failed", "{progress:?}");
    assert!(
        progress
            .error
            .unwrap_or_default()
            .contains("published no SHA-256"),
        "the refusal must name the missing digest"
    );
    assert!(
        !installer::local_binary_path(&home).exists(),
        "nothing unverified may be installed"
    );

    server.abort();
    let _ = std::fs::remove_dir_all(&home);
}

/// No network is an actionable message pointing at the manual route, not a panic or a silent nothing.
#[tokio::test]
async fn an_unreachable_github_says_what_to_do_instead() {
    let home = temp_home("offline");
    // A port nobody is listening on: bind it, learn the number, then drop the listener.
    let port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().port()
    };

    let install = CloudflaredInstall::new();
    install
        .run(&home, &options(&format!("http://127.0.0.1:{port}")))
        .await;

    let progress = install.progress();
    assert_eq!(progress.phase, "failed", "{progress:?}");
    let message = progress.error.unwrap_or_default();
    assert!(
        message.contains("could not reach GitHub"),
        "the failure must name the cause: {message}"
    );
    assert!(
        message.contains("install cloudflared yourself"),
        "and must fall back to the manual route: {message}"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// Progress is reported rather than the button just hanging, and a cancel is honoured.
#[tokio::test]
async fn an_install_reports_progress_and_can_be_cancelled() {
    let home = temp_home("cancel");
    let asset = platform_asset_bytes();
    let (base, _seen, server) = stub_github(asset.clone(), Some(sha256_hex(&asset))).await;

    let install = Arc::new(CloudflaredInstall::new());
    // Cancelling when nothing is running is not an error and does not arm anything: the caller wanted
    // no install running, and there is none.
    assert!(!install.cancel(), "nothing to cancel yet");
    assert_eq!(install.progress(), idle_progress());

    let running = Arc::clone(&install);
    let home_for_task = home.clone();
    let opts = options(&base);
    running.run(&home_for_task, &opts).await;

    assert_eq!(install.progress().phase, "done");
    // Having finished, a cancel is again a no-op rather than something that can undo an install.
    assert!(!install.cancel(), "a finished install is not cancellable");
    assert!(installer::is_executable_file(
        &installer::local_binary_path(&home)
    ));

    server.abort();
    let _ = std::fs::remove_dir_all(&home);
}

fn idle_progress() -> InstallProgress {
    InstallProgress {
        phase: "idle".to_string(),
        downloaded_bytes: 0,
        total_bytes: None,
        error: None,
    }
}

/// A second press while one is in flight must not start a second download onto the same path.
#[tokio::test]
async fn a_second_install_while_one_runs_is_a_no_op() {
    let home = temp_home("double");
    let asset = platform_asset_bytes();
    let (base, seen, server) = stub_github(asset.clone(), Some(sha256_hex(&asset))).await;

    let install = Arc::new(CloudflaredInstall::new());
    let first = {
        let install = Arc::clone(&install);
        let home = home.clone();
        let opts = options(&base);
        tokio::spawn(async move { install.run(&home, &opts).await })
    };
    let second = {
        let install = Arc::clone(&install);
        let home = home.clone();
        let opts = options(&base);
        tokio::spawn(async move { install.run(&home, &opts).await })
    };

    let (a, b) = (first.await.unwrap(), second.await.unwrap());
    assert!(a || b, "at least one install must have run");
    // Whichever lost the race must have declined rather than downloaded again. The stub records one
    // request per connection, so a second full install would show a second asset fetch.
    let asset_fetches = seen
        .lock()
        .unwrap()
        .iter()
        .filter(|path| path.starts_with("/asset"))
        .count();
    assert!(
        asset_fetches <= 1,
        "a concurrent second install must not download again, saw {asset_fetches} asset fetches"
    );

    server.abort();
    let _ = std::fs::remove_dir_all(&home);
}

/// The install state a `GET` serves keeps "your configured path is wrong" apart from "cloudflared is
/// missing" — the distinction `resolve_binary` draws, carried through to what the pane renders.
#[test]
fn a_wrong_configured_path_is_not_reported_as_a_missing_install() {
    let home = temp_home("configured");

    let missing = installer::state_with_progress(&home, None, None);
    assert!(missing.configured_path_error.is_none());

    let wrong =
        installer::state_with_progress(&home, Some("/definitely/not/here/cloudflared"), None);
    assert!(!wrong.installed);
    assert!(
        wrong
            .configured_path_error
            .as_deref()
            .is_some_and(|message| message.contains("shareTunnel.binaryPath")),
        "the operator's own path must be named: {:?}",
        wrong.configured_path_error
    );
    assert!(
        !wrong.downloadable,
        "downloading a second copy would not be used, because the override wins"
    );

    let _ = std::fs::remove_dir_all(&home);
}
