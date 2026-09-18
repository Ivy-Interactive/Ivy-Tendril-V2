//! Packs `artifacts/` into a single blob the crate embeds with one `include_bytes!`.
//!
//! V1 zips the payload into one embedded assembly resource, and this mirrors that: one blob, one
//! `include_bytes!`. The crate first used `include_dir!`, which works, but a flat blob keeps the
//! shape V1 chose, drops a dependency, and produces a byte-identical artifact from one build to the
//! next without relying on a macro's expansion order.
//!
//! The format is deliberately trivial and uncompressed, so a read is a slice into the binary's own
//! image rather than a decompression: for each entry, a little-endian u32 path length, the path in
//! UTF-8 with forward slashes, a little-endian u64 body length, then the body. Entries are sorted by
//! path, so the blob is byte-identical from one build to the next.

use std::io::Write;
use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let artifacts = manifest_dir.join("artifacts");
    println!("cargo:rerun-if-changed={}", artifacts.display());

    let mut entries = Vec::new();
    collect(&artifacts, &artifacts, &mut entries);
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("payload.bin");
    let mut blob = Vec::new();
    for (path, body) in &entries {
        blob.write_all(&(path.len() as u32).to_le_bytes()).unwrap();
        blob.write_all(path.as_bytes()).unwrap();
        blob.write_all(&(body.len() as u64).to_le_bytes()).unwrap();
        blob.write_all(body).unwrap();
    }
    std::fs::write(&out, &blob).unwrap();

    if entries.is_empty() {
        println!(
            "cargo:warning=No files under {}. Run: cd pipeline/vendor && npm install && node build-all.mjs",
            artifacts.display()
        );
    }
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let Ok(read) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, out);
        } else if let Ok(body) = std::fs::read(&path) {
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            println!("cargo:rerun-if-changed={}", path.display());
            out.push((relative, body));
        }
    }
}
