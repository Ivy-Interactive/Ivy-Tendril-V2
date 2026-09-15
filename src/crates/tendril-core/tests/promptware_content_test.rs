//! Guards against the ExecutePlan worktree artifact-copy safety rules being silently dropped
//! again, as happened once already (Program.md diverged from the C# original with no test
//! catching it).

use std::path::{Path, PathBuf};

const REFERENCE: &str =
    "the C# original at src/Ivy.Tendril/Promptwares/ExecutePlan/Program.md in ivy-tendril";

fn execute_plan_program_md() -> String {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let relative = Path::new("src/promptwares/ExecutePlan/Program.md");

    let mut dir = manifest_dir.as_path();
    loop {
        let candidate = dir.join(relative);
        if candidate.is_file() {
            return std::fs::read_to_string(&candidate)
                .unwrap_or_else(|e| panic!("failed to read {}: {e}", candidate.display()));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => panic!(
                "could not locate {} by walking up from CARGO_MANIFEST_DIR ({}); the ExecutePlan \
                 promptware may have moved",
                relative.display(),
                manifest_dir.display()
            ),
        }
    }
}

#[test]
fn copy_on_write_clone_rule_present() {
    let content = execute_plan_program_md();
    assert!(
        content.contains("cp -c -R"),
        "ExecutePlan Program.md is missing the APFS copy-on-write clone (`cp -c -R`) rule for \
         artifact copies — restore it from {REFERENCE}"
    );
    assert!(
        content.contains("--reflink=auto"),
        "ExecutePlan Program.md is missing the btrfs/XFS reflink (`cp -r --reflink=auto`) \
         fallback for artifact copies — restore it from {REFERENCE}"
    );
}

#[test]
fn node_modules_prohibition_rule_present() {
    let content = execute_plan_program_md();
    assert!(
        content.contains("Never deep-copy `node_modules`"),
        "ExecutePlan Program.md is missing the never-deep-copy-node_modules rule — restore it \
         from {REFERENCE}"
    );
}

#[test]
fn scoping_rule_present() {
    let content = execute_plan_program_md();
    assert!(
        content.contains("Scope the copy and the build"),
        "ExecutePlan Program.md is missing the scope-the-copy-and-the-build rule — restore it \
         from {REFERENCE}"
    );
}

#[test]
fn target_dir_guidance_present() {
    let content = execute_plan_program_md();
    assert!(
        content.contains("Never deep-copy `target/`"),
        "ExecutePlan Program.md is missing guidance on never deep-copying the cargo `target/` \
         directory — restore it from {REFERENCE}"
    );
}

#[test]
fn verification_synchrony_rule_present() {
    let content = execute_plan_program_md();
    assert!(
        content.contains("Run every verification synchronously"),
        "ExecutePlan Program.md is missing the verification-synchrony rule (never spawn a \
         verification as a background task and poll it) — restore it from {REFERENCE}"
    );
}

fn create_pr_program_md() -> String {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let relative = Path::new("src/promptwares/CreatePr/Program.md");

    let mut dir = manifest_dir.as_path();
    loop {
        let candidate = dir.join(relative);
        if candidate.is_file() {
            return std::fs::read_to_string(&candidate)
                .unwrap_or_else(|e| panic!("failed to read {}: {e}", candidate.display()));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => panic!(
                "could not locate {} by walking up from CARGO_MANIFEST_DIR ({}); the CreatePr \
                 promptware may have moved",
                relative.display(),
                manifest_dir.display()
            ),
        }
    }
}

#[test]
fn create_pr_conflict_resolution_formatting_and_linting_rule_present() {
    let content = create_pr_program_md();
    assert!(
        content.contains("Re-run formatting, linting, and build checks before committing"),
        "CreatePr Program.md's merge-conflict resolution step is missing the rule to re-run \
         formatting, linting, and build verifications on hand-resolved files before committing \
         and pushing — restore it under '#### Conflict Resolution' in \
         src/promptwares/CreatePr/Program.md"
    );
}
