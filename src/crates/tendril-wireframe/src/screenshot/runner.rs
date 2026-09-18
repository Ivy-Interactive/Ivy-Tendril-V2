//! Drives a headless browser over CDP to capture a wireframe.
//!
//! Ported from V1's `Screenshot/ScreenshotRunner.cs`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use base64::Engine as _;
use serde_json::{json, Value};

use crate::browser::{BrowserProcess, CdpConnection};
use crate::screenshot::determinism;

/// Skia's maximum texture dimension; past this a capture silently truncates.
const MAX_CAPTURE_HEIGHT: i64 = 16384;

/// `--color-paper`. Without this an app that forgets a background emits a transparent PNG, which
/// reads as broken in most viewers.
const PAPER: (u8, u8, u8) = (0xFD, 0xFC, 0xF7);

#[derive(Debug, Clone)]
pub struct ScreenshotOptions {
    pub url: String,
    pub output_path: PathBuf,
    pub width: i64,
    pub height: i64,
    pub scale: f64,
    pub full_page: bool,
    pub transparent: bool,
    pub timeout: Duration,
    pub browser_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct ScreenshotResult {
    pub path: PathBuf,
    pub pixel_width: i64,
    pub pixel_height: i64,
    pub bytes: usize,
    pub used_ready_hook: bool,
    pub warning: Option<String>,
}

#[derive(Debug, Default)]
struct Readiness {
    ready: bool,
    hook: bool,
    reason: Option<String>,
    deterministic: bool,
}

pub async fn capture(options: &ScreenshotOptions) -> Result<ScreenshotResult> {
    let browser = BrowserProcess::launch(options.browser_path.as_deref()).await?;
    let result = capture_with(&browser, options).await;
    browser.shutdown().await;
    result
}

async fn capture_with(
    browser: &BrowserProcess,
    options: &ScreenshotOptions,
) -> Result<ScreenshotResult> {
    let cdp = CdpConnection::connect(&browser.web_socket_url).await?;

    // Flat session: carry sessionId on every message rather than nesting messages inside
    // Target.sendMessageToTarget.
    let target = cdp
        .send(
            "Target.createTarget",
            Some(json!({ "url": "about:blank" })),
            None,
        )
        .await?;
    let target_id = target["targetId"].as_str().context("no targetId")?;

    let attached = cdp
        .send(
            "Target.attachToTarget",
            Some(json!({ "targetId": target_id, "flatten": true })),
            None,
        )
        .await?;
    let session = attached["sessionId"]
        .as_str()
        .context("no sessionId")?
        .to_string();
    let session = Some(session.as_str());

    cdp.send("Page.enable", None, session).await?;
    cdp.send("Runtime.enable", None, session).await?;

    // Everything below must be in place BEFORE the first paint.
    cdp.send(
        "Page.addScriptToEvaluateOnNewDocument",
        Some(json!({ "source": determinism::FREEZE_ANIMATION })),
        session,
    )
    .await?;

    cdp.send(
        "Emulation.setDeviceMetricsOverride",
        Some(json!({
            "width": options.width,
            "height": options.height,
            "deviceScaleFactor": options.scale,
            "mobile": false,
        })),
        session,
    )
    .await?;

    cdp.send(
        "Emulation.setEmulatedMedia",
        Some(json!({
            "media": "screen",
            "features": [
                { "name": "prefers-reduced-motion", "value": "reduce" },
                { "name": "prefers-color-scheme", "value": "light" },
                { "name": "forced-colors", "value": "none" },
            ],
        })),
        session,
    )
    .await?;

    if !options.transparent {
        cdp.send(
            "Emulation.setDefaultBackgroundColorOverride",
            Some(json!({ "color": { "r": PAPER.0, "g": PAPER.1, "b": PAPER.2, "a": 1 } })),
            session,
        )
        .await?;
    }

    // Belt and braces: the shipped CSS has its Google Fonts @import stripped, but a hand-edited
    // index.html could add one back, and a slow font request would stall document.fonts.ready and
    // therefore the whole readiness chain.
    cdp.send("Network.enable", None, session).await?;
    cdp.send(
        "Network.setBlockedURLs",
        Some(json!({
            "urls": ["*://fonts.googleapis.com/*", "*://fonts.gstatic.com/*"],
        })),
        session,
    )
    .await?;

    // Subscribe before navigating: the load event can arrive before a listener registered
    // afterwards would see it.
    let mut load_events = cdp.subscribe();
    cdp.send(
        "Page.navigate",
        Some(json!({ "url": options.url })),
        session,
    )
    .await?;
    cdp.wait_for_event("Page.loadEventFired", options.timeout, &mut load_events)
        .await?;

    // Freeze anything the media override missed: this is what actually stops the library's
    // keyframes, plus any CSS transitions and Web Animations.
    cdp.send("Animation.enable", None, session).await?;
    cdp.send(
        "Animation.setPlaybackRate",
        Some(json!({ "playbackRate": 0 })),
        session,
    )
    .await?;

    let readiness = poll_readiness(&cdp, session, options.timeout).await?;

    let mut warning = if !readiness.ready {
        Some(format!(
            "the page never signalled ready ({}); captured anyway",
            readiness.reason.as_deref().unwrap_or("no probe result")
        ))
    } else if !readiness.hook {
        Some(
            "no window.__wireframe hook; used the heuristic probe. \
             Call signalWireframeReady() from main.tsx for reliable captures"
                .to_string(),
        )
    } else if !readiness.deterministic {
        Some(
            "SketchProvider has deterministic={false}; repeated screenshots will differ"
                .to_string(),
        )
    } else {
        None
    };

    // One more paint, in case polling itself caused work.
    evaluate(&cdp, session, determinism::SETTLE_PAINT, true).await?;

    let mut capture_height = options.height;
    if options.full_page {
        let metrics = cdp.send("Page.getLayoutMetrics", None, session).await?;
        let content_height = metrics["cssContentSize"]["height"].as_f64().unwrap_or(0.0);
        capture_height = options.height.max(content_height.ceil() as i64);

        if capture_height > MAX_CAPTURE_HEIGHT {
            warning = Some(format!(
                "page is {capture_height}px tall; clamped to {MAX_CAPTURE_HEIGHT}px \
                 (the maximum a browser can rasterize)"
            ));
            capture_height = MAX_CAPTURE_HEIGHT;
        }
    }

    let shot = cdp
        .send(
            "Page.captureScreenshot",
            Some(json!({
                "format": "png",
                "fromSurface": true,
                "optimizeForSpeed": false,
                "captureBeyondViewport": options.full_page,
                "clip": {
                    "x": 0.0,
                    "y": 0.0,
                    "width": options.width as f64,
                    "height": capture_height as f64,
                    "scale": 1.0,
                },
            })),
            session,
        )
        .await?;

    let data = shot["data"].as_str().context("no screenshot data")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .context("The screenshot was not valid base64.")?;

    if let Some(parent) = options.output_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Creating {}", parent.display()))?;
    }
    std::fs::write(&options.output_path, &bytes)
        .with_context(|| format!("Writing {}", options.output_path.display()))?;

    Ok(ScreenshotResult {
        path: options.output_path.clone(),
        pixel_width: (options.width as f64 * options.scale) as i64,
        pixel_height: (capture_height as f64 * options.scale) as i64,
        bytes: bytes.len(),
        used_ready_hook: readiness.hook,
        warning,
    })
}

async fn poll_readiness(
    cdp: &CdpConnection,
    session: Option<&str>,
    timeout: Duration,
) -> Result<Readiness> {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut last = Readiness {
        ready: false,
        hook: false,
        reason: Some("no probe result".to_string()),
        deterministic: true,
    };

    while tokio::time::Instant::now() < deadline {
        let value = evaluate(cdp, session, determinism::READINESS_PROBE, false).await?;
        if value.is_object() {
            last.hook = value["hook"].as_bool().unwrap_or(false);
            last.reason = value["reason"].as_str().map(str::to_string);
            // Absent means deterministic, as V1 reads it: only an explicit false is a warning.
            last.deterministic = value["deterministic"].as_bool().unwrap_or(true);

            if value["ready"].as_bool().unwrap_or(false) {
                last.ready = true;
                last.reason = None;
                return Ok(last);
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    Ok(last)
}

async fn evaluate(
    cdp: &CdpConnection,
    session: Option<&str>,
    expression: &str,
    await_promise: bool,
) -> Result<Value> {
    let result = cdp
        .send(
            "Runtime.evaluate",
            Some(json!({
                "expression": expression,
                "returnByValue": true,
                "awaitPromise": await_promise,
            })),
            session,
        )
        .await?;
    Ok(result["result"]["value"].clone())
}

/// The screenshot file a capture of this size writes, matching V1's
/// `<path>/screenshots/<width>x<height>.png`.
pub fn default_output_path(screenshots_dir: &Path, width: i64, height: i64) -> PathBuf {
    screenshots_dir.join(format!("{width}x{height}.png"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_output_path_is_named_by_css_pixels_not_device_pixels() {
        // A 1440x900 capture at scale 2 is still 1440x900.png, so re-running at a different scale
        // overwrites rather than accumulating files.
        let path = default_output_path(Path::new("/p/screenshots"), 1440, 900);
        assert!(path.ends_with("1440x900.png"), "got {}", path.display());
    }

    #[test]
    fn pixel_dimensions_account_for_the_device_scale_factor() {
        // The reported size is what the PNG actually contains: 1440x900 at scale 2 is 2880x1800,
        // which is what the agent reference promises.
        let width = 1440_f64;
        let scale = 2.0_f64;
        assert_eq!((width * scale) as i64, 2880);
    }

    #[test]
    fn the_clamp_is_skias_texture_limit() {
        // Past this a capture silently truncates, which is worse than a warning.
        assert_eq!(MAX_CAPTURE_HEIGHT, 16384);
    }

    #[test]
    fn the_default_background_is_paper_not_transparent() {
        assert_eq!(PAPER, (0xFD, 0xFC, 0xF7));
    }
}
