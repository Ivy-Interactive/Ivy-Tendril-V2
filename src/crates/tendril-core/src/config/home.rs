//! Finding the Tendril home directory, and refusing to let a test process claim the real one.

use super::env::{dirs_home_with_env, EnvSource, SystemEnv};
use super::paths::normalize_slashes;
use crate::error::{Result, TendrilError};
use std::path::{Path, PathBuf};

pub fn get_default_tendril_home_with_env(env: &impl EnvSource) -> PathBuf {
    if let Some(val) = env.get_var("TENDRIL_HOME") {
        let trimmed = val.trim().trim_matches('"');
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    if let Some(home) = dirs_home_with_env(env) {
        let pointer_file = home.join(".tendril_location");
        if pointer_file.is_file() {
            if let Ok(loc) = std::fs::read_to_string(&pointer_file) {
                let loc = loc.trim().trim_matches('"');
                if !loc.is_empty() {
                    let loc_path = PathBuf::from(loc);
                    if loc_path.join("config.yaml").exists() {
                        return loc_path;
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    {
        let d_tendril = PathBuf::from(r"D:\.tendril");
        if d_tendril.exists() {
            return d_tendril;
        }
        if let Some(home) = dirs_home_with_env(env) {
            let user_tendril = home.join(".tendril");
            if user_tendril.exists() {
                return user_tendril;
            }
        }
        // If D:\ drive root exists, use D:\.tendril, else user home .tendril
        if Path::new(r"D:\").exists() {
            return PathBuf::from(r"D:\.tendril");
        }
        if let Some(home) = dirs_home_with_env(env) {
            return home.join(".tendril");
        }
        PathBuf::from(r"D:\.tendril")
    }

    #[cfg(not(windows))]
    {
        if let Some(home) = dirs_home_with_env(env) {
            home.join(".tendril")
        } else {
            PathBuf::from("/tmp/.tendril")
        }
    }
}

pub fn get_default_tendril_home() -> PathBuf {
    get_default_tendril_home_with_env(&SystemEnv)
}

pub fn get_tendril_home_with_env(env: &impl EnvSource) -> PathBuf {
    get_default_tendril_home_with_env(env)
}

pub fn get_tendril_home() -> PathBuf {
    get_default_tendril_home()
}

/// The operator's real Tendril home, resolved as if `TENDRIL_HOME` were not set.
///
/// A test that pins `TENDRIL_HOME` to a temp directory still needs to know which path it must never
/// touch, so this deliberately ignores the variable that isolates it.
pub fn real_user_tendril_home() -> PathBuf {
    get_default_tendril_home_with_env(&|key: &str| {
        if key == "TENDRIL_HOME" {
            None
        } else {
            std::env::var(key).ok()
        }
    })
}

/// True when the current process looks like a test binary.
///
/// `TENDRIL_TEST_ISOLATION=1` is the explicit opt-in (the VS Code extension harness sets it for its
/// children); the `target/*/deps/` check covers cargo test binaries, so a harness added later cannot
/// silently opt out of [`ensure_not_real_home`].
pub fn in_test_context() -> bool {
    if std::env::var("TENDRIL_TEST_ISOLATION").as_deref() == Ok("1") {
        return true;
    }

    std::env::current_exe()
        .map(|p| p.components().any(|c| c.as_os_str() == "deps"))
        .unwrap_or(false)
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| -> String {
        let resolved = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
        let s = normalize_slashes(&resolved)
            .trim_end_matches('/')
            .to_string();
        if cfg!(windows) || cfg!(target_os = "macos") {
            s.to_lowercase()
        } else {
            s
        }
    };

    norm(a) == norm(b)
}

/// Refuses to claim the operator's real Tendril home from a test process.
///
/// Outside a test context this is a no-op, so production behaviour is unchanged.
pub fn ensure_not_real_home(home: &Path) -> Result<()> {
    if !in_test_context() {
        return Ok(());
    }

    let real = real_user_tendril_home();
    if paths_equal(home, &real) {
        return Err(TendrilError::Other(format!(
            "Refusing to use the real Tendril home {} from a test process: claiming mastership \
             there hijacks the operator's running daemon. Set TENDRIL_HOME to a temp directory for \
             this test.",
            real.display()
        )));
    }

    Ok(())
}
