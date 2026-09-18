//! Reads the prebuilt payload compiled into this crate: the vendor JS bundle, the stylesheets, the
//! self-hosted fonts, the TypeScript definitions and the component manifest.
//!
//! Ported from V1's `Assets/AssetCatalog.cs`. All of it is produced at build time by
//! `pipeline/vendor/build-all.mjs`, so nothing here needs node, npm or the network.
//!
//! One deliberate simplification. V1 embeds the payload as a zip resource in the assembly and keeps
//! a decompressed-entry cache, because the dev server re-reads the same handful of files on every
//! page load. `include_dir!` embeds the tree uncompressed and hands out `&'static [u8]`, so there is
//! nothing to decompress and nothing to cache: a read is a slice, not a copy. The binary grows by
//! the payload's ~3.7 MB rather than by its compressed size, which is the whole cost.

use std::path::Path;

use anyhow::{bail, Context, Result};
use include_dir::{include_dir, Dir};
use sha2::{Digest, Sha256};

static PAYLOAD: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/artifacts");

fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches('/').to_string()
}

/// Case-insensitive lookup, matching V1's `OrdinalIgnoreCase` entry set. The exact match is tried
/// first because it is the only one that costs nothing.
fn find(path: &str) -> Option<&'static include_dir::File<'static>> {
    let key = normalize(path);
    if let Some(file) = PAYLOAD.get_file(&key) {
        return Some(file);
    }
    PAYLOAD
        .files()
        .chain(PAYLOAD.dirs().flat_map(|d| d.files()))
        .find(|f| {
            f.path()
                .to_string_lossy()
                .replace('\\', "/")
                .eq_ignore_ascii_case(&key)
        })
        .or_else(|| {
            all_files().into_iter().find(|f| {
                f.path()
                    .to_string_lossy()
                    .replace('\\', "/")
                    .eq_ignore_ascii_case(&key)
            })
        })
}

/// Every file in the payload, at any depth. `include_dir` only walks one level per call, so this
/// flattens it once and the callers iterate the result.
fn all_files() -> Vec<&'static include_dir::File<'static>> {
    fn walk(dir: &'static Dir<'static>, out: &mut Vec<&'static include_dir::File<'static>>) {
        out.extend(dir.files());
        for child in dir.dirs() {
            walk(child, out);
        }
    }
    let mut out = Vec::new();
    walk(&PAYLOAD, &mut out);
    out
}

pub fn exists(path: &str) -> bool {
    find(path).is_some()
}

/// Entry paths under `prefix`, relative to the payload root, sorted.
pub fn list(prefix: &str) -> Vec<String> {
    let mut prefix = normalize(prefix);
    if !prefix.is_empty() && !prefix.ends_with('/') {
        prefix.push('/');
    }

    let mut out: Vec<String> = all_files()
        .into_iter()
        .map(|f| f.path().to_string_lossy().replace('\\', "/"))
        .filter(|p| {
            prefix.is_empty()
                || p.to_ascii_lowercase()
                    .starts_with(&prefix.to_ascii_lowercase())
        })
        .collect();
    out.sort();
    out
}

/// Reads one asset. The result is a slice into the binary's own image: no copy, no cache.
pub fn read(path: &str) -> Result<&'static [u8]> {
    match find(path) {
        Some(file) => Ok(file.contents()),
        None => bail!(
            "Asset '{}' is not in the embedded payload.",
            normalize(path)
        ),
    }
}

pub fn read_text(path: &str) -> Result<&'static str> {
    let bytes = read(path)?;
    std::str::from_utf8(bytes).with_context(|| format!("Asset '{path}' is not valid UTF-8."))
}

pub fn try_read(path: &str) -> Option<&'static [u8]> {
    find(path).map(|f| f.contents())
}

/// Writes every asset under `prefix` into `target_dir`, preserving relative structure. Used to
/// materialize `.wireframe/types/**`.
pub fn extract_to(prefix: &str, target_dir: &Path) -> Result<usize> {
    let mut normalized = normalize(prefix);
    if !normalized.is_empty() && !normalized.ends_with('/') {
        normalized.push('/');
    }

    let mut count = 0;
    for entry in list(&normalized) {
        let relative = &entry[normalized.len()..];
        let dest = target_dir.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Creating {}", parent.display()))?;
        }
        std::fs::write(&dest, read(&entry)?)
            .with_context(|| format!("Writing {}", dest.display()))?;
        count += 1;
    }
    Ok(count)
}

/// Short content hash of the whole payload.
///
/// `setup` stamps it into `.wireframe/.stamp` so a tool upgrade re-materializes the workspace
/// instead of leaving stale types behind. V1 hashes the zip bytes; there is no zip here, so this
/// hashes the sorted `path\0bytes` stream instead. The value differs from V1's by construction --
/// nothing compares the two, and the only property that matters is that it changes when the payload
/// does and not otherwise.
pub fn hash() -> &'static str {
    static HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    HASH.get_or_init(|| {
        let mut files = all_files();
        files.sort_by_key(|f| f.path().to_string_lossy().replace('\\', "/"));

        let mut hasher = Sha256::new();
        for file in files {
            hasher.update(file.path().to_string_lossy().replace('\\', "/").as_bytes());
            hasher.update([0u8]);
            hasher.update(file.contents());
        }
        let digest = hasher.finalize();
        digest[..8].iter().map(|b| format!("{b:02x}")).collect()
    })
}

/// The version stamped alongside the payload hash.
pub fn tool_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_payload_is_actually_embedded() {
        // If the pipeline has not run, this is the failure that says so -- rather than a confusing
        // miss later when the dev server asks for a stylesheet.
        assert!(
            exists("vendor.manifest.json"),
            "artifacts/ is missing or empty: run `cd pipeline/vendor && npm install && node build-all.mjs`"
        );
        assert!(exists("ARTIFACTS.lock.json"));
        assert!(exists("css/wireframe-utilities.css"));
        assert!(exists("tendril.manifest.json"));
    }

    #[test]
    fn every_file_in_the_lock_is_present_and_unmodified() {
        // The lock is the pipeline's own record of what it produced. Checking the embedded payload
        // against it catches a partial regeneration, a stray edit, and -- the reason this test
        // exists on Windows -- a checkout that rewrote line endings underneath the hashes.
        let lock: serde_json::Value =
            serde_json::from_str(read_text("ARTIFACTS.lock.json").unwrap()).unwrap();
        let files = lock["files"].as_object().expect("lock has a files map");
        assert!(files.len() > 100, "got {} files", files.len());

        let mut mismatched = Vec::new();
        for (rel, want) in files {
            let Some(bytes) = try_read(rel) else {
                mismatched.push(format!("{rel} (missing)"));
                continue;
            };
            let got: String = Sha256::digest(bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            if got != want.as_str().unwrap() {
                mismatched.push(format!("{rel} (content)"));
            }
        }
        assert!(
            mismatched.is_empty(),
            "payload does not match ARTIFACTS.lock.json: {:?}",
            &mismatched[..mismatched.len().min(10)]
        );
    }

    #[test]
    fn list_is_prefix_scoped_and_sorted() {
        let css = list("css");
        assert!(css.iter().all(|p| p.starts_with("css/")), "got {css:?}");
        assert!(css.iter().any(|p| p == "css/tendril.css"), "got {css:?}");
        let mut sorted = css.clone();
        sorted.sort();
        assert_eq!(css, sorted);
    }

    #[test]
    fn a_missing_asset_names_itself() {
        let err = read("css/nope.css").unwrap_err().to_string();
        assert!(err.contains("css/nope.css"), "got {err}");
        assert!(!exists("css/nope.css"));
        assert!(try_read("css/nope.css").is_none());
    }

    #[test]
    fn extract_writes_the_tree_under_a_target() {
        let dir = tempfile::tempdir().unwrap();
        let count = extract_to("css", dir.path()).unwrap();
        assert!(count >= 4, "got {count}");
        assert!(dir.path().join("tendril.css").is_file());
        // Byte-for-byte, because this is what lands in .wireframe/ and is served to the browser.
        assert_eq!(
            std::fs::read(dir.path().join("tendril.css")).unwrap(),
            read("css/tendril.css").unwrap()
        );
    }

    #[test]
    fn the_hash_is_stable_across_calls() {
        assert_eq!(hash(), hash());
        assert_eq!(hash().len(), 16);
    }
}
