import { BYO_CARDS, CODING_AGENTS } from "./codingAgents";

/**
 * How to install and sign in to each card the Coding Agent pane offers.
 *
 * There is no V1 original for this: `Apps/Settings/CodingAgentSetupView.cs` selects an agent and says
 * nothing about getting one, and the only install guidance anywhere in V1 is the per-agent
 * `SignInHint` the probe returns *after* a failed auth check. That hint arrives too late to be
 * useful - the operator has already picked an agent, saved, and run something - so this table is the
 * same knowledge moved in front of the failure.
 *
 * Two rules govern every entry, and both exist because a wrong one is worse than none:
 *
 * 1. **The binary named here is the binary a launch spawns.** `agents/probe.rs:351` (`probe_binary`)
 *    and the `command` fields in `agents/providers.rs` are the authority, not the vendor's own
 *    marketing name. So Antigravity is `agy` (`probe.rs:363`), Cursor is `cursor-agent` and not
 *    `cursor`, which is the editor (`providers.rs:2138`), Copilot is `copilot` with `gh copilot` as
 *    the fallback (`providers.rs:2057`), and Apple is `fm` rather than the OpenCode it delegates
 *    through (`probe.rs:358`). Telling someone to install a binary Tendril never looks for would send
 *    them away and leave the pane just as broken.
 *
 * 2. **No `npm install -g` anywhere.** Every one of these CLIs also publishes an npm package, and
 *    every one of them publishes a Homebrew formula or a vendor install script that does not need
 *    Node at all. This repo's own rule is pnpm-only, and a settings pane that hands out npm commands
 *    reads as an endorsement of a package manager the project does not use. The forms chosen are the
 *    vendor's own first-listed install path in each case, so nothing is lost by the substitution.
 *
 * Commands were verified against the vendor's documentation and, where the CLI is installed on a
 * development machine, against its own `--help`. Two of the hints in `probe.rs` are already stale and
 * are deliberately *not* copied here: `gemini auth` is not a subcommand the Gemini CLI has (its
 * commands are `mcp`, `extensions`, `skills`, `hooks` and `gemma`), and Copilot has no
 * `copilot login` - GitHub's own install page says an unauthenticated first launch prompts for the
 * `/login` slash command.
 *
 * That divergence is the one wart in this file: `probe.rs` keeps its own copy of these strings in
 * `sign_in_hint`, so the same knowledge now lives twice and the two copies already disagree. A
 * shared source of truth - the probe returning a structured hint this table renders, rather than
 * each side spelling its own - is the right shape, but it would mean editing `probe.rs`, which is
 * another agent's file while its stale hints are being fixed.
 *
 * The `brew` forms are load-bearing and are pinned by a test. Homebrew rejects `brew install <cask>`
 * outright, so the cask/formula split decides whether the line runs at all: `claude-code`, `codex`
 * and `copilot-cli` are casks and take `--cask`; `gemini-cli` is a formula and must not.
 */
export interface AgentHelpStep {
  /** Why the command below is the one to run, or - where there is no command - what to do instead. */
  summary: string;
  /**
   * The shell to show, or omitted when honesty requires saying there is nothing to run. Multi-line
   * where a second, equally official route is worth having: the alternative goes in a `#` comment so
   * the block still copies as runnable shell.
   */
  command?: string;
  /**
   * A page to open rather than a command to run - the console where a BYO provider's key is created.
   * Kept separate from `command` because the two render differently: a command is a copyable block, a
   * URL is a button that opens a browser, and a URL shown as shell invites someone to paste it into
   * one.
   */
  url?: string;
}

export interface AgentHelp {
  /**
   * What `probe_binary` looks for, so "installed" in this pane and "installed" on disk mean the same
   * thing. `null` for the three bring-your-own cards, which are providers rather than CLIs.
   */
  binary: string | null;
  install: AgentHelpStep;
  auth: AgentHelpStep;
}

/**
 * Keyed by **card**, not by resolved agent id.
 *
 * `resolveFinalAgent` collapses all three BYO cards onto `openaiproxy` (or `ivy`), so an id-keyed
 * table would hand the Anthropic card OpenAI's console link. The card is what the operator clicked
 * and what the help has to answer for.
 */
export const AGENT_HELP: Record<string, AgentHelp> = {
  claude: {
    binary: "claude",
    install: {
      summary:
        "The native installer puts `claude` in ~/.local/bin and keeps it updated in the background.",
      command:
        "curl -fsSL https://claude.ai/install.sh | bash\n# or: brew install --cask claude-code",
    },
    auth: {
      summary:
        "Opens a browser and signs in to your Anthropic account. Claude Code needs a Pro, Max, Team, Enterprise or Console plan - the free claude.ai plan does not include it.",
      command: "claude auth login",
    },
  },

  copilot: {
    binary: "copilot",
    install: {
      // `resolve_copilot_binary` (`providers.rs:2057`) prefers a standalone `copilot` and only then
      // falls back to `gh copilot`, so the standalone CLI is what to install - but an operator who
      // already has the GitHub CLI is not broken, and saying so saves a redundant install.
      summary:
        "Installs the standalone `copilot` binary. An existing GitHub CLI also works: Tendril falls back to `gh copilot` when nothing named `copilot` is on PATH.",
      command:
        "curl -fsSL https://gh.io/copilot-install | bash\n# or: brew install --cask copilot-cli",
    },
    auth: {
      // The `copilot login` in `probe.rs`'s sign-in hint does not exist. Authentication is a slash
      // command inside the TUI, which is why the block below is two lines rather than one command.
      summary:
        "Copilot has no login subcommand - start it and run the `/login` slash command. For an unattended machine, put a fine-grained token carrying the `Copilot Requests` permission in `GH_TOKEN` instead.",
      command: "copilot\n# then, at the prompt: /login",
    },
  },

  codex: {
    binary: "codex",
    install: {
      summary: "Installs `codex` to ~/.local/bin.",
      command:
        "curl -fsSL https://chatgpt.com/codex/install.sh | sh\n# or: brew install --cask codex",
    },
    auth: {
      summary:
        "Signs in with ChatGPT through the browser. `--with-api-key` reads an OpenAI platform key from stdin instead, which is the route for a headless machine.",
      command: "codex login\n# or: printenv OPENAI_API_KEY | codex login --with-api-key",
    },
  },

  gemini: {
    binary: "gemini",
    install: {
      summary:
        "Installs the `gemini` binary. The Homebrew formula is deprecated upstream and is scheduled to be disabled on 2026-12-18, so it still installs today but will not forever; MacPorts carries the same CLI under the same name.",
      command: "brew install gemini-cli\n# or: sudo port install gemini-cli",
    },
    auth: {
      // `gemini auth` is not a subcommand - the CLI's are `mcp`, `extensions`, `skills`, `hooks` and
      // `gemma`, so it is swallowed and nobody is signed in. `/auth` is a built-in slash command
      // inside the session (subcommands `login` and `logout`, defaulting to login), which is why the
      // block names the binary and the thing to type at it on separate lines.
      summary:
        "There is no `gemini auth` subcommand. The first run offers `Sign in with Google`, and `/auth` re-runs that choice later; a key from aistudio.google.com/apikey skips the browser entirely.",
      command: "gemini\n# then, at the prompt: /auth\n# or: export GEMINI_API_KEY=...",
    },
  },

  antigravity: {
    binary: "agy",
    install: {
      summary:
        "Installs `agy` to ~/.local/bin. That is the binary Tendril launches - there is nothing named `antigravity` to install.",
      command: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    },
    auth: {
      summary:
        "No login subcommand either: the first run signs in through the browser and stores the credential in the system keyring.",
      command: "agy",
    },
  },

  opencode: {
    // `resolve_opencode_binary` (`providers.rs:2086`) prefers the sidecar next to the app over
    // anything on PATH, and `tauri.conf.json:34` ships it as `binaries/opencode`, so the honest
    // answer to "how do I install this" is that it is already installed.
    binary: "opencode",
    install: {
      summary:
        "Nothing to install. Tendril ships OpenCode as a sidecar beside the app and prefers it over any copy on PATH, so this agent works on a fresh install. Install your own only to run a different version.",
      command: "curl -fsSL https://opencode.ai/install | bash",
    },
    auth: {
      summary:
        "OpenCode has no account of its own - it stores a credential for whichever provider you pick. `opencode auth login` is an alias for the same command.",
      command: "opencode providers login",
    },
  },

  cursor: {
    binary: "cursor-agent",
    install: {
      summary:
        "The installer symlinks both `agent` and `cursor-agent` into ~/.local/bin. Tendril launches `cursor-agent`; `cursor` is the editor, not the CLI.",
      command: "curl https://cursor.com/install -fsS | bash",
    },
    auth: {
      summary:
        "Opens a browser; `cursor-agent status` then reports who is signed in. A key from the Cursor dashboard in `CURSOR_API_KEY` works without one.",
      command: "cursor-agent login",
    },
  },

  apple: {
    binary: "fm",
    install: {
      // `probe_binary` resolves `apple` to `fm` rather than to the OpenCode it is launched through,
      // precisely so a Mac with no `fm` reports the thing that is actually missing (`probe.rs:355`).
      summary:
        "Nothing to install: `fm` ships with macOS at /usr/bin/fm. What varies is whether this Mac has the on-device model at all, which `fm available` answers.",
      command: "fm available",
    },
    auth: {
      // `APPLE_SERVE_HINT` (`probe.rs:915`) is the same sentence the auth and model probes return
      // when the local server is not answering, so the pane and the failure say one thing.
      summary:
        "No account and no key - the model runs on this Mac. Tendril reaches it over a local Chat Completions server, which has to be running.",
      command: "fm serve",
    },
  },

  /* ------------------------------------------------------------------ bring your own LLM
   *
   * All three run through the same bundled OpenCode, so none of them has an install step; what an
   * operator actually needs is where the key comes from and what Save does with it. The variable
   * names are `byoEnvironment`'s, not a guess: it writes the key to **both** spellings because the
   * proxy may be reached by either SDK, and splits the URL into the bare host for Anthropic and the
   * `/v1` form for OpenAI. */

  openaiproxy_card: {
    binary: null,
    install: {
      summary:
        "Nothing to install. Bring-your-own providers run through the OpenCode sidecar that ships with Tendril.",
    },
    auth: {
      summary:
        "Create a key, paste it into API Key above, and Save. It is written to the `openaiproxy` entry as both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`, with the base URL in `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`.",
      url: "https://platform.openai.com/api-keys",
    },
  },

  anthropic_card: {
    binary: null,
    install: {
      summary:
        "Nothing to install. Bring-your-own providers run through the OpenCode sidecar that ships with Tendril.",
    },
    auth: {
      summary:
        "Create a key, paste it into API Key above, and Save. The default base URL is https://api.anthropic.com/v1; Save stores it as `ANTHROPIC_BASE_URL` without the `/v1` and `OPENAI_BASE_URL` with it, because the two SDKs disagree about where the version segment belongs.",
      url: "https://console.anthropic.com/settings/keys",
    },
  },

  berget_card: {
    binary: null,
    install: {
      summary:
        "Nothing to install. Berget is an OpenAI-compatible endpoint, reached through the OpenCode sidecar that ships with Tendril.",
    },
    auth: {
      // The missing URL field above is not an oversight: `withByoCredentials` forces this card back
      // onto `api.berget.ai`, so there is nothing for the operator to choose.
      summary:
        "Create a key in the Berget console, paste it into API Key above, and Save. There is no base URL to set: this card is pinned to https://api.berget.ai/v1.",
      url: "https://console.berget.ai",
    },
  },
};

/** The card's own label, so the help reads as being about the thing that was clicked. */
export const cardLabel = (card: string): string =>
  CODING_AGENTS.find((agent) => agent.id === card)?.label ??
  BYO_CARDS.find((byo) => byo.key === card)?.label ??
  card;

/**
 * Undefined for a `codingAgent` value that is not a card at all - `initialCard` passes through
 * whatever normalised id it was given, and an unrecognised one already raises the
 * `unknownAgentMessage` callout at the top of the pane. Help for an agent that does not exist would
 * be invented, so there is none.
 */
export const helpForCard = (card: string): AgentHelp | undefined => AGENT_HELP[card];
