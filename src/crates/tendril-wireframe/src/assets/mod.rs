//! The embedded payload a wireframe is built and served against: the vendor bundle, its manifest,
//! the stylesheet, the fonts and the TypeScript types the agent's editor resolves against.

pub mod catalog;
pub mod vendor_manifest;

pub use vendor_manifest::{VendorManifest, DEFAULT_PAYLOAD_BASE};
