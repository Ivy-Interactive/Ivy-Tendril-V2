//! Launches a headless browser with remote debugging and cleans up after it.
//!
//! Ported from V1's `Browser/BrowserProcess.cs`.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use tokio::io::AsyncReadExt as _;
use tokio::process::{Child, Command};

use crate::browser::locator::{self, BrowserInfo};

pub struct BrowserProcess {
    child: Option<Child>,
    user_data_dir: Option<PathBuf>,
    pub web_socket_url: String,
    pub info: BrowserInfo,
}

/// Flags chosen for determinism as much as for headlessness -- see `screenshot::determinism` for the
/// rest of the story. The rendering flags pin Skia so repeated runs on one machine are byte-identical.
fn flags(user_data_dir: &std::path::Path) -> Vec<String> {
    vec![
        "--headless=new".into(),
        "--remote-debugging-port=0".into(),
        format!("--user-data-dir={}", user_data_dir.display()),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--no-pings".into(),
        "--mute-audio".into(),
        "--disable-extensions".into(),
        "--disable-component-extension-with-background-pages".into(),
        "--disable-background-networking".into(),
        "--disable-sync".into(),
        "--disable-default-apps".into(),
        "--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints"
            .into(),
        "--metrics-recording-only".into(),
        "--disable-dev-shm-usage".into(),
        // An overflowing page otherwise shifts content ~15px left behind a scrollbar.
        "--hide-scrollbars".into(),
        // Pin rasterization: SketchProvider mounts feTurbulence/feDisplacementMap filters, and GPU
        // vs CPU Skia produce slightly different pixels for SVG filters.
        "--disable-gpu".into(),
        "--force-color-profile=srgb".into(),
        "--disable-lcd-text".into(),
        "--font-render-hinting=none".into(),
        "about:blank".into(),
    ]
}

impl BrowserProcess {
    pub async fn launch(browser_path: Option<&std::path::Path>) -> Result<Self> {
        let info = locator::locate(browser_path)?;

        // A fresh profile is NOT optional. Without it Chrome may hand the command off to an
        // already-running instance, exit 0 immediately, and never write DevToolsActivePort -- which
        // presents as a baffling "the browser exited successfully" hang.
        let user_data_dir = std::env::temp_dir().join(format!(
            "wireframe-cdp-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or_default()
        ));
        std::fs::create_dir_all(&user_data_dir)
            .with_context(|| format!("Creating {}", user_data_dir.display()))?;

        let mut child = Command::new(&info.path)
            .args(flags(&user_data_dir))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("Could not start {}.", info.name))?;

        // Drain the pipes so a full buffer cannot stall the browser.
        if let Some(mut stdout) = child.stdout.take() {
            tokio::spawn(async move {
                let mut sink = Vec::new();
                let _ = stdout.read_to_end(&mut sink).await;
            });
        }
        if let Some(mut stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut sink = Vec::new();
                let _ = stderr.read_to_end(&mut sink).await;
            });
        }

        let mut browser = Self {
            child: Some(child),
            user_data_dir: Some(user_data_dir),
            web_socket_url: String::new(),
            info,
        };
        browser.web_socket_url = browser.read_devtools_url().await?;
        Ok(browser)
    }

    /// Reads the endpoint from `<user-data-dir>/DevToolsActivePort`, which is the documented
    /// contract. Scraping "DevTools listening on ws://..." from stderr is unreliable as a primary
    /// source because of buffering and Edge's occasional suppression of it.
    async fn read_devtools_url(&mut self) -> Result<String> {
        let port_file = self
            .user_data_dir
            .as_ref()
            .expect("launch sets the profile dir")
            .join("DevToolsActivePort");
        let deadline = Instant::now() + Duration::from_secs(30);

        while Instant::now() < deadline {
            if let Some(child) = self.child.as_mut() {
                if let Some(status) = child.try_wait()? {
                    bail!(
                        "{} exited with code {} before DevTools became available. An enterprise \
                         policy may be blocking headless mode or remote debugging; try --browser \
                         with a different Chromium install.",
                        self.info.name,
                        status.code().unwrap_or(-1)
                    );
                }
            }

            // A read failure means Chrome is still writing it, so retry rather than fail.
            if let Ok(text) = std::fs::read_to_string(&port_file) {
                let mut lines = text.lines();
                if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                    if let Ok(port) = port.trim().parse::<u16>() {
                        return Ok(format!("ws://127.0.0.1:{port}{path}"));
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        bail!(
            "{} did not expose a DevTools endpoint within 30s ({} never appeared).",
            self.info.name,
            port_file.display()
        )
    }

    /// Kills the browser and removes its temporary profile.
    ///
    /// Explicit rather than only on drop, because the profile removal needs to retry: Chrome can
    /// hold files briefly after exit, and without the retries a temp profile is left behind on
    /// Windows every run.
    pub async fn shutdown(mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
        }
        if let Some(dir) = self.user_data_dir.take() {
            for _ in 0..3 {
                if std::fs::remove_dir_all(&dir).is_ok() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_flags_pin_rendering_not_just_headlessness() {
        let flags = flags(std::path::Path::new("/tmp/profile"));

        // Headless and a debugging port on any free number.
        assert!(flags.iter().any(|f| f == "--headless=new"));
        assert!(flags.iter().any(|f| f == "--remote-debugging-port=0"));

        // The determinism set: without these, two runs on one machine differ in the SVG filter
        // rasterization that SketchProvider depends on.
        for pinned in [
            "--disable-gpu",
            "--force-color-profile=srgb",
            "--disable-lcd-text",
            "--font-render-hinting=none",
            "--hide-scrollbars",
        ] {
            assert!(flags.iter().any(|f| f == pinned), "missing {pinned}");
        }
    }

    #[test]
    fn the_profile_directory_is_always_passed() {
        // A shared profile lets Chrome hand off to a running instance and exit 0 without ever
        // writing DevToolsActivePort, which looks like a hang for no reason.
        let flags = flags(std::path::Path::new("/tmp/wireframe-cdp-1"));
        assert!(flags
            .iter()
            .any(|f| f == "--user-data-dir=/tmp/wireframe-cdp-1"));
    }

    #[test]
    fn it_opens_about_blank_rather_than_the_target() {
        // The page is navigated over CDP afterwards; opening the target directly would race the
        // instrumentation that has to be installed before the first paint.
        assert_eq!(
            flags(std::path::Path::new("/tmp/p")).last().unwrap(),
            "about:blank"
        );
    }
}
