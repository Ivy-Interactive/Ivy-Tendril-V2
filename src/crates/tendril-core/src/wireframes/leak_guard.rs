//! Finds a plan's wireframes in its product changes.
//!
//! Ported from V1's `Services/Wireframes/WireframeLeakGuard.cs`.
//!
//! Wireframes are throwaway plan material: they show a person what will be built and guide the agent
//! building it, and nothing else. A prompt can tell an executing agent not to copy one, but that
//! agent has an unrestricted shell, so the guarantee has to come from a check it cannot skip. This is
//! that check. Tendril runs it when an execution job finishes, before a PR is created, and before a
//! plan is marked Completed.
//!
//! It inspects only *changed* files, so a repo that legitimately contains wireframe tooling is not
//! flagged for code the plan never touched.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::wireframes::FOLDER_NAME;

/// Consecutive meaningful lines a file must share with a wireframe to count as pasted.
pub const PASTED_RUN_LENGTH: usize = 8;

/// A whole-file copy is only claimed for a source with at least this many meaningful lines.
const MIN_COPIED_FILE_LINES: usize = 5;

const MAX_INSPECTED_BYTES: u64 = 1_000_000;

const SOURCE_EXTENSIONS: [&str; 6] = ["tsx", "ts", "jsx", "js", "css", "html"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireframeLeakKind {
    /// A file sits at a wireframe project's path: `Wireframes/<name>/src/` or `.wireframe/`.
    WireframePath,
    /// A file carries the `@tendril-wireframe` marker every scaffolded file starts with.
    Marker,
    /// A file imports, requires or depends on the `tendril-wireframes` library.
    LibraryReference,
    /// A file's content is a wireframe source file, whitespace aside.
    CopiedFile,
    /// A file contains a run of lines lifted from a wireframe source file.
    PastedLines,
}

/// One place a plan's wireframe turned up in product code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireframeLeak {
    pub worktree: String,
    pub path: String,
    pub line: Option<usize>,
    pub kind: WireframeLeakKind,
    pub detail: String,
}

impl std::fmt::Display for WireframeLeak {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.worktree, self.path)?;
        if let Some(line) = self.line {
            write!(f, ":{line}")?;
        }
        write!(f, ": {}", self.detail)
    }
}

/// Where the last failed check is written, for the plan's failure callout.
pub fn report_path(plan_folder: &Path) -> PathBuf {
    plan_folder.join("Verification").join("WireframeLeak.md")
}

/// A reviewer-facing explanation, for the failure callout and the CLI.
pub fn describe(leaks: &[WireframeLeak]) -> String {
    let mut out = String::new();
    out.push_str(
        "Wireframe code was found in this plan's product changes. Wireframes are throwaway plan material: \n",
    );
    out.push_str(
        "build the screen with the project's own components instead, and remove these before the plan can move on.\n\n",
    );
    for leak in leaks {
        let line = leak.line.map(|l| format!(":{l}")).unwrap_or_default();
        out.push_str(&format!(
            "- `{}/{}{}` {}\n",
            leak.worktree, leak.path, line, leak.detail
        ));
    }
    out
}

/// Writes [`report_path`] when there are leaks and removes it when there are none.
pub fn write_report(plan_folder: &Path, leaks: &[WireframeLeak]) -> std::io::Result<()> {
    let path = report_path(plan_folder);
    if leaks.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(
        &path,
        format!("# Wireframe Leak\n\n## Issues Found\n\n{}", describe(leaks)),
    )
}

/// Whole-file and line-run hashes of every source file in a plan's wireframes.
#[derive(Debug, Default)]
pub struct Fingerprints {
    files: BTreeMap<String, String>,
    runs: BTreeMap<String, String>,
}

impl Fingerprints {
    pub fn build(wireframes_dir: &Path) -> Self {
        let mut fingerprints = Self::default();
        let Ok(projects) = std::fs::read_dir(wireframes_dir) else {
            return fingerprints;
        };

        for project in projects.flatten() {
            let src = project.path().join("src");
            if !src.is_dir() {
                continue;
            }
            for entry in walkdir::WalkDir::new(&src)
                .into_iter()
                .filter_map(Result::ok)
                .filter(|e| e.file_type().is_file())
            {
                let is_source = entry
                    .path()
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| {
                        SOURCE_EXTENSIONS
                            .iter()
                            .any(|want| want.eq_ignore_ascii_case(e))
                    });
                if !is_source {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(entry.path()) else {
                    continue;
                };
                let name = entry
                    .path()
                    .strip_prefix(wireframes_dir)
                    .unwrap_or(entry.path())
                    .to_string_lossy()
                    .replace('\\', "/");

                let meaningful = meaningful(&text);
                if meaningful.len() >= MIN_COPIED_FILE_LINES {
                    fingerprints
                        .files
                        .entry(hash_lines(meaningful.iter().map(|m| m.1.as_str())))
                        .or_insert_with(|| name.clone());
                }
                for start in 0..meaningful.len().saturating_sub(PASTED_RUN_LENGTH - 1) {
                    let window = hash_lines(
                        meaningful[start..start + PASTED_RUN_LENGTH]
                            .iter()
                            .map(|m| m.1.as_str()),
                    );
                    fingerprints
                        .runs
                        .entry(window)
                        .or_insert_with(|| name.clone());
                }
            }
        }
        fingerprints
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.runs.is_empty()
    }
}

/// Inspects one changed file and appends whatever it finds.
pub fn inspect(
    worktree: &Path,
    label: &str,
    relative: &str,
    fingerprints: &Fingerprints,
    leaks: &mut Vec<WireframeLeak>,
) {
    let segments: Vec<&str> = relative.split('/').collect();

    if segments
        .iter()
        .any(|s| s.eq_ignore_ascii_case(".wireframe"))
        || is_wireframe_source_path(&segments)
    {
        leaks.push(WireframeLeak {
            worktree: label.to_string(),
            path: relative.to_string(),
            line: None,
            kind: WireframeLeakKind::WireframePath,
            detail: "is a wireframe project file".to_string(),
        });
        return;
    }

    let full = worktree.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
    let Ok(metadata) = std::fs::metadata(&full) else {
        return;
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_INSPECTED_BYTES {
        return;
    }
    let Ok(bytes) = std::fs::read(&full) else {
        return;
    };
    // A NUL in the first 8000 bytes means binary; nothing below applies to it.
    if bytes[..bytes.len().min(8000)].contains(&0) {
        return;
    }
    let text = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
    let lines: Vec<&str> = text.split('\n').collect();

    if let Some((index, _)) = lines
        .iter()
        .enumerate()
        .find(|(_, l)| l.contains("@tendril-wireframe"))
    {
        leaks.push(WireframeLeak {
            worktree: label.to_string(),
            path: relative.to_string(),
            line: Some(index + 1),
            kind: WireframeLeakKind::Marker,
            detail: "carries the @tendril-wireframe marker".to_string(),
        });
    }

    if let Some((index, _)) = lines
        .iter()
        .enumerate()
        .find(|(_, l)| references_library(l))
    {
        leaks.push(WireframeLeak {
            worktree: label.to_string(),
            path: relative.to_string(),
            line: Some(index + 1),
            kind: WireframeLeakKind::LibraryReference,
            detail: "uses the tendril-wireframes library".to_string(),
        });
    }

    let meaningful = meaningful(&text);

    if meaningful.len() >= MIN_COPIED_FILE_LINES {
        let whole = hash_lines(meaningful.iter().map(|m| m.1.as_str()));
        if let Some(copied_from) = fingerprints.files.get(&whole) {
            leaks.push(WireframeLeak {
                worktree: label.to_string(),
                path: relative.to_string(),
                line: None,
                kind: WireframeLeakKind::CopiedFile,
                detail: format!("is a copy of wireframe file {copied_from}"),
            });
            return;
        }
    }

    for start in 0..meaningful.len().saturating_sub(PASTED_RUN_LENGTH - 1) {
        let window = hash_lines(
            meaningful[start..start + PASTED_RUN_LENGTH]
                .iter()
                .map(|m| m.1.as_str()),
        );
        if let Some(pasted_from) = fingerprints.runs.get(&window) {
            leaks.push(WireframeLeak {
                worktree: label.to_string(),
                path: relative.to_string(),
                line: Some(meaningful[start].0),
                kind: WireframeLeakKind::PastedLines,
                detail: format!(
                    "repeats {PASTED_RUN_LENGTH} or more lines of wireframe file {pasted_from}"
                ),
            });
            return;
        }
    }
}

/// `.../Wireframes/<name>/src/...`, the layout `tendril wireframe setup` creates.
fn is_wireframe_source_path(segments: &[&str]) -> bool {
    segments.windows(3).any(|window| {
        window[0].eq_ignore_ascii_case(FOLDER_NAME) && window[2].eq_ignore_ascii_case("src")
    })
}

/// An import, require or dependency entry naming the library.
fn references_library(line: &str) -> bool {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        regex::Regex::new(
            r#"(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']tendril-wireframes(["'/])|["']tendril-wireframes["']\s*:"#,
        )
        .expect("the library reference pattern compiles")
    });
    pattern.is_match(line)
}

/// Lines that say nothing on their own: a closing bracket, a lone tag, a blank.
fn is_trivial(line: &str) -> bool {
    static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        regex::Regex::new(r#"^([\)\]\};,]+|</?[A-Za-z][\w.]*\s*/?>|\{?/?\*+/?\}?)$"#)
            .expect("the trivial line pattern compiles")
    });
    pattern.is_match(line)
}

/// The lines worth comparing, normalised so reindentation does not hide a copy.
fn meaningful(text: &str) -> Vec<(usize, String)> {
    static WHITESPACE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let whitespace = WHITESPACE
        .get_or_init(|| regex::Regex::new(r"\s+").expect("the whitespace pattern compiles"));

    text.replace("\r\n", "\n")
        .split('\n')
        .enumerate()
        .filter_map(|(index, line)| {
            let normalized = whitespace.replace_all(line.trim(), " ").to_string();
            if normalized.len() < 4 || is_trivial(&normalized) {
                return None;
            }
            Some((index + 1, normalized))
        })
        .collect()
}

fn hash_lines<'a>(lines: impl Iterator<Item = &'a str>) -> String {
    let joined = lines.collect::<Vec<_>>().join("\n");
    let digest = Sha256::digest(joined.as_bytes());
    digest.iter().map(|b| format!("{b:02X}")).collect()
}

/// Every changed file in a worktree: committed since the merge base, plus uncommitted and untracked.
///
/// Against the merge base rather than HEAD, so every commit on the plan branch is inspected and not
/// only the working tree. Without a base branch the uncommitted edits are still checked; committed
/// work needs something to diff against.
pub fn changed_files(worktree: &Path, base_branch: Option<&str>) -> Vec<String> {
    let mut files: BTreeSet<String> = BTreeSet::new();

    let mut merge_base = None;
    if let Some(base) = base_branch.filter(|b| is_safe_ref_name(b)) {
        for candidate in [format!("origin/{base}"), base.to_string()] {
            // `--` before the revisions, so a name that begins with a dash is read as a ref rather
            // than as an option. `is_safe_ref_name` already refuses those, and this is the second
            // lock on the same door: the value reaches here from a project's own config.yaml, which
            // is trusted-ish rather than trusted.
            if let Some(output) = git(worktree, &["merge-base", "--", "HEAD", &candidate]) {
                if !output.trim().is_empty() {
                    merge_base = Some(output.trim().to_string());
                    break;
                }
            }
        }
    }

    let diff_target = merge_base.unwrap_or_else(|| "HEAD".to_string());
    if let Some(output) = git(
        worktree,
        &[
            "-c",
            "core.quotepath=off",
            "diff",
            "--name-only",
            "--diff-filter=ACMR",
            // The revision goes *before* the `--`, and only paths after it. Written the other way
            // round git reads the revision as a pathspec, matches nothing, and exits 0 with empty
            // output -- so every committed change looks like a clean plan and the guard passes.
            // `diff_target` is a merge-base SHA or the literal `HEAD`, neither of which can be read
            // as an option; the trailing `--` is what keeps it from being read as a path.
            &diff_target,
            "--",
        ],
    ) {
        add_lines(&mut files, &output);
    }
    if let Some(output) = git(
        worktree,
        &[
            "-c",
            "core.quotepath=off",
            "ls-files",
            "--others",
            "--exclude-standard",
        ],
    ) {
        add_lines(&mut files, &output);
    }

    files.into_iter().collect()
}

fn add_lines(files: &mut BTreeSet<String>, output: &str) {
    for line in output.split('\n') {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            files.insert(trimmed.replace('\\', "/"));
        }
    }
}

/// A branch name safe to hand to git as a revision.
///
/// Refuses anything that could be read as an option (a leading `-`), and anything outside the
/// characters a ref name can contain. Git's own rules are broader than this; the point is not to
/// reimplement `check-ref-format` but to keep a config value from becoming an argument.
fn is_safe_ref_name(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name.len() <= 255
        && !name.starts_with('-')
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'))
}

/// Runs git and returns its stdout, or `None` with the reason logged.
///
/// Every failure here is non-fatal by design -- a worktree that is not a repo, a base branch that
/// does not exist, git missing from PATH -- but silence made them indistinguishable from "no
/// changed files", which reads as a clean plan. The guard still proceeds; the log is what makes a
/// misconfiguration findable.
fn git(worktree: &Path, args: &[&str]) -> Option<String> {
    let output = match std::process::Command::new("git")
        .args(args)
        .current_dir(worktree)
        .output()
    {
        Ok(output) => output,
        Err(e) => {
            tracing::debug!(
                "git {:?} in {} could not run: {e}",
                args,
                worktree.display()
            );
            return None;
        }
    };

    if !output.status.success() {
        tracing::debug!(
            "git {:?} in {} exited {}: {}",
            args,
            worktree.display(),
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Scans every worktree under a plan's `Worktrees/` against its wireframes.
pub fn scan(plan_folder: &Path, base_branch: Option<&str>) -> Vec<WireframeLeak> {
    let worktrees_dir = plan_folder.join("Worktrees");
    let Ok(entries) = std::fs::read_dir(&worktrees_dir) else {
        return Vec::new();
    };

    let fingerprints = Fingerprints::build(&plan_folder.join(FOLDER_NAME));
    let mut leaks = Vec::new();

    for entry in entries.flatten().filter(|e| e.path().is_dir()) {
        let worktree = entry.path();
        let label = worktree
            .strip_prefix(&worktrees_dir)
            .unwrap_or(&worktree)
            .to_string_lossy()
            .replace('\\', "/");
        for relative in changed_files(&worktree, base_branch) {
            inspect(&worktree, &label, &relative, &fingerprints, &mut leaks);
        }
    }

    leaks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wireframe_source() -> &'static str {
        // Ten meaningful lines: the closing `</Card>`, `);` and `}` are trivial and do not count.
        // Deliberately more than the eight-line paste threshold, so a test can drop the import line
        // and still have a detectable run -- otherwise the library reference, not the paste, is what
        // catches it.
        "import { Button, Card } from \"tendril-wireframes\";\n\
         export default function App() {\n\
         const title = \"Sign in\";\n\
         const subtitle = \"Use your work account\";\n\
         const cta = \"Continue\";\n\
         const footnote = \"We will not share your address\";\n\
         return (\n\
         <Card title={title}>\n\
         <p className=\"muted\">{subtitle}</p>\n\
         <Button title={cta} variant=\"Primary\" />\n\
         <small>{footnote}</small>\n\
         </Card>\n\
         );\n\
         }\n"
    }

    fn plan_with_wireframe() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let plan = dir.path().join("00099-Add-Checkout");
        let src = plan.join(FOLDER_NAME).join("checkout").join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("App.tsx"), wireframe_source()).unwrap();
        (dir, plan)
    }

    fn worktree_with(file: &str, body: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let worktree = dir.path().join("wt");
        let full = worktree.join(file.replace('/', std::path::MAIN_SEPARATOR_STR));
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(&full, body).unwrap();
        (dir, worktree)
    }

    #[test]
    fn a_wireframe_project_file_is_caught_by_its_path_alone() {
        let (_g, plan) = plan_with_wireframe();
        let fingerprints = Fingerprints::build(&plan.join(FOLDER_NAME));
        let (_g2, worktree) = worktree_with("x", "x");
        let mut leaks = Vec::new();

        inspect(
            &worktree,
            "wt",
            "src/Wireframes/checkout/src/App.tsx",
            &fingerprints,
            &mut leaks,
        );
        inspect(
            &worktree,
            "wt",
            "app/.wireframe/types/x.d.ts",
            &fingerprints,
            &mut leaks,
        );

        assert_eq!(leaks.len(), 2);
        assert!(leaks
            .iter()
            .all(|l| l.kind == WireframeLeakKind::WireframePath));
        // Path detection does not need the file to exist, which is what makes it work on a deleted
        // or not-yet-written path in a diff.
    }

    #[test]
    fn the_marker_is_caught_wherever_it_lands() {
        let (_g, plan) = plan_with_wireframe();
        let fingerprints = Fingerprints::build(&plan.join(FOLDER_NAME));
        let (_g2, worktree) = worktree_with(
            "src/Login.tsx",
            "// @tendril-wireframe plan-only\nexport const Login = () => null;\n",
        );
        let mut leaks = Vec::new();
        inspect(&worktree, "wt", "src/Login.tsx", &fingerprints, &mut leaks);

        assert_eq!(leaks[0].kind, WireframeLeakKind::Marker);
        assert_eq!(leaks[0].line, Some(1));
    }

    #[test]
    fn a_library_reference_is_caught_in_source_and_in_package_json() {
        let (_g, plan) = plan_with_wireframe();
        let fingerprints = Fingerprints::build(&plan.join(FOLDER_NAME));

        for (file, body) in [
            (
                "src/a.tsx",
                "import { Button } from \"tendril-wireframes\";\n",
            ),
            ("src/b.ts", "const x = require('tendril-wireframes');\n"),
            (
                "src/c.ts",
                "import('tendril-wireframes/dist').then(() => {});\n",
            ),
            (
                "package.json",
                "{ \"dependencies\": { \"tendril-wireframes\": \"^0.1.11\" } }\n",
            ),
        ] {
            let (_g2, worktree) = worktree_with(file, body);
            let mut leaks = Vec::new();
            inspect(&worktree, "wt", file, &fingerprints, &mut leaks);
            assert!(
                leaks
                    .iter()
                    .any(|l| l.kind == WireframeLeakKind::LibraryReference),
                "missed the reference in {file}"
            );
        }
    }

    #[test]
    fn a_copied_file_is_caught_even_after_reindentation() {
        let (_g, plan) = plan_with_wireframe();
        let fingerprints = Fingerprints::build(&plan.join(FOLDER_NAME));

        // Same content, reindented and with blank lines added: the normalisation is what makes this
        // still a copy rather than a near-miss.
        let reindented = wireframe_source()
            .lines()
            .map(|l| format!("        {l}\n\n"))
            .collect::<String>();
        let (_g2, worktree) = worktree_with("src/App.tsx", &reindented);

        let mut leaks = Vec::new();
        inspect(&worktree, "wt", "src/App.tsx", &fingerprints, &mut leaks);
        assert!(
            leaks.iter().any(|l| l.kind == WireframeLeakKind::CopiedFile
                || l.kind == WireframeLeakKind::PastedLines),
            "got {leaks:?}"
        );
    }

    #[test]
    fn a_pasted_run_is_caught_inside_a_larger_file() {
        let (_g, plan) = plan_with_wireframe();
        let fingerprints = Fingerprints::build(&plan.join(FOLDER_NAME));

        // The wireframe's lines buried in a file that is otherwise the team's own code, with the
        // import line dropped so the library reference cannot be what catches it.
        let mut body = String::from("// our real screen\nimport { useState } from \"react\";\n");
        for line in wireframe_source().lines().skip(1) {
            body.push_str(line);
            body.push('\n');
        }
        body.push_str("export const extra = 1;\n");

        let (_g2, worktree) = worktree_with("src/Screen.tsx", &body);
        let mut leaks = Vec::new();
        inspect(&worktree, "wt", "src/Screen.tsx", &fingerprints, &mut leaks);

        let pasted = leaks
            .iter()
            .find(|l| l.kind == WireframeLeakKind::PastedLines);
        assert!(pasted.is_some(), "got {leaks:?}");
        assert!(pasted.unwrap().detail.contains("checkout/src/App.tsx"));
    }

    #[test]
    fn ordinary_product_code_is_not_flagged() {
        // The guard blocks a plan from completing, so a false positive is expensive.
        let (_g, plan) = plan_with_wireframe();
        let fingerprints = Fingerprints::build(&plan.join(FOLDER_NAME));
        let (_g2, worktree) = worktree_with(
            "src/Checkout.tsx",
            "import { Button } from \"@ivy/components\";\n\
             export function Checkout() {\n\
             const total = useTotal();\n\
             return <Button onClick={pay}>Pay {total}</Button>;\n\
             }\n",
        );

        let mut leaks = Vec::new();
        inspect(
            &worktree,
            "wt",
            "src/Checkout.tsx",
            &fingerprints,
            &mut leaks,
        );
        assert!(leaks.is_empty(), "got {leaks:?}");
    }

    #[test]
    fn a_short_shared_run_is_not_a_leak() {
        // Fewer than eight meaningful lines in common is ordinary similarity, not a paste.
        let (_g, plan) = plan_with_wireframe();
        let fingerprints = Fingerprints::build(&plan.join(FOLDER_NAME));
        let (_g2, worktree) = worktree_with(
            "src/Bits.tsx",
            "const title = \"Sign in\";\nconst subtitle = \"Use your work account\";\nexport const x = 1;\n",
        );

        let mut leaks = Vec::new();
        inspect(&worktree, "wt", "src/Bits.tsx", &fingerprints, &mut leaks);
        assert!(leaks.is_empty(), "got {leaks:?}");
    }

    #[test]
    fn a_binary_file_is_skipped_rather_than_scanned() {
        let (_g, plan) = plan_with_wireframe();
        let fingerprints = Fingerprints::build(&plan.join(FOLDER_NAME));
        let (_g2, worktree) = worktree_with("assets/logo.png", "\u{0}PNG\u{0}\u{0}binary");

        let mut leaks = Vec::new();
        inspect(
            &worktree,
            "wt",
            "assets/logo.png",
            &fingerprints,
            &mut leaks,
        );
        assert!(leaks.is_empty());
    }

    #[test]
    fn the_report_is_written_when_there_are_leaks_and_removed_when_there_are_none() {
        let dir = tempfile::tempdir().unwrap();
        let plan = dir.path().to_path_buf();
        let leaks = vec![WireframeLeak {
            worktree: "wt".into(),
            path: "src/App.tsx".into(),
            line: Some(3),
            kind: WireframeLeakKind::Marker,
            detail: "carries the @tendril-wireframe marker".into(),
        }];

        write_report(&plan, &leaks).unwrap();
        let text = std::fs::read_to_string(report_path(&plan)).unwrap();
        assert!(text.contains("# Wireframe Leak"));
        assert!(text.contains("src/App.tsx:3"));
        assert!(text.contains("throwaway plan material"));

        // A later clean run must clear it, or the plan keeps showing a failure it already fixed.
        write_report(&plan, &[]).unwrap();
        assert!(!report_path(&plan).exists());
    }

    #[test]
    fn a_base_branch_that_could_be_an_option_is_refused() {
        // It arrives from a project's config.yaml and becomes a git argument.
        assert!(is_safe_ref_name("main"));
        assert!(is_safe_ref_name("release/2026-09"));
        assert!(is_safe_ref_name("feature_x.1"));

        assert!(!is_safe_ref_name("--upload-pack=/tmp/evil"));
        assert!(!is_safe_ref_name("-main"));
        assert!(!is_safe_ref_name("main;rm -rf /"));
        assert!(!is_safe_ref_name("a..b"));
        assert!(!is_safe_ref_name(""));
        assert!(!is_safe_ref_name("   "));
    }

    #[test]
    fn a_plan_with_no_wireframes_fingerprints_to_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let fingerprints = Fingerprints::build(&dir.path().join("Wireframes"));
        assert!(fingerprints.is_empty());
    }

    /// Runs git in `dir`, failing the test rather than the guard's best-effort `None`.
    fn git_ok(dir: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .output()
            .expect("git should run");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// The case that matters and the one the other tests miss: a *committed* change.
    ///
    /// Every fixture above leaves its file untracked, which `ls-files --others` reports whatever
    /// the diff call does. A finished plan has committed its work, so a `git diff` that silently
    /// matches nothing means the guard inspects an empty set and every gate waves the plan
    /// through. That is what this pins.
    #[test]
    fn a_committed_change_is_seen_both_against_a_base_branch_and_against_head() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();

        git_ok(repo, &["init", "-q", "-b", "main"]);
        std::fs::write(repo.join("seed.txt"), "seed\n").unwrap();
        git_ok(repo, &["add", "."]);
        git_ok(repo, &["commit", "-qm", "seed"]);

        // A commit on a plan branch, exactly as an execution job leaves one.
        git_ok(repo, &["checkout", "-qb", "plan"]);
        std::fs::write(repo.join("committed.tsx"), "export const A = () => null;\n").unwrap();
        git_ok(repo, &["add", "."]);
        git_ok(repo, &["commit", "-qm", "work"]);

        let against_base = changed_files(repo, Some("main"));
        assert!(
            against_base.contains(&"committed.tsx".to_string()),
            "a file committed on the plan branch must be inspected; got {against_base:?}"
        );

        // With no base branch the merge base is unavailable and the diff falls back to HEAD, which
        // must still report a tracked file edited but not yet committed.
        std::fs::write(repo.join("seed.txt"), "seed\nedited\n").unwrap();
        let against_head = changed_files(repo, None);
        assert!(
            against_head.contains(&"seed.txt".to_string()),
            "an uncommitted edit to a tracked file must be inspected; got {against_head:?}"
        );
    }

    /// The guard's whole claim is that an agent cannot skip it, so the end-to-end path -- a
    /// committed wireframe paste in a real repo -- is worth pinning too.
    #[test]
    fn a_committed_wireframe_paste_is_caught() {
        let dir = tempfile::tempdir().unwrap();
        let plan = dir.path().join("00099-Add-Checkout");

        let src = plan.join(FOLDER_NAME).join("checkout").join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("App.tsx"), wireframe_source()).unwrap();

        let worktree = plan.join("Worktrees").join("repo");
        std::fs::create_dir_all(&worktree).unwrap();
        git_ok(&worktree, &["init", "-q", "-b", "main"]);
        std::fs::write(worktree.join("README.md"), "seed\n").unwrap();
        git_ok(&worktree, &["add", "."]);
        git_ok(&worktree, &["commit", "-qm", "seed"]);

        // The paste is committed, not left dirty.
        git_ok(&worktree, &["checkout", "-qb", "plan"]);
        std::fs::write(worktree.join("Login.tsx"), wireframe_source()).unwrap();
        git_ok(&worktree, &["add", "."]);
        git_ok(&worktree, &["commit", "-qm", "paste"]);

        let leaks = scan(&plan, Some("main"));
        assert!(
            !leaks.is_empty(),
            "a committed copy of a wireframe source file must be caught"
        );
    }
}
