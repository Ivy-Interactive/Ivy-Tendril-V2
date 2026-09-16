import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentPicker, agentBrandIcon } from "../src/components/chat/AgentPicker";
import type { AgentOption } from "../src/types/agents";

/**
 * V1 `src/Ivy.Tendril.Widgets/frontend/src/ChatWidget/AgentPicker.tsx` is the contract, and its
 * behaviour is specified by `ChatWidget.test.tsx`'s two picker tests. The pill names the *agent*;
 * the model and the effort live one level deeper, in a panel opened from a row's options button, so
 * they can be remembered for an agent without selecting it.
 */

const CLAUDE: AgentOption = {
  id: "claude",
  label: "Claude",
  models: [
    { id: "default", displayName: "Default" },
    { id: "claude-opus-5", displayName: "Claude Opus 5" },
  ],
  supportsEffort: true,
  efforts: [
    { id: "default", displayName: "Default" },
    { id: "high", displayName: "High" },
    { id: "max", displayName: "Max" },
  ],
};

const CODEX: AgentOption = {
  id: "codex",
  label: "Codex",
  models: [
    { id: "default", displayName: "Default" },
    { id: "gpt-5", displayName: "GPT-5" },
  ],
  // V1's Gemini is the real example of this: no `EffortControl` capability, so the effort select
  // never renders and `hasSettings` rests on the model list alone.
  supportsEffort: false,
  efforts: [],
};

const GEMINI: AgentOption = {
  id: "gemini",
  label: "Gemini",
  models: [{ id: "default", displayName: "Default" }],
  supportsEffort: false,
  efforts: [],
};

/** The picker is controlled, so the harness carries the per-agent memory rule the store owns. */
const Harness: React.FC<{
  agents?: AgentOption[];
  initialAgentId?: string;
  onAgentChange?: (agentId: string) => void;
}> = ({ agents = [CLAUDE, CODEX], initialAgentId = "claude", onAgentChange }) => {
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId);
  const [preferences, setPreferences] = useState<
    Record<string, { modelId?: string; effort?: string }>
  >({});

  const defaultsFor = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    return {
      modelId: agent?.models[0]?.id ?? "default",
      effort: agent?.efforts[0]?.id ?? "default",
    };
  };
  const resolved = { ...defaultsFor(selectedAgentId), ...preferences[selectedAgentId] };

  return (
    <AgentPicker
      agents={agents}
      selectedAgentId={selectedAgentId}
      selectedModelId={resolved.modelId}
      selectedEffort={resolved.effort}
      rememberedFor={(agentId) => preferences[agentId] ?? {}}
      onAgentChange={(agentId) => {
        onAgentChange?.(agentId);
        setSelectedAgentId(agentId);
      }}
      onModelChange={(agentId, modelId) =>
        setPreferences((prev) => ({ ...prev, [agentId]: { ...prev[agentId], modelId } }))
      }
      onEffortChange={(agentId, effort) =>
        setPreferences((prev) => ({ ...prev, [agentId]: { ...prev[agentId], effort } }))
      }
    />
  );
};

const openMenu = () => {
  fireEvent.click(screen.getByRole("button", { name: /^Agent:/ }));
  return screen.getByRole("menu", { name: "Agents" });
};

const openOptions = (agentLabel: string) =>
  fireEvent.click(screen.getByRole("button", { name: `${agentLabel} options` }));

const modelSelect = () => screen.getByLabelText("Model") as HTMLSelectElement;
const effortSelect = () => screen.getByLabelText("Effort Level") as HTMLSelectElement;

describe("AgentPicker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a menu of agents and marks the selected one, with no model select until asked", () => {
    render(<Harness />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    openMenu();

    // V1 lists the agents in catalogue order, flat, with no grouping or headings.
    expect(
      screen.getAllByRole("menuitemradio").map((row) => row.getAttribute("aria-label")),
    ).toEqual(["Claude", "Codex"]);
    expect(screen.getByRole("menuitemradio", { name: "Claude" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Codex" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // The model and effort are one level deeper: nothing is shown until a row's options open.
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Effort Level")).not.toBeInTheDocument();
  });

  it("names the agent on the pill and never the model or the effort", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /^Agent:/ });

    // V1's `aria-label={`Agent: ${label}`}` - the pill carries the agent alone.
    expect(trigger).toHaveAttribute("aria-label", "Agent: Claude");
    expect(trigger).toHaveTextContent("Claude");
    expect(trigger).not.toHaveTextContent("Default");

    openMenu();
    openOptions("Claude");
    fireEvent.change(effortSelect(), { target: { value: "max" } });

    expect(trigger).toHaveAttribute("aria-label", "Agent: Claude");
    expect(trigger).not.toHaveTextContent("Max");
  });

  it("remembers a non-selected agent's model from its own options panel without selecting it", () => {
    const onAgentChange = vi.fn();
    render(<Harness onAgentChange={onAgentChange} />);
    openMenu();

    openOptions("Codex");
    expect(screen.getByRole("group", { name: "Codex settings" })).toBeInTheDocument();
    expect(modelSelect().tagName).toBe("SELECT");
    expect(Array.from(modelSelect().options).map((option) => option.textContent)).toEqual([
      "Default",
      "GPT-5",
    ]);

    fireEvent.change(modelSelect(), { target: { value: "gpt-5" } });
    // Choosing for another agent is remembered for it and does not switch to it.
    expect(onAgentChange).not.toHaveBeenCalled();
    expect(modelSelect().value).toBe("gpt-5");
    expect(screen.getByRole("menuitemradio", { name: "Claude" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Codex has no effort control, so its panel offers the model alone.
    expect(screen.queryByLabelText("Effort Level")).not.toBeInTheDocument();
  });

  it("shows the selected agent's model and effort, and restores them after switching away and back", () => {
    render(<Harness />);
    openMenu();

    openOptions("Claude");
    expect(modelSelect().value).toBe("default");
    fireEvent.change(modelSelect(), { target: { value: "claude-opus-5" } });
    fireEvent.change(effortSelect(), { target: { value: "max" } });
    expect(modelSelect().value).toBe("claude-opus-5");
    expect(effortSelect().value).toBe("max");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Codex" }));
    openMenu();
    openOptions("Codex");
    // Codex has its own memory, so it starts on its own default rather than Claude's model.
    expect(modelSelect().value).toBe("default");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Claude" }));
    openMenu();
    openOptions("Claude");
    expect(modelSelect().value).toBe("claude-opus-5");
    expect(effortSelect().value).toBe("max");
  });

  it("selects an agent by click and by keyboard, and closes on Escape", () => {
    const onAgentChange = vi.fn();
    render(<Harness onAgentChange={onAgentChange} />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Codex" }));
    expect(onAgentChange).toHaveBeenLastCalledWith("codex");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    openMenu();
    fireEvent.keyDown(screen.getByRole("menuitemradio", { name: "Claude" }), { key: "Enter" });
    expect(onAgentChange).toHaveBeenLastCalledWith("claude");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens a row's options panel with ArrowRight", () => {
    render(<Harness />);
    openMenu();

    fireEvent.keyDown(screen.getByRole("menuitemradio", { name: "Claude" }), { key: "ArrowRight" });
    expect(screen.getByRole("group", { name: "Claude settings" })).toBeInTheDocument();
    expect(effortSelect()).toBeInTheDocument();
  });

  it("offers no options button for an agent with neither models nor effort", () => {
    render(<Harness agents={[{ ...GEMINI, models: [] }, CLAUDE]} initialAgentId="gemini" />);
    openMenu();

    // V1's `hasSettings`: no models and no effort control means there is nothing to open.
    expect(screen.queryByRole("button", { name: "Gemini options" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude options" })).toBeInTheDocument();
  });

  it("still lists the selected agent when the catalogue is empty", () => {
    render(<Harness agents={[]} initialAgentId="claude" />);
    expect(screen.getByRole("button", { name: "Agent: claude" })).toBeInTheDocument();

    openMenu();
    expect(screen.getByRole("menuitemradio", { name: "claude" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "claude options" })).not.toBeInTheDocument();
  });

  it("falls back to the host-resolved model and effort for a catalogue row that carries none", () => {
    // V1's `ChatWidget` sends `models`/`efforts`/`supportsEffort` for the selected agent beside
    // `agents`, and `settingsFor` prefers the row's own lists over them.
    render(
      <AgentPicker
        agents={[
          { id: "claude", label: "Claude Code", models: [], supportsEffort: false, efforts: [] },
        ]}
        selectedAgentId="claude"
        selectedModelId="opus"
        selectedEffort="max"
        models={[{ id: "opus", displayName: "Opus" }]}
        efforts={[
          { id: "default", displayName: "Default" },
          { id: "max", displayName: "Max" },
        ]}
        supportsEffort
        onAgentChange={() => {}}
        onModelChange={() => {}}
        onEffortChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Agent: Claude Code" }));
    openOptions("Claude Code");
    expect(modelSelect().value).toBe("opus");
    expect(effortSelect().value).toBe("max");
  });

  it("brands every agent id V1's AgentBranding brands", () => {
    // V1 `Helpers/AgentBranding.IconFor`. An id with no entry falls through to BrandIcon's
    // terminal glyph, which is V1's `AgentBranding.DefaultIcon`.
    expect(agentBrandIcon("claude")).toBe("ClaudeCode");
    expect(agentBrandIcon("codex")).toBe("OpenAI");
    expect(agentBrandIcon("gemini")).toBe("Gemini");
    expect(agentBrandIcon("copilot")).toBe("Copilot");
    expect(agentBrandIcon("antigravity")).toBe("Antigravity");
    expect(agentBrandIcon("opencode")).toBe("OpenCode");
    expect(agentBrandIcon("ivy")).toBe("IvyCorner");
    expect(agentBrandIcon("openaiproxy")).toBe("OpenAI");
    expect(agentBrandIcon("berget")).toBe("ChevronUp");
    expect(agentBrandIcon("something-else")).toBeUndefined();
  });
});
