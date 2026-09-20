//! The single source of truth for both the esbuild `--external:` list and the browser import map.
//!
//! Ported from V1's `Assets/VendorManifest.cs`. The file itself is produced by
//! `pipeline/vendor/build-vendor.mjs` and ships in the embedded artifacts payload.
//!
//! These two lists MUST agree. If a specifier is external to esbuild but missing from the import
//! map, the bundle links fine and then fails in the browser with an opaque "Failed to resolve module
//! specifier" -- so both are derived from this one file rather than maintained separately.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// The path prefix the manifest is written with. A host serving the payload somewhere else
/// rewrites it (see [`VendorManifest::to_import_map_json`]).
pub const DEFAULT_PAYLOAD_BASE: &str = "/__wireframe/";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VendorManifest {
    #[serde(default)]
    pub versions: BTreeMap<String, String>,

    /// Bare specifier -> URL path served by the dev server.
    #[serde(default)]
    pub specifiers: BTreeMap<String, String>,

    #[serde(default)]
    pub chunks: Vec<String>,

    #[serde(default)]
    pub entries: Vec<String>,
}

impl VendorManifest {
    pub fn parse(json: &str) -> Result<Self> {
        serde_json::from_str(json).context("vendor.manifest.json could not be parsed.")
    }

    /// The specifiers esbuild must not bundle, longest-first so deep subpaths
    /// (`roughjs/bin/generator`) are matched before their parent package.
    pub fn external_specifiers(&self) -> Vec<&str> {
        let mut keys: Vec<&str> = self.specifiers.keys().map(String::as_str).collect();
        // Sort by descending length. `sort_by_key` with `Reverse` keeps equal-length keys in the
        // BTreeMap's own order, so the argument list is stable between runs -- which matters,
        // because an unstable argument order would change the esbuild command line and defeat any
        // caching built on top of it.
        keys.sort_by_key(|k| std::cmp::Reverse(k.len()));
        keys
    }

    pub fn tendril_version(&self) -> &str {
        self.versions
            .get("tendril-wireframes")
            .map(String::as_str)
            .unwrap_or("unknown")
    }

    pub fn react_version(&self) -> &str {
        self.versions
            .get("react")
            .map(String::as_str)
            .unwrap_or("unknown")
    }

    /// Serialized `<script type="importmap">` body. `payload_base` replaces the manifest's
    /// `/__wireframe/` prefix, for a host that serves the payload under a path base -- which is
    /// exactly what Tendril's own `/__wireframes/{plan}/{name}/` host does.
    pub fn to_import_map_json(&self, payload_base: &str) -> Result<String> {
        let imports: BTreeMap<&str, String> = self
            .specifiers
            .iter()
            .map(|(specifier, path)| {
                let rewritten = if payload_base != DEFAULT_PAYLOAD_BASE
                    && path.starts_with(DEFAULT_PAYLOAD_BASE)
                {
                    format!("{payload_base}{}", &path[DEFAULT_PAYLOAD_BASE.len()..])
                } else {
                    path.clone()
                };
                (specifier.as_str(), rewritten)
            })
            .collect();

        serde_json::to_string_pretty(&serde_json::json!({ "imports": imports }))
            .context("Serializing the import map")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> VendorManifest {
        VendorManifest::parse(
            r#"{
                "versions": { "react": "19.0.0", "tendril-wireframes": "1.2.3" },
                "specifiers": {
                    "react": "/__wireframe/react.js",
                    "roughjs": "/__wireframe/roughjs.js",
                    "roughjs/bin/generator": "/__wireframe/roughjs-generator.js"
                },
                "chunks": [],
                "entries": []
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn externals_put_deep_subpaths_before_their_parent() {
        let manifest = sample();
        let externals = manifest.external_specifiers();
        let deep = externals.iter().position(|s| *s == "roughjs/bin/generator");
        let parent = externals.iter().position(|s| *s == "roughjs");
        assert!(
            deep < parent,
            "a subpath matched after its parent would be bundled instead of externalised: {externals:?}"
        );
    }

    #[test]
    fn import_map_is_rewritten_under_a_path_base() {
        let manifest = sample();
        let json = manifest
            .to_import_map_json("/__wireframes/00099/login/")
            .unwrap();
        assert!(
            json.contains("/__wireframes/00099/login/react.js"),
            "got {json}"
        );
        assert!(!json.contains("/__wireframe/react.js"), "got {json}");
    }

    #[test]
    fn the_default_base_is_left_exactly_as_written() {
        let json = sample().to_import_map_json(DEFAULT_PAYLOAD_BASE).unwrap();
        assert!(json.contains("/__wireframe/react.js"), "got {json}");
    }

    #[test]
    fn versions_fall_back_rather_than_failing() {
        let empty = VendorManifest::default();
        assert_eq!(empty.react_version(), "unknown");
        assert_eq!(empty.tendril_version(), "unknown");
        assert_eq!(sample().react_version(), "19.0.0");
        assert_eq!(sample().tendril_version(), "1.2.3");
    }
}
