use crate::error::Result;
use std::path::{Path, PathBuf};

/// Per-promptware directories that belong to the running installation, not to the shipped program:
/// `Memory/` holds learned reflections and `Tools/` holds agent- and user-authored tools. Both must
/// survive an update.
pub const PRESERVED_DIRS: &[&str] = &["Memory", "Tools"];

pub const STANDARD_PROMPTWARES: &[&str] = &[
    "CreatePlan",
    "ExecutePlan",
    "UpdatePlan",
    "SplitPlan",
    "ExpandPlan",
    "RetryPlan",
    "CreatePr",
    "CreateIssue",
    "SetupProject",
    "AddProject",
    "SyncRepo",
    "UpdateProject",
];

/// Locates the shipped `src/promptwares` directory. `TENDRIL_PROMPTWARES` wins when it points at a
/// directory; otherwise the common repo-relative locations are probed. Returns `None` when running
/// from a distributed binary with no source tree nearby.
pub fn find_promptware_source() -> Option<PathBuf> {
    find_promptware_source_with_override(std::env::var("TENDRIL_PROMPTWARES").ok().as_deref())
}

/// [`find_promptware_source`] with the `TENDRIL_PROMPTWARES` value passed in, so tests can exercise
/// the override without mutating process-wide environment that sibling tests read.
pub fn find_promptware_source_with_override(override_dir: Option<&str>) -> Option<PathBuf> {
    if let Some(from_env) = override_dir {
        let candidate = PathBuf::from(from_env.trim());
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    const CANDIDATES: &[&str] = &[
        "src/promptwares",
        "../src/promptwares",
        "../../src/promptwares",
        "promptwares",
        "../promptwares",
        "../../promptwares",
    ];

    CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|candidate| candidate.is_dir())
}

pub fn deploy_standard_promptwares(target_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(target_dir)?;

    let source_dir = find_promptware_source();

    for name in STANDARD_PROMPTWARES {
        let p_target = target_dir.join(name);
        std::fs::create_dir_all(p_target.join("Tools"))?;
        std::fs::create_dir_all(p_target.join("Memory"))?;

        if let Some(src) = source_dir.as_deref() {
            let p_src = src.join(name);
            if p_src.exists() {
                copy_dir_recursive(&p_src, &p_target)?;
                continue;
            }
        }

        let prog_file = p_target.join("Program.md");
        if !prog_file.exists() {
            let stub = format!("# {}\n\nInstructions for promptware {}.\n", name, name);
            std::fs::write(prog_file, stub)?;
        }
    }

    Ok(())
}

/// What `update_promptwares` did to one promptware.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptwareUpdate {
    pub name: String,
    pub memory_files_preserved: usize,
    pub tool_files_preserved: usize,
}

/// Lists the promptware directories `update_promptwares` would refresh from `source_dir`, sorted by
/// name. Used by `--dry-run` so it reports the same set the real run would touch.
pub fn list_promptware_sources(source_dir: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in std::fs::read_dir(source_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip dotted directories so a stray `.git` or scratch dir is never treated as a promptware.
        if name.starts_with('.') {
            continue;
        }
        names.push(name);
    }
    names.sort();
    Ok(names)
}

/// Refreshes each promptware in `target_dir` from `source_dir`, replacing program files wholesale
/// while preserving the promptware's existing [`PRESERVED_DIRS`] contents.
///
/// Unlike [`deploy_standard_promptwares`], which overlays files and therefore leaves stale program
/// files behind, this replaces the promptware directory — so `Memory/` and `Tools/` are moved aside
/// first and moved back afterwards.
pub fn update_promptwares(source_dir: &Path, target_dir: &Path) -> Result<Vec<PromptwareUpdate>> {
    std::fs::create_dir_all(target_dir)?;

    // The scratch dir must sit on the same volume as `target_dir` for `rename` to work, so it goes
    // next to `target_dir` rather than in `std::env::temp_dir()`, which is often another volume.
    let scratch_root = target_dir.parent().unwrap_or(target_dir).join(format!(
        ".promptwares-updating-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&scratch_root)?;

    let result = update_all(source_dir, target_dir, &scratch_root);
    let _ = std::fs::remove_dir_all(&scratch_root);
    result
}

fn update_all(
    source_dir: &Path,
    target_dir: &Path,
    scratch_root: &Path,
) -> Result<Vec<PromptwareUpdate>> {
    let mut updates = Vec::new();

    for name in list_promptware_sources(source_dir)? {
        let p_source = source_dir.join(&name);
        let p_target = target_dir.join(&name);

        let mut preserved: Vec<(PathBuf, PathBuf)> = Vec::new();
        for keep in PRESERVED_DIRS {
            let existing = p_target.join(keep);
            if existing.is_dir() {
                let aside = scratch_root.join(format!("{}-{}", name, keep));
                std::fs::rename(&existing, &aside)?;
                preserved.push((existing, aside));
            }
        }

        // A failure between the moves above and the restore below would lose learned memory, which
        // is worse than leaving a half-updated program folder — so restore before propagating.
        if let Err(err) = replace_promptware(&p_source, &p_target, &preserved) {
            restore_preserved(&preserved);
            return Err(err);
        }

        updates.push(PromptwareUpdate {
            name,
            memory_files_preserved: count_files_recursive(&p_target.join("Memory")),
            tool_files_preserved: count_files_recursive(&p_target.join("Tools")),
        });
    }

    Ok(updates)
}

fn replace_promptware(
    source: &Path,
    target: &Path,
    preserved: &[(PathBuf, PathBuf)],
) -> Result<()> {
    if target.exists() {
        std::fs::remove_dir_all(target)?;
    }
    copy_dir_recursive(source, target)?;

    // Every `src/promptwares/*/Memory` ships only a `.gitkeep` placeholder. Drop whatever the source
    // shipped under a preserved directory so a placeholder can never land on top of real memory.
    for keep in PRESERVED_DIRS {
        let shipped = target.join(keep);
        if shipped.exists() {
            std::fs::remove_dir_all(&shipped)?;
        }
    }

    for (original, aside) in preserved {
        std::fs::rename(aside, original)?;
    }

    // Guarantee both directories exist afterwards, whether or not anything was preserved.
    for keep in PRESERVED_DIRS {
        std::fs::create_dir_all(target.join(keep))?;
    }

    Ok(())
}

fn restore_preserved(preserved: &[(PathBuf, PathBuf)]) {
    for (original, aside) in preserved {
        if !aside.exists() {
            continue;
        }
        if let Some(parent) = original.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if original.exists() {
            let _ = std::fs::remove_dir_all(original);
        }
        let _ = std::fs::rename(aside, original);
    }
}

/// Counts files (not directories) under `dir`, recursively. Returns 0 when `dir` does not exist.
pub fn count_files_recursive(dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };

    let mut count = 0;
    for entry in entries.flatten() {
        match entry.file_type() {
            Ok(ft) if ft.is_dir() => count += count_files_recursive(&entry.path()),
            Ok(_) => count += 1,
            Err(_) => {}
        }
    }
    count
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ft.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if ft.is_file() {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deployer_finds_src_promptwares() {
        let temp_target =
            std::env::temp_dir().join(format!("tendril_test_{}", uuid::Uuid::new_v4()));
        let result = deploy_standard_promptwares(&temp_target);
        assert!(
            result.is_ok(),
            "deploy_standard_promptwares should succeed: {:?}",
            result.err()
        );

        for name in STANDARD_PROMPTWARES {
            let prog = temp_target.join(name).join("Program.md");
            assert!(prog.exists(), "Program.md should exist for {}", name);
        }

        // Verify that existing promptwares were copied from src/promptwares rather than stubbed
        let create_plan_prog = temp_target.join("CreatePlan").join("Program.md");
        let content = std::fs::read_to_string(&create_plan_prog).unwrap();
        assert!(
            !content.starts_with("# CreatePlan\n\nInstructions for promptware"),
            "CreatePlan should have been copied from src/promptwares, not stubbed"
        );

        let _ = std::fs::remove_dir_all(&temp_target);
    }
}

#[cfg(test)]
mod update_tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        source: PathBuf,
        target: PathBuf,
    }

    impl Fixture {
        /// Builds a source tree shipping `Promptware/Program.md` plus a placeholder
        /// `Promptware/Memory/.gitkeep`, mirroring what `src/promptwares` actually contains.
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("tendril-pw-{}", uuid::Uuid::new_v4().simple()));
            let source = root.join("source");
            let target = root.join("Promptwares");
            std::fs::create_dir_all(source.join("Promptware").join("Memory")).unwrap();
            std::fs::write(source.join("Promptware").join("Program.md"), "new program").unwrap();
            std::fs::write(
                source.join("Promptware").join("Memory").join(".gitkeep"),
                "",
            )
            .unwrap();
            Fixture {
                root,
                source,
                target,
            }
        }

        fn write_target(&self, relative: &str, contents: &str) {
            let path = self.target.join("Promptware").join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }

        fn read_target(&self, relative: &str) -> String {
            std::fs::read_to_string(self.target.join("Promptware").join(relative)).unwrap()
        }

        fn target_path(&self, relative: &str) -> PathBuf {
            self.target.join("Promptware").join(relative)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn update_preserves_memory_and_tools() {
        let fx = Fixture::new();
        fx.write_target("Program.md", "old program");
        fx.write_target("Memory/learned.md", "hard-won lesson");
        fx.write_target("Tools/custom.md", "a tool");

        let updates = update_promptwares(&fx.source, &fx.target).unwrap();

        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].name, "Promptware");
        assert_eq!(updates[0].memory_files_preserved, 1);
        assert_eq!(updates[0].tool_files_preserved, 1);

        assert_eq!(fx.read_target("Program.md"), "new program");
        assert_eq!(fx.read_target("Memory/learned.md"), "hard-won lesson");
        assert_eq!(fx.read_target("Tools/custom.md"), "a tool");
        assert!(
            !fx.target_path("Memory/.gitkeep").exists(),
            "the shipped placeholder must not replace the preserved Memory directory"
        );
    }

    #[test]
    fn update_creates_missing_preserved_dirs() {
        let fx = Fixture::new();
        fx.write_target("Program.md", "old program");

        let updates = update_promptwares(&fx.source, &fx.target).unwrap();

        assert_eq!(updates[0].memory_files_preserved, 0);
        assert_eq!(updates[0].tool_files_preserved, 0);
        assert!(fx.target_path("Memory").is_dir());
        assert!(fx.target_path("Tools").is_dir());
    }

    #[test]
    fn shipped_memory_file_does_not_overwrite_learned_memory() {
        let fx = Fixture::new();
        std::fs::write(
            fx.source
                .join("Promptware")
                .join("Memory")
                .join("learned.md"),
            "shipped memory",
        )
        .unwrap();
        fx.write_target("Memory/learned.md", "learned memory");

        update_promptwares(&fx.source, &fx.target).unwrap();

        assert_eq!(fx.read_target("Memory/learned.md"), "learned memory");
    }

    #[test]
    fn update_is_idempotent_for_memory() {
        let fx = Fixture::new();
        fx.write_target("Memory/learned.md", "hard-won lesson");

        update_promptwares(&fx.source, &fx.target).unwrap();
        let second = update_promptwares(&fx.source, &fx.target).unwrap();

        assert_eq!(second[0].memory_files_preserved, 1);
        assert_eq!(fx.read_target("Memory/learned.md"), "hard-won lesson");
    }

    #[test]
    fn update_removes_stale_program_files() {
        let fx = Fixture::new();
        fx.write_target("Stale.md", "no longer shipped");
        fx.write_target("Memory/learned.md", "hard-won lesson");

        update_promptwares(&fx.source, &fx.target).unwrap();

        assert!(
            !fx.target_path("Stale.md").exists(),
            "update replaces the promptware folder rather than overlaying it"
        );
        assert_eq!(fx.read_target("Memory/learned.md"), "hard-won lesson");
    }

    #[test]
    fn update_leaves_no_scratch_directory_behind() {
        let fx = Fixture::new();
        fx.write_target("Memory/learned.md", "hard-won lesson");

        update_promptwares(&fx.source, &fx.target).unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(&fx.root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|name| name.starts_with(".promptwares-updating-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "scratch dirs left behind: {leftovers:?}"
        );
    }

    #[test]
    fn list_promptware_sources_skips_dotted_and_sorts() {
        let fx = Fixture::new();
        std::fs::create_dir_all(fx.source.join("Another")).unwrap();
        std::fs::create_dir_all(fx.source.join(".git")).unwrap();
        std::fs::write(fx.source.join("README.md"), "not a promptware").unwrap();

        let names = list_promptware_sources(&fx.source).unwrap();

        assert_eq!(names, vec!["Another".to_string(), "Promptware".to_string()]);
    }

    #[test]
    fn find_promptware_source_honours_env_override() {
        let fx = Fixture::new();
        let found = find_promptware_source_with_override(Some(&fx.source.to_string_lossy()));

        assert_eq!(
            found.map(|p| std::fs::canonicalize(p).unwrap()),
            Some(std::fs::canonicalize(&fx.source).unwrap())
        );
    }

    #[test]
    fn find_promptware_source_ignores_a_nonexistent_override() {
        let fx = Fixture::new();
        let missing = fx.root.join("nope").to_string_lossy().to_string();

        // Falls through to the repo-relative candidates, which resolve from the crate directory
        // under `cargo test`.
        assert_ne!(
            find_promptware_source_with_override(Some(&missing)),
            Some(PathBuf::from(missing))
        );
    }
}
