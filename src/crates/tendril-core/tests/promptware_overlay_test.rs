//! Layered promptware deployment: precedence, overlay-only promptwares, `Tools/` merging, `Memory/`
//! preservation, pruning and `.version` handling.
//!
//! Every test passes `shipped_root` explicitly rather than letting the deployer probe for
//! `src/promptwares`, so results do not depend on the directory `cargo test` runs from.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tendril_core::promptware::{
    deploy_promptwares, needs_refresh, read_provenance, read_version, write_memory, write_tool,
    DeployOptions, DeployReport, Layer, OverlayLayer,
};

/// A shipped root, an overlay root and a deploy target under the system temp directory.
///
/// The shipped layer carries `CreatePlan` and `ExecutePlan` — both in `STANDARD_PROMPTWARES` — each
/// with a `Program.md` and a placeholder `Memory/.gitkeep`, mirroring what `src/promptwares` holds.
struct Fixture {
    root: PathBuf,
    shipped: PathBuf,
    overlay: PathBuf,
    target: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "tendril-overlay-deploy-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let fx = Fixture {
            shipped: root.join("shipped"),
            overlay: root.join("overlay"),
            target: root.join("Promptwares"),
            root,
        };

        for name in ["CreatePlan", "ExecutePlan"] {
            fx.write_shipped(
                &format!("{}/Program.md", name),
                &format!("shipped {}", name),
            );
            fx.write_shipped(&format!("{}/Memory/.gitkeep", name), "");
        }
        std::fs::create_dir_all(&fx.overlay).unwrap();

        fx
    }

    fn write_shipped(&self, relative: &str, contents: &str) {
        write_under(&self.shipped, relative, contents);
    }

    fn write_overlay(&self, relative: &str, contents: &str) {
        write_under(&self.overlay, relative, contents);
    }

    fn target_path(&self, relative: &str) -> PathBuf {
        self.target.join(relative)
    }

    fn read_target(&self, relative: &str) -> String {
        std::fs::read_to_string(self.target_path(relative))
            .unwrap_or_else(|e| panic!("reading {}: {}", relative, e))
    }

    /// The overlay as `resolve_overlay` would hand it over, re-reading `.version` each time so a test
    /// that bumps the revision gets the new value.
    fn overlay_layer(&self) -> OverlayLayer {
        OverlayLayer {
            root: self.overlay.clone(),
            version: read_version(&self.overlay),
        }
    }

    fn opts_with_overlay<'a>(&'a self, overlay: &'a OverlayLayer) -> DeployOptions<'a> {
        DeployOptions {
            shipped_root: Some(&self.shipped),
            overlay: Some(overlay),
        }
    }

    fn opts_shipped_only(&self) -> DeployOptions<'_> {
        DeployOptions {
            shipped_root: Some(&self.shipped),
            overlay: None,
        }
    }

    fn deploy_with_overlay(&self) -> DeployReport {
        let overlay = self.overlay_layer();
        deploy_promptwares(&self.target, self.opts_with_overlay(&overlay)).unwrap()
    }

    fn deploy_shipped_only(&self) -> DeployReport {
        deploy_promptwares(&self.target, self.opts_shipped_only()).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn write_under(base: &Path, relative: &str, contents: &str) {
    let path = base.join(relative);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, contents).unwrap();
}

fn files_of<'a>(report: &'a DeployReport, name: &str) -> &'a BTreeMap<String, Layer> {
    &report
        .promptware(name)
        .unwrap_or_else(|| panic!("{} missing from the report", name))
        .files
}

#[test]
fn overlay_program_md_wins_over_shipped() {
    let fx = Fixture::new();
    fx.write_overlay("CreatePlan/Program.md", "team CreatePlan");

    let report = fx.deploy_with_overlay();

    assert_eq!(fx.read_target("CreatePlan/Program.md"), "team CreatePlan");
    assert_eq!(
        report.promptware("CreatePlan").unwrap().program,
        Some(Layer::Overlay)
    );
    assert_eq!(
        files_of(&report, "CreatePlan").get("Program.md"),
        Some(&Layer::Overlay)
    );
}

#[test]
fn shipped_program_md_used_when_overlay_lacks_it() {
    let fx = Fixture::new();
    fx.write_overlay("CreatePlan/Program.md", "team CreatePlan");

    let report = fx.deploy_with_overlay();

    assert_eq!(
        fx.read_target("ExecutePlan/Program.md"),
        "shipped ExecutePlan"
    );
    let execute = report.promptware("ExecutePlan").unwrap();
    assert_eq!(execute.program, Some(Layer::Shipped));
    assert!(!execute.overlay_only);
}

#[test]
fn overlay_only_promptware_is_deployed() {
    let fx = Fixture::new();
    // Absent from the shipped root and from STANDARD_PROMPTWARES: the name union is what picks it up.
    fx.write_overlay(
        "IvyFrameworkVerification/Program.md",
        "verify the framework",
    );
    fx.write_overlay(
        "IvyFrameworkVerification/Tools/Test-SampleBuild.ps1",
        "Write-Host 'building'",
    );

    let report = fx.deploy_with_overlay();

    assert_eq!(
        fx.read_target("IvyFrameworkVerification/Program.md"),
        "verify the framework"
    );
    assert_eq!(
        fx.read_target("IvyFrameworkVerification/Tools/Test-SampleBuild.ps1"),
        "Write-Host 'building'"
    );

    let entry = report.promptware("IvyFrameworkVerification").unwrap();
    assert!(entry.overlay_only);
    assert_eq!(entry.program, Some(Layer::Overlay));
    assert_eq!(entry.tool_count(Layer::Overlay), 1);
    assert_eq!(entry.tool_count(Layer::Shipped), 0);
}

#[test]
fn overlay_tools_merge_with_shipped_tools() {
    let fx = Fixture::new();
    fx.write_shipped("CreatePlan/Tools/a.ps1", "shipped a");
    fx.write_overlay("CreatePlan/Tools/a.ps1", "overlay a");
    fx.write_overlay("CreatePlan/Tools/b.ps1", "overlay b");

    let report = fx.deploy_with_overlay();

    // Overlay wins on the shared name; the tool only one layer names is present either way.
    assert_eq!(fx.read_target("CreatePlan/Tools/a.ps1"), "overlay a");
    assert_eq!(fx.read_target("CreatePlan/Tools/b.ps1"), "overlay b");

    let files = files_of(&report, "CreatePlan");
    assert_eq!(files.get("Tools/a.ps1"), Some(&Layer::Overlay));
    assert_eq!(files.get("Tools/b.ps1"), Some(&Layer::Overlay));
    assert_eq!(files.get("Program.md"), Some(&Layer::Shipped));
}

#[test]
fn shipped_tool_survives_when_the_overlay_does_not_name_it() {
    let fx = Fixture::new();
    fx.write_shipped("CreatePlan/Tools/shipped-only.ps1", "shipped only");
    fx.write_overlay("CreatePlan/Tools/overlay-only.ps1", "overlay only");

    let report = fx.deploy_with_overlay();

    assert_eq!(
        fx.read_target("CreatePlan/Tools/shipped-only.ps1"),
        "shipped only"
    );
    let entry = report.promptware("CreatePlan").unwrap();
    assert_eq!(entry.tool_count(Layer::Shipped), 1);
    assert_eq!(entry.tool_count(Layer::Overlay), 1);
}

#[test]
fn runtime_written_tool_survives_deploy() {
    let fx = Fixture::new();
    fx.deploy_with_overlay();

    // A tool an agent wrote itself. No layer supplies it and no manifest records it, so the prune
    // pass must leave it alone.
    write_tool(
        &fx.target,
        "CreatePlan",
        "Invoke-Learned.ps1",
        "learned tool",
    )
    .unwrap();

    fx.write_overlay("CreatePlan/Program.md", "team CreatePlan");
    fx.deploy_with_overlay();

    assert_eq!(
        fx.read_target("CreatePlan/Tools/Invoke-Learned.ps1"),
        "learned tool"
    );
}

#[test]
fn memory_preserved_across_overlay_refresh() {
    let fx = Fixture::new();
    fx.write_overlay(".version", "1.0.44");
    fx.write_overlay("CreatePlan/Program.md", "team v1");
    fx.deploy_with_overlay();

    write_memory(&fx.target, "CreatePlan", "learned.md", "hard-won lesson").unwrap();

    // The team bumps its revision and changes its program.
    fx.write_overlay(".version", "1.0.45");
    fx.write_overlay("CreatePlan/Program.md", "team v2");
    let report = fx.deploy_with_overlay();

    assert_eq!(
        fx.read_target("CreatePlan/Memory/learned.md"),
        "hard-won lesson"
    );
    assert_eq!(fx.read_target("CreatePlan/Program.md"), "team v2");
    assert_eq!(report.overlay_version.as_deref(), Some("1.0.45"));
}

#[test]
fn memory_preserved_when_overlay_supplies_memory_file() {
    let fx = Fixture::new();
    fx.write_overlay("CreatePlan/Memory/learned.md", "overlay memory");
    write_memory(&fx.target, "CreatePlan", "learned.md", "learned memory").unwrap();

    let report = fx.deploy_with_overlay();

    assert_eq!(
        fx.read_target("CreatePlan/Memory/learned.md"),
        "learned memory"
    );
    // Skipped at the layer root in *both* layers, so it cannot even be recorded.
    let files = files_of(&report, "CreatePlan");
    assert!(
        !files.keys().any(|path| path.starts_with("Memory")),
        "no Memory path may be recorded: {:?}",
        files.keys().collect::<Vec<_>>()
    );
    // The shipped placeholder is likewise never propagated.
    assert!(!fx.target_path("CreatePlan/Memory/.gitkeep").exists());
}

#[test]
fn memory_never_pruned() {
    let fx = Fixture::new();
    fx.write_overlay("CreatePlan/Memory/learned.md", "overlay memory");
    fx.deploy_with_overlay();

    write_memory(&fx.target, "CreatePlan", "learned.md", "learned memory").unwrap();

    // The overlay drops the file. A prune that enumerated Memory/ would delete the learned copy.
    std::fs::remove_file(fx.overlay.join("CreatePlan/Memory/learned.md")).unwrap();
    fx.deploy_with_overlay();

    assert_eq!(
        fx.read_target("CreatePlan/Memory/learned.md"),
        "learned memory"
    );
}

#[test]
fn no_overlay_configured_is_a_noop() {
    let fx = Fixture::new();
    fx.write_shipped("CreatePlan/Tools/a.ps1", "shipped a");

    let report = fx.deploy_shipped_only();

    assert_eq!(
        fx.read_target("CreatePlan/Program.md"),
        "shipped CreatePlan"
    );
    assert_eq!(fx.read_target("CreatePlan/Tools/a.ps1"), "shipped a");
    assert_eq!(report.overlay_root, None);
    assert_eq!(report.overlay_version, None);
    assert_eq!(report.shipped_root.as_deref(), Some(fx.shipped.as_path()));

    for entry in &report.promptwares {
        assert!(!entry.overlay_only, "{} is not overlay-only", entry.name);
        assert_ne!(entry.program, Some(Layer::Overlay), "{}", entry.name);
        assert!(
            entry.files.values().all(|layer| *layer == Layer::Shipped),
            "{} recorded a non-shipped file",
            entry.name
        );
    }

    // `UpdateProject` is in STANDARD_PROMPTWARES but absent from the shipped tree, so it still falls
    // back to the stub — the behaviour the pre-layering deployer had.
    let stub = report.promptware("UpdateProject").unwrap();
    assert_eq!(stub.program, None);
    assert!(fx
        .read_target("UpdateProject/Program.md")
        .starts_with("# UpdateProject"));

    // Both preserved directories exist for every promptware, as before.
    assert!(fx.target_path("CreatePlan/Memory").is_dir());
    assert!(fx.target_path("CreatePlan/Tools").is_dir());

    let manifest = read_provenance(&fx.target).expect("manifest written");
    assert_eq!(manifest, report);
    assert_eq!(manifest.overlay_root, None);
}

#[test]
fn overlay_version_recorded_and_stale_detected() {
    let fx = Fixture::new();
    fx.write_overlay(".version", "1.0.44\n");
    fx.write_overlay("CreatePlan/Program.md", "team v1");

    let report = fx.deploy_with_overlay();
    assert_eq!(report.overlay_version.as_deref(), Some("1.0.44"));
    let overlay = fx.overlay_layer();
    assert!(!needs_refresh(&fx.target, fx.opts_with_overlay(&overlay)));

    fx.write_overlay(".version", "1.0.45");
    let bumped = fx.overlay_layer();
    assert!(needs_refresh(&fx.target, fx.opts_with_overlay(&bumped)));

    fx.deploy_with_overlay();
    let redeployed = fx.overlay_layer();
    assert!(!needs_refresh(
        &fx.target,
        fx.opts_with_overlay(&redeployed)
    ));
}

#[test]
fn needs_refresh_true_before_any_deploy() {
    let fx = Fixture::new();
    assert!(needs_refresh(&fx.target, fx.opts_shipped_only()));
}

#[test]
fn needs_refresh_true_when_overlay_added_or_removed() {
    let fx = Fixture::new();
    fx.write_overlay("CreatePlan/Program.md", "team CreatePlan");

    // Deployed shipped-only, then an overlay is configured.
    fx.deploy_shipped_only();
    let overlay = fx.overlay_layer();
    assert!(needs_refresh(&fx.target, fx.opts_with_overlay(&overlay)));

    // And the reverse: deployed with an overlay, then it is removed.
    fx.deploy_with_overlay();
    assert!(needs_refresh(&fx.target, fx.opts_shipped_only()));
}

#[test]
fn per_promptware_version_file_from_overlay() {
    let fx = Fixture::new();
    fx.write_shipped("CreatePlan/.version", "shipped-3");
    fx.write_overlay("CreatePlan/Program.md", "team CreatePlan");
    fx.write_overlay("CreatePlan/.version", "team-7");

    let report = fx.deploy_with_overlay();

    assert_eq!(
        report.promptware("CreatePlan").unwrap().version.as_deref(),
        Some("team-7")
    );
    // Copied through like any other file, so the overlay's wins on disk too.
    assert_eq!(fx.read_target("CreatePlan/.version"), "team-7");
    // With no overlay `.version`, the shipped one is reported instead.
    assert_eq!(
        report.promptware("ExecutePlan").unwrap().version.as_deref(),
        None
    );

    fx.write_shipped("ExecutePlan/.version", "shipped-9");
    let report = fx.deploy_with_overlay();
    assert_eq!(
        report.promptware("ExecutePlan").unwrap().version.as_deref(),
        Some("shipped-9")
    );
}

#[test]
fn root_version_stamp_records_this_build() {
    let fx = Fixture::new();
    let report = fx.deploy_shipped_only();

    assert_eq!(
        std::fs::read_to_string(fx.target_path(".version"))
            .unwrap()
            .trim(),
        report.shipped_version
    );
    assert_eq!(report.shipped_version, env!("CARGO_PKG_VERSION"));
}

#[test]
fn removed_overlay_file_is_pruned() {
    let fx = Fixture::new();
    fx.write_overlay("CreatePlan/Program.md", "team CreatePlan");
    fx.write_overlay("CreatePlan/Tools/gone.ps1", "temporary tool");
    fx.deploy_with_overlay();
    assert!(fx.target_path("CreatePlan/Tools/gone.ps1").exists());

    write_memory(&fx.target, "CreatePlan", "learned.md", "hard-won lesson").unwrap();
    write_tool(&fx.target, "CreatePlan", "runtime.ps1", "runtime tool").unwrap();

    std::fs::remove_file(fx.overlay.join("CreatePlan/Tools/gone.ps1")).unwrap();
    fx.deploy_with_overlay();

    assert!(
        !fx.target_path("CreatePlan/Tools/gone.ps1").exists(),
        "a file no layer supplies any more must be pruned"
    );
    // Unrecorded files are untouched, whether memory or a runtime-authored tool.
    assert_eq!(
        fx.read_target("CreatePlan/Memory/learned.md"),
        "hard-won lesson"
    );
    assert_eq!(
        fx.read_target("CreatePlan/Tools/runtime.ps1"),
        "runtime tool"
    );
}

#[test]
fn removed_overlay_program_falls_back_to_the_shipped_one() {
    let fx = Fixture::new();
    fx.write_overlay("CreatePlan/Program.md", "team CreatePlan");
    fx.deploy_with_overlay();
    assert_eq!(fx.read_target("CreatePlan/Program.md"), "team CreatePlan");

    // The whole overlay directory goes away; the shipped layer must resurface rather than the stale
    // overlay copy lingering forever.
    std::fs::remove_dir_all(fx.overlay.join("CreatePlan")).unwrap();
    let report = fx.deploy_with_overlay();

    assert_eq!(
        fx.read_target("CreatePlan/Program.md"),
        "shipped CreatePlan"
    );
    assert_eq!(
        report.promptware("CreatePlan").unwrap().program,
        Some(Layer::Shipped)
    );
}

#[test]
fn removed_overlay_only_promptware_is_pruned() {
    let fx = Fixture::new();
    fx.write_overlay("IvyFrameworkVerification/Program.md", "verify");
    fx.write_overlay(
        "IvyFrameworkVerification/Tools/Test-SampleBuild.ps1",
        "build",
    );
    fx.deploy_with_overlay();

    std::fs::remove_dir_all(fx.overlay.join("IvyFrameworkVerification")).unwrap();
    let report = fx.deploy_with_overlay();

    // No longer in either layer, so it drops out of the report entirely and its files are pruned.
    assert!(report.promptware("IvyFrameworkVerification").is_none());
    assert!(!fx
        .target_path("IvyFrameworkVerification/Tools/Test-SampleBuild.ps1")
        .exists());
    assert!(!fx
        .target_path("IvyFrameworkVerification/Program.md")
        .exists());
}

#[test]
fn deploy_is_idempotent() {
    let fx = Fixture::new();
    fx.write_overlay(".version", "1.0.45");
    fx.write_overlay("CreatePlan/Program.md", "team CreatePlan");
    fx.write_overlay("CreatePlan/Tools/a.ps1", "overlay a");

    let first = fx.deploy_with_overlay();
    let second = fx.deploy_with_overlay();

    assert_eq!(first, second);
    assert_eq!(fx.read_target("CreatePlan/Program.md"), "team CreatePlan");
    assert_eq!(fx.read_target("CreatePlan/Tools/a.ps1"), "overlay a");
}
