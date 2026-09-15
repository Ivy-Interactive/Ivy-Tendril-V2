use tendril_core::config::{
    load_config, save_config, update_config_raw, LlmConfig, TendrilSettings,
};
use tendril_core::models::{
    OutsideFileAccessPolicy, SandboxMode, SecurityPreset, TerminalAutoExecution,
};

const SAMPLE_IVY_CONFIG: &str = r##"
codingAgent: claude
jobTimeout: 30
staleOutputTimeout: 10
gitTimeout: 10
maxConcurrentJobs: 20
projects:
  - name: my-project
    color: Blue
    repos:
      - path: /repos/my-project
verifications: []
planTemplate: "# Plan Template"
levels:
  - name: Feature
    color: Blue
telemetry: true
theme: default
beta: false
editor:
  command: code
  args: ["-n"]
llm:
  provider: anthropic
  model: claude-3-7-sonnet
auth:
  enabled: true
  tokenExpiry: 3600
api:
  baseUrl: https://api.tendril.dev
  timeout: 30
tunnel:
  enabled: false
  provider: cloudflare
vault:
  id: v-12345
  name: main-vault
  enabled: true
vaults:
  - id: v-12345
    name: main-vault
shareTunnel:
  enabled: false
  port: 5011
codingAgents:
  custom-agent:
    command: agent-cli
desktopNotifications: true
sidebarOpen: false
themeMode: dark
dismissedUpdateVersion: 1.2.0
customSetting1: foo
customSetting2:
  nestedField: bar
customSetting3: [1, 2, 3]
"##;

#[test]
fn test_config_unknown_keys_survive_load_and_save() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-config-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");

    std::fs::write(&config_path, SAMPLE_IVY_CONFIG).unwrap();

    // Load config
    let mut settings = load_config(&config_path).expect("load_config should succeed");

    // Check modeled fields
    assert_eq!(settings.coding_agent, "claude");
    assert_eq!(settings.job_timeout, 30);

    // Verify unmodeled keys are in extra
    assert!(settings.extra.contains_key("editor"));
    // `llm` is a modeled field now, so `#[serde(flatten)] extra` can no longer claim it. What matters
    // is that its *unmodeled subkeys* survived into `LlmConfig::extra` rather than being dropped.
    assert!(!settings.extra.contains_key("llm"));
    let llm = settings.llm.as_ref().expect("llm should be modeled");
    assert_eq!(
        llm.extra.get("provider"),
        Some(&serde_json::json!("anthropic"))
    );
    assert_eq!(llm.model, "claude-3-7-sonnet");
    // `auth`, `api` and `security` are modeled fields now, so `#[serde(flatten)] extra` can no
    // longer claim them — the same migration `codingAgents` and `llm` went through. Each record's own
    // nested `extra` is what keeps the unmodeled inner keys alive.
    assert!(!settings.extra.contains_key("auth"));
    assert!(!settings.extra.contains_key("api"));
    let auth = settings.auth.clone().expect("auth section is modeled");
    assert!(auth.extra.contains_key("enabled"));
    assert!(auth.extra.contains_key("tokenExpiry"));
    // The fixture's `auth` block carries no hash, so password auth must stay inert: an inherited
    // config like this one must not lock anybody out.
    assert!(!auth.is_active());
    let api = settings.api.clone().expect("api section is modeled");
    assert!(api.extra.contains_key("baseUrl"));
    assert!(api.extra.contains_key("timeout"));
    assert!(api.api_key.is_none());
    assert!(settings.extra.contains_key("tunnel"));
    assert!(settings.extra.contains_key("vault"));
    assert!(settings.extra.contains_key("vaults"));
    assert!(settings.extra.contains_key("shareTunnel"));
    // `codingAgents` is a modeled field now, so `#[serde(flatten)] extra` can no longer claim it.
    assert!(!settings.extra.contains_key("codingAgents"));
    assert_eq!(settings.coding_agents.len(), 1);
    assert_eq!(settings.coding_agents[0].name, "custom-agent");
    // Modeled now, for the same reason as `codingAgents` and `llm` above.
    assert!(!settings.extra.contains_key("desktopNotifications"));
    assert!(settings.desktop_notifications);
    assert!(settings.extra.contains_key("sidebarOpen"));
    assert!(settings.extra.contains_key("themeMode"));
    assert!(settings.extra.contains_key("dismissedUpdateVersion"));
    assert!(settings.extra.contains_key("customSetting1"));
    assert!(settings.extra.contains_key("customSetting2"));
    assert!(settings.extra.contains_key("customSetting3"));

    // Modify a modeled field and save
    settings.job_timeout = 45;
    save_config(&config_path, &settings).expect("save_config should succeed");

    // Re-load and verify all unmodeled sections survived structurally identical
    let reloaded: TendrilSettings = load_config(&config_path).expect("reload should succeed");
    assert_eq!(reloaded.job_timeout, 45);
    assert_eq!(reloaded.coding_agent, "claude");

    // All unmodeled keys preserved
    assert_eq!(
        reloaded.extra.get("customSetting1"),
        settings.extra.get("customSetting1")
    );
    assert_eq!(
        reloaded.extra.get("customSetting2"),
        settings.extra.get("customSetting2")
    );
    assert_eq!(
        reloaded.extra.get("customSetting3"),
        settings.extra.get("customSetting3")
    );
    assert_eq!(reloaded.extra.get("vault"), settings.extra.get("vault"));
    assert_eq!(reloaded.extra.get("editor"), settings.extra.get("editor"));

    // The nested unknown keys under the now-modeled `auth` / `api` sections survive too.
    let reloaded_auth = reloaded.auth.expect("auth survives the round-trip");
    assert_eq!(
        reloaded_auth.extra.get("enabled"),
        auth.extra.get("enabled")
    );
    assert_eq!(
        reloaded_auth.extra.get("tokenExpiry"),
        auth.extra.get("tokenExpiry")
    );
    let reloaded_api = reloaded.api.expect("api survives the round-trip");
    assert_eq!(reloaded_api.extra.get("baseUrl"), api.extra.get("baseUrl"));
    assert_eq!(reloaded_api.extra.get("timeout"), api.extra.get("timeout"));

    // Clean up
    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_update_config_raw_preserves_untouched_keys() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-config-update-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");

    std::fs::write(&config_path, SAMPLE_IVY_CONFIG).unwrap();

    // Partial update JSON
    let partial_update = serde_json::json!({
        "jobTimeout": 60,
        "theme": "light"
    });

    update_config_raw(&config_path, &partial_update).expect("update_config_raw should succeed");

    // Verify updated values and preserved keys
    let updated = load_config(&config_path).expect("load updated config");
    assert_eq!(updated.job_timeout, 60);
    assert_eq!(updated.theme, "light");

    // Verify untouched modeled and unmodeled keys
    assert_eq!(updated.coding_agent, "claude");
    assert!(updated.extra.contains_key("editor"));
    assert!(updated.extra.contains_key("vault"));
    // `llm` and `desktopNotifications` are modeled now, so they read back off their own fields rather
    // than out of `extra`. `update_config_raw` merges raw YAML maps and is otherwise unaffected.
    assert!(!updated.extra.contains_key("llm"));
    assert_eq!(
        updated.llm.as_ref().map(|l| l.model.as_str()),
        Some("claude-3-7-sonnet")
    );
    assert!(!updated.extra.contains_key("desktopNotifications"));
    assert!(updated.desktop_notifications);
    assert_eq!(
        updated.extra.get("customSetting1"),
        Some(&serde_json::Value::String("foo".to_string()))
    );

    let _ = std::fs::remove_dir_all(&temp_dir);
}

// ---------------------------------------------------------------------------------------------
// Project-level unmodeled keys.
//
// The suite above only ever exercised *top-level* unknown keys — its `projects:` block carries
// nothing but modeled fields, which is why the project-level hole went unnoticed. Everything below
// covers keys under `projects:`.
// ---------------------------------------------------------------------------------------------

/// One project carrying every modeled key *and* all nine keys the .NET V1 app really writes, with
/// the values a live `config.yaml` holds. A second project exists so the by-name merge has something
/// to leave alone.
const SAMPLE_PROJECT_EXTRAS_CONFIG: &str = r##"
codingAgent: claude
jobTimeout: 30
maxConcurrentJobs: 20
projects:
  - name: ivy-framework
    color: Green
    meta: {}
    repos:
      - path: /repos/ivy-framework
        baseBranch: development
    verifications:
      - name: DotnetBuild
        required: true
    context: ''
    stackHash: fe.ts:react/be.cs:aspnetcore
    reviewActions:
      - name: Docs
        condition: Test-Path "src/Ivy.Docs"
        command: dotnet run --project src/Ivy.Docs/Ivy.Docs.csproj
    hooks: []
    buildDependencies: []
    mcpServers: []
    skills: []
    ports: {}
    envFiles: []
    securityPreset: Custom
    outsideFileAccessPolicy: Allow
    terminalAutoExecution: AlwaysProceed
    sandboxMode: InheritGeneral
    autoImplementPlans: InheritGeneral
    filePermissions: []
    networkAccessRules: []
    allowedTerminalCommands: []
  - name: other-project
    color: Blue
    repos:
      - path: /repos/other
    sandboxMode: Disabled
    securityPreset: Strict
verifications: []
planTemplate: "# Plan Template"
levels:
  - name: Feature
    color: Blue
theme: default
"##;

/// The two keys `SAMPLE_PROJECT_EXTRAS_CONFIG` gives `ivy-framework` that are *still* unmodeled after
/// [`AgentSecurityConfig`][tendril_core::models::AgentSecurityConfig] took the other seven. Asserting
/// on *values* rather than key presence is the point: a key that survives with the wrong value is
/// still a broken setting.
fn expected_project_extras() -> Vec<(&'static str, serde_json::Value)> {
    vec![
        ("meta", serde_json::json!({})),
        ("autoImplementPlans", serde_json::json!("InheritGeneral")),
    ]
}

fn assert_remaining_extras(project: &tendril_core::models::ProjectConfig, context: &str) {
    for (key, expected) in expected_project_extras() {
        assert_eq!(
            project.extra.get(key),
            Some(&expected),
            "{context}: project '{}' lost or altered '{key}' (extras present: {:?})",
            project.name,
            project.extra.keys().collect::<Vec<_>>()
        );
    }
}

/// The seven agent security controls `SAMPLE_PROJECT_EXTRAS_CONFIG` gives `ivy-framework`, asserted
/// as their typed values rather than raw `extra` entries.
fn assert_ivy_framework_security(project: &tendril_core::models::ProjectConfig, context: &str) {
    assert_eq!(
        project.security.security_preset,
        SecurityPreset::Custom,
        "{context}: securityPreset"
    );
    assert_eq!(
        project.security.outside_file_access_policy,
        OutsideFileAccessPolicy::Allow,
        "{context}: outsideFileAccessPolicy"
    );
    assert_eq!(
        project.security.terminal_auto_execution,
        TerminalAutoExecution::AlwaysProceed,
        "{context}: terminalAutoExecution"
    );
    assert_eq!(
        project.security.sandbox_mode,
        SandboxMode::InheritGeneral,
        "{context}: sandboxMode"
    );
    assert!(
        project.security.file_permissions.is_empty(),
        "{context}: filePermissions"
    );
    assert!(
        project.security.network_access_rules.is_empty(),
        "{context}: networkAccessRules"
    );
    assert!(
        project.security.allowed_terminal_commands.is_empty(),
        "{context}: allowedTerminalCommands"
    );
}

/// A temp dir seeded with `SAMPLE_PROJECT_EXTRAS_CONFIG`, removed when the guard drops.
struct ConfigFixture {
    dir: std::path::PathBuf,
    path: std::path::PathBuf,
}

impl ConfigFixture {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tendril-test-project-extras-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.yaml");
        std::fs::write(&path, SAMPLE_PROJECT_EXTRAS_CONFIG).unwrap();
        Self { dir, path }
    }
}

impl Drop for ConfigFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// **This is the test that demonstrates the bug.** Before `ProjectConfig::extra` existed the nine
/// keys were absent from the reloaded project entirely.
#[test]
fn test_project_unmodeled_keys_survive_load_and_save() {
    let fx = ConfigFixture::new("load-save");

    let mut settings = load_config(&fx.path).expect("load_config should succeed");
    assert_eq!(settings.projects.len(), 2);

    // Captured on load, and none of the modeled keys leaked into the catch-all.
    assert_remaining_extras(&settings.projects[0], "on load");
    assert_ivy_framework_security(&settings.projects[0], "on load");
    for modeled in [
        "name",
        "color",
        "repos",
        "verifications",
        "context",
        "stackHash",
        "reviewActions",
        "hooks",
        "buildDependencies",
        "ports",
        "envFiles",
        "mcpServers",
        "skills",
        "sandboxMode",
        "securityPreset",
        "outsideFileAccessPolicy",
        "filePermissions",
        "networkAccessRules",
        "allowedTerminalCommands",
        "terminalAutoExecution",
    ] {
        assert!(
            !settings.projects[0].extra.contains_key(modeled),
            "modeled key '{modeled}' should not land in extra"
        );
    }
    // Modeled fields still bind normally alongside the extras.
    assert_eq!(settings.projects[0].color, "Green");
    assert_eq!(settings.projects[0].repos[0].path, "/repos/ivy-framework");
    assert_eq!(
        settings.projects[0].repos[0].base_branch.as_deref(),
        Some("development")
    );
    assert_eq!(settings.projects[0].verifications[0].name, "DotnetBuild");
    assert_eq!(settings.projects[0].review_actions[0].name, "Docs");

    // Mutate a modeled field the way every `save_config` call site does, then round-trip.
    settings.projects[0].color = "Red".to_string();
    save_config(&fx.path, &settings).expect("save_config should succeed");

    let reloaded = load_config(&fx.path).expect("reload should succeed");
    assert_eq!(reloaded.projects[0].color, "Red");
    assert_remaining_extras(&reloaded.projects[0], "after save/reload");
    assert_ivy_framework_security(&reloaded.projects[0], "after save/reload");
    // The second project's own security settings are independent and equally intact.
    assert_eq!(
        reloaded.projects[1].security.sandbox_mode,
        SandboxMode::Disabled
    );
    assert_eq!(
        reloaded.projects[1].security.security_preset,
        SecurityPreset::Strict
    );
}

/// One case per mutation verb family, each from a fresh fixture, applying the mutation exactly as the
/// CLI verb and the HTTP handler do.
#[test]
fn test_project_extras_survive_every_mutation_family() {
    use tendril_core::config::insert_project_verification;
    use tendril_core::models::{
        ProjectVerificationRef, PromptwareHookConfig, RepoRef, ReviewActionConfig,
    };

    type Mutation = (&'static str, fn(&mut tendril_core::models::ProjectConfig));

    let mutations: Vec<Mutation> = vec![
        ("set", |p| {
            p.color = "Red".to_string();
            p.context = "some context".to_string();
        }),
        ("rename", |p| p.name = "renamed".to_string()),
        ("add-repo", |p| {
            p.repos.push(RepoRef {
                path: "/repos/added".to_string(),
                base_branch: Some("main".to_string()),
                extra: Default::default(),
            })
        }),
        ("add-verification", |p| {
            insert_project_verification(
                p,
                ProjectVerificationRef {
                    name: "DotnetTest".to_string(),
                    required: true,
                    extra: Default::default(),
                },
                Some("DotnetBuild"),
            )
            .expect("insert_project_verification should succeed");
        }),
        ("add-review-action", |p| {
            p.review_actions.push(ReviewActionConfig {
                name: "Samples".to_string(),
                condition: "Test-Path \"src/Ivy.Samples\"".to_string(),
                command: "dotnet run".to_string(),
                paths: vec![],
                extra: Default::default(),
            })
        }),
        ("add-hook", |p| {
            p.hooks.push(PromptwareHookConfig {
                name: "notify".to_string(),
                when: "after".to_string(),
                promptwares: vec!["ExecutePlan".to_string()],
                condition: String::new(),
                action: "echo done".to_string(),
                extra: Default::default(),
            })
        }),
    ];

    for (verb, mutate) in mutations {
        let fx = ConfigFixture::new(verb);
        let mut settings = load_config(&fx.path).expect("load_config should succeed");
        mutate(&mut settings.projects[0]);
        save_config(&fx.path, &settings).expect("save_config should succeed");

        let reloaded = load_config(&fx.path).expect("reload should succeed");
        assert_remaining_extras(&reloaded.projects[0], verb);
        assert_ivy_framework_security(&reloaded.projects[0], verb);
        // Every verb leaves the project it did not touch alone.
        assert_eq!(
            reloaded.projects[1].security.security_preset,
            SecurityPreset::Strict,
            "{verb}: second project's security settings were disturbed"
        );
    }
}

/// Guards the decision to omit `skip_serializing_if` on the flattened extras maps: an empty map
/// already emits zero keys, so a project with no extras must round-trip gaining nothing.
#[test]
fn test_save_config_is_byte_identical_without_project_extras() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-no-extras-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");
    std::fs::write(&config_path, SAMPLE_IVY_CONFIG).unwrap();

    let settings = load_config(&config_path).expect("load_config should succeed");
    assert!(
        settings.projects[0].extra.is_empty(),
        "the modeled-only fixture should produce no project extras"
    );

    // Save with no mutation at all, then compare the serialized project object key-for-key.
    let before = serde_yaml::to_value(&settings.projects[0]).unwrap();
    save_config(&config_path, &settings).expect("save_config should succeed");
    let reloaded = load_config(&config_path).expect("reload should succeed");
    let after = serde_yaml::to_value(&reloaded.projects[0]).unwrap();

    assert_eq!(
        before, after,
        "an extras-free project must not gain or lose keys across save/load"
    );
    let keys: Vec<String> = after
        .as_mapping()
        .unwrap()
        .keys()
        .map(|k| k.as_str().unwrap_or_default().to_string())
        .collect();
    assert!(
        !keys.iter().any(|k| k == "extra"),
        "the extras map must stay flattened, never appear as an 'extra' key: {keys:?}"
    );

    let _ = std::fs::remove_dir_all(&temp_dir);
}

/// `update_config_raw` used to `insert` the whole `projects` array, replacing it. It now merges by
/// name, so a payload naming one project with one key keeps that project's extras and leaves the
/// other project entirely alone.
#[test]
fn test_update_config_raw_merges_projects_by_name() {
    let fx = ConfigFixture::new("raw-merge");

    let payload = serde_json::json!({
        "projects": [
            { "name": "ivy-framework", "color": "Red" }
        ]
    });
    update_config_raw(&fx.path, &payload).expect("update_config_raw should succeed");

    let merged = load_config(&fx.path).expect("load merged config");
    assert_eq!(
        merged.projects.len(),
        2,
        "the unmentioned project must not be dropped"
    );
    assert_eq!(merged.projects[0].name, "ivy-framework");
    assert_eq!(merged.projects[0].color, "Red");
    assert_remaining_extras(&merged.projects[0], "after update_config_raw");
    assert_ivy_framework_security(&merged.projects[0], "after update_config_raw");
    // Modeled fields the payload omitted are kept too, not just the extras.
    assert_eq!(merged.projects[0].repos[0].path, "/repos/ivy-framework");
    assert_eq!(merged.projects[0].verifications[0].name, "DotnetBuild");
    assert_eq!(merged.projects[0].review_actions[0].name, "Docs");
    // The second project is untouched.
    assert_eq!(merged.projects[1].name, "other-project");
    assert_eq!(merged.projects[1].color, "Blue");
    assert_eq!(
        merged.projects[1].security.security_preset,
        SecurityPreset::Strict
    );
}

/// The by-name match is case-insensitive (the lookup every `/api/projects` handler uses), and an
/// entry matching nothing is appended rather than replacing the array.
#[test]
fn test_update_config_raw_project_merge_is_case_insensitive_and_appends() {
    let fx = ConfigFixture::new("raw-merge-case");

    let payload = serde_json::json!({
        "projects": [
            { "name": "IVY-FRAMEWORK", "context": "matched case-insensitively" },
            { "name": "brand-new", "color": "Amber", "sandboxMode": "InheritGeneral" }
        ]
    });
    update_config_raw(&fx.path, &payload).expect("update_config_raw should succeed");

    let merged = load_config(&fx.path).expect("load merged config");
    assert_eq!(merged.projects.len(), 3);
    // Matched by name ignoring case, so it merged in place instead of appending a near-duplicate.
    // The payload's own `name` casing then wins, because `name` is just another mapping key and
    // scalars replace. That matches `PUT /api/projects/:name`, which also treats an explicit `name`
    // in the body as a rename target.
    assert_eq!(merged.projects[0].name, "IVY-FRAMEWORK");
    assert_eq!(merged.projects[0].context, "matched case-insensitively");
    assert_remaining_extras(&merged.projects[0], "case-insensitive merge");
    assert_ivy_framework_security(&merged.projects[0], "case-insensitive merge");
    // Unmatched: appended, with its own security settings.
    assert_eq!(merged.projects[2].name, "brand-new");
    assert_eq!(
        merged.projects[2].security.sandbox_mode,
        SandboxMode::InheritGeneral
    );
}

/// Sequences replace, and that must stay true — an incoming empty list means "this is the list now".
/// Only `projects` is exempt. This is the guard against someone generalising the by-name merge into
/// "merge all sequences", which would make clearing a list impossible.
#[test]
fn test_update_config_raw_replaces_sequences_other_than_projects() {
    let fx = ConfigFixture::new("raw-seq");

    let payload = serde_json::json!({
        "projects": [
            {
                "name": "ivy-framework",
                "verifications": [ { "name": "OnlyThisOne", "required": false } ],
                "allowedTerminalCommands": ["git status"]
            }
        ],
        "levels": [ { "name": "Bug", "color": "Red" } ]
    });
    update_config_raw(&fx.path, &payload).expect("update_config_raw should succeed");

    let merged = load_config(&fx.path).expect("load merged config");
    // A modeled sequence inside a merged project is replaced, not appended to.
    assert_eq!(merged.projects[0].verifications.len(), 1);
    assert_eq!(merged.projects[0].verifications[0].name, "OnlyThisOne");
    assert!(!merged.projects[0].verifications[0].required);
    // A modeled sequence inside a merged project's flattened security block is likewise replaced.
    assert_eq!(
        merged.projects[0].security.allowed_terminal_commands,
        vec!["git status".to_string()]
    );
    // The other security fields are untouched by a payload that named only one of them.
    assert_eq!(
        merged.projects[0].security.security_preset,
        SecurityPreset::Custom
    );
    // A top-level sequence that is not `projects` is replaced outright.
    assert_eq!(merged.levels.len(), 1);
    assert_eq!(merged.levels[0].name, "Bug");
}

/// The nested project types round-trip their own unknown keys too, so the same class of loss cannot
/// reappear one level down when V1 adds a key under a repo, verification, review action or hook.
#[test]
fn test_nested_project_types_round_trip_unknown_keys() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-nested-extras-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");
    std::fs::write(
        &config_path,
        r##"
codingAgent: claude
projects:
  - name: nested
    color: Blue
    repos:
      - path: /repos/nested
        baseBranch: main
        futureRepoKey: repo-value
    verifications:
      - name: DotnetBuild
        required: true
        futureVerificationKey: verification-value
    reviewActions:
      - name: Docs
        condition: ''
        command: dotnet run
        futureActionKey: action-value
    hooks:
      - name: notify
        when: after
        futureHookKey: hook-value
    mcpServers:
      - name: playwright
        command: npx
        futureMcpKey: mcp-value
    skills:
      - name: reviewing
        futureSkillKey: skill-value
    ports:
      backend:
        defaultPort: 3001
        futurePortKey: port-value
    envFiles:
      - path: .env
        futureEnvKey: env-value
verifications: []
levels: []
"##,
    )
    .unwrap();

    let mut settings = load_config(&config_path).expect("load_config should succeed");
    settings.projects[0].color = "Red".to_string();
    save_config(&config_path, &settings).expect("save_config should succeed");
    let p = &load_config(&config_path)
        .expect("reload should succeed")
        .projects[0];

    assert_eq!(p.color, "Red");
    assert_eq!(
        p.repos[0].extra.get("futureRepoKey"),
        Some(&serde_json::json!("repo-value"))
    );
    assert_eq!(
        p.verifications[0].extra.get("futureVerificationKey"),
        Some(&serde_json::json!("verification-value"))
    );
    assert_eq!(
        p.review_actions[0].extra.get("futureActionKey"),
        Some(&serde_json::json!("action-value"))
    );
    assert_eq!(
        p.hooks[0].extra.get("futureHookKey"),
        Some(&serde_json::json!("hook-value"))
    );
    assert_eq!(
        p.mcp_servers[0].extra.get("futureMcpKey"),
        Some(&serde_json::json!("mcp-value"))
    );
    assert_eq!(
        p.skills[0].extra.get("futureSkillKey"),
        Some(&serde_json::json!("skill-value"))
    );
    assert_eq!(
        p.ports["backend"].extra.get("futurePortKey"),
        Some(&serde_json::json!("port-value"))
    );
    assert_eq!(
        p.env_files[0].extra.get("futureEnvKey"),
        Some(&serde_json::json!("env-value"))
    );
    // Modeled siblings still bind correctly alongside the extras.
    assert_eq!(p.repos[0].base_branch.as_deref(), Some("main"));
    assert_eq!(p.ports["backend"].default_port, 3001);
    assert_eq!(p.env_files[0].path, ".env");

    let _ = std::fs::remove_dir_all(&temp_dir);
}

// ---------------------------------------------------------------------------------------------
// Top-level modeled-field mutation never duplicates a key on save.
//
// This is the model-layer guard for the bug `tendril config set` had: any call site (CLI, HTTP
// handler, future code) that mutates a modeled `TendrilSettings` field directly and saves must
// never end up with that field's key written twice, which is what makes `config.yaml`
// unparseable (`serde_yaml` then fails with "duplicate field '<key>'").
// ---------------------------------------------------------------------------------------------

/// Mutates every scalar/JSON-ish modeled field `tendril config set` now supports and saves once.
/// Each key must appear exactly once in the emitted YAML, and reloading must succeed.
#[test]
fn test_modeled_fields_never_duplicate_on_save() {
    let temp_dir = std::env::temp_dir().join(format!(
        "tendril-test-modeled-no-duplicate-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let config_path = temp_dir.join("config.yaml");
    std::fs::write(&config_path, SAMPLE_IVY_CONFIG).unwrap();

    let mut settings = load_config(&config_path).expect("load_config should succeed");
    settings.telemetry = Some(false);
    settings.beta = true;
    settings.desktop_notifications = false;
    settings.daemon_request_timeout = 9;
    settings.worktree_reaper_interval = 5;
    settings.worktree_reaper_grace = 5;
    settings.worktree_branch_delete_mode = "Force".to_string();
    settings.enrich_models = false;
    settings.model_enrichment_interval_hours = 2;
    settings.model_cache_warn_age_days = 1;
    settings.model_cache_max_age_days = 1;
    settings.plan_folder = Some("/custom/plans".to_string());
    settings.promptware_overlay = Some("/overlay".to_string());
    settings.llm = Some(LlmConfig {
        model: "gpt-4".to_string(),
        ..Default::default()
    });

    save_config(&config_path, &settings).expect("save_config should succeed");

    let raw = std::fs::read_to_string(&config_path).unwrap();
    for key in [
        "telemetry",
        "beta",
        "desktopNotifications",
        "daemonRequestTimeout",
        "worktreeReaperInterval",
        "worktreeReaperGrace",
        "worktreeBranchDeleteMode",
        "enrichModels",
        "modelEnrichmentIntervalHours",
        "modelCacheWarnAgeDays",
        "modelCacheMaxAgeDays",
        "planFolder",
        "promptwareOverlay",
        "llm",
    ] {
        let needle = format!("{key}:");
        let count = raw.lines().filter(|l| l.starts_with(&needle)).count();
        assert_eq!(
            count, 1,
            "key '{key}' must appear exactly once in config.yaml, found {count}:\n{raw}"
        );
    }

    // The critical assertion: a duplicated key makes serde_yaml fail with "duplicate field
    // '<key>'" on reload, exactly the corruption described in the plan.
    let reloaded =
        load_config(&config_path).expect("reload must not raise a duplicate-field error");
    assert_eq!(reloaded.telemetry, Some(false));
    assert!(reloaded.beta);
    assert!(!reloaded.desktop_notifications);
    assert_eq!(reloaded.daemon_request_timeout, 9);
    assert_eq!(reloaded.worktree_reaper_interval, 5);
    assert_eq!(reloaded.worktree_reaper_grace, 5);
    assert_eq!(reloaded.worktree_branch_delete_mode, "Force");
    assert!(!reloaded.enrich_models);
    assert_eq!(reloaded.model_enrichment_interval_hours, 2);
    assert_eq!(reloaded.model_cache_warn_age_days, 1);
    assert_eq!(reloaded.model_cache_max_age_days, 1);
    assert_eq!(reloaded.plan_folder.as_deref(), Some("/custom/plans"));
    assert_eq!(reloaded.promptware_overlay.as_deref(), Some("/overlay"));
    assert_eq!(
        reloaded.llm.as_ref().map(|l| l.model.as_str()),
        Some("gpt-4")
    );

    let _ = std::fs::remove_dir_all(&temp_dir);
}
