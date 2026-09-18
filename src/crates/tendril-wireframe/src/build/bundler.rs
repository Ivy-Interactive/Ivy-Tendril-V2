//! Running the esbuild binary over the user's `src/`.
//!
//! Ported from V1's `Build/EsbuildBundler.cs`.
//!
//! Only the agent's own code is bundled: react, react-dom and tendril-wireframes are marked external
//! and resolved in the browser through the import map, so a rebuild never walks the dependency tree
//! and lands in the 5-15 ms range.

use std::path::Path;
use std::process::Stdio;

use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, oneshot};

use crate::assets::VendorManifest;
use crate::project::WireframeProject;

/// Outcome of one esbuild cycle. `output` is esbuild's own stderr, preserved verbatim -- its caret
/// diagnostics are better than anything we would render.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildResult {
    pub success: bool,
    pub output: String,
}

impl BuildResult {
    /// First `file:line:col` esbuild reported, for the overlay header.
    pub fn first_location(&self) -> Option<String> {
        // Not a `regex::Regex::new` per call: this runs on every rebuild in watch mode.
        static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        let pattern = PATTERN.get_or_init(|| regex::Regex::new(r"^(.+?):(\d+):(\d+):$").unwrap());

        self.output
            .split('\n')
            .map(str::trim)
            .find(|line| pattern.is_match(line))
            .map(|line| line.trim_end_matches(':').to_string())
    }
}

/// Builds the argument list and runs one-shot builds.
pub struct EsbuildBundler<'a> {
    esbuild_path: &'a Path,
    project: &'a WireframeProject,
    vendor: &'a VendorManifest,
}

impl<'a> EsbuildBundler<'a> {
    pub fn new(
        esbuild_path: &'a Path,
        project: &'a WireframeProject,
        vendor: &'a VendorManifest,
    ) -> Self {
        Self {
            esbuild_path,
            project,
            vendor,
        }
    }

    /// Arguments shared by the one-shot and watch modes.
    ///
    /// Note the externals are an explicit allowlist rather than `--packages=external`: with an
    /// allowlist, `import "recharts"` fails the BUILD with a clear message. With
    /// `--packages=external` it would compile happily and then die in the browser with an opaque
    /// import-map miss.
    pub fn build_arguments(&self, out_dir: &Path, sourcemap: bool) -> Vec<String> {
        let mut args = vec![
            self.project.entry_point().to_string_lossy().into_owned(),
            "--bundle".into(),
            format!("--outdir={}", out_dir.display()),
            "--format=esm".into(),
            "--target=es2022".into(),
            "--jsx=automatic".into(),
            "--jsx-import-source=react".into(),
            "--loader:.svg=dataurl".into(),
            "--loader:.png=dataurl".into(),
            "--loader:.jpg=dataurl".into(),
            "--loader:.webp=dataurl".into(),
            "--log-level=info".into(),
            "--color=false".into(),
            "--entry-names=bundle".into(),
        ];
        if sourcemap {
            args.push("--sourcemap=linked".into());
        }
        args.extend(
            self.vendor
                .external_specifiers()
                .into_iter()
                .map(|s| format!("--external:{s}")),
        );
        args
    }

    /// One clean synchronous build. Used by `screenshot`, which must never observe a half-written
    /// bundle.
    pub async fn build_once(&self, out_dir: &Path) -> Result<BuildResult> {
        std::fs::create_dir_all(out_dir)
            .with_context(|| format!("Creating {}", out_dir.display()))?;

        let output = Command::new(self.esbuild_path)
            .args(self.build_arguments(out_dir, true))
            .current_dir(&self.project.root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .with_context(|| {
                format!("Could not start esbuild at {}", self.esbuild_path.display())
            })?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = [stderr.as_ref(), stdout.as_ref()]
            .into_iter()
            .filter(|s| !s.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n");

        Ok(BuildResult {
            success: output.status.success(),
            output: combined.trim().to_string(),
        })
    }
}

/// What a watch run reports, in place of V1's three C# events.
#[derive(Debug, Clone)]
pub enum WatchEvent {
    /// A rebuild started, so the client can show a pending state.
    Started,
    /// One completed rebuild.
    Completed(BuildResult),
    /// One stderr line, so the terminal sees esbuild verbatim.
    Line(String),
}

/// Supervises a long-lived `esbuild --watch` child.
///
/// This is deliberately NOT a filesystem watcher over `src/`. esbuild's watcher is import-graph
/// aware (it rebuilds only when a file the bundle actually imports changes), it already handles the
/// write-temp-then-rename storm that editors produce and that a hand-rolled debounce gets wrong, and
/// it keeps its parse cache in-process -- 5-15 ms per rebuild versus ~60 ms of process startup on
/// every save.
pub struct EsbuildWatcher {
    child: Child,
    events: broadcast::Sender<WatchEvent>,
    /// esbuild `--watch` exits as soon as stdin closes. Holding the pipe open keeps it running, and
    /// means that if this process dies the pipe breaks and esbuild shuts itself down -- no orphaned
    /// watchers left behind.
    _stdin: tokio::process::ChildStdin,
}

impl EsbuildWatcher {
    /// Starts the watcher and resolves once the first build has finished, returning its result.
    pub async fn start(
        esbuild_path: &Path,
        project: &WireframeProject,
        vendor: &VendorManifest,
        out_dir: &Path,
    ) -> Result<(Self, BuildResult)> {
        std::fs::create_dir_all(out_dir)
            .with_context(|| format!("Creating {}", out_dir.display()))?;

        let mut args =
            EsbuildBundler::new(esbuild_path, project, vendor).build_arguments(out_dir, true);
        args.push("--watch".into());

        let mut child = Command::new(esbuild_path)
            .args(args)
            .current_dir(&project.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // A dropped watcher must not leave esbuild running against a plan nobody is viewing.
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("Could not start esbuild at {}", esbuild_path.display()))?;

        let stdin = child.stdin.take().expect("stdin was piped");
        let stderr = child.stderr.take().expect("stderr was piped");
        let stdout = child.stdout.take().expect("stdout was piped");

        let (events, _) = broadcast::channel(64);
        let (first_tx, first_rx) = oneshot::channel();

        // Drain stdout so a full pipe buffer can never block the child.
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(_)) = lines.next_line().await {}
        });

        tokio::spawn(pump(stderr, events.clone(), first_tx));

        let first = first_rx.await.unwrap_or_else(|_| BuildResult {
            success: false,
            output: "esbuild exited unexpectedly.".to_string(),
        });

        Ok((
            Self {
                child,
                events,
                _stdin: stdin,
            },
            first,
        ))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WatchEvent> {
        self.events.subscribe()
    }

    /// Stops the watcher. Dropping does the same thing via `kill_on_drop`; this exists so a caller
    /// that wants to wait for the child to be gone can.
    pub async fn shutdown(mut self) {
        let _ = self.child.kill().await;
    }
}

/// State machine over esbuild's watch output, which reports everything -- progress and diagnostics
/// alike -- on stderr:
///   `[watch] build started` -> reset  |  `[ERROR]` -> mark failed
///   `[watch] build finished` -> emit
async fn pump(
    stderr: tokio::process::ChildStderr,
    events: broadcast::Sender<WatchEvent>,
    first: oneshot::Sender<BuildResult>,
) {
    let mut first = Some(first);
    let mut current = String::new();
    let mut failed = false;

    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        // A send failure only means nobody is subscribed, which is normal.
        let _ = events.send(WatchEvent::Line(line.clone()));

        if line.contains("[watch] build started") {
            current.clear();
            failed = false;
            let _ = events.send(WatchEvent::Started);
            continue;
        }

        if line.contains("[watch] build finished") {
            let result = BuildResult {
                success: !failed,
                output: current.trim().to_string(),
            };
            if let Some(tx) = first.take() {
                let _ = tx.send(result.clone());
            }
            let _ = events.send(WatchEvent::Completed(result));
            continue;
        }

        if line.contains("[ERROR]") {
            failed = true;
        }
        current.push_str(&line);
        current.push('\n');
    }

    // esbuild exited without ever finishing a build: surface whatever it said.
    if let Some(tx) = first.take() {
        let output = if current.trim().is_empty() {
            "esbuild exited unexpectedly.".to_string()
        } else {
            current.trim().to_string()
        };
        let _ = tx.send(BuildResult {
            success: false,
            output,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> VendorManifest {
        VendorManifest::parse(
            r#"{ "specifiers": { "react": "/__wireframe/react.js",
                                 "roughjs/bin/generator": "/__wireframe/g.js" } }"#,
        )
        .unwrap()
    }

    #[test]
    fn externals_are_an_allowlist_not_packages_external() {
        let project = WireframeProject::at("demo");
        let vendor = manifest();
        let args = EsbuildBundler::new(Path::new("esbuild"), &project, &vendor)
            .build_arguments(Path::new("/out"), true);

        assert!(args.iter().any(|a| a == "--external:react"));
        assert!(args.iter().any(|a| a == "--external:roughjs/bin/generator"));
        assert!(
            !args.iter().any(|a| a == "--packages=external"),
            "an allowlist fails the build on an unknown import; --packages=external fails in the browser"
        );

        // The deep subpath must precede its parent in the argument list too.
        let deep = args
            .iter()
            .position(|a| a == "--external:roughjs/bin/generator");
        let react = args.iter().position(|a| a == "--external:react");
        assert!(deep < react, "got {args:?}");
    }

    #[test]
    fn sourcemap_is_opt_out() {
        let project = WireframeProject::at("demo");
        let vendor = manifest();
        let bundler = EsbuildBundler::new(Path::new("esbuild"), &project, &vendor);
        assert!(bundler
            .build_arguments(Path::new("/out"), true)
            .iter()
            .any(|a| a == "--sourcemap=linked"));
        assert!(!bundler
            .build_arguments(Path::new("/out"), false)
            .iter()
            .any(|a| a.starts_with("--sourcemap")));
    }

    #[test]
    fn entry_name_is_pinned_so_the_host_can_serve_one_path() {
        let project = WireframeProject::at("demo");
        let vendor = manifest();
        let args = EsbuildBundler::new(Path::new("esbuild"), &project, &vendor)
            .build_arguments(Path::new("/out"), true);
        assert!(args.iter().any(|a| a == "--entry-names=bundle"));
    }

    #[test]
    fn first_location_finds_esbuilds_caret_header() {
        let result = BuildResult {
            success: false,
            output: "\u{2718} [ERROR] Unexpected \"}\"\n\n    src/App.tsx:12:4:\n      12 |    }\n"
                .to_string(),
        };
        assert_eq!(result.first_location().as_deref(), Some("src/App.tsx:12:4"));
    }

    #[test]
    fn first_location_is_none_when_esbuild_reported_no_position() {
        let result = BuildResult {
            success: true,
            output: "  bundle.js  1.2mb".to_string(),
        };
        assert_eq!(result.first_location(), None);
    }
}
