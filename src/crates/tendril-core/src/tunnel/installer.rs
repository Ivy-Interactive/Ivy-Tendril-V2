//! Finding and installing `cloudflared` — a port of `Services/Tunnel/CloudflaredInstaller.cs`.
//!
//! Detection is the original's: `$TENDRIL_HOME/tools/cloudflared` first, then `PATH`
//! ([`find_existing`]), with the platform/asset mapping and release URL ported verbatim so that every
//! message can name the exact file and where it came from.
//!
//! # Why the download came back
//!
//! This module shipped as detection *only*, on the grounds that auto-fetching an unpinned third-party
//! binary and then executing it is a supply-chain decision rather than an implementation detail — the
//! original has no checksum, no signature and no version pin, so its "latest" is whatever GitHub serves
//! at that moment. The objection was sound but the conclusion was wrong: it left the feature unusable
//! on a fresh install, which is a regression against V1, where `EnsureInstalledAsync` just works.
//!
//! [`install`] restores V1's behaviour and answers the objection instead of accepting it:
//!
//! - **The asset is verified before it is trusted.** The GitHub releases API publishes a SHA-256 for
//!   every release asset in `assets[].digest` (`sha256:<hex>`). [`install`] resolves the release
//!   through the API, downloads the asset the API described, and refuses to install anything whose
//!   bytes do not hash to that digest. Nothing unverified is ever made executable, and nothing
//!   downloaded is executed here at all. Note that the *release body* also carries a hand-maintained
//!   "SHA256 Checksums" block; it has been observed to disagree with the real assets, so the API
//!   digest is the only source used.
//! - **It is never automatic.** There is no fetch on daemon start and none on a status read. The only
//!   caller is `POST /api/tunnel/share/install`, which exists because a user pressed a button that says
//!   what it is about to do. A tunnel start still *fails* on a missing binary rather than installing
//!   one behind the user's back.
//! - **The manual instructions stay.** [`TunnelError::NotInstalled`] still names the package-manager
//!   command and the asset URL, and it is what a failed or refused install falls back to. The download
//!   is the convenience; the operator's own package manager remains the supported update path, which
//!   is why an operator-installed copy on `PATH` still wins over anything fetched here.
//!
//! # Not ported from the original's download
//!
//! `DownloadAsync` shells out to `chmod +x`; [`install`] sets the mode bits directly, which is what the
//! rest of this workspace does. The original also has no progress reporting and no verification, both
//! of which are added here — see [`InstallProgress`] for why a multi-second silent hang on a button
//! press is not an acceptable port of "await DownloadAsync".

use super::TunnelError;
use std::path::{Path, PathBuf};

/// `$TENDRIL_HOME/tools`, the original's `_toolsDirectory`.
pub fn tools_dir(tendril_home: &Path) -> PathBuf {
    tendril_home.join("tools")
}

/// The name the binary has once installed under [`tools_dir`].
pub fn local_binary_name() -> &'static str {
    if cfg!(windows) {
        "cloudflared.exe"
    } else {
        "cloudflared"
    }
}

/// Port of `GetLocalBinaryPath`.
pub fn local_binary_path(tendril_home: &Path) -> PathBuf {
    tools_dir(tendril_home).join(local_binary_name())
}

/// Port of `GetPlatformBinaryName`. The `.tgz` on macOS is why the original has a tar reader.
pub fn platform_asset_name() -> &'static str {
    let arm = cfg!(target_arch = "aarch64");
    if cfg!(windows) {
        "cloudflared-windows-amd64.exe"
    } else if cfg!(target_os = "macos") {
        if arm {
            "cloudflared-darwin-arm64.tgz"
        } else {
            "cloudflared-darwin-amd64.tgz"
        }
    } else if arm {
        "cloudflared-linux-arm64"
    } else {
        "cloudflared-linux-amd64"
    }
}

/// Port of `GetDownloadUrl`. Quoted in the not-installed error so a manual install needs no search.
pub fn download_url(asset_name: &str) -> String {
    format!("https://github.com/cloudflare/cloudflared/releases/latest/download/{asset_name}")
}

/// Port of `BinaryResolver.FindOnPath`, generalised from the private `health::which_tendril`.
///
/// Shells out to `which`/`where.exe` rather than walking `PATH` by hand, which is what the rest of
/// this workspace already does, and which gets shell builtins, aliases-as-shims and `.exe`/`.cmd`
/// resolution on Windows for free.
pub fn find_on_path(binary: &str) -> Option<PathBuf> {
    let (cmd, arg) = if cfg!(windows) {
        ("where.exe", binary)
    } else {
        ("which", binary)
    };
    let output = std::process::Command::new(cmd).arg(arg).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if first.is_empty() {
        return None;
    }
    Some(PathBuf::from(first))
}

/// Port of `FindExisting`: the locally installed copy first, then whatever is on `PATH`.
///
/// The local copy wins deliberately — an operator who dropped a specific build into
/// `$TENDRIL_HOME/tools` meant that one.
pub fn find_existing(tendril_home: &Path) -> Option<PathBuf> {
    let local = local_binary_path(tendril_home);
    if is_executable_file(&local) {
        return Some(local);
    }
    find_on_path("cloudflared")
}

/// Whether `path` is a file we could plausibly execute. On unix the mode bits are checked, because a
/// downloaded-but-not-`chmod +x`ed binary is a real state the original's installer has to fix up.
pub fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    meta.is_file() && has_executable_bit(&meta)
}

#[cfg(unix)]
fn has_executable_bit(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn has_executable_bit(_meta: &std::fs::Metadata) -> bool {
    true
}

/// The binary a share should launch: `shareTunnel.binaryPath` if set, else [`find_existing`].
///
/// Replaces the original's `EnsureInstalledAsync`. The two failure modes are kept apart on purpose:
/// an operator who set `binaryPath` needs to hear that *their* path is wrong, not that cloudflared is
/// missing.
pub fn resolve_binary(
    tendril_home: &Path,
    configured: Option<&str>,
) -> Result<PathBuf, TunnelError> {
    if let Some(configured) = configured {
        let path = PathBuf::from(configured);
        if is_executable_file(&path) {
            return Ok(path);
        }
        // A bare name in `binaryPath` is a reasonable thing to write, so try `PATH` before failing.
        if !configured.contains(std::path::MAIN_SEPARATOR) && !configured.contains('/') {
            if let Some(found) = find_on_path(configured) {
                return Ok(found);
            }
        }
        return Err(TunnelError::ConfiguredBinaryMissing(path));
    }

    find_existing(tendril_home).ok_or_else(|| {
        let asset = platform_asset_name().to_string();
        TunnelError::NotInstalled {
            local: local_binary_path(tendril_home),
            url: download_url(&asset),
            asset,
        }
    })
}

/// What `GET /api/tunnel/share/install` reports: whether a binary was found, if not exactly what to
/// install, and how a running install is getting on. Ported from the original's `CheckInstalledAsync`
/// plus the install prompt in `ShareTunnelModal`, which is the only place the download URL was ever
/// surfaced.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstallState {
    pub installed: bool,
    /// The resolved binary, when one was found.
    #[serde(rename = "binaryPath", skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    /// Where Tendril looks for a manually installed copy.
    #[serde(rename = "expectedPath")]
    pub expected_path: String,
    #[serde(rename = "assetName")]
    pub asset_name: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
    /// Whether this platform has an asset Tendril knows how to fetch and verify, i.e. whether offering
    /// an Install button makes sense at all. The pane falls back to the manual instructions when this
    /// is false, which is also what it does when an install fails.
    pub downloadable: bool,
    /// The live install, if one has been attempted in this daemon's lifetime.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<InstallProgress>,
    /// Set when `shareTunnel.binaryPath` points at something unusable. Kept apart from `installed:
    /// false` on purpose: an operator who configured a path needs to hear that *their* path is wrong,
    /// not that cloudflared is missing, and an Install button would be the wrong offer in that state.
    #[serde(
        rename = "configuredPathError",
        skip_serializing_if = "Option::is_none"
    )]
    pub configured_path_error: Option<String>,
}

/// Port of `CheckInstalledAsync`, widened to say where to get it and how a fetch is progressing.
pub fn install_state(tendril_home: &Path, configured: Option<&str>) -> InstallState {
    state_with_progress(tendril_home, configured, None)
}

/// [`install_state`] plus whatever [`CloudflaredInstall`] has to report.
pub fn state_with_progress(
    tendril_home: &Path,
    configured: Option<&str>,
    install: Option<&CloudflaredInstall>,
) -> InstallState {
    let asset = platform_asset_name().to_string();
    let (found, configured_path_error) = match configured {
        Some(configured) => match resolve_binary(tendril_home, Some(configured)) {
            Ok(path) => (Some(path), None),
            Err(err) => (None, Some(err.to_string())),
        },
        None => (find_existing(tendril_home), None),
    };
    InstallState {
        installed: found.is_some(),
        binary_path: found.map(|path| path.display().to_string()),
        expected_path: local_binary_path(tendril_home).display().to_string(),
        download_url: download_url(&asset),
        asset_name: asset,
        // Every platform the asset map covers is fetchable; the flag exists so the pane has one thing
        // to read rather than re-deriving the platform, and so a future platform with no published
        // asset can turn the button off without a UI change.
        downloadable: configured_path_error.is_none(),
        progress: install.map(CloudflaredInstall::progress),
        configured_path_error,
    }
}

/// The GitHub releases API endpoint describing cloudflared's latest release.
///
/// The API rather than the plain `releases/latest/download/<asset>` redirect that [`download_url`]
/// builds, because the API is the only thing that publishes a per-asset SHA-256 (`assets[].digest`).
/// [`download_url`] is still what a *human* is told to fetch, since it needs no JSON.
pub const CLOUDFLARED_RELEASE_API: &str =
    "https://api.github.com/repos/cloudflare/cloudflared/releases/latest";

/// How far along an [`install`] is. Polled by `GET /api/tunnel/share/install`, which is also how the
/// settings pane renders a progress bar instead of a frozen button.
///
/// Progress is reported at all because the asset is ~40 MB: the original simply awaits `DownloadAsync`,
/// which on a slow link is a multi-second silent hang on a button press. `total_bytes` is an
/// `Option` because a server is not obliged to send `Content-Length`; the pane shows an indeterminate
/// bar in that case rather than inventing a denominator.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    /// One of `idle`, `resolving`, `downloading`, `verifying`, `installing`, `done`, `failed`,
    /// `cancelled`. A string rather than an enum in the wire format because the pane only ever
    /// switches on it for display, and a new phase must not break an older client.
    pub phase: String,
    pub downloaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    /// Set only in the `failed` phase. Carries the actionable message, not a debug string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl InstallProgress {
    fn idle() -> Self {
        Self {
            phase: "idle".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            error: None,
        }
    }

    fn phase(name: &str) -> Self {
        Self {
            phase: name.to_string(),
            ..Self::idle()
        }
    }

    /// Whether an install is in flight. Used to make [`CloudflaredInstall::start`] idempotent, so a
    /// double-click cannot start two downloads writing to the same path.
    pub fn is_running(&self) -> bool {
        matches!(
            self.phase.as_str(),
            "resolving" | "downloading" | "verifying" | "installing"
        )
    }
}

/// A cancellable, observable install for one `TENDRIL_HOME`.
///
/// The shape mirrors [`super::service::TunnelService`]'s supervisor: a shared cell holding the live
/// state, and a flag the caller can set to unwind a long-running task from outside. A download the
/// user cannot get out of is as bad as one with no progress, and both of those are why this is a
/// background task with a handle rather than one long `await` inside the route.
#[derive(Debug, Default)]
pub struct CloudflaredInstall {
    progress: std::sync::Mutex<Option<InstallProgress>>,
    cancelled: std::sync::atomic::AtomicBool,
}

impl CloudflaredInstall {
    pub fn new() -> Self {
        Self::default()
    }

    /// The live progress, or `idle` if nothing has been attempted.
    pub fn progress(&self) -> InstallProgress {
        self.lock().clone().unwrap_or_else(InstallProgress::idle)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<InstallProgress>> {
        self.progress
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn set(&self, progress: InstallProgress) {
        *self.lock() = Some(progress);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Asks a running install to stop. Returns whether one was actually in flight.
    ///
    /// The partially written file is a temp file that the task removes on the way out, so a cancel
    /// can never leave a truncated `cloudflared` sitting where [`find_existing`] would find it.
    pub fn cancel(&self) -> bool {
        let running = self.progress().is_running();
        if running {
            self.cancelled
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
        running
    }

    /// Marks the start of an attempt, refusing if one is already in flight.
    fn begin(&self) -> bool {
        let mut guard = self.lock();
        if guard.as_ref().is_some_and(InstallProgress::is_running) {
            return false;
        }
        self.cancelled
            .store(false, std::sync::atomic::Ordering::SeqCst);
        *guard = Some(InstallProgress::phase("resolving"));
        true
    }

    /// Runs an install to completion, reporting into `self`. Idempotent while one is in flight: a
    /// second call is a no-op returning `false`, which is what stops a double-click downloading twice.
    pub async fn run(&self, tendril_home: &Path, options: &InstallOptions) -> bool {
        if !self.begin() {
            return false;
        }
        match install(tendril_home, options, self).await {
            Ok(_) => self.set(InstallProgress {
                phase: "done".to_string(),
                ..self.progress()
            }),
            Err(err) if self.is_cancelled() => {
                // A cancel is the user's own decision, not a failure to report back at them.
                tracing::info!("cloudflared install cancelled: {err}");
                self.set(InstallProgress::phase("cancelled"));
            }
            Err(err) => {
                tracing::warn!("cloudflared install failed: {err}");
                self.set(InstallProgress {
                    phase: "failed".to_string(),
                    error: Some(err.to_string()),
                    ..self.progress()
                });
            }
        }
        true
    }
}

/// Where [`install`] fetches from, so a test never touches the network.
///
/// The repo's established way to fake HTTP is a loopback `TcpListener` plus an injected base URL (see
/// `provider_model_discovery_test.rs` and `version_check::check_once`'s injected client); this is that
/// same idiom. `api_url` is separated from the asset URL because the asset URL is whatever the API
/// says it is — a stub serves both from the same loopback origin.
#[derive(Debug, Clone)]
pub struct InstallOptions {
    pub api_url: String,
    pub client: reqwest::Client,
}

impl Default for InstallOptions {
    fn default() -> Self {
        Self {
            api_url: CLOUDFLARED_RELEASE_API.to_string(),
            // No overall timeout: this is a ~40 MB download on an arbitrary link, and a deadline that
            // fires mid-transfer on a slow connection would be indistinguishable from a broken one.
            // The connect timeout still bounds the "no network at all" case, and cancellation is the
            // user's way out of a transfer that is merely slow.
            client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
        }
    }
}

/// One asset as the releases API describes it.
#[derive(Debug, serde::Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    /// `sha256:<hex>`, published by GitHub for every release asset. Optional in the type because a
    /// missing digest must be a clear refusal rather than a deserialisation error.
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ReleaseResponse {
    #[serde(default)]
    assets: Vec<ReleaseAsset>,
}

/// Downloads, verifies and installs `cloudflared` into [`local_binary_path`].
///
/// Port of the original's `DownloadAsync`, with the two things it does not do: the bytes are checked
/// against the digest the releases API published before anything is written into place, and the
/// transfer reports progress and honours a cancel.
///
/// Never called except from an explicit user action — see this module's docs.
async fn install(
    tendril_home: &Path,
    options: &InstallOptions,
    tracker: &CloudflaredInstall,
) -> Result<PathBuf, TunnelError> {
    let asset_name = platform_asset_name();
    let target = local_binary_path(tendril_home);
    let tools = tools_dir(tendril_home);

    // Checked before the network, so "your tools directory is read-only" is not reported as a download
    // failure after a 40 MB transfer.
    std::fs::create_dir_all(&tools).map_err(|source| TunnelError::InstallFailed {
        reason: format!(
            "{} could not be created ({source}). Create it, or install cloudflared yourself and set \
shareTunnel.binaryPath.",
            tools.display()
        ),
    })?;

    let asset = resolve_asset(options, asset_name).await?;
    let digest = expected_digest(&asset)?;

    tracker.set(InstallProgress::phase("downloading"));
    let bytes = download_asset(options, &asset.browser_download_url, tracker).await?;

    tracker.set(InstallProgress {
        phase: "verifying".to_string(),
        ..tracker.progress()
    });
    verify_digest(&bytes, &digest, &asset.name)?;

    tracker.set(InstallProgress {
        phase: "installing".to_string(),
        ..tracker.progress()
    });
    write_binary(&bytes, asset_name, &tools, &target)?;
    Ok(target)
}

/// Finds this platform's asset in the latest release.
async fn resolve_asset(
    options: &InstallOptions,
    asset_name: &str,
) -> Result<ReleaseAsset, TunnelError> {
    let response = options
        .client
        .get(&options.api_url)
        // GitHub rejects API requests with no User-Agent outright, which would otherwise read as a
        // mysterious 403. Same header `version_check` sends.
        .header("User-Agent", "tendril")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|source| TunnelError::InstallFailed {
            reason: format!(
                "could not reach GitHub to look up the cloudflared release ({source}). Check your \
network, or install cloudflared yourself."
            ),
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(TunnelError::InstallFailed {
            reason: format!(
                "GitHub returned {status} when asked for the latest cloudflared release. Try again \
later, or install cloudflared yourself."
            ),
        });
    }

    let body = response
        .text()
        .await
        .map_err(|source| TunnelError::InstallFailed {
            reason: format!("the release listing could not be read ({source})"),
        })?;
    let release: ReleaseResponse =
        serde_json::from_str(&body).map_err(|source| TunnelError::InstallFailed {
            reason: format!("the release listing could not be understood ({source})"),
        })?;

    release
        .assets
        .into_iter()
        .find(|asset| asset.name == asset_name)
        .ok_or_else(|| TunnelError::InstallFailed {
            reason: format!(
                "the latest cloudflared release has no {asset_name} for this platform. Install \
cloudflared yourself — see https://pkg.cloudflare.com."
            ),
        })
}

/// The `sha256:<hex>` the API published for `asset`, as bare hex.
///
/// An asset with no digest is refused rather than installed unverified: "we could not check it" and
/// "it is fine" must not collapse into the same outcome, which is the entire reason the download is
/// defensible at all.
fn expected_digest(asset: &ReleaseAsset) -> Result<String, TunnelError> {
    let raw = asset
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .map(str::trim)
        .filter(|hex| hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit()));

    raw.map(str::to_ascii_lowercase)
        .ok_or_else(|| TunnelError::InstallFailed {
            reason: format!(
                "GitHub published no SHA-256 for {}, so it cannot be verified. Install cloudflared \
yourself rather than trusting an unchecked download.",
                asset.name
            ),
        })
}

/// Streams the asset into memory, updating `tracker` and unwinding on a cancel.
///
/// In memory rather than straight to disk because the bytes must be hashed before anything lands
/// anywhere executable, and ~40 MB is a size this process already handles elsewhere.
async fn download_asset(
    options: &InstallOptions,
    url: &str,
    tracker: &CloudflaredInstall,
) -> Result<Vec<u8>, TunnelError> {
    use futures_util::StreamExt;

    let response = options
        .client
        .get(url)
        .header("User-Agent", "tendril")
        .send()
        .await
        .map_err(|source| TunnelError::InstallFailed {
            reason: format!(
                "the cloudflared download could not be started ({source}). Check your network, or \
install cloudflared yourself."
            ),
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(TunnelError::InstallFailed {
            reason: format!("the cloudflared download returned {status}"),
        });
    }

    let total = response.content_length();
    tracker.set(InstallProgress {
        phase: "downloading".to_string(),
        downloaded_bytes: 0,
        total_bytes: total,
        error: None,
    });

    let mut buffer: Vec<u8> = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        // Checked per chunk rather than per download, so Cancel takes effect within one network read
        // instead of at the end of a transfer the user has already given up on.
        if tracker.is_cancelled() {
            return Err(TunnelError::InstallFailed {
                reason: "the cloudflared download was cancelled".to_string(),
            });
        }
        let chunk = chunk.map_err(|source| TunnelError::InstallFailed {
            reason: format!(
                "the cloudflared download was interrupted ({source}). Try again, or install \
cloudflared yourself."
            ),
        })?;
        buffer.extend_from_slice(&chunk);
        tracker.set(InstallProgress {
            phase: "downloading".to_string(),
            downloaded_bytes: buffer.len() as u64,
            total_bytes: total,
            error: None,
        });
    }
    Ok(buffer)
}

/// Refuses anything whose bytes do not hash to what the API said they would.
pub fn verify_digest(bytes: &[u8], expected_hex: &str, asset: &str) -> Result<(), TunnelError> {
    use sha2::{Digest, Sha256};
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual == expected_hex {
        return Ok(());
    }
    Err(TunnelError::InstallFailed {
        reason: format!(
            "the downloaded {asset} does not match the SHA-256 GitHub published for it \
(expected {expected_hex}, got {actual}). Nothing was installed."
        ),
    })
}

/// Puts the verified bytes at `target`, extracting first when the asset is an archive.
///
/// Only macOS ships a `.tgz`; Windows and Linux assets are the bare binary, which is why the original
/// has one tar reader and one straight copy. The same split is kept here.
fn write_binary(
    bytes: &[u8],
    asset_name: &str,
    tools: &Path,
    target: &Path,
) -> Result<(), TunnelError> {
    let staged = tools.join(format!("{}.download", local_binary_name()));
    let cleanup = |path: &Path| {
        let _ = std::fs::remove_file(path);
    };

    if asset_name.ends_with(".tgz") {
        let archive = tools.join("cloudflared-download.tgz");
        write_file(&archive, bytes)?;
        let extracted = extract_tgz(&archive, tools);
        cleanup(&archive);
        extracted?;
    } else {
        write_file(&staged, bytes)?;
        // Renamed rather than written in place so that a crash mid-write cannot leave a truncated file
        // where `find_existing` would pick it up and try to run it.
        std::fs::rename(&staged, target).map_err(|source| {
            cleanup(&staged);
            TunnelError::InstallFailed {
                reason: format!("{} could not be written ({source})", target.display()),
            }
        })?;
    }

    make_executable(target)?;
    if !is_executable_file(target) {
        return Err(TunnelError::InstallFailed {
            reason: format!(
                "{} was installed but is not executable. Install cloudflared yourself, or set \
shareTunnel.binaryPath.",
                target.display()
            ),
        });
    }
    Ok(())
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), TunnelError> {
    std::fs::write(path, bytes).map_err(|source| TunnelError::InstallFailed {
        reason: format!("{} could not be written ({source})", path.display()),
    })
}

/// Extracts the single `cloudflared` entry from the macOS archive into `tools`.
///
/// Shells out to `tar` rather than decoding in-process, and the reason is a constraint rather than a
/// preference: `tendril-core` depends on neither `flate2` nor `tar` (the CLI does, for self-update),
/// and adding a dependency is not this change's to make. Shelling out is sound here specifically
/// because a `.tgz` asset only ever exists on macOS, where `tar` is part of the base system — the
/// Windows and Linux assets are bare binaries that never reach this function. It is also the idiom the
/// module already uses for `which`/`where.exe`, and the original shells out to `chmod` for the same
/// kind of reason.
///
/// The archive holds exactly one root-level entry, `cloudflared`, so a named extract is enough and
/// there is no wrapping directory to walk.
fn extract_tgz(archive: &Path, tools: &Path) -> Result<(), TunnelError> {
    let output = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(tools)
        .arg("cloudflared")
        .output()
        .map_err(|source| TunnelError::InstallFailed {
            reason: format!("the downloaded archive could not be extracted ({source})"),
        })?;

    if !output.status.success() {
        return Err(TunnelError::InstallFailed {
            reason: format!(
                "the downloaded archive could not be extracted ({})",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        });
    }
    Ok(())
}

/// The original's `chmod +x`, done directly rather than by spawning `chmod`.
#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), TunnelError> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(path).map_err(|source| TunnelError::InstallFailed {
        reason: format!("{} is missing after install ({source})", path.display()),
    })?;
    let mut perms = metadata.permissions();
    perms.set_mode(perms.mode() | 0o755);
    std::fs::set_permissions(path, perms).map_err(|source| TunnelError::InstallFailed {
        reason: format!("{} could not be made executable ({source})", path.display()),
    })
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), TunnelError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Home(PathBuf);

    impl Home {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "tendril-tunnel-{label}-{}",
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&path).expect("create fixture home");
            Self(path)
        }

        /// A file that behaves like an installed binary for detection purposes. Never executed.
        fn write_fake_binary(&self) -> PathBuf {
            let path = local_binary_path(&self.0);
            std::fs::create_dir_all(path.parent().unwrap()).expect("create tools dir");
            std::fs::write(&path, b"#!/bin/sh\nexit 0\n").expect("write fake binary");
            make_executable(&path);
            path
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            assert!(
                self.0.starts_with(std::env::temp_dir()),
                "fixture must live under the temp dir"
            );
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).unwrap();
    }

    #[cfg(not(unix))]
    fn make_executable(_path: &Path) {}

    #[test]
    fn the_local_copy_is_found_first() {
        let home = Home::new("local-copy");
        let expected = home.write_fake_binary();
        assert_eq!(find_existing(&home.0), Some(expected.clone()));
        assert_eq!(resolve_binary(&home.0, None).unwrap(), expected);
    }

    /// The `tools/` layout is the original's, and the error message quotes it, so it is pinned.
    #[test]
    fn the_local_path_is_tools_cloudflared() {
        let home = Home::new("layout");
        assert_eq!(
            local_binary_path(&home.0),
            home.0.join("tools").join(local_binary_name())
        );
    }

    #[test]
    fn a_non_executable_file_does_not_count_as_installed() {
        let home = Home::new("not-exec");
        let path = local_binary_path(&home.0);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"downloaded but never chmod +x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&path).unwrap().permissions();
            perms.set_mode(0o644);
            std::fs::set_permissions(&path, perms).unwrap();
            assert!(!is_executable_file(&path));
        }
        // A directory is never a binary, on any platform.
        assert!(!is_executable_file(&home.0));
    }

    /// The message an operator with no cloudflared sees. It has to be actionable, so the assertions
    /// are on its content rather than on the variant.
    #[test]
    fn a_missing_binary_is_an_actionable_error() {
        let home = Home::new("missing");
        // Pointing the search at an empty home only reaches PATH; on a machine that has cloudflared
        // installed globally this legitimately succeeds, and the message under test is unreachable.
        let err = match resolve_binary(&home.0, None) {
            Err(err) => err,
            Ok(found) => {
                assert!(is_executable_file(&found));
                return;
            }
        };
        let message = err.to_string();
        assert!(message.contains("not installed"), "{message}");
        assert!(message.contains("brew install cloudflared"), "{message}");
        assert!(
            message.contains("github.com/cloudflare/cloudflared/releases"),
            "{message}"
        );
        assert!(
            message.contains(&local_binary_path(&home.0).display().to_string()),
            "the message names where to put it: {message}"
        );
    }

    #[test]
    fn a_configured_binary_path_that_is_wrong_says_so() {
        let home = Home::new("configured");
        let err = resolve_binary(&home.0, Some("/definitely/not/here/cloudflared")).unwrap_err();
        let message = err.to_string();
        assert!(message.contains("shareTunnel.binaryPath"), "{message}");
        assert!(
            !message.contains("not installed"),
            "a wrong override must not be reported as a missing install: {message}"
        );
    }

    #[test]
    fn a_configured_binary_path_wins_over_the_local_copy() {
        let home = Home::new("override");
        home.write_fake_binary();
        let elsewhere = home.0.join("custom-cloudflared");
        std::fs::write(&elsewhere, b"#!/bin/sh\nexit 0\n").unwrap();
        make_executable(&elsewhere);
        assert_eq!(
            resolve_binary(&home.0, Some(elsewhere.to_str().unwrap())).unwrap(),
            elsewhere
        );
    }

    #[test]
    fn the_asset_name_and_url_match_the_originals_mapping() {
        let asset = platform_asset_name();
        assert!(asset.starts_with("cloudflared-"), "{asset}");
        if cfg!(target_os = "macos") {
            assert!(
                asset.ends_with(".tgz"),
                "macOS assets are tarballs: {asset}"
            );
        }
        assert_eq!(
            download_url(asset),
            format!("https://github.com/cloudflare/cloudflared/releases/latest/download/{asset}")
        );
    }

    #[test]
    fn install_state_reports_where_to_put_it_even_when_absent() {
        let home = Home::new("install-state");
        let state = install_state(&home.0, None);
        assert_eq!(
            state.expected_path,
            local_binary_path(&home.0).display().to_string()
        );
        assert!(state.download_url.ends_with(&state.asset_name));

        home.write_fake_binary();
        let state = install_state(&home.0, None);
        assert!(state.installed);
        assert!(state.binary_path.is_some());
    }

    /// `find_on_path` has to work, or detection silently degrades to "only the local copy counts".
    #[test]
    fn find_on_path_locates_a_binary_that_is_definitely_there() {
        let probe = if cfg!(windows) { "cmd" } else { "sh" };
        assert!(
            find_on_path(probe).is_some(),
            "{probe} should be resolvable on PATH"
        );
        assert!(find_on_path("tendril-no-such-binary-9f3a").is_none());
    }
}
