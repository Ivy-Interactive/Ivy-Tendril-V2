//! Variable expansion for strings out of `config.yaml`: `%TENDRIL_HOME%`, `~`, and arbitrary
//! `%ENV_VAR%`.
//!
//! [`expand_variables`] is the plain string expander used for hook commands and MCP argv;
//! [`expand_config_path`] is the one that additionally anchors a relative result under the Tendril
//! home, and its doc comment explains why the two are not the same function.

use super::env::{dirs_home_with_env, EnvSource, SystemEnv};
use std::path::{Path, PathBuf};

pub fn expand_variables_with_env(input: &str, tendril_home: &str, env: &impl EnvSource) -> String {
    let mut res = input
        .replace("%TENDRIL_HOME%", tendril_home)
        .replace("${TENDRIL_HOME}", tendril_home)
        .replace("$TENDRIL_HOME", tendril_home);

    res = expand_env_percent_vars(&res, env);

    if res.starts_with('~') {
        if let Some(home) = dirs_home_with_env(env) {
            let home_str = home.to_string_lossy();
            if res == "~" {
                res = home_str.to_string();
            } else if res.starts_with("~/") || res.starts_with("~\\") {
                res = format!("{}{}", home_str, &res[1..]);
            }
        }
    }

    res
}

pub fn expand_variables(input: &str, tendril_home: &str) -> String {
    expand_variables_with_env(input, tendril_home, &SystemEnv)
}

/// Expands a config path and anchors it, so a relative one lands under `tendril_home` rather than
/// wherever the current process happens to have been started.
///
/// `expand_variables` deliberately returns a plain string and does no filesystem reasoning: the same
/// expander is used for hook commands and MCP argv, where a relative path is the caller's business.
/// Paths out of `config.yaml` are different. Every surface reads the same file but runs from a
/// different directory -- the CLI from the user's shell, the server from wherever the daemon was
/// launched, the Tauri app from `/` -- so a bare `repos/foo` silently means three different
/// directories, and on the app it means one that cannot exist. The write paths already reject a
/// relative `path:` (see the guard in the projects route), but nothing stops a hand-edited or
/// hand-merged `config.yaml`, and the failure mode there is a repo that is silently skipped by an
/// `is_dir()` check rather than an error anyone can act on.
///
/// Anchoring to `tendril_home` is the same rule `get_plans_dir_with_settings` already applies to
/// `planFolder`, so the two cannot disagree. A path that expanded to something absolute -- via
/// `%TENDRIL_HOME%`, `~`, `$HOME`, or because it was written absolute -- is returned untouched.
pub fn expand_config_path(input: &str, tendril_home: &Path) -> PathBuf {
    let expanded = expand_variables(input, &tendril_home.to_string_lossy());
    let path = PathBuf::from(&expanded);
    if path.is_absolute() || expanded.trim().is_empty() {
        path
    } else {
        tendril_home.join(path)
    }
}

/// Replaces every `%NAME%` that names a set environment variable with its value.
///
/// `config.yaml` is documented to accept arbitrary `%ENV_VAR%` (the example config's repo paths use
/// `%REPOS_HOME%`, and hook actions are written the same way), so this closes the gap between the
/// documented syntax and the one variable the expander used to know.
///
/// An unset name is left exactly as written, which is what keeps this backwards compatible: a string
/// that reached the shell literally before still does. Only `[A-Za-z_][A-Za-z0-9_]*` between two `%`
/// is considered a name, so a bare `%` or a `50% faster` is never touched.
fn expand_env_percent_vars(input: &str, env: &impl EnvSource) -> String {
    if !input.contains('%') {
        return input.to_string();
    }

    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != b'%' {
            // Push whole UTF-8 characters: indexing is byte-wise, so a multi-byte character must be
            // copied in one piece.
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }

        match bytes[i + 1..].iter().position(|b| *b == b'%') {
            Some(offset) => {
                let name = &input[i + 1..i + 1 + offset];
                match (is_env_var_name(name), env.get_var(name)) {
                    (true, Some(value)) => {
                        out.push_str(&value);
                        i += offset + 2;
                    }
                    // Not a name, or a name nothing is set for: emit the opening `%` and carry on
                    // from the next character, so `%a% %HOME%` still resolves `HOME`.
                    _ => {
                        out.push('%');
                        i += 1;
                    }
                }
            }
            None => {
                out.push_str(&input[i..]);
                break;
            }
        }
    }

    out
}

fn is_env_var_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}
