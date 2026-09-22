//! Derives the shim's invoke handler from the app's own `generate_handler![...]` list, so the shim
//! registers exactly the commands the pinned commit registers. A hand-copied list would silently
//! drift on a re-pin: a removed command breaks the build (fine), but a new one would answer
//! "Command not found" in the browser and quietly change what the UI benchmark measures.
//!
//! Commands whose signature takes a runtime-bound handle (`tauri::AppHandle` without a `<R>`, which
//! defaults to Wry) cannot run on MockRuntime. Those are routed to hand-written stubs in main.rs; a
//! new one fails the build here, naming the command, instead of being dropped.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Commands main.rs provides a stub for. Keep in sync with `mod stubs` there.
const KNOWN_STUBS: &[&str] = &["cmd_execute_review_action", "cmd_subscribe_job_events"];

/// Handle types that default to the Wry runtime when written without a generic argument.
const RUNTIME_BOUND: &[&str] = &["AppHandle", "WebviewWindow", "Webview", "Window"];

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let manifest_path = manifest_dir.join("Cargo.toml");
    let manifest = fs::read_to_string(&manifest_path).expect("read Cargo.toml");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=build.rs");

    let rel = tendril_app_path(&manifest)
        .unwrap_or_else(|| panic!("no `tendril-app = {{ path = \"...\" }}` dependency in {}", manifest_path.display()));
    let app_dir = if Path::new(&rel).is_absolute() { PathBuf::from(&rel) } else { manifest_dir.join(&rel) };
    let src_dir = app_dir.join("src");
    let lib_rs = src_dir.join("lib.rs");
    let lib = fs::read_to_string(&lib_rs).unwrap_or_else(|e| panic!("read {}: {e}", lib_rs.display()));

    let mut sources = Vec::new();
    collect_rs(&src_dir, &mut sources);
    sources.sort();
    for (path, _) in &sources {
        println!("cargo:rerun-if-changed={}", path.display());
    }

    let commands = handler_list(&lib).unwrap_or_else(|| panic!("no generate_handler![...] in {}", lib_rs.display()));
    let mut entries = Vec::new();
    let mut registered = Vec::new();
    let mut stubbed = Vec::new();
    for item in &commands {
        let name = item.rsplit("::").next().unwrap().to_string();
        let params = find_params(&sources, &name)
            .unwrap_or_else(|| panic!("command `{item}` is in generate_handler! but no `fn {name}(` was found under {}", src_dir.display()));
        if takes_runtime_bound_handle(&params) {
            if !KNOWN_STUBS.contains(&name.as_str()) {
                panic!(
                    "command `{name}` takes a Wry-bound handle ({params}) and cannot run on MockRuntime: add a stub for it to `mod stubs` in src/main.rs and to KNOWN_STUBS in build.rs"
                );
            }
            entries.push(format!("crate::stubs::{name}"));
            stubbed.push(name);
        } else {
            entries.push(format!("tendril_app_lib::{item}"));
            registered.push(name);
        }
    }

    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let handlers = format!("tauri::generate_handler![\n    {}\n]\n", entries.join(",\n    "));
    fs::write(out.join("handlers.rs"), handlers).expect("write handlers.rs");
    let quote = |v: &[String]| v.iter().map(|s| format!("{s:?}")).collect::<Vec<_>>().join(", ");
    let info = format!(
        "/// Commands forwarded to the app's real handlers.\npub const REGISTERED: &[&str] = &[{}];\n/// Commands answered by a stub (they need a Wry AppHandle).\npub const STUBBED: &[&str] = &[{}];\n/// The src-tauri crate the shim was built against.\npub const TENDRIL_APP_DIR: &str = {:?};\n",
        quote(&registered),
        quote(&stubbed),
        app_dir.display().to_string()
    );
    fs::write(out.join("command_info.rs"), info).expect("write command_info.rs");
}

fn tendril_app_path(manifest: &str) -> Option<String> {
    for line in manifest.lines() {
        let t = line.trim();
        if !t.starts_with("tendril-app") {
            continue;
        }
        let at = t.find("path")?;
        let rest = &t[at + 4..];
        let open = rest.find('"')?;
        let close = rest[open + 1..].find('"')?;
        return Some(rest[open + 1..open + 1 + close].to_string());
    }
    None
}

fn collect_rs(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_rs(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            if let Ok(s) = fs::read_to_string(&p) {
                out.push((p, s));
            }
        }
    }
}

/// Drops `//` and `/* */` comments (string literals do not occur in the regions we parse).
fn strip_comments(s: &str) -> String {
    // Byte-wise is safe: comment delimiters are ASCII, so what remains is still whole UTF-8.
    let mut out: Vec<u8> = Vec::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'/' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn handler_list(lib: &str) -> Option<Vec<String>> {
    let lib = strip_comments(lib);
    let start = lib.find("generate_handler![")? + "generate_handler![".len();
    let end = start + lib[start..].find(']')?;
    let body = &lib[start..end];
    if body.contains('#') {
        panic!("generate_handler! contains attributes (#[cfg] ...); teach build.rs to evaluate them");
    }
    let items: Vec<String> = body.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    for it in &items {
        if !it.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':') {
            panic!("unexpected generate_handler! entry `{it}`");
        }
    }
    Some(items)
}

/// The parameter list of `fn <name>(...)`. A helper elsewhere may share the command's name, so a
/// definition carrying `#[tauri::command]` wins over any other.
fn find_params(sources: &[(PathBuf, String)], name: &str) -> Option<String> {
    let all = find_all_params(sources, name);
    all.iter().find(|(is_cmd, _)| *is_cmd).or_else(|| all.first()).map(|(_, p)| p.clone())
}

fn find_all_params(sources: &[(PathBuf, String)], name: &str) -> Vec<(bool, String)> {
    let mut found = Vec::new();
    let needle = format!("fn {name}");
    for (_, src) in sources {
        let mut from = 0;
        while let Some(pos) = src[from..].find(&needle) {
            let fn_at = from + pos;
            let at = fn_at + needle.len();
            from = at;
            let mut head_start = fn_at.saturating_sub(400);
            while !src.is_char_boundary(head_start) {
                head_start += 1;
            }
            let head = &src[head_start..fn_at];
            let is_cmd = head.rfind("tauri::command").is_some_and(|i| !head[i..].contains('}'));
            if let Some(p) = params_after(&src[at..]) {
                found.push((is_cmd, p));
            }
        }
    }
    found
}

/// `rest` starts right after `fn <name>`; returns the normalized parameter list, or None when this
/// is not a definition of exactly that name.
fn params_after(rest: &str) -> Option<String> {
    // Reject a longer identifier with the same prefix (`fn cmd_get_plan_git` for `cmd_get_plan`).
    let next = rest.chars().next()?;
    if next.is_ascii_alphanumeric() || next == '_' {
        return None;
    }
    let bytes = rest.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    // Skip generics `<...>` (they may nest).
    if i < bytes.len() && bytes[i] == b'<' {
        let mut depth = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'<' => depth += 1,
                b'>' => {
                    depth -= 1;
                    if depth == 0 {
                        i += 1;
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    let open = i;
    let mut depth = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(strip_comments(&rest[open + 1..i]).split_whitespace().collect::<Vec<_>>().join(" "));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn takes_runtime_bound_handle(params: &str) -> bool {
    for ty in RUNTIME_BOUND {
        let mut from = 0;
        while let Some(pos) = params[from..].find(ty) {
            let start = from + pos;
            let end = start + ty.len();
            from = end;
            let before_ok = start == 0 || !is_ident(params.as_bytes()[start - 1]);
            let after = params[end..].trim_start();
            let whole_word = after.chars().next().map_or(true, |c| !(c.is_ascii_alphanumeric() || c == '_'));
            if before_ok && whole_word && !after.starts_with('<') {
                return true;
            }
        }
    }
    false
}

fn is_ident(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}
