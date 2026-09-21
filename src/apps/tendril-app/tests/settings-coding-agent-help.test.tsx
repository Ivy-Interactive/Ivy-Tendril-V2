import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import { agentsApi } from "../src/api/agentsApi";
import { BYO_CARDS, CODING_AGENTS } from "../src/views/settings/codingAgents";
import type { AgentOption, AgentSignInHint } from "../src/types/agents";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * The Help block under the Coding Agent pane: install and sign-in instructions for the card in front
 * of the operator.
 *
 * **The instructions themselves are not this file's to check.** They come from the daemon, over
 * `GET /api/agents/hints`, and `probe.rs`'s own tests pin their content - that every card has an
 * entry, that no hint recommends npm, that the `brew` cask/formula split is right, that no hint
 * names a command its CLI does not have. That used to be checked here too, against a second copy of
 * the same prose kept in `agentHelp.ts`, and the two copies drifted: the pane said
 * `claude auth login` while the probe said `claude login`, which the Claude CLI swallows as a prompt
 * positional. One owner, one set of assertions.
 *
 * What is left here is what this side actually owns: that the block renders, that it renders *this*
 * card's hint and not the last card's - the only way a help panel can be actively harmful - that
 * every shape the daemon can send has a rendering, and that the card list the daemon serves and the
 * card list the pane offers are the same list.
 */

const baseConfig: TendrilConfig = {
  codingAgent: "claude",
  jobTimeout: 30,
  maxConcurrentJobs: 20,
  raw: { staleOutputTimeout: 10, beta: false, themeMode: "system" },
};

const serviceInfo: ServiceInfo = {
  state: "Connected",
  tendrilHome: "/home/user/.tendril",
  port: 5010,
  host: "127.0.0.1",
  ownership: "Managed",
  statusBadge: "Connected (Managed)",
  capabilities: ["plans"],
  message: "Online",
};

/** The pane needs a catalogue to render its profile selects; which models are in it is irrelevant here. */
const CATALOG: AgentOption[] = [
  {
    id: "claude",
    label: "Claude",
    models: [{ id: "claude-opus-5", displayName: "Claude Opus 5" }],
    defaultModel: "claude-opus-5",
    supportsEffort: true,
    efforts: [{ id: "default", displayName: "Default" }],
  },
];

/**
 * A stand-in for what the daemon serves, covering each shape it can send rather than each card:
 * a plain CLI, a CLI whose sign-in is a slash command typed at a running TUI, a binary the vendor
 * does not name, and a provider with a console instead of a login.
 */
const HINTS: AgentSignInHint[] = [
  {
    agent: "claude",
    binary: "claude",
    install: {
      summary: "The native installer puts `claude` in ~/.local/bin.",
      commands: [
        { command: "curl -fsSL https://claude.ai/install.sh | bash" },
        { command: "brew install --cask claude-code" },
      ],
    },
    auth: {
      summary: "Opens a browser and signs in to your Anthropic account.",
      commands: [{ command: "claude auth login" }],
    },
  },
  {
    agent: "codex",
    binary: "codex",
    install: { summary: "Installs `codex`.", commands: [{ command: "brew install --cask codex" }] },
    auth: { summary: "Signs in with ChatGPT.", commands: [{ command: "codex login" }] },
  },
  {
    agent: "copilot",
    binary: "copilot",
    install: {
      summary: "Installs the standalone binary.",
      commands: [{ command: "brew install --cask copilot-cli" }],
    },
    auth: {
      summary: "Copilot has no login subcommand.",
      // `then` is the daemon's field name for the slash command typed at the prompt, so the object
      // reads as thenable to the linter. It is never awaited - it is wire data, not a promise.
      // eslint-disable-next-line unicorn/no-thenable
      commands: [{ command: "copilot", then: "/login" }],
    },
  },
  {
    agent: "cursor",
    binary: "cursor-agent",
    install: {
      summary: "Symlinks `cursor-agent` into ~/.local/bin.",
      commands: [{ command: "curl https://cursor.com/install -fsS | bash" }],
    },
    auth: { summary: "Opens a browser.", commands: [{ command: "cursor-agent login" }] },
  },
  {
    agent: "antigravity",
    binary: "agy",
    install: {
      summary: "Installs `agy` to ~/.local/bin.",
      commands: [{ command: "curl -fsSL https://antigravity.google/cli/install.sh | bash" }],
    },
    auth: { summary: "The first run signs in.", commands: [{ command: "agy" }] },
  },
  {
    agent: "anthropic_card",
    install: { summary: "Nothing to install.", commands: [] },
    auth: {
      summary: "Create a key, paste it into API Key above, and Save.",
      commands: [],
      url: "https://console.anthropic.com/settings/keys",
    },
  },
];

const hintFor = (agent: string): AgentSignInHint => {
  const hint = HINTS.find((h) => h.agent === agent);
  if (!hint) throw new Error(`No fixture hint for ${agent}`);
  return hint;
};

const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

async function renderSettings() {
  await act(async () => {
    render(
      <SettingsView
        serviceInfo={serviceInfo}
        onRefreshHealth={vi.fn()}
        initialSection="coding-agent"
      />,
    );
  });
}

const clickCard = async (id: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`coding-agent-${id}`));
  });
};

const helpText = () => screen.getByTestId("agent-help-block").textContent ?? "";

describe("Settings / Coding Agent / Help", () => {
  beforeEach(() => {
    openUrl.mockClear();
    vi.spyOn(bridge, "getConfig").mockResolvedValue({ ...baseConfig });
    vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    vi.spyOn(bridge, "getModelsStatus").mockResolvedValue({
      source: "static",
      totalModelCount: 0,
      dynamicModelCount: 0,
      staticModelCount: 0,
      enrichModels: false,
      cachedAt: null,
      cachePath: "/home/user/.tendril/models.json",
    });
    vi.spyOn(agentsApi, "listAgents").mockResolvedValue(CATALOG);
    vi.spyOn(agentsApi, "getHints").mockResolvedValue(HINTS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Below the last section, which is Extra Arguments & Environment. Asserted by position rather than
   * by presence alone: the whole request was for help *beneath* the settings it is not part of, and a
   * block that drifted above the agent grid would still pass a bare `toBeInTheDocument`.
   */
  it("renders beneath the last settings section for the selected agent", async () => {
    await renderSettings();

    const help = screen.getByTestId("agent-help-block");
    expect(within(help).getByText("Help")).toBeInTheDocument();

    const environment = screen.getByTestId("agent-environment-block");
    expect(
      environment.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /** The saved agent is `claude`, so that is the card selected on open and the help that shows. */
  it("renders the daemon's hint for the selected agent", async () => {
    await renderSettings();

    expect(screen.getByTestId("agent-help-claude")).toBeInTheDocument();
    const claude = hintFor("claude");
    expect(helpText()).toContain(claude.install.summary);
    expect(helpText()).toContain(claude.install.commands[0].command);
    expect(helpText()).toContain(claude.auth.commands[0].command);
  });

  /**
   * Every documented route reaches the DOM, not just the first. The daemon sends them as separate
   * commands rather than one newline-joined blob precisely so each copies as runnable shell, and a
   * renderer that showed only `commands[0]` would quietly drop the Homebrew line and the headless
   * route on half these cards.
   */
  it("renders the alternative routes, not only the first", async () => {
    await renderSettings();

    for (const route of hintFor("claude").install.commands) {
      expect(helpText()).toContain(route.command);
    }
  });

  /**
   * Three of these CLIs have no sign-in subcommand: sign-in is a slash command typed at a running
   * TUI. That is why the hint keeps `then` apart from `command` - rendering them as one line would
   * produce `copilot /login`, which is a prompt, not a login - so the renderer has to keep them
   * apart too.
   */
  it("shows a slash-command sign-in as something to type at the prompt, not as shell", async () => {
    await renderSettings();
    await clickCard("copilot");

    const block = screen.getByTestId("agent-help-auth");
    expect(within(block).getByTestId("agent-help-auth-then").textContent).toContain("/login");
    // The shell line stands alone: nothing in the block offers `copilot /login` as a command.
    expect(block.querySelector("pre")?.textContent).toBe("copilot");
  });

  /**
   * **The failure this file exists for.** Help for the agent you did not pick is worse than no help:
   * it is a command that will not fix the thing in front of you. Selecting a card must replace the
   * block wholesale, not add to it.
   */
  it("shows only the selected agent's instructions, not another's", async () => {
    await renderSettings();
    await clickCard("cursor");

    expect(screen.getByTestId("agent-help-cursor")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-help-claude")).not.toBeInTheDocument();

    const text = helpText();
    expect(text).toContain(hintFor("cursor").install.commands[0].command);
    expect(text).not.toContain(hintFor("claude").install.commands[0].command);
    expect(text).not.toContain(hintFor("codex").install.commands[0].command);
  });

  /**
   * `probe_binary` resolves `cursor` to `cursor-agent` and `antigravity` to `agy`, so the binary line
   * is the one fact here that the vendor's own docs cannot supply. A Help section naming the wrong
   * one would send someone to install a CLI Tendril never looks for.
   */
  it("names the binary the daemon actually spawns", async () => {
    await renderSettings();

    await clickCard("cursor");
    expect(screen.getByTestId("agent-help-binary").textContent).toContain("cursor-agent");

    await clickCard("antigravity");
    expect(screen.getByTestId("agent-help-binary").textContent).toContain("agy");
  });

  /**
   * A BYO card is a provider, not a CLI: there is no binary to find and no login to run, so the block
   * offers the console that issues the key instead. `openUrl` rather than an anchor, because a
   * target-less navigation inside the webview replaces the app.
   */
  it("offers a key console rather than a binary for a bring-your-own provider", async () => {
    await renderSettings();
    await clickCard("anthropic_card");

    expect(screen.getByTestId("agent-help-anthropic_card")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-help-binary")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("agent-help-auth-link"));
    });
    expect(openUrl).toHaveBeenCalledWith(hintFor("anthropic_card").auth.url);
  });

  /**
   * Supplementary help beside settings that work without it. A daemon that is down has already been
   * reported at the top of the pane, and a second red box saying the same thing helps nobody - but a
   * crash here would take the whole settings pane with it, which is the failure worth pinning.
   */
  it("renders the rest of the pane when the daemon serves no hints", async () => {
    vi.spyOn(agentsApi, "getHints").mockRejectedValue(new Error("daemon offline"));
    await renderSettings();

    expect(screen.queryByTestId("agent-help-block")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-environment-block")).toBeInTheDocument();
  });

  /**
   * The parity assertion, across the language boundary.
   *
   * Every card in either grid is selectable, so every card must answer; an agent added to
   * `CODING_AGENTS` that the daemon serves no hint for renders a Help section with nothing in it,
   * and nothing on either side would notice - the pane cannot see `SIGN_IN_HINT_CARDS`, and
   * `probe.rs`'s own parity test only checks that the cards it lists resolve, not that the list is
   * the pane's. Reading the Rust source from a vitest run is the established shape here:
   * `agent-roster-parity.test.ts` reads `catalog.rs` for exactly this reason.
   */
  it("serves a hint for every card in the picker", () => {
    const probePath = path.resolve(__dirname, "../../../crates/tendril-core/src/agents/probe.rs");
    const source = fs.readFileSync(probePath, "utf8");
    const table = /const SIGN_IN_HINT_CARDS: &\[&str\] = &\[([\s\S]*?)\n\];/.exec(source);
    if (!table) {
      throw new Error(
        `Could not find SIGN_IN_HINT_CARDS in ${probePath}. If it was renamed or restructured, ` +
          `update this test -- do not delete it.`,
      );
    }
    const served = Array.from(table[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    const cards = [...CODING_AGENTS.map((a) => a.id), ...BYO_CARDS.map((b) => b.key)];

    expect(served.length).toBeGreaterThanOrEqual(cards.length);
    expect([...served].sort()).toEqual([...cards].sort());
  });
});
