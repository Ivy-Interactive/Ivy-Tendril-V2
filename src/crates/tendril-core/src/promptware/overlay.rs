//! Resolution of the *overlay* promptware layer.
//!
//! A team that wants its own `Program.md` for a promptware — or a promptware the shipped tree does
//! not carry at all — points `promptwareOverlay` at a directory laid out exactly like
//! `src/promptwares`. Deployment then applies the shipped layer first and the overlay on top, so the
//! overlay wins per file. See [`crate::promptware::deployer::deploy_promptwares`].
//!
//! Resolution is deliberately forgiving: a configured-but-missing root yields `None` rather than an
//! error, so a stale path degrades to shipped-only instead of bricking deployment. `tendril doctor`
//! is what tells the user about it.

use crate::config::{expand_variables_with_env, EnvSource, SystemEnv, TendrilSettings};
use std::path::{Path, PathBuf};

/// Environment override for the overlay root. Wins over `promptwareOverlay` in `config.yaml` so CI
/// and tests can point at a scratch tree without editing the user's config.
pub const OVERLAY_ENV_VAR: &str = "TENDRIL_PROMPTWARE_OVERLAY";

/// The file at the overlay root holding the team's revision string, e.g. `1.0.45`.
pub const VERSION_FILE: &str = ".version";

/// An overlay root that exists on disk, plus the revision string it stamps itself with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverlayLayer {
    pub root: PathBuf,
    /// `<root>/.version`, trimmed. `None` when the file is absent or blank.
    pub version: Option<String>,
}

/// The configured overlay root, expanded and resolved, **without** checking that it exists.
///
/// Kept separate from [`resolve_overlay`] so `doctor` can tell "not configured" (this returns `None`)
/// apart from "configured but missing" (this returns `Some`, `resolve_overlay` returns `None`).
pub fn configured_overlay_root(tendril_home: &Path, settings: &TendrilSettings) -> Option<PathBuf> {
    configured_overlay_root_with_env(tendril_home, settings, &SystemEnv)
}

/// [`configured_overlay_root`] with the environment injected, so tests never touch process-wide env
/// that sibling threads read.
pub fn configured_overlay_root_with_env(
    tendril_home: &Path,
    settings: &TendrilSettings,
    env: &impl EnvSource,
) -> Option<PathBuf> {
    let home = tendril_home.to_string_lossy().to_string();

    let raw = non_blank(env.get_var(OVERLAY_ENV_VAR))
        .or_else(|| non_blank(settings.promptware_overlay.clone()))?;

    let expanded = expand_variables_with_env(&raw, &home, env);
    let path = PathBuf::from(expanded.trim());

    // A relative overlay path is relative to TENDRIL_HOME, not to the process CWD — the daemon, the
    // CLI and the app all run from different directories.
    Some(if path.is_absolute() {
        path
    } else {
        tendril_home.join(path)
    })
}

/// The overlay layer to deploy, or `None` when none is configured or the configured root is absent.
pub fn resolve_overlay(tendril_home: &Path, settings: &TendrilSettings) -> Option<OverlayLayer> {
    resolve_overlay_with_env(tendril_home, settings, &SystemEnv)
}

/// [`resolve_overlay`] with the environment injected.
pub fn resolve_overlay_with_env(
    tendril_home: &Path,
    settings: &TendrilSettings,
    env: &impl EnvSource,
) -> Option<OverlayLayer> {
    let root = configured_overlay_root_with_env(tendril_home, settings, env)?;
    if !root.is_dir() {
        return None;
    }
    Some(OverlayLayer {
        version: read_version(&root),
        root,
    })
}

/// Reads `<dir>/.version`, trimmed. `None` when absent, unreadable or blank.
pub fn read_version(dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(dir.join(VERSION_FILE)).ok()?;
    non_blank(Some(raw))
}

/// Promptware names the overlay supplies: immediate subdirectories holding a `Program.md`, sorted.
///
/// Requiring `Program.md` is what keeps a stray scratch directory next to the real ones from being
/// deployed as an empty promptware.
pub fn overlay_promptware_names(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };

    let mut names = Vec::new();
    for entry in entries.flatten() {
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => {}
            _ => continue,
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip dotted directories so `.git` is never mistaken for a promptware.
        if name.starts_with('.') {
            continue;
        }
        if entry.path().join("Program.md").is_file() {
            names.push(name);
        }
    }
    names.sort();
    names
}

/// Trims, and maps an empty or whitespace-only value to `None`: an empty setting counts as unset.
fn non_blank(value: Option<String>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Fixture {
        root: PathBuf,
        home: PathBuf,
        overlay: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("tendril-overlay-{}", uuid::Uuid::new_v4().simple()));
            let home = root.join("home");
            let overlay = root.join("team").join("Promptwares");
            std::fs::create_dir_all(&home).unwrap();
            std::fs::create_dir_all(overlay.join("CreatePlan")).unwrap();
            std::fs::write(overlay.join("CreatePlan").join("Program.md"), "team plan").unwrap();
            Fixture {
                root,
                home,
                overlay,
            }
        }

        fn settings(&self, overlay: Option<&str>) -> TendrilSettings {
            TendrilSettings {
                promptware_overlay: overlay.map(|s| s.to_string()),
                ..Default::default()
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn overlay_resolution_none_when_unconfigured() {
        let fx = Fixture::new();
        let settings = fx.settings(None);

        assert_eq!(
            configured_overlay_root_with_env(&fx.home, &settings, &env(&[])),
            None
        );
        assert_eq!(resolve_overlay_with_env(&fx.home, &settings, &env(&[])), None);
    }

    #[test]
    fn overlay_resolution_treats_a_blank_setting_as_unset() {
        let fx = Fixture::new();
        let settings = fx.settings(Some("   "));

        assert_eq!(
            configured_overlay_root_with_env(&fx.home, &settings, &env(&[])),
            None
        );
        // A blank env value must not shadow a real config value either.
        let configured = fx.settings(Some(&fx.overlay.to_string_lossy()));
        let resolved = resolve_overlay_with_env(
            &fx.home,
            &configured,
            &env(&[(OVERLAY_ENV_VAR, "  ")]),
        );
        assert_eq!(resolved.map(|o| o.root), Some(fx.overlay.clone()));
    }

    #[test]
    fn overlay_resolution_prefers_env_over_config() {
        let fx = Fixture::new();
        let other = fx.root.join("other");
        std::fs::create_dir_all(&other).unwrap();
        let settings = fx.settings(Some(&other.to_string_lossy()));

        let resolved = resolve_overlay_with_env(
            &fx.home,
            &settings,
            &env(&[(OVERLAY_ENV_VAR, &fx.overlay.to_string_lossy())]),
        )
        .expect("env overlay resolves");

        assert_eq!(resolved.root, fx.overlay);
    }

    #[test]
    fn overlay_resolution_expands_tendril_home() {
        let fx = Fixture::new();
        std::fs::create_dir_all(fx.home.join("Overlay")).unwrap();
        let settings = fx.settings(Some("%TENDRIL_HOME%/Overlay"));

        let resolved = resolve_overlay_with_env(&fx.home, &settings, &env(&[]))
            .expect("expanded overlay resolves");

        assert_eq!(resolved.root, fx.home.join("Overlay"));
    }

    #[test]
    fn overlay_resolution_resolves_a_relative_path_against_tendril_home() {
        let fx = Fixture::new();
        std::fs::create_dir_all(fx.home.join("Overlay")).unwrap();
        let settings = fx.settings(Some("Overlay"));

        let resolved = resolve_overlay_with_env(&fx.home, &settings, &env(&[]))
            .expect("relative overlay resolves");

        assert_eq!(resolved.root, fx.home.join("Overlay"));
    }

    #[test]
    fn overlay_resolution_none_when_path_missing() {
        let fx = Fixture::new();
        let missing = fx.root.join("nope");
        let settings = fx.settings(Some(&missing.to_string_lossy()));

        // Configured — so `doctor` can warn — but not resolvable, so deployment stays shipped-only.
        assert_eq!(
            configured_overlay_root_with_env(&fx.home, &settings, &env(&[])),
            Some(missing)
        );
        assert_eq!(resolve_overlay_with_env(&fx.home, &settings, &env(&[])), None);
    }

    #[test]
    fn overlay_version_is_read_and_trimmed() {
        let fx = Fixture::new();
        std::fs::write(fx.overlay.join(VERSION_FILE), "1.0.45\n").unwrap();
        let settings = fx.settings(Some(&fx.overlay.to_string_lossy()));

        let resolved = resolve_overlay_with_env(&fx.home, &settings, &env(&[])).unwrap();

        assert_eq!(resolved.version.as_deref(), Some("1.0.45"));
    }

    #[test]
    fn overlay_version_is_none_when_absent_or_blank() {
        let fx = Fixture::new();
        assert_eq!(read_version(&fx.overlay), None);

        std::fs::write(fx.overlay.join(VERSION_FILE), "\n  \n").unwrap();
        assert_eq!(read_version(&fx.overlay), None);
    }

    #[test]
    fn overlay_promptware_names_requires_a_program_and_skips_dotted() {
        let fx = Fixture::new();
        std::fs::create_dir_all(fx.overlay.join("IvyFrameworkVerification")).unwrap();
        std::fs::write(
            fx.overlay.join("IvyFrameworkVerification").join("Program.md"),
            "verify",
        )
        .unwrap();
        // No Program.md — a scratch directory, not a promptware.
        std::fs::create_dir_all(fx.overlay.join("Scratch")).unwrap();
        std::fs::create_dir_all(fx.overlay.join(".git")).unwrap();
        std::fs::write(fx.overlay.join("AGENTS.md"), "not a promptware").unwrap();

        assert_eq!(
            overlay_promptware_names(&fx.overlay),
            vec![
                "CreatePlan".to_string(),
                "IvyFrameworkVerification".to_string()
            ]
        );
    }

    #[test]
    fn overlay_promptware_names_is_empty_for_a_missing_root() {
        let fx = Fixture::new();
        assert!(overlay_promptware_names(&fx.root.join("nope")).is_empty());
    }
}
