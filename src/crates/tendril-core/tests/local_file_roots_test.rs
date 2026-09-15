//! Root confinement for `GET /ivy/local-file`. Every rejection asserted here is a request that
//! would otherwise be an arbitrary file read, so these tests are the endpoint's actual security
//! boundary rather than a description of it.
//!
//! Fixture roots are canonicalized through `resolve_real_path` before being handed to
//! `try_resolve`, because `std::env::temp_dir()` on macOS lives under `/var`, which is itself a
//! symlink to `/private/var`. A raw temp path used directly as a containment root would never match
//! a fully resolved request path — that is a property of the fixture, not of the policy, and
//! `compute_roots` handles it in production (see `test_symlinked_root_is_matched_via_compute_roots`).

use std::path::{Path, PathBuf};

use tendril_core::config::{SecuritySettings, TendrilSettings};
use tendril_core::models::{ProjectConfig, RepoRef};
use tendril_core::security::local_file_roots::{compute_roots, resolve_real_path, try_resolve};

/// A fresh directory under the temp dir. Returned raw (not resolved) — callers decide which form
/// they need.
fn temp_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tendril-local-file-{label}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).expect("failed to create fixture dir");
    dir
}

/// The fixture root as the production `compute_roots` would have recorded it.
fn resolved(path: &Path) -> PathBuf {
    resolve_real_path(path).expect("fixture path resolves")
}

fn write_file(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("failed to create parent dir");
    }
    std::fs::write(path, contents).expect("failed to write fixture file");
}

fn as_str(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[test]
fn test_path_traversal_is_rejected() {
    let root = temp_dir("traversal");
    let roots = vec![resolved(&root)];
    let root_str = as_str(&resolved(&root));

    // Escapes that a lexical `..` collapse alone would let through.
    assert_eq!(
        try_resolve(&format!("{root_str}/../../etc/passwd"), &roots),
        None
    );
    assert_eq!(
        try_resolve(&format!("{root_str}/Plans/../../../../etc/passwd"), &roots),
        None
    );
    // A `..` that happens to stay inside the root is refused too: a traversal attempt is never a
    // legitimate request, so it never reaches the containment check.
    write_file(&resolved(&root).join("sub/ok.png"), "png");
    assert_eq!(
        try_resolve(&format!("{root_str}/sub/../sub/ok.png"), &roots),
        None
    );

    // A plain absolute path with no root in sight.
    assert_eq!(try_resolve("/etc/passwd", &roots), None);
    assert_eq!(try_resolve("/etc/shadow", &roots), None);

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn test_windows_shaped_and_null_byte_paths_are_rejected() {
    let root = temp_dir("shapes");
    let roots = vec![resolved(&root)];
    let root_str = as_str(&resolved(&root));

    // NT-style device paths.
    assert_eq!(try_resolve(r"\\?\C:\Windows\win.ini", &roots), None);
    assert_eq!(try_resolve(r"\\.\C:\Windows\win.ini", &roots), None);
    // UNC share.
    assert_eq!(try_resolve(r"\\attacker\share\payload.png", &roots), None);
    assert_eq!(try_resolve("//attacker/share/payload.png", &roots), None);
    // Null byte, both as a truncation attempt and buried mid-path.
    assert_eq!(
        try_resolve(&format!("{root_str}/ok.png\0.txt"), &roots),
        None
    );
    assert_eq!(try_resolve("/etc/pass\0wd", &roots), None);
    // Nothing at all.
    assert_eq!(try_resolve("", &roots), None);

    let _ = std::fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[test]
fn test_symlink_escape_is_rejected() {
    use std::os::unix::fs::symlink;

    let root = temp_dir("symlink-root");
    let outside = temp_dir("symlink-outside");
    let roots = vec![resolved(&root)];

    let secret = resolved(&outside).join("secret.png");
    write_file(&secret, "secret");

    // Final component is a symlink out of the root.
    let final_link = resolved(&root).join("escape.png");
    symlink(&secret, &final_link).expect("symlink created");
    assert_eq!(try_resolve(&as_str(&final_link), &roots), None);

    // Mid-path directory symlink out of the root — the case a "resolve the last component only"
    // check misses entirely.
    let dir_link = resolved(&root).join("images");
    symlink(resolved(&outside), &dir_link).expect("dir symlink created");
    assert_eq!(
        try_resolve(&as_str(&dir_link.join("secret.png")), &roots),
        None
    );

    // A symlink that stays inside the root is still served.
    let inside_target = resolved(&root).join("real.png");
    write_file(&inside_target, "png");
    let inside_link = resolved(&root).join("alias.png");
    symlink(&inside_target, &inside_link).expect("inside symlink created");
    assert_eq!(
        try_resolve(&as_str(&inside_link), &roots),
        Some(inside_link.clone()),
        "a link that resolves inside the root is contained and must be served"
    );

    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&outside);
}

/// A symlink cycle must be refused, not fall back to the unresolved (still contained-looking) path.
#[cfg(unix)]
#[test]
fn test_symlink_cycle_is_rejected() {
    use std::os::unix::fs::symlink;

    let root = temp_dir("symlink-cycle");
    let roots = vec![resolved(&root)];

    let a = resolved(&root).join("a.png");
    let b = resolved(&root).join("b.png");
    symlink(&b, &a).expect("symlink a -> b");
    symlink(&a, &b).expect("symlink b -> a");

    assert_eq!(resolve_real_path(&a), None);
    assert_eq!(try_resolve(&as_str(&a), &roots), None);

    let _ = std::fs::remove_dir_all(&root);
}

/// Fail closed: with no roots configured nothing is servable, including a file that plainly exists.
#[test]
fn test_empty_roots_deny_everything() {
    let root = temp_dir("empty-roots");
    let file = resolved(&root).join("ok.png");
    write_file(&file, "png");

    assert_eq!(try_resolve(&as_str(&file), &[]), None);
    assert_eq!(try_resolve("/etc/passwd", &[]), None);

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn test_file_inside_a_root_is_served() {
    let root = temp_dir("inside");
    let roots = vec![resolved(&root)];

    let nested = resolved(&root).join("Plans/00001/Artifacts/shot.png");
    write_file(&nested, "png");
    assert_eq!(try_resolve(&as_str(&nested), &roots), Some(nested.clone()));

    // The root directory itself is contained.
    assert_eq!(
        try_resolve(&as_str(&resolved(&root)), &roots),
        Some(resolved(&root))
    );

    // Case differences in the request do not defeat containment (the original compares
    // case-insensitively, and macOS's default filesystem is case-insensitive too).
    let upper = as_str(&resolved(&root)).to_uppercase();
    assert!(try_resolve(&format!("{upper}/Plans/00001/Artifacts/shot.png"), &roots).is_some());

    // A sibling directory whose name merely starts with the root's name is not inside it.
    let sibling = PathBuf::from(format!("{}-evil", as_str(&resolved(&root))));
    write_file(&sibling.join("shot.png"), "png");
    assert_eq!(
        try_resolve(&as_str(&sibling.join("shot.png")), &roots),
        None
    );

    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&sibling);
}

/// A path that does not exist yet still resolves, so the endpoint can answer 404 for a deleted
/// screenshot instead of failing containment for an unrelated reason.
#[test]
fn test_missing_file_inside_a_root_still_resolves() {
    let root = temp_dir("missing");
    let roots = vec![resolved(&root)];

    let missing = resolved(&root).join("Plans/00002/Artifacts/gone.png");
    assert!(!missing.exists());
    assert_eq!(
        try_resolve(&as_str(&missing), &roots),
        Some(missing.clone())
    );

    // Still confined: a missing path outside every root is refused.
    assert_eq!(try_resolve("/etc/definitely-not-here.png", &roots), None);

    let _ = std::fs::remove_dir_all(&root);
}

/// The regression `compute_roots` exists to prevent: a root that is itself reached through a
/// symlink (macOS `/var -> /private/var`) must still match requests, because both the expanded and
/// the resolved form are recorded.
#[test]
fn test_symlinked_root_is_matched_via_compute_roots() {
    let raw_root = temp_dir("symlinked-root");
    let file = resolved(&raw_root).join("shot.png");
    write_file(&file, "png");

    let settings = TendrilSettings {
        security: Some(SecuritySettings {
            local_file_roots: Some(vec![as_str(&raw_root)]),
            ..SecuritySettings::default()
        }),
        ..TendrilSettings::default()
    };
    let roots = compute_roots(
        &settings,
        Path::new("/nonexistent-home"),
        Path::new("/nonexistent-home/Plans"),
    );

    // Requested through the raw (symlinked) path, exactly as the UI would send it.
    let requested = raw_root.join("shot.png");
    assert_eq!(
        try_resolve(&as_str(&requested), &roots),
        Some(requested.clone())
    );
    // And through the resolved path.
    assert_eq!(try_resolve(&as_str(&file), &roots), Some(file.clone()));

    let _ = std::fs::remove_dir_all(&raw_root);
}

#[test]
fn test_compute_roots_covers_home_plans_projects_and_extras() {
    let home = "/tendril-home-fixture";
    let settings = TendrilSettings {
        projects: vec![
            ProjectConfig {
                name: "Alpha".to_string(),
                repos: vec![
                    RepoRef {
                        path: "/repos/alpha".to_string(),
                        base_branch: None,
                        extra: Default::default(),
                    },
                    // Trailing separator and a duplicate must collapse.
                    RepoRef {
                        path: "/repos/alpha/".to_string(),
                        base_branch: None,
                        extra: Default::default(),
                    },
                ],
                ..ProjectConfig::default()
            },
            ProjectConfig {
                name: "Beta".to_string(),
                repos: vec![RepoRef {
                    path: "/repos/beta".to_string(),
                    base_branch: None,
                    extra: Default::default(),
                }],
                ..ProjectConfig::default()
            },
        ],
        security: Some(SecuritySettings {
            local_file_roots: Some(vec![
                "%TENDRIL_HOME%/Shared".to_string(),
                "   ".to_string(),
                "/repos/beta".to_string(),
            ]),
            ..SecuritySettings::default()
        }),
        ..TendrilSettings::default()
    };

    let roots = compute_roots(
        &settings,
        Path::new(home),
        Path::new("/tendril-home-fixture/Plans"),
    );
    let keys: Vec<String> = roots.iter().map(|r| as_str(r)).collect();

    assert!(keys.contains(&home.to_string()), "roots: {keys:?}");
    assert!(keys.contains(&"/tendril-home-fixture/Plans".to_string()));
    assert!(keys.contains(&"/repos/alpha".to_string()));
    assert!(keys.contains(&"/repos/beta".to_string()));
    assert!(
        keys.contains(&"/tendril-home-fixture/Shared".to_string()),
        "%TENDRIL_HOME% must be expanded: {keys:?}"
    );
    // Blank entries dropped, duplicates (including the trailing-slash variant) collapsed.
    assert!(!keys.iter().any(|k| k.trim().is_empty()));
    assert_eq!(
        keys.iter().filter(|k| *k == "/repos/alpha").count(),
        1,
        "roots: {keys:?}"
    );
    assert_eq!(keys.iter().filter(|k| *k == "/repos/beta").count(), 1);
}

/// Nothing is servable from a default install's roots that sits outside them, and a relative path
/// (which `absolutize` resolves against the process working directory) cannot smuggle its way in.
#[test]
fn test_relative_paths_are_not_servable_from_an_unrelated_root() {
    let root = temp_dir("relative");
    let roots = vec![resolved(&root)];

    assert_eq!(try_resolve("etc/passwd", &roots), None);
    assert_eq!(try_resolve("../../../etc/passwd", &roots), None);
    assert_eq!(try_resolve("./shot.png", &roots), None);

    let _ = std::fs::remove_dir_all(&root);
}
