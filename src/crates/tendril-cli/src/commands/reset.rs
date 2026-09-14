use crate::commands::confirm::confirm;
use crate::commands::daemon_guard::refuse_if_daemon_running;
use std::path::{Path, PathBuf};
use tendril_core::config::get_plans_dir;
use tendril_core::promptware::deployer::count_files_recursive;

/// Environment variables `reset` reports on. They are never unset by the command — see the note in
/// [`handle_reset`].
const ENV_VARS: &[&str] = &["TENDRIL_HOME", "TENDRIL_PLANS"];

#[derive(clap::Args)]
pub struct ResetArgs {
    /// Skip confirmation prompt
    #[arg(long)]
    pub force: bool,
}

/// A directory `reset` will delete. Only ever `TENDRIL_HOME` and `TENDRIL_PLANS` — no repos, no
/// worktrees, no config outside home.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResetTarget {
    pub path: PathBuf,
    pub description: String,
}

/// The directories that exist and would therefore be deleted. `home` is described by its recursive
/// file count and `plans` by its top-level folder count, as the original does; `plans` is skipped
/// when it is the same directory as `home`.
pub fn reset_targets(home: &Path, plans: &Path) -> Vec<ResetTarget> {
    let mut targets = Vec::new();

    if home.is_dir() {
        targets.push(ResetTarget {
            path: home.to_path_buf(),
            description: format!(
                "{} (exists, {} files)",
                home.display(),
                count_files_recursive(home)
            ),
        });
    }

    if plans != home && plans.is_dir() {
        targets.push(ResetTarget {
            path: plans.to_path_buf(),
            description: format!(
                "{} (exists, {} folders)",
                plans.display(),
                count_top_level_dirs(plans)
            ),
        });
    }

    targets
}

fn count_top_level_dirs(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
        .count()
}

/// The `ENV_VARS` that are actually set in this process's environment.
fn set_env_vars() -> Vec<&'static str> {
    ENV_VARS
        .iter()
        .copied()
        .filter(|name| {
            std::env::var(name)
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
        })
        .collect()
}

pub fn handle_reset(args: ResetArgs, tendril_home: &Path) -> anyhow::Result<()> {
    let plans_dir = get_plans_dir(tendril_home);

    if refuse_if_daemon_running(tendril_home, args.force, "resetting") {
        std::process::exit(1);
    }

    let targets = reset_targets(tendril_home, &plans_dir);
    if targets.is_empty() {
        println!("Nothing to reset.");
        return Ok(());
    }

    println!("The following items will be deleted:");
    println!();
    for target in &targets {
        println!("Directory: {}", target.description);
    }
    println!();

    if !confirm("Proceed with reset? [y/N]", args.force, false)? {
        println!("Cancelled.");
        return Ok(());
    }

    // Collect failures rather than aborting, so a locked plans directory does not leave home behind.
    let mut errors = Vec::new();
    for target in &targets {
        match std::fs::remove_dir_all(&target.path) {
            Ok(()) => println!("[OK] Deleted directory: {}", target.path.display()),
            Err(err) => {
                println!(
                    "[FAIL] Failed to delete directory: {}",
                    target.path.display()
                );
                errors.push(format!(
                    "Failed to delete {}: {}",
                    target.path.display(),
                    err
                ));
            }
        }
    }

    // Environment variables are reported, never removed. `reset` has no business rewriting a shell
    // rc file, and the Windows registry equivalent would make the command's blast radius depend on
    // the platform.
    let env_vars = set_env_vars();
    if !env_vars.is_empty() {
        println!();
        println!(
            "Note: remove these environment variables from your shell rc file (Linux/macOS) or"
        );
        println!("your user environment settings (Windows):");
        for name in &env_vars {
            println!("  {name}");
        }
    }

    println!();
    if errors.is_empty() {
        println!("Reset complete.");
    } else {
        println!("Reset completed with errors.");
        for error in &errors {
            println!("- {error}");
        }
    }
    println!("Please restart your terminal for environment variable changes to take effect.");

    if !errors.is_empty() {
        std::process::exit(1);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reset_targets_is_empty_for_a_nonexistent_home() {
        let dir = scratch_dir("tendril-reset-missing");
        let home = dir.join("home");
        let plans = dir.join("plans");

        assert!(reset_targets(&home, &plans).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reset_targets_lists_home_and_a_distinct_plans_dir() {
        let dir = scratch_dir("tendril-reset-both");
        let home = dir.join("home");
        let plans = dir.join("plans");
        std::fs::create_dir_all(home.join("Jobs")).unwrap();
        std::fs::write(home.join("tendril.db"), "db").unwrap();
        std::fs::write(home.join("Jobs").join("001.md"), "log").unwrap();
        std::fs::create_dir_all(plans.join("00001-First")).unwrap();
        std::fs::create_dir_all(plans.join("00002-Second")).unwrap();

        let targets = reset_targets(&home, &plans);

        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].path, home);
        assert!(
            targets[0].description.ends_with("(exists, 2 files)"),
            "home is described by its recursive file count: {}",
            targets[0].description
        );
        assert_eq!(targets[1].path, plans);
        assert!(
            targets[1].description.ends_with("(exists, 2 folders)"),
            "plans is described by its top-level folder count: {}",
            targets[1].description
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reset_targets_skips_plans_when_it_is_home() {
        let dir = scratch_dir("tendril-reset-same");
        let home = dir.join("home");
        std::fs::create_dir_all(&home).unwrap();

        let targets = reset_targets(&home, &home);

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].path, home);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reset_targets_lists_only_home_when_plans_is_missing() {
        let dir = scratch_dir("tendril-reset-no-plans");
        let home = dir.join("home");
        std::fs::create_dir_all(&home).unwrap();

        let targets = reset_targets(&home, &dir.join("plans"));

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].path, home);

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod arg_tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    #[command(name = "tendril")]
    struct TestCli {
        #[command(flatten)]
        args: ResetArgs,
    }

    #[test]
    fn force_defaults_to_false_and_parses() {
        assert!(!TestCli::try_parse_from(["tendril"]).unwrap().args.force);
        assert!(
            TestCli::try_parse_from(["tendril", "--force"])
                .unwrap()
                .args
                .force
        );
    }
}
