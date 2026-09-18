//! Injects everything the page needs into the user's `index.html`: stylesheets, the import map, the
//! bundle, and (in serve mode) the live-reload client.
//!
//! Ported from V1's `Hosting/IndexHtmlBuilder.cs`. The user's `index.html` stays editable and is
//! never rewritten on disk: this happens on the way out of the server.

use anyhow::Result;

use crate::assets::VendorManifest;
use crate::project::{templates, WireframeProject};

/// One wireframe being served.
#[derive(Debug, Clone)]
pub struct WireframeSite {
    pub project: WireframeProject,
    /// Set when the project compiles its own Tailwind sheet (`jit` mode) rather than using the
    /// embedded superset.
    pub utility_css_path: Option<std::path::PathBuf>,
    /// Whether to inject the live-reload client. Off for `screenshot`, on for `serve`.
    pub live_reload: bool,
}

impl WireframeSite {
    pub fn new(project: WireframeProject) -> Self {
        Self {
            project,
            utility_css_path: None,
            live_reload: false,
        }
    }
}

/// Minimal HTML attribute-value escaping, matching what `WebUtility.HtmlEncode` does to the
/// characters that can appear in these paths.
fn html_encode(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Builds the served document.
///
/// * `site_base` is the wireframe's own address, ending in a slash: `/` for the standalone server,
///   `/__wireframes/123/checkout/` for a plan preview.
/// * `payload_base` is where the shared payload is served, ending in a slash.
pub fn build(
    vendor: &VendorManifest,
    site: &WireframeSite,
    site_base: &str,
    payload_base: &str,
) -> Result<String> {
    let project = &site.project;
    let mut html = match std::fs::read_to_string(project.index_html()) {
        Ok(text) => text,
        Err(_) => templates::INDEX_HTML.replace("{{TITLE}}", &project.name()),
    };

    // Stylesheet order is load-bearing. tendril.css declares `@layer properties, theme, base,
    // utilities` first, which fixes that order for the whole document; the utility sheet then emits
    // into the same theme/utilities layers and must come after so it wins on equal specificity.
    // fonts.css is last so its @font-face rules beat any that a stray Google Fonts sheet might
    // contribute.
    let utilities = if site.utility_css_path.is_some() {
        format!("{site_base}__wireframe/utilities.css")
    } else {
        format!("{payload_base}css/wireframe-utilities.css")
    };

    let mut head = String::new();
    for href in [
        format!("{payload_base}css/tendril.css"),
        utilities,
        format!("{payload_base}css/fonts.css"),
    ] {
        head.push_str(&format!(
            "    <link rel=\"stylesheet\" href=\"{}\">\n",
            html_encode(&href)
        ));
    }

    head.push_str("    <script type=\"importmap\">\n");
    head.push_str(&vendor.to_import_map_json(payload_base)?);
    head.push_str("\n    </script>\n");

    let encoded_base = html_encode(site_base);
    let mut body = String::new();
    body.push_str(&format!(
        "    <script type=\"module\" src=\"{encoded_base}__wireframe/out/bundle.js\"></script>\n"
    ));
    if site.live_reload {
        body.push_str(&format!(
            "    <script src=\"{encoded_base}__wireframe/client.js\" data-base=\"{encoded_base}\"></script>\n"
        ));
    }

    html = insert_before(&html, "</head>", &head);
    html = insert_before(&html, "</body>", &body);
    Ok(html)
}

/// Inserts before a closing tag, appending if the document does not have one. Keeps a hand-edited
/// `index.html` working even if the user removed the tag.
fn insert_before(html: &str, tag: &str, insert: &str) -> String {
    let lowered = html.to_ascii_lowercase();
    match lowered.rfind(&tag.to_ascii_lowercase()) {
        None => format!("{html}{insert}"),
        Some(index) => {
            let mut out = String::with_capacity(html.len() + insert.len());
            out.push_str(&html[..index]);
            out.push_str(insert);
            out.push_str(&html[index..]);
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::catalog;

    fn vendor() -> VendorManifest {
        VendorManifest::parse(catalog::read_text("vendor.manifest.json").unwrap()).unwrap()
    }

    fn site_in(dir: &std::path::Path, html: Option<&str>) -> WireframeSite {
        let project = WireframeProject::at(dir.join("demo"));
        std::fs::create_dir_all(project.source_dir()).unwrap();
        if let Some(html) = html {
            std::fs::write(project.index_html(), html).unwrap();
        }
        WireframeSite::new(project)
    }

    #[test]
    fn stylesheet_order_is_library_then_utilities_then_fonts() {
        let dir = tempfile::tempdir().unwrap();
        let site = site_in(dir.path(), Some("<html><head></head><body></body></html>"));
        let doc = build(&vendor(), &site, "/", "/__wireframe/").unwrap();

        let tendril = doc.find("css/tendril.css").unwrap();
        let utilities = doc.find("wireframe-utilities.css").unwrap();
        let fonts = doc.find("css/fonts.css").unwrap();
        assert!(
            tendril < utilities && utilities < fonts,
            "the utility sheet must come after the library sheet to win on equal specificity, and \
             fonts last so its @font-face rules beat a stray Google Fonts sheet"
        );
    }

    #[test]
    fn a_hand_edited_index_is_preserved_not_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let site = site_in(
            dir.path(),
            Some(
                "<html><head><title>Mine</title></head><body><div id=\"root\"></div></body></html>",
            ),
        );
        let doc = build(&vendor(), &site, "/", "/__wireframe/").unwrap();

        assert!(
            doc.contains("<title>Mine</title>"),
            "the user's markup survives"
        );
        assert!(doc.contains("id=\"root\""));
        // And nothing was written back to disk.
        assert_eq!(
            std::fs::read_to_string(site.project.index_html()).unwrap(),
            "<html><head><title>Mine</title></head><body><div id=\"root\"></div></body></html>"
        );
    }

    #[test]
    fn a_missing_index_falls_back_to_the_scaffold_template() {
        let dir = tempfile::tempdir().unwrap();
        let site = site_in(dir.path(), None);
        let doc = build(&vendor(), &site, "/", "/__wireframe/").unwrap();
        assert!(doc.contains("<title>demo</title>"), "got {doc}");
        assert!(doc.contains("__wireframe/out/bundle.js"));
    }

    #[test]
    fn a_document_without_closing_tags_still_gets_everything() {
        // V1 appends rather than dropping the injection, so an index.html the user stripped down
        // still runs.
        let dir = tempfile::tempdir().unwrap();
        let site = site_in(dir.path(), Some("<div id=\"root\"></div>"));
        let doc = build(&vendor(), &site, "/", "/__wireframe/").unwrap();
        assert!(doc.contains("importmap"));
        assert!(doc.contains("out/bundle.js"));
    }

    #[test]
    fn a_plan_preview_scopes_every_url_to_its_own_base() {
        let dir = tempfile::tempdir().unwrap();
        let mut site = site_in(dir.path(), Some("<html><head></head><body></body></html>"));
        site.live_reload = true;
        let base = "/__wireframes/00099/checkout/";
        let doc = build(&vendor(), &site, base, base).unwrap();

        assert!(doc.contains(&format!("{base}__wireframe/out/bundle.js")));
        assert!(doc.contains(&format!("{base}__wireframe/client.js")));
        assert!(doc.contains(&format!("{base}css/tendril.css")));
        // The import map is rewritten to the same base, or the browser resolves react to a path
        // that does not exist under a plan preview.
        assert!(doc.contains(&format!("{base}vendor/")), "got {doc:.600}");
    }

    #[test]
    fn live_reload_is_opt_in() {
        let dir = tempfile::tempdir().unwrap();
        let site = site_in(dir.path(), Some("<html><head></head><body></body></html>"));
        let without = build(&vendor(), &site, "/", "/__wireframe/").unwrap();
        // The exact path, not a bare "client.js": the import map legitimately carries
        // `vendor/react-dom__client.js`, which a looser search matches.
        assert!(
            !without.contains("__wireframe/client.js"),
            "screenshot must not hot-reload"
        );

        let mut with = site.clone();
        with.live_reload = true;
        let doc = build(&vendor(), &with, "/", "/__wireframe/").unwrap();
        assert!(doc.contains("__wireframe/client.js"));
    }

    #[test]
    fn a_jit_project_serves_its_own_compiled_sheet() {
        let dir = tempfile::tempdir().unwrap();
        let mut site = site_in(dir.path(), Some("<html><head></head><body></body></html>"));
        site.utility_css_path = Some(dir.path().join("utilities.css"));
        let doc = build(&vendor(), &site, "/", "/__wireframe/").unwrap();

        assert!(doc.contains("/__wireframe/utilities.css"));
        assert!(
            !doc.contains("css/wireframe-utilities.css"),
            "the embedded superset must not also be linked, or it would win by source order"
        );
    }
}
