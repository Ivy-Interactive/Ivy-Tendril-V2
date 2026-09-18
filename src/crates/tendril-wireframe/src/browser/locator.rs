//! Finds an installed Chromium-family browser to drive over CDP.
//!
//! Ported from V1's `Browser/BrowserLocator.cs`.
//!
//! Chrome is preferred over Edge because Chrome's headless is the reference implementation; Edge is
//! near-identical but adds enterprise-policy behaviour that is miserable to debug remotely. On
//! Windows, Edge is effectively guaranteed to be present, so the "nothing found" path is rare -- but
//! when it happens the error must list everything that was searched, or it becomes an unanswerable
//! support question.

use std::path::{Path, PathBuf};

use anyhow::{bail, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserInfo {
    pub path: PathBuf,
    pub name: String,
}

pub fn locate(explicit_path: Option<&Path>) -> Result<BrowserInfo> {
    let override_path = explicit_path.map(PathBuf::from).or_else(|| {
        std::env::var("WIREFRAME_BROWSER")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    });

    if let Some(path) = override_path {
        if path.is_file() {
            return Ok(BrowserInfo {
                path,
                name: "custom".to_string(),
            });
        }
        bail!("The browser path '{}' does not exist.", path.display());
    }

    let candidates = candidates();
    for (path, name) in &candidates {
        if path.is_file() {
            return Ok(BrowserInfo {
                path: path.clone(),
                name: name.to_string(),
            });
        }
    }

    let mut searched: Vec<String> = candidates
        .iter()
        .map(|(p, _)| p.display().to_string())
        .collect();
    searched.dedup();
    bail!(
        "No Chrome, Edge or Chromium installation was found. Searched:\n  {}\n\n\
         Pass --browser <path> or set WIREFRAME_BROWSER.",
        searched.join("\n  ")
    )
}

fn candidates() -> Vec<(PathBuf, &'static str)> {
    let mut out: Vec<(PathBuf, &'static str)> = Vec::new();

    #[cfg(windows)]
    {
        // Windows records browser locations under App Paths, which survives non-default install
        // directories.
        for (exe, name) in [("chrome.exe", "Chrome"), ("msedge.exe", "Edge")] {
            if let Some(path) = from_app_paths(exe) {
                out.push((path, name));
            }
        }

        let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
        let pf86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();

        out.push((
            Path::new(&pf).join(r"Google\Chrome\Application\chrome.exe"),
            "Chrome",
        ));
        out.push((
            Path::new(&pf86).join(r"Google\Chrome\Application\chrome.exe"),
            "Chrome",
        ));
        out.push((
            Path::new(&local).join(r"Google\Chrome\Application\chrome.exe"),
            "Chrome",
        ));
        out.push((
            Path::new(&pf86).join(r"Microsoft\Edge\Application\msedge.exe"),
            "Edge",
        ));
        out.push((
            Path::new(&pf).join(r"Microsoft\Edge\Application\msedge.exe"),
            "Edge",
        ));
    }

    #[cfg(target_os = "macos")]
    {
        let home = crate::project::home_dir().unwrap_or_default();
        out.push((
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            "Chrome",
        ));
        out.push((
            home.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            "Chrome",
        ));
        out.push((
            PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            "Chromium",
        ));
        out.push((
            PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            "Edge",
        ));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for name in [
            "google-chrome-stable",
            "google-chrome",
            "chromium",
            "chromium-browser",
            "microsoft-edge-stable",
            "microsoft-edge",
        ] {
            if let Some(path) = from_path(name) {
                out.push((path, name));
            }
        }
        out.push((PathBuf::from("/opt/google/chrome/chrome"), "Chrome"));
        out.push((PathBuf::from("/snap/bin/chromium"), "Chromium"));
        out.push((PathBuf::from("/usr/bin/chromium"), "Chromium"));
    }

    out
}

#[cfg(windows)]
fn from_app_paths(exe: &str) -> Option<PathBuf> {
    // `reg query` rather than a registry crate: this is the only registry read in the whole port,
    // and a dependency for one lookup that already has a fallback is not worth carrying.
    for root in ["HKCU", "HKLM"] {
        let output = std::process::Command::new("reg")
            .args([
                "query",
                &format!(r"{root}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}"),
                "/ve",
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            continue;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        // The default value line reads: `    (Default)    REG_SZ    C:\path\to\chrome.exe`
        if let Some(line) = text.lines().find(|l| l.contains("REG_SZ")) {
            if let Some(value) = line.split("REG_SZ").nth(1) {
                let path = PathBuf::from(value.trim());
                if path.is_file() {
                    return Some(path);
                }
            }
        }
    }
    None
}

#[cfg(all(unix, not(target_os = "macos")))]
fn from_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_path_that_exists_wins() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let found = locate(Some(file.path())).unwrap();
        assert_eq!(found.path, file.path());
        assert_eq!(found.name, "custom");
    }

    #[test]
    fn an_explicit_path_that_does_not_exist_says_so_rather_than_falling_back() {
        // Silently falling back to an installed Chrome would be worse: the caller asked for a
        // specific binary, probably to reproduce something.
        let err = locate(Some(Path::new("/no/such/browser")))
            .unwrap_err()
            .to_string();
        assert!(err.contains("/no/such/browser"), "got {err}");
        assert!(err.contains("does not exist"), "got {err}");
    }

    #[test]
    fn the_environment_override_is_honoured() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::env::set_var("WIREFRAME_BROWSER", file.path());
        let found = locate(None).unwrap();
        std::env::remove_var("WIREFRAME_BROWSER");
        assert_eq!(found.path, file.path());
    }

    #[test]
    fn the_candidate_list_is_not_empty_on_this_platform() {
        // A platform with no candidates at all would fail with an error listing nothing, which is
        // the unanswerable support question V1's comment warns about.
        assert!(!candidates().is_empty());
    }

    #[test]
    fn a_failure_lists_everything_it_searched() {
        // Only meaningful where no browser is installed; where one is, locate() succeeds and there
        // is nothing to assert about the message.
        std::env::remove_var("WIREFRAME_BROWSER");
        match locate(None) {
            Ok(found) => assert!(found.path.is_file()),
            Err(e) => {
                let message = e.to_string();
                assert!(message.contains("Searched:"), "got {message}");
                assert!(message.contains("WIREFRAME_BROWSER"), "got {message}");
            }
        }
    }
}
