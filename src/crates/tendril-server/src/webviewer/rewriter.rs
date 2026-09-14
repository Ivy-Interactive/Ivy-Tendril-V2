//! Rewrites a proxied page so every URL in it points back into the WebViewer's view-space
//! (`/__view/<absolute-url>`) on the Tendril origin instead of at the upstream site.
//!
//! HTML goes through a real parser (`lol_html`) rather than regular expressions: the parser decides
//! what is an attribute, what is script text and what is a comment, and it decodes entities before
//! we see a value and re-encodes them on the way out. Pattern matching over raw markup gets that
//! wrong in ways the browser then swallows silently — a `style="background:url(&quot;/a.svg&quot;)"`
//! rewritten as text ends up with the entities inside the resolved path, and the declaration is
//! dropped with no request and no error. CSS is still scanned by hand, but only ever against text
//! the parser has already decoded.

use lol_html::html_content::ContentType;
use lol_html::{element, text, HtmlRewriter, Settings};
use regex::Regex;
use reqwest::Url;
use std::sync::{Arc, LazyLock, Mutex};

/// Path prefix that carries an absolute upstream URL on the Tendril origin.
pub(crate) const VIEW_PREFIX: &str = "/__view/";

/// Attributes whose entire value is one URL.
const URL_ATTRIBUTES: [&str; 7] = [
    "href",
    "src",
    "action",
    "formaction",
    "poster",
    "data-src",
    "data-href",
];

/// Attributes whose value is a srcset-style candidate list.
const SRCSET_ATTRIBUTES: [&str; 2] = ["srcset", "imagesrcset"];

static META_REFRESH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^(\s*[\d.]+\s*;\s*url\s*=\s*)(.+)$").unwrap());

/// Values that are not fetchable URLs, or are already in view-space.
static NON_FETCHABLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(data:|blob:|javascript:|mailto:|tel:|sms:|about:|#)").unwrap()
});

// Rust's regex crate has no lookahead, so the "not already a //" guard is spelled as a captured
// character (or end of input) that is put back by the replacement.
static SINGLE_SLASH_PROTOCOL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(https?:)/([^/]|$)").unwrap());

static HAS_HEAD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<head[\s>]").unwrap());
static HAS_HTML: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<html[\s>]").unwrap());

/// `scheme://host[:port]` — the .NET `Uri.GetLeftPart(UriPartial.Authority)` this port replaces.
/// `Url::port` reports `None` for a scheme's default port, so those stay elided just as they do
/// upstream.
pub(crate) fn authority(uri: &Url) -> String {
    let mut out = format!("{}://", uri.scheme());
    if let Some(host) = uri.host_str() {
        out.push_str(host);
    }
    if let Some(port) = uri.port() {
        out.push(':');
        out.push_str(&port.to_string());
    }
    out
}

/// Re-insert the `//` that path normalizers drop after the scheme, so a view-space path like
/// `/__view/https:/example.com` still yields a usable absolute URL.
pub(crate) fn fix_protocol(value: &str) -> String {
    SINGLE_SLASH_PROTOCOL
        .replace(value, "${1}//${2}")
        .into_owned()
}

/// View-space `<base href>` for a page loaded from `uri`: the target's authority and directory, so a
/// relative URL the page resolves itself lands back on this proxy.
pub(crate) fn base_href_url(uri: &Url) -> String {
    let path = uri.path();
    let directory = match path.rfind('/') {
        Some(index) => &path[..=index],
        None => "/",
    };
    let directory = if directory.is_empty() { "/" } else { directory };
    format!("{}{}{}", VIEW_PREFIX, authority(uri), directory)
}

/// Map a single URL-valued attribute into view-space.
pub(crate) fn rewrite_url(value: &str, base: &Url) -> String {
    let v = value.trim();
    if v.is_empty() {
        return value.to_string();
    }
    if NON_FETCHABLE.is_match(v) || v.starts_with(VIEW_PREFIX) {
        return value.to_string();
    }
    let Ok(abs) = base.join(v) else {
        return value.to_string();
    };
    if abs.scheme() != "http" && abs.scheme() != "https" {
        return value.to_string();
    }
    format!("{}{}", VIEW_PREFIX, abs)
}

/// Map a `<script src>` that lives on the page's own origin to that origin's path rather than into
/// view-space.
///
/// Module-chunk runtimes (Turbopack, and webpack with automatic public paths) identify a chunk by
/// the URL it was served under — `document.currentScript.src` relative to the origin. A view-space
/// URL carries the whole upstream URL inside the path, so the derived id never matches the one the
/// runtime is waiting for, and the bootstrap stalls with no error at all: the runtime installs,
/// every chunk downloads, and hydration simply never happens, leaving a dead server-rendered page.
/// Keeping the site's own path preserves the id; the service worker maps the request back to the
/// right upstream.
pub(crate) fn rewrite_script_url(value: &str, base: &Url) -> String {
    let v = value.trim();
    if v.is_empty() {
        return value.to_string();
    }
    if NON_FETCHABLE.is_match(v) || v.starts_with(VIEW_PREFIX) {
        return value.to_string();
    }
    let Ok(abs) = base.join(v) else {
        return value.to_string();
    };
    if abs.scheme() != "http" && abs.scheme() != "https" {
        return value.to_string();
    }

    // Only the page's own origin: a third-party script has no shared path space with it.
    if authority(&abs) == authority(base) {
        match abs.query() {
            Some(query) => format!("{}?{}", abs.path(), query),
            None => abs.path().to_string(),
        }
    } else {
        format!("{}{}", VIEW_PREFIX, abs)
    }
}

/// Map every candidate in a srcset-style list into view-space.
///
/// Candidates are split the way the HTML spec does — the URL runs to the next whitespace, then a
/// descriptor runs to the next comma — so a `data:` URI carrying its own commas survives instead of
/// being torn in half by a naive split.
pub(crate) fn rewrite_srcset(value: &str, base: &Url) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut out = String::with_capacity(value.len() + 32);
    let mut i = 0;
    let mut first = true;

    while i < chars.len() {
        while i < chars.len() && (chars[i].is_whitespace() || chars[i] == ',') {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }

        let url_start = i;
        while i < chars.len() && !chars[i].is_whitespace() {
            i += 1;
        }
        let mut url: String = chars[url_start..i].iter().collect();

        let mut descriptor = String::new();
        if url.ends_with(',') {
            url = url.trim_end_matches(',').to_string();
        } else {
            let descriptor_start = i;
            while i < chars.len() && chars[i] != ',' {
                i += 1;
            }
            descriptor = chars[descriptor_start..i]
                .iter()
                .collect::<String>()
                .trim()
                .to_string();
        }

        if url.is_empty() {
            continue;
        }

        if !first {
            out.push_str(", ");
        }
        first = false;
        out.push_str(&rewrite_url(&url, base));
        if !descriptor.is_empty() {
            out.push(' ');
            out.push_str(&descriptor);
        }
    }

    out
}

/// Map every `url()` and `@import` target in a stylesheet or style attribute into view-space.
/// Expects CSS text, not markup — callers must hand over a value the HTML parser has already
/// decoded.
///
/// This scans the text rather than pattern-matching it: comments and string literals are copied
/// through untouched, and only the inside of a `url()` token or an `@import` target is replaced.
/// Everything unrecognised is emitted character for character — which is why the proxy does not
/// parse to a CSS object model and re-serialise. A model that predates whatever the upstream site
/// is using (`@layer`, `@container`, nesting) silently drops the parts it cannot represent, and
/// this has to survive arbitrary modern stylesheets untouched.
pub(crate) fn rewrite_css(css: &str, base: &Url) -> String {
    if css.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = css.chars().collect();
    let mut out = String::with_capacity(css.len() + 64);
    let mut i = 0;
    let mut import_target_expected = false;

    while i < chars.len() {
        let c = chars[i];

        // A url() inside a comment is not a URL.
        if c == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            let end = match find_close_comment(&chars, i + 2) {
                Some(close) => close + 2,
                None => chars.len(),
            };
            out.extend(&chars[i..end]);
            i = end;
            continue;
        }

        if c == '"' || c == '\'' {
            let scan = scan_string(&chars, i);
            if scan.terminated && import_target_expected {
                out.push(c);
                out.push_str(&rewrite_url(&scan.content, base));
                out.push(c);
            } else {
                out.extend(&chars[i..scan.end]);
            }
            import_target_expected = false;
            i = scan.end;
            continue;
        }

        if c == '@' && matches_at(&chars, i, "@import") {
            out.extend(&chars[i..i + "@import".len()]);
            i += "@import".len();
            import_target_expected = true;
            continue;
        }

        if (c == 'u' || c == 'U')
            && matches_at(&chars, i, "url(")
            && !is_identifier_char(if i > 0 { chars[i - 1] } else { '\0' })
        {
            i = append_url_token(&chars, i, base, &mut out);
            import_target_expected = false;
            continue;
        }

        if c == ';' || c == '{' {
            import_target_expected = false;
        }

        out.push(c);
        i += 1;
    }

    out
}

/// Rewrite one `url()` token, preserving its quoting and internal whitespace.
fn append_url_token(chars: &[char], start: usize, base: &Url, out: &mut String) -> usize {
    out.extend(&chars[start..start + 4]);
    let mut i = start + 4;

    let leading_start = i;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    out.extend(&chars[leading_start..i]);

    if i < chars.len() && (chars[i] == '"' || chars[i] == '\'') {
        let quote = chars[i];
        let scan = scan_string(chars, i);
        if scan.terminated {
            out.push(quote);
            out.push_str(&rewrite_url(&scan.content, base));
            out.push(quote);
        } else {
            out.extend(&chars[i..scan.end]);
        }
        i = scan.end;
    } else {
        let value_start = i;
        while i < chars.len() && chars[i] != ')' {
            i += if chars[i] == '\\' { 2 } else { 1 };
        }
        i = i.min(chars.len());

        let raw: String = chars[value_start..i].iter().collect();
        let trimmed = raw.trim_end();
        out.push_str(&rewrite_url(&unescape(trimmed), base));
        out.push_str(&raw[trimmed.len()..]);
    }

    let trailing_start = i;
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    out.extend(&chars[trailing_start..i]);

    if i < chars.len() && chars[i] == ')' {
        out.push(')');
        i += 1;
    }

    i
}

struct StringScan {
    terminated: bool,
    end: usize,
    content: String,
}

/// Scan a CSS string literal starting at its opening quote. `terminated` is false for an
/// unterminated one, in which case `end` is where the scan stopped.
fn scan_string(chars: &[char], start: usize) -> StringScan {
    let quote = chars[start];
    let mut i = start + 1;

    while i < chars.len() {
        let c = chars[i];
        if c == '\\' {
            i += 2;
            continue;
        }
        if c == '\n' {
            break;
        }
        if c == quote {
            let raw: String = chars[start + 1..i].iter().collect();
            return StringScan {
                terminated: true,
                end: i + 1,
                content: unescape(&raw),
            };
        }
        i += 1;
    }

    StringScan {
        terminated: false,
        end: i.min(chars.len()),
        content: String::new(),
    }
}

fn unescape(value: &str) -> String {
    if !value.contains('\\') {
        return value.to_string();
    }

    let chars: Vec<char> = value.chars().collect();
    let mut out = String::with_capacity(value.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() {
            i += 1;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn find_close_comment(chars: &[char], from: usize) -> Option<usize> {
    (from..chars.len().saturating_sub(1)).find(|&i| chars[i] == '*' && chars[i + 1] == '/')
}

fn matches_at(chars: &[char], index: usize, token: &str) -> bool {
    let token: Vec<char> = token.chars().collect();
    if index + token.len() > chars.len() {
        return false;
    }
    chars[index..index + token.len()]
        .iter()
        .zip(token.iter())
        .all(|(a, b)| a.eq_ignore_ascii_case(b))
}

fn is_identifier_char(c: char) -> bool {
    c.is_alphanumeric() || c == '-' || c == '_'
}

fn escape_attribute(value: &str) -> String {
    value.replace('&', "&amp;").replace('"', "&quot;")
}

/// Rewrite a proxied HTML document. `final_url` is the URL the upstream response actually came from
/// (after redirects); `agent_script` is the page agent to inject, or `None` to inject nothing.
pub(crate) fn rewrite_html(html: &str, final_url: &str, agent_script: Option<&str>) -> String {
    let Ok(response_uri) = Url::parse(final_url) else {
        return html.to_string();
    };

    // A page's own <base href> is what ITS relative URLs resolve against, so it has to be consumed
    // before anything else is rewritten. `lol_html` streams, so a handler cannot see a <base> that
    // has not been reached yet — hence a first pass that only looks for one. That also keeps the
    // whole-document semantics the C# original had (a <base> applies to the elements before it
    // too), rather than quietly changing behaviour to "from the <base> onwards".
    let base_uri = match find_base_href(html) {
        Some(href) if !href.trim().is_empty() => response_uri
            .join(href.trim())
            .unwrap_or_else(|_| response_uri.clone()),
        _ => response_uri.clone(),
    };

    // Ours replaces the page's own <base>, which keeps runtime-inserted relative URLs resolving
    // into view-space too. The agent hooks console, clicks and history, so it has to run before
    // page scripts — immediately after the <base>.
    let mut injection = format!(
        "<base href=\"{}\">",
        escape_attribute(&base_href_url(&base_uri))
    );
    if let Some(script) = agent_script.filter(|s| !s.is_empty()) {
        injection.push_str("<script>");
        injection.push_str(script);
        injection.push_str("</script>");
    }

    // `lol_html` builds no tree, so it never synthesises a <head> the markup does not have.
    let inject_into = if HAS_HEAD.is_match(html) {
        Some("head")
    } else if HAS_HTML.is_match(html) {
        Some("html")
    } else {
        None
    };

    let mut handlers = Vec::new();

    handlers.push(element!("base[href]", |el| {
        el.remove();
        Ok(())
    }));

    for name in URL_ATTRIBUTES {
        let base = base_uri.clone();
        handlers.push(element!(format!("[{name}]"), move |el| {
            if let Some(value) = el.get_attribute(name) {
                let rewritten = if name == "src" && el.tag_name() == "script" {
                    rewrite_script_url(&value, &base)
                } else {
                    rewrite_url(&value, &base)
                };
                el.set_attribute(name, &rewritten)?;
                // Subresource integrity hashes cover the untouched upstream bytes. We rewrite
                // those bytes, so a surviving hash makes the browser refuse the script or
                // stylesheet.
                //
                // "crossorigin" stays. Every rewritten URL is same-origin now, where the attribute
                // is a no-op for the fetch itself — but dropping it changes the request's MODE, and
                // a preload only satisfies the real load when the two modes agree. A font is always
                // fetched in CORS mode, so stripping it from
                // <link rel=preload as=font crossorigin> leaves a preload that matches nothing and
                // the font downloads twice.
                el.remove_attribute("integrity");
            }
            Ok(())
        }));
    }

    for name in SRCSET_ATTRIBUTES {
        let base = base_uri.clone();
        handlers.push(element!(format!("[{name}]"), move |el| {
            if let Some(value) = el.get_attribute(name) {
                el.set_attribute(name, &rewrite_srcset(&value, &base))?;
                el.remove_attribute("integrity");
            }
            Ok(())
        }));
    }

    {
        let base = base_uri.clone();
        handlers.push(element!("[style]", move |el| {
            if let Some(value) = el.get_attribute("style") {
                el.set_attribute("style", &rewrite_css(&value, &base))?;
            }
            Ok(())
        }));
    }

    {
        // Text arrives in chunks, so a <style> body has to be buffered until the node ends before
        // the scanner can see a url() that straddles two of them.
        let base = base_uri.clone();
        let buffer = Arc::new(Mutex::new(String::new()));
        handlers.push(text!("style", move |chunk| {
            let mut accumulated = buffer.lock().expect("style buffer poisoned");
            accumulated.push_str(chunk.as_str());
            if chunk.last_in_text_node() {
                let rewritten = rewrite_css(&accumulated, &base);
                accumulated.clear();
                drop(accumulated);
                // Html rather than Text: a stylesheet is raw text, and escaping `>` in a child
                // selector would break it.
                chunk.replace(&rewritten, ContentType::Html);
            } else {
                chunk.remove();
            }
            Ok(())
        }));
    }

    {
        let base = base_uri.clone();
        handlers.push(element!("meta[http-equiv]", move |el| {
            let equiv = el
                .get_attribute("http-equiv")
                .unwrap_or_default()
                .trim()
                .to_string();

            if equiv.eq_ignore_ascii_case("refresh") {
                if let Some(content) = el.get_attribute("content") {
                    if let Some(captures) = META_REFRESH.captures(&content) {
                        let head = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
                        let target = captures
                            .get(2)
                            .map(|m| m.as_str())
                            .unwrap_or_default()
                            .trim()
                            .trim_matches(|c| c == '\'' || c == '"');
                        el.set_attribute(
                            "content",
                            &format!("{}{}", head, rewrite_url(target, &base)),
                        )?;
                    }
                }
            } else if equiv
                .to_ascii_lowercase()
                .starts_with("content-security-policy")
            {
                // The upstream CSP header is already dropped on the way through the proxy; the
                // in-document form has to go too, or it blocks the injected agent and every
                // subresource now being served from the Tendril origin.
                el.remove();
            }
            Ok(())
        }));
    }

    if let Some(selector) = inject_into {
        let inject = injection.clone();
        handlers.push(element!(selector, move |el| {
            el.prepend(&inject, ContentType::Html);
            Ok(())
        }));
    }

    let Some(rewritten) = run_rewriter(html, handlers) else {
        return html.to_string();
    };

    match inject_into {
        Some(_) => rewritten,
        None => injection + &rewritten,
    }
}

type Handlers<'h> = Vec<(
    std::borrow::Cow<'h, lol_html::Selector>,
    lol_html::ElementContentHandlers<'h>,
)>;

fn run_rewriter(html: &str, element_content_handlers: Handlers<'_>) -> Option<String> {
    let output = Arc::new(Mutex::new(Vec::with_capacity(html.len() + 512)));
    let sink = output.clone();

    let settings = element_content_handlers
        .into_iter()
        .fold(Settings::new(), |settings, handler| {
            settings.append_element_content_handler(handler)
        });

    let mut rewriter = HtmlRewriter::new(settings, move |chunk: &[u8]| {
        sink.lock()
            .expect("rewriter sink poisoned")
            .extend_from_slice(chunk)
    });

    if rewriter.write(html.as_bytes()).is_err() || rewriter.end().is_err() {
        return None;
    }

    let bytes = output.lock().expect("rewriter sink poisoned").clone();
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The page's own `<base href>`, read with the same parser that does the rewriting so an entity- or
/// quote-encoded value is decoded exactly once.
fn find_base_href(html: &str) -> Option<String> {
    let found: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let sink = found.clone();

    let mut rewriter = HtmlRewriter::new(
        Settings::new().append_element_content_handler(element!("base[href]", move |el| {
            let mut slot = sink.lock().expect("base href slot poisoned");
            if slot.is_none() {
                *slot = el.get_attribute("href");
            }
            Ok(())
        })),
        |_: &[u8]| {},
    );

    if rewriter.write(html.as_bytes()).is_err() || rewriter.end().is_err() {
        return None;
    }

    let href = found.lock().expect("base href slot poisoned").clone();
    href
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("http://example.com/app/index.html").unwrap()
    }

    #[test]
    fn rewrite_url_resolves_relative_and_absolute() {
        assert_eq!(
            rewrite_url("logo.png", &base()),
            "/__view/http://example.com/app/logo.png"
        );
        assert_eq!(
            rewrite_url("/logo.png", &base()),
            "/__view/http://example.com/logo.png"
        );
        assert_eq!(
            rewrite_url("https://cdn.test/a.js", &base()),
            "/__view/https://cdn.test/a.js"
        );
    }

    #[test]
    fn rewrite_url_leaves_non_fetchable_and_view_space_alone() {
        for value in [
            "data:image/png;base64,AAAA",
            "javascript:void 0",
            "#anchor",
            "mailto:a@b.c",
            "blob:http://example.com/x",
            "about:blank",
            "",
            "   ",
        ] {
            assert_eq!(rewrite_url(value, &base()), value);
        }
        assert_eq!(
            rewrite_url("/__view/http://other.test/x", &base()),
            "/__view/http://other.test/x"
        );
        // A non-http(s) scheme is left exactly as it was.
        assert_eq!(
            rewrite_url("ftp://files.test/x", &base()),
            "ftp://files.test/x"
        );
    }

    #[test]
    fn rewrite_script_url_keeps_same_origin_paths() {
        assert_eq!(
            rewrite_script_url("/chunks/main.js?v=2", &base()),
            "/chunks/main.js?v=2"
        );
        assert_eq!(rewrite_script_url("bundle.js", &base()), "/app/bundle.js");
        // A third-party script shares no path space with the page, so it goes to view-space.
        assert_eq!(
            rewrite_script_url("https://cdn.test/lib.js", &base()),
            "/__view/https://cdn.test/lib.js"
        );
        assert_eq!(rewrite_script_url("#nope", &base()), "#nope");
    }

    #[test]
    fn rewrite_srcset_keeps_data_uri_commas_intact() {
        // The commas inside the data URI are part of the URL token, which runs to the next
        // whitespace — splitting the list on commas instead would tear it in half.
        let value = "small.png 1x, data:image/svg+xml,%3Csvg%20a='1,2'/%3E 2x, /big.png 3x";
        assert_eq!(
            rewrite_srcset(value, &base()),
            "/__view/http://example.com/app/small.png 1x, \
             data:image/svg+xml,%3Csvg%20a='1,2'/%3E 2x, \
             /__view/http://example.com/big.png 3x"
        );
    }

    #[test]
    fn rewrite_srcset_handles_bare_candidates() {
        // No descriptors, so each URL token is a candidate on its own.
        assert_eq!(
            rewrite_srcset("a.png, b.png", &base()),
            "/__view/http://example.com/app/a.png, /__view/http://example.com/app/b.png"
        );
        // Trailing commas on a URL token end the candidate, per the spec's parse.
        assert_eq!(
            rewrite_srcset("  a.png,,  b.png 2x ", &base()),
            "/__view/http://example.com/app/a.png, /__view/http://example.com/app/b.png 2x"
        );
        // And a comma with no whitespace after it does NOT: it stays part of the one URL, which is
        // what a browser does with it too.
        assert_eq!(
            rewrite_srcset("a.png,b.png", &base()),
            "/__view/http://example.com/app/a.png,b.png"
        );
    }

    #[test]
    fn rewrite_css_rewrites_quoted_and_unquoted_urls() {
        assert_eq!(
            rewrite_css("a{background:url(bg.png)}", &base()),
            "a{background:url(/__view/http://example.com/app/bg.png)}"
        );
        assert_eq!(
            rewrite_css("a{background:url( \"bg.png\" )}", &base()),
            "a{background:url( \"/__view/http://example.com/app/bg.png\" )}"
        );
        assert_eq!(
            rewrite_css("@import 'theme.css';", &base()),
            "@import '/__view/http://example.com/app/theme.css';"
        );
        assert_eq!(
            rewrite_css("@import url(theme.css);", &base()),
            "@import url(/__view/http://example.com/app/theme.css);"
        );
    }

    #[test]
    fn rewrite_css_leaves_comments_and_string_literals_untouched() {
        let css = "/* url(bg.png) */ .a{content:'url(bg.png)'} .b{--x:\"theme.css\"}";
        assert_eq!(rewrite_css(css, &base()), css);
    }

    #[test]
    fn rewrite_css_leaves_unknown_at_rules_byte_for_byte() {
        let css = "@layer base{@container (min-width:20rem){.a{color:red}}}";
        assert_eq!(rewrite_css(css, &base()), css);
    }

    #[test]
    fn rewrite_html_injects_base_and_agent_script() {
        let html = "<html><head><title>t</title></head><body>hi</body></html>";
        let out = rewrite_html(
            html,
            "http://example.com/app/index.html",
            Some("console.log(1)"),
        );
        assert!(
            out.contains(r#"<base href="/__view/http://example.com/app/">"#),
            "{out}"
        );
        assert!(out.contains("<script>console.log(1)</script>"), "{out}");
        // The agent has to precede page scripts, so it lands before <title>.
        let script_at = out.find("console.log(1)").unwrap();
        assert!(script_at < out.find("<title>").unwrap(), "{out}");
    }

    #[test]
    fn rewrite_html_strips_csp_meta_and_integrity() {
        let html = concat!(
            "<html><head>",
            r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'">"#,
            r#"<script src="/main.js" integrity="sha384-abc" crossorigin></script>"#,
            "</head><body></body></html>",
        );
        let out = rewrite_html(html, "http://example.com/index.html", None);
        assert!(
            !out.to_lowercase().contains("content-security-policy"),
            "{out}"
        );
        assert!(!out.contains("integrity"), "{out}");
        // crossorigin survives: dropping it changes the request mode and breaks preload matching.
        assert!(out.contains("crossorigin"), "{out}");
        assert!(out.contains(r#"src="/main.js""#), "{out}");
    }

    #[test]
    fn rewrite_html_rewrites_meta_refresh_and_style_bodies() {
        let html = concat!(
            "<html><head>",
            r#"<meta http-equiv="refresh" content="5; url=/next">"#,
            "<style>.a{background:url(bg.png)}</style>",
            "</head><body></body></html>",
        );
        let out = rewrite_html(html, "http://example.com/app/index.html", None);
        assert!(
            out.contains("5; url=/__view/http://example.com/next"),
            "{out}"
        );
        assert!(
            out.contains("url(/__view/http://example.com/app/bg.png)"),
            "{out}"
        );
    }

    #[test]
    fn rewrite_html_consumes_the_pages_own_base() {
        let html =
            r#"<html><head><base href="/static/"></head><body><img src="a.png"></body></html>"#;
        let out = rewrite_html(html, "http://example.com/app/index.html", None);
        // The upstream <base> is gone and ours took its place, built from the resolved base.
        assert!(
            out.contains(r#"<base href="/__view/http://example.com/static/">"#),
            "{out}"
        );
        assert!(
            out.contains(r#"<base href="/static/">"#).eq(&false),
            "{out}"
        );
        // And the page's own relative URL resolved against that base, not against the response URL.
        assert!(
            out.contains("/__view/http://example.com/static/a.png"),
            "{out}"
        );
    }

    #[test]
    fn rewrite_html_injects_into_a_fragment_with_no_head() {
        let out = rewrite_html("<p>hi</p>", "http://example.com/x", None);
        assert!(
            out.starts_with(r#"<base href="/__view/http://example.com/">"#),
            "{out}"
        );
        assert!(out.ends_with("<p>hi</p>"), "{out}");
    }

    #[test]
    fn rewrite_html_returns_input_when_the_url_is_unusable() {
        assert_eq!(rewrite_html("<p>x</p>", "not a url", None), "<p>x</p>");
    }

    #[test]
    fn fix_protocol_restores_the_collapsed_double_slash() {
        assert_eq!(
            fix_protocol("https:/example.com/a"),
            "https://example.com/a"
        );
        assert_eq!(fix_protocol("http:/example.com"), "http://example.com");
        assert_eq!(
            fix_protocol("https://example.com/a"),
            "https://example.com/a"
        );
        assert_eq!(fix_protocol("https:/"), "https://");
        assert_eq!(fix_protocol("/relative"), "/relative");
    }

    #[test]
    fn base_href_uses_the_directory_and_elides_default_ports() {
        let base_href = |url: &str| base_href_url(&Url::parse(url).unwrap());

        assert_eq!(
            base_href("http://example.com/a/b/c.html"),
            "/__view/http://example.com/a/b/"
        );
        assert_eq!(
            base_href("http://example.com"),
            "/__view/http://example.com/"
        );
        assert_eq!(
            base_href("http://127.0.0.1:5173/x"),
            "/__view/http://127.0.0.1:5173/"
        );
        // A default port is not part of the authority the browser would show, and keeping it would
        // make every subresource URL differ from the one the page was loaded with.
        assert_eq!(
            base_href("https://example.com:443/x"),
            "/__view/https://example.com/"
        );
    }
}
