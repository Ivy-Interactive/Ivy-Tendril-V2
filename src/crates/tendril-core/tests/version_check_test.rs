use std::path::PathBuf;
use std::time::Duration;
use tendril_core::version_check::{
    self, evaluate, is_newer, parse_semver, select_release, Release, VersionInfo,
};

struct TempDir(PathBuf);

impl TempDir {
    fn new(prefix: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("{}-{}", prefix, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &PathBuf {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn release(tag: &str, prerelease: bool) -> Release {
    Release {
        tag_name: tag.to_string(),
        prerelease,
    }
}

#[test]
fn parse_semver_accepts_tag_v_and_bare_forms() {
    assert_eq!(parse_semver("cli-v1.2.3"), Some((1, 2, 3)));
    assert_eq!(parse_semver("v1.2.3"), Some((1, 2, 3)));
    assert_eq!(parse_semver("1.2.3"), Some((1, 2, 3)));
}

#[test]
fn parse_semver_rejects_malformed() {
    assert_eq!(parse_semver(""), None);
    assert_eq!(parse_semver("1.2"), None);
    assert_eq!(parse_semver("1.2.3.4"), None);
    assert_eq!(parse_semver("1.2.x"), None);
    assert_eq!(parse_semver("abc"), None);
    assert_eq!(parse_semver("v-"), None);
    assert_eq!(parse_semver("cli-v"), None);
}

#[test]
fn is_newer_true_for_newer() {
    assert!(is_newer("1.2.3", "1.3.0"));
    assert!(is_newer("1.2.3", "2.0.0"));
}

#[test]
fn is_newer_false_for_older_and_equal() {
    assert!(!is_newer("1.3.0", "1.2.3"));
    assert!(!is_newer("1.2.3", "1.2.3"));
}

#[test]
fn is_newer_false_for_malformed_either_side() {
    assert!(!is_newer("abc", "1.2.3"));
    assert!(!is_newer("1.2.3", "abc"));
    assert!(!is_newer("abc", "def"));
}

#[test]
fn parse_semver_uses_prerelease_core() {
    assert_eq!(parse_semver("cli-v0.3.0-beta.1"), Some((0, 3, 0)));
    assert!(!is_newer("0.3.0", "cli-v0.3.0-beta.1"));
}

#[test]
fn select_release_excludes_prereleases_by_default() {
    let releases = vec![
        release("cli-v1.0.0", false),
        release("cli-v1.1.0-beta", true),
    ];

    let stable_only = select_release(&releases, false).expect("a stable release exists");
    assert_eq!(stable_only.tag_name, "cli-v1.0.0");

    let with_prerelease = select_release(&releases, true).expect("some release exists");
    assert_eq!(with_prerelease.tag_name, "cli-v1.1.0-beta");
}

#[test]
fn select_release_ignores_non_cli_tags() {
    let releases = vec![release("app-v9.0.0", false), release("cli-v0.2.0", false)];
    let selected = select_release(&releases, false).expect("cli release exists");
    assert_eq!(selected.tag_name, "cli-v0.2.0");
}

#[test]
fn select_release_on_empty_feed_is_none() {
    assert!(select_release(&[], false).is_none());
    assert!(select_release(&[], true).is_none());
}

#[test]
fn evaluate_up_to_date_reports_current_not_null() {
    let releases = vec![release("cli-v1.0.0", false)];
    let info = evaluate("1.0.0", &releases, false);
    assert_eq!(info.latest_version, Some("1.0.0".to_string()));
    assert!(!info.has_update);
}

#[test]
fn cache_roundtrip() {
    let dir = TempDir::new("tendril-version-cache-test");
    let info = VersionInfo {
        current_version: "1.0.0".to_string(),
        latest_version: Some("cli-v1.1.0".to_string()),
        has_update: true,
        last_checked: Some(chrono::Utc::now()),
        consecutive_failures: 0,
    };

    version_check::save_cache(dir.path(), &info).expect("save cache");
    let loaded = version_check::load_cache(dir.path());
    assert_eq!(loaded.current_version, info.current_version);
    assert_eq!(loaded.latest_version, info.latest_version);
    assert_eq!(loaded.has_update, info.has_update);

    let missing_dir = TempDir::new("tendril-version-cache-missing-test");
    let default_info = version_check::load_cache(missing_dir.path());
    assert_eq!(default_info, VersionInfo::default());
}

#[test]
fn load_cache_on_corrupt_file_returns_default() {
    let dir = TempDir::new("tendril-version-cache-corrupt-test");
    let path = version_check::cache_file_path(dir.path());
    std::fs::create_dir_all(path.parent().unwrap()).expect("create cache dir");
    std::fs::write(&path, "not json").expect("write corrupt cache");

    let loaded = version_check::load_cache(dir.path());
    assert_eq!(loaded, VersionInfo::default());
}

#[tokio::test]
async fn check_once_against_unreachable_host_is_err_and_leaves_cache_intact() {
    let dir = TempDir::new("tendril-version-cache-unreachable-test");

    let seeded = VersionInfo {
        current_version: "1.0.0".to_string(),
        latest_version: Some("1.0.0".to_string()),
        has_update: false,
        last_checked: Some(chrono::Utc::now()),
        consecutive_failures: 0,
    };
    version_check::save_cache(dir.path(), &seeded).expect("seed cache");
    let path = version_check::cache_file_path(dir.path());
    let before = std::fs::read_to_string(&path).expect("read seeded cache");

    // A closed local port: bind then drop, so the port is free but nothing answers on it,
    // guaranteeing connection-refused rather than a real network dependency in the test.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    let closed_port = listener.local_addr().expect("local addr").port();
    drop(listener);

    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{closed_port}")).expect("proxy url"))
        .timeout(Duration::from_secs(2))
        .build()
        .expect("build client");

    let result = version_check::check_once(&client, dir.path(), false).await;
    assert!(result.is_err());

    let after = std::fs::read_to_string(&path).expect("read cache after failed check");
    assert_eq!(before, after, "cache must be untouched on a failed check");

    let cache_dir = dir.path().join("cache");
    let entries: Vec<_> = std::fs::read_dir(&cache_dir)
        .expect("read cache dir")
        .collect();
    assert_eq!(
        entries.len(),
        1,
        "no stray files should appear in the cache dir"
    );
}
