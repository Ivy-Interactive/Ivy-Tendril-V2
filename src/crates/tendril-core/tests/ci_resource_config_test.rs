//! Guards the CI resource-exhaustion fix (disk, not RAM) from regressing silently. `cargo test
//! --workspace` on a `ubuntu-latest` runner used to die with `collect2: fatal error: ld
//! terminated with signal 7 [Bus error], core dumped` because a full debug build of this
//! workspace (~14 GB) exceeded the runner's free disk. See
//! https://github.com/Ivy-Interactive/Ivy-Tendril-V2/actions/runs/34857841035

use std::path::{Path, PathBuf};

const REFERENCE: &str = "the bus error in \
     https://github.com/Ivy-Interactive/Ivy-Tendril-V2/actions/runs/34857841035";

fn repo_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let marker = Path::new(".github/workflows/ci.yml");

    let mut dir = manifest_dir.as_path();
    loop {
        if dir.join(marker).is_file() {
            return dir.to_path_buf();
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => panic!(
                "could not locate the repo root (looking for {}) by walking up from \
                 CARGO_MANIFEST_DIR ({})",
                marker.display(),
                manifest_dir.display()
            ),
        }
    }
}

fn root_cargo_toml() -> toml::Table {
    let path = repo_root().join("Cargo.toml");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    content
        .parse::<toml::Table>()
        .unwrap_or_else(|e| panic!("failed to parse {}: {e}", path.display()))
}

fn ci_workflow() -> serde_yaml::Value {
    let path = repo_root().join(".github/workflows/ci.yml");
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    serde_yaml::from_str(&content)
        .unwrap_or_else(|e| panic!("failed to parse {}: {e}", path.display()))
}

/// Every step of the `ci` job's `steps` list, in order.
fn ci_job_steps() -> Vec<serde_yaml::Value> {
    let workflow = ci_workflow();
    workflow
        .get("jobs")
        .and_then(|jobs| jobs.get("ci"))
        .and_then(|job| job.get("steps"))
        .and_then(|steps| steps.as_sequence())
        .unwrap_or_else(|| panic!("{}: jobs.ci.steps is missing or not a sequence", REFERENCE))
        .clone()
}

fn step_named<'a>(steps: &'a [serde_yaml::Value], name: &str) -> &'a serde_yaml::Value {
    steps
        .iter()
        .find(|step| step.get("name").and_then(|n| n.as_str()) == Some(name))
        .unwrap_or_else(|| panic!("{REFERENCE}: no step named '{name}' found in the ci job"))
}

fn assert_debug_disabled(profile: &toml::Table, profile_name: &str) {
    let debug = profile.get("debug").unwrap_or_else(|| {
        panic!(
            "{REFERENCE}: [profile.{profile_name}] is missing a `debug` key — without it \
                 the profile keeps full debug info and a `cargo test --workspace` run risks \
                 exhausting runner disk again"
        )
    });

    let disables_debug_info = match debug {
        toml::Value::Integer(0) => true,
        toml::Value::Boolean(false) => true,
        toml::Value::String(s) => s == "none" || s == "line-tables-only",
        _ => false,
    };

    assert!(
        disables_debug_info,
        "{REFERENCE}: [profile.{profile_name}] debug = {debug:?} still keeps significant debug \
         info; it must be 0, false, or \"line-tables-only\" to shrink target/debug"
    );
}

fn assert_caps_build_jobs(step: &serde_yaml::Value, step_name: &str) {
    let env_cap = step
        .get("env")
        .and_then(|env| env.get("CARGO_BUILD_JOBS"))
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        });

    let run_cap = step.get("run").and_then(|v| v.as_str()).and_then(|run| {
        let re = regex::Regex::new(r"(?:-j|--jobs)\s+(\d+)").expect("valid regex");
        re.captures(run)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse::<i64>().ok())
    });

    let cap = env_cap.or(run_cap).unwrap_or_else(|| {
        panic!(
            "{REFERENCE}: the '{step_name}' step caps neither env.CARGO_BUILD_JOBS nor passes \
             -j/--jobs on its `run` command — uncapped parallel link jobs is what spiked disk \
             usage in the referenced failure"
        )
    });

    assert!(
        (1..=2).contains(&cap),
        "{REFERENCE}: the '{step_name}' step caps build jobs at {cap}, expected 1 or 2"
    );
}

#[test]
fn dev_profile_has_debug_info_disabled() {
    let cargo_toml = root_cargo_toml();
    let profile = cargo_toml
        .get("profile")
        .and_then(|p| p.get("dev"))
        .and_then(|p| p.as_table())
        .unwrap_or_else(|| {
            panic!("{REFERENCE}: [profile.dev] is missing from the root Cargo.toml")
        });
    assert_debug_disabled(profile, "dev");
}

#[test]
fn test_profile_has_debug_info_disabled() {
    let cargo_toml = root_cargo_toml();
    let profile = cargo_toml
        .get("profile")
        .and_then(|p| p.get("test"))
        .and_then(|p| p.as_table())
        .unwrap_or_else(|| {
            panic!("{REFERENCE}: [profile.test] is missing from the root Cargo.toml")
        });
    assert_debug_disabled(profile, "test");
}

#[test]
fn rust_test_step_caps_build_jobs() {
    let steps = ci_job_steps();
    let step = step_named(&steps, "Rust Test");
    assert_caps_build_jobs(step, "Rust Test");
}

#[test]
fn rust_build_step_caps_build_jobs() {
    let steps = ci_job_steps();
    let step = step_named(&steps, "Rust Build");
    assert_caps_build_jobs(step, "Rust Build");
}

#[test]
fn ci_frees_disk_before_first_cargo_step() {
    let steps = ci_job_steps();

    let free_disk_index = steps
        .iter()
        .position(|step| step.get("name").and_then(|n| n.as_str()) == Some("Free disk space"))
        .unwrap_or_else(|| {
            panic!("{REFERENCE}: no step named 'Free disk space' found in the ci job")
        });

    let first_cargo_index = steps
        .iter()
        .position(|step| {
            step.get("run")
                .and_then(|r| r.as_str())
                .is_some_and(|run| run.contains("cargo "))
        })
        .unwrap_or_else(|| {
            panic!("{REFERENCE}: no step with a `cargo ` run command found in the ci job")
        });

    assert!(
        free_disk_index < first_cargo_index,
        "{REFERENCE}: 'Free disk space' (step {free_disk_index}) must run before the first \
         cargo step (step {first_cargo_index}), otherwise the cleanup would delete tools those \
         steps still need"
    );
}
