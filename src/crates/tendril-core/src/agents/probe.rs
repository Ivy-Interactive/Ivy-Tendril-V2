//! One-off probes against a coding agent: is its CLI installed, is it authenticated, and will the
//! provider actually serve a given model.
//!
//! This is the daemon half of V1's **Test Agent** dialog
//! (`Apps/Settings/Dialogs/AgentTestDialog.cs`), which drives `IAgentHealthCheck` per agent:
//! `CheckInstallAsync`, then `CheckAuthAsync`, then one `ValidateModelAsync` per configured profile
//! model. Every argv, timeout and string match below is that interface's per-provider implementation
//! ported verbatim — see the per-function docs for which file each came from.
//!
//! Deliberately **not** part of [`crate::health`]. `agent_model_checks` promises to stay
//! "synchronous and offline" because `tendril doctor` must not spend a minute shelling out to six
//! CLIs; these probes are the opposite contract — they launch real processes, spend real quota and
//! are only ever reached from an explicit operator action.
//!
//! The bring-your-own-LLM agents (`ivy`, `openaiproxy`) take a different path entirely: they have no
//! CLI of their own to interrogate, so their auth and model checks reuse onboarding's
//! [`crate::agents::provider_models::test_model_prompt`] — the same five-token `ping` the Coding
//! Agent pane's "Fetch models" button falls back to.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::agents::provider_models::{test_model_prompt, ModelValidation, ModelValidationStatus};
use crate::agents::providers::{
    apple_base_url, format_cursor_model, resolve_copilot_binary, resolve_cursor_binary,
    resolve_opencode_binary, APPLE_MODEL_ID, APPLE_WIRE_MODEL_ID,
};
use crate::agents::resolution::normalize_agent_name;
use crate::config::dirs_home;
use crate::jobs::process_tree::{kill_tree, DEFAULT_KILL_GRACE};
use crate::tunnel::installer::find_on_path;

// ---------------------------------------------------------------------------
// Provider error classification — V1 `Runtime/ProviderErrorClassifier`
// ---------------------------------------------------------------------------

/// The two provider-level walls that stop an agent before it does any work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderErrorKind {
    None,
    /// Quota exhausted or rate limited. Clears by itself, so it is worth retrying.
    Quota,
    /// Authentication failed. Will not clear on its own.
    Auth,
}

/// V1 `ProviderErrorClassifier.QuotaTerms`.
const QUOTA_TERMS: &[&str] = &[
    "quota",
    "rate limit",
    "429",
    "too many requests",
    "resource_exhausted",
];

/// V1 `ProviderErrorClassifier.AuthTerms`.
const AUTH_TERMS: &[&str] = &[
    "not logged in",
    "you are not logged into",
    "oauth",
    "unauthorized",
    "401",
    "403",
    "authentication",
    "unauthenticated",
];

/// gRPC/Google-style status names a provider puts in front of its message. Matched before the
/// numeric form so `RESOURCE_EXHAUSTED (code 429)` reports the more specific name.
static SYMBOLIC_CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\b(RESOURCE_EXHAUSTED|PERMISSION_DENIED|UNAUTHENTICATED|DEADLINE_EXCEEDED|UNAVAILABLE|INVALID_ARGUMENT|NOT_FOUND|FAILED_PRECONDITION)\b",
    )
    .expect("symbolic provider code pattern is valid")
});

/// Only the HTTP statuses a provider failure actually reports, rather than any three-digit number:
/// an unconstrained pattern happily reads "attempt 429" out of prose that is not a code.
static NUMERIC_CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(400|401|402|403|404|408|409|422|429|500|502|503|504)\b")
        .expect("numeric provider code pattern is valid")
});

/// Which wall, if either, a provider message describes.
///
/// Quota is checked first, which is V1's order and its reason: "a 429 that also mentions oauth is a
/// quota wall, and retrying is the right advice for it."
pub fn classify_provider_error(text: Option<&str>) -> ProviderErrorKind {
    let Some(text) = text else {
        return ProviderErrorKind::None;
    };
    if text.trim().is_empty() {
        return ProviderErrorKind::None;
    }
    let lower = text.to_ascii_lowercase();
    if QUOTA_TERMS.iter().any(|term| lower.contains(term)) {
        return ProviderErrorKind::Quota;
    }
    if AUTH_TERMS.iter().any(|term| lower.contains(term)) {
        return ProviderErrorKind::Auth;
    }
    ProviderErrorKind::None
}

/// The provider's own error code out of a message, e.g. `RESOURCE_EXHAUSTED` or `429`.
pub fn extract_provider_code(text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    if let Some(found) = SYMBOLIC_CODE.find(text) {
        return Some(found.as_str().to_string());
    }
    NUMERIC_CODE.find(text).map(|m| m.as_str().to_string())
}

/// A quota wall clears by itself; an auth failure will not.
pub fn is_retryable(kind: ProviderErrorKind) -> bool {
    kind == ProviderErrorKind::Quota
}

/// Human-readable name of the condition, for the message shown on a failed probe.
pub fn describe_provider_error(kind: ProviderErrorKind) -> &'static str {
    match kind {
        ProviderErrorKind::Quota => "provider quota exhausted",
        ProviderErrorKind::Auth => "provider authentication failed",
        ProviderErrorKind::None => "provider error",
    }
}

// ---------------------------------------------------------------------------
// The process runner — V1 `Helpers/HealthCheckRunner`
// ---------------------------------------------------------------------------

/// What V1's runner puts on stderr when it kills a probe for running long. Several checks read this
/// exact sentinel as a *result* rather than a failure — Codex treats a five-second timeout as proof
/// the model was accepted — so it is a constant rather than a literal spelled in each of them.
pub const TIMED_OUT: &str = "Timed out";

/// How long output draining is given after a kill, so a wedged pipe cannot hang a probe.
const POST_KILL_TIMEOUT: Duration = Duration::from_secs(5);

/// What `codex exec … -` says, on stderr and with exit 1, when the stdin `run_probe` closed hands it
/// EOF instead of a prompt. `classify_codex_model` reads it as the model being accepted; see there
/// for why. Lowercase because the classifiers match against a lowercased haystack.
const CODEX_NO_PROMPT: &str = "no prompt provided via stdin";

/// One probe's process outcome. `exit_code` is `-1` for "never ran, or was killed", which is the
/// convention every classifier below reads together with `stderr`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl ProbeOutput {
    /// Whether this is the killed-for-time case: V1's `(-1, partial stdout, "Timed out")`.
    pub fn timed_out(&self) -> bool {
        self.exit_code == -1 && self.stderr.trim().eq_ignore_ascii_case(TIMED_OUT)
    }

    /// `stdout` and `stderr` as one haystack, which is what V1's substring matches run against.
    fn combined(&self) -> String {
        format!("{}\n{}", self.stdout, self.stderr)
    }
}

/// Runs `command` with `args` under a deadline, returning its output.
///
/// V1's contract, kept exactly:
///
/// * `CI=true` and `TERM=dumb` are always set, so a CLI that would otherwise draw a spinner or open
///   a pager prints plain text and exits.
/// * stdin is closed immediately. Codex's `exec -` reads stdin and would otherwise block forever;
///   every other probe simply must not be able to ask a question.
/// * On the deadline the whole process **tree** is killed — agents shell out freely, so killing the
///   direct child alone leaves grandchildren spending tokens — and the call returns
///   `(-1, whatever stdout arrived, "Timed out")`.
pub async fn run_probe(command: &str, args: &[String], timeout: Duration) -> ProbeOutput {
    let failed_to_start = |err: std::io::Error| ProbeOutput {
        exit_code: -1,
        stdout: String::new(),
        stderr: format!("Failed to start process: {err}"),
    };

    let mut cmd = Command::new(command);
    cmd.args(args)
        .env("CI", "true")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Its own process group, for the same reason `agents::runner` does it: `kill_tree` signals the
    // negated pid, and that only reaches grandchildren when the child leads a group.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.as_std_mut().process_group(0);
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => return failed_to_start(err),
    };
    let pid = child.id().unwrap_or(0);

    // Drained on their own tasks rather than after the wait: a probe that fills the 64KiB pipe
    // buffer would otherwise block on write while we block on exit.
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();
    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(pipe) = stdout_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).to_string()
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(pipe) = stderr_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf).await;
        }
        String::from_utf8_lossy(&buf).to_string()
    });

    let collect = |task: tokio::task::JoinHandle<String>| async move {
        match tokio::time::timeout(POST_KILL_TIMEOUT, task).await {
            Ok(Ok(text)) => text.trim().to_string(),
            _ => String::new(),
        }
    };

    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => ProbeOutput {
            exit_code: status.code().unwrap_or(-1),
            stdout: collect(stdout_task).await,
            stderr: collect(stderr_task).await,
        },
        Ok(Err(err)) => failed_to_start(err),
        Err(_) => {
            if pid != 0 {
                let _ =
                    tokio::task::spawn_blocking(move || kill_tree(pid, DEFAULT_KILL_GRACE)).await;
            }
            let _ = child.kill().await;
            ProbeOutput {
                exit_code: -1,
                // Partial output is kept: a CLI that printed its complaint and then hung is still
                // telling us what went wrong.
                stdout: collect(stdout_task).await,
                stderr: TIMED_OUT.to_string(),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Result shapes — V1 `Abstractions/AgentTypes`
// ---------------------------------------------------------------------------

/// V1 `AgentInstallStatus`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallStatus {
    pub is_installed: bool,
    pub version: Option<String>,
    pub binary_path: Option<String>,
    pub error: Option<String>,
}

/// V1 `AuthStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthStatus {
    Authenticated,
    NotAuthenticated,
    /// The check itself failed — the CLI errored for a reason that is not "you are signed out".
    CheckFailed,
    /// No answer either way, e.g. the probe timed out.
    Unknown,
}

// ---------------------------------------------------------------------------
// Sign-in hints — how to install and authenticate each agent
// ---------------------------------------------------------------------------

/// One documented way to carry out a step.
///
/// [`Self::then`] exists because three of these CLIs have no sign-in *subcommand* at all: sign-in is
/// a slash command typed inside a running TUI. Flattening that into the shell line would produce
/// `copilot /login`, which is a prompt, not a login — so the two halves stay apart and the renderer
/// decides how to say "then type this at the prompt".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HintCommand {
    /// The shell to run. Always a single runnable line.
    pub command: String,
    /// What to type at the prompt once [`Self::command`] is running, for a sign-in that happens
    /// inside the TUI rather than as a subcommand. `None` when the shell line is the whole of it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub then: Option<String>,
}

impl HintCommand {
    fn run(command: &str) -> Self {
        Self {
            command: command.to_string(),
            then: None,
        }
    }

    /// A shell line plus the slash command to type at the prompt it opens.
    fn run_then(command: &str, then: &str) -> Self {
        Self {
            command: command.to_string(),
            then: Some(then.to_string()),
        }
    }
}

/// One half of a hint: what to do, and the routes that do it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HintStep {
    /// Why the routes below are the ones to take, or — where there are none — what to do instead.
    pub summary: String,
    /// Every documented route, best first; the rest are alternatives. Empty when honesty requires
    /// saying there is nothing to run, which is the case for a provider that has no CLI.
    #[serde(default)]
    pub commands: Vec<HintCommand>,
    /// A page to open rather than a command to run — the console where a bring-your-own provider's
    /// key is created. Separate from [`Self::commands`] because the two render differently, and a
    /// URL shown as shell invites someone to paste it into one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// How to install and sign in to one agent — the structured form of what V1 returned as a sentence.
///
/// # Why this is data rather than prose
///
/// V1's `IAgentHealthCheck` returned a pre-rendered `SignInHint` string, and the Coding Agent pane's
/// Help section grew its own second copy of the same knowledge in TypeScript. The two drifted, which
/// is what this shape exists to prevent: the daemon owns the *facts* (which binary, which command,
/// which console), and each renderer — the Test Agent dialog's failure row and the settings pane's
/// Help section — decides how to say them. There is one place to correct a vendor's renamed install
/// script, and both surfaces move together.
///
/// # Two rules govern every entry, and both exist because a wrong one is worse than none
///
/// 1. **The binary named here is the binary a launch spawns.** [`probe_binary`] and the `command`
///    fields in [`crate::agents::providers`] are the authority, not the vendor's own marketing name.
///    So Antigravity is `agy`, Cursor is `cursor-agent` and not `cursor` (which is the editor),
///    Copilot is `copilot` with `gh copilot` as the fallback, and Apple is `fm` rather than the
///    OpenCode it delegates through. Telling someone to install a binary Tendril never looks for
///    would send them away and leave the pane just as broken.
///
/// 2. **No `npm install -g` anywhere.** Every one of these CLIs also publishes an npm package, and
///    every one of them publishes a Homebrew formula or a vendor install script that does not need
///    Node at all. This repo's own rule is pnpm-only, and a settings pane that hands out npm
///    commands reads as an endorsement of a package manager the project does not use. The forms
///    chosen are the vendor's own first-listed install path in each case.
///
/// The `brew` forms are load-bearing and are pinned by a test. Homebrew rejects
/// `brew install <cask>` outright, so the cask/formula split decides whether the line runs at all:
/// `claude-code`, `codex` and `copilot-cli` are casks and take `--cask`; `gemini-cli` is a formula
/// and must not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSignInHint {
    /// The card or agent id this answers for, as [`sign_in_hint`] resolved it.
    pub agent: String,
    /// What [`probe_binary`] looks for, so "installed" in the pane and "installed" on disk mean the
    /// same thing. `None` for the bring-your-own cards, which are providers rather than CLIs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary: Option<String>,
    pub install: HintStep,
    pub auth: HintStep,
}

fn step(summary: &str, commands: Vec<HintCommand>) -> HintStep {
    HintStep {
        summary: summary.to_string(),
        commands,
        url: None,
    }
}

/// A step whose answer is a page to open rather than a command to run.
fn step_url(summary: &str, url: &str) -> HintStep {
    HintStep {
        summary: summary.to_string(),
        commands: Vec::new(),
        url: Some(url.to_string()),
    }
}

/// The three bring-your-own cards share an install step: there is nothing to install, because all
/// three run through the OpenCode sidecar that ships with Tendril.
const BYO_NOTHING_TO_INSTALL: &str =
    "Nothing to install. Bring-your-own providers run through the OpenCode sidecar that ships with \
     Tendril.";

/// How to install and sign in to `agent`, or `None` for an id that names no agent at all.
///
/// Keyed by **card** as well as by resolved agent id. `resolveFinalAgent` in the settings pane
/// collapses all three bring-your-own cards onto `openaiproxy` (or `ivy`), so an id-keyed table
/// would hand the Anthropic card OpenAI's console link — the card is what the operator clicked and
/// what the help has to answer for. The three proxy ids resolve onto the generic OpenAI-compatible
/// card, which is what a probe of one of them is really reporting about.
///
/// `None` rather than an invented entry for an unrecognised id: help for an agent that does not
/// exist would be made up, and the pane already raises its own callout for a `codingAgent` value
/// that is not a card.
pub fn sign_in_hint(agent: &str) -> Option<AgentSignInHint> {
    let normalized = normalize_agent_name(agent);
    let key = match normalized.as_str() {
        // The pane's own card keys, which are not agent ids and must survive the lookup unchanged.
        "openaiproxy_card" | "anthropic_card" | "berget_card" => normalized.as_str(),
        // Every proxy spelling is the same generic OpenAI-compatible provider.
        other if is_proxy_agent(other) => "openaiproxy_card",
        other => other,
    };

    let hint = match key {
        "claude" => AgentSignInHint {
            agent: key.to_string(),
            binary: Some("claude".to_string()),
            install: step(
                "The native installer puts `claude` in ~/.local/bin and keeps it updated in the \
                 background.",
                vec![
                    HintCommand::run("curl -fsSL https://claude.ai/install.sh | bash"),
                    HintCommand::run("brew install --cask claude-code"),
                ],
            ),
            // Not `claude login`, which V1 suggested and which is not a subcommand: the CLI's
            // top-level commands are `agents`, `attach`, `auth`, `doctor`, `mcp`, `plugin` and
            // friends, so a bare `login` is swallowed as the prompt positional and the user is
            // answered *about* signing in rather than signed in. Sign-in is `claude auth login`.
            auth: step(
                "Opens a browser and signs in to your Anthropic account. Claude Code needs a Pro, \
                 Max, Team, Enterprise or Console plan - the free claude.ai plan does not include \
                 it.",
                vec![HintCommand::run("claude auth login")],
            ),
        },

        "copilot" => AgentSignInHint {
            agent: key.to_string(),
            binary: Some("copilot".to_string()),
            // `resolve_copilot_binary` prefers a standalone `copilot` and only then falls back to
            // `gh copilot`, so the standalone CLI is what to install -- but an operator who already
            // has the GitHub CLI is not broken, and saying so saves a redundant install.
            install: step(
                "Installs the standalone `copilot` binary. An existing GitHub CLI also works: \
                 Tendril falls back to `gh copilot` when nothing named `copilot` is on PATH.",
                vec![
                    HintCommand::run("curl -fsSL https://gh.io/copilot-install | bash"),
                    HintCommand::run("brew install --cask copilot-cli"),
                ],
            ),
            // Not `copilot login`, which V1 suggested and which does not exist: GitHub's install
            // page says an unauthenticated first launch prompts for the `/login` slash command, so
            // sign-in happens inside the TUI. V1's `gh auth login` alternative is dropped rather
            // than carried over -- it authenticates the GitHub CLI, a separate credential from
            // Copilot's even where the binary resolves to `gh copilot`, so following it leaves the
            // user just as unauthenticated. The documented unattended route is a token instead, in
            // GitHub's own precedence order: COPILOT_GITHUB_TOKEN, then GH_TOKEN, then GITHUB_TOKEN.
            auth: step(
                "Copilot has no login subcommand - start it and run the `/login` slash command. \
                 For an unattended machine, put a token carrying the `Copilot Requests` permission \
                 in COPILOT_GITHUB_TOKEN (or GH_TOKEN) instead.",
                vec![
                    HintCommand::run_then("copilot", "/login"),
                    HintCommand::run("export COPILOT_GITHUB_TOKEN=..."),
                ],
            ),
        },

        "codex" => AgentSignInHint {
            agent: key.to_string(),
            binary: Some("codex".to_string()),
            install: step(
                "Installs `codex` to ~/.local/bin.",
                vec![
                    HintCommand::run("curl -fsSL https://chatgpt.com/codex/install.sh | sh"),
                    HintCommand::run("brew install --cask codex"),
                ],
            ),
            auth: step(
                "Signs in with ChatGPT through the browser. `--with-api-key` reads an OpenAI \
                 platform key from stdin instead, which is the route for a headless machine.",
                vec![
                    HintCommand::run("codex login"),
                    HintCommand::run("printenv OPENAI_API_KEY | codex login --with-api-key"),
                ],
            ),
        },

        "gemini" => AgentSignInHint {
            agent: key.to_string(),
            binary: Some("gemini".to_string()),
            install: step(
                "Installs the `gemini` binary. The Homebrew formula is deprecated upstream and is \
                 scheduled to be disabled on 2026-12-18, so it still installs today but will not \
                 forever; MacPorts carries the same CLI under the same name.",
                vec![
                    HintCommand::run("brew install gemini-cli"),
                    HintCommand::run("sudo port install gemini-cli"),
                ],
            ),
            // Not `gemini auth`, which V1 suggested and which has never been a subcommand: the
            // CLI's only subcommands are `mcp`, `extensions`, `skills`, `hooks` and `gemma`, so
            // `gemini auth` is swallowed as a prompt query -- the CLI answers it as a *question*,
            // telling the user to set GEMINI_API_KEY, and nobody is signed in. Sign-in is `/auth`,
            // a slash command inside the session (gemini-cli's `authCommand`, whose subcommands are
            // `signin`/`login` and `signout`/`logout` and which defaults to sign-in).
            auth: step(
                "There is no `gemini auth` subcommand. The first run offers `Sign in with Google`, \
                 and `/auth` re-runs that choice later; a GEMINI_API_KEY from \
                 aistudio.google.com/apikey skips the browser entirely.",
                vec![
                    HintCommand::run_then("gemini", "/auth"),
                    HintCommand::run("export GEMINI_API_KEY=..."),
                ],
            ),
        },

        "antigravity" | "agy" => AgentSignInHint {
            agent: "antigravity".to_string(),
            binary: Some("agy".to_string()),
            install: step(
                "Installs `agy` to ~/.local/bin. That is the binary Tendril launches - there is \
                 nothing named `antigravity` to install.",
                vec![HintCommand::run(
                    "curl -fsSL https://antigravity.google/cli/install.sh | bash",
                )],
            ),
            auth: step(
                "No login subcommand either: the first run signs in through the browser and stores \
                 the credential in the system keyring.",
                vec![HintCommand::run("agy")],
            ),
        },

        "opencode" => AgentSignInHint {
            agent: key.to_string(),
            // `resolve_opencode_binary` prefers the sidecar next to the app over anything on PATH,
            // and `tauri.conf.json` ships it as `binaries/opencode`, so the honest answer to "how do
            // I install this" is that it is already installed.
            binary: Some("opencode".to_string()),
            install: step(
                "Nothing to install. Tendril ships OpenCode as a sidecar beside the app and prefers \
                 it over any copy on PATH, so this agent works on a fresh install. Install your own \
                 only to run a different version.",
                vec![HintCommand::run(
                    "curl -fsSL https://opencode.ai/install | bash",
                )],
            ),
            auth: step(
                "OpenCode has no account of its own - it stores a credential for whichever provider \
                 you pick. `opencode auth login` is an alias for the same command.",
                vec![HintCommand::run("opencode providers login")],
            ),
        },

        "cursor" => AgentSignInHint {
            agent: key.to_string(),
            binary: Some("cursor-agent".to_string()),
            install: step(
                "The installer symlinks both `agent` and `cursor-agent` into ~/.local/bin. Tendril \
                 launches `cursor-agent`; `cursor` is the editor, not the CLI.",
                vec![HintCommand::run("curl https://cursor.com/install -fsS | bash")],
            ),
            auth: step(
                "Opens a browser; `cursor-agent status` then reports who is signed in. A key from \
                 the Cursor dashboard in CURSOR_API_KEY works without one.",
                vec![HintCommand::run("cursor-agent login")],
            ),
        },

        "apple" => AgentSignInHint {
            agent: key.to_string(),
            // `probe_binary` resolves `apple` to `fm` rather than to the OpenCode it is launched
            // through, precisely so a Mac with no `fm` reports the thing that is actually missing.
            binary: Some("fm".to_string()),
            install: step(
                "Nothing to install: `fm` ships with macOS at /usr/bin/fm. What varies is whether \
                 this Mac has the on-device model at all, which `fm available` answers.",
                vec![HintCommand::run("fm available")],
            ),
            // This is the same answer the auth and model probes give when the local server is not
            // answering, so the pane and the failure say one thing.
            auth: step(
                "No account and no key - the model runs on this Mac. Tendril reaches it over a \
                 local Chat Completions server, which has to be running.",
                vec![HintCommand::run("fm serve")],
            ),
        },

        /* ----------------------------------------------------------- bring your own LLM
         *
         * All three run through the same bundled OpenCode, so none of them has an install step;
         * what an operator actually needs is where the key comes from and what Save does with it.
         * The variable names are the settings pane's `byoEnvironment`, not a guess: it writes the
         * key to **both** spellings because the proxy may be reached by either SDK, and splits the
         * URL into the bare host for Anthropic and the `/v1` form for OpenAI. */
        "openaiproxy_card" => AgentSignInHint {
            agent: key.to_string(),
            binary: None,
            install: step(BYO_NOTHING_TO_INSTALL, Vec::new()),
            auth: step_url(
                "Create a key, paste it into API Key above, and Save. It is written to the \
                 `openaiproxy` entry as both OPENAI_API_KEY and ANTHROPIC_API_KEY, with the base \
                 URL in OPENAI_BASE_URL and ANTHROPIC_BASE_URL.",
                "https://platform.openai.com/api-keys",
            ),
        },

        "anthropic_card" => AgentSignInHint {
            agent: key.to_string(),
            binary: None,
            install: step(BYO_NOTHING_TO_INSTALL, Vec::new()),
            auth: step_url(
                "Create a key, paste it into API Key above, and Save. The default base URL is \
                 https://api.anthropic.com/v1; Save stores it as ANTHROPIC_BASE_URL without the \
                 `/v1` and OPENAI_BASE_URL with it, because the two SDKs disagree about where the \
                 version segment belongs.",
                "https://console.anthropic.com/settings/keys",
            ),
        },

        "berget_card" => AgentSignInHint {
            agent: key.to_string(),
            binary: None,
            install: step(
                "Nothing to install. Berget is an OpenAI-compatible endpoint, reached through the \
                 OpenCode sidecar that ships with Tendril.",
                Vec::new(),
            ),
            // There is no base URL to choose: `withByoCredentials` forces this card back onto
            // `api.berget.ai`.
            auth: step_url(
                "Create a key in the Berget console, paste it into API Key above, and Save. There \
                 is no base URL to set: this card is pinned to https://api.berget.ai/v1.",
                "https://console.berget.ai",
            ),
        },

        _ => return None,
    };

    Some(hint)
}

/// Every card the Coding Agent pane offers, in the order it offers them, each with its hint.
///
/// The pane fetches this once rather than keeping its own copy. That the list is complete is pinned
/// by [`tests::every_card_the_pane_offers_has_a_hint`]; that the pane offers exactly these cards is
/// pinned on the TypeScript side by `agent-roster-parity.test.ts`, which reads the catalog directly.
pub fn all_sign_in_hints() -> Vec<AgentSignInHint> {
    SIGN_IN_HINT_CARDS
        .iter()
        .filter_map(|card| sign_in_hint(card))
        .collect()
}

/// The cards [`all_sign_in_hints`] serves, in the pane's own display order: the bundled agents
/// first, then the three bring-your-own providers.
const SIGN_IN_HINT_CARDS: &[&str] = &[
    "claude",
    "copilot",
    "codex",
    "gemini",
    "antigravity",
    "opencode",
    "cursor",
    "apple",
    "openaiproxy_card",
    "anthropic_card",
    "berget_card",
];

/// V1 `AgentAuthResult`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthResult {
    pub status: AuthStatus,
    /// Which backend the credential is for (`bedrock`, `vertex`, `anthropic-api`).
    pub provider: Option<String>,
    /// How the credential is held (`oauth`, `api-key`, `auth-file`, `environment`).
    pub auth_method: Option<String>,
    pub error: Option<String>,
    /// How to sign in, as data. V1 returned a sentence here and the settings pane grew a second
    /// copy of the same knowledge; this is [`sign_in_hint`]'s entry for the agent that was probed,
    /// so the failure row and the Help section render one set of facts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sign_in_hint: Option<AgentSignInHint>,
}

impl AgentAuthResult {
    fn authenticated() -> Self {
        Self {
            status: AuthStatus::Authenticated,
            provider: None,
            auth_method: None,
            error: None,
            sign_in_hint: None,
        }
    }

    fn with_method(mut self, method: &str) -> Self {
        self.auth_method = Some(method.to_string());
        self
    }

    fn with_provider(mut self, provider: Option<String>) -> Self {
        self.provider = provider;
        self
    }

    /// A failure with no actionable hint: the check itself broke, rather than the user being
    /// signed out, so there is nothing to tell them to run.
    fn failed(status: AuthStatus, error: impl Into<String>) -> Self {
        Self {
            status,
            provider: None,
            auth_method: None,
            error: Some(error.into()),
            sign_in_hint: None,
        }
    }

    /// A failure the operator can act on, carrying `agent`'s entry from [`sign_in_hint`].
    ///
    /// The agent id rather than a sentence: the wording lives in one table that both the Test Agent
    /// dialog and the settings pane's Help section render, so a corrected install script moves both.
    fn signed_out(status: AuthStatus, error: impl Into<String>, agent: &str) -> Self {
        Self {
            status,
            provider: None,
            auth_method: None,
            error: Some(error.into()),
            sign_in_hint: sign_in_hint(agent),
        }
    }
}

/// The credentials a bring-your-own-LLM agent is probed with. Read from `config.yaml` by the route,
/// never by this module: the key belongs to the daemon's settings layer and is passed in so nothing
/// here has to know where it is stored.
#[derive(Debug, Clone, Default)]
pub struct ProbeCredentials {
    pub base_url: String,
    pub api_key: String,
}

/// Whether `agent` is one of the two proxy entries, which have no CLI of their own.
fn is_proxy_agent(agent: &str) -> bool {
    matches!(agent, "ivy" | "openaiproxy" | "proxy")
}

/// The binary a probe launches for `agent`, and the arguments that must come before its own.
///
/// `copilot` is the reason this returns a pair: with no `copilot` on PATH it is reached as
/// `gh copilot`, and every probe's argv has to carry that prefix. The two resolvers come from
/// `providers.rs` rather than being re-derived, so a probe always talks to the binary a launch would.
fn probe_binary(agent: &str) -> (String, Vec<String>) {
    match agent {
        "copilot" => resolve_copilot_binary(),
        "opencode" => (resolve_opencode_binary(), vec![]),
        // Apple is launched through OpenCode, but OpenCode is not what the operator is missing when
        // this agent does not work. `fm` is the part that is distinctly Apple's, and resolving the
        // delegate here would report "installed" on a machine with no `fm` at all -- the same
        // mistake `health::doctor_probe_target` exists to avoid.
        "apple" => ("fm".to_string(), vec![]),
        // Both proxy entries are driven through OpenCode in this build, where V1 had its own
        // `ivy-agent` CLI. There is no separate binary to find.
        agent if is_proxy_agent(agent) => (resolve_opencode_binary(), vec![]),
        "antigravity" | "agy" => ("agy".to_string(), vec![]),
        // The binary is `cursor-agent`, not `cursor` -- `cursor` is the editor. Resolved through
        // `providers` so the probe finds the same copy a launch would.
        "cursor" => (resolve_cursor_binary(), vec![]),
        other => (other.to_string(), vec![]),
    }
}

fn argv(prefix: &[String], rest: &[&str]) -> Vec<String> {
    let mut args = prefix.to_vec();
    args.extend(rest.iter().map(|arg| arg.to_string()));
    args
}

/// `default`, blank, or absent all mean "whatever the CLI picks", so none of them may be passed
/// through as a model id — that would be a request for a model that does not exist.
fn explicit_model(model: &str) -> Option<&str> {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("default") {
        None
    } else {
        Some(trimmed)
    }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/// Whether `agent`'s CLI is on this machine, and at what version.
///
/// Every V1 health check opens with the same two steps — resolve the binary, then ask it for its
/// version — and reports the binary's absence as the error rather than running anything else.
pub async fn check_install(agent: &str) -> AgentInstallStatus {
    let agent = normalize_agent_name(agent);
    let (binary, prefix) = probe_binary(&agent);

    let resolved: Option<PathBuf> = if Path::new(&binary).is_absolute() {
        Path::new(&binary).is_file().then(|| PathBuf::from(&binary))
    } else {
        find_on_path(&binary)
    };

    let Some(path) = resolved else {
        return AgentInstallStatus {
            is_installed: false,
            version: None,
            binary_path: None,
            error: Some(match agent.as_str() {
                "copilot" => "copilot (or gh) not found on PATH".to_string(),
                "apple" => "fm not found on PATH (Apple Foundation Models CLI)".to_string(),
                agent if is_proxy_agent(agent) => "opencode not found".to_string(),
                "cursor" => "cursor-agent not found on PATH".to_string(),
                other => format!("{other} not found on PATH"),
            }),
        };
    };

    AgentInstallStatus {
        is_installed: true,
        version: probe_agent_version(&agent, &binary, &prefix).await,
        binary_path: Some(path.to_string_lossy().to_string()),
        error: None,
    }
}

/// A three-part semantic version anywhere in the output.
static SEMVER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d+\.\d+\.\d+").expect("semver pattern is valid"));

/// The argument that makes an agent's binary report its presence.
///
/// Almost every CLI answers `--version`. `fm` does not: it exits 64 with "Unknown option
/// '--version'" and prints nothing on stdout, so probing it the conventional way reads a working
/// install as absent. `available` is its own presence check -- it answers "System model available"
/// and exits 0 -- and is the same argument `health::AGENT_PREREQUISITES` probes `fm` with, so
/// doctor and this probe agree about what installed means.
fn version_arg_for(agent: &str) -> &'static str {
    match agent {
        "apple" => "available",
        _ => "--version",
    }
}

/// `<binary> <version arg>`, at V1's ten-second budget.
///
/// Claude, Codex and Copilot pull a `\d+\.\d+\.\d+` out of the line and fall back to the whole
/// trimmed stdout; Gemini, OpenCode, Antigravity and the proxies report the whole line as-is,
/// because their CLIs print a version string a semver pattern would truncate. Apple reports the
/// availability line, which is not a version at all but is the only thing `fm` will tell us.
async fn probe_agent_version(agent: &str, binary: &str, prefix: &[String]) -> Option<String> {
    let out = run_probe(
        binary,
        &argv(prefix, &[version_arg_for(agent)]),
        Duration::from_secs(10),
    )
    .await;
    if out.exit_code != 0 {
        return None;
    }
    let trimmed = out.stdout.trim().to_string();
    if matches!(agent, "claude" | "codex" | "copilot") {
        if let Some(found) = SEMVER.find(&trimmed) {
            return Some(found.as_str().to_string());
        }
    }
    (!trimmed.is_empty()).then_some(trimmed)
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/// Whether `agent` holds a usable credential.
///
/// Each arm is one V1 `CheckAuthAsync`. They are deliberately unalike: two of them never launch a
/// process at all when a credential file answers the question, because the CLIs they would launch
/// reach the OS keychain and can block on a prompt in a non-interactive context.
pub async fn check_auth(agent: &str, creds: &ProbeCredentials) -> AgentAuthResult {
    match normalize_agent_name(agent).as_str() {
        "claude" => claude_auth().await,
        "codex" => codex_auth().await,
        "gemini" => gemini_auth().await,
        "copilot" => copilot_auth().await,
        "antigravity" | "agy" => antigravity_auth().await,
        "opencode" => opencode_auth().await,
        "apple" => apple_auth().await,
        "cursor" => cursor_auth().await,
        other if is_proxy_agent(other) => proxy_auth(other, creds).await,
        other => AgentAuthResult::failed(
            AuthStatus::Unknown,
            format!("No authentication probe is defined for '{other}'"),
        ),
    }
}

/// V1 `ClaudeHealthCheck.CheckAuthAsync`: the only honest test is a real one-turn prompt.
async fn claude_auth() -> AgentAuthResult {
    let out = run_probe(
        "claude",
        &argv(&[], &["-p", "ping", "--max-turns", "1"]),
        Duration::from_secs(30),
    )
    .await;

    let provider = claude_provider();
    if out.exit_code == 0 {
        return AgentAuthResult::authenticated().with_provider(provider);
    }

    let lower = out.stderr.to_ascii_lowercase();
    if lower.contains("auth") || lower.contains("login") || lower.contains("sign in") {
        return AgentAuthResult::signed_out(AuthStatus::NotAuthenticated, out.stderr, "claude")
            .with_provider(provider);
    }

    AgentAuthResult::failed(AuthStatus::CheckFailed, out.stderr).with_provider(provider)
}

/// V1 `ClaudeHealthCheck.DetectProvider`: which backend the CLI is pointed at, read off the
/// environment rather than asked for.
fn claude_provider() -> Option<String> {
    let set = |name: &str| std::env::var(name).is_ok_and(|value| !value.is_empty());
    if set("CLAUDE_CODE_USE_BEDROCK") || set("AWS_BEARER_TOKEN_BEDROCK") {
        return Some("bedrock".to_string());
    }
    if set("CLAUDE_CODE_USE_VERTEX") || set("CLOUD_ML_REGION") {
        return Some("vertex".to_string());
    }
    if set("ANTHROPIC_API_KEY") {
        return Some("anthropic-api".to_string());
    }
    None
}

/// V1 `CodexHealthCheck.CheckAuthAsync`.
async fn codex_auth() -> AgentAuthResult {
    let out = run_probe(
        "codex",
        &argv(&[], &["login", "status"]),
        Duration::from_secs(15),
    )
    .await;

    if out.exit_code == 0 {
        return AgentAuthResult::authenticated();
    }

    let lower = out.stderr.to_ascii_lowercase();
    if lower.contains("auth")
        || lower.contains("login")
        || lower.contains("not logged in")
        || lower.contains("unauthorized")
    {
        return AgentAuthResult::signed_out(AuthStatus::NotAuthenticated, out.stderr, "codex");
    }

    AgentAuthResult::failed(AuthStatus::CheckFailed, out.stderr)
}

/// V1 `GeminiHealthCheck.CheckAuthAsync`: environment first, then the credential files the CLI
/// writes, and only then a real prompt.
///
/// The file cascade is not an optimisation. `gemini -p ping` at thirty seconds is the slowest probe
/// here, and the files answer the same question in microseconds for the common case.
async fn gemini_auth() -> AgentAuthResult {
    let api_key = std::env::var("GOOGLE_API_KEY")
        .ok()
        .filter(|key| !key.is_empty())
        .or_else(|| {
            std::env::var("GEMINI_API_KEY")
                .ok()
                .filter(|key| !key.is_empty())
        });
    if api_key.is_some() {
        return AgentAuthResult::authenticated().with_method("api-key");
    }

    if let Some(home) = dirs_home() {
        for path in gemini_credential_candidates(Path::new(&home)) {
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            if content.is_empty() {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            match name {
                "oauth_creds.json" => {
                    return AgentAuthResult::authenticated().with_method("oauth");
                }
                "google_accounts.json" if has_active_account(&content) => {
                    return AgentAuthResult::authenticated().with_method("oauth");
                }
                // Skipped under a test runner, as in V1: a developer's real `settings.json` would
                // otherwise make the suite's answer depend on their machine.
                "settings.json"
                    if std::env::var("IVY_TEST_RUNNER").is_err()
                        && settings_names_a_credential(&content) =>
                {
                    return AgentAuthResult::authenticated().with_method("api-key");
                }
                "config.json" if content.len() > 2 && content.contains('{') => {
                    return AgentAuthResult::authenticated().with_method("oauth");
                }
                _ => {}
            }
        }
    }

    let out = run_probe(
        "gemini",
        &argv(&[], &["-p", "ping"]),
        Duration::from_secs(30),
    )
    .await;
    if out.exit_code == 0 {
        return AgentAuthResult::authenticated().with_method("oauth");
    }
    if out.timed_out() {
        return AgentAuthResult::failed(AuthStatus::Unknown, "Gemini auth check timed out");
    }

    AgentAuthResult::signed_out(
        AuthStatus::NotAuthenticated,
        "OAuth credentials not found and no API key set",
        "gemini",
    )
}

/// V1 `GeminiHealthCheck.GetCredentialCandidates`, in its order.
fn gemini_credential_candidates(home: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for file in ["oauth_creds.json", "google_accounts.json", "settings.json"] {
        candidates.push(home.join(".gemini").join(file));
        candidates.push(home.join(".gemini").join("config").join(file));
    }
    candidates.push(home.join(".gemini").join("config").join("config.json"));
    candidates
}

static ACTIVE_ACCOUNT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)"active"\s*:\s*"([^"]+)""#).expect("active-account pattern is valid")
});

/// V1 `IsActiveAccountAuthenticated`: a `google_accounts.json` naming a non-empty active account.
fn has_active_account(content: &str) -> bool {
    ACTIVE_ACCOUNT
        .captures(content)
        .and_then(|caps| caps.get(1))
        .is_some_and(|account| !account.as_str().trim().is_empty())
}

/// V1 `IsApiKeyConfiguredInSettings`.
fn settings_names_a_credential(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("\"selectedtype\"")
        && (lower.contains("gemini-api-key") || lower.contains("oauth"))
}

/// V1 `CopilotHealthCheck.CheckAuthAsync`.
async fn copilot_auth() -> AgentAuthResult {
    let (binary, prefix) = resolve_copilot_binary();
    let out = run_probe(
        &binary,
        &argv(
            &prefix,
            &[
                "-p",
                "ping",
                "--allow-all-paths",
                "--allow-all-urls",
                "--allow-all-tools",
                "-s",
            ],
        ),
        Duration::from_secs(30),
    )
    .await;

    if out.exit_code == 0 {
        return AgentAuthResult::authenticated();
    }

    let lower = out.stderr.to_ascii_lowercase();
    if lower.contains("auth") || lower.contains("login") || lower.contains("sign in") {
        return AgentAuthResult::signed_out(AuthStatus::NotAuthenticated, out.stderr, "copilot");
    }

    AgentAuthResult::failed(AuthStatus::CheckFailed, out.stderr)
}

/// V1 `AntigravityHealthCheck.CheckAuthAsync`: a three-second `agy models`, then the onboarding
/// state file.
///
/// Three seconds, not thirty, and with a file fallback, because `agy` reaches the OS keychain: in a
/// non-interactive or locked-screen context that call can block or prompt, and the state file
/// answers the same question without touching it.
async fn antigravity_auth() -> AgentAuthResult {
    let out = run_probe("agy", &argv(&[], &["models"]), Duration::from_secs(3)).await;
    if out.exit_code == 0 {
        return AgentAuthResult::authenticated().with_method("oauth");
    }

    if let Some(home) = dirs_home() {
        let state = Path::new(&home)
            .join(".gemini")
            .join("antigravity")
            .join("antigravity_state.pbtxt");
        if let Ok(content) = std::fs::read_to_string(state) {
            if content
                .to_ascii_lowercase()
                .contains("agent_onboarding_state_completed")
            {
                return AgentAuthResult::authenticated().with_method("oauth");
            }
        }
    }

    AgentAuthResult::signed_out(
        AuthStatus::NotAuthenticated,
        if out.stderr.trim().is_empty() {
            "Not authenticated".to_string()
        } else {
            out.stderr
        },
        "antigravity",
    )
}

/// Cursor ships the check as a subcommand: `cursor-agent status` prints
/// "✓ Logged in as <email>" and exits 0, and exits non-zero when it is not.
///
/// A subcommand rather than a real one-turn prompt (which is what `claude_auth` has to do) because
/// Cursor answers the question directly and for free, and rather than a credential file because
/// there is no documented one -- the token lives under `~/.local/share/cursor-agent`, whose layout
/// is the CLI's own business.
async fn cursor_auth() -> AgentAuthResult {
    let binary = resolve_cursor_binary();
    let out = run_probe(&binary, &argv(&[], &["status"]), Duration::from_secs(15)).await;

    if out.exit_code == 0 {
        // The account is on stdout, which is worth keeping: one machine can hold several.
        let account = out
            .stdout
            .lines()
            .find_map(|line| line.rsplit_once("Logged in as "))
            .map(|(_, account)| account.trim().to_string())
            .filter(|account| !account.is_empty());
        return AgentAuthResult::authenticated()
            .with_method("oauth")
            .with_provider(account);
    }

    let combined = out.combined();
    let lower = combined.to_ascii_lowercase();
    if lower.contains("not logged in")
        || lower.contains("auth")
        || lower.contains("login")
        || lower.contains("sign in")
    {
        return AgentAuthResult::signed_out(AuthStatus::NotAuthenticated, combined, "cursor");
    }

    AgentAuthResult::failed(AuthStatus::CheckFailed, combined)
}

/// V1 `OpenCodeHealthCheck.CheckAuthAsync`: the credential file first, then the CLI's own count.
async fn opencode_auth() -> AgentAuthResult {
    if let Some(path) = opencode_auth_file() {
        if std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) >= 2 {
            return AgentAuthResult::authenticated().with_method("auth-file");
        }
    }

    let binary = resolve_opencode_binary();
    // `providers` is the command in current builds and `auth` its alias, so `auth list` keeps
    // working and keeps V1's argv.
    let out = run_probe(
        &binary,
        &argv(&[], &["auth", "list"]),
        Duration::from_secs(15),
    )
    .await;

    if out.exit_code != 0 {
        return AgentAuthResult::signed_out(
            AuthStatus::Unknown,
            format!("Failed to check OpenCode credentials: {}", out.stderr),
            "opencode",
        );
    }

    match parse_opencode_auth_list(&out.stdout) {
        Some(method) => AgentAuthResult::authenticated().with_method(method),
        None => AgentAuthResult::signed_out(
            AuthStatus::NotAuthenticated,
            "No OpenCode credentials configured (auth.json empty and no provider environment variables)",
            "opencode",
        ),
    }
}

/// Where OpenCode keeps its credentials. V1 checks the XDG path first and falls back to `%AppData%`
/// on Windows.
fn opencode_auth_file() -> Option<PathBuf> {
    let home = dirs_home()?;
    let xdg = Path::new(&home)
        .join(".local")
        .join("share")
        .join("opencode")
        .join("auth.json");
    if xdg.is_file() {
        return Some(xdg);
    }
    if cfg!(windows) {
        if let Ok(app_data) = std::env::var("AppData") {
            let path = Path::new(&app_data).join("opencode").join("auth.json");
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

static OPENCODE_FILE_CREDS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(\d+)\s+credentials?").expect("credential count is valid"));
static OPENCODE_ENV_CREDS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(\d+)\s+environment\s+variables?").expect("env count is valid")
});
static ANSI_ESCAPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\x1b\[[0-9;]*m").expect("ANSI pattern is valid"));

/// V1 `OpenCodeHealthCheck.ParseAuthList`: the credential counts out of a coloured table.
///
/// `Some(method)` when either count is above zero, environment taking precedence as it does in V1.
fn parse_opencode_auth_list(stdout: &str) -> Option<&'static str> {
    let cleaned = ANSI_ESCAPE.replace_all(stdout, "");
    let count = |pattern: &Regex| -> u32 {
        pattern
            .captures(&cleaned)
            .and_then(|caps| caps.get(1))
            .and_then(|digits| digits.as_str().parse().ok())
            .unwrap_or(0)
    };

    if count(&OPENCODE_ENV_CREDS) > 0 {
        return Some("environment");
    }
    if count(&OPENCODE_FILE_CREDS) > 0 {
        return Some("auth-file");
    }
    None
}

/// Apple's on-device model holds no credential at all, so the only question worth asking is whether
/// `fm serve` is actually listening.
///
/// There is nothing here to be signed in to: `fm serve` binds loopback, takes the literal string
/// `local` as its key and authenticates nobody. The failure this agent really has is the one no
/// other agent has -- the CLI is installed and the server is not running -- and reporting that as an
/// auth result is what puts it in front of the operator, because `test_agent_handler` runs this
/// immediately after the install probe passes and before any model probe.
///
/// `GET /v1/models` rather than a prompt: it is the one endpoint that answers instantly, and a real
/// prompt against a cold on-device model can take seconds to say nothing more than this does.
async fn apple_auth() -> AgentAuthResult {
    let base_url = apple_base_url();
    let url = format!("{}/models", base_url.trim_end_matches('/'));

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    match http.get(&url).send().await {
        Ok(response) if response.status().is_success() => AgentAuthResult::authenticated()
            .with_method("on-device")
            .with_provider(Some("apple".to_string())),
        Ok(response) => AgentAuthResult::signed_out(
            AuthStatus::CheckFailed,
            format!("{} answered HTTP {}", url, response.status().as_u16()),
            "apple",
        ),
        Err(_) => AgentAuthResult::signed_out(
            AuthStatus::NotAuthenticated,
            format!("No Apple Foundation Models server is listening at {base_url}"),
            "apple",
        ),
    }
}

/// Whether Cursor will serve this model, asked by launching the shortest real run there is.
///
/// Cursor validates the id *server-side* and says so unmistakably -- an id the account cannot use
/// exits 1 with "Cannot use this model: <id>. Available models: …" on stderr -- so a one-word prompt
/// is a complete answer, and there is no `--list-models`-style check that avoids the round trip
/// without also missing per-account entitlements.
///
/// The id probed is the **composed** one, not the picker's base id: Cursor bakes the effort into the
/// model id, so `claude-opus-5` and `claude-opus-5-high` are different ids and only one of them may
/// be accepted. Probing the base id would pass for a launch that is going to fail.
/// [`format_cursor_model`] with no effort is exactly what a launch with no effort sends.
async fn cursor_model(model: &str) -> ModelValidation {
    let binary = resolve_cursor_binary();
    let mut args = vec![
        "--print".to_string(),
        "--output-format".to_string(),
        "text".to_string(),
        "--trust".to_string(),
        "--force".to_string(),
    ];
    if let Some(explicit) = explicit_model(model) {
        let composed = format_cursor_model(Some(explicit), None);
        if !composed.is_empty() {
            args.push("--model".to_string());
            args.push(composed);
        }
    }
    args.push("ping".to_string());

    let out = run_probe(&binary, &args, Duration::from_secs(30)).await;

    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }

    let combined = out.combined();
    let lower = combined.to_ascii_lowercase();

    // Quota first, as every other arm does: a wall is not a typo in the id.
    match classify_provider_error(Some(&combined)) {
        ProviderErrorKind::Quota => {
            return validation(ModelValidationStatus::RateLimit, model, Some(combined));
        }
        ProviderErrorKind::Auth | ProviderErrorKind::None => {}
    }

    // Cursor's own wording. The `Available models:` list that follows it is several kilobytes long,
    // so the message is truncated at the sentence that actually says what went wrong.
    if lower.contains("cannot use this model") {
        let reason = combined
            .split(" Available models:")
            .next()
            .unwrap_or(&combined)
            .trim()
            .to_string();
        return validation(ModelValidationStatus::InvalidModel, model, Some(reason));
    }

    if lower.contains("not logged in") || lower.contains("unauthorized") || lower.contains("auth") {
        return validation(ModelValidationStatus::AuthError, model, Some(combined));
    }

    validation(
        ModelValidationStatus::Unknown,
        model,
        Some(format!(
            "exit={}\nstdout: {}\nstderr: {}",
            out.exit_code, out.stdout, out.stderr
        )),
    )
}

/// Whether `fm serve` will serve this model.
///
/// The id sent is pinned, and deliberately not the one the catalog offers: the catalog and the
/// launch both spell it `apple/system`, because OpenCode addresses models as `provider/model`, but
/// that is OpenCode's addressing and not the server's. `fm serve` answers `GET /v1/models` with the
/// bare id `system` and rejects `apple/system` with `HTTP 400 Unknown model 'apple/system'` -- so
/// forwarding the catalog's own id here would report the one model this agent can run as invalid.
/// [`crate::agents::providers::APPLE_MODEL_ID`] is the OpenCode-facing string; `APPLE_WIRE_MODEL_ID`
/// is what goes on the wire.
async fn apple_model(model: &str) -> ModelValidation {
    // Any other id is a model this agent cannot launch: `build_apple_spec` overwrites the caller's
    // model with the pinned one, so validating what was asked for would answer a question about a
    // request that is never sent.
    let requested = explicit_model(model).unwrap_or(APPLE_MODEL_ID);
    if requested != APPLE_MODEL_ID {
        return validation(
            ModelValidationStatus::InvalidModel,
            model,
            Some(format!(
                "Apple Foundation Models serves only {APPLE_MODEL_ID}; '{requested}' is not available."
            )),
        );
    }

    let result = test_model_prompt(&apple_base_url(), "local", APPLE_WIRE_MODEL_ID).await;
    // Reported under the id the operator picked rather than the wire id, so the row in the Test
    // Agent dialog matches the row in the picker.
    ModelValidation {
        status: result.status,
        model: model.to_string(),
        error_message: result.error_message,
    }
}

/// V1 `OpenAiProxyHealthCheck.CheckAuthAsync`, over onboarding's tester rather than a CLI.
///
/// This is the reuse the Coding Agent pane's "Fetch models" button already relies on: a proxy has no
/// binary that knows whether its key is good, so the only test is a real five-token completion, and
/// [`test_model_prompt`] is the one that already exists for exactly that.
async fn proxy_auth(agent: &str, creds: &ProbeCredentials) -> AgentAuthResult {
    if creds.base_url.trim().is_empty() {
        return AgentAuthResult::signed_out(
            AuthStatus::NotAuthenticated,
            "Base URL is not configured.",
            agent,
        );
    }
    if creds.api_key.trim().is_empty() {
        return AgentAuthResult::signed_out(
            AuthStatus::NotAuthenticated,
            "API Key is not configured.",
            agent,
        );
    }

    let result = test_model_prompt(&creds.base_url, &creds.api_key, "default").await;
    match result.status {
        ModelValidationStatus::AuthError => AgentAuthResult::signed_out(
            AuthStatus::NotAuthenticated,
            result
                .error_message
                .unwrap_or_else(|| "Invalid API key.".to_string()),
            agent,
        ),
        ModelValidationStatus::Unknown
            if result
                .error_message
                .as_deref()
                .is_some_and(|message| message.to_ascii_lowercase().contains("connect")) =>
        {
            AgentAuthResult::signed_out(
                AuthStatus::CheckFailed,
                result.error_message.unwrap_or_default(),
                agent,
            )
        }
        _ => AgentAuthResult::authenticated().with_method("api-key"),
    }
}

// ---------------------------------------------------------------------------
// Model validation
// ---------------------------------------------------------------------------

fn validation(
    status: ModelValidationStatus,
    model: &str,
    error: Option<String>,
) -> ModelValidation {
    ModelValidation {
        status,
        model: model.to_string(),
        error_message: error,
    }
}

/// Whether the provider will actually serve `model` for `agent`.
///
/// One V1 `ValidateModelAsync` per arm. They differ far more than the auth checks do — Codex reads a
/// timeout as success, Gemini refuses to answer at all, OpenCode only answers for its default model
/// — and each difference is the provider's, not a simplification.
pub async fn validate_model(agent: &str, model: &str, creds: &ProbeCredentials) -> ModelValidation {
    match normalize_agent_name(agent).as_str() {
        "claude" => claude_model(model).await,
        "codex" => codex_model(model).await,
        "gemini" => gemini_model(model),
        "copilot" => copilot_model(model).await,
        "antigravity" | "agy" => antigravity_model(model).await,
        "opencode" => opencode_model(model).await,
        "apple" => apple_model(model).await,
        "cursor" => cursor_model(model).await,
        other if is_proxy_agent(other) => proxy_model(model, creds).await,
        other => validation(
            ModelValidationStatus::Unknown,
            model,
            Some(format!("No model probe is defined for '{other}'")),
        ),
    }
}

/// V1 `ClaudeHealthCheck.ValidateModelAsync`.
async fn claude_model(model: &str) -> ModelValidation {
    let mut args = vec!["-p".to_string(), "ping".to_string()];
    if let Some(explicit) = explicit_model(model) {
        args.push("--model".to_string());
        args.push(explicit.to_string());
    }
    args.push("--max-turns".to_string());
    args.push("1".to_string());

    let out = run_probe("claude", &args, Duration::from_secs(30)).await;
    classify_claude_model(model, &out)
}

/// V1 `ClaudeHealthCheck.ParseModelValidationResult`, split out for the same reason it is in V1:
/// the classification is where all the behaviour lives, and it is testable without a live CLI.
fn classify_claude_model(model: &str, out: &ProbeOutput) -> ModelValidation {
    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }

    let combined = out.combined();
    let lower = combined.to_ascii_lowercase();

    if lower.contains("data retention mode") {
        return validation(
            ModelValidationStatus::InvalidModel,
            model,
            Some(
                "The selected model requires an AWS Bedrock data retention mode (such as 'aws_review') that is not enabled in your AWS Bedrock account or project."
                    .to_string(),
            ),
        );
    }

    // Quota before anything else, as `ProviderErrorClassifier` does: a 429 naming a model is a wall,
    // not a typo in the model id.
    match classify_provider_error(Some(&combined)) {
        ProviderErrorKind::Quota => {
            return validation(ModelValidationStatus::RateLimit, model, Some(combined));
        }
        ProviderErrorKind::Auth | ProviderErrorKind::None => {}
    }

    if lower.contains("model")
        && [
            "invalid",
            "not found",
            "does not exist",
            "not supported",
            "not available",
        ]
        .iter()
        .any(|term| lower.contains(term))
    {
        return validation(ModelValidationStatus::InvalidModel, model, Some(combined));
    }

    if lower.contains("auth") || lower.contains("permission") || lower.contains("unauthorized") {
        return validation(ModelValidationStatus::AuthError, model, Some(combined));
    }

    validation(
        ModelValidationStatus::Unknown,
        model,
        Some(format!(
            "exit={}\nstdout: {}\nstderr: {}",
            out.exit_code, out.stdout, out.stderr
        )),
    )
}

/// V1 `CodexHealthCheck.ValidateModelAsync`, minus the timeout that V1's design turned on.
///
/// V1 waited for `codex exec … -` to block reading the prompt from stdin and read the five-second
/// kill as proof the model was accepted. `run_probe` closes stdin on every probe, so that wait never
/// happens: codex reaches the read, gets EOF, prints `No prompt provided via stdin` and exits 1.
/// That complaint *is* the V1 signal — codex only asks for a prompt once argument parsing and model
/// resolution are behind it — so `classify_codex_model` treats it as the success case and the
/// timeout branch survives only for a machine slow enough to be killed before it gets there.
///
/// `-s read-only` rather than V1's `--full-auto`, which codex-cli 0.153.0 rejects outright with
/// `unexpected argument '--full-auto' found`. The successor spellings are `-s <mode>` and
/// `--dangerously-bypass-approvals-and-sandbox`; a probe that exits before it has a prompt runs no
/// model-generated command at all, so it takes the most restricted mode on offer and states it
/// rather than inheriting whatever `--sandbox auto` resolves to from the user's config.
async fn codex_model(model: &str) -> ModelValidation {
    let args = codex_probe_args(model);
    let out = run_probe("codex", &args, Duration::from_secs(5)).await;
    classify_codex_model(model, &out)
}

/// Split out from `codex_model` so the flag set can be asserted on without running codex.
fn codex_probe_args(model: &str) -> Vec<String> {
    let mut args = vec![
        "exec".to_string(),
        "-s".to_string(),
        "read-only".to_string(),
        "--json".to_string(),
        "--skip-git-repo-check".to_string(),
    ];
    if let Some(explicit) = explicit_model(model) {
        args.push("--model".to_string());
        args.push(explicit.to_string());
    }
    args.push("-".to_string());
    args
}

fn classify_codex_model(model: &str, out: &ProbeOutput) -> ModelValidation {
    if out.timed_out() || out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }

    let combined = out.combined();
    let lower = combined.to_ascii_lowercase();

    // Ahead of the error classification, because this is the probe's ordinary success path and it
    // arrives as a failure: exit 1 with the prompt complaint on stderr. Codex asks for a prompt only
    // after it has parsed the arguments and resolved `--model`, so being asked is the furthest a
    // probe carrying no prompt can get, and reading it as an error fails every model on the list.
    if lower.contains(CODEX_NO_PROMPT) {
        return validation(ModelValidationStatus::Ok, model, None);
    }

    let detail = if out.stderr.trim().is_empty() {
        combined.trim().to_string()
    } else {
        out.stderr.clone()
    };

    match classify_provider_error(Some(&combined)) {
        ProviderErrorKind::Quota => {
            return validation(ModelValidationStatus::RateLimit, model, Some(detail));
        }
        ProviderErrorKind::Auth | ProviderErrorKind::None => {}
    }

    if lower.contains("model")
        && ["invalid", "not found", "not supported"]
            .iter()
            .any(|term| lower.contains(term))
    {
        return validation(ModelValidationStatus::InvalidModel, model, Some(detail));
    }
    if lower.contains("auth") || lower.contains("unauthorized") {
        return validation(ModelValidationStatus::AuthError, model, Some(detail));
    }
    validation(ModelValidationStatus::Unknown, model, Some(detail))
}

/// V1 `GeminiHealthCheck.ValidateModelAsync`, which is a hardcoded `Ok` and says why: the Gemini CLI
/// has no lightweight validation, and a full prompt invocation is too slow to be one.
fn gemini_model(model: &str) -> ModelValidation {
    validation(ModelValidationStatus::Ok, model, None)
}

/// V1 `CopilotHealthCheck.ValidateModelAsync`. `--model` goes after the prompt and before the
/// allow-all flags, which is where V1 inserts it.
async fn copilot_model(model: &str) -> ModelValidation {
    let (binary, prefix) = resolve_copilot_binary();
    let mut args = argv(&prefix, &["-p", "ping"]);
    if let Some(explicit) = explicit_model(model) {
        args.push("--model".to_string());
        args.push(explicit.to_string());
    }
    args.extend(
        [
            "--allow-all-paths",
            "--allow-all-urls",
            "--allow-all-tools",
            "-s",
        ]
        .iter()
        .map(|arg| arg.to_string()),
    );

    let out = run_probe(&binary, &args, Duration::from_secs(30)).await;
    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }

    let lower = out.stderr.to_ascii_lowercase();
    match classify_provider_error(Some(&out.stderr)) {
        ProviderErrorKind::Quota => {
            return validation(
                ModelValidationStatus::RateLimit,
                model,
                Some(out.stderr.clone()),
            );
        }
        ProviderErrorKind::Auth | ProviderErrorKind::None => {}
    }
    if lower.contains("model")
        && ["invalid", "not found", "does not exist", "not available"]
            .iter()
            .any(|term| lower.contains(term))
    {
        return validation(ModelValidationStatus::InvalidModel, model, Some(out.stderr));
    }
    if lower.contains("auth") {
        return validation(ModelValidationStatus::AuthError, model, Some(out.stderr));
    }
    validation(ModelValidationStatus::Unknown, model, Some(out.stderr))
}

/// V1 `AntigravityHealthCheck.ValidateModelAsync`.
///
/// A non-default model is probed for real rather than waved through. V1's comment on why is worth
/// keeping: the short-circuit it replaced "is why `tendril doctor` reported a healthy Antigravity
/// while every job launched against it died on an exhausted quota."
async fn antigravity_model(model: &str) -> ModelValidation {
    let mut args = vec![
        "--dangerously-skip-permissions".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--print-timeout".to_string(),
        "30s".to_string(),
    ];
    if let Some(explicit) = explicit_model(model) {
        args.push("--model".to_string());
        args.push(explicit.to_string());
        args.push("--effort".to_string());
        args.push("medium".to_string());
    }
    args.push("--print".to_string());
    args.push("reply with the single word OK".to_string());

    let out = run_probe("agy", &args, Duration::from_secs(30)).await;
    classify_antigravity_model(model, &out)
}

fn classify_antigravity_model(model: &str, out: &ProbeOutput) -> ModelValidation {
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }

    let combined = out.combined();
    let detail = [out.stderr.as_str(), out.stdout.as_str()]
        .into_iter()
        .map(str::trim)
        .find(|text| !text.is_empty())
        .map(str::to_string);

    match classify_provider_error(Some(&combined)) {
        ProviderErrorKind::Quota => {
            return validation(ModelValidationStatus::RateLimit, model, detail);
        }
        ProviderErrorKind::Auth => {
            return validation(ModelValidationStatus::AuthError, model, detail);
        }
        ProviderErrorKind::None => {}
    }

    let lower = combined.to_ascii_lowercase();
    if [
        "unknown model",
        "invalid model",
        "model not found",
        "unsupported model",
    ]
    .iter()
    .any(|term| lower.contains(term))
    {
        return validation(ModelValidationStatus::InvalidModel, model, detail);
    }

    // A clean exit still means the CLI did the work, even when it printed nothing this parser
    // recognises.
    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }

    validation(ModelValidationStatus::Unknown, model, detail)
}

/// V1 `OpenCodeHealthCheck.ValidateModelAsync`: only the default model can be validated, and the
/// refusal says so rather than pretending the model is fine.
async fn opencode_model(model: &str) -> ModelValidation {
    if explicit_model(model).is_some() {
        return validation(
            ModelValidationStatus::Unknown,
            model,
            Some("OpenCode does not support model validation for non-default models".to_string()),
        );
    }

    let binary = resolve_opencode_binary();
    let out = run_probe(
        &binary,
        &argv(&[], &["run", "ping"]),
        Duration::from_secs(30),
    )
    .await;
    if out.exit_code == 0 {
        return validation(ModelValidationStatus::Ok, model, None);
    }
    if out.timed_out() {
        return validation(ModelValidationStatus::Timeout, model, None);
    }
    match classify_provider_error(Some(&out.combined())) {
        ProviderErrorKind::Quota => validation(
            ModelValidationStatus::RateLimit,
            model,
            Some(out.stderr.clone()),
        ),
        _ => validation(ModelValidationStatus::Unknown, model, Some(out.stderr)),
    }
}

/// V1 `OpenAiProxyHealthCheck.ValidateModelAsync`, over onboarding's tester.
async fn proxy_model(model: &str, creds: &ProbeCredentials) -> ModelValidation {
    if creds.base_url.trim().is_empty() || creds.api_key.trim().is_empty() {
        return validation(
            ModelValidationStatus::AuthError,
            model,
            Some("Base URL or API key not configured.".to_string()),
        );
    }
    test_model_prompt(&creds.base_url, &creds.api_key, model).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(exit_code: i32, stdout: &str, stderr: &str) -> ProbeOutput {
        ProbeOutput {
            exit_code,
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
        }
    }

    /// Every card the Coding Agent pane offers must have a hint.
    ///
    /// The parity assertion. A new agent added to the catalog with no entry here renders a Help
    /// section with nothing in it, and nothing else on either side of the bridge would notice --
    /// the same failure mode `agent-roster-parity.test.ts` exists for on the TypeScript side.
    #[test]
    fn every_card_the_pane_offers_has_a_hint() {
        for card in SIGN_IN_HINT_CARDS {
            let hint = sign_in_hint(card)
                .unwrap_or_else(|| panic!("{card} is offered by the pane but has no hint"));
            assert_eq!(
                &hint.agent, card,
                "a hint must answer for the card asked for"
            );
        }
        assert_eq!(
            all_sign_in_hints().len(),
            SIGN_IN_HINT_CARDS.len(),
            "every listed card must resolve"
        );
    }

    /// An entry that exists but says nothing is a blank Help section by another route.
    ///
    /// Each half carries prose, and each carries either a route to run or a page to open. The one
    /// exception is a bring-your-own provider's install step, which is honest about having nothing
    /// to run and says so in the summary rather than inventing a command.
    #[test]
    fn every_hint_gives_both_halves_real_content() {
        for hint in all_sign_in_hints() {
            let agent = &hint.agent;
            assert!(
                hint.install.summary.len() > 20,
                "{agent} install summary is too thin to help"
            );
            assert!(
                hint.auth.summary.len() > 20,
                "{agent} auth summary is too thin to help"
            );
            assert!(
                !hint.auth.commands.is_empty() || hint.auth.url.is_some(),
                "{agent} auth names neither a command nor a console"
            );
            // A card with no binary is a bring-your-own provider, which has nothing to install.
            if hint.binary.is_some() {
                assert!(
                    !hint.install.commands.is_empty(),
                    "{agent} has a binary but no way to install it"
                );
            } else {
                assert!(
                    hint.install.commands.is_empty(),
                    "{agent} has no binary, so it must not offer an install command"
                );
            }
            for command in hint.install.commands.iter().chain(&hint.auth.commands) {
                assert!(
                    !command.command.trim().is_empty(),
                    "{agent} carries an empty command"
                );
                assert!(
                    !command.command.contains('\n'),
                    "{agent}: a command is one runnable line; a second route is its own entry: {}",
                    command.command
                );
            }
        }
    }

    /// No hint may name a command its CLI does not have.
    ///
    /// Three of these were carried over from V1 and all three were wrong, which is what makes this
    /// worth pinning rather than trusting. A hint that names a command that does not run is worse
    /// than no hint: it sends the operator to a dead end while the pane insists they are not
    /// authenticated.
    ///
    /// * `claude login` is not a subcommand. The CLI's top-level commands are `agents`, `attach`,
    ///   `auth`, `doctor`, `mcp`, `plugin` and friends, so a bare `login` is swallowed as the prompt
    ///   positional and the user is answered *about* signing in. Sign-in is `claude auth login`.
    /// * `gemini auth` is not a subcommand either -- the CLI's are `mcp`, `extensions`, `skills`,
    ///   `hooks` and `gemma`. Sign-in is the `/auth` slash command inside the session.
    /// * `copilot login` does not exist at all; GitHub's install page says an unauthenticated first
    ///   launch prompts for the `/login` slash command.
    #[test]
    fn hints_name_commands_the_clis_actually_have() {
        let auth_of = |agent: &str| sign_in_hint(agent).expect("a known agent").auth;

        let claude = auth_of("claude");
        assert!(
            claude.commands.iter().all(|c| c.command != "claude login"),
            "'claude login' is swallowed as a prompt; sign-in is 'claude auth login'"
        );
        assert!(
            claude
                .commands
                .iter()
                .any(|c| c.command == "claude auth login"),
            "the real sign-in command must be offered"
        );

        let gemini = auth_of("gemini");
        assert!(
            !gemini
                .commands
                .iter()
                .any(|c| c.command.contains("gemini auth")),
            "the Gemini CLI has no 'auth' subcommand"
        );
        assert!(
            gemini
                .commands
                .iter()
                .any(|c| c.command == "gemini" && c.then.as_deref() == Some("/auth")),
            "sign-in is the /auth slash command typed at a running 'gemini'"
        );
        assert!(
            gemini
                .commands
                .iter()
                .any(|c| c.command.contains("GEMINI_API_KEY")),
            "the key route stays offered"
        );

        let copilot = auth_of("copilot");
        assert!(
            !copilot
                .commands
                .iter()
                .any(|c| c.command.contains("copilot login")),
            "there is no 'copilot login' command"
        );
        // `gh auth login` authenticates the GitHub CLI, not Copilot -- following it leaves the user
        // exactly as unauthenticated as before.
        assert!(
            !copilot
                .commands
                .iter()
                .any(|c| c.command.contains("gh auth login")),
            "gh auth login is a different credential"
        );
        assert!(
            copilot
                .commands
                .iter()
                .any(|c| c.command == "copilot" && c.then.as_deref() == Some("/login")),
            "sign-in is the /login slash command typed at a running 'copilot'"
        );
        assert!(
            copilot
                .commands
                .iter()
                .any(|c| c.command.contains("COPILOT_GITHUB_TOKEN")),
            "the unattended route stays offered"
        );
    }

    /// The binary a hint names is the binary a launch spawns.
    ///
    /// `probe_binary` resolves `cursor` to `cursor-agent` and `antigravity` to `agy`, so this is the
    /// one fact the vendor's own docs cannot supply. Naming the wrong one sends someone to install a
    /// CLI Tendril never looks for and leaves the pane reporting it as missing.
    #[test]
    fn a_hint_names_the_binary_the_daemon_spawns() {
        for (agent, binary) in [
            ("claude", "claude"),
            ("codex", "codex"),
            ("gemini", "gemini"),
            ("copilot", "copilot"),
            ("antigravity", "agy"),
            ("cursor", "cursor-agent"),
            ("apple", "fm"),
            ("opencode", "opencode"),
        ] {
            let hint = sign_in_hint(agent).expect("a known agent");
            assert_eq!(
                hint.binary.as_deref(),
                Some(binary),
                "{agent} is launched as {binary}"
            );
        }

        // A bring-your-own card is a provider, not a CLI: there is no binary to find and no login to
        // run, so it offers the console that issues the key instead.
        for card in ["openaiproxy_card", "anthropic_card", "berget_card"] {
            let hint = sign_in_hint(card).expect("a known card");
            assert_eq!(hint.binary, None, "{card} is a provider, not a CLI");
            assert!(
                hint.auth.url.is_some(),
                "{card} must point at the console that issues its key"
            );
        }
    }

    /// pnpm-only is a repo rule, and a pane that prints `npm install -g` teaches every operator who
    /// reads it the opposite. Every one of these CLIs has a Homebrew formula or a vendor script, so
    /// the rule costs nothing to keep.
    #[test]
    fn no_hint_recommends_npm() {
        for hint in all_sign_in_hints() {
            for command in hint.install.commands.iter().chain(&hint.auth.commands) {
                assert!(
                    !command.command.split_whitespace().any(|word| word == "npm"),
                    "{} names npm: {}",
                    hint.agent,
                    command.command
                );
            }
        }
    }

    /// Homebrew rejects `brew install <cask>` outright, so the cask/formula split is the difference
    /// between a command that works and one that errors in the operator's face. It is also invisible
    /// on a machine that already has the CLI, which is how three of these shipped wrong.
    ///
    /// Verified against `brew info` on 2026-09-21: claude-code, codex and copilot-cli are casks;
    /// gemini-cli is a formula (deprecated upstream, disabling 2026-12-18) and must NOT take --cask.
    #[test]
    fn brew_lines_split_casks_from_formulae() {
        const CASKS: &[&str] = &["claude-code", "codex", "copilot-cli"];
        const FORMULAE: &[&str] = &["gemini-cli"];

        let mut seen = 0;
        for hint in all_sign_in_hints() {
            for command in hint.install.commands.iter().chain(&hint.auth.commands) {
                let line = &command.command;
                if !line.contains("brew install") {
                    continue;
                }
                seen += 1;
                let words: Vec<&str> = line.split_whitespace().collect();
                for cask in CASKS {
                    if words.contains(cask) {
                        assert!(
                            line.contains("--cask"),
                            "{}: {cask} is a cask, not a formula: {line}",
                            hint.agent
                        );
                    }
                }
                for formula in FORMULAE {
                    if words.contains(formula) {
                        assert!(
                            !line.contains("--cask"),
                            "{}: {formula} is a formula, not a cask: {line}",
                            hint.agent
                        );
                    }
                }
            }
        }
        // Guard the guard: a refactor that drops every brew line must not leave this vacuously green.
        assert!(seen > 0, "no brew lines were checked");
    }

    /// A failed auth probe carries the hint for the agent that was probed, not a sentence.
    ///
    /// This is the join the whole shape exists for: the Test Agent dialog's failure row and the
    /// settings pane's Help section read the same entry, so a corrected install script moves both.
    #[test]
    fn a_signed_out_result_carries_that_agents_hint() {
        let result = AgentAuthResult::signed_out(AuthStatus::NotAuthenticated, "nope", "claude");
        let hint = result.sign_in_hint.expect("a signed-out result hints");
        assert_eq!(hint.agent, "claude");
        assert_eq!(hint.binary.as_deref(), Some("claude"));

        // A check that broke is not a user who is signed out: there is nothing to tell them to run.
        let broken = AgentAuthResult::failed(AuthStatus::CheckFailed, "boom");
        assert_eq!(broken.sign_in_hint, None);
    }

    /// Every proxy spelling resolves onto the generic OpenAI-compatible card, and an id that names
    /// no agent gets no invented help.
    #[test]
    fn proxy_ids_resolve_and_unknown_ids_do_not() {
        for id in ["openaiproxy", "ivy", "proxy"] {
            let hint = sign_in_hint(id).unwrap_or_else(|| panic!("{id} is a proxy spelling"));
            assert_eq!(hint.agent, "openaiproxy_card");
        }
        // `claudecode` is `normalize_agent_name`'s alias for `claude`.
        assert_eq!(
            sign_in_hint("claudecode").map(|hint| hint.agent),
            Some("claude".to_string())
        );
        assert_eq!(sign_in_hint("not-an-agent"), None);
    }

    /// The probe must ask `fm` a question it answers. `--version` exits 64 with nothing on stdout,
    /// which reads as an uninstalled CLI, so a machine with a working Apple install would be told
    /// its install is broken.
    #[test]
    fn apple_is_probed_with_the_argument_fm_actually_answers() {
        assert_eq!(version_arg_for("apple"), "available");
        assert_eq!(version_arg_for("claude"), "--version");
    }

    /// Apple's prerequisite is `fm`, not the OpenCode it is launched through. Resolving the
    /// delegate would report a healthy install on a machine with no `fm` at all -- the same
    /// confusion `health::doctor_probe_target` exists to prevent, and this is the other half of it.
    #[test]
    fn apples_probe_binary_is_fm_not_the_cli_it_delegates_to() {
        let (binary, prefix) = probe_binary("apple");
        assert_eq!(binary, "fm");
        assert!(prefix.is_empty());
        assert_ne!(binary, resolve_opencode_binary());
    }

    /// Two ids for one model: OpenCode is addressed as `apple/system`, `fm serve` as `system`.
    /// Collapsing them in either direction breaks one of the two callers.
    #[test]
    fn the_wire_id_and_the_catalog_id_are_not_the_same_string() {
        assert_eq!(APPLE_MODEL_ID, "apple/system");
        assert_eq!(APPLE_WIRE_MODEL_ID, "system");
        assert!(APPLE_MODEL_ID.ends_with(APPLE_WIRE_MODEL_ID));
    }

    /// A model the launch cannot send is refused without a request. `build_apple_spec` overwrites
    /// the caller's model with the pinned one, so probing what was asked for would answer a
    /// question about a request that never goes out -- and it is refused locally, so this needs no
    /// server and runs in CI.
    #[tokio::test]
    async fn a_model_apple_cannot_launch_is_refused_without_asking_the_server() {
        let result = apple_model("gpt-5.6-sol").await;
        assert_eq!(result.status, ModelValidationStatus::InvalidModel);
        assert_eq!(
            result.model, "gpt-5.6-sol",
            "reported under the id asked for"
        );
        assert!(
            result
                .error_message
                .as_deref()
                .unwrap_or_default()
                .contains(APPLE_MODEL_ID),
            "the message should name the one model that does work: {result:?}"
        );
    }

    #[test]
    fn quota_is_classified_before_auth() {
        // V1's stated reason for the order: a 429 that also mentions oauth is a quota wall.
        assert_eq!(
            classify_provider_error(Some("429 too many requests (oauth token ok)")),
            ProviderErrorKind::Quota
        );
        assert_eq!(
            classify_provider_error(Some("you are not logged into this account")),
            ProviderErrorKind::Auth
        );
        assert_eq!(classify_provider_error(Some("  ")), ProviderErrorKind::None);
        assert_eq!(classify_provider_error(None), ProviderErrorKind::None);
    }

    #[test]
    fn the_symbolic_code_wins_over_the_numeric_one() {
        assert_eq!(
            extract_provider_code("RESOURCE_EXHAUSTED (code 429)").as_deref(),
            Some("RESOURCE_EXHAUSTED")
        );
        assert_eq!(
            extract_provider_code("HTTP 503 from upstream").as_deref(),
            Some("503")
        );
        // Not every three-digit number is a status code.
        assert_eq!(extract_provider_code("read 512 bytes"), None);
    }

    #[test]
    fn only_a_quota_wall_is_worth_retrying() {
        assert!(is_retryable(ProviderErrorKind::Quota));
        assert!(!is_retryable(ProviderErrorKind::Auth));
        assert_eq!(
            describe_provider_error(ProviderErrorKind::Auth),
            "provider authentication failed"
        );
    }

    #[test]
    fn claude_maps_bedrock_retention_to_an_invalid_model() {
        let result = classify_claude_model(
            "claude-opus-5",
            &out(1, "", "Model requires data retention mode aws_review"),
        );
        assert_eq!(result.status, ModelValidationStatus::InvalidModel);
        assert!(result.error_message.unwrap().contains("aws_review"));
    }

    #[test]
    fn claude_needs_both_halves_of_the_invalid_model_phrase() {
        assert_eq!(
            classify_claude_model("x", &out(1, "", "model 'x' not found")).status,
            ModelValidationStatus::InvalidModel
        );
        // "not found" without "model" is not a model complaint.
        assert_eq!(
            classify_claude_model("x", &out(1, "", "config file not found")).status,
            ModelValidationStatus::Unknown
        );
    }

    #[test]
    fn claude_reports_a_quota_wall_rather_than_an_auth_failure() {
        // The message says both; only one of them is actionable advice.
        let result = classify_claude_model(
            "claude-opus-5",
            &out(
                1,
                "",
                "429 rate limit exceeded; re-authenticate if this persists",
            ),
        );
        assert_eq!(result.status, ModelValidationStatus::RateLimit);
    }

    #[test]
    fn claude_keeps_the_whole_output_when_nothing_matches() {
        let result = classify_claude_model("x", &out(7, "some stdout", "some stderr"));
        assert_eq!(result.status, ModelValidationStatus::Unknown);
        let message = result.error_message.unwrap();
        assert!(message.contains("exit=7"));
        assert!(message.contains("stdout: some stdout"));
        assert!(message.contains("stderr: some stderr"));
    }

    /// The single most surprising rule in this module, and the one a refactor would most likely
    /// "fix": Codex's probe blocks on stdin, so being killed for time is the success case.
    #[test]
    fn a_codex_timeout_means_the_model_was_accepted() {
        assert_eq!(
            classify_codex_model("gpt-5.6-sol", &out(-1, "", TIMED_OUT)).status,
            ModelValidationStatus::Ok
        );
        assert_eq!(
            classify_codex_model("gpt-5.6-sol", &out(0, "", "")).status,
            ModelValidationStatus::Ok
        );
        assert_eq!(
            classify_codex_model("nope", &out(1, "", "invalid model 'nope'")).status,
            ModelValidationStatus::InvalidModel
        );
    }

    /// The other half of that rule, and the one that actually fires: `run_probe` closes stdin, so
    /// codex never reaches the wait the timeout branch was written for. It asks for the prompt and
    /// exits 1, and taking that at face value failed every model on the list -- issue #220.
    #[test]
    fn a_codex_prompt_complaint_also_means_the_model_was_accepted() {
        let result =
            classify_codex_model("gpt-5.6-sol", &out(1, "", "No prompt provided via stdin."));
        assert_eq!(result.status, ModelValidationStatus::Ok);
        assert_eq!(result.error_message, None);
    }

    /// Codex prints it on stderr today, but the classifiers all read both streams, and a `--json`
    /// run putting it on stdout must not read as a failure either.
    #[test]
    fn the_codex_prompt_complaint_is_read_off_either_stream() {
        assert_eq!(
            classify_codex_model("gpt-5.6-sol", &out(1, "No prompt provided via stdin.", ""))
                .status,
            ModelValidationStatus::Ok
        );
        assert_eq!(
            classify_codex_model("gpt-5.6-sol", &out(1, "", "NO PROMPT PROVIDED VIA STDIN")).status,
            ModelValidationStatus::Ok
        );
    }

    /// The success branch is ahead of the error classification, so it has to be the narrower of the
    /// two: a run that got far enough to fail for a real reason still reports that reason.
    #[test]
    fn a_real_codex_failure_still_beats_the_prompt_complaint() {
        assert_eq!(
            classify_codex_model("nope", &out(1, "", "model 'nope' not supported")).status,
            ModelValidationStatus::InvalidModel
        );
        assert_eq!(
            classify_codex_model("gpt-5.6-sol", &out(1, "", "429 rate limit exceeded")).status,
            ModelValidationStatus::RateLimit
        );
        assert_eq!(
            classify_codex_model("gpt-5.6-sol", &out(1, "", "unauthorized")).status,
            ModelValidationStatus::AuthError
        );
        // The flag defect itself: a rejected argument is not a verdict on the model.
        assert_eq!(
            classify_codex_model(
                "gpt-5.6-sol",
                &out(2, "", "error: unexpected argument '--full-auto' found")
            )
            .status,
            ModelValidationStatus::Unknown
        );
    }

    /// `--full-auto` is gone from codex-cli 0.153.0, which refuses to parse it at all. The probe
    /// never runs a model-generated command, so it asks for the sandbox that allows none.
    #[test]
    fn the_codex_probe_names_a_sandbox_the_current_cli_accepts() {
        let args = codex_probe_args("gpt-5.6-sol");
        assert!(!args.iter().any(|arg| arg == "--full-auto"));
        let sandbox = args.iter().position(|arg| arg == "-s").expect("-s");
        assert_eq!(args[sandbox + 1], "read-only");
        // Still the stdin form the whole classification depends on.
        assert_eq!(args.last().unwrap(), "-");
    }

    #[test]
    fn antigravity_accepts_a_clean_exit_it_could_not_parse() {
        assert_eq!(
            classify_antigravity_model("gemini-3", &out(0, "OK", "")).status,
            ModelValidationStatus::Ok
        );
        assert_eq!(
            classify_antigravity_model("gemini-3", &out(-1, "", TIMED_OUT)).status,
            ModelValidationStatus::Timeout
        );
        assert_eq!(
            classify_antigravity_model("gemini-3", &out(1, "", "RESOURCE_EXHAUSTED")).status,
            ModelValidationStatus::RateLimit
        );
        assert_eq!(
            classify_antigravity_model("bogus", &out(1, "", "unknown model bogus")).status,
            ModelValidationStatus::InvalidModel
        );
    }

    #[test]
    fn the_opencode_counts_survive_a_coloured_table() {
        let coloured =
            "\x1b[1mopencode\x1b[0m\n\n  \x1b[32m2 credentials\x1b[0m\n  0 environment variables\n";
        assert_eq!(parse_opencode_auth_list(coloured), Some("auth-file"));
        // Environment wins when both are present, as in V1.
        assert_eq!(
            parse_opencode_auth_list("3 credentials\n1 environment variable"),
            Some("environment")
        );
        assert_eq!(
            parse_opencode_auth_list("0 credentials\n0 environment variables"),
            None
        );
        assert_eq!(parse_opencode_auth_list("nothing here"), None);
    }

    #[test]
    fn a_google_accounts_file_needs_a_named_active_account() {
        assert!(has_active_account(r#"{"active": "me@example.com"}"#));
        assert!(!has_active_account(r#"{"active": ""}"#));
        assert!(!has_active_account("{}"));
    }

    #[test]
    fn the_gemini_candidates_cover_both_layouts() {
        let candidates = gemini_credential_candidates(Path::new("/home/u"));
        assert!(candidates.contains(&PathBuf::from("/home/u/.gemini/oauth_creds.json")));
        assert!(candidates.contains(&PathBuf::from("/home/u/.gemini/config/settings.json")));
        assert!(candidates.contains(&PathBuf::from("/home/u/.gemini/config/config.json")));
        assert_eq!(candidates.len(), 7);
    }

    #[test]
    fn default_and_blank_are_not_model_ids() {
        assert_eq!(explicit_model("  "), None);
        assert_eq!(explicit_model("Default"), None);
        assert_eq!(explicit_model(" opus "), Some("opus"));
    }

    #[tokio::test]
    async fn a_probe_that_outlives_its_deadline_reports_the_sentinel() {
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        let args: Vec<String> = if cfg!(windows) {
            vec!["/c".to_string(), "ping -n 30 127.0.0.1 > nul".to_string()]
        } else {
            vec!["-c".to_string(), "sleep 30".to_string()]
        };
        let out = run_probe(shell, &args, Duration::from_millis(250)).await;
        assert!(out.timed_out(), "{out:?}");
    }

    #[tokio::test]
    async fn a_probe_reports_a_missing_binary_rather_than_panicking() {
        let out = run_probe("tendril-no-such-binary-4c1f", &[], Duration::from_secs(5)).await;
        assert_eq!(out.exit_code, -1);
        assert!(out.stderr.starts_with("Failed to start process"), "{out:?}");
    }

    #[tokio::test]
    async fn a_probe_collects_both_streams() {
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        let args: Vec<String> = if cfg!(windows) {
            vec![
                "/c".to_string(),
                "echo out & echo err 1>&2 & exit 3".to_string(),
            ]
        } else {
            vec![
                "-c".to_string(),
                "echo out; echo err >&2; exit 3".to_string(),
            ]
        };
        let out = run_probe(shell, &args, Duration::from_secs(10)).await;
        assert_eq!(out.exit_code, 3);
        assert!(out.stdout.contains("out"), "{out:?}");
        assert!(out.stderr.contains("err"), "{out:?}");
    }

    #[tokio::test]
    async fn a_missing_cli_is_reported_as_not_installed() {
        let status = check_install("tendril-no-such-agent-8a2b").await;
        assert!(!status.is_installed);
        assert!(status.error.unwrap().contains("not found on PATH"));
    }

    #[tokio::test]
    async fn a_proxy_without_credentials_never_reaches_the_network() {
        let result = check_auth("openaiproxy", &ProbeCredentials::default()).await;
        assert_eq!(result.status, AuthStatus::NotAuthenticated);
        assert_eq!(result.error.as_deref(), Some("Base URL is not configured."));

        let no_key = check_auth(
            "ivy",
            &ProbeCredentials {
                base_url: "https://example.invalid/v1".to_string(),
                api_key: String::new(),
            },
        )
        .await;
        assert_eq!(no_key.error.as_deref(), Some("API Key is not configured."));
    }

    #[tokio::test]
    async fn gemini_declines_to_validate_a_model_without_launching_anything() {
        let result =
            validate_model("gemini", "gemini-3.8-flash", &ProbeCredentials::default()).await;
        assert_eq!(result.status, ModelValidationStatus::Ok);
        assert_eq!(result.model, "gemini-3.8-flash");
    }

    #[tokio::test]
    async fn an_unknown_agent_is_refused_rather_than_probed() {
        let result = validate_model("nope", "m", &ProbeCredentials::default()).await;
        assert_eq!(result.status, ModelValidationStatus::Unknown);
        assert!(result.error_message.unwrap().contains("No model probe"));
    }
}
