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

use regex::Regex;
use std::path::Path;
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
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        candidate.exists()
    } else {
        base_dir.join(candidate).exists()
    }
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
        return Ok(Expr::TestPath(path));
    }

    Err(format!(
        "unsupported expression in condition: `{}`",
        trimmed
    ))
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

    #[test]
    fn returns_err_for_unsupported_expressions() {
        let dir = std::env::temp_dir();
        assert!(evaluate_powershell_condition("$env:CI -eq \"true\"", &dir).is_err());
        assert!(evaluate_powershell_condition("Get-Content x", &dir).is_err());
        assert!(evaluate_powershell_condition("Test-Path", &dir).is_err());
    }
}
