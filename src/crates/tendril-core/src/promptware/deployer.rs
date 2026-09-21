use crate::config::normalize_slashes;
use crate::error::Result;
use crate::promptware::overlay::{
    overlay_promptware_names, read_version, OverlayLayer, VERSION_FILE,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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

/// Directories that are never written by a deploy, at either layer.
///
/// `Memory/` holds reflections the agents wrote themselves, so no layer may supply, overwrite or
/// prune anything inside it. `Tools/` is deliberately **not** listed: it merges, because the shipped
/// tools, the overlay's tools and the ones agents write at run time all have to coexist.
const NEVER_DEPLOYED_DIRS: &[&str] = &["Memory"];

/// Name of the provenance manifest written at the Promptwares root.
pub const PROVENANCE_FILE: &str = ".provenance.json";

/// Which layer a deployed file came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Layer {
    Shipped,
    Overlay,
}

impl Layer {
    pub fn label(self) -> &'static str {
        match self {
            Layer::Shipped => "shipped",
            Layer::Overlay => "overlay",
        }
    }
}

/// The two layers a deploy draws from. `Default` is shipped-only with the source probed, which is
/// the behaviour every existing call site expects.
#[derive(Debug, Clone, Copy, Default)]
pub struct DeployOptions<'a> {
    /// `None` probes via [`find_promptware_source`]. Tests pass an explicit path so their results do
    /// not depend on the directory `cargo test` happens to run from.
    pub shipped_root: Option<&'a Path>,
    pub overlay: Option<&'a OverlayLayer>,
}

/// What the two layers contributed to one promptware.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptwareProvenance {
    pub name: String,
    /// Which layer supplied `Program.md`. `None` means neither did and the stub was used.
    #[serde(default)]
    pub program: Option<Layer>,
    /// The overlay supplied this promptware and the shipped layer did not.
    pub overlay_only: bool,
    /// Relative path (forward slashes) to the layer that last wrote it. Excludes `Memory/`.
    #[serde(default)]
    pub files: BTreeMap<String, Layer>,
    /// `<Name>/.version`, preferring the overlay's over the shipped one.
    #[serde(default)]
    pub version: Option<String>,
}

impl PromptwareProvenance {
    /// Files under `Tools/` that came from `layer`. Used by `tendril promptware layers`.
    pub fn tool_count(&self, layer: Layer) -> usize {
        self.files
            .iter()
            .filter(|(path, from)| **from == layer && path.starts_with("Tools/"))
            .count()
    }
}

/// The outcome of a deploy. Serialized to `<target>/.provenance.json`, which is deploy output rather
/// than user-editable input — its absence only means "not deployed since layering landed".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployReport {
    #[serde(default)]
    pub shipped_root: Option<PathBuf>,
    #[serde(default)]
    pub overlay_root: Option<PathBuf>,
    /// `<overlayRoot>/.version` — the team's revision string.
    #[serde(default)]
    pub overlay_version: Option<String>,
    /// The `tendril-core` version that performed the deploy, mirroring the original's assembly stamp.
    pub shipped_version: String,
    pub promptwares: Vec<PromptwareProvenance>,
}

impl DeployReport {
    pub fn promptware(&self, name: &str) -> Option<&PromptwareProvenance> {
        self.promptwares.iter().find(|p| p.name == name)
    }
}

/// The version this build stamps a deployed tree with.
pub fn shipped_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Deploys the shipped layer and then the overlay into `target_dir`, overlay winning per file.
///
/// The promptware set is `STANDARD_PROMPTWARES` unioned with the overlay's own directories, so an
/// overlay-only promptware needs no entry in `STANDARD_PROMPTWARES`. `Memory/` is never written and
/// never pruned; `Tools/` merges, so a tool written at run time by
/// [`write_tool`][crate::promptware::memory::write_tool] survives.
pub fn deploy_promptwares(target_dir: &Path, opts: DeployOptions<'_>) -> Result<DeployReport> {
    std::fs::create_dir_all(target_dir)?;

    let shipped_root = match opts.shipped_root {
        Some(explicit) => Some(explicit.to_path_buf()),
        None => find_promptware_source(),
    };

    let mut names: Vec<String> = STANDARD_PROMPTWARES.iter().map(|n| n.to_string()).collect();
    if let Some(overlay) = opts.overlay {
        names.extend(overlay_promptware_names(&overlay.root));
    }
    names.sort();
    names.dedup();

    let mut promptwares = Vec::new();
    for name in &names {
        let p_target = target_dir.join(name);
        std::fs::create_dir_all(p_target.join("Tools"))?;
        std::fs::create_dir_all(p_target.join("Memory"))?;

        let shipped_dir = layer_dir(shipped_root.as_deref(), name);
        let overlay_dir = layer_dir(opts.overlay.map(|o| o.root.as_path()), name);

        // Shipped first, overlay second: the second copy overwrites same-named files, which is
        // exactly "overlay wins per file" and leaves unnamed shipped files in place.
        let mut files = BTreeMap::new();
        if let Some(src) = &shipped_dir {
            copy_layer(src, &p_target, Layer::Shipped, &mut files)?;
        }
        if let Some(src) = &overlay_dir {
            copy_layer(src, &p_target, Layer::Overlay, &mut files)?;
        }

        promptwares.push(PromptwareProvenance {
            program: files.get("Program.md").copied(),
            overlay_only: overlay_dir.is_some() && shipped_dir.is_none(),
            version: overlay_dir
                .as_deref()
                .and_then(read_version)
                .or_else(|| shipped_dir.as_deref().and_then(read_version)),
            name: name.clone(),
            files,
        });
    }

    let report = DeployReport {
        shipped_root,
        overlay_root: opts.overlay.map(|o| o.root.clone()),
        overlay_version: opts.overlay.and_then(|o| o.version.clone()),
        shipped_version: shipped_version().to_string(),
        promptwares,
    };

    // Prune before stubbing, so a `Program.md` whose layer dropped it is replaced by a stub in this
    // same run rather than leaving the promptware with no program at all.
    prune_removed_files(target_dir, &report)?;

    for entry in &report.promptwares {
        let prog_file = target_dir.join(&entry.name).join("Program.md");
        if !prog_file.exists() {
            let stub = format!(
                "# {}\n\nInstructions for promptware {}.\n",
                entry.name, entry.name
            );
            std::fs::write(prog_file, stub)?;
        }
    }

    // Mirrors the original's assembly stamp at the Promptwares root.
    std::fs::write(
        target_dir.join(VERSION_FILE),
        format!("{}\n", report.shipped_version),
    )?;
    write_provenance(target_dir, &report)?;

    Ok(report)
}

/// Shipped-only deploy with the source probed. Retained so existing call sites and tests are
/// unaffected by layering.
pub fn deploy_standard_promptwares(target_dir: &Path) -> Result<()> {
    deploy_promptwares(target_dir, DeployOptions::default()).map(|_| ())
}

/// Whether `target_dir` needs re-deploying for the given layers.
///
/// True when nothing has been deployed yet, when this build is newer than the deployed stamp, or
/// when the overlay's root or `.version` differs from what was deployed — including an overlay being
/// added or removed. This is the stale-overlay detection the original could only do for its own
/// assembly version.
pub fn needs_refresh(target_dir: &Path, opts: DeployOptions<'_>) -> bool {
    let Some(previous) = read_provenance(target_dir) else {
        return true;
    };

    if previous.shipped_version != shipped_version() {
        return true;
    }

    let overlay_root = opts.overlay.map(|o| o.root.clone());
    if previous.overlay_root != overlay_root {
        return true;
    }

    previous.overlay_version != opts.overlay.and_then(|o| o.version.clone())
}

/// Reads the provenance manifest. `None` when absent or unparseable — either way the only sane
/// response is to deploy again.
pub fn read_provenance(target_dir: &Path) -> Option<DeployReport> {
    let raw = std::fs::read_to_string(target_dir.join(PROVENANCE_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// The file inside a promptware directory holding its prompt.
pub const PROGRAM_FILE: &str = "Program.md";

/// One deployed promptware's prompt, as the settings pane shows it.
///
/// `program` is the deployed `Program.md` verbatim — the same bytes
/// [`crate::promptware::compile_firmware`] inlines under the firmware's `## Program` heading, so
/// what the pane renders is what the agent is actually given rather than a second copy that can
/// drift from it. `layer` names which layer last wrote that file, taken from the deploy manifest,
/// so an operator can tell a team override apart from the shipped program without leaving Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptwareProgram {
    pub name: String,
    pub program: String,
    /// `shipped`, `overlay`, or `None` when the manifest predates layering or never recorded this
    /// promptware. Presentational only: the program above is served whatever this says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer: Option<Layer>,
    /// `<Name>/.version`, when either layer stamped one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Rejects a promptware name that is not a single plain path segment.
///
/// The name arrives from an HTTP caller and is joined onto the Promptwares root, so one carrying a
/// separator or a `..` would read a file outside the deployed tree. The CLI validates the same way
/// before touching `Memory/` or `Tools/`; this is the equivalent guard on the read path.
fn is_plain_segment(value: &str) -> bool {
    !value.is_empty()
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains('\0')
        && matches!(
            Path::new(value).components().next(),
            Some(std::path::Component::Normal(_))
        )
        && Path::new(value).components().count() == 1
}

/// Reads one deployed promptware's `Program.md` out of `promptwares_dir`.
///
/// Errors rather than returning an empty program when the promptware is not deployed: "no program"
/// and "no such promptware" are different things to an operator, and a blank pane cannot say which
/// happened. The deployed tree is read rather than the shipped source because the deployed copy is
/// what a job actually compiles — an overlay that replaces `Program.md` has to be what the pane
/// shows, or the screen contradicts the run.
pub fn read_promptware_program(promptwares_dir: &Path, name: &str) -> Result<PromptwareProgram> {
    if !is_plain_segment(name) {
        return Err(crate::error::TendrilError::Validation(format!(
            "Invalid agent name '{name}': must be a single folder name with no path separators"
        )));
    }

    let program_path = promptwares_dir.join(name).join(PROGRAM_FILE);
    // Reaches the Settings pane verbatim, so it is operator-facing copy rather than a log line -
    // which is why it says "agent", the name the UI now uses for a promptware.
    let program = std::fs::read_to_string(&program_path).map_err(|_| {
        crate::error::TendrilError::Promptware(format!("No prompt deployed for agent '{name}'"))
    })?;

    // The manifest is deploy output, so its absence is "deployed before layering landed" rather than
    // an error — the program above is still the right answer, just without provenance to label it.
    let provenance = read_provenance(promptwares_dir).and_then(|report| {
        report
            .promptwares
            .into_iter()
            .find(|entry| entry.name == name)
    });

    Ok(PromptwareProgram {
        name: name.to_string(),
        program,
        layer: provenance.as_ref().and_then(|entry| entry.program),
        version: provenance.and_then(|entry| entry.version),
    })
}

fn write_provenance(target_dir: &Path, report: &DeployReport) -> Result<()> {
    let json = serde_json::to_string_pretty(report)
        .map_err(|e| crate::error::TendrilError::Config(format!("{}", e)))?;
    std::fs::write(target_dir.join(PROVENANCE_FILE), format!("{}\n", json))?;
    Ok(())
}

/// `<root>/<name>` when both the root and that subdirectory exist.
fn layer_dir(root: Option<&Path>, name: &str) -> Option<PathBuf> {
    let candidate = root?.join(name);
    if candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

/// Deletes files the previous deploy recorded that neither layer supplies any more.
///
/// Only ever touches paths a previous manifest recorded, so a tool an agent wrote at run time — which
/// no manifest ever mentions — is never removed. `Memory/` cannot appear in a manifest at all, which
/// is what makes it structurally unprunable rather than merely unlisted.
fn prune_removed_files(target_dir: &Path, report: &DeployReport) -> Result<()> {
    let Some(previous) = read_provenance(target_dir) else {
        return Ok(());
    };

    for old in &previous.promptwares {
        let current = report.promptware(&old.name);
        for path in old.files.keys() {
            if current.is_some_and(|c| c.files.contains_key(path)) {
                continue;
            }
            if is_never_deployed(path) {
                continue;
            }
            let stale = target_dir.join(&old.name).join(path);
            if stale.is_file() {
                std::fs::remove_file(&stale)?;
            }
        }
    }

    Ok(())
}

/// Whether a manifest-relative path lies under a directory no deploy may write.
fn is_never_deployed(relative: &str) -> bool {
    NEVER_DEPLOYED_DIRS
        .iter()
        .any(|dir| relative == *dir || relative.starts_with(&format!("{}/", dir)))
}

/// Copies one layer over `dst`, skipping [`NEVER_DEPLOYED_DIRS`] at the layer root and recording each
/// file it wrote against `layer`.
fn copy_layer(
    src: &Path,
    dst: &Path,
    layer: Layer,
    files: &mut BTreeMap<String, Layer>,
) -> Result<()> {
    copy_layer_inner(src, dst, layer, Path::new(""), files)
}

fn copy_layer_inner(
    src: &Path,
    dst: &Path,
    layer: Layer,
    relative: &Path,
    files: &mut BTreeMap<String, Layer>,
) -> Result<()> {
    std::fs::create_dir_all(dst)?;

    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy().to_string();
        let child_relative = relative.join(&name_str);

        if ft.is_dir() {
            // Only at the layer root: a `Memory` directory nested inside `Tools/` is an ordinary file
            // tree and has nothing to do with learned memory.
            if relative.as_os_str().is_empty() && NEVER_DEPLOYED_DIRS.contains(&name_str.as_str()) {
                continue;
            }
            copy_layer_inner(
                &entry.path(),
                &dst.join(&name_str),
                layer,
                &child_relative,
                files,
            )?;
        } else if ft.is_file() {
            std::fs::copy(entry.path(), dst.join(&name_str))?;
            files.insert(normalize_slashes(&child_relative), layer);
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

/// `read_promptware_program`, which is what backs the prompt pane in Settings.
#[cfg(test)]
mod program_tests {
    use super::*;

    fn temp_root() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("tendril_program_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_the_deployed_program_and_its_layer() {
        let root = temp_root();
        std::fs::create_dir_all(root.join("CreatePlan")).unwrap();
        std::fs::write(root.join("CreatePlan").join("Program.md"), "# CreatePlan\n").unwrap();
        let report = DeployReport {
            shipped_root: None,
            overlay_root: None,
            overlay_version: Some("3".to_string()),
            shipped_version: "0.1.0".to_string(),
            promptwares: vec![PromptwareProvenance {
                name: "CreatePlan".to_string(),
                program: Some(Layer::Overlay),
                overlay_only: false,
                files: BTreeMap::new(),
                version: Some("3".to_string()),
            }],
        };
        std::fs::write(
            root.join(PROVENANCE_FILE),
            serde_json::to_string(&report).unwrap(),
        )
        .unwrap();

        let read = read_promptware_program(&root, "CreatePlan").unwrap();
        assert_eq!(read.name, "CreatePlan");
        assert_eq!(read.program, "# CreatePlan\n");
        // The overlay's copy is the one a job compiles, so it is the one the pane must label.
        assert_eq!(read.layer, Some(Layer::Overlay));
        assert_eq!(read.version.as_deref(), Some("3"));

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A tree deployed before the manifest existed still has a program; only its provenance is gone.
    #[test]
    fn reads_a_program_with_no_manifest() {
        let root = temp_root();
        std::fs::create_dir_all(root.join("ExecutePlan")).unwrap();
        std::fs::write(root.join("ExecutePlan").join("Program.md"), "go").unwrap();

        let read = read_promptware_program(&root, "ExecutePlan").unwrap();
        assert_eq!(read.program, "go");
        assert_eq!(read.layer, None);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn errors_rather_than_returning_an_empty_program_when_nothing_is_deployed() {
        let root = temp_root();
        let err = read_promptware_program(&root, "Missing").unwrap_err();
        assert!(
            err.to_string().contains("No prompt deployed"),
            "unexpected error: {err}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The name reaches this from an HTTP path segment, so it must not be able to leave the tree.
    #[test]
    fn rejects_a_name_that_is_not_one_plain_segment() {
        let root = temp_root();
        std::fs::write(root.join("Secret.md"), "secret").unwrap();

        for name in ["..", "../..", "a/b", "a\\b", ""] {
            let err = read_promptware_program(&root, name).unwrap_err();
            assert!(
                matches!(err, crate::error::TendrilError::Validation(_)),
                "{name:?} should be rejected as invalid, got {err}"
            );
        }

        let _ = std::fs::remove_dir_all(&root);
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
