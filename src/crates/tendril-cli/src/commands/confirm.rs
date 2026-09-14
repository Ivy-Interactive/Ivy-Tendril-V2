use std::io::{self, BufRead, Write};

/// Decides a yes/no prompt from a raw answer line. `default_yes` applies to an empty line.
pub fn is_affirmative(answer: &str, default_yes: bool) -> bool {
    let normalized = answer.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return default_yes;
    }
    matches!(normalized.as_str(), "y" | "yes")
}

/// The stricter predicate `db reset` uses: only an exact, trimmed, lowercased `y` proceeds, so
/// `yes` does *not* confirm. Pins the original `DatabaseCommands.DbResetInternal` behaviour
/// (`DatabaseCommands.cs:43`), which differs deliberately from `reset`'s prompt.
pub fn is_exactly_y(answer: &str, _default_yes: bool) -> bool {
    answer.trim().eq_ignore_ascii_case("y")
}

/// Returns `Ok(true)` when the user confirmed. `force` short-circuits to `Ok(true)` without reading
/// stdin.
pub fn confirm(prompt: &str, force: bool, default_yes: bool) -> io::Result<bool> {
    confirm_with(prompt, force, default_yes, is_affirmative)
}

/// [`confirm`] with a caller-supplied predicate, for prompts that parse answers differently.
pub fn confirm_with(
    prompt: &str,
    force: bool,
    default_yes: bool,
    predicate: fn(&str, bool) -> bool,
) -> io::Result<bool> {
    if force {
        return Ok(true);
    }

    print!("{prompt} ");
    io::stdout().flush()?;

    let mut line = String::new();
    // EOF (no stdin, e.g. a non-interactive run) reads as an empty line, so a destructive prompt
    // whose default is "no" declines rather than proceeding.
    io::stdin().lock().read_line(&mut line)?;
    Ok(predicate(&line, default_yes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_affirmative_accepts_y_and_yes() {
        assert!(is_affirmative("y", false));
        assert!(is_affirmative("Y", false));
        assert!(is_affirmative("yes", false));
        assert!(is_affirmative(" yes ", false));
        assert!(is_affirmative("YES\n", false));
    }

    #[test]
    fn is_affirmative_rejects_everything_else() {
        assert!(!is_affirmative("n", false));
        assert!(!is_affirmative("no", false));
        assert!(!is_affirmative("x", false));
        assert!(!is_affirmative("yep", false));
    }

    #[test]
    fn is_affirmative_uses_the_default_for_an_empty_line() {
        assert!(!is_affirmative("", false));
        assert!(!is_affirmative("\n", false));
        assert!(is_affirmative("", true));
        assert!(is_affirmative("   \n", true));
    }

    #[test]
    fn confirm_short_circuits_on_force_without_reading_stdin() {
        assert!(confirm("Proceed?", true, false).unwrap());
    }

    #[test]
    fn db_reset_predicate_accepts_only_y() {
        assert!(is_exactly_y("y", false));
        assert!(is_exactly_y(" Y \n", false));
        assert!(
            !is_exactly_y("yes", false),
            "db reset must keep the original's stricter parse"
        );
        assert!(!is_exactly_y("", true));
    }
}
