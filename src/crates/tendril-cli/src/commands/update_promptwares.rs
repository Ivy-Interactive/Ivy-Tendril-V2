use std::path::{Path, PathBuf};
use tendril_core::promptware::deployer::{
    count_files_recursive, find_promptware_source, list_promptware_sources, update_promptwares,
    PRESERVED_DIRS,
};

#[derive(clap::Args)]
pub struct UpdatePromptwaresArgs {
    /// Print what would change without writing anything
    #[arg(long)]
    pub dry_run: bool,

    /// Directory to deploy from (defaults to the discovered src/promptwares)
    #[arg(long)]
    pub source: Option<PathBuf>,
}

pub fn handle_update_promptwares(
    args: UpdatePromptwaresArgs,
    tendril_home: &Path,
) -> anyhow::Result<()> {
    let Some(source) = args.source.or_else(find_promptware_source) else {
        println!("Error: no promptware source found. Set TENDRIL_PROMPTWARES or pass --source.");
        std::process::exit(1);
    };

    if !source.is_dir() {
        println!(
            "Error: promptware source is not a directory: {}",
            source.display()
        );
        std::process::exit(1);
    }

    let target = tendril_home.join("Promptwares");

    if args.dry_run {
        println!("Would update promptwares in {}...", target.display());
        for name in list_promptware_sources(&source)? {
            let p_target = target.join(&name);
            let preserved: Vec<String> = PRESERVED_DIRS
                .iter()
                .map(|keep| format!("{keep}: {}", count_files_recursive(&p_target.join(keep))))
                .collect();
            let verb = if p_target.exists() {
                "replace"
            } else {
                "install"
            };
            println!(
                "  {name}: would {verb} program files, preserve {}",
                preserved.join(", ")
            );
        }
        println!("Dry run — nothing written.");
        return Ok(());
    }

    println!("Updating promptwares in {}...", target.display());
    for update in update_promptwares(&source, &target)? {
        println!(
            "  {}: preserved {} memory file(s), {} tool file(s)",
            update.name, update.memory_files_preserved, update.tool_files_preserved
        );
    }
    println!("Done.");

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    #[command(name = "tendril")]
    struct TestCli {
        #[command(flatten)]
        args: UpdatePromptwaresArgs,
    }

    fn parse(args: &[&str]) -> UpdatePromptwaresArgs {
        TestCli::try_parse_from(args).unwrap().args
    }

    #[test]
    fn flags_default_to_off() {
        let args = parse(&["tendril"]);
        assert!(!args.dry_run);
        assert!(args.source.is_none());
    }

    #[test]
    fn dry_run_and_source_parse() {
        assert!(parse(&["tendril", "--dry-run"]).dry_run);
        assert_eq!(
            parse(&["tendril", "--source", "/tmp/promptwares"]).source,
            Some(PathBuf::from("/tmp/promptwares"))
        );
    }
}
