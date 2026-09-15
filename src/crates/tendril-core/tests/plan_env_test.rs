//! Port allocation and env-file materialization for a plan's worktrees.
//!
//! Every fixture lives under the temp dir via [`HomeFixture`]; no test touches the operator's real
//! `~/.tendril`, and the only sockets bound are on loopback.

mod common;

use common::{plan_with, HomeFixture};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use tendril_core::config::{get_config_path, load_config, save_config};
use tendril_core::models::{
    PlanStatus, PlanYaml, ProjectConfig, ProjectEnvFileConfig, ProjectPortConfig,
};
use tendril_core::plans::env::{
    materialize_env_files, materialize_plan_env, render_env_file, MaterializeOutcome,
};
use tendril_core::plans::ports::{
    allocate_ports, collect_reserved_ports, is_port_available, resolve_ports, EPHEMERAL_RANGE_END,
    EPHEMERAL_RANGE_START,
};
use tendril_core::plans::reader::read_plan_yaml;

const PROJECT: &str = "FixtureProject";

fn port_config(default_port: u16) -> ProjectPortConfig {
    ProjectPortConfig {
        default_port,
        description: String::new(),
        extra: Default::default(),
    }
}

fn project_with_ports(ports: &[(&str, u16)]) -> ProjectConfig {
    ProjectConfig {
        name: PROJECT.to_string(),
        color: "Blue".to_string(),
        ports: ports
            .iter()
            .map(|(name, port)| (name.to_string(), port_config(*port)))
            .collect(),
        ..Default::default()
    }
}

/// Writes `config.yaml` with a single project so `materialize_plan_env` can resolve it.
fn write_project_config(home: &HomeFixture, project: &ProjectConfig) {
    let path = get_config_path(&home.path);
    let mut settings = load_config(&path).expect("load config");
    settings.projects.push(project.clone());
    save_config(&path, &settings).expect("save config");
}

/// A plan folder with a worktree checked out for `repo`, as `plan env` would find after
/// `tendril plan add-worktree`.
fn plan_with_worktree(home: &HomeFixture, folder_name: &str, repo: &Path) -> (PathBuf, PathBuf) {
    let mut plan = plan_with(PlanStatus::Executing, &[]);
    plan.repos = vec![repo.to_string_lossy().to_string()];
    let plan_folder = home.write_plan(folder_name, &plan);

    let worktree = plan_folder
        .join("Worktrees")
        .join(repo.file_name().unwrap());
    std::fs::create_dir_all(&worktree).expect("create worktree dir");
    (plan_folder, worktree)
}

/// An `is_available` probe that answers from a fixed set instead of binding sockets.
fn availability(free: &[u16]) -> impl Fn(u16) -> bool + '_ {
    let free: HashSet<u16> = free.iter().copied().collect();
    move |port| free.contains(&port)
}

#[test]
fn port_allocation_is_stable_across_repeated_calls() {
    let home = HomeFixture::new("plan-env-stable");
    let project = project_with_ports(&[("backend", 0), ("frontend", 0)]);

    let mut plan = plan_with(PlanStatus::Executing, &[]);
    let plan_folder = home.write_plan("00001-Stable", &plan);

    let first = allocate_ports(&project, &mut plan, &plan_folder).expect("first allocation");
    assert_eq!(first.len(), 2, "both named ports get an assignment");

    let (persisted, _) = read_plan_yaml(&plan_folder).expect("read plan.yaml");
    let updated_after_first = persisted.updated;
    assert_eq!(persisted.allocated_ports.as_ref(), Some(&first));

    let second = allocate_ports(&project, &mut plan, &plan_folder).expect("second allocation");
    assert_eq!(second, first, "a re-execution keeps the reviewer's URLs");

    let (persisted_again, _) = read_plan_yaml(&plan_folder).expect("re-read plan.yaml");
    assert_eq!(
        persisted_again.updated, updated_after_first,
        "an unchanged map must not bump `updated`"
    );
}

#[test]
fn two_plans_never_receive_the_same_port() {
    let home = HomeFixture::new("plan-env-disjoint");
    let project = project_with_ports(&[("backend", 0), ("frontend", 0)]);

    let mut plan_a = plan_with(PlanStatus::Executing, &[]);
    let folder_a = home.write_plan("00001-PlanA", &plan_a);
    let ports_a = allocate_ports(&project, &mut plan_a, &folder_a).expect("allocate for A");

    let mut plan_b = plan_with(PlanStatus::Executing, &[]);
    let folder_b = home.write_plan("00002-PlanB", &plan_b);
    let ports_b = allocate_ports(&project, &mut plan_b, &folder_b).expect("allocate for B");

    let taken_a: HashSet<u16> = ports_a.values().copied().collect();
    let taken_b: HashSet<u16> = ports_b.values().copied().collect();
    assert!(
        taken_a.is_disjoint(&taken_b),
        "two active plans must not share a port: {:?} vs {:?}",
        ports_a,
        ports_b
    );

    let reserved = collect_reserved_ports(&home.plans_dir(), Some(&folder_b));
    for port in &taken_a {
        assert!(
            reserved.contains(port),
            "an Executing plan reserves {}",
            port
        );
    }

    // A finished plan's worktree is gone, so its ports return to the pool.
    let mut completed = read_plan_yaml(&folder_a).expect("read A").0;
    completed.state = PlanStatus::Completed.to_string();
    tendril_core::plans::writer::write_plan_yaml(&folder_a, &completed).expect("rewrite A");

    let reserved_after = collect_reserved_ports(&home.plans_dir(), Some(&folder_b));
    for port in &taken_a {
        assert!(
            !reserved_after.contains(port),
            "a Completed plan must not hold {}",
            port
        );
    }
}

#[test]
fn allocation_skips_a_port_that_is_in_use() {
    let home = HomeFixture::new("plan-env-in-use");

    // Loopback only: the probe binds 127.0.0.1, so that is what has to be occupied.
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .expect("bind an ephemeral loopback port");
    let bound = listener.local_addr().expect("local addr").port();
    assert!(!is_port_available(bound), "the bound port reads as taken");

    let project = project_with_ports(&[("backend", bound)]);
    let mut plan = plan_with(PlanStatus::Executing, &[]);
    let plan_folder = home.write_plan("00001-InUse", &plan);

    let allocated = allocate_ports(&project, &mut plan, &plan_folder).expect("allocate");
    let assigned = allocated["backend"];
    assert_ne!(assigned, bound, "the occupied default port is skipped");
    assert!(
        (EPHEMERAL_RANGE_START..=EPHEMERAL_RANGE_END).contains(&assigned),
        "the fallback comes from the ephemeral range, got {}",
        assigned
    );
}

#[test]
fn resolve_ports_carries_forward_names_dropped_from_config() {
    let ports: BTreeMap<String, ProjectPortConfig> =
        [("backend".to_string(), port_config(3000))].into();
    let existing: BTreeMap<String, u16> =
        [("backend".to_string(), 3000), ("legacy".to_string(), 3999)].into();

    let is_available = availability(&[3000]);
    let resolved = resolve_ports(&ports, Some(&existing), &HashSet::new(), &is_available)
        .expect("resolve ports");

    assert_eq!(resolved["backend"], 3000, "a free existing port is kept");
    assert_eq!(
        resolved["legacy"], 3999,
        "a name dropped from config is not erased from a plan an in-flight worktree may be using"
    );
}

#[test]
fn resolve_ports_errors_when_range_exhausted() {
    let ports: BTreeMap<String, ProjectPortConfig> =
        [("backend".to_string(), port_config(3000))].into();

    let nothing_free = |_: u16| false;
    let err = resolve_ports(&ports, None, &HashSet::new(), &nothing_free)
        .expect_err("an exhausted range must be an error, not a silent 0");

    let message = err.to_string();
    assert!(message.contains("backend"), "names the port: {}", message);
    assert!(message.contains("3000"), "names the default: {}", message);
    assert!(
        message.contains(&EPHEMERAL_RANGE_START.to_string())
            && message.contains(&EPHEMERAL_RANGE_END.to_string()),
        "names the exhausted range: {}",
        message
    );
}

#[test]
fn materialize_renders_template_with_allocated_ports() {
    let home = HomeFixture::new("plan-env-render");
    let worktree = home.path.join("worktree");
    std::fs::create_dir_all(&worktree).expect("create worktree");
    std::fs::write(
        worktree.join(".env.example"),
        "# Backend service\nPORT=${ports.backend}\nAPI=http://127.0.0.1:${ports.backend}\n\nLOG_LEVEL=info\n",
    )
    .expect("write template");

    let mut project = project_with_ports(&[("backend", 0)]);
    project.env_files = vec![ProjectEnvFileConfig {
        path: ".env".to_string(),
        template: Some(".env.example".to_string()),
        overrides: [
            ("LOG_LEVEL".to_string(), "debug".to_string()),
            ("EXTRA".to_string(), "added".to_string()),
        ]
        .into(),
        extra: Default::default(),
    }];

    let allocated: BTreeMap<String, u16> = [("backend".to_string(), 31234)].into();
    let results = materialize_env_files(&project, &allocated, &worktree, &home.path, false)
        .expect("materialize");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].1, MaterializeOutcome::Written);

    let rendered = &results[0].0;
    assert_eq!(
        rendered.content,
        "# Backend service\nPORT=31234\nAPI=http://127.0.0.1:31234\n\nLOG_LEVEL=debug\nEXTRA=added\n",
        "ports substituted, comments and blank lines preserved, the override replaced in place and \
         the new key appended"
    );
    assert!(rendered.missing.is_empty());

    let on_disk = std::fs::read_to_string(worktree.join(".env")).expect("read .env");
    assert!(!on_disk.contains('\r'), "line endings are \\n only");
    assert!(on_disk.ends_with('\n'), "the file ends with a newline");
    assert!(
        on_disk.ends_with(&rendered.content),
        "the body follows the generated header"
    );
}

#[test]
fn materialize_is_idempotent() {
    let home = HomeFixture::new("plan-env-idempotent");
    let worktree = home.path.join("worktree");
    std::fs::create_dir_all(&worktree).expect("create worktree");

    let mut project = project_with_ports(&[]);
    project.env_files = vec![ProjectEnvFileConfig {
        path: ".env".to_string(),
        template: None,
        overrides: [("MODE".to_string(), "test".to_string())].into(),
        extra: Default::default(),
    }];

    let allocated = BTreeMap::new();
    let first = materialize_env_files(&project, &allocated, &worktree, &home.path, false)
        .expect("first materialize");
    assert_eq!(first[0].1, MaterializeOutcome::Written);
    let bytes_after_first = std::fs::read(worktree.join(".env")).expect("read .env");

    let second = materialize_env_files(&project, &allocated, &worktree, &home.path, false)
        .expect("second materialize");
    assert_eq!(second[0].1, MaterializeOutcome::Unchanged);
    assert_eq!(
        std::fs::read(worktree.join(".env")).expect("re-read .env"),
        bytes_after_first,
        "an unchanged file is left byte-identical"
    );
}

#[test]
fn materialize_does_not_clobber_a_hand_edited_env() {
    let home = HomeFixture::new("plan-env-hand-edited");
    let worktree = home.path.join("worktree");
    std::fs::create_dir_all(&worktree).expect("create worktree");

    let mut project = project_with_ports(&[]);
    project.env_files = vec![ProjectEnvFileConfig {
        path: ".env".to_string(),
        template: None,
        overrides: [("MODE".to_string(), "test".to_string())].into(),
        extra: Default::default(),
    }];

    let allocated = BTreeMap::new();
    materialize_env_files(&project, &allocated, &worktree, &home.path, false)
        .expect("first materialize");

    let target = worktree.join(".env");
    let generated = std::fs::read_to_string(&target).expect("read generated");
    let hand_edited = generated.replace("MODE=test", "MODE=test\nMY_SECRET=hunter2");
    std::fs::write(&target, &hand_edited).expect("hand-edit .env");

    let results = materialize_env_files(&project, &allocated, &worktree, &home.path, false)
        .expect("re-materialize");
    assert_eq!(results[0].1, MaterializeOutcome::SkippedHandEdited);
    assert_eq!(
        std::fs::read_to_string(&target).expect("re-read .env"),
        hand_edited,
        "a human's edit survives"
    );

    let forced = materialize_env_files(&project, &allocated, &worktree, &home.path, true)
        .expect("forced materialize");
    assert_eq!(forced[0].1, MaterializeOutcome::Written);
    let after_force = std::fs::read_to_string(&target).expect("read forced .env");
    assert!(
        !after_force.contains("MY_SECRET"),
        "--force regenerates the file: {}",
        after_force
    );
}

#[test]
fn missing_env_reference_is_reported_not_substituted() {
    let home = HomeFixture::new("plan-env-missing");
    let worktree = home.path.join("worktree");
    std::fs::create_dir_all(&worktree).expect("create worktree");
    std::fs::write(
        worktree.join(".env.example"),
        "TOKEN=${env.TENDRIL_TEST_UNSET_VAR}\nGHOST=${ports.nope}\n",
    )
    .expect("write template");

    assert!(
        std::env::var("TENDRIL_TEST_UNSET_VAR").is_err(),
        "the fixture variable must be unset"
    );

    let mut project = project_with_ports(&[]);
    project.env_files = vec![ProjectEnvFileConfig {
        path: ".env".to_string(),
        template: Some(".env.example".to_string()),
        overrides: BTreeMap::new(),
        extra: Default::default(),
    }];

    let allocated = BTreeMap::new();
    let rendered = render_env_file(
        &project.env_files[0],
        &project,
        &allocated,
        &worktree,
        &home.path,
    );

    assert_eq!(
        rendered.content, "TOKEN=\nGHOST=${ports.nope}\n",
        "an unresolved secret is empty, never fabricated; an unknown port stays visible"
    );

    let missing: Vec<(&str, &str)> = rendered
        .missing
        .iter()
        .map(|m| (m.key.as_str(), m.reference.as_str()))
        .collect();
    assert!(
        missing.contains(&("TOKEN", "${env.TENDRIL_TEST_UNSET_VAR}")),
        "the unset variable is reported: {:?}",
        missing
    );
    assert!(
        missing.contains(&("GHOST", "${ports.nope}")),
        "the unknown port is reported: {:?}",
        missing
    );
}

#[test]
fn env_file_config_round_trips_through_config_yaml() {
    let home = HomeFixture::new("plan-env-config");
    let config_path = home.path.join("round-trip.yaml");

    // Legacy shapes: `defaultPort` on ports, `envFiles` with a template and overrides, plus an
    // unknown sibling key that must survive the load/save cycle.
    std::fs::write(
        &config_path,
        "codingAgent: claude\nunknownTopLevel: keep-me\nprojects:\n  - name: Widgets\n    color: Blue\n    unknownProjectKey: keep-me-too\n    ports:\n      backend:\n        defaultPort: 3000\n        description: API server\n      frontend:\n        defaultPort: 5173\n        description: Vite dev server\n    envFiles:\n      - path: .env\n        template: .env.example\n        overrides:\n          LOG_LEVEL: debug\n",
    )
    .expect("write config.yaml");

    let settings = load_config(&config_path).expect("load legacy config");
    let project = &settings.projects[0];
    assert_eq!(project.ports.len(), 2);
    assert_eq!(project.ports["backend"].default_port, 3000);
    assert_eq!(project.ports["backend"].description, "API server");
    assert_eq!(project.ports["frontend"].default_port, 5173);
    assert_eq!(project.env_files.len(), 1);
    assert_eq!(project.env_files[0].path, ".env");
    assert_eq!(
        project.env_files[0].template.as_deref(),
        Some(".env.example")
    );
    assert_eq!(project.env_files[0].overrides["LOG_LEVEL"], "debug");

    save_config(&config_path, &settings).expect("save config");
    let raw = std::fs::read_to_string(&config_path).expect("re-read config.yaml");
    assert!(
        raw.contains("defaultPort: 3000"),
        "ports re-emitted: {}",
        raw
    );
    assert!(raw.contains("envFiles:"), "envFiles re-emitted: {}", raw);
    assert!(
        raw.contains("unknownTopLevel: keep-me"),
        "unknown top-level keys survive: {}",
        raw
    );

    let reloaded = load_config(&config_path).expect("reload config");
    assert_eq!(reloaded.projects[0].ports, project.ports);
    assert_eq!(reloaded.projects[0].env_files, project.env_files);
}

/// The seam Plan 00554 calls after `git worktree add`: allocate, then write every configured env file
/// into each worktree that exists.
#[test]
fn materialize_plan_env_writes_into_the_plans_worktree() {
    let home = HomeFixture::new("plan-env-seam");
    let repo = home.path.join("repos").join("widgets");
    std::fs::create_dir_all(&repo).expect("create repo");

    let mut project = project_with_ports(&[("backend", 0)]);
    project.env_files = vec![ProjectEnvFileConfig {
        path: ".env".to_string(),
        template: None,
        overrides: [("PORT".to_string(), "${ports.backend}".to_string())].into(),
        extra: Default::default(),
    }];
    write_project_config(&home, &project);

    let (plan_folder, worktree) = plan_with_worktree(&home, "00001-Seam", &repo);
    let report = materialize_plan_env(&plan_folder, &home.path, None, false).expect("materialize");

    assert_eq!(report.project, PROJECT);
    let port = report.allocated_ports["backend"];
    assert_eq!(report.worktrees.len(), 1);
    assert_eq!(report.worktrees[0].worktree, worktree);

    let written = std::fs::read_to_string(worktree.join(".env")).expect("read .env");
    assert!(
        written.ends_with(&format!("PORT={}\n", port)),
        "the allocated port lands in the worktree's .env: {}",
        written
    );

    // A repo the plan never checked out is skipped rather than reported as an error.
    let report_filtered =
        materialize_plan_env(&plan_folder, &home.path, Some("widgets"), false).expect("filtered");
    assert_eq!(report_filtered.worktrees.len(), 1);
}

/// `PlanYaml` keeps `allocatedPorts` out of the file until something is allocated.
#[test]
fn allocated_ports_is_omitted_when_empty() {
    let plan = PlanYaml::default();
    let yaml = serde_yaml::to_string(&plan).expect("serialize plan");
    assert!(
        !yaml.contains("allocatedPorts"),
        "an unallocated plan writes no allocatedPorts key: {}",
        yaml
    );

    let with_ports = PlanYaml {
        allocated_ports: Some([("backend".to_string(), 31234u16)].into()),
        ..Default::default()
    };
    let yaml = serde_yaml::to_string(&with_ports).expect("serialize allocated plan");
    assert!(yaml.contains("allocatedPorts:"), "{}", yaml);
    assert!(yaml.contains("backend: 31234"), "{}", yaml);
}
