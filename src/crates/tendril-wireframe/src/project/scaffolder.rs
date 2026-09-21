//! Creating and refreshing a wireframe project.
//!
//! Ported from V1's `Project/ProjectScaffolder.cs`. Two rules, applied strictly:
//!
//!   * User files are never clobbered. Re-running `setup` on an existing project reports what it
//!     skipped rather than overwriting the agent's work.
//!   * `.wireframe/` is always clobbered. It holds nothing user-authored, so regenerating it is how
//!     a tool upgrade picks up new types and templates.
//!
//! Nothing git-related is written. These projects are throwaway mockups, so a `.gitignore` and
//! `.gitkeep` placeholders were noise. If you do commit one, add `.wireframe/` to your own ignore
//! file -- it is a few MB of regenerable type definitions.

use std::path::Path;

use anyhow::{Context, Result};
use serde::Serialize;

use crate::assets::{catalog, VendorManifest};
use crate::project::templates;
use crate::project::WireframeProject;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScaffoldResult {
    pub created: Vec<String>,
    pub skipped: Vec<String>,
    pub type_files: usize,
}

#[derive(Serialize)]
struct Stamp<'a> {
    tool_version: &'a str,
    artifacts_hash: &'a str,
    generated: String,
    note: &'a str,
}

pub fn scaffold(project: &WireframeProject) -> Result<ScaffoldResult> {
    let mut result = ScaffoldResult::default();

    std::fs::create_dir_all(&project.root)
        .with_context(|| format!("Creating {}", project.root.display()))?;
    std::fs::create_dir_all(project.source_dir())?;
    std::fs::create_dir_all(project.screenshots_dir())?;

    migrate_app_into_source(project);

    let index = templates::INDEX_HTML.replace("{{TITLE}}", &project.name());
    write_if_absent(project, &project.index_html(), &index, &mut result)?;
    write_if_absent(
        project,
        &project.entry_point(),
        templates::MAIN_TSX,
        &mut result,
    )?;
    write_if_absent(
        project,
        &project.source_dir().join("App.tsx"),
        templates::APP_TSX,
        &mut result,
    )?;
    write_if_absent(
        project,
        &project.source_dir().join("wireframe-ready.ts"),
        templates::WIREFRAME_READY_TS,
        &mut result,
    )?;
    write_if_absent(
        project,
        &project.ts_config(),
        templates::TSCONFIG,
        &mut result,
    )?;

    result.type_files = materialize_workspace(project)?;
    Ok(result)
}

/// Moves `index.html` and `public/` into `src/` for projects scaffolded before the app lived
/// entirely under `src/`.
///
/// Done by moving rather than rewriting: the user may have edited `index.html`, and regenerating it
/// would throw that away. If both locations somehow exist, the one already in `src/` wins and the
/// stray copy is left alone for the user to delete.
///
/// Every failure here is swallowed, as in V1: a locked file just means the old copy stays put, and
/// the project still works because the scaffold writes a fresh `index.html` into `src/` if none is
/// there.
fn migrate_app_into_source(project: &WireframeProject) {
    let legacy_index = project.legacy_index_html();
    if legacy_index.is_file() && !project.index_html().is_file() {
        let _ = std::fs::rename(&legacy_index, project.index_html());
    }

    let legacy_public = project.legacy_public_dir();
    if !legacy_public.is_dir() {
        return;
    }

    for entry in walkdir::WalkDir::new(&legacy_public)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
    {
        let Ok(relative) = entry.path().strip_prefix(&legacy_public) else {
            continue;
        };
        let destination = project.public_dir().join(relative);
        if let Some(parent) = destination.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if !destination.exists() {
            let _ = std::fs::rename(entry.path(), &destination);
        }
    }

    // Only remove it once it is genuinely empty, so nothing is ever discarded.
    if std::fs::read_dir(&legacy_public)
        .map(|mut d| d.next().is_none())
        .unwrap_or(false)
    {
        let _ = std::fs::remove_dir(&legacy_public);
    }
}

/// Rewrites `.wireframe/` from the embedded payload. Cheap enough (a few MB of .d.ts) to do
/// unconditionally when the stamp does not match.
pub fn materialize_workspace(project: &WireframeProject) -> Result<usize> {
    let work_dir = project.work_dir();
    if work_dir.exists() {
        std::fs::remove_dir_all(&work_dir)
            .with_context(|| format!("Clearing {}", work_dir.display()))?;
    }
    std::fs::create_dir_all(&work_dir)
        .with_context(|| format!("Creating {}", work_dir.display()))?;

    let count = catalog::extract_to("types", &project.types_dir())?;

    let base = templates::TSCONFIG_BASE.replace("{{PATHS}}", &build_ts_paths(project)?);
    std::fs::write(work_dir.join("tsconfig.base.json"), base)
        .context("Writing .wireframe/tsconfig.base.json")?;

    write_stamp(project)?;
    Ok(count)
}

/// True when `.wireframe/` was built by a different tool version or payload.
pub fn needs_refresh(project: &WireframeProject) -> bool {
    let Ok(text) = std::fs::read_to_string(project.stamp_file()) else {
        return true;
    };
    let Ok(stamp) = serde_json::from_str::<serde_json::Value>(&text) else {
        return true;
    };
    stamp["toolVersion"].as_str() != Some(catalog::tool_version())
        || stamp["artifactsHash"].as_str() != Some(catalog::hash())
}

fn write_stamp(project: &WireframeProject) -> Result<()> {
    let stamp = Stamp {
        tool_version: catalog::tool_version(),
        artifacts_hash: catalog::hash(),
        generated: chrono::Utc::now().to_rfc3339(),
        note: "Regenerated by `tendril wireframe setup`/`serve`. Safe to delete.",
    };
    // camelCase keys, matching what `needs_refresh` reads and what V1 wrote.
    let json = serde_json::json!({
        "toolVersion": stamp.tool_version,
        "artifactsHash": stamp.artifacts_hash,
        "generated": stamp.generated,
        "note": stamp.note,
    });
    std::fs::write(project.stamp_file(), serde_json::to_string_pretty(&json)?)
        .context("Writing .wireframe/.stamp")
}

/// Maps every import-map specifier to its vendored `.d.ts`, so the editor resolves the same names
/// the browser does.
fn build_ts_paths(project: &WireframeProject) -> Result<String> {
    let manifest = VendorManifest::parse(catalog::read_text("vendor.manifest.json")?)?;
    let mut entries = Vec::new();

    // BTreeMap keys are already ordered, which is V1's `OrderBy(k => k)`.
    for specifier in manifest.specifiers.keys() {
        let target = match specifier.as_str() {
            "react" => ".wireframe/types/react".to_string(),
            "react/jsx-runtime" => ".wireframe/types/react/jsx-runtime".to_string(),
            "react-dom" => ".wireframe/types/react-dom".to_string(),
            "react-dom/client" => ".wireframe/types/react-dom/client".to_string(),
            "tendril-wireframes" => ".wireframe/types/tendril-wireframes/index.d.ts".to_string(),
            "lucide-react" => ".wireframe/types/lucide-react/index.d.ts".to_string(),
            other => format!(".wireframe/types/{other}"),
        };

        // Only map specifiers we actually vendored types for; an unresolvable path entry is worse
        // than none, because it silences the "cannot find module" hint.
        let probe = project
            .root
            .join(target.replace('/', std::path::MAIN_SEPARATOR_STR));
        let probe_dts = probe.with_extension("d.ts");
        if probe.exists() || probe_dts.exists() {
            entries.push(format!("      \"{specifier}\": [\"{target}\"]"));
        }
    }

    entries.push("      \"csstype\": [\".wireframe/types/csstype\"]".to_string());
    Ok(entries.join(",\n"))
}

fn write_if_absent(
    project: &WireframeProject,
    path: &Path,
    content: &str,
    result: &mut ScaffoldResult,
) -> Result<()> {
    let relative = project.relative_path(path);
    if path.exists() {
        result.skipped.push(relative);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Creating {}", parent.display()))?;
    }
    std::fs::write(path, content).with_context(|| format!("Writing {}", path.display()))?;
    result.created.push(relative);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> (tempfile::TempDir, WireframeProject) {
        let dir = tempfile::tempdir().unwrap();
        let project = WireframeProject::at(dir.path().join("login-screen"));
        (dir, project)
    }

    #[test]
    fn a_fresh_project_gets_the_whole_scaffold() {
        let (_guard, project) = scratch();
        let result = scaffold(&project).unwrap();

        assert!(project.exists(), "src/main.tsx must exist afterwards");
        assert!(project.index_html().is_file());
        assert!(project.source_dir().join("App.tsx").is_file());
        assert!(project.source_dir().join("wireframe-ready.ts").is_file());
        assert!(project.ts_config().is_file());
        assert!(project.screenshots_dir().is_dir());
        assert!(project.types_dir().is_dir());
        assert!(result.skipped.is_empty(), "got {:?}", result.skipped);
        assert_eq!(result.created.len(), 5, "got {:?}", result.created);
        assert!(result.type_files > 50, "got {}", result.type_files);

        // The title is substituted from the directory name, not left as a placeholder.
        let index = std::fs::read_to_string(project.index_html()).unwrap();
        assert!(index.contains("<title>login-screen</title>"), "got {index}");
        assert!(!index.contains("{{TITLE}}"));
    }

    #[test]
    fn re_running_setup_never_clobbers_the_agents_work() {
        let (_guard, project) = scratch();
        scaffold(&project).unwrap();
        std::fs::write(project.source_dir().join("App.tsx"), "// my wireframe").unwrap();

        let result = scaffold(&project).unwrap();
        assert_eq!(
            std::fs::read_to_string(project.source_dir().join("App.tsx")).unwrap(),
            "// my wireframe"
        );
        assert!(result.created.is_empty(), "got {:?}", result.created);
        assert_eq!(result.skipped.len(), 5, "got {:?}", result.skipped);
    }

    #[test]
    fn the_workspace_is_always_rebuilt() {
        let (_guard, project) = scratch();
        scaffold(&project).unwrap();

        // Something stale left behind in .wireframe/ must not survive.
        let stale = project.work_dir().join("stale.d.ts");
        std::fs::write(&stale, "export {}").unwrap();
        scaffold(&project).unwrap();
        assert!(!stale.exists(), ".wireframe/ is regenerated, not merged");
        assert!(project.work_dir().join("tsconfig.base.json").is_file());
    }

    #[test]
    fn ts_paths_only_map_types_that_were_actually_vendored() {
        let (_guard, project) = scratch();
        scaffold(&project).unwrap();
        let base = std::fs::read_to_string(project.work_dir().join("tsconfig.base.json")).unwrap();

        assert!(!base.contains("{{PATHS}}"), "placeholder survived");
        assert!(
            base.contains("\"react\": [\".wireframe/types/react\"]"),
            "got {base}"
        );
        assert!(base.contains("\"csstype\""), "got {base}");
        // Every mapped target must resolve, or the "cannot find module" hint is silenced.
        for line in base.lines().filter(|l| l.contains(".wireframe/types/")) {
            let target = line
                .split('"')
                .find(|s| s.starts_with(".wireframe/types/"))
                .unwrap();
            let probe = project
                .root
                .join(target.replace('/', std::path::MAIN_SEPARATOR_STR));
            assert!(
                probe.exists() || probe.with_extension("d.ts").exists(),
                "{target} does not resolve"
            );
        }
    }

    #[test]
    fn the_stamp_drives_refresh_detection() {
        let (_guard, project) = scratch();
        assert!(needs_refresh(&project), "no stamp at all means refresh");

        scaffold(&project).unwrap();
        assert!(!needs_refresh(&project), "a fresh stamp matches");

        std::fs::write(
            project.stamp_file(),
            r#"{"toolVersion":"0.0.0","artifactsHash":"x"}"#,
        )
        .unwrap();
        assert!(needs_refresh(&project), "an older payload must refresh");

        std::fs::write(project.stamp_file(), "not json").unwrap();
        assert!(needs_refresh(&project), "an unreadable stamp must refresh");
    }

    #[test]
    fn a_legacy_layout_is_migrated_rather_than_rewritten() {
        let (_guard, project) = scratch();
        // A project from before the app moved under src/: edited index.html at the root, and an
        // asset in public/.
        std::fs::create_dir_all(project.legacy_public_dir()).unwrap();
        std::fs::write(project.legacy_index_html(), "<!-- my edited markup -->").unwrap();
        std::fs::write(project.legacy_public_dir().join("logo.svg"), "<svg/>").unwrap();

        scaffold(&project).unwrap();

        assert_eq!(
            std::fs::read_to_string(project.index_html()).unwrap(),
            "<!-- my edited markup -->",
            "the user's markup must move, not be regenerated"
        );
        assert_eq!(
            std::fs::read_to_string(project.public_dir().join("logo.svg")).unwrap(),
            "<svg/>"
        );
        assert!(
            !project.legacy_public_dir().exists(),
            "the empty legacy dir goes"
        );
    }
}
