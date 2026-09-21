//! Vault catalog, settings and gh-seam tests.
//!
//! Every fixture is a hand-built tree under `std::env::temp_dir()`, removed on drop; nothing here reads
//! the operator's real `~/.tendril`. **No test may reach the network or the `gh` CLI**: functions with a
//! `*_with(..., gh: GhRunner)` twin are always called through the twin, with either a canned stub or
//! [`never_called_runner`], which panics if a `gh` invocation is attempted at all.

use std::path::{Path, PathBuf};
use tendril_core::config::{get_config_path, load_config};
use tendril_core::vault::{
    self, collect_project_assets, discover_existing_vaults_with, extract_repo_name, get_catalog,
    import_project_with, list_github_accounts_with, normalize_repo_url, push_and_create_pr_with,
    GhFuture, VaultExportRequest, VaultImportRequest, VaultItemSyncStatus, VaultProjectManifest,
    VaultSettings, VaultState,
};

/// A throwaway `TENDRIL_HOME`, removed on drop.
struct HomeFixture {
    path: PathBuf,
}

impl HomeFixture {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "tendril-vault-{}-{}",
            label,
            uuid::Uuid::new_v4().simple()
        ));
        assert!(
            path.starts_with(std::env::temp_dir()),
            "fixtures must live under the temp dir"
        );
        std::fs::create_dir_all(&path).expect("create fixture home");
        Self { path }
    }

    fn vault_dir(&self) -> PathBuf {
        self.path.join("Vaults").join("abc12345")
    }

    /// Writes a `config.yaml` whose `vault:`/`vaults:` blocks point at [`Self::vault_dir`].
    fn write_config(&self, extra_yaml: &str) {
        let vault_path = self.vault_dir();
        let config = format!(
            "projects: []\nvault:\n  id: abc12345\n  name: acme/Tendril-Vault\n  enabled: true\n  repoUrl: https://github.com/acme/Tendril-Vault.git\n  localPath: {path}\nvaults:\n  - id: abc12345\n    name: acme/Tendril-Vault\n    enabled: true\n    repoUrl: https://github.com/acme/Tendril-Vault.git\n    localPath: {path}\n{extra}",
            path = vault_path.to_string_lossy(),
            extra = extra_yaml
        );
        std::fs::write(get_config_path(&self.path), config).expect("write config.yaml");
    }

    fn write(&self, relative: &str, contents: &str) {
        let path = self.path.join(relative);
        std::fs::create_dir_all(path.parent().expect("a parent dir")).expect("create dirs");
        std::fs::write(path, contents).expect("write fixture file");
    }
}

impl Drop for HomeFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// A `GhRunner` that fails the test if it is called. Passed on every path where `gh` must not be
/// reached, so a test can never silently shell out to the real CLI.
fn never_called_runner(args: Vec<String>, _working_dir: Option<PathBuf>) -> GhFuture {
    panic!(
        "gh must not be invoked in this test, but was called as: gh {}",
        args.join(" ")
    );
}

/// Builds a stub `GhRunner` from a list of `(argv-substring, exit code, stdout)` rules, matching the
/// first rule whose substring appears in the joined argv.
fn stub_gh(
    rules: Vec<(&'static str, i32, &'static str)>,
) -> impl Fn(Vec<String>, Option<PathBuf>) -> GhFuture + Send + Sync {
    move |args: Vec<String>, _working_dir: Option<PathBuf>| {
        let joined = args.join(" ");
        let matched = rules
            .iter()
            .find(|(needle, _, _)| joined.contains(needle))
            .map(|(_, code, stdout)| (*code, stdout.to_string()))
            // An unmatched call is a failed `gh`, not a panic: the code under test must cope with a
            // repository or account that does not exist.
            .unwrap_or((1, String::new()));
        Box::pin(async move { Ok((matched.0, matched.1, String::new())) })
    }
}

// -------------------------------------------------------------------------------------------------
// Catalog
// -------------------------------------------------------------------------------------------------

#[test]
fn catalog_reads_the_manifest_and_every_project() {
    let home = HomeFixture::new("catalog");
    home.write_config("");

    let vault = home.vault_dir();
    std::fs::create_dir_all(&vault).unwrap();
    std::fs::write(
        vault.join("vault.yaml"),
        "schemaVersion: 1\nname: acme/Tendril-Vault\ndescription: Team vault\nversion: 2026.09.14.101500\nupdatedAt: 2026-09-14T10:15:00Z\nupdatedBy: rory\n",
    )
    .unwrap();

    let alpha = vault.join("projects").join("Alpha");
    std::fs::create_dir_all(alpha.join("skills")).unwrap();
    std::fs::create_dir_all(alpha.join("memory")).unwrap();
    std::fs::write(alpha.join("skills").join("rust.md"), "# rust\n").unwrap();
    std::fs::write(alpha.join("memory").join("stack.md"), "# stack\n").unwrap();
    std::fs::write(
        alpha.join("project.yaml"),
        "schemaVersion: 1\nname: Alpha\nversion: 1.2.3\nupdatedAt: 2026-09-14T10:15:00Z\ncontext: The alpha project\ncolor: Green\nchangelog: Added rust skill\nreviewActions:\n  - name: Lint\n    command: cargo clippy\nverifications:\n  - name: RustBuild\n    required: true\nmcpServers:\n  - name: playwright\n    command: npx\n",
    )
    .unwrap();

    let beta = vault.join("projects").join("Beta");
    std::fs::create_dir_all(&beta).unwrap();
    std::fs::write(
        beta.join("project.yaml"),
        "schemaVersion: 1\nname: Beta\nversion: 0.1.0\nupdatedAt: 2026-09-14T10:15:00Z\n",
    )
    .unwrap();

    let catalog = get_catalog(&home.path, None).expect("read catalog");

    let manifest = catalog.manifest.expect("vault.yaml is parsed");
    assert_eq!(manifest.name, "acme/Tendril-Vault");
    assert_eq!(manifest.version, "2026.09.14.101500");
    assert_eq!(manifest.updated_by.as_deref(), Some("rory"));

    assert_eq!(catalog.projects.len(), 2);
    let alpha_item = &catalog.projects[0];
    assert_eq!(alpha_item.name, "Alpha");
    assert_eq!(alpha_item.remote_version, "1.2.3");
    assert_eq!(alpha_item.description, "The alpha project");
    assert_eq!(alpha_item.color, "Green");
    assert_eq!(alpha_item.skill_names, vec!["rust".to_string()]);
    assert_eq!(alpha_item.memory_file_names, vec!["stack.md".to_string()]);
    assert_eq!(alpha_item.mcp_server_names, vec!["playwright".to_string()]);
    assert_eq!(alpha_item.review_action_names, vec!["Lint".to_string()]);
    assert_eq!(alpha_item.verification_names, vec!["RustBuild".to_string()]);
    assert_eq!(alpha_item.skills_count, 1);
    assert_eq!(alpha_item.memories_count, 1);
    assert_eq!(alpha_item.mcps_count, 1);
    assert_eq!(alpha_item.review_actions_count, 1);
    assert_eq!(alpha_item.verifications_count, 1);
    assert_eq!(
        alpha_item.sync_status,
        VaultItemSyncStatus::NotImported,
        "no local project of this name exists yet"
    );

    assert_eq!(catalog.projects[1].name, "Beta");
    assert_eq!(catalog.projects[1].remote_version, "0.1.0");
}

#[test]
fn catalog_unions_skills_from_the_manifest_and_from_disk() {
    let home = HomeFixture::new("catalog-union");
    home.write_config("");

    let project = home.vault_dir().join("projects").join("Alpha");
    std::fs::create_dir_all(project.join("skills")).unwrap();
    std::fs::write(project.join("skills").join("rust.md"), "# rust\n").unwrap();
    // `skills` is not modelled by V2's manifest, so it arrives through the `extra` passthrough.
    std::fs::write(
        project.join("project.yaml"),
        "schemaVersion: 1\nname: Alpha\nversion: 1.0.0\nskills:\n  - typescript\n  - rust\n",
    )
    .unwrap();

    let catalog = get_catalog(&home.path, None).unwrap();
    assert_eq!(
        catalog.projects[0].skill_names,
        vec!["rust".to_string(), "typescript".to_string()],
        "the on-disk skill and the manifest-only skill are unioned, deduped and sorted"
    );
}

#[test]
fn a_malformed_project_is_skipped_rather_than_fatal() {
    let home = HomeFixture::new("catalog-malformed");
    home.write_config("");

    let projects = home.vault_dir().join("projects");
    std::fs::create_dir_all(projects.join("Broken")).unwrap();
    std::fs::write(
        projects.join("Broken").join("project.yaml"),
        "name: [this is not\n  valid: yaml\n",
    )
    .unwrap();
    std::fs::create_dir_all(projects.join("Good")).unwrap();
    std::fs::write(
        projects.join("Good").join("project.yaml"),
        "schemaVersion: 1\nname: Good\nversion: 1.0.0\n",
    )
    .unwrap();

    let catalog = get_catalog(&home.path, None).expect("a bad project must not fail the catalog");
    assert_eq!(catalog.projects.len(), 2, "both dirs are still listed");
    let broken = catalog
        .projects
        .iter()
        .find(|item| item.name == "Broken")
        .expect("the broken project is listed");
    assert_eq!(
        broken.remote_version, "",
        "an unparseable manifest yields empty metadata, not an error"
    );
    assert_eq!(
        catalog
            .projects
            .iter()
            .find(|item| item.name == "Good")
            .map(|item| item.remote_version.as_str()),
        Some("1.0.0")
    );
}

#[test]
fn a_vault_without_projects_yields_an_empty_catalog() {
    let home = HomeFixture::new("catalog-empty");
    home.write_config("");
    std::fs::create_dir_all(home.vault_dir()).unwrap();

    let catalog = get_catalog(&home.path, None).unwrap();
    assert!(catalog.projects.is_empty());
    assert!(catalog.manifest.is_none());
}

// -------------------------------------------------------------------------------------------------
// C# on-disk compatibility
// -------------------------------------------------------------------------------------------------

/// The 22-key `DateTimeOffset` map YamlDotNet writes, abridged to the keys the reader cares about plus
/// enough of the rest to prove they are ignored.
const CSHARP_TIMESTAMP: &str = "    dateTime: 2026-09-14T08:13:34.1084350\n    utcDateTime: 2026-09-14T06:13:34.1084350Z\n    localDateTime: 2026-09-14T08:13:34.1084350\n    date: 2026-09-14T00:00:00.0000000\n    day: 14\n    dayOfWeek: Monday\n    dayOfYear: 257\n    hour: 8\n    millisecond: 108\n    microsecond: 435\n    nanosecond: 0\n    minute: 13\n    month: 9\n    second: 34\n    ticks: 638931680141084350\n    utcTicks: 638931608141084350\n    timeOfDay: 08:13:34.1084350\n    year: 2026\n    offset: 02:00:00\n    totalOffsetMinutes: 120\n";

#[test]
fn a_csharp_written_project_manifest_parses() {
    let home = HomeFixture::new("compat-manifest");
    home.write_config("");

    let project = home.vault_dir().join("projects").join("Alpha");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(
        project.join("project.yaml"),
        format!(
            "schemaVersion: 1\nname: Alpha\nversion: 2026.09.14.081334\nupdatedBy: rory\nupdatedAt:\n{}",
            CSHARP_TIMESTAMP
        ),
    )
    .unwrap();

    let catalog = get_catalog(&home.path, None).expect("a C#-written manifest must parse");
    assert_eq!(catalog.projects[0].remote_version, "2026.09.14.081334");
    assert_eq!(
        catalog.projects[0].updated_at.to_rfc3339(),
        "2026-09-14T06:13:34.108435+00:00",
        "utcDateTime wins over the local dateTime, which is two hours ahead"
    );
}

#[test]
fn csharp_config_timestamps_and_the_never_sentinel_load() {
    let home = HomeFixture::new("compat-config");
    let vault_path = home.vault_dir();
    // `lastSyncedAt` as the C# map, `installedAt` as the `0001-01-01` "never" sentinel.
    std::fs::write(
        get_config_path(&home.path),
        format!(
            "projects: []\nvaults:\n  - id: abc12345\n    name: acme/Tendril-Vault\n    enabled: true\n    repoUrl: https://github.com/acme/Tendril-Vault.git\n    localPath: {path}\n    lastSyncedAt:\n{timestamp}    trackedProjects:\n      Alpha:\n        vaultProjectName: Alpha\n        installedVersion: 1.0.0\n        installedAt: 0001-01-01T00:00:00.0000000+00:00\n",
            path = vault_path.to_string_lossy(),
            timestamp = CSHARP_TIMESTAMP
                .lines()
                .map(|line| format!("  {}\n", line))
                .collect::<String>()
        ),
    )
    .unwrap();

    let settings = load_config(&get_config_path(&home.path)).expect("load config.yaml");
    let state = vault::load_vaults(&settings);
    let loaded = &state.vaults[0];

    assert_eq!(
        loaded.last_synced_at.map(|ts| ts.to_rfc3339()),
        Some("2026-09-14T06:13:34.108435+00:00".to_string())
    );
    assert_eq!(
        loaded.tracked_projects["Alpha"].installed_at, None,
        "the 0001-01-01 sentinel means 'never', not year 1"
    );
    assert_eq!(loaded.tracked_projects["Alpha"].installed_version, "1.0.0");
}

#[test]
fn unmodelled_manifest_keys_survive_a_round_trip() {
    // A teammate's C#-written project carries keys V2 does not model. Losing them on import → push
    // would silently delete their configuration, so they ride along in `extra`.
    let yaml = "schemaVersion: 1\nname: Alpha\nversion: 1.0.0\nupdatedAt: 2026-09-14T10:15:00Z\nmeta:\n  author: rory\nhooks:\n  preCommit: ./scripts/hook.sh\nskills:\n  - typescript\nsecurityPreset: Strict\nsandboxMode: true\n";

    let manifest: VaultProjectManifest = serde_yaml::from_str(yaml).expect("parse manifest");
    assert_eq!(manifest.extra.len(), 5);

    let round_tripped = serde_yaml::to_string(&manifest).expect("serialize manifest");
    let reparsed: VaultProjectManifest =
        serde_yaml::from_str(&round_tripped).expect("re-parse manifest");

    assert_eq!(reparsed.extra, manifest.extra);
    assert_eq!(reparsed.extra["securityPreset"], "Strict");
    assert_eq!(reparsed.extra["meta"]["author"], "rory");
    assert_eq!(reparsed.extra["skills"][0], "typescript");
    assert_eq!(
        reparsed.updated_at, manifest.updated_at,
        "timestamps always re-serialize as RFC3339"
    );
}

// -------------------------------------------------------------------------------------------------
// Settings helpers
// -------------------------------------------------------------------------------------------------

#[test]
fn repo_urls_normalize_to_a_comparable_form() {
    let expected = "https://github.com/o/r";
    for url in [
        "git@github.com:o/r.git",
        "https://github.com/o/r.git",
        "https://github.com/o/r/",
        "HTTPS://GitHub.com/O/R.git",
    ] {
        assert_eq!(normalize_repo_url(url), expected, "normalizing {}", url);
    }
}

#[test]
fn repo_names_are_extracted_as_owner_slash_name() {
    assert_eq!(extract_repo_name("https://github.com/o/r.git"), "o/r");
    assert_eq!(extract_repo_name("git@github.com:o/r.git"), "o/r");
    assert_eq!(
        extract_repo_name(""),
        "Tendril-Vault",
        "a blank URL yields the placeholder the C# app recognises"
    );
}

#[test]
fn ensure_vaults_initialized_migrates_and_heals() {
    // A lone `vault:` from an older C# release migrates into `vaults:`.
    let mut state = VaultState {
        primary: Some(VaultSettings {
            repo_url: "https://github.com/acme/Tendril-Vault.git".to_string(),
            ..Default::default()
        }),
        vaults: Vec::new(),
    };
    vault::ensure_vaults_initialized(&mut state);
    assert_eq!(state.vaults.len(), 1);
    assert_eq!(state.vaults[0].name, "acme/Tendril-Vault");
    assert_eq!(
        state.vaults[0].id.len(),
        8,
        "a blank id gets 8 hex characters"
    );
    assert!(state.vaults[0].id.chars().all(|c| c.is_ascii_hexdigit()));

    // A `{`-prefixed repoUrl is a serialized-object bug from an old release; it heals from the name.
    let mut state = VaultState {
        primary: None,
        vaults: vec![VaultSettings {
            id: "abc12345".to_string(),
            name: "acme/Tendril-Vault".to_string(),
            repo_url: "{\"Owner\":\"acme\"}".to_string(),
            ..Default::default()
        }],
    };
    vault::ensure_vaults_initialized(&mut state);
    assert_eq!(
        state.vaults[0].repo_url,
        "https://github.com/acme/Tendril-Vault.git"
    );

    // The placeholder name is replaced by the real `owner/repo`.
    let mut state = VaultState {
        primary: None,
        vaults: vec![VaultSettings {
            id: "abc12345".to_string(),
            name: "Tendril-Vault".to_string(),
            repo_url: "https://github.com/acme/team-vault.git".to_string(),
            ..Default::default()
        }],
    };
    vault::ensure_vaults_initialized(&mut state);
    assert_eq!(state.vaults[0].name, "acme/team-vault");
    assert_eq!(
        state.primary.as_ref().map(|primary| primary.id.as_str()),
        Some("abc12345"),
        "the primary alias is filled in from the first enabled vault"
    );
}

#[test]
fn resolve_vault_matches_by_id_name_or_url_then_falls_back() {
    let state = VaultState {
        primary: None,
        vaults: vec![
            VaultSettings {
                id: "aaaa1111".to_string(),
                name: "acme/first".to_string(),
                repo_url: "https://github.com/acme/first.git".to_string(),
                enabled: false,
                ..Default::default()
            },
            VaultSettings {
                id: "bbbb2222".to_string(),
                name: "acme/second".to_string(),
                repo_url: "https://github.com/acme/second.git".to_string(),
                enabled: true,
                ..Default::default()
            },
        ],
    };

    let by = |id: &str| vault::resolve_vault(&state, Some(id)).map(|vault| vault.id);
    assert_eq!(by("aaaa1111").as_deref(), Some("aaaa1111"));
    assert_eq!(
        by("ACME/FIRST").as_deref(),
        Some("aaaa1111"),
        "by name, case-insensitively"
    );
    assert_eq!(
        by("https://github.com/acme/first.git").as_deref(),
        Some("aaaa1111"),
        "by repository URL"
    );
    assert_eq!(
        by("default").as_deref(),
        Some("bbbb2222"),
        "'default' skips the lookup and takes the first enabled vault"
    );
    assert_eq!(
        vault::resolve_vault(&state, None)
            .map(|vault| vault.id)
            .as_deref(),
        Some("bbbb2222"),
        "no id falls back to the first enabled vault, not the first vault"
    );
    assert_eq!(
        vault::find_vault(&state, "nope"),
        None,
        "find_vault does not fall back, so a route can answer 404"
    );
}

#[test]
fn vault_dir_covers_all_three_branches() {
    let home = Path::new("/tmp/tendril-home");

    let explicit = VaultSettings {
        id: "abc12345".to_string(),
        local_path: "/custom/vault".to_string(),
        ..Default::default()
    };
    assert_eq!(
        vault::vault_dir(home, Some(&explicit)),
        PathBuf::from("/custom/vault"),
        "an explicit localPath wins"
    );

    let by_id = VaultSettings {
        id: "abc12345".to_string(),
        ..Default::default()
    };
    assert_eq!(
        vault::vault_dir(home, Some(&by_id)),
        home.join("Vaults").join("abc12345")
    );

    assert_eq!(
        vault::vault_dir(home, None),
        home.join("Vault"),
        "a vault so old it has no id lives in the legacy single-vault directory"
    );
}

#[test]
fn project_assets_are_collected_from_config_and_disk() {
    let home = HomeFixture::new("assets");
    std::fs::write(
        get_config_path(&home.path),
        "projects:\n  - name: Alpha\n    color: Blue\n    reviewActions:\n      - name: Lint\n        command: cargo clippy\n    verifications:\n      - name: RustBuild\n        required: true\n    mcpServers:\n      - name: playwright\n        command: npx\n",
    )
    .unwrap();
    home.write("Projects/Alpha/Skills/rust.md", "# rust\n");
    home.write("Projects/Alpha/Skills/typescript.md", "# ts\n");
    home.write("Projects/Alpha/Memory/stack.md", "# stack\n");
    home.write("Projects/Alpha/Skills/notes.txt", "ignored\n");

    let settings = load_config(&get_config_path(&home.path)).unwrap();
    let assets = collect_project_assets(&home.path, &settings, "alpha");

    assert_eq!(assets.project_name, "Alpha", "the config's spelling wins");
    assert_eq!(assets.skills, vec!["rust", "typescript"]);
    assert_eq!(
        assets.memories,
        vec!["stack.md"],
        "memories keep their extension, skills do not"
    );
    assert_eq!(assets.mcp_servers, vec!["playwright"]);
    assert_eq!(assets.review_actions, vec!["Lint"]);
    assert_eq!(assets.verifications, vec!["RustBuild"]);

    let unknown = collect_project_assets(&home.path, &settings, "Nope");
    assert_eq!(unknown.project_name, "Nope");
    assert!(
        unknown.skills.is_empty(),
        "an unknown project yields empty assets, not an error"
    );
}

// -------------------------------------------------------------------------------------------------
// The gh seam
// -------------------------------------------------------------------------------------------------

#[tokio::test]
async fn github_accounts_are_read_from_stubbed_gh_output() {
    let gh = stub_gh(vec![
        ("api user --jq", 0, "rorychatt\n"),
        ("api user/orgs --jq", 0, "Ivy-Interactive\nacme\n"),
    ]);

    let accounts = list_github_accounts_with(&gh).await.expect("list accounts");

    assert_eq!(accounts.len(), 3);
    assert_eq!(accounts[0].login, "rorychatt");
    assert_eq!(accounts[0].account_type, "Personal");
    assert_eq!(accounts[1].login, "Ivy-Interactive");
    assert_eq!(accounts[1].account_type, "Organization");
    assert_eq!(accounts[2].login, "acme");
}

#[tokio::test]
async fn a_json_error_payload_is_not_mistaken_for_a_login() {
    let gh = stub_gh(vec![
        ("api user --jq", 0, "{\"message\":\"Bad credentials\"}"),
        ("api user/orgs --jq", 1, ""),
    ]);

    let accounts = list_github_accounts_with(&gh).await.expect("list accounts");
    assert!(accounts.is_empty());
}

#[tokio::test]
async fn discover_reads_visibility_and_account_type_from_stubbed_gh_output() {
    let home = HomeFixture::new("discover");
    std::fs::write(get_config_path(&home.path), "projects: []\n").unwrap();

    let gh = stub_gh(vec![
        ("api user --jq", 0, "rorychatt"),
        ("api user/orgs --jq", 0, ""),
        (
            "api repos/rorychatt/Tendril-Vault",
            0,
            "{\"fullName\":\"rorychatt/Tendril-Vault\",\"url\":\"https://github.com/rorychatt/Tendril-Vault\",\"isPrivate\":true}",
        ),
        (
            "repo list rorychatt",
            0,
            "[{\"nameWithOwner\":\"rorychatt/Tendril-Vault\",\"url\":\"https://github.com/rorychatt/Tendril-Vault\",\"isPrivate\":true,\"name\":\"Tendril-Vault\"},{\"nameWithOwner\":\"rorychatt/team-vault\",\"url\":\"https://github.com/rorychatt/team-vault\",\"isPrivate\":false,\"name\":\"team-vault\"},{\"nameWithOwner\":\"rorychatt/unrelated\",\"url\":\"https://github.com/rorychatt/unrelated\",\"isPrivate\":false,\"name\":\"unrelated\"}]",
        ),
    ]);

    let discovered = discover_existing_vaults_with(&home.path, &gh)
        .await
        .expect("discover vaults");

    assert_eq!(
        discovered.len(),
        2,
        "the conventional vault and the name-matching one, with the duplicate and the unrelated repo dropped"
    );
    assert_eq!(discovered[0].full_name, "rorychatt/Tendril-Vault");
    assert!(discovered[0].is_private);
    assert_eq!(discovered[0].account_type, "Personal");
    assert_eq!(discovered[0].owner, "rorychatt");
    assert_eq!(discovered[1].name, "team-vault");
    assert!(!discovered[1].is_private);
}

#[tokio::test]
async fn discover_filters_out_an_already_connected_vault() {
    let home = HomeFixture::new("discover-connected");
    home.write_config("");

    // The connected vault is stored as HTTPS; `gh` reports the SSH spelling of the same repository.
    let gh = stub_gh(vec![
        ("api user --jq", 0, "acme"),
        ("api user/orgs --jq", 0, ""),
        (
            "repo list acme",
            0,
            "[{\"nameWithOwner\":\"acme/Tendril-Vault\",\"url\":\"git@github.com:acme/Tendril-Vault.git\",\"isPrivate\":true,\"name\":\"Tendril-Vault\"}]",
        ),
    ]);

    let discovered = discover_existing_vaults_with(&home.path, &gh)
        .await
        .expect("discover vaults");
    assert!(
        discovered.is_empty(),
        "the SSH and HTTPS spellings of one repository must not both appear"
    );
}

#[tokio::test]
async fn import_of_an_unknown_vault_fails_before_reaching_gh() {
    let home = HomeFixture::new("import-no-vault");
    std::fs::write(get_config_path(&home.path), "projects: []\n").unwrap();

    let request = VaultImportRequest {
        project_name: "Alpha".to_string(),
        ..Default::default()
    };
    let result = import_project_with(&home.path, &request, None, &never_called_runner)
        .await
        .expect("a missing vault is a failed result, not an error");

    assert!(!result.success);
    assert_eq!(result.message, "No vault configured for import.");
}

#[tokio::test]
async fn import_of_an_unknown_project_fails_before_reaching_gh() {
    let home = HomeFixture::new("import-no-project");
    home.write_config("");
    std::fs::create_dir_all(home.vault_dir().join("projects")).unwrap();

    let request = VaultImportRequest {
        project_name: "Nope".to_string(),
        ..Default::default()
    };
    let result = import_project_with(&home.path, &request, None, &never_called_runner)
        .await
        .expect("a missing project is a failed result, not an error");

    assert!(!result.success);
    assert!(
        result.message.contains("Nope"),
        "the message names the missing project, got: {}",
        result.message
    );
}

#[tokio::test]
async fn push_without_a_vault_fails_before_reaching_gh() {
    let home = HomeFixture::new("push-no-vault");
    std::fs::write(get_config_path(&home.path), "projects: []\n").unwrap();

    let request = VaultExportRequest {
        project_names: vec!["Alpha".to_string()],
        version: "2026.09.14.101500".to_string(),
        ..Default::default()
    };
    let result = push_and_create_pr_with(&home.path, &request, None, &never_called_runner)
        .await
        .expect("a missing vault is a failed result, not an error");

    assert!(!result.success);
    assert_eq!(
        result.error_message.as_deref(),
        Some("No vault configured to push updates.")
    );
}

// -------------------------------------------------------------------------------------------------
// coAuthor attribution on the vault's own commits
// -------------------------------------------------------------------------------------------------

/// Runs git in the fixture with an identity pinned and the developer's global config ignored, the
/// same way the other git-touching tests in this crate do.
fn fixture_git(cwd: &Path, args: &[&str]) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Tendril Test")
        .env("GIT_AUTHOR_EMAIL", "test@tendril.invalid")
        .env("GIT_COMMITTER_NAME", "Tendril Test")
        .env("GIT_COMMITTER_EMAIL", "test@tendril.invalid")
        .output()
        .unwrap_or_else(|e| panic!("spawn git {args:?}: {e}"));
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn git_stdout(cwd: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .output()
        .unwrap_or_else(|e| panic!("spawn git {args:?}: {e}"));
    String::from_utf8_lossy(&out.stdout).to_string()
}

/// A vault repository wired to a bare local "origin", so the push path runs for real without a
/// network or the `gh` CLI.
fn init_vault_repo(home: &HomeFixture) {
    let remote = home.path.join("origin.git");
    fixture_git(
        &home.path,
        &["init", "-q", "--bare", &remote.to_string_lossy()],
    );

    let dir = home.vault_dir();
    std::fs::create_dir_all(dir.join("projects")).expect("create vault projects dir");
    fixture_git(&dir, &["init", "-q", "-b", "main", "."]);
    // Repo-local, not the `GIT_AUTHOR_*` env `fixture_git` sets: the commit under test is made by
    // `vault::service` inside this process, so it never sees that env. A developer machine has a
    // global identity and hid this; CI has none, and there `git commit` refused, leaving the branch
    // still pointing at the seed commit and the assertion reading "seed".
    fixture_git(&dir, &["config", "user.name", "Tendril Test"]);
    fixture_git(&dir, &["config", "user.email", "test@tendril.invalid"]);
    fixture_git(
        &dir,
        &["remote", "add", "origin", &remote.to_string_lossy()],
    );
    std::fs::write(dir.join("README.md"), "# vault\n").expect("write README");
    fixture_git(&dir, &["add", "-A"]);
    fixture_git(&dir, &["commit", "-q", "-m", "seed"]);
    fixture_git(&dir, &["push", "-q", "-u", "origin", "main"]);
}

/// The message of the commit the export produced.
///
/// Read by subject rather than from `HEAD`: `push_and_create_pr_with` checks the base branch back out
/// once the push succeeds (`vault/service.rs`), so the commit under test is left on the
/// `vault/update-*` branch and `HEAD` is back on `main`.
fn vault_update_commit_message(home: &HomeFixture) -> String {
    let dir = home.vault_dir();
    let branch = git_stdout(
        &dir,
        &["branch", "--list", "vault/update-*", "--format=%(refname)"],
    );
    let branch = branch
        .lines()
        .next()
        .unwrap_or_else(|| panic!("the export must have created a vault/update-* branch"))
        .trim();
    git_stdout(&dir, &["log", "-1", "--format=%B", branch])
}

fn export_request() -> VaultExportRequest {
    VaultExportRequest {
        project_names: vec![],
        version: "2026.09.14.101500".to_string(),
        changelog: "a changelog line".to_string(),
        ..Default::default()
    }
}

/// The vault's commits are the one place [`tendril_core::git::coauthor_hooks`] cannot reach: they run
/// in the daemon process through `git_run`, not in an agent Tendril spawned, so no `GIT_CONFIG_*`
/// override is in effect. They carry the trailer as a `--trailer` argument instead, and this asserts
/// the wiring rather than just the git behaviour — a `git_commit` helper that quietly stopped reading
/// the setting would still pass a test that only ran git by hand.
#[tokio::test]
async fn a_configured_co_author_reaches_the_vaults_own_commits() {
    let home = HomeFixture::new("coauthor-on");
    home.write_config("coAuthor: 'vault-bot <vault@example.invalid>'\n");
    init_vault_repo(&home);

    let gh = stub_gh(vec![("pr create", 0, "https://github.com/acme/v/pull/1")]);
    push_and_create_pr_with(&home.path, &export_request(), None, &gh)
        .await
        .expect("push must not error");

    let message = vault_update_commit_message(&home);
    assert!(
        message.contains("Co-Authored-By: vault-bot <vault@example.invalid>"),
        "the vault commit must carry the configured trailer, got:\n{message}"
    );
    assert!(
        message.contains("a changelog line"),
        "and the changelog body must survive the extra argument, got:\n{message}"
    );
}

/// The default-behaviour half: an install that has not set `coAuthor` produces exactly the commit it
/// produces today, with no trailer of any kind.
#[tokio::test]
async fn an_unconfigured_vault_commit_is_unchanged() {
    let home = HomeFixture::new("coauthor-off");
    home.write_config("");
    init_vault_repo(&home);

    let gh = stub_gh(vec![("pr create", 0, "https://github.com/acme/v/pull/1")]);
    push_and_create_pr_with(&home.path, &export_request(), None, &gh)
        .await
        .expect("push must not error");

    let message = vault_update_commit_message(&home);
    assert!(
        !message.contains("Co-Authored-By"),
        "an unconfigured vault commit must be byte-identical to today, got:\n{message}"
    );
    assert!(
        message.contains("a changelog line"),
        "and must still be a real vault commit, got:\n{message}"
    );
}
