//! Finding `cloudflared` — a port of `Services/Tunnel/CloudflaredInstaller.cs`, minus the download.
//!
//! The original's `EnsureInstalledAsync` silently fetches a ~40 MB binary from GitHub's "latest"
//! release on first use. That is ported as *detection plus an actionable error*:
//!
//! - the search order is the original's (`$TENDRIL_HOME/tools/cloudflared`, then `PATH`),
//! - the platform/asset mapping and the release URL are ported verbatim, so the error message can
//!   name the exact file to download and where from,
//! - nothing is ever downloaded or executed on the operator's behalf.
//!
//! Auto-downloading an unpinned third-party binary and immediately running it is a supply-chain
//! decision, not an implementation detail: there is no checksum, no signature and no version pin in
//! the original, so "latest" is whatever GitHub serves at that moment. Telling the operator to install
//! it with their package manager keeps that decision — and its update path — where it belongs.

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

/// What `GET /api/tunnel/share/install` reports: whether a binary was found, and if not, exactly what
/// to install. Ported from the original's `CheckInstalledAsync` plus the install prompt in
/// `ShareTunnelModal`, which is the only place the download URL was ever surfaced.
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
}

/// Port of `CheckInstalledAsync`, widened to also say where to get it.
pub fn install_state(tendril_home: &Path, configured: Option<&str>) -> InstallState {
    let asset = platform_asset_name().to_string();
    let found = match configured {
        Some(configured) => resolve_binary(tendril_home, Some(configured)).ok(),
        None => find_existing(tendril_home),
    };
    InstallState {
        installed: found.is_some(),
        binary_path: found.map(|path| path.display().to_string()),
        expected_path: local_binary_path(tendril_home).display().to_string(),
        download_url: download_url(&asset),
        asset_name: asset,
    }
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
