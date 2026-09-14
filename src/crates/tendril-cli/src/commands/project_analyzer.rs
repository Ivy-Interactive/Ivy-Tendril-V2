use std::path::Path;
use tendril_core::stack::analyze_to_yaml;

/// Prints a trimmed YAML stack report for a folder.
///
/// `AddProject` / `SetupProject` derive a project's Stack Descriptor Hash from this output, so
/// nothing decorates it: stdout is the report and only the report.
pub fn handle_project_analyzer(folder: &str) -> anyhow::Result<()> {
    // The prompts pass `.` and relative paths, so resolve before checking.
    let resolved = std::fs::canonicalize(Path::new(folder))
        .map_err(|_| anyhow::anyhow!("Folder not found: {}", folder))?;

    if !resolved.is_dir() {
        anyhow::bail!("Folder not found: {}", folder);
    }

    print!("{}", analyze_to_yaml(&resolved)?);
    Ok(())
}
