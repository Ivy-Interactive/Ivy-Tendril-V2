//! Turning a wireframe project's source into something a browser can load.
//!
//! Both tools this drives are standalone binaries, provisioned into the shared wireframe cache on
//! first use: esbuild (a Go executable) and, in `jit` mode, the Tailwind standalone CLI. Neither
//! needs a node runtime, which is why V1 chose them and why the port can exec the same artifacts.

pub mod bundler;
pub mod esbuild;

pub use bundler::{BuildResult, EsbuildBundler, EsbuildWatcher, WatchEvent};
