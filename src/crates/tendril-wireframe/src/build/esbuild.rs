//! Locating the esbuild binary.
//!
//! Ported from V1's `Build/EsbuildProvisioner.cs`. esbuild ships as a standalone Go executable,
//! which is exactly why it is the bundler here: it needs no node runtime, so Tendril execs the same
//! artifact V1 does rather than reimplementing anything.
//!
//! Resolution order, first hit wins:
//!   1. `WIREFRAME_ESBUILD`  explicit override
//!   2. global cache         a previous download, shared with the standalone wireframe tool
//!   3. npm registry         about 11 MB, verified against the registry hash and cached
//!
//! Tendril deliberately ships no esbuild of its own: carrying all seven platform binaries would add
//! 74 MB to every install. The first build on a machine pays for one download instead.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use base64::Engine as _;
use sha2::Digest;

use crate::project::wireframe_cache_dir;

/// Kept in lockstep with V1's `build/vendor` pinned esbuild.
pub const VERSION: &str = "0.28.2";

fn binary_name() -> &'static str {
    if cfg!(windows) {
        "esbuild.exe"
    } else {
        "esbuild"
    }
}

/// The platform key the npm platform packages are resolved against. Mirrors V1's `Rid`, which is a
/// .NET RID, so the cache path a V1 install produced is the one this finds.
pub fn rid() -> String {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        other => other,
    };
    if cfg!(windows) {
        format!("win-{arch}")
    } else if cfg!(target_os = "macos") {
        format!("osx-{arch}")
    } else {
        format!("linux-{arch}")
    }
}

/// RID -> npm platform package. esbuild's Linux builds are static Go binaries, so the same artifact
/// serves glibc and musl.
fn npm_package(rid: &str) -> Result<&'static str> {
    Ok(match rid {
        "win-x64" => "@esbuild/win32-x64",
        "win-arm64" => "@esbuild/win32-arm64",
        "win-ia32" => "@esbuild/win32-ia32",
        "linux-x64" => "@esbuild/linux-x64",
        "linux-arm64" => "@esbuild/linux-arm64",
        "osx-x64" => "@esbuild/darwin-x64",
        "osx-arm64" => "@esbuild/darwin-arm64",
        _ => bail!(
            "No esbuild binary is published for '{rid}'. \
             Set WIREFRAME_ESBUILD to a local esbuild."
        ),
    })
}

/// Where a downloaded binary lives. Reported by `tendril doctor`.
pub fn cached_path() -> PathBuf {
    wireframe_cache_dir()
        .join("esbuild")
        .join(VERSION)
        .join(rid())
        .join(binary_name())
}

/// Every place esbuild might already be, in preference order.
fn local_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(val) = std::env::var("WIREFRAME_ESBUILD") {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            out.push(PathBuf::from(trimmed));
        }
    }
    out.push(cached_path());
    out
}

/// Resolve esbuild, downloading it on first use.
pub async fn resolve() -> Result<PathBuf> {
    for candidate in local_candidates() {
        if candidate.is_file() {
            make_executable(&candidate);
            return Ok(candidate);
        }
    }
    download().await
}

async fn download() -> Result<PathBuf> {
    let rid = rid();
    let pkg = npm_package(&rid)?;
    let target = cached_path();
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Creating the esbuild cache at {}", parent.display()))?;
    }

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()?;

    // The packument carries the tarball URL and its SHA-512 integrity.
    let packument: serde_json::Value = http
        .get(format!("https://registry.npmjs.org/{pkg}"))
        .send()
        .await
        .with_context(|| format!("Fetching {pkg} from the npm registry"))?
        .error_for_status()?
        .json()
        .await
        .with_context(|| format!("Reading the {pkg} packument"))?;

    let dist = packument
        .get("versions")
        .and_then(|v| v.get(VERSION))
        .and_then(|v| v.get("dist"))
        .with_context(|| format!("{pkg} has no version {VERSION} on the npm registry."))?;

    let url = dist
        .get("tarball")
        .and_then(|t| t.as_str())
        .with_context(|| format!("{pkg} {VERSION} has no tarball URL."))?;
    let integrity = dist.get("integrity").and_then(|i| i.as_str());

    let bytes = http
        .get(url)
        .send()
        .await
        .with_context(|| format!("Downloading {url}"))?
        .error_for_status()?
        .bytes()
        .await
        .with_context(|| format!("Reading the body of {url}"))?;

    verify_integrity(&bytes, integrity, pkg)?;
    extract_binary(&bytes, &target)?;
    make_executable(&target);
    Ok(target)
}

/// An absent or unrecognised algorithm is not an error, matching V1: the registry is trusted to
/// describe its own artifact, and a hash we cannot compute is one we cannot contradict.
fn verify_integrity(bytes: &[u8], integrity: Option<&str>, pkg: &str) -> Result<()> {
    let Some(integrity) = integrity.filter(|i| !i.is_empty()) else {
        return Ok(());
    };
    let Some((algorithm, expected)) = integrity.split_once('-') else {
        return Ok(());
    };

    let actual = match algorithm {
        "sha512" => base64::engine::general_purpose::STANDARD.encode(sha2::Sha512::digest(bytes)),
        "sha256" => base64::engine::general_purpose::STANDARD.encode(sha2::Sha256::digest(bytes)),
        "sha1" => base64::engine::general_purpose::STANDARD.encode(sha1::Sha1::digest(bytes)),
        _ => return Ok(()),
    };

    if actual != expected {
        bail!(
            "Integrity check failed for {pkg}: \
             the downloaded tarball does not match the registry hash."
        );
    }
    Ok(())
}

/// Pulls the single binary out of the npm tarball (everything is under `package/`).
fn extract_binary(tar_gz: &[u8], target: &Path) -> Result<()> {
    let decoder = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(decoder);

    for entry in archive.entries().context("Reading the esbuild tarball")? {
        let mut entry = entry.context("Reading an entry of the esbuild tarball")?;
        let name = entry
            .path()
            .context("Reading an entry path")?
            .to_string_lossy()
            .replace('\\', "/");
        if name != "package/esbuild.exe" && name != "package/bin/esbuild" {
            continue;
        }
        let mut output = std::fs::File::create(target)
            .with_context(|| format!("Writing {}", target.display()))?;
        std::io::copy(&mut entry, &mut output)
            .with_context(|| format!("Extracting esbuild to {}", target.display()))?;
        return Ok(());
    }

    bail!("The esbuild tarball did not contain an esbuild binary.")
}

/// Best effort: if the bit is already set, or the filesystem does not support it, the subsequent
/// exec surfaces a clearer error than we could here.
fn make_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(permissions.mode() | 0o111);
            let _ = std::fs::set_permissions(path, permissions);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
}

/// Used by `wireframe --version` style diagnostics, and by `tendril doctor`.
pub async fn try_get_version(binary: &Path) -> Option<String> {
    let output = tokio::process::Command::new(binary)
        .arg("--version")
        .output()
        .await
        .ok()?;
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rid_maps_to_a_published_package() {
        // Whatever this machine is, it must be a platform esbuild publishes for -- otherwise the
        // error message is the feature, and it names the override.
        let rid = rid();
        match npm_package(&rid) {
            Ok(pkg) => assert!(pkg.starts_with("@esbuild/"), "got {pkg}"),
            Err(e) => assert!(e.to_string().contains("WIREFRAME_ESBUILD"), "got {e}"),
        }
    }

    #[test]
    fn cached_path_is_versioned_and_platform_scoped() {
        std::env::set_var("WIREFRAME_CACHE", "/cache");
        let path = cached_path().to_string_lossy().replace('\\', "/");
        assert!(path.contains(&format!("/esbuild/{VERSION}/")), "got {path}");
        assert!(path.ends_with(binary_name()), "got {path}");
        std::env::remove_var("WIREFRAME_CACHE");
    }

    #[test]
    fn the_override_wins_over_the_cache() {
        std::env::set_var("WIREFRAME_ESBUILD", "/somewhere/esbuild");
        let candidates = local_candidates();
        assert_eq!(candidates[0], PathBuf::from("/somewhere/esbuild"));
        assert_eq!(candidates.len(), 2, "the cache stays as the fallback");
        std::env::remove_var("WIREFRAME_ESBUILD");
    }

    #[test]
    fn integrity_rejects_a_tampered_tarball() {
        let bytes = b"the real thing";
        let good = base64::engine::general_purpose::STANDARD.encode(sha2::Sha512::digest(bytes));
        assert!(verify_integrity(bytes, Some(&format!("sha512-{good}")), "pkg").is_ok());
        assert!(
            verify_integrity(b"something else", Some(&format!("sha512-{good}")), "pkg").is_err()
        );
    }

    #[test]
    fn integrity_is_skipped_when_it_cannot_be_computed() {
        // V1 treats an absent, malformed or unknown-algorithm integrity as unverifiable rather than
        // as a failure. Porting that faithfully, because a stricter rule here would turn a registry
        // metadata change into a broken install.
        assert!(verify_integrity(b"x", None, "pkg").is_ok());
        assert!(verify_integrity(b"x", Some(""), "pkg").is_ok());
        assert!(verify_integrity(b"x", Some("nonsense"), "pkg").is_ok());
        assert!(verify_integrity(b"x", Some("sha999-abc"), "pkg").is_ok());
    }
}
