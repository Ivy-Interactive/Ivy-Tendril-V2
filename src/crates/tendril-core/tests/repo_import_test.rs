//! Importing a repository by URL: the clone itself, and the redaction that has to hold around it.
//!
//! Everything here runs against real `git` over `file://` remotes in the temp directory — no
//! network, no operator repo. `file://` is a real git transport, so the clone path under test is
//! the same one an `https://` remote takes; only the failure cases need a URL that cannot resolve,
//! and those assert on the classification rather than on a particular host being down.

mod common;

use common::{assert_under_temp_dir, GitRepoFixture, HomeFixture};
use std::path::{Path, PathBuf};
use tendril_core::git::clone::{
    classify_clone_stderr, clone_or_refresh, clone_or_refresh_bounded, extract_owner_name,
    extract_repo_name, import_remote_repo, is_remote_url, redact_credentials,
    remote_repo_destination, CloneFailure, CloneOptions,
};

/// A `file://` URL for the fixture's bare origin, which is what a remote looks like offline.
fn origin_url(fixture: &GitRepoFixture) -> String {
    format!("file://{}", fixture.origin.display())
}

fn scratch(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "tendril-clone-{}-{}",
        label,
        uuid::Uuid::new_v4().simple()
    ));
    assert_under_temp_dir(&path);
    path
}

struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        assert_under_temp_dir(&self.0);
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn clones_a_remote_into_the_destination() {
    let fixture = GitRepoFixture::new("clone-happy");
    let scratch = Scratch(scratch("happy"));
    let dest = scratch.0.join("Repos").join("owner").join("repo");

    let cloned = clone_or_refresh(&origin_url(&fixture), &dest).expect("clone");

    assert_eq!(cloned.path, dest);
    assert!(dest.join(".git").is_dir(), "no .git in the clone");
    assert!(
        dest.join("README.md").is_file(),
        "the tree was not checked out"
    );
    assert_eq!(cloned.default_branch.as_deref(), Some("main"));
    assert!(!cloned.refreshed);
}

#[test]
fn a_second_import_of_the_same_remote_refreshes_instead_of_failing() {
    // V1's pull-instead-of-clone: re-running onboarding with the same URL must not be an error.
    let fixture = GitRepoFixture::new("clone-refresh");
    let scratch = Scratch(scratch("refresh"));
    let dest = scratch.0.join("repo");
    let url = origin_url(&fixture);

    clone_or_refresh(&url, &dest).expect("first clone");

    // A commit that only the origin has, so a real fast-forward has something to do.
    std::fs::write(fixture.repo.join("second.txt"), "second\n").expect("write");
    fixture.git(&["add", "second.txt"]);
    fixture.git(&["commit", "-m", "Second commit"]);
    fixture.push("main");

    let again = clone_or_refresh(&url, &dest).expect("refresh");

    assert!(again.refreshed, "the existing clone was not refreshed");
    assert!(
        dest.join("second.txt").is_file(),
        "the refresh did not fast-forward"
    );
}

#[test]
fn a_destination_holding_a_different_repo_is_refused_by_name() {
    let one = GitRepoFixture::new("clone-other-a");
    let two = GitRepoFixture::new("clone-other-b");
    let scratch = Scratch(scratch("conflict"));
    let dest = scratch.0.join("repo");

    clone_or_refresh(&origin_url(&one), &dest).expect("first clone");
    let err = clone_or_refresh(&origin_url(&two), &dest).expect_err("second clone must be refused");

    assert_eq!(err.kind, CloneFailure::DestinationConflict);
    assert!(
        err.message.contains("already holds a clone of"),
        "unhelpful message: {}",
        err.message
    );
    // Refusing means refusing: the first clone is still there and intact.
    assert!(dest.join(".git").is_dir());
}

#[test]
fn a_destination_that_is_not_a_repository_at_all_is_refused() {
    let fixture = GitRepoFixture::new("clone-occupied");
    let scratch = Scratch(scratch("occupied"));
    let dest = scratch.0.join("repo");
    std::fs::create_dir_all(&dest).expect("create dest");
    std::fs::write(dest.join("mine.txt"), "do not delete me\n").expect("write");

    let err = clone_or_refresh(&origin_url(&fixture), &dest).expect_err("must be refused");

    assert_eq!(err.kind, CloneFailure::DestinationConflict);
    assert!(err.message.contains("is not a git repository"));
    assert!(
        dest.join("mine.txt").is_file(),
        "the operator's file was destroyed"
    );
}

#[test]
fn an_unreachable_host_is_reported_as_unreachable() {
    let scratch = Scratch(scratch("unreachable"));
    // `.invalid` is reserved by RFC 2606 and cannot resolve, so this needs no network to fail.
    let err = clone_or_refresh(
        "https://tendril-nonexistent.invalid/owner/repo.git",
        &scratch.0.join("repo"),
    )
    .expect_err("must fail");

    assert_eq!(
        err.kind,
        CloneFailure::Unreachable,
        "message: {}",
        err.message
    );
    assert!(err.message.contains("Could not reach"));
    assert!(
        !scratch.0.join("repo").exists(),
        "a failed clone left its directory behind"
    );
}

#[test]
fn a_malformed_url_is_rejected_before_git_runs() {
    let scratch = Scratch(scratch("malformed"));
    for bad in [
        "not a url",
        "ftp://host/o/r",
        "--upload-pack=touch /tmp/pwned",
        "https://host/o/r'; rm -rf /",
        "https://host",
    ] {
        let err = clone_or_refresh(bad, &scratch.0.join("repo"))
            .expect_err(&format!("'{bad}' must be rejected"));
        assert_eq!(err.kind, CloneFailure::InvalidUrl, "for '{bad}'");
    }
}

#[test]
fn a_private_repo_needing_auth_fails_without_hanging_on_a_prompt() {
    // The real risk this guards: a clone that blocks on a credential prompt hangs a daemon thread
    // for good. `git clone` of a `file://` path that is not a repository is the offline stand-in
    // for "the remote refused you" — what matters is that it returns at all, quickly.
    let scratch = Scratch(scratch("auth"));
    let missing = scratch.0.join("nothing-here");
    std::fs::create_dir_all(&missing).expect("create");

    let started = std::time::Instant::now();
    let err = clone_or_refresh(
        &format!("file://{}", missing.display()),
        &scratch.0.join("repo"),
    )
    .expect_err("must fail");

    assert!(
        started.elapsed() < std::time::Duration::from_secs(30),
        "the clone blocked rather than failing"
    );
    assert_ne!(err.kind, CloneFailure::InvalidUrl);
}

/// The stderr strings git and the forges actually emit, mapped to what the operator is told.
#[test]
fn git_stderr_is_classified_into_the_five_cases() {
    let cases = [
        (
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
            CloneFailure::AuthRequired,
        ),
        (
            "remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found",
            CloneFailure::AuthRequired,
        ),
        (
            "git@github.com: Permission denied (publickey).",
            CloneFailure::AuthRequired,
        ),
        (
            "fatal: unable to access 'https://host/o/r': Could not resolve host: host",
            CloneFailure::Unreachable,
        ),
        (
            "fatal: unable to access 'https://host/o/r': Failed to connect to host port 443: Connection refused",
            CloneFailure::Unreachable,
        ),
        (
            "fatal: the remote end hung up unexpectedly",
            CloneFailure::GitFailed,
        ),
    ];

    for (stderr, expected) in cases {
        assert_eq!(classify_clone_stderr(stderr), expected, "for: {stderr}");
    }
}

/// The property the security constraint asks for: nothing that can be persisted or logged holds a
/// credential. Asserted on the token itself, not on the shape of the replacement, so a new message
/// that forgets to redact fails this even if its wording changes.
#[test]
fn a_credential_bearing_url_never_survives_into_an_error() {
    let scratch = Scratch(scratch("credentials"));
    let token = "ghp_averyrealisticlookingtoken0123456789";
    let url = format!("https://tendril-user:{token}@tendril-nonexistent.invalid/owner/repo.git");

    let err = clone_or_refresh(&url, &scratch.0.join("repo")).expect_err("must fail");

    assert!(
        !err.message.contains(token),
        "the token reached the error message: {}",
        err.message
    );
    assert!(
        !err.message.contains("tendril-user"),
        "the username reached the error message: {}",
        err.message
    );
    assert!(err.message.contains("***@tendril-nonexistent.invalid"));
}

#[test]
fn redaction_covers_the_shapes_a_remote_can_carry() {
    for (raw, expected) in [
        ("https://user:tok@host/o/r.git", "https://***@host/o/r.git"),
        // A bare token as the whole userinfo, which has no colon to key off.
        ("https://ghp_token@host/o/r", "https://***@host/o/r"),
        ("ssh://git@host/o/r.git", "ssh://***@host/o/r.git"),
        // An `@` inside the password. Git and curl both accept this, and a pattern that stopped at
        // the first `@` left `https://***@ss@host/o/r` — the tail of the password, published into
        // whatever the redaction was protecting.
        ("https://user:p@ss@host/o/r", "https://***@host/o/r"),
        (
            "https://user:tok@en@host:8443/o/r.git",
            "https://***@host:8443/o/r.git",
        ),
        // Nothing to redact: left exactly as written.
        ("https://host/o/r.git", "https://host/o/r.git"),
        ("git@host:o/r.git", "git@host:o/r.git"),
        (
            "fatal: unable to access 'https://u:p@host/o/r': 403",
            "fatal: unable to access 'https://***@host/o/r': 403",
        ),
    ] {
        assert_eq!(redact_credentials(raw), expected, "for: {raw}");
    }
}

/// The property the case above is really asserting, stated so it cannot be satisfied by a pattern
/// that happens to produce the right string for these six inputs: no run of the secret survives.
#[test]
fn a_password_containing_an_at_sign_leaves_nothing_behind() {
    let redacted = redact_credentials("https://user:p@ssw0rd@host/o/r.git");

    assert!(
        !redacted.contains("ssw0rd"),
        "the password tail survived: {redacted}"
    );
    assert!(
        !redacted.contains("user"),
        "the username survived: {redacted}"
    );
    assert_eq!(redacted, "https://***@host/o/r.git");
}

#[test]
fn a_remote_is_told_apart_from_a_path() {
    for remote in [
        "https://github.com/o/r.git",
        "http://host:8080/o/r",
        "ssh://git@host/o/r.git",
        "git://host/o/r",
        "git@github.com:o/r.git",
        "file:///tmp/o/r",
    ] {
        assert!(is_remote_url(remote), "'{remote}' should be a remote");
    }

    for local in [
        "/repos/tendril",
        "~/repos/tendril",
        "C:\\repos\\tendril",
        "repo",
    ] {
        assert!(!is_remote_url(local), "'{local}' should not be a remote");
    }
}

/// V1 `ProjectPathHelper.GetRepoPath`, including its `default`/`repo` fallbacks.
#[test]
fn the_destination_is_v1s_owner_repo_layout() {
    let home = HomeFixture::new("clone-layout");
    let root = Path::new(&home.path);

    assert_eq!(
        remote_repo_destination(
            root,
            "My Project",
            "https://github.com/Ivy-Interactive/Tendril.git"
        ),
        root.join("Projects")
            .join("MyProject")
            .join("Repos")
            .join("Ivy-Interactive")
            .join("Tendril")
    );
    assert_eq!(
        remote_repo_destination(root, "P", "git@github.com:Ivy-Interactive/Tendril.git"),
        root.join("Projects")
            .join("P")
            .join("Repos")
            .join("Ivy-Interactive")
            .join("Tendril")
    );
    // No owner segment: V1's fallback, not the repos root.
    assert_eq!(
        remote_repo_destination(root, "P", "https://host/solo"),
        root.join("Projects")
            .join("P")
            .join("Repos")
            .join("default")
            .join("solo")
    );
}

/// `sanitize_project_name` keeps `.` — project names like `Tendril.Core` need it — so `..` came
/// through it completely untouched and was then joined as a real parent-directory component. A
/// remote is attacker-supplied in a way a project name is not, and the clone's failure path
/// `remove_dir_all`s whatever the destination resolved to.
#[test]
fn a_traversal_segment_cannot_walk_the_clone_out_of_the_repos_directory() {
    let home = HomeFixture::new("clone-traversal");
    let root = Path::new(&home.path);
    let repos_root = root.join("Projects").join("P").join("Repos");

    for url in [
        "https://host/../evil.git",
        "https://host/../../../../tmp/evil.git",
        "https://host/o/..",
        "git@host:../evil.git",
        // A single dot resolves to the directory itself, which would put the clone at the owner
        // level rather than under `<owner>/<repo>`.
        "https://host/./evil.git",
        "https://host/o/.",
    ] {
        let destination = remote_repo_destination(root, "P", url);

        assert!(
            destination.starts_with(&repos_root),
            "'{url}' escaped the repos root: {}",
            destination.display()
        );
        assert!(
            !destination.components().any(|c| matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )),
            "'{url}' left a relative component in {}",
            destination.display()
        );
    }

    // The two shapes pinned to the exact directory they now take. Only the segments that actually
    // become `<owner>`/`<repo>` matter, so the deep traversal keeps `tmp` as its owner — the `..`
    // runs ahead of it were never part of the destination, and it is the one directly before the
    // repository that used to walk the clone out of `Repos`.
    assert_eq!(
        remote_repo_destination(root, "P", "https://host/../../../../tmp/evil.git"),
        repos_root.join("tmp").join("evil")
    );
    assert_eq!(
        remote_repo_destination(root, "P", "https://host/../evil.git"),
        repos_root.join("default").join("evil")
    );
}

/// End to end through `import_remote_repo`, which is what the daemon and the CLI both call: the
/// traversal has to leave nothing at all outside the project, including on the failure path where
/// `clone_or_refresh_with` recursively deletes the destination it just created.
#[test]
fn a_traversal_remote_creates_and_deletes_nothing_outside_the_project() {
    let home = HomeFixture::new("clone-traversal-import");
    let root = Path::new(&home.path);
    // Under the temp dir rather than a fixed `/tmp/...` so a parallel run cannot see another's.
    let outside = root.join("outside-the-project");
    std::fs::create_dir_all(&outside).expect("create the directory that must survive");
    std::fs::write(outside.join("keep.txt"), "do not delete me\n").expect("write");

    let relative = "../".repeat(8);
    let err = import_remote_repo(
        root,
        "P",
        &format!("https://tendril-nonexistent.invalid/{relative}outside-the-project/keep.git"),
    )
    .expect_err("an unresolvable host must fail");

    // Unreachable, not DestinationConflict: it never went looking outside `Repos` in the first
    // place, so it did not find the occupied directory there.
    assert_eq!(
        err.kind,
        CloneFailure::Unreachable,
        "message: {}",
        err.message
    );
    assert!(
        outside.join("keep.txt").is_file(),
        "the failure-path cleanup deleted a directory outside the project"
    );
}

#[test]
fn owner_and_repo_are_extracted_the_way_v1_extracts_them() {
    for (url, owner, repo) in [
        ("https://github.com/o/r.git", Some("o"), Some("r")),
        ("https://github.com/o/r", Some("o"), Some("r")),
        ("git@github.com:o/r.git", Some("o"), Some("r")),
        ("ssh://git@host:2222/o/r.git", Some("o"), Some("r")),
        // A deeper path (a self-hosted GitLab subgroup) keeps the segment nearest the repo.
        (
            "https://gitlab.host/group/sub/r.git",
            Some("sub"),
            Some("r"),
        ),
        ("https://host/solo", None, Some("solo")),
    ] {
        assert_eq!(extract_owner_name(url).as_deref(), owner, "owner of {url}");
        assert_eq!(extract_repo_name(url).as_deref(), repo, "repo of {url}");
    }
}

#[test]
fn import_places_the_clone_under_the_project() {
    let fixture = GitRepoFixture::new("clone-import");
    let home = HomeFixture::new("clone-import-home");
    let root = Path::new(&home.path);

    let cloned = import_remote_repo(root, "Tendril", &origin_url(&fixture)).expect("import");

    assert!(cloned
        .path
        .starts_with(root.join("Projects").join("Tendril").join("Repos")));
    assert!(cloned.path.join(".git").is_dir());
}

/// A TCP listener that accepts and then says nothing.
///
/// This is the reported failure in miniature, and it is the one no error string can be classified
/// from: the handshake completes, so nothing at the transport layer is wrong, and git then waits
/// for an answer that never arrives. Held connections are kept alive by the thread so the socket is
/// not closed underneath git, which would turn the stall into an ordinary error.
struct StallingRemote {
    port: u16,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl StallingRemote {
    fn new() -> Self {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind a local port");
        let port = listener.local_addr().expect("local address").port();
        listener.set_nonblocking(true).expect("non-blocking");
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);

        std::thread::spawn(move || {
            let mut held = Vec::new();
            while !flag.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => held.push(stream),
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    Err(_) => break,
                }
            }
        });

        Self { port, stop }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}/owner/repo.git", self.port)
    }
}

impl Drop for StallingRemote {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[test]
fn a_remote_that_answers_and_then_stalls_is_killed_at_the_deadline() {
    // The defect this covers: the clone ran under `std::process::Command::output()`, which has no
    // deadline, inside a `spawn_blocking` whose `JoinHandle` being dropped cancels nothing. A
    // remote that completed the handshake and then fed nothing kept the git child and a blocking
    // pool thread alive for good, and a handful of retries exhausted the pool.
    let remote = StallingRemote::new();
    let scratch = Scratch(scratch("stalled"));
    let dest = scratch.0.join("repo");

    let started = std::time::Instant::now();
    let err = clone_or_refresh_bounded(
        &remote.url(),
        &dest,
        CloneOptions::default(),
        std::time::Duration::from_secs(2),
    )
    .expect_err("a stalled clone must not succeed");
    let elapsed = started.elapsed();

    assert_eq!(err.kind, CloneFailure::TimedOut, "message: {}", err.message);
    // The deadline, plus the kill's own grace before it escalates to SIGKILL, plus slack for a
    // loaded CI box. What this is really asserting is that it returned at all.
    assert!(
        elapsed < std::time::Duration::from_secs(30),
        "the deadline did not fire: waited {elapsed:?}"
    );
    assert!(
        !dest.exists(),
        "a killed clone left its destination behind for the next run to misdiagnose"
    );
    assert!(
        staging_siblings(&scratch.0).is_empty(),
        "a killed clone left its staging directory behind: {:?}",
        staging_siblings(&scratch.0)
    );
}

/// The `<name>.tmp-<uuid>` siblings under `parent`, which must be empty once any clone has settled.
fn staging_siblings(parent: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(parent) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().contains(".tmp-"))
                .unwrap_or(false)
        })
        .collect()
}

#[test]
fn a_clone_is_staged_beside_the_destination_and_renamed_into_it() {
    // The compounding half of the same defect: a clone that wrote straight into `destination` left
    // a half-populated directory behind when it was killed or crashed. The next run found
    // `destination.exists()` with no `.git/config` in it yet and told the operator to delete a
    // directory a live process was writing into. Nothing is ever written at `destination` now - the
    // clone is built in a sibling and renamed in, so the directory either is a finished clone or
    // does not exist.
    let fixture = GitRepoFixture::new("clone-staged");
    let scratch = Scratch(scratch("staged"));
    let dest = scratch.0.join("Repos").join("owner").join("repo");

    let cloned = clone_or_refresh(&origin_url(&fixture), &dest).expect("clone");

    assert_eq!(cloned.path, dest);
    assert!(dest.join(".git").is_dir());
    assert!(
        staging_siblings(dest.parent().expect("a parent")).is_empty(),
        "the staging directory outlived the clone"
    );
}
