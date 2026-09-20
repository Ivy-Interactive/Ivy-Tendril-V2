//! `coAuthor` attribution, exercised against real repositories and real commits.
//!
//! These tests deliberately do not stop at "the right environment variables came back". The whole
//! point of the feature is that a commit an agent makes ends up carrying the trailer, so every test
//! here runs `git commit` the way a promptware does and reads the result back with
//! `git log -1 --format=%B`. Two of them exist because of failure modes that are *silent* in
//! production — a customer's `pre-commit` secret scanner disabled by the hooks-path override, and a
//! customer's own `GIT_CONFIG_*` pair clobbered by index collision — and neither would be caught by
//! review or by a test that only inspects configuration.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use tendril_core::config::TendrilSettings;
use tendril_core::git::coauthor_hooks::coauthor_env;

const IDENTITY: &str = "test-bot <bot@example.invalid>";
const TRAILER: &str = "Co-Authored-By: test-bot <bot@example.invalid>";

struct TempDir(PathBuf);

impl TempDir {
    fn new(prefix: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("{}-{}", prefix, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn settings_with(co_author: Option<&str>) -> TendrilSettings {
    TendrilSettings {
        co_author: co_author.map(str::to_string),
        ..Default::default()
    }
}

/// Runs git with the fixture's identity pinned and any extra environment layered on.
///
/// `GIT_CONFIG_GLOBAL` / `GIT_CONFIG_SYSTEM` point at `/dev/null` for the same reason
/// `promptware_contract_test.rs` does it: a developer's own global `core.hooksPath`, commit signing
/// or template would otherwise change what these tests measure.
fn git_raw(cwd: &Path, env: &[(&str, &str)], args: &[&str]) -> (bool, String, String) {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_AUTHOR_NAME", "Tendril Test")
        .env("GIT_AUTHOR_EMAIL", "test@tendril.invalid")
        .env("GIT_COMMITTER_NAME", "Tendril Test")
        .env("GIT_COMMITTER_EMAIL", "test@tendril.invalid");
    // The daemon never has these set, so a stray value in the developer's shell must not leak into
    // the "unconfigured" cases and make them pass for the wrong reason.
    cmd.env_remove("GIT_CONFIG_COUNT")
        .env_remove("TENDRIL_COAUTHOR")
        .env_remove("TENDRIL_GIT_CONFIG_BASE");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd
        .output()
        .unwrap_or_else(|e| panic!("spawn git {args:?}: {e}"));
    (
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    )
}

fn git(cwd: &Path, env: &[(&str, &str)], args: &[&str]) -> String {
    let (ok, stdout, stderr) = git_raw(cwd, env, args);
    assert!(ok, "git {args:?} failed: {stderr}");
    stdout
}

/// A repository with one commit already in it.
fn init_repo(path: &Path) {
    std::fs::create_dir_all(path).expect("create repo dir");
    git(path, &[], &["init", "-q", "-b", "main", "."]);
    std::fs::write(path.join("seed.txt"), "seed\n").expect("write seed");
    git(path, &[], &["add", "-A"]);
    git(path, &[], &["commit", "-q", "-m", "seed"]);
}

/// The resolved pairs as the launcher would hand them to the child process.
fn env_pairs(settings: &TendrilSettings, home: &Path) -> Vec<(String, String)> {
    coauthor_env(settings, home, &HashMap::new())
}

fn as_refs(pairs: &[(String, String)]) -> Vec<(&str, &str)> {
    pairs
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect()
}

/// Stages a new file and commits it, returning the full message git recorded.
fn commit(repo: &Path, env: &[(&str, &str)], file: &str, message: &str) -> String {
    std::fs::write(repo.join(file), format!("{file}\n")).expect("write file");
    git(repo, env, &["add", "-A"]);
    git(repo, env, &["commit", "-q", "-m", message]);
    git(repo, env, &["log", "-1", "--format=%B"])
}

fn write_hook(dir: &Path, name: &str, body: &str) {
    std::fs::create_dir_all(dir).expect("create hooks dir");
    let path = dir.join(name);
    std::fs::write(&path, body).expect("write hook");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("chmod hook");
    }
}

/// The contract the brief calls byte-identical-to-today: an install that has not set `coAuthor` gets
/// no environment pairs, no shim directory anywhere, and no trailer on its commits.
#[test]
fn unconfigured_adds_no_env_no_files_and_no_trailer() {
    let home = TempDir::new("tendril-coauthor-off-home");
    let repo = TempDir::new("tendril-coauthor-off-repo");
    init_repo(repo.path());

    let pairs = env_pairs(&settings_with(None), home.path());
    assert!(
        pairs.is_empty(),
        "an unset coAuthor must contribute no environment at all, got {pairs:?}"
    );

    // Not merely "no hooks were installed" — nothing was created under the home at all, so there is
    // no state for a later disable to have to clean up.
    assert!(
        !home.path().join("GitHooks").exists(),
        "no shim directory may be materialised when the feature is off"
    );

    let message = commit(repo.path(), &[], "a.txt", "unconfigured");
    assert!(
        !message.contains("Co-Authored-By"),
        "unconfigured commit must carry no trailer, got:\n{message}"
    );
}

/// A blank value is the natural YAML spelling of "off", and a value carrying a newline could forge
/// extra trailers through `git interpret-trailers`. Both must resolve to the feature being off.
#[test]
fn blank_or_multiline_identity_is_treated_as_unset() {
    let home = TempDir::new("tendril-coauthor-invalid-home");

    for value in [
        "",
        "   ",
        "bot <b@x.invalid>\nCo-Authored-By: victim <v@x.invalid>",
    ] {
        let settings = settings_with(Some(value));
        assert!(
            settings.co_author_identity().is_none(),
            "{value:?} must not be accepted as an identity"
        );
        assert!(
            env_pairs(&settings, home.path()).is_empty(),
            "{value:?} must contribute no environment"
        );
    }
}

/// The primary path: an agent process carrying the resolved environment produces a trailered commit.
#[test]
fn configured_identity_trailers_an_agent_commit() {
    let home = TempDir::new("tendril-coauthor-on-home");
    let repo = TempDir::new("tendril-coauthor-on-repo");
    init_repo(repo.path());

    let pairs = env_pairs(&settings_with(Some(IDENTITY)), home.path());
    let message = commit(repo.path(), &as_refs(&pairs), "a.txt", "agent change");

    assert!(
        message.contains(TRAILER),
        "expected {TRAILER:?} in:\n{message}"
    );
}

/// The environment binds to the process, not to the checkout, which is what lets the feature reach
/// `SyncRepo` — it commits in the customer's own clone with no worktree involved. The same property
/// has to hold in reverse: a developer committing by hand in that very repository, in the same
/// second, must see no trailer and no change to their hooks.
#[test]
fn developer_commits_in_the_same_repo_are_untouched() {
    let home = TempDir::new("tendril-coauthor-dev-home");
    let repo = TempDir::new("tendril-coauthor-dev-repo");
    init_repo(repo.path());

    let config_before =
        std::fs::read(repo.path().join(".git").join("config")).expect("read config");

    let pairs = env_pairs(&settings_with(Some(IDENTITY)), home.path());
    let agent = commit(repo.path(), &as_refs(&pairs), "a.txt", "agent change");
    assert!(agent.contains(TRAILER), "agent commit should be trailered");

    let developer = commit(repo.path(), &[], "b.txt", "developer change");
    assert!(
        !developer.contains("Co-Authored-By"),
        "a hand commit must be untouched, got:\n{developer}"
    );

    // The strongest statement of "zero mutation of a repo Tendril does not own".
    let config_after = std::fs::read(repo.path().join(".git").join("config")).expect("read config");
    assert_eq!(
        config_before, config_after,
        ".git/config must be byte-identical after a trailered commit"
    );
}

/// The silent-failure case that makes the delegating shim mandatory. `core.hooksPath` replaces the
/// hook directory wholesale, so a naive one-line shim would disable a customer's `pre-commit` — the
/// secret-scanner slot — for exactly the commits an autonomous agent makes. Both halves are asserted:
/// a passing hook still runs, and a failing one still blocks.
#[test]
fn customer_hooks_still_run_and_a_failing_one_still_blocks() {
    let home = TempDir::new("tendril-coauthor-hooks-home");
    let repo = TempDir::new("tendril-coauthor-hooks-repo");
    init_repo(repo.path());

    let hooks = repo.path().join(".git").join("hooks");
    let witness = repo.path().join("precommit-ran");
    write_hook(
        &hooks,
        "pre-commit",
        &format!("#!/bin/sh\ntouch '{}'\nexit 0\n", witness.display()),
    );

    let pairs = env_pairs(&settings_with(Some(IDENTITY)), home.path());
    let env = as_refs(&pairs);

    let message = commit(repo.path(), &env, "a.txt", "with customer hook");
    assert!(
        witness.exists(),
        "the customer's pre-commit must still run under the shim"
    );
    assert!(message.contains(TRAILER), "and the trailer must still land");

    // A scanner that refuses has to keep refusing; swallowing its exit code is how it becomes a no-op.
    write_hook(&hooks, "pre-commit", "#!/bin/sh\nexit 3\n");
    std::fs::write(repo.path().join("secret.txt"), "secret\n").expect("write file");
    git(repo.path(), &env, &["add", "-A"]);
    let (ok, _, _) = git_raw(repo.path(), &env, &["commit", "-q", "-m", "should block"]);
    assert!(
        !ok,
        "a failing customer pre-commit must still block the commit"
    );
    assert_eq!(
        git(repo.path(), &env, &["log", "-1", "--format=%s"]).trim(),
        "with customer hook",
        "the blocked commit must not have landed"
    );
}

/// A customer who has moved their hooks with `core.hooksPath` must be delegated to, not bypassed.
///
/// This is also the test that pins the recursion defence: under the override, a shim that asks git
/// where the hooks are gets its *own* directory back, and the naive version re-execs itself forever.
/// The shim re-runs git with the pre-Tendril `GIT_CONFIG_COUNT` to see past the override.
#[test]
fn a_custom_hooks_path_is_delegated_to_not_bypassed() {
    let home = TempDir::new("tendril-coauthor-custom-home");
    let repo = TempDir::new("tendril-coauthor-custom-repo");
    init_repo(repo.path());

    let custom = repo.path().join("my-hooks");
    let witness = repo.path().join("custom-ran");
    write_hook(
        &custom,
        "prepare-commit-msg",
        &format!("#!/bin/sh\ntouch '{}'\nexit 0\n", witness.display()),
    );
    git(
        repo.path(),
        &[],
        &["config", "core.hooksPath", &custom.to_string_lossy()],
    );

    let pairs = env_pairs(&settings_with(Some(IDENTITY)), home.path());
    let message = commit(repo.path(), &as_refs(&pairs), "a.txt", "custom hooks path");

    assert!(
        witness.exists(),
        "the customer's relocated prepare-commit-msg must still run"
    );
    assert!(
        message.contains(TRAILER),
        "expected {TRAILER:?} in:\n{message}"
    );
}

/// A message that already carries the trailer must end up with exactly one, and a *different*
/// co-author must survive alongside rather than be replaced — the coding agent's own attribution is
/// something this feature composes with, not something it fights.
///
/// The ordering in the third case is the one that matters, and it is why the shim greps before it
/// writes rather than relying on `interpret-trailers`. That command deduplicates only an *adjacent*
/// identical trailer (`addIfDifferentNeighbor`, its default): with our trailer last it is a no-op, but
/// with another co-author after ours it appends a second copy. That is precisely the shape a coding
/// agent produces when it writes both its own attribution and ours, so the naive version would
/// double-attribute on the most common configured path.
#[test]
fn the_trailer_is_idempotent_and_coexists_with_another_co_author() {
    let home = TempDir::new("tendril-coauthor-idem-home");
    let repo = TempDir::new("tendril-coauthor-idem-repo");
    init_repo(repo.path());

    let pairs = env_pairs(&settings_with(Some(IDENTITY)), home.path());
    let env = as_refs(&pairs);
    let other = "Co-Authored-By: Someone Else <else@example.invalid>";

    // Ours alone, already present.
    std::fs::write(repo.path().join("a.txt"), "a\n").expect("write file");
    git(repo.path(), &env, &["add", "-A"]);
    git(
        repo.path(),
        &env,
        &["commit", "-q", "-m", "already trailered", "-m", TRAILER],
    );
    let message = git(repo.path(), &env, &["log", "-1", "--format=%B"]);
    assert_eq!(
        message.matches(TRAILER).count(),
        1,
        "the trailer must not be duplicated, got:\n{message}"
    );

    // Someone else's alone: ours is added, theirs survives.
    std::fs::write(repo.path().join("b.txt"), "b\n").expect("write file");
    git(repo.path(), &env, &["add", "-A"]);
    git(
        repo.path(),
        &env,
        &["commit", "-q", "-m", "two co-authors", "-m", other],
    );
    let message = git(repo.path(), &env, &["log", "-1", "--format=%B"]);
    assert!(message.contains(other), "the other co-author must survive");
    assert!(message.contains(TRAILER), "and ours must be added");

    // Ours *followed by* someone else's — the case `interpret-trailers` alone gets wrong.
    std::fs::write(repo.path().join("c.txt"), "c\n").expect("write file");
    git(repo.path(), &env, &["add", "-A"]);
    git(
        repo.path(),
        &env,
        &[
            "commit",
            "-q",
            "-m",
            "ours then theirs",
            "-m",
            &format!("{TRAILER}\n{other}"),
        ],
    );
    let message = git(repo.path(), &env, &["log", "-1", "--format=%B"]);
    assert_eq!(
        message.matches(TRAILER).count(),
        1,
        "a non-adjacent existing trailer must not be duplicated, got:\n{message}"
    );
    assert!(message.contains(other), "and theirs must still survive");

    // Case-insensitively, too. `Co-authored-by` is a spelling git and GitHub both honour, and an
    // agent writing it that way followed by another co-author is the same non-adjacent shape as
    // above — so a case-sensitive guard here would attribute the same bot twice.
    let lower = "Co-authored-by: test-bot <bot@example.invalid>";
    std::fs::write(repo.path().join("d.txt"), "d\n").expect("write file");
    git(repo.path(), &env, &["add", "-A"]);
    git(
        repo.path(),
        &env,
        &[
            "commit",
            "-q",
            "-m",
            "lowercase spelling",
            "-m",
            &format!("{lower}\n{other}"),
        ],
    );
    let message = git(repo.path(), &env, &["log", "-1", "--format=%B"]);
    assert_eq!(
        message.to_lowercase().matches("test-bot").count(),
        1,
        "a differently-cased existing trailer must not be duplicated, got:\n{message}"
    );
    assert!(message.contains(other), "and theirs must still survive");
}

/// A customer who has set `GIT_CONFIG_COUNT` themselves keeps every pair they configured. Writing at
/// index 0 would silently destroy the first of them — a corruption with no error and no log line,
/// which is why this is a test rather than a code comment.
#[test]
fn an_existing_git_config_count_is_appended_to_not_clobbered() {
    let home = TempDir::new("tendril-coauthor-count-home");
    let repo = TempDir::new("tendril-coauthor-count-repo");
    init_repo(repo.path());

    // The agent's configured environment, as `codingAgents[].environmentVariables` would supply it.
    let mut existing = HashMap::new();
    existing.insert("GIT_CONFIG_COUNT".to_string(), "1".to_string());
    existing.insert("GIT_CONFIG_KEY_0".to_string(), "user.name".to_string());
    existing.insert(
        "GIT_CONFIG_VALUE_0".to_string(),
        "Customer Setting".to_string(),
    );

    let pairs = coauthor_env(&settings_with(Some(IDENTITY)), home.path(), &existing);
    let mut merged = existing.clone();
    merged.extend(pairs);
    assert_eq!(
        merged.get("GIT_CONFIG_COUNT").map(String::as_str),
        Some("2"),
        "the count must grow rather than be replaced with 1"
    );

    let env: Vec<(&str, &str)> = merged
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    // `user.name` is the visible proof the customer's pair survived: git resolves the author from it.
    std::fs::write(repo.path().join("a.txt"), "a\n").expect("write file");
    git(repo.path(), &env, &["add", "-A"]);
    git(repo.path(), &env, &["commit", "-q", "-m", "both settings"]);

    assert_eq!(
        git(repo.path(), &env, &["config", "--get", "user.name"]).trim(),
        "Customer Setting",
        "the customer's own GIT_CONFIG pair must still be in effect"
    );
    let message = git(repo.path(), &env, &["log", "-1", "--format=%B"]);
    assert!(
        message.contains(TRAILER),
        "and Tendril's pair must also apply, got:\n{message}"
    );
}

/// The commit forms the promptwares actually use. `--amend --no-edit` is `CreatePr`'s, the heredoc is
/// how a multi-line message is written, and `--no-verify` bypasses only `pre-commit` and `commit-msg`
/// — never `prepare-commit-msg` — so it must not be an escape hatch from attribution.
#[test]
fn every_commit_form_a_promptware_uses_is_covered() {
    let home = TempDir::new("tendril-coauthor-forms-home");
    let repo = TempDir::new("tendril-coauthor-forms-repo");
    init_repo(repo.path());

    let pairs = env_pairs(&settings_with(Some(IDENTITY)), home.path());
    let env = as_refs(&pairs);

    // `git commit -a --amend --no-edit`, as CreatePr runs it over a commit made without the trailer.
    std::fs::write(repo.path().join("a.txt"), "a\n").expect("write file");
    git(repo.path(), &[], &["add", "-A"]);
    git(repo.path(), &[], &["commit", "-q", "-m", "pre-existing"]);
    std::fs::write(repo.path().join("a.txt"), "a2\n").expect("write file");
    git(
        repo.path(),
        &env,
        &["commit", "-q", "-a", "--amend", "--no-edit"],
    );
    let amended = git(repo.path(), &env, &["log", "-1", "--format=%B"]);
    assert!(
        amended.contains(TRAILER),
        "--amend --no-edit must be trailered, got:\n{amended}"
    );

    // `--no-verify`, which skips pre-commit and commit-msg but never prepare-commit-msg.
    std::fs::write(repo.path().join("b.txt"), "b\n").expect("write file");
    git(repo.path(), &env, &["add", "-A"]);
    git(
        repo.path(),
        &env,
        &["commit", "-q", "--no-verify", "-m", "unverified"],
    );
    let unverified = git(repo.path(), &env, &["log", "-1", "--format=%B"]);
    assert!(
        unverified.contains(TRAILER),
        "--no-verify must not escape attribution, got:\n{unverified}"
    );

    // A merge commit, which `CreatePr` produces when it resolves a conflict against the base branch.
    git(repo.path(), &[], &["checkout", "-q", "-b", "side"]);
    std::fs::write(repo.path().join("side.txt"), "side\n").expect("write file");
    git(repo.path(), &[], &["add", "-A"]);
    git(repo.path(), &[], &["commit", "-q", "-m", "side change"]);
    git(repo.path(), &[], &["checkout", "-q", "main"]);
    std::fs::write(repo.path().join("main.txt"), "main\n").expect("write file");
    git(repo.path(), &[], &["add", "-A"]);
    git(repo.path(), &[], &["commit", "-q", "-m", "main change"]);
    git(repo.path(), &env, &["merge", "-q", "--no-edit", "side"]);
    let merged = git(repo.path(), &env, &["log", "-1", "--format=%B"]);
    assert!(
        merged.contains(TRAILER),
        "a merge commit must be trailered, got:\n{merged}"
    );
}

/// A worktree is where `ExecutePlan` and `RetryPlan` actually commit, and the binding must reach it
/// without `extensions.worktreeConfig` or any other write to the shared `.git`.
#[test]
fn commits_in_a_linked_worktree_are_trailered() {
    let home = TempDir::new("tendril-coauthor-wt-home");
    let repo = TempDir::new("tendril-coauthor-wt-repo");
    init_repo(repo.path());

    let worktree = repo.path().join("..").join(format!(
        "tendril-coauthor-wt-{}",
        uuid::Uuid::new_v4().simple()
    ));
    git(
        repo.path(),
        &[],
        &[
            "worktree",
            "add",
            "-q",
            &worktree.to_string_lossy(),
            "-b",
            "tendril/work",
        ],
    );

    let pairs = env_pairs(&settings_with(Some(IDENTITY)), home.path());
    let message = commit(&worktree, &as_refs(&pairs), "a.txt", "worktree change");
    assert!(
        message.contains(TRAILER),
        "expected {TRAILER:?} in:\n{message}"
    );

    git(
        repo.path(),
        &[],
        &["worktree", "remove", "--force", &worktree.to_string_lossy()],
    );
}

/// The plumbing test: the pairs have to arrive on the object both launch paths read, or the feature
/// is correct in isolation and absent in production. `resolve_agent` is the single fan-out point —
/// `jobs::manager` and the CLI's promptware command each copy `environment_variables` off it — so an
/// assertion here covers every promptware, `SyncRepo` included.
#[test]
fn resolve_agent_carries_the_pairs_into_the_launch_environment() {
    let home = TempDir::new("tendril-coauthor-resolve-home");

    let mut job_context = HashMap::new();
    job_context.insert(
        "TENDRIL_HOME".to_string(),
        home.path().to_string_lossy().to_string(),
    );

    let off = tendril_core::agents::resolution::resolve_agent(
        &settings_with(None),
        "claude",
        "ExecutePlan",
        None,
        &job_context,
    );
    assert!(
        !off.environment_variables.contains_key("GIT_CONFIG_COUNT"),
        "an unconfigured install must launch with the environment it has today, got {:?}",
        off.environment_variables
    );

    let on = tendril_core::agents::resolution::resolve_agent(
        &settings_with(Some(IDENTITY)),
        "claude",
        "ExecutePlan",
        None,
        &job_context,
    );
    assert_eq!(
        on.environment_variables
            .get("GIT_CONFIG_KEY_0")
            .map(String::as_str),
        Some("core.hooksPath"),
    );
    assert_eq!(
        on.environment_variables
            .get("TENDRIL_COAUTHOR")
            .map(String::as_str),
        Some(IDENTITY),
    );

    // And the value it points at is a real, executable shim rather than a path that happens to
    // typecheck — a hook git cannot exec is skipped with a hint and the commit succeeds anyway.
    let shim_dir = PathBuf::from(
        on.environment_variables
            .get("GIT_CONFIG_VALUE_0")
            .expect("hooksPath value"),
    );
    let hook = shim_dir.join("prepare-commit-msg");
    assert!(hook.is_file(), "{} must exist", hook.display());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&hook)
            .expect("stat hook")
            .permissions()
            .mode();
        assert_eq!(
            mode & 0o111,
            0o111,
            "the shim must be executable, mode {mode:o}"
        );
    }
}

/// The vault's commits are the one site the hook cannot reach: they run in this process through
/// `git_run`, not in a spawned agent, so they take the trailer as a `--trailer` argument instead.
/// This pins the two things that could silently diverge — the argv form working at all, and the
/// trailer text matching the hook layer's byte for byte.
#[test]
fn the_vault_argv_form_produces_the_same_trailer() {
    let repo = TempDir::new("tendril-coauthor-vault-repo");
    init_repo(repo.path());

    let trailer = tendril_core::git::coauthor_hooks::trailer_line(IDENTITY);
    assert_eq!(trailer, TRAILER, "both layers must emit one wire format");

    // The two-`-m` shape of `push_and_create_pr`: subject plus changelog, then the trailer.
    std::fs::write(repo.path().join("a.txt"), "a\n").expect("write file");
    git(repo.path(), &[], &["add", "-A"]);
    git(
        repo.path(),
        &[],
        &[
            "commit",
            "-q",
            "-m",
            "feat(vault): update demo (v1)",
            "-m",
            "changelog body",
            "--trailer",
            &trailer,
        ],
    );

    let message = git(repo.path(), &[], &["log", "-1", "--format=%B"]);
    assert!(
        message.contains("changelog body"),
        "the changelog must survive, got:\n{message}"
    );
    assert!(
        message.contains(TRAILER),
        "expected {TRAILER:?} in:\n{message}"
    );
}

/// `coAuthor` is `skip_serializing_if = "Option::is_none"` for the same reason `telemetry` is: V2
/// shares `config.yaml` with the original app, and introducing a key the original does not model is
/// how a round-trip through V2 starts changing a file it only meant to read. An explicit value must
/// still survive that round-trip.
#[test]
fn the_config_key_is_absent_by_default_and_round_trips_when_set() {
    let absent: TendrilSettings =
        serde_yaml::from_str("codingAgent: claude\n").expect("parse a config without the key");
    assert_eq!(
        absent.co_author, None,
        "an absent key must deserialize to None"
    );
    assert!(
        absent.co_author_identity().is_none(),
        "and must read as the feature being off"
    );

    let emitted = serde_yaml::to_string(&absent).expect("serialize");
    assert!(
        !emitted.contains("coAuthor"),
        "serializing must not introduce the key, got:\n{emitted}"
    );

    let set: TendrilSettings = serde_yaml::from_str(&format!("coAuthor: '{IDENTITY}'\n"))
        .expect("parse a config with the key");
    assert_eq!(set.co_author_identity(), Some(IDENTITY));

    let reloaded: TendrilSettings =
        serde_yaml::from_str(&serde_yaml::to_string(&set).expect("serialize")).expect("reparse");
    assert_eq!(
        reloaded.co_author_identity(),
        Some(IDENTITY),
        "an explicit value must survive a save/reload round-trip"
    );
}
