//! Tendril's own wireframe host: the plan previews served at `/__wireframes/{scope}/{name}/`.
//!
//! Ported from V1's `Hosting/WireframeHost.cs`.
//!
//! Serving from Tendril's own origin rather than a separate port is what makes a preview work over
//! HTTPS and through a share link. The other half of the design is that **only the plan being viewed
//! runs watchers**: opening a wireframe in another plan stops the first plan's, so a session that
//! browses twenty plans does not end up with twenty esbuild processes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use serde::Serialize;
use tokio::sync::Mutex;

use crate::assets::{catalog, VendorManifest};
use crate::build::{esbuild, BuildResult, EsbuildWatcher, WatchEvent};
use crate::hosting::live_reload::{LiveReloadHub, ReloadMessage};
use crate::hosting::WireframeSite;
use crate::project::{scaffolder, WireframeProject};

/// Resolves a `(scope, name)` pair to a wireframe project directory, or `None` when there is none.
///
/// A callback rather than a dependency on plan storage: this crate has no idea what a plan is, and
/// the host is the only place the two meet.
pub type ResolveRoot = Arc<dyn Fn(&str, &str) -> Option<PathBuf> + Send + Sync>;

/// What the preview frame is told about a wireframe before it loads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WireframeStatus {
    pub phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl WireframeStatus {
    pub fn missing() -> Self {
        Self {
            phase: "missing",
            message: None,
        }
    }
    pub fn building() -> Self {
        Self {
            phase: "building",
            message: None,
        }
    }
    pub fn running() -> Self {
        Self {
            phase: "running",
            message: None,
        }
    }
    pub fn failed(message: Option<String>) -> Self {
        Self {
            phase: "failed",
            message,
        }
    }
}

/// One wireframe the host is serving.
pub struct Entry {
    pub site: WireframeSite,
    pub out_dir: PathBuf,
    pub hub: LiveReloadHub,
    pub status: WireframeStatus,
    watcher: Option<EsbuildWatcher>,
}

impl Entry {
    pub fn is_watching(&self) -> bool {
        self.watcher.is_some()
    }
}

#[derive(Default)]
struct HostState {
    /// The plan whose wireframes may run, if any has been opened.
    active_scope: Option<String>,
    entries: HashMap<(String, String), Entry>,
}

pub struct WireframeHost {
    resolve_root: ResolveRoot,
    /// One lock over everything. V1 splits a semaphore (for starting and stopping watchers) from a
    /// lock (for the fields handlers read), because its request handlers must never block behind a
    /// build. Here a build is awaited outside the guard, so a single async mutex gives the same
    /// property with far less to reason about.
    state: Mutex<HostState>,
    vendor: VendorManifest,
}

impl WireframeHost {
    pub fn new(resolve_root: ResolveRoot) -> Result<Self> {
        Ok(Self {
            resolve_root,
            state: Mutex::new(HostState::default()),
            vendor: VendorManifest::parse(catalog::read_text("vendor.manifest.json")?)?,
        })
    }

    pub fn vendor(&self) -> &VendorManifest {
        &self.vendor
    }

    /// The plan whose wireframes are currently allowed to run.
    pub async fn active_scope(&self) -> Option<String> {
        self.state.lock().await.active_scope.clone()
    }

    pub async fn watching(&self) -> usize {
        self.state
            .lock()
            .await
            .entries
            .values()
            .filter(|e| e.is_watching())
            .count()
    }

    /// A page is about to load: make sure the wireframe is built and being watched.
    ///
    /// Switching scope stops every watcher belonging to the plan being left. That is the whole point
    /// of tracking a scope: a reviewer moving between plans should not accumulate builds.
    pub async fn open(&self, scope: &str, name: &str) -> Option<(WireframeSite, PathBuf)> {
        let root = (self.resolve_root)(scope, name)?;

        let mut state = self.state.lock().await;

        if state.active_scope.as_deref() != Some(scope) {
            let leaving: Vec<(String, String)> = state
                .entries
                .keys()
                .filter(|(entry_scope, _)| entry_scope != scope)
                .cloned()
                .collect();
            for key in leaving {
                if let Some(entry) = state.entries.remove(&key) {
                    if let Some(watcher) = entry.watcher {
                        watcher.shutdown().await;
                    }
                }
            }
            state.active_scope = Some(scope.to_string());
        }

        let key = (scope.to_string(), name.to_string());
        if let Some(entry) = state.entries.get(&key) {
            return Some((entry.site.clone(), entry.out_dir.clone()));
        }

        let project = WireframeProject::at(&root);
        if !project.exists() {
            // Not an error: an agent can reference a wireframe in a revision before writing one, and
            // the frame shows "missing" rather than a failure.
            state.entries.insert(
                key,
                Entry {
                    site: WireframeSite::new(project.clone()),
                    out_dir: project.out_dir("preview"),
                    hub: LiveReloadHub::new(),
                    status: WireframeStatus::missing(),
                    watcher: None,
                },
            );
            return None;
        }

        if scaffolder::needs_refresh(&project) {
            let _ = scaffolder::materialize_workspace(&project);
        }

        let out_dir = project.out_dir("preview");
        let hub = LiveReloadHub::new();
        let mut site = WireframeSite::new(project.clone());
        site.live_reload = true;

        let (watcher, status) = match esbuild::resolve().await {
            Err(e) => (None, WireframeStatus::failed(Some(e.to_string()))),
            Ok(esbuild_path) => {
                match EsbuildWatcher::start(&esbuild_path, &project, &self.vendor, &out_dir).await {
                    Err(e) => (None, WireframeStatus::failed(Some(e.to_string()))),
                    Ok((watcher, first)) => {
                        let status = status_for(&first);
                        spawn_relay(&watcher, hub.clone());
                        (Some(watcher), status)
                    }
                }
            }
        };

        state.entries.insert(
            key,
            Entry {
                site: site.clone(),
                out_dir: out_dir.clone(),
                hub,
                status,
                watcher,
            },
        );

        Some((site, out_dir))
    }

    /// A file the loaded page asks for: whatever was built last, without starting anything.
    pub async fn find(&self, scope: &str, name: &str) -> Option<(WireframeSite, PathBuf)> {
        let state = self.state.lock().await;
        state
            .entries
            .get(&(scope.to_string(), name.to_string()))
            .map(|entry| (entry.site.clone(), entry.out_dir.clone()))
    }

    pub async fn hub(&self, scope: &str, name: &str) -> Option<LiveReloadHub> {
        let state = self.state.lock().await;
        state
            .entries
            .get(&(scope.to_string(), name.to_string()))
            .map(|entry| entry.hub.clone())
    }

    pub async fn status(&self, scope: &str, name: &str) -> WireframeStatus {
        let state = self.state.lock().await;
        match state.entries.get(&(scope.to_string(), name.to_string())) {
            Some(entry) => entry.status.clone(),
            None => match (self.resolve_root)(scope, name) {
                // Known but not opened yet: the frame shows a building state rather than a failure.
                Some(root) if WireframeProject::at(&root).exists() => WireframeStatus::building(),
                _ => WireframeStatus::missing(),
            },
        }
    }

    /// Stops every watcher. Called when the daemon shuts down.
    pub async fn stop_all(&self) {
        let mut state = self.state.lock().await;
        state.active_scope = None;
        let keys: Vec<(String, String)> = state.entries.keys().cloned().collect();
        for key in keys {
            if let Some(entry) = state.entries.remove(&key) {
                if let Some(watcher) = entry.watcher {
                    watcher.shutdown().await;
                }
            }
        }
    }
}

fn status_for(result: &BuildResult) -> WireframeStatus {
    if result.success {
        WireframeStatus::running()
    } else {
        WireframeStatus::failed(Some(result.output.clone()))
    }
}

/// Relays esbuild's watch output to whatever pages are attached.
fn spawn_relay(watcher: &EsbuildWatcher, hub: LiveReloadHub) {
    let mut events = watcher.subscribe();
    tokio::spawn(async move {
        while let Ok(event) = events.recv().await {
            match event {
                WatchEvent::Started => hub.broadcast(ReloadMessage::BuildStarted),
                WatchEvent::Completed(result) => {
                    if result.success {
                        hub.broadcast(ReloadMessage::Reload);
                    } else {
                        hub.broadcast(ReloadMessage::BuildFailed {
                            location: result.first_location(),
                            output: result.output.clone(),
                        });
                    }
                }
                WatchEvent::Line(_) => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host_over(plans: PathBuf) -> WireframeHost {
        WireframeHost::new(Arc::new(move |scope: &str, name: &str| {
            if !crate::project::WireframeProject::at(&plans).root.is_dir() {
                return None;
            }
            // A miniature of what Tendril passes in: <plans>/<scope>/Wireframes/<name>.
            Some(plans.join(scope).join("Wireframes").join(name))
        }))
        .unwrap()
    }

    fn scaffold_into(root: &std::path::Path) {
        let project = WireframeProject::at(root);
        std::fs::create_dir_all(project.source_dir()).unwrap();
        std::fs::write(project.entry_point(), "// entry").unwrap();
        std::fs::write(project.index_html(), "<html><body></body></html>").unwrap();
    }

    #[tokio::test]
    async fn a_wireframe_that_does_not_exist_is_missing_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let host = host_over(dir.path().to_path_buf());

        assert_eq!(
            host.status("99", "checkout").await,
            WireframeStatus::missing()
        );
        assert!(host.open("99", "checkout").await.is_none());
        // An agent can name a wireframe in a revision before writing it, so this is a normal state.
        assert_eq!(
            host.status("99", "checkout").await,
            WireframeStatus::missing()
        );
    }

    #[tokio::test]
    async fn find_never_starts_anything() {
        let dir = tempfile::tempdir().unwrap();
        scaffold_into(&dir.path().join("99").join("Wireframes").join("checkout"));
        let host = host_over(dir.path().to_path_buf());

        // Nothing has opened it, so a request for one of its files finds nothing rather than
        // triggering a build on an asset request.
        assert!(host.find("99", "checkout").await.is_none());
        assert_eq!(host.watching().await, 0);
    }

    #[tokio::test]
    async fn a_scope_is_recorded_when_a_wireframe_opens() {
        let dir = tempfile::tempdir().unwrap();
        scaffold_into(&dir.path().join("99").join("Wireframes").join("checkout"));
        let host = host_over(dir.path().to_path_buf());

        assert!(host.active_scope().await.is_none());
        host.open("99", "checkout").await;
        assert_eq!(host.active_scope().await.as_deref(), Some("99"));

        // And the entry is now findable without starting anything further.
        assert!(host.find("99", "checkout").await.is_some());
    }

    #[tokio::test]
    async fn opening_another_plan_drops_the_first_plans_entries() {
        // The property the whole scope mechanism exists for: browsing plans must not accumulate
        // builds.
        let dir = tempfile::tempdir().unwrap();
        scaffold_into(&dir.path().join("99").join("Wireframes").join("checkout"));
        scaffold_into(&dir.path().join("100").join("Wireframes").join("sign-in"));
        let host = host_over(dir.path().to_path_buf());

        host.open("99", "checkout").await;
        assert!(host.find("99", "checkout").await.is_some());

        host.open("100", "sign-in").await;
        assert_eq!(host.active_scope().await.as_deref(), Some("100"));
        assert!(
            host.find("99", "checkout").await.is_none(),
            "the plan being left must be released"
        );
        assert!(host.find("100", "sign-in").await.is_some());
    }

    #[tokio::test]
    async fn two_wireframes_in_one_plan_coexist() {
        let dir = tempfile::tempdir().unwrap();
        scaffold_into(&dir.path().join("99").join("Wireframes").join("checkout"));
        scaffold_into(&dir.path().join("99").join("Wireframes").join("sign-in"));
        let host = host_over(dir.path().to_path_buf());

        host.open("99", "checkout").await;
        host.open("99", "sign-in").await;

        // A plan may embed two wireframes, so both stay live while that plan is the one on screen.
        assert!(host.find("99", "checkout").await.is_some());
        assert!(host.find("99", "sign-in").await.is_some());
    }

    #[tokio::test]
    async fn stop_all_releases_everything() {
        let dir = tempfile::tempdir().unwrap();
        scaffold_into(&dir.path().join("99").join("Wireframes").join("checkout"));
        let host = host_over(dir.path().to_path_buf());

        host.open("99", "checkout").await;
        host.stop_all().await;

        assert!(host.active_scope().await.is_none());
        assert_eq!(host.watching().await, 0);
        assert!(host.find("99", "checkout").await.is_none());
    }

    #[test]
    fn status_serializes_the_way_the_frame_reads_it() {
        assert_eq!(
            serde_json::to_string(&WireframeStatus::running()).unwrap(),
            r#"{"phase":"running"}"#
        );
        let failed = serde_json::to_string(&WireframeStatus::failed(Some("boom".into()))).unwrap();
        assert!(failed.contains(r#""phase":"failed""#), "got {failed}");
        assert!(failed.contains(r#""message":"boom""#), "got {failed}");
    }
}
