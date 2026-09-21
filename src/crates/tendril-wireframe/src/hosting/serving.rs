//! The decisions the dev server's routes make, separated from the routing itself so they can be
//! tested without a listener.
//!
//! Ported from the helpers in V1's `Hosting/WireframeEndpoints.cs`.

use std::path::{Path, PathBuf};

/// Where the shared payload is served. The embedded payload (vendor bundle, stylesheets, fonts) is
/// identical for every wireframe, so it stays at one absolute prefix; only what belongs to one
/// wireframe lives under that wireframe's base.
pub const PAYLOAD_PREFIX: &str = "/__wireframe";

/// Dev server: never cache anything.
pub const NO_STORE: [(&str, &str); 2] = [
    ("cache-control", "no-store, no-cache, must-revalidate"),
    ("pragma", "no-cache"),
];

pub fn content_type_for(path: &str) -> &'static str {
    let extension = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match extension.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Resolves `relative` under `root`, refusing anything that escapes it.
///
/// The containment check is the whole point: this serves a directory chosen at runtime, so a crafted
/// `../../..` must not reach outside it. Returns `None` rather than an error because every caller
/// treats "cannot serve" and "not found" identically -- a 404.
pub fn resolve_within(root: &Path, relative: &str) -> Option<PathBuf> {
    if relative.is_empty() {
        return None;
    }

    let candidate = root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));

    // `canonicalize` resolves `..` and symlinks, but only exists for a real file -- which is what we
    // are checking for anyway. A miss therefore short-circuits to None.
    let full = candidate.canonicalize().ok()?;
    let root_full = root.canonicalize().ok()?;
    if !full.starts_with(&root_full) {
        return None;
    }
    if !full.is_file() {
        return None;
    }
    Some(full)
}

/// The wireframe's own address, ending in a slash.
///
/// The page's relative URLs (an `<img src="logo.png">`) resolve against its address, so this has to
/// end in a slash or they land one level up.
pub fn site_base(request_path: &str, relative: &str) -> String {
    let mut base = if !relative.is_empty() && request_path.ends_with(relative) {
        request_path[..request_path.len() - relative.len()].to_string()
    } else {
        match request_path.rfind('/') {
            Some(index) => request_path[..index + 1].to_string(),
            None => "/".to_string(),
        }
    };
    if !base.ends_with('/') {
        base.push('/');
    }
    base
}

/// True when a request for a path that could not be served should be a 404 rather than the page.
///
/// Returning index.html for a missing `.js` is the classic SPA-server bug: the browser then reports
/// "Failed to load module script: MIME type text/html", which says nothing about the real problem.
pub fn is_genuine_404(relative: &str) -> bool {
    Path::new(relative).extension().is_some()
}

/// `fonts.css` names its files by absolute URL. Under a path base those need the prefix too, or
/// every `@font-face` 404s and the handwriting font silently falls back to a system serif.
pub fn rewrite_css_urls(css: &str, path_base: &str) -> String {
    if path_base.is_empty() {
        return css.to_string();
    }
    css.replace(
        &format!("url(\"{PAYLOAD_PREFIX}/"),
        &format!("url(\"{path_base}{PAYLOAD_PREFIX}/"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_scripts_get_a_javascript_content_type() {
        // A wrong type here is fatal rather than cosmetic: a module script served as
        // application/octet-stream is refused by the browser outright.
        assert_eq!(
            content_type_for("bundle.js"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(
            content_type_for("a/b/c.mjs"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(content_type_for("x.css"), "text/css; charset=utf-8");
        assert_eq!(
            content_type_for("BUNDLE.JS"),
            "text/javascript; charset=utf-8"
        );
    }

    #[test]
    fn source_maps_are_json() {
        assert_eq!(
            content_type_for("bundle.js.map"),
            "application/json; charset=utf-8"
        );
    }

    #[test]
    fn an_unknown_extension_falls_back_to_octet_stream() {
        assert_eq!(content_type_for("thing.xyz"), "application/octet-stream");
        assert_eq!(content_type_for("noextension"), "application/octet-stream");
    }

    #[test]
    fn a_file_inside_the_root_resolves() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("logo.svg"), "<svg/>").unwrap();
        let found = resolve_within(dir.path(), "logo.svg").unwrap();
        assert!(found.ends_with("logo.svg"));
    }

    #[test]
    fn a_nested_file_resolves() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("img")).unwrap();
        std::fs::write(dir.path().join("img/logo.png"), "x").unwrap();
        assert!(resolve_within(dir.path(), "img/logo.png").is_some());
    }

    #[test]
    fn a_traversal_out_of_the_root_is_refused() {
        // The served root is chosen at runtime, so this is the check that keeps a crafted URL from
        // reading the rest of the disk.
        let dir = tempfile::tempdir().unwrap();
        let public = dir.path().join("public");
        std::fs::create_dir_all(&public).unwrap();
        std::fs::write(dir.path().join("secret.txt"), "private").unwrap();
        std::fs::write(public.join("ok.txt"), "fine").unwrap();

        assert!(resolve_within(&public, "ok.txt").is_some());
        assert!(resolve_within(&public, "../secret.txt").is_none());
        assert!(resolve_within(&public, "../../etc/passwd").is_none());
        assert!(resolve_within(&public, "a/../../secret.txt").is_none());
    }

    #[test]
    fn a_directory_is_not_served_as_a_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("img")).unwrap();
        assert!(resolve_within(dir.path(), "img").is_none());
    }

    #[test]
    fn an_empty_relative_path_resolves_to_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(resolve_within(dir.path(), "").is_none());
    }

    #[test]
    fn the_site_base_always_ends_in_a_slash() {
        // Relative URLs in the page resolve against this, so a missing slash puts every asset one
        // directory too high.
        assert_eq!(site_base("/", ""), "/");
        assert_eq!(
            site_base("/__wireframes/00099/checkout/", ""),
            "/__wireframes/00099/checkout/"
        );
        assert_eq!(
            site_base("/__wireframes/00099/checkout/img/logo.png", "img/logo.png"),
            "/__wireframes/00099/checkout/"
        );
        assert_eq!(
            site_base("/__wireframes/00099/checkout", ""),
            "/__wireframes/00099/"
        );
    }

    #[test]
    fn a_missing_file_with_an_extension_is_a_404_not_the_page() {
        // Serving index.html for a missing module is the bug that produces
        // "Failed to load module script: MIME type text/html".
        assert!(is_genuine_404("bundle.js"));
        assert!(is_genuine_404("img/logo.png"));
        // A route without an extension is a page request, so it gets the wireframe.
        assert!(!is_genuine_404("settings"));
        assert!(!is_genuine_404(""));
    }

    #[test]
    fn font_urls_are_rewritten_under_a_path_base() {
        let css = "@font-face { src: url(\"/__wireframe/fonts/BalsamiqSans-Bold-latin.woff2\"); }";
        let rewritten = rewrite_css_urls(css, "/preview");
        assert!(
            rewritten.contains("url(\"/preview/__wireframe/fonts/"),
            "got {rewritten}"
        );
        // Without a base, nothing changes.
        assert_eq!(rewrite_css_urls(css, ""), css);
    }
}
