//! The on-disk layout of a wireframe project, and the settings `serve` and `screenshot` must
//! agree with `setup` about.
//!
//! Scaffolding lives in [`scaffolder`]; the files it writes in [`templates`].
//!
//! Ported from V1's `Ivy.Tendril.Wireframe/Project/{WireframeProject,WireframeConfig}.cs`.

pub mod scaffolder;
pub mod templates;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// How Tailwind classes are turned into CSS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TailwindMode {
    /// The utility superset embedded in the tool. Instant and offline.
    #[default]
    Superset,

    /// The official Tailwind standalone CLI. Full fidelity, ~107 MB once.
    Jit,
}

impl TailwindMode {
    /// V1 `WireframeConfig.TryParseTailwind`: the CLI accepts three spellings of each mode, so a
    /// `--tailwind cli` on one machine and `--tailwind standalone` on another do the same thing.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "superset" | "embedded" | "default" => Some(Self::Superset),
            "jit" | "cli" | "standalone" => Some(Self::Jit),
            _ => None,
        }
    }
}

/// Project settings, written to `wireframe.json` only when something differs from the defaults so
/// an ordinary project stays as small as the scaffold makes it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WireframeConfig {
    #[serde(default)]
    pub tailwind: TailwindMode,
}

impl WireframeConfig {
    pub fn path_for(project: &WireframeProject) -> PathBuf {
        project.root.join("wireframe.json")
    }

    /// A hand-broken config must not stop the wireframe rendering, so a parse failure falls back to
    /// the defaults rather than propagating. V1 catches `JsonException` in the same place.
    pub fn load(project: &WireframeProject) -> Self {
        let path = Self::path_for(project);
        let Ok(text) = std::fs::read_to_string(&path) else {
            return Self::default();
        };
        match serde_json::from_str(&text) {
            Ok(config) => config,
            Err(err) => {
                tracing::warn!("Ignoring unreadable {}: {}", path.display(), err);
                Self::default()
            }
        }
    }

    /// Nothing to record when every setting is a default: the file is removed rather than written
    /// with its default contents, which is what keeps a scaffolded project directory clean.
    pub fn save(&self, project: &WireframeProject) -> std::io::Result<()> {
        let path = Self::path_for(project);
        if self.tailwind == TailwindMode::Superset {
            match std::fs::remove_file(&path) {
                Ok(()) => return Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(e) => return Err(e),
            }
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(&path, json + "\n")
    }
}

/// The on-disk layout of a wireframe project.
///
/// ```text
/// <root>/
///   src/                the entire app, committed -- the agent's work
///     index.html
///     main.tsx
///     App.tsx
///     public/           static assets
///   screenshots/        committed -- the deliverable
///   tsconfig.json       committed, extends .wireframe/tsconfig.base.json
///   .wireframe/         GITIGNORED, regenerated on every run, never user-authored
/// ```
///
/// Everything the app is made of lives under `src/`. The root holds only configuration, generated
/// output and docs, so opening the project in an editor shows one folder to work in rather than app
/// files scattered beside config.
///
/// Build output deliberately does *not* live under the project: it goes to a per-project directory
/// under the user's local app data, so there is no stray `dist/` to gitignore and `screenshot` can
/// build in isolation without racing a running `serve`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireframeProject {
    pub root: PathBuf,
}

/// Extensions that count as app source: what the editor lists and the class linter scans.
/// `index.html` is included because it lives in `src/` and carries markup.
const SOURCE_EXTENSIONS: [&str; 4] = ["tsx", "ts", "html", "css"];

impl WireframeProject {
    pub fn at(path: impl AsRef<Path>) -> Self {
        let path = path.as_ref();
        // `canonicalize` would fail for a project that does not exist yet, which `setup` is about to
        // create, so this only absolutises.
        let root = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(path)
        };
        Self { root }
    }

    pub fn source_dir(&self) -> PathBuf {
        self.root.join("src")
    }

    /// Static assets. Inside `src/` because they are part of the app, not config.
    pub fn public_dir(&self) -> PathBuf {
        self.source_dir().join("public")
    }

    pub fn screenshots_dir(&self) -> PathBuf {
        self.root.join("screenshots")
    }

    /// Where the agent writes notes back to whoever maintains the library -- a missing component, a
    /// prop that should exist, something the reference got wrong. Plain HTML pages, because the
    /// agent already knows how to write one and Studio can show it without a format to agree on
    /// first.
    pub fn suggestions_dir(&self) -> PathBuf {
        self.root.join("suggestions")
    }

    pub fn work_dir(&self) -> PathBuf {
        self.root.join(".wireframe")
    }

    pub fn types_dir(&self) -> PathBuf {
        self.work_dir().join("types")
    }

    pub fn stamp_file(&self) -> PathBuf {
        self.work_dir().join(".stamp")
    }

    pub fn index_html(&self) -> PathBuf {
        self.source_dir().join("index.html")
    }

    /// Where `index.html` used to live. Kept only so existing projects can be migrated on the next
    /// run rather than silently losing their edited markup.
    pub fn legacy_index_html(&self) -> PathBuf {
        self.root.join("index.html")
    }

    /// Ditto for `public/`.
    pub fn legacy_public_dir(&self) -> PathBuf {
        self.root.join("public")
    }

    pub fn ts_config(&self) -> PathBuf {
        self.root.join("tsconfig.json")
    }

    pub fn entry_point(&self) -> PathBuf {
        self.source_dir().join("main.tsx")
    }

    pub fn name(&self) -> String {
        self.root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    pub fn exists(&self) -> bool {
        self.source_dir().is_dir() && self.entry_point().is_file()
    }

    /// Build output directory, keyed by a hash of the project path. Separate subdirectories per
    /// purpose so a `screenshot` run can never observe a half-written `serve` bundle.
    pub fn out_dir(&self, purpose: &str) -> PathBuf {
        let lowered = self.root.to_string_lossy().to_lowercase();
        let digest = Sha256::digest(lowered.as_bytes());
        // V1 takes the first 12 characters of the uppercase hex and lowercases them, which is the
        // first 6 bytes.
        let hash: String = digest[..6].iter().map(|b| format!("{b:02x}")).collect();

        wireframe_cache_dir()
            .join("builds")
            .join(format!("{}-{}", sanitize_name(&self.name()), hash))
            .join(purpose)
    }

    /// Files the agent authors. Used by the linter and by Studio's editor.
    pub fn source_files(&self) -> Vec<PathBuf> {
        let source_dir = self.source_dir();
        if !source_dir.is_dir() {
            return Vec::new();
        }
        walkdir::WalkDir::new(&source_dir)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.into_path())
            .filter(|path| {
                path.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| {
                        SOURCE_EXTENSIONS
                            .iter()
                            .any(|want| want.eq_ignore_ascii_case(e))
                    })
                    .unwrap_or(false)
            })
            .collect()
    }

    /// Always forward slashes, so a path that reaches the manifest, the agent readme or a log reads
    /// the same on every platform.
    pub fn relative_path(&self, absolute: &Path) -> String {
        let relative = absolute.strip_prefix(&self.root).unwrap_or(absolute);
        relative.to_string_lossy().replace('\\', "/")
    }
}

/// The shared wireframe cache: build output, the provisioned esbuild and the Tailwind CLI.
///
/// `WIREFRAME_CACHE` overrides it, which is what lets a test point the whole thing at a temporary
/// directory. Otherwise it is the platform's local application data, matching V1's
/// `Environment.SpecialFolder.LocalApplicationData`.
pub fn wireframe_cache_dir() -> PathBuf {
    if let Ok(val) = std::env::var("WIREFRAME_CACHE") {
        let trimmed = val.trim().trim_matches('"');
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    local_app_data().join("wireframe")
}

fn local_app_data() -> PathBuf {
    // Windows: %LOCALAPPDATA%. .NET maps LocalApplicationData to ~/.local/share on Linux and to
    // ~/Library/Application Support on macOS, so the ported cache lands in the same place a V1
    // install would have used.
    if cfg!(windows) {
        if let Ok(val) = std::env::var("LOCALAPPDATA") {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
    }
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support")
    } else {
        home.join(".local").join("share")
    }
}

/// Mirrors `tendril_core::config::dirs_home`: `USERPROFILE` first, then `HOME`. Kept local rather
/// than depending on `tendril-core`, because this crate must stay usable from the standalone
/// wireframe CLI paths that do not load Tendril's config.
fn home_dir() -> Option<PathBuf> {
    for name in ["USERPROFILE", "HOME"] {
        if let Ok(val) = std::env::var(name) {
            let trimmed = val.trim().trim_matches('"');
            if !trimmed.is_empty() {
                return Some(PathBuf::from(trimmed));
            }
        }
    }
    None
}

fn sanitize_name(name: &str) -> String {
    let mapped: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = mapped.trim_matches('-');
    if trimmed.is_empty() {
        "wireframe".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_hangs_off_src() {
        // Relative to the project's own root rather than a literal: `at()` absolutises against the
        // current directory, and on Windows a leading slash is not absolute at all -- which is also
        // what V1's `Path.GetFullPath` does with the same input.
        let project = WireframeProject::at("demo");
        let root = &project.root;
        assert_eq!(project.source_dir(), root.join("src"));
        assert_eq!(project.entry_point(), root.join("src").join("main.tsx"));
        assert_eq!(project.index_html(), root.join("src").join("index.html"));
        // public/ is inside src/, not beside it: it is part of the app.
        assert_eq!(project.public_dir(), root.join("src").join("public"));
        assert_eq!(project.legacy_public_dir(), root.join("public"));
        assert!(project.root.is_absolute());
    }

    #[test]
    fn out_dir_separates_purposes_and_survives_an_awkward_name() {
        std::env::set_var("WIREFRAME_CACHE", "/cache");
        let project = WireframeProject::at("/tmp/My Wireframe!");
        let serve = project.out_dir("serve");
        let shot = project.out_dir("screenshot");
        assert_ne!(
            serve, shot,
            "a screenshot build must not race a serve build"
        );
        let serve = serve.to_string_lossy().replace('\\', "/");
        assert!(serve.starts_with("/cache/builds/"), "got {serve}");
        assert!(serve.contains("My-Wireframe-"), "got {serve}");
        std::env::remove_var("WIREFRAME_CACHE");
    }

    #[test]
    fn tailwind_mode_accepts_every_spelling_v1_does() {
        for spelling in ["superset", "embedded", "default", "  SUPERSET  "] {
            assert_eq!(TailwindMode::parse(spelling), Some(TailwindMode::Superset));
        }
        for spelling in ["jit", "cli", "standalone", "JIT"] {
            assert_eq!(TailwindMode::parse(spelling), Some(TailwindMode::Jit));
        }
        assert_eq!(TailwindMode::parse("tailwind4"), None);
    }

    #[test]
    fn config_round_trips_and_leaves_no_file_for_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let project = WireframeProject::at(dir.path());

        // A default config writes nothing at all.
        WireframeConfig::default().save(&project).unwrap();
        assert!(!WireframeConfig::path_for(&project).exists());

        let jit = WireframeConfig {
            tailwind: TailwindMode::Jit,
        };
        jit.save(&project).unwrap();
        let text = std::fs::read_to_string(WireframeConfig::path_for(&project)).unwrap();
        // Lowercase in the file, as V1's camelCase enum converter writes it.
        assert!(text.contains("\"jit\""), "got {text}");
        assert_eq!(WireframeConfig::load(&project).tailwind, TailwindMode::Jit);

        // Saving defaults again removes the file rather than writing the defaults back.
        WireframeConfig::default().save(&project).unwrap();
        assert!(!WireframeConfig::path_for(&project).exists());
    }

    #[test]
    fn a_broken_config_falls_back_rather_than_failing() {
        let dir = tempfile::tempdir().unwrap();
        let project = WireframeProject::at(dir.path());
        std::fs::write(WireframeConfig::path_for(&project), "{ not json").unwrap();
        assert_eq!(
            WireframeConfig::load(&project).tailwind,
            TailwindMode::Superset
        );
    }
}
