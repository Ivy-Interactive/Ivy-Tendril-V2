//! Prints the agent reference to stdout, so it can be diffed against V1's.
//!
//! `cargo run -p tendril-wireframe --example dump-readme` prints the whole document;
//! `... --example dump-readme -- component Button` prints one component's detail view.
//!
//! This exists for parity checking against `Ivy.Tendril.Wireframe`'s `AgentReadmeRenderer`, which is
//! the only way to catch ordering and whitespace drift that assertions do not.

use std::io::Write as _;

use tendril_wireframe::assets::{catalog, VendorManifest};
use tendril_wireframe::manifest::{agent_readme::AgentReadmeRenderer, ComponentManifest};

fn main() -> anyhow::Result<()> {
    let manifest = ComponentManifest::load()?;
    let vendor = VendorManifest::parse(catalog::read_text("vendor.manifest.json")?)?;
    let renderer = AgentReadmeRenderer::new(&manifest, &vendor);

    let args: Vec<String> = std::env::args().skip(1).collect();
    let text = match args.first().map(String::as_str) {
        Some("component") => {
            let name = args.get(1).expect("usage: dump-readme component <Name>");
            let component = manifest
                .find(name)
                .unwrap_or_else(|| panic!("no component named {name}"));
            renderer.render_component(component)
        }
        _ => renderer.render(),
    };

    // Write bytes rather than `print!`, so no newline translation happens on Windows and the
    // comparison is genuinely byte for byte.
    std::io::stdout().write_all(text.as_bytes())?;
    Ok(())
}
