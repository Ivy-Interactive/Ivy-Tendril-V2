//! Attributes the commits Tendril itself makes to a configured identity, via a `Co-Authored-By`
//! trailer, without touching the customer's repository.
//!
//! # Why a hook, and why bound through the environment
//!
//! The commits in scope are the ones the *product* produces: a promptware agent running `git commit`
//! inside a worktree (`ExecutePlan`, `RetryPlan`, `CreatePr`) or directly in the customer's checkout
//! (`SyncRepo` takes no worktree at all). Putting "remember the trailer" in a `Program.md` would make
//! the guarantee depend on an LLM not forgetting, so the enforcement has to be code.
//!
//! Every one of those agents is a process *this daemon spawns*, so the binding used here is the
//! process environment: `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` point
//! `core.hooksPath` at a Tendril-owned shim directory for the agent and nothing else.
//!
//! The two alternatives were measured and rejected:
//!
//! * `git config core.hooksPath` inside a linked worktree writes to the **shared** `.git/config`, so
//!   the developer's own hand commits would start getting the trailer and their hooks would be
//!   replaced. `git config --worktree` avoids that but hard-fails `exit 128` unless
//!   `extensions.worktreeConfig=true` is first written into a repo Tendril does not own — a permanent
//!   mutation no reaper path removes. It also cannot reach `SyncRepo`, which has no worktree.
//! * `commit.template` is ignored by `git commit -m`; it only seeds an interactive editor buffer, and
//!   the agents commit with `-m` / `-F -`.
//!
//! The environment binding has none of those problems: `.git/config` is byte-identical before and
//! after, and the override travels with the process rather than the checkout, so it covers `SyncRepo`
//! too. Its one cost is the opposite error — a commit the agent makes in some unrelated repo would
//! also be trailered. That is over-attribution rather than a silent miss, and it is the honest
//! trade for reaching every commit site.
//!
//! # The two traps this file exists to avoid
//!
//! 1. **`core.hooksPath` replaces the hook directory wholesale.** A customer whose `pre-commit` is a
//!    secret scanner would have it silently disabled for exactly the commits an autonomous agent
//!    makes. So every shim delegates to the customer's real hook and propagates its exit code.
//! 2. **A shim cannot ask git where the real hooks are.** Under the override, both
//!    `git config --get core.hooksPath` and `git rev-parse --git-path hooks` answer with the *shim's
//!    own* directory; a shim built that way re-execs itself forever (measured). The escape is
//!    [`TENDRIL_GIT_CONFIG_BASE`]: re-running git with `GIT_CONFIG_COUNT` set back to the count that
//!    existed *before* Tendril appended its pair truncates the override list, and git then answers
//!    with the customer's real hooks directory. A self-path comparison backs that up.
//!
//! Resolution happens inside the shim, at run time, rather than being pre-computed in Rust, because
//! the effective hooks directory is a property of the *repository* while the environment is a
//! property of the *process*, and a plan may carry several repos (`ExecutePlan/Program.md` builds one
//! worktree per entry in `repos`). Runtime resolution also gets local-over-global-over-default
//! precedence and relative paths right for free, which `git config --local --get core.hooksPath`
//! does not — that misses a customer's *global* `core.hooksPath` entirely.

use crate::config::{EnvSource, TendrilSettings};
use std::collections::HashMap;
use std::path::Path;

/// Names the shim directory. Versioned so that changing the shim body in a future release cannot be
/// served from a directory an older build already materialised.
const SHIM_DIR: &str = "GitHooks/coauthor-v1";

/// The count of `GIT_CONFIG_*` pairs that existed before Tendril appended its own. A shim re-runs git
/// with `GIT_CONFIG_COUNT` pinned to this to see the configuration the customer actually has.
const BASE_COUNT_VAR: &str = "TENDRIL_GIT_CONFIG_BASE";

/// The configured identity, in `Name <email>` form. Also the shim's on/off switch: with it empty or
/// absent the shim delegates and adds nothing, so a stale shim directory is inert rather than wrong.
const IDENTITY_VAR: &str = "TENDRIL_COAUTHOR";

/// Hooks that get a delegating shim.
///
/// This is every client- and server-side hook in `githooks(5)` *except* the three whose mere
/// existence changes what git does, where a delegating shim would be worse than no shim at all:
///
/// * `push-to-checkout` — if the hook exists git hands it the whole checkout instead of doing the
///   default one, so a shim that found no original and exited 0 would silently skip the update.
/// * `proc-receive` — its presence switches the receive protocol.
/// * `fsmonitor-watchman` — not looked up in the hooks directory at all; `core.fsmonitor` names it by
///   path, so shimming it is both useless and a way to break an unrelated setting.
///
/// The list is fixed rather than mirrored from the customer's directory because one agent process may
/// commit into several repositories, each with a different hooks directory; the shim set has to be
/// repo-independent for the same reason the resolution has to be deferred to run time.
///
/// Shimming costs a `git rev-parse` per firing. The two frequent hooks dominate it — measured on
/// macOS/git 2.54, `reference-transaction` took a 300-ref fetch from 0.03s to 0.26s and the whole set
/// took 40 commits from 0.8s to 4.9s. That is paid only by an install that has set `coAuthor`, and it
/// is the price of not silently disabling a hook the customer relies on; a shorter list would trade a
/// few tens of milliseconds for an invisible failure.
const SHIMMED_HOOKS: [&str; 24] = [
    "applypatch-msg",
    "pre-applypatch",
    "post-applypatch",
    "pre-commit",
    "pre-merge-commit",
    "prepare-commit-msg",
    "commit-msg",
    "post-commit",
    "pre-rebase",
    "post-checkout",
    "post-merge",
    "pre-push",
    "pre-receive",
    "update",
    "post-receive",
    "post-update",
    "reference-transaction",
    "pre-auto-gc",
    "post-rewrite",
    "sendemail-validate",
    "post-index-change",
    "p4-changelist",
    "p4-prepare-changelist",
    "p4-post-changelist",
];

/// The trailer line for an identity. The sole definition of the wire format — the vault's direct
/// `--trailer` argv path in `vault::service` formats through here too, so the two layers cannot drift.
pub fn trailer_line(identity: &str) -> String {
    format!("Co-Authored-By: {}", identity)
}

/// The `GIT_CONFIG_*` and `TENDRIL_*` pairs to merge into a spawned agent's environment.
///
/// Returns an **empty vector** when `coAuthor` is unset, and does nothing else: no directory is
/// created, no git config is read or written, no file anywhere is touched. An unconfigured install
/// therefore runs byte-identically to one without this feature — the default is safe by construction
/// rather than by care, because the absence of config is the absence of a code path.
///
/// `existing` is the environment the agent would otherwise launch with, consulted only for a
/// `GIT_CONFIG_COUNT` the customer set themselves: Tendril appends at the next free index rather than
/// overwriting index 0, which would silently destroy whatever the customer had configured there.
pub fn coauthor_env(
    settings: &TendrilSettings,
    tendril_home: &Path,
    existing: &HashMap<String, String>,
) -> Vec<(String, String)> {
    coauthor_env_with(settings, tendril_home, existing, &crate::config::SystemEnv)
}

/// [`coauthor_env`] with the process environment injected, so a test can pin the inherited
/// `GIT_CONFIG_COUNT` without mutating the real one — `std::env::set_var` races across the threads
/// `cargo test` runs tests on.
pub fn coauthor_env_with(
    settings: &TendrilSettings,
    tendril_home: &Path,
    existing: &HashMap<String, String>,
    env: &impl EnvSource,
) -> Vec<(String, String)> {
    let Some(identity) = settings.co_author_identity() else {
        return Vec::new();
    };

    let shim_dir = tendril_home.join(SHIM_DIR);
    if let Err(e) = materialise_shims(&shim_dir) {
        // Best-effort, exactly like the worktree lifecycle log: attribution is a nicety and must
        // never be the reason a job cannot start. Without the override in the environment the agent
        // simply commits the way it does today.
        tracing::warn!(
            "[CoAuthor] Could not materialise hook shims in '{}': {e}. Commits will not carry the \
             Co-Authored-By trailer.",
            shim_dir.display()
        );
        return Vec::new();
    }

    // The agent inherits this daemon's environment and then has `existing` layered on top, so both
    // are possible sources of a pre-existing pair count.
    let base = existing
        .get("GIT_CONFIG_COUNT")
        .cloned()
        .or_else(|| env.get_var("GIT_CONFIG_COUNT"))
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(0);

    vec![
        ("GIT_CONFIG_COUNT".to_string(), (base + 1).to_string()),
        (
            format!("GIT_CONFIG_KEY_{base}"),
            "core.hooksPath".to_string(),
        ),
        (
            format!("GIT_CONFIG_VALUE_{base}"),
            shim_dir.to_string_lossy().to_string(),
        ),
        (BASE_COUNT_VAR.to_string(), base.to_string()),
        (IDENTITY_VAR.to_string(), identity.to_string()),
    ]
}

/// Writes the shim directory under the Tendril home — never inside the customer's repository, so the
/// feature leaves no residue in a checkout Tendril does not own.
///
/// Rewritten unconditionally on every call. The files are tiny, and a shim left behind by a partially
/// written earlier run is the one failure mode that would be invisible.
fn materialise_shims(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for name in SHIMMED_HOOKS {
        write_executable(&dir.join(name), &shim_body(name))?;
    }
    Ok(())
}

/// Writes a file and makes it executable.
///
/// The mode is not cosmetic: git skips a non-executable hook with nothing but
/// `hint: the hook was ignored because it's not set as executable` on stderr and commits anyway, so a
/// shim written 0644 would make the feature fail open *and* silently disable the customer's hooks.
fn write_executable(path: &Path, body: &str) -> std::io::Result<()> {
    std::fs::write(path, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

/// The POSIX `sh` body of one shim.
///
/// Every line of the delegation half is load-bearing:
///
/// * `GIT_CONFIG_COUNT="$base"` truncates the override list back to the customer's own pairs, which is
///   the only way to ask git where the real hooks live from inside a hook that *is* the override.
/// * `--path-format=absolute --git-path hooks` applies full precedence — worktree, then local, then
///   global, then the default `<common-dir>/hooks` — and absolutises a relative `core.hooksPath`,
///   which a bare `git config --get` does not.
/// * The `"$orig" != "$self"` comparison is the second defence against self-recursion, for the case
///   where a customer has genuinely pointed `core.hooksPath` at this directory.
/// * `|| exit $?` propagates a refusal: a customer `pre-commit` that fails must still block the
///   commit, and swallowing its status is how a secret scanner turns into a no-op.
fn shim_body(name: &str) -> String {
    let mut body = format!(
        r#"#!/bin/sh
# Generated by Tendril (git/coauthor_hooks.rs). Do not edit; rewritten on every agent launch.
# Delegates to the repository's real "{name}" hook, then applies the configured Co-Authored-By
# trailer. Inert when {IDENTITY_VAR} is empty.
tendril_self=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || tendril_self=
tendril_orig=$(GIT_CONFIG_COUNT="${{{BASE_COUNT_VAR}:-0}}" git rev-parse --path-format=absolute \
  --git-path hooks 2>/dev/null) || tendril_orig=
if [ -n "$tendril_orig" ] && [ -d "$tendril_orig" ]; then
  tendril_orig=$(CDPATH= cd -- "$tendril_orig" && pwd) || tendril_orig=
else
  tendril_orig=
fi
if [ -n "$tendril_orig" ] && [ "$tendril_orig" != "$tendril_self" ] \
  && [ -x "$tendril_orig/{name}" ]; then
  "$tendril_orig/{name}" "$@" || exit $?
fi
"#
    );

    if name == "prepare-commit-msg" {
        // $1 is the path to the message file. The grep guard keeps the trailer at exactly one copy
        // when a message already carries it (an agent that wrote it by hand, or `--amend` replaying a
        // message this hook already touched). `interpret-trailers` appends rather than replaces, so a
        // different co-author — the coding agent's own attribution, say — survives alongside this one
        // instead of being fought over. A failure to rewrite must not fail the commit.
        body.push_str(&format!(
            r#"if [ -n "${IDENTITY_VAR}" ] && [ -n "$1" ] && [ -f "$1" ]; then
  if ! grep -qiF "Co-Authored-By: ${IDENTITY_VAR}" "$1"; then
    git interpret-trailers --in-place \
      --trailer "Co-Authored-By: ${IDENTITY_VAR}" "$1" || :
  fi
fi
"#
        ));
    }

    body.push_str("exit 0\n");
    body
}
