//! Resolves minified JS positions back to original sources using the bundle's source map.
//!
//! Source maps are the one thing every modern toolchain agrees on: they carry the original paths,
//! the original text (`sourcesContent`) and — crucially for us — `x_google_ignoreList`, the standard
//! marker for "this frame is vendor code, not the app's". That makes a single server-side resolver a
//! viable substitute for per-framework source lookup, which is why the collector in `agent.js`
//! normalises everything to raw frames.
//!
//! Deliberately dependency-free and small: VLQ decoding is well understood, and the widget already
//! ships its own assets rather than pulling in packages.

use regex::Regex;
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};

use super::http;

/// Largest map we will download and parse. Bundles can emit enormous maps.
pub(crate) const MAX_MAP_BYTES: usize = 32 * 1024 * 1024;

/// Lines of original source either side of the target in [`ResolvedFrame::code_frame`].
pub(crate) const CODE_FRAME_CONTEXT: usize = 10;

/// Once the budget is spent the whole cache is dropped rather than evicting live entries, so a long
/// session cannot grow without bound.
pub(crate) const CACHE_BYTE_BUDGET: u64 = 64 * 1024 * 1024;

/// Frames past this are framework internals all the way down.
pub(crate) const MAX_RESOLVE_FRAMES: usize = 24;

static SOURCE_MAPPING_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)//[#@]\s*sourceMappingURL=([^\s'"]+)\s*$"#).unwrap());

/// Paths a bundler uses for code that is not the app's own.
const VENDOR_MARKERS: [&str; 5] = [
    "node_modules",
    "webpack/bootstrap",
    "webpack-internal:",
    "/~/",
    "\\node_modules\\",
];

/// A JS stack frame as the browser reported it.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct StackFrame {
    pub url: String,
    #[serde(default)]
    pub line: i32,
    #[serde(default)]
    pub col: i32,
}

/// A frame resolved back to the original source through a source map.
#[derive(Debug, Clone, Default)]
pub(crate) struct ResolvedFrame {
    /// Original source path, normalised (e.g. `src/components/SaveButton.tsx`).
    pub file: Option<String>,
    /// 1-based line in the original source.
    pub line: i32,
    /// 0-based column in the original source.
    pub col: i32,
    /// Symbol name recorded in the map, when it has one.
    pub name: Option<String>,
    /// Framework or dependency code rather than the app's own.
    pub is_third_party: bool,
    /// ±`CODE_FRAME_CONTEXT` lines of the original source, target line marked with `>`.
    pub code_frame: Option<String>,
}

/// The outcome of one load. `cacheable` separates a settled answer — this script has no map, or one
/// we cannot use — from a transient failure. Only settled answers stay in the cache: a map whose
/// fetch was cancelled because the user navigated away, or lost to one network blip, would otherwise
/// answer "no source" for every click on that bundle for the rest of the process.
struct MapLoad {
    map: Option<Arc<SourceMap>>,
    cacheable: bool,
}

/// Keyed by script URL. A `tokio` mutex is never held across the fetch itself, so two clicks on the
/// same cold bundle may both download it — a duplicated download beats serialising every resolve
/// behind one lock, and the second insert is simply the same answer.
static CACHE: LazyLock<tokio::sync::Mutex<HashMap<String, Option<Arc<SourceMap>>>>> =
    LazyLock::new(|| tokio::sync::Mutex::new(HashMap::new()));

static CACHED_BYTES: AtomicU64 = AtomicU64::new(0);

/// Resolve frames in order. Frames whose map cannot be fetched or parsed are skipped rather than
/// guessed at — a wrong file is worse than none.
pub(crate) async fn resolve(
    frames: &[StackFrame],
    is_allowed: impl Fn(&Url) -> bool + Copy,
) -> Vec<(StackFrame, ResolvedFrame)> {
    let mut resolved = Vec::new();

    for frame in frames.iter().take(MAX_RESOLVE_FRAMES) {
        let Ok(uri) = Url::parse(&frame.url) else {
            continue;
        };
        if uri.scheme() != "http" && uri.scheme() != "https" {
            continue;
        }
        if !is_allowed(&uri) {
            continue;
        }

        let Some(map) = get_map(&uri, is_allowed).await else {
            continue;
        };
        let Some(mut hit) = map.lookup(frame.line, frame.col) else {
            continue;
        };

        hit.code_frame = map.build_code_frame(&hit, CODE_FRAME_CONTEXT);
        hit.file = qualify_with_request_path(hit.file.as_deref(), &uri);
        resolved.push((frame.clone(), hit));
    }

    resolved
}

async fn get_map(
    script_uri: &Url,
    is_allowed: impl Fn(&Url) -> bool + Copy,
) -> Option<Arc<SourceMap>> {
    let key = script_uri.to_string();

    if let Some(cached) = CACHE.lock().await.get(&key) {
        return cached.clone();
    }

    let load = load_map(script_uri, is_allowed).await;
    // Drop a transient failure so the next click tries again.
    if load.cacheable {
        CACHE.lock().await.insert(key, load.map.clone());
    }
    load.map
}

async fn load_map(script_uri: &Url, is_allowed: impl Fn(&Url) -> bool + Copy) -> MapLoad {
    // "There is nothing here" is an answer worth keeping: most production bundles ship no map at
    // all, and re-fetching the whole script on every click would be the real cost.
    let settled = MapLoad {
        map: None,
        cacheable: true,
    };
    let transient = || MapLoad {
        map: None,
        cacheable: false,
    };

    let script_response = match http::send(
        &http::UPSTREAM,
        Method::GET,
        script_uri.clone(),
        None,
        |request| request,
        is_allowed,
    )
    .await
    {
        Ok(response) if response.status().is_success() => response,
        // A script the server would not give us may well be there on the next try.
        Ok(_) | Err(_) => return transient(),
    };

    let Ok(script) = script_response.text().await else {
        return transient();
    };

    let Some(reference) = SOURCE_MAPPING_URL
        .captures_iter(&script)
        .last()
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
    else {
        return settled;
    };

    let json = if reference.to_ascii_lowercase().starts_with("data:") {
        let Some(comma) = reference.find(',') else {
            return settled;
        };
        let payload = &reference[comma + 1..];
        if reference[..comma].to_ascii_lowercase().contains("base64") {
            use base64::Engine;
            match base64::engine::general_purpose::STANDARD
                .decode(payload)
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
            {
                Some(decoded) => decoded,
                None => return settled,
            }
        } else {
            percent_decode(payload)
        }
    } else {
        let Ok(map_uri) = script_uri.join(&reference) else {
            return settled;
        };
        if !is_allowed(&map_uri) {
            return settled;
        }

        let response = match http::send(
            &http::UPSTREAM,
            Method::GET,
            map_uri,
            None,
            |request| request,
            is_allowed,
        )
        .await
        {
            // A map the server would not give us may well be there on the next try.
            Ok(response) if response.status().is_success() => response,
            Ok(_) | Err(_) => return transient(),
        };

        if response
            .content_length()
            .is_some_and(|length| length > MAX_MAP_BYTES as u64)
        {
            return settled;
        }

        match response.text().await {
            Ok(text) => text,
            Err(_) => return transient(),
        }
    };

    if json.len() > MAX_MAP_BYTES {
        return settled;
    }

    // A payload we cannot read is not going to read any better next time.
    let map = SourceMap::parse(&json);
    if map.is_some() {
        track_cache_size(json.len() as u64);
    }
    MapLoad {
        map: map.map(Arc::new),
        cacheable: true,
    }
}

/// Crude but sufficient: once the budget is spent, stop retaining new maps rather than evicting live
/// ones, so a long session cannot grow without bound.
fn track_cache_size(bytes: u64) {
    if CACHED_BYTES.fetch_add(bytes, Ordering::Relaxed) + bytes <= CACHE_BYTE_BUDGET {
        return;
    }
    CACHED_BYTES.store(0, Ordering::Relaxed);
    // The cache lock is async, so the clear rides on a task rather than blocking the caller.
    tokio::spawn(async {
        CACHE.lock().await.clear();
    });
}

/// Minimal `%XX` decoder for a non-base64 `data:` source map payload.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Some maps — Vite's dev transform among them — record only the bare file name, which leaves an
/// agent to go searching for it. The URL the script was served from usually carries the directory,
/// so borrow it when the file names agree.
fn qualify_with_request_path(file: Option<&str>, script_uri: &Url) -> Option<String> {
    let file = file?;
    if file.is_empty() || file.contains('/') {
        return Some(file.to_string());
    }

    let path = script_uri.path().trim_start_matches('/');
    let suffix = format!("/{file}");
    if path.to_lowercase().ends_with(&suffix.to_lowercase()) {
        Some(path.to_string())
    } else {
        Some(file.to_string())
    }
}

/// Does this original path look like dependency or framework code?
pub(crate) fn looks_third_party(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    let lowered = path.to_lowercase();
    VENDOR_MARKERS
        .iter()
        .any(|marker| lowered.contains(&marker.to_lowercase()))
}

/// Strip the scheme-ish prefixes bundlers put in front of original paths so the result reads like a
/// repo path: `webpack://app/./src/App.tsx` becomes `src/App.tsx`.
pub(crate) fn normalize_source_path(path: &str) -> String {
    let mut value = path.to_string();

    if let Some(scheme_end) = value.find("://") {
        value = value[scheme_end + 3..].to_string();
        if let Some(slash) = value.find('/') {
            if !value.starts_with("./") {
                value = value[slash + 1..].to_string();
            }
        }
    } else if value.len() >= 5 && value[..5].eq_ignore_ascii_case("vite:") {
        value = value[5..].to_string();
    }

    value = value.replace('\\', "/");
    while let Some(rest) = value.strip_prefix("./") {
        value = rest.to_string();
    }
    while let Some(rest) = value.strip_prefix("../") {
        value = rest.to_string();
    }
    value.trim_start_matches('/').to_string()
}

// ---- the map itself -------------------------------------------------------

#[derive(Debug, Clone, Copy)]
struct Segment {
    gen_col: i32,
    source_index: i32,
    source_line: i32,
    source_col: i32,
    name_index: i32,
}

#[derive(Debug, Default)]
pub(crate) struct SourceMap {
    sources: Vec<String>,
    sources_content: Vec<Option<String>>,
    names: Vec<String>,
    ignored: HashSet<i32>,
    /// Segments per generated line, ordered by generated column so a lookup is a binary search
    /// rather than a scan of a file that can hold millions of them.
    lines: Vec<Vec<Segment>>,
}

impl SourceMap {
    pub(crate) fn parse(json: &str) -> Option<SourceMap> {
        let root: serde_json::Value = serde_json::from_str(json).ok()?;
        let root = root.as_object()?;

        // Index maps ("sections") are rare enough to decline rather than half-support.
        let mappings = root.get("mappings")?.as_str().unwrap_or("");

        let mut sources = read_strings(root, "sources");
        let names = read_strings(root, "names");

        let source_root = root
            .get("sourceRoot")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !source_root.is_empty() {
            let prefix = source_root.trim_end_matches('/');
            sources = sources
                .into_iter()
                .map(|s| {
                    if s.starts_with('/') || s.contains("://") {
                        s
                    } else {
                        format!("{prefix}/{s}")
                    }
                })
                .collect();
        }

        let sources_content = root
            .get("sourcesContent")
            .and_then(|v| v.as_array())
            .map(|array| {
                array
                    .iter()
                    .map(|e| e.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        // The standard "not the developer's code" signal, emitted by Vite and webpack.
        let ignored = root
            .get("x_google_ignoreList")
            .and_then(|v| v.as_array())
            .map(|array| {
                array
                    .iter()
                    .filter_map(|e| e.as_i64().map(|n| n as i32))
                    .collect()
            })
            .unwrap_or_default();

        let mut map = SourceMap {
            sources,
            sources_content,
            names,
            ignored,
            lines: Vec::new(),
        };
        map.decode_mappings(mappings);
        Some(map)
    }

    fn decode_mappings(&mut self, mappings: &str) {
        let chars: Vec<char> = mappings.chars().collect();
        let mut lines: Vec<Vec<Segment>> = Vec::new();
        let mut current: Vec<Segment> = Vec::new();
        let (mut source_index, mut source_line, mut source_col, mut name_index, mut gen_col) =
            (0i32, 0i32, 0i32, 0i32, 0i32);
        let mut position = 0usize;

        while position < chars.len() {
            let c = chars[position];
            if c == ';' {
                lines.push(std::mem::take(&mut current));
                gen_col = 0; // generated column resets each line; the rest carry over
                position += 1;
                continue;
            }
            if c == ',' {
                position += 1;
                continue;
            }

            gen_col += decode_vlq(&chars, &mut position);
            let mut fields = 1;
            let mut seg_source = source_index;
            let mut seg_line = source_line;
            let mut seg_col = source_col;
            let mut seg_name = -1;

            if position < chars.len() && chars[position] != ';' && chars[position] != ',' {
                source_index += decode_vlq(&chars, &mut position);
                source_line += decode_vlq(&chars, &mut position);
                source_col += decode_vlq(&chars, &mut position);
                seg_source = source_index;
                seg_line = source_line;
                seg_col = source_col;
                fields = 4;

                if position < chars.len() && chars[position] != ';' && chars[position] != ',' {
                    name_index += decode_vlq(&chars, &mut position);
                    seg_name = name_index;
                    fields = 5;
                }
            }

            // A 1-field segment marks generated code with no original counterpart.
            if fields >= 4 {
                current.push(Segment {
                    gen_col,
                    source_index: seg_source,
                    source_line: seg_line,
                    source_col: seg_col,
                    name_index: seg_name,
                });
            }
        }
        lines.push(current);

        for line in lines.iter_mut() {
            line.sort_by_key(|s| s.gen_col);
        }
        self.lines = lines;
    }

    /// Look up a 1-based generated line and 0-based generated column.
    pub(crate) fn lookup(
        &self,
        generated_line: i32,
        generated_column: i32,
    ) -> Option<ResolvedFrame> {
        let line_index = usize::try_from(generated_line - 1).ok()?;
        let segments = self.lines.get(line_index)?;
        if segments.is_empty() {
            return None;
        }

        // Largest segment starting at or before the column.
        let mut low = 0i64;
        let mut high = segments.len() as i64 - 1;
        let mut found = -1i64;
        while low <= high {
            let mid = (low + high) / 2;
            if segments[mid as usize].gen_col <= generated_column {
                found = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        let found = if found < 0 { 0usize } else { found as usize };

        let segment = segments[found];
        let raw = self
            .sources
            .get(usize::try_from(segment.source_index).ok()?)?;

        Some(ResolvedFrame {
            file: Some(normalize_source_path(raw)),
            line: segment.source_line + 1,
            col: segment.source_col,
            name: usize::try_from(segment.name_index)
                .ok()
                .and_then(|i| self.names.get(i))
                .cloned(),
            is_third_party: self.ignored.contains(&segment.source_index) || looks_third_party(raw),
            code_frame: None,
        })
    }

    /// A window of the ORIGINAL source around the hit, straight out of `sourcesContent` — the
    /// highest-value part of the payload, since the fixing agent gets the real code without another
    /// round trip.
    pub(crate) fn build_code_frame(&self, hit: &ResolvedFrame, context: usize) -> Option<String> {
        let file = hit.file.as_deref()?;
        let index = self
            .sources
            .iter()
            .position(|s| normalize_source_path(s) == file)?;
        let content = self.sources_content.get(index)?.as_deref()?;

        let normalized = content.replace("\r\n", "\n");
        let lines: Vec<&str> = normalized.split('\n').collect();

        let target = usize::try_from(hit.line - 1).ok()?;
        let first = target.saturating_sub(context);
        let last = (target + context).min(lines.len().saturating_sub(1));
        if first > last || lines.is_empty() {
            return None;
        }

        let width = (last + 1).to_string().len();
        let mut out = String::new();
        for (offset, line) in lines[first..=last].iter().enumerate() {
            let number = first + offset + 1;
            let marker = if first + offset == target { '>' } else { ' ' };
            out.push(marker);
            out.push(' ');
            out.push_str(&format!("{number:>width$}"));
            out.push_str(" | ");
            out.push_str(line);
            out.push('\n');
        }
        Some(out)
    }
}

fn read_strings(root: &serde_json::Map<String, serde_json::Value>, property: &str) -> Vec<String> {
    root.get(property)
        .and_then(|v| v.as_array())
        .map(|array| {
            array
                .iter()
                .map(|e| e.as_str().unwrap_or_default().to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Base64 VLQ, accumulated in `i64` so a malformed map cannot overflow-panic the way the C#
/// original's unchecked `int` arithmetic silently wrapped.
fn decode_vlq(chars: &[char], position: &mut usize) -> i32 {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut result: i64 = 0;
    let mut shift = 0u32;

    while *position < chars.len() {
        let c = chars[*position];
        *position += 1;
        let Some(digit) = ALPHABET.iter().position(|&a| a as char == c) else {
            break;
        };
        let digit = digit as i64;
        let has_continuation = (digit & 32) != 0;
        result += (digit & 31) << shift.min(56);
        shift += 5;
        if !has_continuation {
            break;
        }
    }

    // Bit 0 is the sign.
    let negative = (result & 1) == 1;
    result >>= 1;
    let value = if negative { -result } else { result };
    value.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    // "AAAA" is one segment: generated column 0 -> source 0, line 0, column 0. ";" starts a new
    // generated line, "AACA" advances the source line by one, and "CAAA" a later generated column.
    const MAPPINGS: &str = "AAAA,CAAC;AACA";

    fn map() -> SourceMap {
        let json = serde_json::json!({
            "version": 3,
            "sources": ["webpack://app/./src/App.tsx"],
            "sourcesContent": ["line1\nline2\nline3\nline4\n"],
            "names": ["render"],
            "mappings": MAPPINGS,
        });
        SourceMap::parse(&json.to_string()).expect("map parses")
    }

    #[test]
    fn decode_vlq_reads_signed_values() {
        let chars: Vec<char> = "AACDeB".chars().collect();
        let mut position = 0;
        assert_eq!(decode_vlq(&chars, &mut position), 0); // A
        assert_eq!(decode_vlq(&chars, &mut position), 0); // A
        assert_eq!(decode_vlq(&chars, &mut position), 1); // C
        assert_eq!(decode_vlq(&chars, &mut position), -1); // D
        assert_eq!(decode_vlq(&chars, &mut position), 15); // e
        assert_eq!(decode_vlq(&chars, &mut position), 0); // B -> continuation, then end
    }

    #[test]
    fn decode_vlq_stops_at_a_separator() {
        let chars: Vec<char> = "C,C".chars().collect();
        let mut position = 0;
        assert_eq!(decode_vlq(&chars, &mut position), 1);
        assert_eq!(position, 1);
    }

    #[test]
    fn lookup_finds_the_segment_at_or_before_the_column() {
        let map = map();

        let hit = map.lookup(1, 0).expect("line 1 col 0 resolves");
        assert_eq!(hit.file.as_deref(), Some("src/App.tsx"));
        assert_eq!(hit.line, 1);
        assert_eq!(hit.col, 0);

        // Column 0 and 1 are separate segments; anything past the last one clamps to it.
        assert_eq!(map.lookup(1, 1).unwrap().col, 1);
        assert_eq!(map.lookup(1, 999).unwrap().col, 1);

        // Second generated line advanced the source line by one.
        assert_eq!(map.lookup(2, 0).unwrap().line, 2);
    }

    #[test]
    fn lookup_rejects_lines_outside_the_map() {
        let map = map();
        assert!(map.lookup(0, 0).is_none());
        assert!(map.lookup(-3, 0).is_none());
        assert!(map.lookup(99, 0).is_none());
    }

    #[test]
    fn build_code_frame_marks_the_target_line() {
        let map = map();
        let hit = map.lookup(2, 0).expect("resolves");
        let frame = map.build_code_frame(&hit, 1).expect("frame built");
        assert_eq!(frame, "  1 | line1\n> 2 | line2\n  3 | line3\n");
    }

    #[test]
    fn normalize_source_path_strips_bundler_prefixes() {
        assert_eq!(
            normalize_source_path("webpack://app/./src/App.tsx"),
            "src/App.tsx"
        );
        assert_eq!(normalize_source_path("vite:/src/main.ts"), "src/main.ts");
        assert_eq!(normalize_source_path("./src/App.tsx"), "src/App.tsx");
        assert_eq!(normalize_source_path("../../src/App.tsx"), "src/App.tsx");
        assert_eq!(normalize_source_path("src\\App.tsx"), "src/App.tsx");
        assert_eq!(normalize_source_path("/src/App.tsx"), "src/App.tsx");
        assert_eq!(normalize_source_path("src/App.tsx"), "src/App.tsx");
    }

    #[test]
    fn looks_third_party_spots_vendor_markers() {
        assert!(looks_third_party("node_modules/react/index.js"));
        assert!(looks_third_party("webpack-internal:///./x.js"));
        assert!(!looks_third_party("src/App.tsx"));
        assert!(!looks_third_party(""));
    }

    #[test]
    fn ignore_list_marks_a_source_third_party() {
        let json = serde_json::json!({
            "version": 3,
            "sources": ["src/App.tsx"],
            "names": [],
            "mappings": "AAAA",
            "x_google_ignoreList": [0],
        });
        let map = SourceMap::parse(&json.to_string()).unwrap();
        assert!(map.lookup(1, 0).unwrap().is_third_party);
    }

    #[test]
    fn parse_declines_an_index_map() {
        let json = serde_json::json!({ "version": 3, "sections": [] });
        assert!(SourceMap::parse(&json.to_string()).is_none());
    }

    #[test]
    fn source_root_is_prefixed_onto_relative_sources() {
        let json = serde_json::json!({
            "version": 3,
            "sourceRoot": "/base/",
            "sources": ["a.ts", "/abs.ts"],
            "names": [],
            "mappings": "AAAA",
        });
        let map = SourceMap::parse(&json.to_string()).unwrap();
        assert_eq!(
            map.sources,
            vec!["/base/a.ts".to_string(), "/abs.ts".to_string()]
        );
    }

    #[test]
    fn qualify_with_request_path_borrows_the_served_directory() {
        let uri = Url::parse("http://127.0.0.1:5173/src/App.tsx?t=1").unwrap();
        assert_eq!(
            qualify_with_request_path(Some("App.tsx"), &uri).as_deref(),
            Some("src/App.tsx")
        );
        // A path already carrying a directory is left alone.
        assert_eq!(
            qualify_with_request_path(Some("src/Other.tsx"), &uri).as_deref(),
            Some("src/Other.tsx")
        );
        // And a bare name the URL does not end with stays bare.
        assert_eq!(
            qualify_with_request_path(Some("Nope.tsx"), &uri).as_deref(),
            Some("Nope.tsx")
        );
    }

    #[test]
    fn source_mapping_url_takes_the_last_comment() {
        let script = "//# sourceMappingURL=first.map\ncode();\n//# sourceMappingURL=second.map\n";
        let reference = SOURCE_MAPPING_URL
            .captures_iter(script)
            .last()
            .unwrap()
            .get(1)
            .unwrap()
            .as_str()
            .to_string();
        assert_eq!(reference, "second.map");
    }

    #[test]
    fn percent_decode_handles_escaped_json() {
        assert_eq!(percent_decode("%7B%22a%22%3A1%7D"), "{\"a\":1}");
        assert_eq!(percent_decode("plain"), "plain");
    }
}
