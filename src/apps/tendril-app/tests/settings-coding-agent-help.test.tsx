import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

import { SettingsView } from "../src/views/SettingsView";
import { bridge } from "../src/api/bridge";
import { agentsApi } from "../src/api/agentsApi";
import { AGENT_HELP } from "../src/views/settings/agentHelp";
import { BYO_CARDS, CODING_AGENTS } from "../src/views/settings/codingAgents";
import type { AgentOption } from "../src/types/agents";
import type { ServiceInfo, TendrilConfig } from "../src/types/api";

/**
 * The Help block under the Coding Agent pane: install and sign-in instructions for the card in front
 * of the operator.
 *
 * Three things are worth a test and nothing else is. That the block renders at all; that it renders
 * *this* card's instructions and not the last card's, which is the only way a help panel can be
 * actively harmful; and that every card in either grid has an entry - the parity assertion, which is
 * what stops a new agent shipping with a blank Help section the same way `apple` shipped with no card
 * at all (see `agent-roster-parity.test.ts`).
 *
 * The copy itself is deliberately not asserted word for word. Vendors rename install scripts, and a
 * test that pins the prose turns every upstream correction into a two-file change with no added
 * safety; what matters is that the right entry reaches the DOM.
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
  it("shows the selected agent's instructions", async () => {
    await renderSettings();

    expect(screen.getByTestId("agent-help-claude")).toBeInTheDocument();
    expect(helpText()).toContain(AGENT_HELP.claude.install.command);
    expect(helpText()).toContain(AGENT_HELP.claude.auth.command);
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
    expect(text).toContain(AGENT_HELP.cursor.install.command);
    expect(text).not.toContain(AGENT_HELP.claude.install.command);
    expect(text).not.toContain(AGENT_HELP.codex.install.command);
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
    expect(openUrl).toHaveBeenCalledWith(AGENT_HELP.anthropic_card.auth.url);
  });

  /**
   * The parity assertion. Every card in either grid is selectable, so every card must answer; an
   * agent added to `CODING_AGENTS` with no `AGENT_HELP` row renders a Help section with nothing in it,
   * and nothing else in the suite would notice.
   */
  it("has an entry for every card in the picker", () => {
    const cards = [...CODING_AGENTS.map((a) => a.id), ...BYO_CARDS.map((b) => b.key)];
    expect(Object.keys(AGENT_HELP).sort()).toEqual([...cards].sort());
  });

  /**
   * An entry that exists but says nothing is the same blank section by another route. Each half must
   * carry prose, and must carry either a command to run or a page to open - the exception being an
   * install step for a provider with no CLI, which is honest about having nothing to run and says so
   * in the summary rather than inventing a command.
   */
  it("gives every entry real content in both halves", () => {
    for (const [card, help] of Object.entries(AGENT_HELP)) {
      expect(help.install.summary.length, `${card} install summary`).toBeGreaterThan(20);
      expect(help.auth.summary.length, `${card} auth summary`).toBeGreaterThan(20);
      expect(
        help.auth.command ?? help.auth.url,
        `${card} auth names neither a command nor a console`,
      ).toBeTruthy();
      // A card with no binary is a BYO provider, which has nothing to install by design.
      if (help.binary !== null) {
        expect(help.install.command, `${card} install command`).toBeTruthy();
      }
    }
  });

  /**
   * pnpm-only is a repo rule, and a settings pane that prints `npm install -g` teaches every operator
   * who reads it the opposite. Every one of these CLIs has a Homebrew formula or a vendor script, so
   * the rule costs nothing to keep.
   */
  it("recommends no npm commands", () => {
    for (const [card, help] of Object.entries(AGENT_HELP)) {
      for (const step of [help.install, help.auth]) {
        expect(step.command ?? "", `${card} names npm`).not.toMatch(/\bnpm\b/);
      }
    }
  });
});
