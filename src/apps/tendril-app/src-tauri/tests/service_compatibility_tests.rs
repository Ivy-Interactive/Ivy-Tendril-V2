use std::fs::File;
use std::io::Write;
use tendril_app_lib::service::compatibility::{SemVer, ServiceCompatibilityManager};

#[test]
fn test_semver_parsing() {
    let v1 = SemVer::parse("0.1.0").expect("simple semver");
    assert_eq!(v1.major, 0);
    assert_eq!(v1.minor, 1);
    assert_eq!(v1.patch, 0);
    assert!(v1.pre_release.is_none());

    let v2 = SemVer::parse("tendril 1.2.3 (commit-abcdef)").expect("cli version output");
    assert_eq!(v2.major, 1);
    assert_eq!(v2.minor, 2);
    assert_eq!(v2.patch, 3);

    let v3 = SemVer::parse("v2.0.4-rc.1").expect("pre-release");
    assert_eq!(v3.major, 2);
    assert_eq!(v3.minor, 0);
    assert_eq!(v3.patch, 4);
    assert_eq!(v3.pre_release.as_deref(), Some("rc.1"));
}

#[test]
fn test_semver_matching_compatible_older_and_newer_incompatible() {
    let mgr = ServiceCompatibilityManager::new(0, 1, 0);

    // Exact match
    let res1 = mgr.check_version_compatibility("0.1.0");
    assert!(res1.is_compatible);

    // Minor update within same major is compatible
    let res2 = mgr.check_version_compatibility("0.2.0");
    assert!(res2.is_compatible);

    // Older patch/minor is incompatible
    let mgr_strict = ServiceCompatibilityManager::new(0, 2, 0);
    let res3 = mgr_strict.check_version_compatibility("0.1.9");
    assert!(!res3.is_compatible);
    assert!(res3.diagnostic.contains("older than required minimum"));

    // Major mismatch is incompatible
    let res4 = mgr.check_version_compatibility("1.0.0");
    assert!(!res4.is_compatible);
    assert!(res4.diagnostic.contains("Incompatible major version"));

    let res5 = mgr.check_version_compatibility("0.0.9");
    assert!(!res5.is_compatible);
}

#[test]
fn test_corrupted_or_truncated_binary_detection() {
    let mgr = ServiceCompatibilityManager::new(0, 1, 0);
    let temp_dir = tempfile::tempdir().expect("temp dir");

    // Missing binary
    let missing_path = temp_dir.path().join("nonexistent_binary");
    let res_missing = mgr.check_binary_health(&missing_path);
    assert!(!res_missing.is_compatible);
    assert!(res_missing.diagnostic.contains("not found"));

    // Corrupted / 0-byte truncated binary
    let empty_path = temp_dir.path().join("empty_tendril");
    File::create(&empty_path).expect("create empty file");
    let res_empty = mgr.check_binary_health(&empty_path);
    assert!(!res_empty.is_compatible);
    assert!(res_empty.diagnostic.contains("empty or truncated"));

    // Valid mock executable script
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let script_path = temp_dir.path().join("mock_tendril");
        let mut script = File::create(&script_path).expect("create script");
        writeln!(script, "#!/bin/sh\necho 'tendril 0.1.5'").expect("write script");
        let mut perms = script.metadata().expect("meta").permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script_path, perms).expect("chmod");
        // Closed before the exec below, not left to the end of the block: Linux refuses to execute a
        // file any process still holds open for writing (`ETXTBSY`), so on CI the spawn failed and
        // `check_binary_health` reported the mock as unhealthy. macOS has no such rule, which is why
        // this only ever failed once the Rust steps started running on the Linux runner.
        drop(script);

        let res_valid = mgr.check_binary_health(&script_path);
        assert!(res_valid.is_compatible);
        assert_eq!(
            res_valid.detected_version.as_deref(),
            Some("tendril 0.1.5\n")
        );
    }
}
