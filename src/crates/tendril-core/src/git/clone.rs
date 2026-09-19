//! Turning a pasted git URL into a repository on disk.
//!
//! V1 stages a URL on the onboarding picker step and clones it on the next one
//! (`OnboardingRepoHelper.ResolveReposAsync`), rewriting the ref's path from the URL to the clone
//! before the project is written — so `config.yaml` only ever holds paths. This is the daemon-side
//! equivalent, called by the create-project and add-repo routes.
//!
//! Two rules hold everywhere below. A remote may carry `https://user:token@host/...`, and git
//! echoes the URL it was handed straight back in its own stderr, so every string that can reach a
//! log, an error body or the database goes through [`redact_credentials`] first. And every git
//! invocation is non-interactive: a clone that stopped to ask for a password would hang a daemon
//! thread for good, so a missing credential has to come back as a classifiable failure instead.

use crate::config::{get_project_repos_dir, sanitize_project_name};
use regex::Regex;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// What replaces the userinfo of a credential-bearing URL.
const REDACTED: &str = "***";

/// Why a clone could not be completed. The caller gets the kind rather than only a string because
/// each one is a different thing for the operator to do — and a different HTTP status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloneFailure {
    /// Not a usable git URL at all. Nothing was run.
    InvalidUrl,
    /// The host did not answer: DNS, routing, or a refused connection.
    Unreachable,
    /// The remote wanted credentials Tendril does not have. A private repo with no configured
    /// credential helper, key or `gh auth login` lands here — as does a repo that does not exist,
    /// which GitHub deliberately reports the same way.
    AuthRequired,
    /// The destination is already occupied by something that is not a clone of this remote.
    DestinationConflict,
    /// git was still running when its deadline passed and was killed. Distinct from
    /// [`CloneFailure::Unreachable`] because nothing went wrong at the transport layer — the remote
    /// answered and then stopped feeding us — and because the operator's next move is different:
    /// retry on a better link, or clone it by hand and add the folder as a local repository.
    TimedOut,
    /// Anything git reported that the above do not cover.
    GitFailed,
}

/// A clone failure and the message to show for it. The message is already redacted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloneError {
    pub kind: CloneFailure,
    pub message: String,
}

impl CloneError {
    fn new(kind: CloneFailure, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for CloneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CloneError {}

impl From<CloneError> for crate::error::TendrilError {
    fn from(err: CloneError) -> Self {
        crate::error::TendrilError::Git(err.message)
    }
}

/// A repository that is now on disk, however it got there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClonedRepo {
    pub path: PathBuf,
    /// The branch the clone's HEAD is on, which is what the remote's default branch resolves to.
    /// V1 asks `ls-remote --symref` before cloning; reading it off the clone is the same answer
    /// without the second network round trip.
    pub default_branch: Option<String>,
    /// True when an existing clone of the same remote was refreshed rather than created.
    pub refreshed: bool,
}

/// Text with the userinfo of every `scheme://user[:secret]@host` URL in it replaced.
///
/// The whole userinfo goes, not just the password half: `https://ghp_…@host/o/r` is a credential
/// with no colon in it, and no rule can tell a token from a username without guessing. The cost is
/// that a plain `ssh://git@host/o/r` also reads as `ssh://***@host/o/r`, which is a fine trade.
///
/// The `@` inside the userinfo is why the character class excludes only `/` and whitespace, and why
/// the match is greedy. A password may legally contain a literal `@` — git accepts
/// `https://user:p@ss@host/o/r` and so does curl — and a class that stopped at the first `@` left
/// `https://***@ss@host/o/r`, publishing the tail of the password into every place this function is
/// the backstop for: `CloneError` messages, `tracing` lines, and the `report_bug` bundle an
/// operator attaches to a public issue. Greedy to the *last* `@` before the first `/` is correct
/// because RFC 3986 forbids `/` in userinfo, so the final `@` ahead of the path separator is always
/// the one dividing userinfo from host.
pub fn redact_credentials(text: &str) -> String {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        Regex::new(r"(?i)([a-z][a-z0-9+.\-]*://)[^/\s]+@")
            .expect("the credential pattern is a literal")
    });
    pattern
        .replace_all(text, format!("${{1}}{REDACTED}@").as_str())
        .into_owned()
}

/// Whether a repository reference names a remote rather than a path on disk.
///
/// Deliberately wider than the app's ported `RepoPathValidator` regexes, which reject
/// `ssh://git@host/o/r` and anything carrying credentials: this is the daemon, and the CLI and a
/// direct `POST /api/projects` can both hand it shapes the app never would. `file://` is here
/// because it is a real git transport, and it is the only one the tests can use offline.
pub fn is_remote_url(value: &str) -> bool {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    if ["http://", "https://", "ssh://", "git://", "file://"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
    {
        return true;
    }
    scp_like_pattern().is_match(trimmed)
}

/// `user@host:path`, git's scp-style remote. A Windows path (`C:\repos\x`) has no `@` and so cannot
/// match.
fn scp_like_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^[^/\\:@\s]+@[^/\\:@\s]+:.+$").expect("the scp-style pattern is a literal")
    })
}

/// The path part of a remote, with the scheme, userinfo, host and any `.git` suffix stripped.
fn remote_path_segments(url: &str) -> Vec<String> {
    let trimmed = url.trim();
    let rest = match trimmed.find("://") {
        Some(idx) => {
            let after_scheme = &trimmed[idx + 3..];
            // Drop userinfo and host: what is left is the path.
            match after_scheme.find('/') {
                Some(slash) => &after_scheme[slash + 1..],
                None => "",
            }
        }
        None => match trimmed.find(':') {
            Some(idx) => &trimmed[idx + 1..],
            None => trimmed,
        },
    };

    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let rest = match rest.len().checked_sub(4) {
        Some(cut) if rest[cut..].eq_ignore_ascii_case(".git") => &rest[..cut],
        _ => rest,
    };

    rest.split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// V1 `RepoPathValidator.ExtractRepoName` for a remote: the last path segment.
pub fn extract_repo_name(url: &str) -> Option<String> {
    remote_path_segments(url).pop()
}

/// V1 `RepoPathValidator.ExtractOwnerName`: the segment before the repository, which is what gives
/// the clone its `<owner>/<repo>` home. Never ported to the app, so the daemon owns it.
pub fn extract_owner_name(url: &str) -> Option<String> {
    let segments = remote_path_segments(url);
    if segments.len() >= 2 {
        segments.get(segments.len() - 2).cloned()
    } else {
        None
    }
}

/// One path segment of a remote, reduced to something that can only ever name a child directory.
///
/// [`sanitize_project_name`] is V1's `InputSanitizer.SanitizeProjectName` and deliberately keeps
/// `.` — project names like `Tendril.Core` depend on it — so it passes `..` through completely
/// untouched. That is fine for a project name the operator typed and not fine for a segment lifted
/// out of a URL a stranger can supply: `https://host/../../../../tmp/evil` would otherwise join
/// four real parent-directory components onto the repos root, putting the clone outside the
/// project — and the failure-path cleanup in [`clone_or_refresh_with`] then `remove_dir_all`s
/// whatever it landed on. Rejecting the relative segments here (rather than stripping the dots)
/// keeps every accepted name byte-identical to V1's.
fn sanitized_path_segment(raw: &str) -> Option<String> {
    let segment = sanitize_project_name(raw);
    if segment.is_empty() || segment == "." || segment == ".." {
        return None;
    }
    Some(segment)
}

/// V1 `ProjectPathHelper.GetRepoPath`: `<TendrilHome>/Projects/<project>/Repos/<owner>/<repo>`.
///
/// The `default`/`repo` fallbacks are V1's too, so a URL with no owner segment still lands
/// somewhere predictable instead of at the repos root — and they double as the landing place for a
/// segment [`sanitized_path_segment`] refuses, so a traversal attempt resolves to a normal
/// directory under `Repos` rather than to an error the caller would have to handle.
pub fn remote_repo_destination(tendril_home: &Path, project_name: &str, url: &str) -> PathBuf {
    let owner = extract_owner_name(url)
        .and_then(|o| sanitized_path_segment(&o))
        .unwrap_or_else(|| "default".to_string());
    let repo = extract_repo_name(url)
        .and_then(|r| sanitized_path_segment(&r))
        .unwrap_or_else(|| "repo".to_string());
    get_project_repos_dir(tendril_home, project_name)
        .join(owner)
        .join(repo)
}

/// Clones `url` into the project's repos directory, or refreshes the clone already there.
///
/// This is the whole of V1's stage B for one remote: work out `<owner>/<repo>`, create the parent,
/// clone, and hand back the path the project should store instead of the URL.
pub fn import_remote_repo(
    tendril_home: &Path,
    project_name: &str,
    url: &str,
) -> Result<ClonedRepo, CloneError> {
    let destination = remote_repo_destination(tendril_home, project_name, url);

    // The second half of the traversal defence [`sanitized_path_segment`] starts, checked here
    // because this is the last point before anything creates, clones into or — on the failure path
    // in [`clone_or_refresh_with`] — recursively deletes the destination. The segment filter should
    // make this unreachable; it is asserted anyway because the cost of being wrong is a
    // `remove_dir_all` outside the project. `starts_with` on `Path` compares whole components, so a
    // sibling directory sharing a name prefix cannot satisfy it.
    let repos_root = get_project_repos_dir(tendril_home, project_name);
    if !destination.starts_with(&repos_root) {
        return Err(CloneError::new(
            CloneFailure::InvalidUrl,
            format!(
                "'{}' resolves to a location outside the project's repositories directory.",
                redact_credentials(url.trim())
            ),
        ));
    }

    clone_or_refresh(url, &destination)
}

/// Rejects a URL that is malformed, or that git would read as something other than a remote.
///
/// The quote guard is V1's (`ProcessCheckHelper.CloneRepositoryAsync`), kept even though nothing
/// here goes through a shell; the leading-dash guard is not V1's and is the one that matters in
/// V2, where the URL is an `argv` element and `-u` would be read as a flag.
fn validate_remote_url(url: &str) -> Result<(), CloneError> {
    let trimmed = url.trim();
    let invalid = |reason: &str| {
        Err(CloneError::new(
            CloneFailure::InvalidUrl,
            format!(
                "'{}' is not a valid git repository URL: {reason}.",
                redact_credentials(trimmed)
            ),
        ))
    };

    if trimmed.is_empty() {
        return invalid("it is empty");
    }
    if trimmed.starts_with('-') {
        return invalid("it starts with a dash, which git would read as an option");
    }
    if trimmed.contains('\'') || trimmed.contains('"') {
        return invalid("it contains a quote");
    }
    if trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return invalid("it contains whitespace or a control character");
    }
    if !is_remote_url(trimmed) {
        return invalid("it names no recognised git transport");
    }
    if remote_path_segments(trimmed).is_empty() {
        return invalid("it names a host but no repository");
    }

    Ok(())
}

/// How long a single git invocation may run before it is killed.
///
/// Fifteen minutes is generous — a full clone of a multi-gigabyte monorepo over a domestic link
/// takes a while, and a deadline that fires on a clone that was working is a worse failure than the
/// one below it. The stall guards do the fast work: git gives up after sixty seconds under
/// [`LOW_SPEED_LIMIT`], so a remote that is merely *slow* is already an error long before this, and
/// what is left for this deadline to catch is the case those guards cannot see — a transfer that
/// completed and a git that then never exits.
pub const GIT_DEADLINE: Duration = Duration::from_secs(900);

/// The deadline for the short, local invocations: `config --get`, `symbolic-ref`. These touch no
/// network at all, so anything past a few seconds is a wedged process, not a slow one.
const LOCAL_GIT_DEADLINE: Duration = Duration::from_secs(30);

/// `http.lowSpeedLimit`/`http.lowSpeedTime`: git aborts an HTTP transfer that averages under a
/// kilobyte a second for a minute. This is the guard that actually catches the reported failure —
/// a captive portal or a half-dead proxy that completes the TCP handshake and then feeds nothing —
/// because git detects it itself and exits with a classifiable error, rather than being killed.
const LOW_SPEED_LIMIT: &str = "1000";
const LOW_SPEED_TIME: &str = "60";

/// `ssh`'s equivalent of the two settings above. There is no `ssh.lowSpeedLimit`, so the stall
/// detection has to come from ssh's own keepalives: three unanswered probes twenty seconds apart
/// tears the connection down after a minute, matching [`LOW_SPEED_TIME`].
const SSH_STALL_OPTIONS: &str = "-o ServerAliveInterval=20 -o ServerAliveCountMax=3";

/// How often [`run_git_bounded`] checks whether the child has exited. Short enough that the
/// deadline is honoured promptly, long enough that a fifteen-minute clone costs a few thousand
/// cheap `waitpid` calls rather than a busy loop.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// How deep a clone to make.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CloneOptions {
    /// `--depth`, or `None` for V1's full clone. A project repo has to be full — an agent commits
    /// in it and a shallow history breaks `merge-base` — so only the CLI's throwaway scan cache
    /// sets this.
    pub depth: Option<u32>,
}

/// Clones `url` into `destination`, or fast-forwards the clone already sitting there.
///
/// An occupied destination is not an error when it holds this same remote — that is V1's
/// pull-instead-of-clone, and it is what makes re-running onboarding a refresh rather than a
/// failure. It *is* an error when it holds anything else, because overwriting it would destroy
/// whatever is in it.
pub fn clone_or_refresh(url: &str, destination: &Path) -> Result<ClonedRepo, CloneError> {
    clone_or_refresh_with(url, destination, CloneOptions::default())
}

/// [`clone_or_refresh`] with the clone depth chosen by the caller.
pub fn clone_or_refresh_with(
    url: &str,
    destination: &Path,
    options: CloneOptions,
) -> Result<ClonedRepo, CloneError> {
    clone_or_refresh_bounded(url, destination, options, GIT_DEADLINE)
}

/// [`clone_or_refresh_with`] with the deadline chosen by the caller.
///
/// Separate from `CloneOptions` because the deadline is not a property of the clone the operator
/// asked for, it is a property of how long this process is prepared to wait — and because the only
/// caller that wants a different one is the test that proves the deadline fires at all. Fifteen
/// minutes of a test suite is not a test.
pub fn clone_or_refresh_bounded(
    url: &str,
    destination: &Path,
    options: CloneOptions,
    deadline: Duration,
) -> Result<ClonedRepo, CloneError> {
    validate_remote_url(url)?;
    let url = url.trim();
    let safe_url = redact_credentials(url);

    if destination.exists() {
        return refresh_existing(url, &safe_url, destination, options, deadline);
    }

    let parent = destination.parent().unwrap_or(destination);
    std::fs::create_dir_all(parent).map_err(|e| {
        CloneError::new(
            CloneFailure::GitFailed,
            format!("Could not create {}: {e}", parent.display()),
        )
    })?;

    // Cloned into a sibling and renamed in, never written at `destination` directly.
    //
    // `destination` existing is how [`refresh_existing`] decides there is already a clone there,
    // and a clone in flight would satisfy that test while `.git/config` is still unwritten — so a
    // retry (or a second request for the same remote) reads a directory a live git is populating,
    // finds no `remote.origin.url`, and tells the operator to "Remove it". Whoever believes that
    // deletes the tree out from under a running process. The same shape covers a crash: a daemon
    // killed mid-clone leaves `<dest>.tmp-…`, which nothing looks at, rather than a half-populated
    // `destination` that every later run misdiagnoses. The rename is atomic within a filesystem,
    // and the staging directory is a sibling precisely so it is on the same one.
    let staging = staging_path(destination);
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }

    let depth = options.depth.map(|d| d.to_string());
    let mut args = vec!["clone"];
    if let Some(depth) = depth.as_deref() {
        args.extend_from_slice(&["--depth", depth]);
    }
    let staging_arg = staging.to_string_lossy();
    args.extend_from_slice(&[url, staging_arg.as_ref()]);

    let outcome = run_git_bounded(&args, parent, &safe_url, deadline);

    let failure = match outcome {
        // A clone that got part way leaves a directory behind that the next attempt would then
        // refuse as an occupied destination, so it goes — and because it is the staging sibling,
        // "the next attempt" never saw it in the first place.
        Err(e) => Some(e),
        Ok((code, _, stderr)) if code != 0 || !staging.join(".git").exists() => {
            Some(describe_git_failure(&safe_url, &stderr))
        }
        Ok(_) => None,
    };

    if let Some(failure) = failure {
        if staging.exists() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        return Err(failure);
    }

    // Another run of the same import can have finished and renamed its own staging directory into
    // place while this one was cloning. Renaming onto it would replace a good clone with an equally
    // good one, and on Windows would fail outright, so the loser drops its copy and reports the
    // winner's — which is the same repository at the same path.
    if destination.exists() {
        let _ = std::fs::remove_dir_all(&staging);
        return refresh_existing(url, &safe_url, destination, options, deadline);
    }

    std::fs::rename(&staging, destination).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging);
        CloneError::new(
            CloneFailure::GitFailed,
            format!(
                "Cloned {safe_url} but could not move it into {}: {e}",
                destination.display()
            ),
        )
    })?;

    Ok(ClonedRepo {
        path: destination.to_path_buf(),
        default_branch: head_branch(destination),
        refreshed: false,
    })
}

/// The sibling directory a clone is built in before it is renamed onto `destination`.
///
/// `<name>.tmp-<uuid>`, which is the staging spelling the rest of the codebase already uses for a
/// write-then-rename (`chat::storage::save_session`, `plans::diff_comments`). The prefix is fixed
/// so a test — or an operator looking at a crashed daemon's leftovers — can recognise one, and the
/// uuid is what keeps two concurrent clones of the same remote out of each other's way. The
/// `.tmp-` infix also puts it past `watcher::ignore`, which already skips these.
fn staging_path(destination: &Path) -> PathBuf {
    let name = destination
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "repo".to_string());
    let parent = destination.parent().unwrap_or(destination);
    parent.join(format!("{name}.tmp-{}", uuid::Uuid::new_v4().simple()))
}

/// The occupied-destination branch of [`clone_or_refresh`].
fn refresh_existing(
    url: &str,
    safe_url: &str,
    destination: &Path,
    options: CloneOptions,
    deadline: Duration,
) -> Result<ClonedRepo, CloneError> {
    let Some(existing) = configured_origin(destination) else {
        return Err(CloneError::new(
            CloneFailure::DestinationConflict,
            format!(
                "{} already exists and is not a git repository. Remove it, or add the folder itself as a local repository.",
                destination.display()
            ),
        ));
    };

    if !same_remote(&existing, url) {
        return Err(CloneError::new(
            CloneFailure::DestinationConflict,
            format!(
                "{} already holds a clone of {}. Remove that folder, or add {} under a different project.",
                destination.display(),
                redact_credentials(&existing),
                safe_url
            ),
        ));
    }

    // A refresh that fails is worth saying out loud but not worth failing the import over: the
    // clone is present and usable, and the alternative is refusing to add a repository the
    // operator already has because the network blinked. A pull that hit the deadline is the same
    // kind of failure — the repository is still there — so it warns rather than propagating too.
    let depth = options.depth.map(|d| d.to_string());
    let mut args = vec!["pull", "--ff-only"];
    if let Some(depth) = depth.as_deref() {
        args.extend_from_slice(&["--depth", depth]);
    }
    let code = match run_git_bounded(&args, destination, safe_url, deadline) {
        Ok((code, _, stderr)) => {
            if code != 0 {
                tracing::warn!(
                    "Could not refresh the existing clone at {}: {}",
                    destination.display(),
                    redact_credentials(stderr.trim())
                );
            }
            code
        }
        Err(e) => {
            tracing::warn!(
                "Could not refresh the existing clone at {}: {}",
                destination.display(),
                // Already redacted by the runner; passed through rather than re-redacted so a
                // future message that forgets is visible here rather than silently laundered.
                e.message
            );
            -1
        }
    };

    Ok(ClonedRepo {
        path: destination.to_path_buf(),
        default_branch: head_branch(destination),
        refreshed: code == 0,
    })
}

/// `remote.origin.url` of the repository at `path`, or `None` when `path` is not one.
fn configured_origin(path: &Path) -> Option<String> {
    if !path.join(".git").exists() {
        return None;
    }
    let (code, stdout, _) = run_git_bounded(
        &["config", "--get", "remote.origin.url"],
        path,
        "",
        LOCAL_GIT_DEADLINE,
    )
    .ok()?;
    if code != 0 {
        return None;
    }
    let url = stdout.trim().to_string();
    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

/// Whether two remote spellings name the same repository: scheme, userinfo, case, a trailing slash
/// and a `.git` suffix are all noise. Comparing the host and path is what lets an `https` clone be
/// recognised when the operator later pastes the `git@` form of it.
fn same_remote(a: &str, b: &str) -> bool {
    remote_identity(a) == remote_identity(b)
}

fn remote_identity(url: &str) -> String {
    let trimmed = url.trim();
    let after_scheme = match trimmed.find("://") {
        Some(idx) => &trimmed[idx + 3..],
        None => trimmed,
    };
    let without_user = match after_scheme.find('@') {
        Some(idx) => &after_scheme[idx + 1..],
        None => after_scheme,
    };
    let host_end = without_user.find(['/', ':']).unwrap_or(without_user.len());
    let host = without_user[..host_end].to_ascii_lowercase();
    format!("{host}/{}", remote_path_segments(url).join("/")).to_ascii_lowercase()
}

/// The branch a freshly cloned repository has checked out, which is the remote's default branch.
fn head_branch(repo: &Path) -> Option<String> {
    let (code, stdout, _) = run_git_bounded(
        &["symbolic-ref", "--short", "HEAD"],
        repo,
        "",
        LOCAL_GIT_DEADLINE,
    )
    .ok()?;
    if code != 0 {
        return None;
    }
    let branch = stdout.trim().to_string();
    if branch.is_empty() {
        None
    } else {
        Some(branch)
    }
}

/// Reads git's own stderr and says which of the five failures it is.
///
/// Exposed because it is the only part of the classification that can be tested without a network:
/// the strings below are the ones git and the forges actually emit.
pub fn classify_clone_stderr(stderr: &str) -> CloneFailure {
    let lower = stderr.to_ascii_lowercase();

    const UNREACHABLE: &[&str] = &[
        "could not resolve host",
        "could not resolve hostname",
        "connection refused",
        "connection timed out",
        "failed to connect",
        "operation timed out",
        "network is unreachable",
        "no route to host",
        "temporary failure in name resolution",
        "ssl certificate problem",
    ];
    if UNREACHABLE.iter().any(|needle| lower.contains(needle)) {
        return CloneFailure::Unreachable;
    }

    // "Repository not found" is in here on purpose: that is what GitHub answers for a private repo
    // an unauthenticated client asks about, and telling the operator to check their credentials is
    // the useful half of the advice either way.
    const AUTH: &[&str] = &[
        "authentication failed",
        "could not read username",
        "could not read password",
        "terminal prompts disabled",
        "permission denied (publickey)",
        "permission denied, please try again",
        "access denied",
        "repository not found",
        "403 forbidden",
        "401 unauthorized",
        "host key verification failed",
        "invalid username or token",
    ];
    if AUTH.iter().any(|needle| lower.contains(needle)) {
        return CloneFailure::AuthRequired;
    }

    CloneFailure::GitFailed
}

/// Git's stderr turned into the one message the operator sees, redacted.
fn describe_git_failure(safe_url: &str, stderr: &str) -> CloneError {
    let kind = classify_clone_stderr(stderr);
    let detail = redact_credentials(stderr.trim());
    let message = match kind {
        CloneFailure::Unreachable => format!(
            "Could not reach {safe_url}. Check the URL and your network connection."
        ),
        CloneFailure::AuthRequired => format!(
            "Authentication failed for {safe_url}. If it is a private repository, set up git credentials (a credential helper, an SSH key, or `gh auth login`) and try again."
        ),
        // V1's wording — `OnboardingRepoHelper` says exactly this — plus the detail V1 threw away.
        _ => format!("Failed to fetch repository: {safe_url}."),
    };

    let message = if detail.is_empty() {
        message
    } else {
        format!("{message} git said: {detail}")
    };
    CloneError::new(kind, message)
}

/// Runs git with every interactive prompt turned off and a deadline it cannot outlive.
///
/// [`crate::git::service::run_git`] is the general-purpose runner and deliberately inherits the
/// environment. That is wrong here and only here: `git clone` of a private repo with no usable
/// credential blocks on a terminal or askpass prompt that a daemon thread will never answer, so a
/// missing credential has to fail immediately instead. A configured credential helper still works —
/// only the prompt is suppressed.
///
/// The deadline exists for the case the prompt suppression cannot reach. A remote that completes
/// the TCP handshake and then stops sending — a captive portal, a half-dead proxy, a throttled
/// link — leaves git running with no prompt to suppress and no error to classify. `output()` has
/// no deadline, so such a clone held this thread for good; and because the routes call in through
/// `spawn_blocking`, and dropping a `JoinHandle` does not cancel a blocking task, the HTTP client
/// giving up changed nothing. A few retries exhausted tokio's blocking pool and unrelated requests
/// stopped being served. So: `spawn` rather than `output`, poll `try_wait` against the clock, and
/// kill and reap the tree when the clock wins.
///
/// Two layers, because killing is the crude one. The `http.lowSpeed*` and `ServerAlive*` settings
/// let git and ssh notice the stall themselves and exit with a real error after a minute, which is
/// both faster and better diagnosed than a kill at `deadline`.
fn run_git_bounded(
    args: &[&str],
    working_dir: &Path,
    safe_url: &str,
    deadline: Duration,
) -> Result<(i32, String, String), CloneError> {
    // Appended rather than replacing, so an operator who set their own ssh command keeps it.
    let ssh_command = match std::env::var("GIT_SSH_COMMAND") {
        Ok(existing) if !existing.trim().is_empty() => {
            format!("{existing} {SSH_STALL_OPTIONS} -o BatchMode=yes")
        }
        _ => format!("ssh {SSH_STALL_OPTIONS} -o BatchMode=yes"),
    };
    let low_speed_limit = format!("http.lowSpeedLimit={LOW_SPEED_LIMIT}");
    let low_speed_time = format!("http.lowSpeedTime={LOW_SPEED_TIME}");

    let mut command = Command::new("git");
    command
        .args(["-c", "core.fsmonitor=false", "--no-optional-locks"])
        .args(["-c", &low_speed_limit, "-c", &low_speed_time])
        .args(args)
        .current_dir(working_dir)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", ssh_command)
        .env("GCM_INTERACTIVE", "never")
        // `output()` nulls stdin for us; `spawn()` does not, and an inherited stdin is one more way
        // for a credential helper to find something to prompt on.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // `jobs::process_tree`'s idiom, for its reason: `git clone` is the parent of `git-remote-https`,
    // `ssh` and `git-index-pack`, and it is the child that holds the stalled socket. Signalling only
    // the process we spawned would leave that one running.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command.spawn().map_err(|e| {
        CloneError::new(
            CloneFailure::GitFailed,
            format!("Could not run git for {safe_url}: {e}"),
        )
    })?;

    // Drained on their own threads rather than after the wait. git writes its transfer counters to
    // stderr, a pipe nobody reads fills at 64 KiB, and git then blocks on the write — so a loop
    // that waited first would be timing a process it had deadlocked itself.
    let stdout_reader = child.stdout.take().map(drain_on_thread);
    let stderr_reader = child.stderr.take().map(drain_on_thread);

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => {
                kill_and_reap(&mut child);
                return Err(CloneError::new(
                    CloneFailure::GitFailed,
                    format!("Lost track of the git process for {safe_url}: {e}"),
                ));
            }
        }

        if started.elapsed() >= deadline {
            kill_and_reap(&mut child);
            return Err(CloneError::new(
                CloneFailure::TimedOut,
                // `safe_url` is empty for the local invocations, which is why the host is not named
                // unconditionally: an empty one would read as "Gave up on  after".
                if safe_url.is_empty() {
                    format!(
                        "git did not finish within {} seconds and was stopped.",
                        deadline.as_secs()
                    )
                } else {
                    format!(
                        "Gave up on {safe_url} after {} seconds and stopped git. A remote that answers and then stalls looks exactly like this; try again, or clone it yourself and add the folder as a local repository.",
                        deadline.as_secs()
                    )
                },
            ));
        }

        std::thread::sleep(POLL_INTERVAL);
    };

    Ok((
        status.code().unwrap_or(-1),
        stdout_reader.map(joined).unwrap_or_default(),
        stderr_reader.map(joined).unwrap_or_default(),
    ))
}

/// Reads a child's pipe to EOF on a thread of its own, so nothing can block on a full one.
fn drain_on_thread<R: Read + Send + 'static>(mut source: R) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = source.read_to_end(&mut buffer);
        String::from_utf8_lossy(&buffer).to_string()
    })
}

/// What a drainer read, or nothing if the thread itself failed — which is not worth a diagnostic,
/// since the exit code is the part the callers decide on.
fn joined(handle: std::thread::JoinHandle<String>) -> String {
    handle.join().unwrap_or_default()
}

/// Stops `child` and everything it spawned, then reaps it, so the deadline leaves neither a live
/// process nor a zombie behind.
///
/// [`crate::jobs::process_tree::kill_tree`] is the general-purpose version and is deliberately not
/// used: its grace loop asks `is_process_running`, which a child that has exited but not been
/// waited on still satisfies, so it would sleep the entire grace on every call and then signal a
/// corpse. `try_wait` answers the same question and reaps in the same call. The signalling below is
/// that function's, unchanged.
fn kill_and_reap(child: &mut std::process::Child) {
    #[cfg(unix)]
    signal_tree(child.id(), libc::SIGTERM);
    #[cfg(not(unix))]
    crate::jobs::process_tree::kill_tree(child.id(), Duration::ZERO);

    let grace = Instant::now() + crate::jobs::process_tree::DEFAULT_KILL_GRACE;
    while Instant::now() < grace {
        // An `Err` here means the child is already gone and unwaitable; either way there is nothing
        // left to escalate to.
        if !matches!(child.try_wait(), Ok(None)) {
            return;
        }
        std::thread::sleep(POLL_INTERVAL);
    }

    #[cfg(unix)]
    signal_tree(child.id(), libc::SIGKILL);
    #[cfg(not(unix))]
    let _ = child.kill();

    let _ = child.wait();
}

/// Signals the child's whole process group, falling back to the child alone when it was never put
/// in one. `jobs::process_tree::signal`, inlined for the reason [`kill_and_reap`] gives.
#[cfg(unix)]
fn signal_tree(pid: u32, sig: libc::c_int) {
    if pid == 0 {
        return;
    }
    if unsafe { libc::kill(-(pid as i32), sig) } != 0 {
        unsafe {
            libc::kill(pid as libc::pid_t, sig);
        }
    }
}
