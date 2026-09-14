//! `tendril project-analyzer` end-to-end, through the real binary.
//!
//! AddProject and SetupProject derive a project's Stack Descriptor Hash from this stdout, so these
//! tests run the actual command rather than the library function: the path resolution and the
//! "nothing but the report on stdout" rule are as much part of the contract as the YAML shape.
//! Ported from the legacy `ProjectAnalyzerCommandTests`.

use std::path::{Path, PathBuf};
use std::process::Command;

/// A throwaway fixture folder, removed on drop.
struct Fixture {
    path: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

impl Fixture {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-analyzer-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).expect("create fixture dir");
        Self { path }
    }

    fn write(&self, relative: &str, contents: &str) {
        let target = self.path.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).expect("create fixture parent dir");
        }
        std::fs::write(target, contents).expect("write fixture file");
    }
}

/// Runs `tendril project-analyzer <folder>` from `cwd` and returns its stdout.
fn analyze_from(cwd: &Path, folder: &str) -> String {
    let out = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .args(["project-analyzer", folder])
        .current_dir(cwd)
        .output()
        .expect("run tendril project-analyzer");

    assert!(
        out.status.success(),
        "project-analyzer failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).expect("stdout is utf-8")
}

fn analyze(folder: &Path) -> String {
    analyze_from(Path::new("."), &folder.to_string_lossy())
}

#[test]
fn analyzer_detects_node_stack_and_trims_report() {
    let fixture = Fixture::new("node");
    fixture.write(
        "package.json",
        r#"{
  "name": "web",
  "dependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "devDependencies": { "vite": "^6.0.0", "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
"#,
    );
    fixture.write("tsconfig.json", "{}\n");
    fixture.write("src/main.tsx", "export const App = () => null;\n");

    let yaml = analyze(&fixture.path);
    let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("output parses as YAML");

    assert!(parsed.get("components").is_some(), "report: {}", yaml);
    assert!(yaml.contains("React"), "React should be detected: {}", yaml);
    assert!(yaml.contains("TypeScript"), "report: {}", yaml);

    // The trimming rules are what keep the Stack Descriptor Hash stable, so assert the fields the
    // legacy tests assert the absence of.
    for banned in ["manifests", "sizeBytes", "metadata", "evidence"] {
        assert!(
            !yaml.contains(banned),
            "'{}' must never be emitted: {}",
            banned,
            yaml
        );
    }
    assert!(
        !yaml.contains("confidence: low"),
        "low-confidence technologies are dropped: {}",
        yaml
    );
}

#[test]
fn analyzer_empty_folder_returns_well_formed_yaml() {
    let fixture = Fixture::new("empty");

    // An empty folder is not an error — SetupProject hashes whatever comes back.
    let yaml = analyze(&fixture.path);
    let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("output parses as YAML");
    assert!(
        parsed.get("components").is_none() && parsed.get("languages").is_none(),
        "empty folder should produce an empty report, got: {}",
        yaml
    );
}

#[test]
fn analyzer_detects_rust_workspace() {
    let fixture = Fixture::new("rust");
    fixture.write(
        "Cargo.toml",
        "[workspace]\nmembers = [\"crates/alpha\", \"crates/beta\"]\n",
    );
    fixture.write(
        "crates/alpha/Cargo.toml",
        "[package]\nname = \"alpha\"\nversion = \"0.1.0\"\n\n[dependencies]\naxum = \"0.8\"\n",
    );
    fixture.write("crates/alpha/src/main.rs", "fn main() {}\n");
    fixture.write(
        "crates/beta/Cargo.toml",
        "[package]\nname = \"beta\"\nversion = \"0.1.0\"\n",
    );
    fixture.write("crates/beta/src/lib.rs", "pub fn f() {}\n");

    let yaml = analyze(&fixture.path);
    let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("output parses as YAML");

    let components = parsed
        .get("components")
        .and_then(|c| c.as_sequence())
        .expect("components present");
    let paths: Vec<&str> = components
        .iter()
        .filter_map(|c| c.get("relativePath").and_then(|p| p.as_str()))
        .collect();
    assert!(paths.contains(&"crates/alpha"), "paths: {:?}", paths);
    assert!(paths.contains(&"crates/beta"), "paths: {:?}", paths);

    let root = components
        .iter()
        .find(|c| c.get("relativePath").and_then(|p| p.as_str()) == Some("."))
        .expect("the analyzed root is a component");
    assert_eq!(
        root.get("isWorkspaceRoot").and_then(|v| v.as_bool()),
        Some(true),
        "a Cargo workspace root should be flagged: {}",
        yaml
    );
}

#[test]
fn analyzer_relative_and_dot_paths_resolve() {
    let fixture = Fixture::new("paths");
    fixture.write(
        "app/package.json",
        r#"{ "name": "app", "dependencies": { "react": "^19.0.0" } }"#,
    );
    fixture.write("app/src/main.tsx", "export const App = () => null;\n");

    // The prompts pass `.` and relative paths, never absolute ones.
    let from_dot = analyze_from(&fixture.path.join("app"), ".");
    let from_relative = analyze_from(&fixture.path, "./app");
    let from_parent_hop = analyze_from(&fixture.path.join("app"), "../app");

    assert!(
        from_dot.contains("React"),
        "`.` should resolve: {}",
        from_dot
    );
    assert_eq!(from_dot, from_relative);
    assert_eq!(from_dot, from_parent_hop);
}

#[test]
fn analyzer_missing_folder_fails_with_the_path() {
    let out = Command::new(env!("CARGO_BIN_EXE_tendril"))
        .args(["project-analyzer", "/definitely/not/a/folder"])
        .output()
        .expect("run tendril project-analyzer");

    assert!(!out.status.success(), "a missing folder must fail");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("Folder not found: /definitely/not/a/folder"),
        "stderr: {}",
        stderr
    );
    assert!(
        out.stdout.is_empty(),
        "nothing should reach stdout on failure"
    );
}
