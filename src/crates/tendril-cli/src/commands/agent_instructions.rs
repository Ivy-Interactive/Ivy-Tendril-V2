//! `tendril agent-instructions` — prints the instructions for a coding agent running in an
//! interactive chat session, with this installation's paths filled in.
//!
//! The text itself lives in `tendril-core`'s `agents/agent_instructions.md`, so the daemon and this
//! command cannot drift apart.

use anyhow::Result;
use std::io::Write;
use std::path::Path;
use tendril_core::agents::instructions;
use tendril_core::config::get_plans_dir;

/// Writes the compiled instructions with no trailing newline of its own — the output is meant to be
/// pasted into an agent's system prompt, so anything this adds would be part of the prompt.
fn write_instructions(out: &mut impl Write, tendril_home: &Path, plans_dir: &Path) -> Result<()> {
    write!(out, "{}", instructions::compile(tendril_home, plans_dir))?;
    Ok(())
}

pub fn handle_agent_instructions(tendril_home: &Path) -> Result<()> {
    let plans_dir = get_plans_dir(tendril_home);
    let stdout = std::io::stdout();
    let mut lock = stdout.lock();
    write_instructions(&mut lock, tendril_home, &plans_dir)?;
    lock.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prints_the_compiled_template_and_nothing_else() {
        let home = Path::new("/tmp/tendril-home");
        let plans = Path::new("/tmp/tendril-home/Plans");

        let mut buf = Vec::new();
        write_instructions(&mut buf, home, plans).unwrap();
        let printed = String::from_utf8(buf).unwrap();

        assert_eq!(
            printed,
            instructions::compile(home, plans),
            "the command must print exactly what `compile` returns"
        );
        assert!(
            printed.ends_with('\n') && !printed.ends_with("\n\n"),
            "no newline is added on top of the asset's own"
        );
    }
}
