use crate::commands::confirm::confirm;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Owner/repo the `cli-v*` releases are published to by `.github/workflows/release-cli.yml`.
const RELEASES_URL: &str =
    "https://api.github.com/repos/Ivy-Interactive/Ivy-Tendril-V2/releases?per_page=30";

/// Tag prefix for CLI releases. The same repository also publishes `app-v*` tags for the Tauri
/// bundle, so `/releases/latest` would frequently return the wrong thing.
const CLI_TAG_PREFIX: &str = "cli-v";

#[derive(clap::Args)]
pub struct UpdateArgs {
    /// Report the available version without downloading anything
    #[arg(long)]
    pub check: bool,

    /// Skip the confirmation prompt
    #[arg(long, short = 'y')]
    pub yes: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub prerelease: bool,
}

/// Parses `1.2.3` or `cli-v1.2.3` into its numeric parts. Anything with a non-numeric or missing
/// component is rejected, so a prerelease suffix (`0.3.0-beta`) parses on its `0.3.0` core.
pub fn parse_semver(input: &str) -> Option<(u64, u64, u64)> {
    let trimmed = input
        .trim()
        .trim_start_matches(CLI_TAG_PREFIX)
        .trim_start_matches('v');
    // Drop any prerelease/build suffix; `cli-v0.3.0-beta` sorts as 0.3.0.
    let core = trimmed
        .split(['-', '+'])
        .next()
        .unwrap_or(trimmed)
        .to_string();

    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// True when `available` is strictly newer than `current`. An unparseable version is never newer.
pub fn is_newer(current: &str, available: &str) -> bool {
    match (parse_semver(current), parse_semver(available)) {
        (Some(cur), Some(avail)) => avail > cur,
        _ => false,
    }
}

/// Picks the highest-versioned `cli-v*` release. Prereleases are considered only when
/// `include_prerelease` is set (`TENDRIL_BETA=1`), mirroring the original's beta channel.
pub fn select_cli_release(releases: &[Release], include_prerelease: bool) -> Option<&Release> {
    releases
        .iter()
        .filter(|release| release.tag_name.starts_with(CLI_TAG_PREFIX))
        .filter(|release| include_prerelease || !release.prerelease)
        .filter_map(|release| parse_semver(&release.tag_name).map(|version| (version, release)))
        .max_by_key(|(version, _)| *version)
        .map(|(_, release)| release)
}

/// The archive and checksum asset names `release-cli.yml` publishes for `version` on `target`.
pub fn asset_names(version: &str, target: &str) -> (String, String) {
    let extension = if target == "x86_64-pc-windows-msvc" {
        "zip"
    } else {
        "tar.gz"
    };
    let archive = format!("tendril-{version}-{target}.{extension}");
    let checksum = format!("{archive}.sha256");
    (archive, checksum)
}

/// Extracts the hex digest from a `sha256sum`/`shasum -a 256` line (`<hex>  <filename>`).
pub fn parse_sha256_file(contents: &str) -> Option<String> {
    let digest = contents.split_whitespace().next()?.to_ascii_lowercase();
    if digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(digest)
    } else {
        None
    }
}

/// The Rust target triple this binary was built for — one of the five `release-cli.yml` builds.
pub fn current_target() -> Option<&'static str> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some("aarch64-apple-darwin");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Some("x86_64-apple-darwin");
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Some("x86_64-unknown-linux-gnu");
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return Some("aarch64-unknown-linux-gnu");
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Some("x86_64-pc-windows-msvc");
    #[cfg(not(any(
        all(
            target_os = "macos",
            any(target_arch = "aarch64", target_arch = "x86_64")
        ),
        all(
            target_os = "linux",
            any(target_arch = "aarch64", target_arch = "x86_64")
        ),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    return None;
}

/// True when `exe` sits inside a Tauri app bundle, where the binary is an `externalBin` sidecar
/// owned by the desktop app's own updater. The analogue of the original's `mgr.IsInstalled` branch.
pub fn is_bundled_sidecar(exe: &Path) -> bool {
    let Some(parent) = exe.parent() else {
        return false;
    };

    let in_app_bundle = parent
        .components()
        .any(|component| component.as_os_str().to_string_lossy().ends_with(".app"));
    let parent_name = parent
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();

    if in_app_bundle && (parent_name == "MacOS" || parent_name == "Resources") {
        return true;
    }

    parent.join("tendril-app").exists() || parent.join("tendril-app.exe").exists()
}

pub async fn handle_update(args: UpdateArgs) -> anyhow::Result<()> {
    let current_exe = std::env::current_exe()?;
    // A `.old` binary can only be deleted once the process holding it has exited, which on Windows
    // means the next run rather than the one that swapped it.
    clean_stale_backup(&current_exe);

    let current_version = env!("CARGO_PKG_VERSION");
    let include_prerelease = std::env::var("TENDRIL_BETA")
        .map(|v| v == "1")
        .unwrap_or(false);

    let releases = match fetch_releases(RELEASES_URL, current_version).await {
        Ok(releases) => releases,
        Err(err) => {
            tracing::debug!("Failed to fetch releases: {err}");
            Vec::new()
        }
    };

    let Some(release) = select_cli_release(&releases, include_prerelease) else {
        println!("Current version:   {current_version}");
        println!("Could not determine the latest version of Tendril.");
        std::process::exit(1);
    };

    let available_version = release
        .tag_name
        .trim_start_matches(CLI_TAG_PREFIX)
        .to_string();

    println!("Current version:   {current_version}");
    println!("Available version: {available_version}");

    if !is_newer(current_version, &available_version) {
        println!("You are already on the latest version of Tendril.");
        return Ok(());
    }

    if is_bundled_sidecar(&current_exe) {
        println!(
            "This tendril binary is managed by the Tendril desktop app. Update the app instead."
        );
        return Ok(());
    }

    if args.check {
        return Ok(());
    }

    if !confirm(
        &format!("Update to {available_version}? [y/N]"),
        args.yes,
        false,
    )? {
        println!("Cancelled.");
        return Ok(());
    }

    let Some(target) = current_target() else {
        println!("No release asset is published for this platform.");
        std::process::exit(1);
    };

    let (archive_name, checksum_name) = asset_names(&available_version, target);
    let base = format!(
        "https://github.com/Ivy-Interactive/Ivy-Tendril-V2/releases/download/{}",
        release.tag_name
    );

    println!("Downloading {archive_name}...");
    let client = http_client(current_version)?;
    let archive_bytes = client
        .get(format!("{base}/{archive_name}"))
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let checksum_text = client
        .get(format!("{base}/{checksum_name}"))
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    let expected = parse_sha256_file(&checksum_text)
        .ok_or_else(|| anyhow::anyhow!("Could not read a sha256 digest from {checksum_name}"))?;
    let actual = hex_digest(&archive_bytes);
    if actual != expected {
        anyhow::bail!("Checksum mismatch for {archive_name}: expected {expected}, got {actual}");
    }

    // Stage next to the current executable so the final move stays on one volume and is atomic.
    let staging =
        current_exe.with_file_name(format!(".tendril-update-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&staging)?;

    let swap = extract_and_swap(&archive_bytes, target, &staging, &current_exe);
    let _ = std::fs::remove_dir_all(&staging);
    swap?;

    println!("Updated to {available_version}. Restart any running tendril processes.");
    Ok(())
}

fn http_client(current_version: &str) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        // GitHub rejects API requests without a User-Agent.
        .user_agent(format!("tendril-cli/{current_version}"))
        .timeout(Duration::from_secs(10))
        .build()
}

async fn fetch_releases(url: &str, current_version: &str) -> anyhow::Result<Vec<Release>> {
    let client = http_client(current_version)?;
    let releases = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json::<Vec<Release>>()
        .await?;
    Ok(releases)
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn backup_path(exe: &Path) -> PathBuf {
    let mut name = exe.as_os_str().to_os_string();
    name.push(".old");
    PathBuf::from(name)
}

fn clean_stale_backup(exe: &Path) {
    let backup = backup_path(exe);
    if backup.exists() {
        let _ = std::fs::remove_file(&backup);
    }
}

fn extract_and_swap(
    archive: &[u8],
    target: &str,
    staging: &Path,
    current_exe: &Path,
) -> anyhow::Result<()> {
    extract_archive(archive, target, staging)?;

    let binary_name = if target == "x86_64-pc-windows-msvc" {
        "tendril.exe"
    } else {
        "tendril"
    };
    let extracted = find_file(staging, binary_name)
        .ok_or_else(|| anyhow::anyhow!("{binary_name} not found in the downloaded archive"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&extracted, std::fs::Permissions::from_mode(0o755))?;
    }

    // Rename aside rather than overwrite: the running executable cannot be replaced in place on
    // Windows, and on Unix this keeps the old binary recoverable if the move fails.
    let backup = backup_path(current_exe);
    std::fs::rename(current_exe, &backup)?;
    if let Err(err) = std::fs::rename(&extracted, current_exe) {
        let _ = std::fs::rename(&backup, current_exe);
        return Err(err.into());
    }
    let _ = std::fs::remove_file(&backup);

    Ok(())
}

#[cfg(not(windows))]
fn extract_archive(archive: &[u8], _target: &str, staging: &Path) -> anyhow::Result<()> {
    let decoder = flate2::read::GzDecoder::new(archive);
    tar::Archive::new(decoder).unpack(staging)?;
    Ok(())
}

#[cfg(windows)]
fn extract_archive(archive: &[u8], _target: &str, staging: &Path) -> anyhow::Result<()> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive))?;
    zip.extract(staging)?;
    Ok(())
}

/// Finds `name` anywhere under `dir`. The published archives wrap the binary in a
/// `tendril-<version>-<target>/` staging directory, so the binary is never at the root.
fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {
                if let Some(found) = find_file(&path, name) {
                    return Some(found);
                }
            }
            Ok(_) if entry.file_name() == name => return Some(path),
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, prerelease: bool) -> Release {
        Release {
            tag_name: tag.to_string(),
            prerelease,
        }
    }

    #[test]
    fn parse_semver_accepts_plain_and_tagged_versions() {
        assert_eq!(parse_semver("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_semver("cli-v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_semver("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_semver("0.1.0"), Some((0, 1, 0)));
        assert_eq!(parse_semver("cli-v0.3.0-beta"), Some((0, 3, 0)));
    }

    #[test]
    fn parse_semver_rejects_junk() {
        assert_eq!(parse_semver("not-a-version"), None);
        assert_eq!(parse_semver("1.2"), None);
        assert_eq!(parse_semver("1.2.3.4"), None);
        assert_eq!(parse_semver(""), None);
        assert_eq!(parse_semver("app-v2.0.0"), None);
    }

    #[test]
    fn is_newer_compares_numerically() {
        assert!(is_newer("0.1.0", "0.2.0"));
        assert!(is_newer("0.9.0", "0.10.0"), "0.10.0 must beat 0.9.0");
        assert!(!is_newer("0.2.0", "0.2.0"));
        assert!(!is_newer("0.2.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "garbage"));
    }

    #[test]
    fn select_cli_release_ignores_app_tags_and_prereleases() {
        let releases = vec![
            release("app-v2.0.0", false),
            release("cli-v0.2.0", false),
            release("cli-v0.3.0-beta", true),
        ];

        assert_eq!(
            select_cli_release(&releases, false).map(|r| r.tag_name.as_str()),
            Some("cli-v0.2.0")
        );
        assert_eq!(
            select_cli_release(&releases, true).map(|r| r.tag_name.as_str()),
            Some("cli-v0.3.0-beta")
        );
    }

    #[test]
    fn select_cli_release_picks_the_highest_version_not_the_first() {
        let releases = vec![
            release("cli-v0.2.0", false),
            release("cli-v0.10.0", false),
            release("cli-v0.9.0", false),
        ];

        assert_eq!(
            select_cli_release(&releases, false).map(|r| r.tag_name.as_str()),
            Some("cli-v0.10.0")
        );
    }

    #[test]
    fn select_cli_release_is_none_without_a_cli_tag() {
        let releases = vec![release("app-v2.0.0", false)];
        assert!(select_cli_release(&releases, false).is_none());
        assert!(select_cli_release(&[], false).is_none());
    }

    #[test]
    fn select_cli_release_parses_a_release_list_fixture() {
        let json = r#"[
            { "tag_name": "app-v2.0.0", "prerelease": false },
            { "tag_name": "cli-v0.2.0", "prerelease": false },
            { "tag_name": "cli-v0.3.0-beta", "prerelease": true }
        ]"#;
        let releases: Vec<Release> = serde_json::from_str(json).unwrap();

        assert_eq!(
            select_cli_release(&releases, false).map(|r| r.tag_name.as_str()),
            Some("cli-v0.2.0")
        );
    }

    #[test]
    fn asset_names_match_the_release_workflow() {
        assert_eq!(
            asset_names("0.2.0", "aarch64-apple-darwin"),
            (
                "tendril-0.2.0-aarch64-apple-darwin.tar.gz".to_string(),
                "tendril-0.2.0-aarch64-apple-darwin.tar.gz.sha256".to_string()
            )
        );
        assert_eq!(
            asset_names("0.2.0", "x86_64-pc-windows-msvc"),
            (
                "tendril-0.2.0-x86_64-pc-windows-msvc.zip".to_string(),
                "tendril-0.2.0-x86_64-pc-windows-msvc.zip.sha256".to_string()
            )
        );
    }

    #[test]
    fn parse_sha256_file_reads_the_digest() {
        let digest = "a".repeat(64);
        assert_eq!(
            parse_sha256_file(&format!(
                "{digest}  tendril-0.2.0-aarch64-apple-darwin.tar.gz\n"
            )),
            Some(digest.clone())
        );
        assert_eq!(parse_sha256_file(&digest.to_uppercase()), Some(digest));
        assert_eq!(parse_sha256_file("not-a-digest  file"), None);
        assert_eq!(parse_sha256_file(""), None);
    }

    #[test]
    fn hex_digest_matches_a_known_sha256() {
        // Well-known SHA-256 of the empty input.
        assert_eq!(
            hex_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn is_bundled_sidecar_detects_a_macos_app_bundle() {
        assert!(is_bundled_sidecar(Path::new(
            "/Applications/Tendril.app/Contents/MacOS/tendril"
        )));
        assert!(!is_bundled_sidecar(Path::new("/usr/local/bin/tendril")));
    }

    #[test]
    fn current_target_is_known_on_supported_platforms() {
        assert!(
            current_target().is_some(),
            "the test host should be one of the five release targets"
        );
    }
}

#[cfg(test)]
mod arg_tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    #[command(name = "tendril")]
    struct TestCli {
        #[command(flatten)]
        args: UpdateArgs,
    }

    fn parse(args: &[&str]) -> UpdateArgs {
        TestCli::try_parse_from(args).unwrap().args
    }

    #[test]
    fn both_flags_default_to_false() {
        let args = parse(&["tendril"]);
        assert!(!args.check);
        assert!(!args.yes);
    }

    #[test]
    fn check_and_yes_parse_together_and_apart() {
        assert!(parse(&["tendril", "--check"]).check);
        assert!(parse(&["tendril", "-y"]).yes);
        assert!(parse(&["tendril", "--yes"]).yes);

        let both = parse(&["tendril", "--check", "-y"]);
        assert!(both.check && both.yes);
    }
}
