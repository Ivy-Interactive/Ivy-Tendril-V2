//! The instructions handed to a coding agent running in an interactive chat session.
//!
//! `agent_instructions.md` is the single source of truth for that text: `tendril
//! agent-instructions` prints it, and anything else that needs it compiles it from here rather than
//! keeping its own copy.

use std::path::Path;

/// The uncompiled template, with its `{TENDRIL_HOME}` and `{PLAN_FOLDER}` placeholders intact.
pub const TEMPLATE: &str = include_str!("agent_instructions.md");

/// Renders `TEMPLATE` for a specific installation.
///
/// Paths are written with forward slashes and no trailing slash even on Windows: the agent pastes
/// them into shell commands and markdown, where a backslash is an escape character.
pub fn compile(tendril_home: &Path, plans_dir: &Path) -> String {
    TEMPLATE
        .replace("{TENDRIL_HOME}", &normalize(tendril_home))
        .replace("{PLAN_FOLDER}", &normalize(plans_dir))
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn substitutes_both_placeholders() {
        let compiled = compile(
            Path::new("/home/alice/.tendril"),
            Path::new("/home/alice/.tendril/Plans"),
        );

        assert!(compiled.contains("**TENDRIL_HOME**: `/home/alice/.tendril`"));
        assert!(compiled.contains("**Plans folder**: `/home/alice/.tendril/Plans`"));
        assert!(
            !compiled.contains("{TENDRIL_HOME}") && !compiled.contains("{PLAN_FOLDER}"),
            "no placeholder may survive compilation"
        );
    }

    #[test]
    fn leaves_no_upper_snake_placeholder_behind() {
        // `{ID}` is part of the document's description of the plan folder naming scheme
        // (`{ID}-{Title}/`), not something `compile` is meant to fill in.
        const DOCUMENTED: [&str; 1] = ["{ID}"];

        let compiled = compile(Path::new("/tmp/home"), Path::new("/tmp/home/Plans"));
        let leftovers: Vec<&str> = compiled
            .match_indices('{')
            .filter_map(|(start, _)| {
                let rest = &compiled[start + 1..];
                let end = rest.find('}')?;
                let inner = &rest[..end];
                let is_placeholder = !inner.is_empty()
                    && inner
                        .chars()
                        .all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit());
                let text = &compiled[start..start + end + 2];
                (is_placeholder && !DOCUMENTED.contains(&text)).then_some(text)
            })
            .collect();

        assert!(
            leftovers.is_empty(),
            "unsubstituted placeholders: {leftovers:?}"
        );
    }

    #[test]
    fn windows_paths_come_out_with_forward_slashes() {
        let compiled = compile(
            &PathBuf::from(r"C:\Users\x\.tendril"),
            &PathBuf::from(r"C:\Users\x\.tendril\Plans\"),
        );

        assert!(compiled.contains("**TENDRIL_HOME**: `C:/Users/x/.tendril`"));
        assert!(
            compiled.contains("**Plans folder**: `C:/Users/x/.tendril/Plans`"),
            "the trailing separator is trimmed"
        );
        assert!(
            !compiled.contains('\\'),
            "a backslash in the rendered text would be read as a markdown or shell escape"
        );
    }

    #[test]
    fn the_template_ends_with_exactly_one_newline() {
        // `tendril agent-instructions` writes the compiled text with no newline of its own, so the
        // asset decides how the output ends.
        assert!(TEMPLATE.ends_with('\n'));
        assert!(!TEMPLATE.ends_with("\n\n"));
    }
}
