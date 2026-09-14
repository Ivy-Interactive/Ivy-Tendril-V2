//! Background release check: fetches the repo's `cli-v*` releases, compares against the running
//! binary's version, and caches the result to disk. Mirrors [`crate::agents::model_cache`]'s
//! "network fetch with a disk cache that fails silently" shape — see that module for the pattern
//! this one follows.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Releases published by `.github/workflows/release-cli.yml`. The same repo also tags `app-v*`,
/// so `/releases/latest` would frequently name the wrong thing.
const RELEASES_URL: &str =
    "https://api.github.com/repos/Ivy-Interactive/Ivy-Tendril-V2/releases?per_page=30";
const CLI_TAG_PREFIX: &str = "cli-v";

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub prerelease: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub last_checked: Option<DateTime<Utc>>,
    /// Consecutive failed attempts. Drives the backoff ladder; never surfaced in the UI.
    #[serde(default)]
    pub consecutive_failures: u32,
}

/// The running binary's own version, e.g. `"0.1.0"`.
pub fn current_version() -> &'static str {
    crate::version()
}

/// Parses `"cli-v1.2.3"`, `"v1.2.3"` or `"1.2.3"` into a `(major, minor, patch)` triple. A
/// `-prerelease` or `+build` suffix is stripped before parsing, since only the numeric core is
/// used for comparison. Anything that isn't exactly three numeric components is `None` — `1.2`
/// and `1.2.x` both fail rather than guessing.
pub fn parse_semver(input: &str) -> Option<(u64, u64, u64)> {
    let stripped = input
        .strip_prefix(CLI_TAG_PREFIX)
        .or_else(|| input.strip_prefix('v'))
        .unwrap_or(input);
    let core = stripped
        .split(['-', '+'])
        .next()
        .unwrap_or(stripped);

    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// `true` only when both sides parse and `available` is strictly greater than `current`. A
/// malformed version on either side never triggers a notice.
pub fn is_newer(current: &str, available: &str) -> bool {
    match (parse_semver(current), parse_semver(available)) {
        (Some(c), Some(a)) => a > c,
        _ => false,
    }
}

/// Picks the highest `cli-v*` release by parsed version triple, excluding prereleases unless
/// `include_prerelease` is set. Non-`cli-v*` tags (e.g. `app-v*`) are ignored entirely.
pub fn select_release(releases: &[Release], include_prerelease: bool) -> Option<&Release> {
    releases
        .iter()
        .filter(|r| r.tag_name.starts_with(CLI_TAG_PREFIX))
        .filter(|r| include_prerelease || !r.prerelease)
        .max_by_key(|r| parse_semver(&r.tag_name))
}

/// Compares `current` against the highest matching release in `releases`, producing a fresh
/// `VersionInfo` with `last_checked` set to now. A successful check with no newer release still
/// sets `latest_version: Some(current)` so "up to date" reads differently from "couldn't check"
/// (`None`).
pub fn evaluate(current: &str, releases: &[Release], include_prerelease: bool) -> VersionInfo {
    let latest = select_release(releases, include_prerelease);
    let (latest_version, has_update) = match latest {
        Some(release) => {
            let newer = is_newer(current, &release.tag_name);
            let version = if newer {
                release.tag_name.clone()
            } else {
                current.to_string()
            };
            (Some(version), newer)
        }
        None => (Some(current.to_string()), false),
    };

    VersionInfo {
        current_version: current.to_string(),
        latest_version,
        has_update,
        last_checked: Some(Utc::now()),
        consecutive_failures: 0,
    }
}

pub fn cache_file_path(tendril_home: &Path) -> PathBuf {
    tendril_home.join("cache").join("version_check.json")
}

/// Reads the cached `VersionInfo` without any network access. Returns the default value (not an
/// error) when the cache file is missing or fails to parse, so a corrupt cache never panics the
/// caller — it is simply treated as "never checked".
pub fn load_cache(tendril_home: &Path) -> VersionInfo {
    let path = cache_file_path(tendril_home);
    let Ok(content) = std::fs::read_to_string(&path) else {
        return VersionInfo::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

/// Atomically saves `info` to the disk cache (write to a temp file, then rename).
pub fn save_cache(tendril_home: &Path, info: &VersionInfo) -> Result<()> {
    let path = cache_file_path(tendril_home);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create cache directory {}", parent.display()))?;
    }

    let json = serde_json::to_string_pretty(info).context("failed to serialize version cache")?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, json)
        .with_context(|| format!("failed to write temp version cache at {}", tmp_path.display()))?;
    std::fs::rename(&tmp_path, &path)
        .with_context(|| format!("failed to finalize version cache at {}", path.display()))?;
    Ok(())
}

/// Runs one check: fetches the release list, compares against `current_version()`, and persists
/// the result. `Ok(info)` on success; `Err` on any network/parse failure, leaving the on-disk
/// cache untouched — the caller decides whether that's worth logging. Never panics.
pub async fn check_once(
    client: &reqwest::Client,
    tendril_home: &Path,
    include_prerelease: bool,
) -> Result<VersionInfo> {
    let response = client
        .get(RELEASES_URL)
        .header("User-Agent", format!("tendril/{}", current_version()))
        .send()
        .await
        .context("failed to reach the releases endpoint")?
        .error_for_status()
        .context("releases endpoint returned an error status")?;
    let body = response
        .text()
        .await
        .context("failed to read releases response body")?;
    let releases: Vec<Release> =
        serde_json::from_str(&body).context("failed to parse releases response")?;

    let info = evaluate(current_version(), &releases, include_prerelease);
    save_cache(tendril_home, &info)?;
    Ok(info)
}

/// A `reqwest::Client` tuned for the release check: short timeout, so an unreachable or slow
/// endpoint never holds up a background task pass.
pub fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_default()
}
