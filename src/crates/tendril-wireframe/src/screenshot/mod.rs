//! Capturing a wireframe as a PNG.
//!
//! The hard part is not the capture, it is knowing when the page has finished drawing: every border
//! and fill is an SVG path rough.js generates after a ResizeObserver measures its element, so
//! "wait for load" reliably photographs a half-drawn sketch.

pub mod determinism;
pub mod runner;

pub use runner::{capture, ScreenshotOptions, ScreenshotResult};
