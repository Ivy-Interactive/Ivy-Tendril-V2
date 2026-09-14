//! A bounded native stack detector.
//!
//! Walks a folder, discovers components from their manifest files, maps declared
//! dependencies and marker files to technologies, and derives language statistics from file
//! extensions. The output is deliberately trimmed: only stack-defining technologies at
//! better-than-low confidence survive, because `SetupProject` / `AddProject` derive a
//! project's Stack Descriptor Hash from this report and incidental libraries would make the
//! hash churn.

use crate::error::Result;
use crate::stack::rules::{
    Confidence, LanguageKind, MarkerRule, TechCategory, AUXILIARY_SEGMENTS, INFRASTRUCTURE_IMAGES,
    LANGUAGES, MARKERS, SKIP_DIRS, TECHNOLOGIES,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// The trimmed stack report. Empty sections are omitted entirely, so an empty folder
/// serializes to `{}`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub components: Option<Vec<ComponentReport>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub infrastructure: Option<Vec<InfraReport>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReport {
    pub relative_path: String,
    /// Emitted only when true.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_workspace_root: Option<bool>,
    /// Emitted only when true.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_auxiliary: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technologies: Option<Vec<TechReport>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TechReport {
    pub name: String,
    pub category: String,
    pub confidence: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfraReport {
    pub kind: String,
    pub category: String,
}

/// Analyzes a folder and returns the trimmed YAML stack report.
pub fn analyze_to_yaml(root: &Path) -> Result<String> {
    Ok(serde_yaml::to_string(&analyze(root))?)
}

/// Analyzes a folder. Never fails on unreadable files or unparseable manifests — a partial
/// report is more useful to the planning agents than an error.
pub fn analyze(root: &Path) -> StackReport {
    let scan = scan_tree(root);

    let mut component_dirs: Vec<PathBuf> = scan.manifests.keys().cloned().collect();
    component_dirs.sort();

    let mut components = Vec::new();
    for dir in &component_dirs {
        let manifests = &scan.manifests[dir];
        let mut deps = Vec::new();
        let mut technologies = Vec::new();
        let mut is_workspace_root = false;

        for manifest in manifests {
            let parsed = parse_manifest(manifest);
            deps.extend(parsed.dependencies);
            technologies.extend(parsed.technologies);
            is_workspace_root |= parsed.is_workspace_root;
        }

        if scan.pnpm_workspaces.contains(dir) {
            is_workspace_root = true;
        }

        technologies.extend(
            deps.iter()
                .filter_map(|d| resolve_dependency(&d.name, d.cap)),
        );
        technologies.extend(
            scan.markers
                .get(dir)
                .into_iter()
                .flatten()
                .map(|m| Technology::from_marker(m)),
        );

        let languages = language_list(scan.component_languages.get(dir));
        let technologies = trim_technologies(technologies);

        // Drop aggregator/empty components that carry no stack signal at all.
        if technologies.is_empty() && languages.is_none() {
            continue;
        }

        let relative_path = relative_display(root, dir);
        components.push(ComponentReport {
            is_auxiliary: flag(is_auxiliary(&relative_path)),
            is_workspace_root: flag(is_workspace_root),
            relative_path,
            languages,
            technologies: if technologies.is_empty() {
                None
            } else {
                Some(technologies)
            },
        });
    }

    let infrastructure = detect_infrastructure(&scan.compose_files);

    StackReport {
        languages: language_list(Some(&scan.languages)),
        components: if components.is_empty() {
            None
        } else {
            Some(components)
        },
        infrastructure: if infrastructure.is_empty() {
            None
        } else {
            Some(infrastructure)
        },
    }
}

/// A detected technology before trimming.
struct Technology {
    name: &'static str,
    category: TechCategory,
    confidence: Confidence,
}

impl Technology {
    fn from_marker(marker: &'static MarkerRule) -> Self {
        Self {
            name: marker.name,
            category: marker.category,
            confidence: marker.confidence,
        }
    }
}

/// A dependency declared by a manifest. `cap` limits the confidence any rule can claim:
/// a peer dependency signals compatibility, not use, so it can never rise above `Low` and
/// is therefore always trimmed away.
struct DeclaredDependency {
    name: String,
    cap: Confidence,
}

#[derive(Default)]
struct ParsedManifest {
    dependencies: Vec<DeclaredDependency>,
    technologies: Vec<Technology>,
    is_workspace_root: bool,
}

#[derive(Default)]
struct TreeScan {
    /// component directory -> its manifest files
    manifests: HashMap<PathBuf, Vec<PathBuf>>,
    /// component directory -> marker rules matched inside it
    markers: HashMap<PathBuf, Vec<&'static MarkerRule>>,
    /// directories holding a `pnpm-workspace.yaml`
    pnpm_workspaces: Vec<PathBuf>,
    compose_files: Vec<PathBuf>,
    /// language name -> bytes, across the whole tree
    languages: HashMap<&'static str, u64>,
    /// component directory -> language name -> bytes
    component_languages: HashMap<PathBuf, HashMap<&'static str, u64>>,
}

fn scan_tree(root: &Path) -> TreeScan {
    let mut scan = TreeScan::default();
    let mut files: Vec<(PathBuf, u64)> = Vec::new();

    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 || !e.file_type().is_dir() {
                return true;
            }
            let name = e.file_name().to_string_lossy();
            !SKIP_DIRS.iter().any(|d| name.eq_ignore_ascii_case(d))
        });

    for entry in walker.flatten() {
        let path = entry.path().to_path_buf();
        let name = entry.file_name().to_string_lossy().to_string();

        if entry.file_type().is_dir() {
            // A directory can itself be a marker (`.storybook`).
            if let Some(parent) = path.parent() {
                if let Some(marker) = match_marker(&name) {
                    scan.markers
                        .entry(parent.to_path_buf())
                        .or_default()
                        .push(marker);
                }
            }
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }

        let parent = path.parent().unwrap_or(root).to_path_buf();

        if is_manifest(&name) {
            scan.manifests
                .entry(parent.clone())
                .or_default()
                .push(path.clone());
        }
        if name.eq_ignore_ascii_case("pnpm-workspace.yaml") {
            scan.pnpm_workspaces.push(parent.clone());
        }
        if is_compose_file(&name) {
            scan.compose_files.push(path.clone());
        }
        if let Some(marker) = match_marker(&name) {
            scan.markers.entry(parent).or_default().push(marker);
        }

        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        files.push((path, size));
    }

    // Language statistics are only meaningful once every component is known, since each file
    // counts towards its nearest enclosing component.
    let mut component_dirs: Vec<PathBuf> = scan.manifests.keys().cloned().collect();
    component_dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));

    for (path, size) in files {
        let Some(language) = language_for(&path) else {
            continue;
        };
        *scan.languages.entry(language).or_insert(0) += size;

        if let Some(owner) = component_dirs.iter().find(|d| path.starts_with(d)) {
            *scan
                .component_languages
                .entry(owner.clone())
                .or_default()
                .entry(language)
                .or_insert(0) += size;
        }
    }

    scan
}

fn is_manifest(file_name: &str) -> bool {
    const EXACT: &[&str] = &[
        "package.json",
        "Cargo.toml",
        "pyproject.toml",
        "requirements.txt",
        "go.mod",
        "pom.xml",
    ];
    if EXACT.iter().any(|m| file_name.eq_ignore_ascii_case(m)) {
        return true;
    }
    let lower = file_name.to_ascii_lowercase();
    lower.ends_with(".csproj") || lower.starts_with("build.gradle")
}

fn is_compose_file(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    lower.starts_with("docker-compose") && (lower.ends_with(".yml") || lower.ends_with(".yaml"))
}

/// Matches a file or directory name against the marker table. `foo.config` patterns match the
/// whole `foo.config.*` family.
fn match_marker(name: &str) -> Option<&'static MarkerRule> {
    MARKERS.iter().find(|m| {
        name.eq_ignore_ascii_case(m.pattern)
            || (m.pattern.contains(".config")
                && name.len() > m.pattern.len()
                && name[..m.pattern.len()].eq_ignore_ascii_case(m.pattern)
                && name.as_bytes()[m.pattern.len()] == b'.')
    })
}

fn language_for(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    LANGUAGES
        .iter()
        .find(|(e, _, _)| *e == ext)
        .filter(|(_, _, kind)| matches!(kind, LanguageKind::Programming | LanguageKind::Markup))
        .map(|(_, name, _)| *name)
}

/// Significant languages, dominant first by share of bytes. Ties break on name so the report
/// — and therefore the stack hash derived from it — is deterministic.
fn language_list(stats: Option<&HashMap<&'static str, u64>>) -> Option<Vec<String>> {
    let stats = stats?;
    if stats.is_empty() {
        return None;
    }
    let mut entries: Vec<(&str, u64)> = stats.iter().map(|(k, v)| (*k, *v)).collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    Some(
        entries
            .into_iter()
            .map(|(name, _)| name.to_string())
            .collect(),
    )
}

fn resolve_dependency(name: &str, cap: Confidence) -> Option<Technology> {
    let last_segment = name.rsplit(['/', ':']).next().unwrap_or(name);
    let (_, display, category, confidence) = TECHNOLOGIES.iter().find(|(key, _, _, _)| {
        key.eq_ignore_ascii_case(name) || key.eq_ignore_ascii_case(last_segment)
    })?;

    Some(Technology {
        name: display,
        category: *category,
        confidence: (*confidence).min(cap),
    })
}

/// Keeps only stack-defining technologies at better-than-low confidence, de-duplicated by
/// name (highest confidence wins) and sorted by name.
fn trim_technologies(technologies: Vec<Technology>) -> Vec<TechReport> {
    let mut best: HashMap<&'static str, Technology> = HashMap::new();
    for tech in technologies {
        if tech.confidence == Confidence::Low || !tech.category.is_defining() {
            continue;
        }
        match best.get(tech.name) {
            Some(existing) if existing.confidence >= tech.confidence => {}
            _ => {
                best.insert(tech.name, tech);
            }
        }
    }

    let mut reports: Vec<TechReport> = best
        .into_values()
        .map(|t| TechReport {
            name: t.name.to_string(),
            category: t.category.slug().to_string(),
            confidence: t.confidence.slug().to_string(),
        })
        .collect();
    reports.sort_by(|a, b| a.name.cmp(&b.name));
    reports
}

fn detect_infrastructure(compose_files: &[PathBuf]) -> Vec<InfraReport> {
    let mut reports: Vec<InfraReport> = Vec::new();

    for file in compose_files {
        let Ok(content) = std::fs::read_to_string(file) else {
            continue;
        };
        let Ok(doc) = serde_yaml::from_str::<serde_yaml::Value>(&content) else {
            continue;
        };
        let Some(services) = doc.get("services").and_then(|s| s.as_mapping()) else {
            continue;
        };

        for (_, service) in services {
            let Some(image) = service.get("image").and_then(|i| i.as_str()) else {
                continue;
            };
            let image = image.to_ascii_lowercase();
            // Unrecognised images are skipped rather than guessed at.
            if let Some((_, kind, category)) = INFRASTRUCTURE_IMAGES
                .iter()
                .find(|(needle, _, _)| image.contains(needle))
            {
                if !reports.iter().any(|r| r.kind == *kind) {
                    reports.push(InfraReport {
                        kind: kind.to_string(),
                        category: category.to_string(),
                    });
                }
            }
        }
    }

    reports.sort_by(|a, b| a.kind.cmp(&b.kind));
    reports
}

fn relative_display(root: &Path, dir: &Path) -> String {
    match dir.strip_prefix(root) {
        Ok(rel) if rel.as_os_str().is_empty() => ".".to_string(),
        Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
        Err(_) => dir.to_string_lossy().replace('\\', "/"),
    }
}

fn is_auxiliary(relative_path: &str) -> bool {
    relative_path.split('/').any(|segment| {
        AUXILIARY_SEGMENTS
            .iter()
            .any(|a| segment.eq_ignore_ascii_case(a))
    })
}

fn flag(value: bool) -> Option<bool> {
    if value {
        Some(true)
    } else {
        None
    }
}

fn parse_manifest(path: &Path) -> ParsedManifest {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return ParsedManifest::default();
    };
    let Ok(content) = std::fs::read_to_string(path) else {
        return ParsedManifest::default();
    };
    let lower = name.to_ascii_lowercase();

    match lower.as_str() {
        "package.json" => parse_package_json(&content),
        "cargo.toml" => parse_cargo_toml(&content),
        "pyproject.toml" => parse_pyproject(&content),
        "requirements.txt" => parse_requirements(&content),
        "go.mod" => parse_go_mod(&content),
        "pom.xml" => parse_pom(&content),
        _ if lower.ends_with(".csproj") => parse_csproj(&content),
        _ if lower.starts_with("build.gradle") => parse_gradle(&content),
        _ => ParsedManifest::default(),
    }
}

fn parse_package_json(content: &str) -> ParsedManifest {
    let mut parsed = ParsedManifest::default();
    let Ok(json) = serde_json::from_str::<serde_json::Value>(content) else {
        return parsed;
    };

    for (section, cap) in [
        ("dependencies", Confidence::High),
        ("devDependencies", Confidence::High),
        ("peerDependencies", Confidence::Low),
    ] {
        if let Some(map) = json.get(section).and_then(|d| d.as_object()) {
            parsed
                .dependencies
                .extend(map.keys().map(|k| DeclaredDependency {
                    name: k.clone(),
                    cap,
                }));
        }
    }

    parsed.is_workspace_root = json.get("workspaces").is_some();
    parsed
}

/// Line-based TOML reading, deliberately: pulling in a full TOML parser for a handful of
/// section headers and dependency keys is not worth the dependency.
fn parse_cargo_toml(content: &str) -> ParsedManifest {
    let mut parsed = ParsedManifest::default();
    let mut section = String::new();

    for line in content.lines() {
        let line = line.trim();
        if let Some(header) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = header.trim().to_string();
            if section == "workspace" {
                parsed.is_workspace_root = true;
            }
            continue;
        }
        if !matches!(
            section.as_str(),
            "dependencies"
                | "dev-dependencies"
                | "build-dependencies"
                | "workspace.dependencies"
                | "workspace.dev-dependencies"
        ) {
            continue;
        }
        if let Some(key) = toml_key(line) {
            parsed.dependencies.push(DeclaredDependency {
                name: key,
                cap: Confidence::High,
            });
        }
    }

    parsed
}

/// The dependency name from a TOML key/value line: `serde = "1"`, `serde.workspace = true`
/// and `"quoted-name" = { .. }` all yield `serde` / `quoted-name`.
fn toml_key(line: &str) -> Option<String> {
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let key = line.split('=').next()?.trim();
    let key = key.split('.').next()?.trim().trim_matches('"');
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

fn parse_pyproject(content: &str) -> ParsedManifest {
    let mut parsed = ParsedManifest::default();
    let mut section = String::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(header) = trimmed.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = header.trim().to_string();
            continue;
        }

        if section.starts_with("tool.poetry") && section.ends_with("dependencies") {
            if let Some(key) = toml_key(trimmed) {
                parsed.dependencies.push(DeclaredDependency {
                    name: key,
                    cap: Confidence::High,
                });
            }
            continue;
        }

        // PEP 621 lists requirement strings: `dependencies = ["flask>=3", ...]`.
        if section == "project" || section.starts_with("project.") {
            for requirement in quoted_strings(trimmed) {
                if let Some(name) = requirement_name(&requirement) {
                    parsed.dependencies.push(DeclaredDependency {
                        name,
                        cap: Confidence::High,
                    });
                }
            }
        }
    }

    parsed
}

fn parse_requirements(content: &str) -> ParsedManifest {
    ParsedManifest {
        dependencies: content
            .lines()
            .filter_map(|line| requirement_name(line.trim()))
            .map(|name| DeclaredDependency {
                name,
                cap: Confidence::High,
            })
            .collect(),
        ..Default::default()
    }
}

fn requirement_name(requirement: &str) -> Option<String> {
    let requirement = requirement.trim();
    if requirement.is_empty() || requirement.starts_with('#') || requirement.starts_with('-') {
        return None;
    }
    let name: String = requirement
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn parse_go_mod(content: &str) -> ParsedManifest {
    let mut parsed = ParsedManifest::default();
    let mut in_require_block = false;

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with("require (") {
            in_require_block = true;
            continue;
        }
        if in_require_block && line == ")" {
            in_require_block = false;
            continue;
        }

        let module = if in_require_block {
            line.split_whitespace().next()
        } else {
            line.strip_prefix("require ")
                .and_then(|l| l.split_whitespace().next())
        };

        if let Some(module) = module.filter(|m| !m.is_empty() && !m.starts_with("//")) {
            parsed.dependencies.push(DeclaredDependency {
                name: module.to_string(),
                cap: Confidence::High,
            });
        }
    }

    parsed
}

fn parse_csproj(content: &str) -> ParsedManifest {
    let mut parsed = ParsedManifest::default();

    for capture in attribute_values(content, "Include") {
        parsed.dependencies.push(DeclaredDependency {
            name: capture,
            cap: Confidence::High,
        });
    }

    // The web SDK is the clearest ASP.NET Core signal there is.
    if attribute_values(content, "Sdk")
        .iter()
        .any(|sdk| sdk.eq_ignore_ascii_case("Microsoft.NET.Sdk.Web"))
    {
        parsed.technologies.push(Technology {
            name: "ASP.NET Core",
            category: TechCategory::Framework,
            confidence: Confidence::High,
        });
    }

    parsed
}

fn parse_pom(content: &str) -> ParsedManifest {
    ParsedManifest {
        dependencies: element_values(content, "artifactId")
            .into_iter()
            .map(|name| DeclaredDependency {
                name,
                cap: Confidence::High,
            })
            .collect(),
        ..Default::default()
    }
}

fn parse_gradle(content: &str) -> ParsedManifest {
    let mut parsed = ParsedManifest::default();

    for line in content.lines() {
        let trimmed = line.trim();
        if !["implementation", "api", "testImplementation", "compileOnly"]
            .iter()
            .any(|kw| trimmed.starts_with(kw))
        {
            continue;
        }
        for coordinate in quoted_strings(trimmed) {
            // group:artifact:version
            if let Some(artifact) = coordinate.split(':').nth(1) {
                parsed.dependencies.push(DeclaredDependency {
                    name: artifact.to_string(),
                    cap: Confidence::High,
                });
            }
        }
    }

    parsed
}

/// All `name="value"` / `name='value'` attribute values for an attribute, without pulling in
/// an XML parser for what is a fixed two-attribute lookup.
fn attribute_values(content: &str, attribute: &str) -> Vec<String> {
    let mut values = Vec::new();
    for quote in ['"', '\''] {
        let needle = format!("{}={}", attribute, quote);
        for part in content.split(&needle).skip(1) {
            if let Some(value) = part.split(quote).next() {
                if !value.is_empty() {
                    values.push(value.to_string());
                }
            }
        }
    }
    values
}

fn element_values(content: &str, element: &str) -> Vec<String> {
    let open = format!("<{}>", element);
    let close = format!("</{}>", element);
    content
        .split(&open)
        .skip(1)
        .filter_map(|part| part.split(&close).next())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect()
}

fn quoted_strings(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    for quote in ['"', '\''] {
        let mut parts = line.split(quote);
        parts.next();
        while let Some(value) = parts.next() {
            if !value.is_empty() {
                values.push(value.to_string());
            }
            if parts.next().is_none() {
                break;
            }
        }
    }
    values
}
