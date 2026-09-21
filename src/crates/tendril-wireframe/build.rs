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

    // Fail, do not warn. `cargo:warning` scrolls past in a normal build and is invisible in CI
    // logs, so an incomplete payload used to produce a binary that compiled cleanly and then
    // panicked at startup: WireframeHost::new reads vendor.manifest.json out of the embedded blob,
    // and tendril-server unwraps that in state.rs with `.expect("the wireframe payload is embedded
    // at build time")`. A build-time error costs a contributor one obvious message; the warning
    // cost them a running server.
    //
    // Check for the specific files the crate reads by name, not merely for a non-empty directory.
    // artifacts/fonts/ and css/fonts.css are checked in -- they are the one part the pipeline
    // cannot reproduce offline -- so after a fresh clone the directory is already non-empty while
    // everything that matters is still missing. An emptiness check passes there and the startup
    // panic comes back.
    const REQUIRED: [&str; 4] = [
        "vendor.manifest.json",
        "tendril.manifest.json",
        "ARTIFACTS.lock.json",
        "css/tendril.css",
    ];
    let missing: Vec<&str> = REQUIRED
        .iter()
        .copied()
        .filter(|rel| !artifacts.join(rel).is_file())
        .collect();

    if !missing.is_empty() {
        panic!(
            "the wireframe payload under {} is incomplete -- missing {}. This crate would build a \
             binary that panics at startup. Generate it with\n    \
             cd src/crates/tendril-wireframe/pipeline/vendor && pnpm install --frozen-lockfile && \
             node build-all.mjs",
            artifacts.display(),
            missing.join(", ")
        );
    }
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    // Propagate rather than swallow. A missing or unreadable payload directory is the same
    // failure as an empty one, and it has to stop the build here -- see main().
    let read =
        std::fs::read_dir(dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()));
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
