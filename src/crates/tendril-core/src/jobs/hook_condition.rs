//! Classifies a hook `condition` as PowerShell or POSIX shell, and evaluates the PowerShell subset
//! in-process rather than spawning a process for it.
//!
//! Legacy ran every hook through `pwsh`, so a migrated condition is PowerShell-authored
//! (`Test-Path "artifacts/sample"`, ` -or `, ` -and `). Running that string through `sh -c` (what
//! [`crate::jobs::hooks::shell_hook_executor`] does) makes `Test-Path` exit non-zero, which
//! [`crate::jobs::hooks::condition_holds`] reads as "condition not met" — a migrated hook fails
//! closed and silently. This module gives PowerShell-shaped conditions a real evaluator instead,
//! while POSIX conditions keep going through the shell unchanged.
//!
//! The grammar mirrors the frontend's own PowerShell-condition evaluator
//! (`ReviewActionsBarView.tsx`'s `evaluateCondition`) so the two stay in step:
//!
//! ```text
//! expr := and-expr ( " -or "  and-expr )*
//! and  := term     ( " -and " term     )*
//! term := "(" expr ")" | bool-literal | Test-Path <path>
//! ```
//!
//! **`Test-Path` semantics differ from the frontend on purpose.** The frontend has no filesystem,
//! so it substring-matches against a supplied path list. Here it is a real check: an absolute path
//! is checked directly, a relative path is resolved against `base_dir` (the hook's working
//! directory — the plan folder, else `TENDRIL_HOME`, matching legacy's `pwsh` `WorkingDirectory`).
//! Do not "fix" this back into a substring match; it is the whole point of running natively instead
//! of through a shell.
//!
//! The path itself is read the way legacy's `PlatformHelper.TryEvaluateTestPathCondition` read it,
//! which is what decided every review-action `Test-Path` V1 had: `\` and `/` are both separators, a
//! leading `~` is the user's home, a stray leading separator before `Worktrees/` or `artifacts/` is
//! dropped (`SanitizeConditionPath`), and `*`/`?` in the last segment match any entry of its
//! directory. Configs written on Windows (`Test-Path "worktrees\Repo\src"`,
//! `Test-Path "artifacts\sample\*.csproj"`) are the norm rather than the exception, and without this
//! every one of them would read as "does not exist" on macOS and Linux — which for a review action
//! means a button disabled for a reason that is not true. See [`resolve_test_path`].

use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// Cmdlets that unambiguously mark a condition as PowerShell even without `-or`/`-and`, e.g.
/// `Test-Path`, `Get-ChildItem`. Matching the verb list keeps a POSIX `test -d` or `[ -f x ]` (no
/// hyphen directly joining a capitalized verb and noun) from being misclassified.
static POWERSHELL_CMDLET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(Get|Set|Test|New|Remove|Write|Select|Where|Measure|Invoke|Start|Stop|ForEach)-[A-Z][A-Za-z]+\b")
        .unwrap()
});

/// Which evaluator a hook `condition` should run through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookConditionLanguage {
    /// Parsed into the supported PowerShell subset; evaluate in-process.
    PowerShell,
    /// Nothing PowerShell about it; run it through the shell as before.
    Shell,
    /// Unmistakably PowerShell (an `-or`/`-and`/`$env:`/cmdlet marker), but outside the supported
    /// subset. The `String` is why parsing failed.
    PowerShellUnsupported(String),
}

/// Classifies an already variable-expanded, trimmed hook condition.
///
/// Ambiguous POSIX operators (`-eq`, `-f`, `-d`, `-n`, ...) are deliberately **not** treated as
/// PowerShell markers: they appear in `[ ... ]` tests, and treating them as PowerShell would break
/// working POSIX conditions. ` -or `/` -and ` *are* markers (matching the frontend evaluator), so a
/// POSIX `find . -and -name x` condition is reported as [`HookConditionLanguage::PowerShellUnsupported`]
/// rather than silently run — visible, not silent.
pub fn classify_hook_condition(condition: &str) -> HookConditionLanguage {
    let trimmed = condition.trim();
    let lower = trimmed.to_ascii_lowercase();
    if matches!(lower.as_str(), "$true" | "true" | "$false" | "false") {
        return HookConditionLanguage::PowerShell;
    }

    if has_powershell_marker(trimmed) {
        return match parse_expr(trimmed) {
            Ok(_) => HookConditionLanguage::PowerShell,
            Err(why) => HookConditionLanguage::PowerShellUnsupported(why),
        };
    }

    HookConditionLanguage::Shell
}

fn has_powershell_marker(condition: &str) -> bool {
    let lower = condition.to_ascii_lowercase();
    lower.contains("$env:")
        || lower.contains("$psversiontable")
        || condition.contains(" -or ")
        || condition.contains(" -and ")
        || matches_powershell_cmdlet(condition)
}

/// Whether `s` contains a `Verb-Noun` cmdlet shape (`Test-Path`, `Get-ChildItem`, ...). Exposed for
/// [`crate::jobs::hooks::describe_action`]'s inline-PowerShell hint, which checks a hook's `action`
/// rather than its `condition` — an action is a command line to run, not a condition to classify, so
/// it reuses only the cmdlet marker, not the full `-or`/`-and`/`$env:` classification.
pub fn matches_powershell_cmdlet(s: &str) -> bool {
    POWERSHELL_CMDLET_RE.is_match(s)
}

/// Evaluates a condition already classified as [`HookConditionLanguage::PowerShell`].
///
/// Runs entirely in-process — no process is spawned, so `HOOK_CONDITION_TIMEOUT` does not apply
/// here; a filesystem `exists()` check cannot hang meaningfully. The timeout still governs the
/// `Shell` path in `hooks.rs`.
pub fn evaluate_powershell_condition(condition: &str, base_dir: &Path) -> Result<bool, String> {
    let expr = parse_expr(condition.trim())?;
    Ok(eval(&expr, base_dir))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Expr {
    Bool(bool),
    TestPath(String),
    Or(Vec<Expr>),
    And(Vec<Expr>),
}

fn eval(expr: &Expr, base_dir: &Path) -> bool {
    match expr {
        Expr::Bool(b) => *b,
        Expr::TestPath(path) => test_path_exists(path, base_dir),
        Expr::Or(parts) => parts.iter().any(|p| eval(p, base_dir)),
        Expr::And(parts) => parts.iter().all(|p| eval(p, base_dir)),
    }
}

fn test_path_exists(path: &str, base_dir: &Path) -> bool {
    let resolved = resolve_test_path(path, base_dir);
    let pattern = match resolved.file_name().and_then(|name| name.to_str()) {
        Some(name) if has_wildcard(name) => name.to_string(),
        _ => return resolved.exists(),
    };

    // Legacy's `Directory.EnumerateFileSystemEntries(dir, pattern, TopDirectoryOnly).Any()`: the
    // pattern matches entries of its own directory only, and a directory that is not there matches
    // nothing.
    let dir = resolved.parent().unwrap_or(base_dir);
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .any(|entry| wildcard_matches(&pattern, &entry.file_name().to_string_lossy()))
        })
        .unwrap_or(false)
}

/// Where a `Test-Path` argument points, read the way legacy's `TryEvaluateTestPathCondition` read
/// it: separators normalised, `~` expanded, V1's `SanitizeConditionPath` applied, and a relative
/// path resolved against `base_dir`.
fn resolve_test_path(path: &str, base_dir: &Path) -> PathBuf {
    // PowerShell takes either separator on every platform, and legacy normalised to the native one
    // before touching the disk. Windows already reads both.
    let normalized = if cfg!(windows) {
        path.to_string()
    } else {
        path.replace('\\', "/")
    };

    if let Some(rest) = normalized.strip_prefix('~') {
        if rest.is_empty() || rest.starts_with(['/', '\\']) {
            if let Some(home) = crate::config::dirs_home() {
                return home.join(rest.trim_start_matches(['/', '\\']));
            }
        }
    }

    let candidate = Path::new(strip_misplaced_root(&normalized));
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        base_dir.join(candidate)
    }
}

/// Legacy's `SanitizeConditionPath`: `Test-Path "/Worktrees/Repo"` is a plan-relative path an agent
/// wrote with a leading separator, not a directory at the filesystem root, so the separator goes.
/// Only in front of `Worktrees/` and `artifacts/`, as there; any other absolute path stays absolute.
fn strip_misplaced_root(path: &str) -> &str {
    let trimmed = path.trim_start_matches(['/', '\\']);
    if trimmed.len() == path.len() {
        return path;
    }
    let lower = trimmed.to_ascii_lowercase();
    let plan_relative = ["worktrees/", "worktrees\\", "artifacts/", "artifacts\\"]
        .iter()
        .any(|prefix| lower.starts_with(prefix));
    if plan_relative {
        trimmed
    } else {
        path
    }
}

fn has_wildcard(segment: &str) -> bool {
    segment.contains(['*', '?'])
}

/// `*` (any run, including none) and `?` (exactly one character) against one directory entry's
/// name. Case-insensitive where the platform's default filesystem is, so a pattern agrees with what
/// `exists()` would have said about the same name spelled out.
fn wildcard_matches(pattern: &str, name: &str) -> bool {
    let fold = |s: &str| -> Vec<char> {
        if cfg!(any(windows, target_os = "macos")) {
            s.to_lowercase().chars().collect()
        } else {
            s.chars().collect()
        }
    };
    let pattern = fold(pattern);
    let name = fold(name);

    // Iterative glob match with single-star backtracking: linear in practice, and no recursion for a
    // pathological pattern to blow the stack with.
    let (mut p, mut n) = (0usize, 0usize);
    let mut star: Option<(usize, usize)> = None;
    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, n));
            p += 1;
        } else if let Some((star_p, star_n)) = star {
            p = star_p + 1;
            n = star_n + 1;
            star = Some((star_p, star_n + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

fn parse_expr(s: &str) -> Result<Expr, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("empty expression in condition".to_string());
    }

    let or_parts = split_top_level(trimmed, " -or ");
    if or_parts.len() > 1 {
        let parts = or_parts
            .iter()
            .map(|p| parse_expr(p))
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(Expr::Or(parts));
    }

    let and_parts = split_top_level(trimmed, " -and ");
    if and_parts.len() > 1 {
        let parts = and_parts
            .iter()
            .map(|p| parse_expr(p))
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(Expr::And(parts));
    }

    parse_term(trimmed)
}

fn parse_term(s: &str) -> Result<Expr, String> {
    let trimmed = s.trim();

    if trimmed.starts_with('(') && trimmed.ends_with(')') && is_fully_parenthesized(trimmed) {
        return parse_expr(&trimmed[1..trimmed.len() - 1]);
    }

    let lower = trimmed.to_ascii_lowercase();
    match lower.as_str() {
        "$true" | "true" => return Ok(Expr::Bool(true)),
        "$false" | "false" => return Ok(Expr::Bool(false)),
        _ => {}
    }

    if let Some(path) = parse_test_path(trimmed)? {
        reject_directory_wildcards(&path)?;
        return Ok(Expr::TestPath(path));
    }

    Err(format!(
        "unsupported expression in condition: `{}`",
        trimmed
    ))
}

/// A wildcard anywhere but the last segment is outside what [`test_path_exists`] (and legacy's
/// native `Test-Path`, which it ports) can answer. Refused as unsupported rather than evaluated to
/// `false`, so it is reported as a condition nobody could check instead of one that failed.
fn reject_directory_wildcards(path: &str) -> Result<(), String> {
    let segments: Vec<&str> = path.split(['/', '\\']).collect();
    let directories = &segments[..segments.len().saturating_sub(1)];
    if directories.iter().any(|segment| has_wildcard(segment)) {
        return Err(format!(
            "Test-Path supports wildcards only in the last segment of the path: `{}`",
            path
        ));
    }
    Ok(())
}

/// Whether `s` is `(...)` where the leading `(` and trailing `)` are actually a matching pair
/// (rather than, say, `(a) -and (b)`, where the two parens are unrelated to each other).
fn is_fully_parenthesized(s: &str) -> bool {
    let mut depth = 0i32;
    let mut in_quote: Option<char> = None;
    for (i, c) in s.char_indices() {
        if let Some(q) = in_quote {
            if c == q {
                in_quote = None;
            }
            continue;
        }
        match c {
            '"' | '\'' => in_quote = Some(c),
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 && i != s.len() - 1 {
                    return false;
                }
            }
            _ => {}
        }
    }
    depth == 0
}

/// Splits `s` on `sep` at paren-depth 0 and outside quotes. Returns `[s]` unchanged if `sep` never
/// occurs at the top level.
fn split_top_level(s: &str, sep: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0i32;
    let mut in_quote: Option<char> = None;
    let mut start = 0usize;
    let bytes = s.as_bytes();
    let sep_bytes = sep.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if let Some(q) = in_quote {
            if c == q {
                in_quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            '"' | '\'' => {
                in_quote = Some(c);
                i += 1;
                continue;
            }
            '(' => {
                depth += 1;
                i += 1;
                continue;
            }
            ')' => {
                depth -= 1;
                i += 1;
                continue;
            }
            _ => {}
        }
        if depth == 0 && s.is_char_boundary(i) && bytes[i..].starts_with(sep_bytes) {
            parts.push(s[start..i].to_string());
            i += sep_bytes.len();
            start = i;
            continue;
        }
        i += 1;
    }
    parts.push(s[start..].to_string());
    parts
}

/// Parses a `Test-Path <path>` term. Returns `Ok(None)` if `s` does not start with the `Test-Path`
/// cmdlet at all (so the caller can try other term shapes), and `Err` if it does but the argument is
/// missing or malformed.
fn parse_test_path(s: &str) -> Result<Option<String>, String> {
    const CMDLET: &str = "test-path";
    if s.len() < CMDLET.len() || !s[..CMDLET.len()].eq_ignore_ascii_case(CMDLET) {
        return Ok(None);
    }
    let rest = &s[CMDLET.len()..];
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        // e.g. "Test-Pathological", not the Test-Path cmdlet.
        return Ok(None);
    }
    let rest = rest.trim_start();
    if rest.is_empty() {
        return Err("Test-Path requires a path argument".to_string());
    }

    if let Some(after_quote) = rest.strip_prefix('"') {
        return match after_quote.find('"') {
            Some(end) => Ok(Some(after_quote[..end].to_string())),
            None => Err("unterminated quoted path in Test-Path".to_string()),
        };
    }
    if let Some(after_quote) = rest.strip_prefix('\'') {
        return match after_quote.find('\'') {
            Some(end) => Ok(Some(after_quote[..end].to_string())),
            None => Err("unterminated quoted path in Test-Path".to_string()),
        };
    }

    let end = rest
        .find(|c: char| c.is_whitespace() || c == ')')
        .unwrap_or(rest.len());
    let path = &rest[..end];
    if path.is_empty() {
        return Err("Test-Path requires a path argument".to_string());
    }
    Ok(Some(path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tendril-hook-condition-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&dir).expect("failed to create test dir");
        dir
    }

    #[test]
    fn classifies_bool_literals_as_powershell() {
        for s in ["$true", "true", "TRUE", "$false", "false"] {
            assert_eq!(
                classify_hook_condition(s),
                HookConditionLanguage::PowerShell,
                "{s}"
            );
        }
    }

    #[test]
    fn classifies_posix_shapes_as_shell() {
        for s in [
            "cd /tmp && pnpm install && pnpm dev:app",
            "test -d .git",
            "[ -f package.json ]",
            "test -n \"$HOME\"",
        ] {
            assert_eq!(
                classify_hook_condition(s),
                HookConditionLanguage::Shell,
                "{s}"
            );
        }
    }

    #[test]
    fn classifies_test_path_as_powershell() {
        assert_eq!(
            classify_hook_condition(r#"Test-Path "artifacts/sample""#),
            HookConditionLanguage::PowerShell
        );
        assert_eq!(
            classify_hook_condition("Test-Path artifacts/sample"),
            HookConditionLanguage::PowerShell
        );
    }

    #[test]
    fn classifies_or_and_and_as_powershell() {
        assert_eq!(
            classify_hook_condition(r#"Test-Path "a" -or Test-Path "b""#),
            HookConditionLanguage::PowerShell
        );
        assert_eq!(
            classify_hook_condition("$true -and $false"),
            HookConditionLanguage::PowerShell
        );
    }

    #[test]
    fn classifies_unsupported_powershell_as_unevaluable() {
        for s in [
            "$env:CI -eq \"true\"",
            "Get-Content x",
            "Test-Path",
            "Get-ChildItem | Where-Object { $_.Length -gt 0 }",
        ] {
            match classify_hook_condition(s) {
                HookConditionLanguage::PowerShellUnsupported(_) => {}
                other => panic!("expected PowerShellUnsupported for `{s}`, got {other:?}"),
            }
        }
    }

    #[test]
    fn evaluates_bool_literals() {
        let dir = std::env::temp_dir();
        assert_eq!(evaluate_powershell_condition("$true", &dir), Ok(true));
        assert_eq!(evaluate_powershell_condition("$false", &dir), Ok(false));
    }

    #[test]
    fn evaluates_or_and_and() {
        let dir = std::env::temp_dir();
        assert_eq!(
            evaluate_powershell_condition("$false -or $true", &dir),
            Ok(true)
        );
        assert_eq!(
            evaluate_powershell_condition("$false -or $false", &dir),
            Ok(false)
        );
        assert_eq!(
            evaluate_powershell_condition("$true -and $true", &dir),
            Ok(true)
        );
        assert_eq!(
            evaluate_powershell_condition("$true -and $false", &dir),
            Ok(false)
        );
    }

    #[test]
    fn evaluates_parenthesised_operands() {
        let dir = std::env::temp_dir();
        assert_eq!(
            evaluate_powershell_condition("$false -or ($true -and $true)", &dir),
            Ok(true)
        );
    }

    #[test]
    fn evaluates_test_path_relative_and_absolute() {
        let base = temp_dir("relative-absolute");
        fs::create_dir_all(base.join("artifacts/sample")).unwrap();

        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "artifacts/sample""#, &base),
            Ok(true)
        );
        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "missing.txt""#, &base),
            Ok(false)
        );

        let abs = base.join("artifacts/sample");
        let abs_str = abs.to_string_lossy().to_string();
        assert_eq!(
            evaluate_powershell_condition(
                &format!(r#"Test-Path "{}""#, abs_str),
                Path::new("/nonexistent")
            ),
            Ok(true)
        );

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn evaluates_bare_and_single_quoted_paths() {
        let base = temp_dir("bare-quoted");
        fs::write(base.join("file.txt"), b"hi").unwrap();

        assert_eq!(
            evaluate_powershell_condition("Test-Path file.txt", &base),
            Ok(true)
        );
        assert_eq!(
            evaluate_powershell_condition("Test-Path 'file.txt'", &base),
            Ok(true)
        );

        let _ = fs::remove_dir_all(base);
    }

    /// `src/Ivy.Tendril.TeamIvyConfig/config.yaml` writes `Test-Path "worktrees\Ivy-Tendril\src"`:
    /// a config authored on Windows. Read literally on macOS that is one file name with backslashes
    /// in it, which never exists, and every such review action would be disabled for nothing.
    #[test]
    fn reads_backslashes_as_separators() {
        let base = temp_dir("backslashes");
        fs::create_dir_all(base.join("Worktrees/Repo/src")).unwrap();

        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "Worktrees\Repo\src""#, &base),
            Ok(true)
        );
        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "Worktrees\Repo\missing""#, &base),
            Ok(false)
        );

        let _ = fs::remove_dir_all(base);
    }

    /// Legacy's `SanitizeConditionPath`: a leading separator in front of `Worktrees/` or
    /// `artifacts/` is a plan-relative path written sloppily, not the filesystem root.
    #[test]
    fn drops_a_misplaced_root_before_plan_relative_folders_only() {
        let base = temp_dir("misplaced-root");
        fs::create_dir_all(base.join("Worktrees/Repo")).unwrap();
        fs::create_dir_all(base.join("artifacts/sample")).unwrap();

        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "/Worktrees/Repo""#, &base),
            Ok(true)
        );
        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "\artifacts\sample""#, &base),
            Ok(true)
        );
        // Anything else that looks absolute is absolute, as it was in V1.
        assert_eq!(strip_misplaced_root("/usr/local"), "/usr/local");
        assert_eq!(strip_misplaced_root("Worktrees/Repo"), "Worktrees/Repo");

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn expands_a_leading_tilde_to_the_home_directory() {
        let Some(home) = crate::config::dirs_home() else {
            return;
        };
        assert_eq!(resolve_test_path("~", Path::new("/base")), home);
        assert_eq!(
            resolve_test_path("~/projects/x", Path::new("/base")),
            home.join("projects/x")
        );
        // Only a leading `~` segment is the home directory.
        assert_eq!(
            resolve_test_path("~backup/x", Path::new("/base")),
            Path::new("/base").join("~backup/x")
        );
    }

    /// `Test-Path "artifacts\sample\*.csproj"`, verbatim from the team config.
    #[test]
    fn matches_wildcards_in_the_last_segment() {
        let base = temp_dir("wildcards");
        fs::create_dir_all(base.join("artifacts/sample")).unwrap();
        fs::write(base.join("artifacts/sample/App.csproj"), b"").unwrap();

        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "artifacts\sample\*.csproj""#, &base),
            Ok(true)
        );
        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "artifacts/sample/App.?sproj""#, &base),
            Ok(true)
        );
        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "artifacts/sample/*.sln""#, &base),
            Ok(false)
        );
        // A directory that is not there matches nothing, rather than erroring.
        assert_eq!(
            evaluate_powershell_condition(r#"Test-Path "artifacts/gone/*.csproj""#, &base),
            Ok(false)
        );

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn refuses_wildcards_outside_the_last_segment_as_unsupported() {
        let condition = r#"Test-Path "Worktrees/*/src""#;
        match classify_hook_condition(condition) {
            HookConditionLanguage::PowerShellUnsupported(why) => {
                assert!(why.contains("last segment"), "{why}")
            }
            other => panic!("expected PowerShellUnsupported, got {other:?}"),
        }
        assert!(evaluate_powershell_condition(condition, &std::env::temp_dir()).is_err());
    }

    #[test]
    fn wildcard_matching_follows_star_and_question_mark() {
        assert!(wildcard_matches("*", ""));
        assert!(wildcard_matches("*.csproj", "App.csproj"));
        assert!(wildcard_matches("a*b*c", "aXXbYYc"));
        assert!(wildcard_matches("a?c", "abc"));
        assert!(!wildcard_matches("a?c", "ac"));
        assert!(!wildcard_matches("*.csproj", "App.csproj.bak"));
        assert!(wildcard_matches("*.csproj*", "App.csproj.bak"));
    }

    #[test]
    fn returns_err_for_unsupported_expressions() {
        let dir = std::env::temp_dir();
        assert!(evaluate_powershell_condition("$env:CI -eq \"true\"", &dir).is_err());
        assert!(evaluate_powershell_condition("Get-Content x", &dir).is_err());
        assert!(evaluate_powershell_condition("Test-Path", &dir).is_err());
    }
}
