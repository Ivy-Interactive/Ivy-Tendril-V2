//! Regression guard for the SetupProject/AddProject promptwares: asserts the sections and
//! guidance restored in Plan 00578 stay present, so a future edit can't silently re-lose them.

use std::path::{Path, PathBuf};

fn promptwares_dir() -> Option<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../promptwares");
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

fn check_program_md(dir: &Path, promptware: &str) {
    let path = dir.join(promptware).join("Program.md");
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) => {
            eprintln!("Skipping {}: could not read {:?}: {e}", promptware, path);
            return;
        }
    };

    assert!(
        content.contains("### 3.5. Setup Artifact Production"),
        "{promptware}: missing '### 3.5. Setup Artifact Production' step"
    );

    assert!(
        content.contains("#### Environment Template Bootstrapping")
            && content.contains(".env.example"),
        "{promptware}: missing 'Environment Template Bootstrapping' section"
    );

    assert!(
        content.contains("#### Unified Monorepo Review Actions")
            && content.contains("isWorkspaceRoot"),
        "{promptware}: missing 'Unified Monorepo Review Actions' section"
    );

    assert!(
        content.contains("vp dev --open"),
        "{promptware}: missing 'vp dev --open'"
    );
    for (i, _) in content.match_indices("vp dev") {
        assert!(
            content[i..].starts_with("vp dev --open"),
            "{promptware}: found 'vp dev' not followed by ' --open' at byte offset {i}"
        );
    }

    assert!(
        content.contains("4. **Screenshots**") && content.contains("5. **CheckResult**"),
        "{promptware}: missing Screenshots/CheckResult verification ordering entries"
    );
    assert!(
        content.contains("- Screenshots verification added"),
        "{promptware}: missing 'Screenshots verification added' summary bullet"
    );

    assert!(
        !content.contains("src/apps/<app>")
            && !content.contains("src/packages/<package>")
            && !content.contains("src/crates/<crate>"),
        "{promptware}: still contains the hard-coded src/apps|packages|crates layout"
    );
    assert!(
        content.contains("Worktrees/<owner>/<repo>/src/<Project>"),
        "{promptware}: missing the generic Worktrees/<owner>/<repo>/src/<Project> condition example"
    );
}

#[test]
fn setup_project_and_add_project_keep_restored_sections() {
    let Some(dir) = promptwares_dir() else {
        eprintln!("Skipping promptware_parity_test: promptwares directory not found");
        return;
    };

    check_program_md(&dir, "SetupProject");
    check_program_md(&dir, "AddProject");
}
