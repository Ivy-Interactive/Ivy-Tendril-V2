//! Driving a headless Chromium over the DevTools protocol, which is how `screenshot` captures a
//! wireframe without a browser automation dependency.

pub mod cdp;
pub mod locator;
pub mod process;

pub use cdp::{CdpConnection, CdpEvent};
pub use locator::{locate, BrowserInfo};
pub use process::BrowserProcess;
