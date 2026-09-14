import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AgentPicker } from "../src/components/chat/AgentPicker";
import type { AgentOption } from "../src/types/agents";

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
  ],
};

const GEMINI: AgentOption = {
  id: "gemini",
  label: "Gemini",
  models: [
    { id: "default", displayName: "Default" },
    { id: "gemini-3-pro", displayName: "Gemini 3 Pro" },
  ],
  supportsEffort: false,
  efforts: [],
};

/** The picker is controlled, so the harness carries the per-agent memory rule the store owns. */
const Harness: React.FC<{ agents?: AgentOption[]; initialAgentId?: string }> = ({
  agents = [CLAUDE, GEMINI],
  initialAgentId = "claude",
}) => {
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
      onAgentChange={setSelectedAgentId}
      onModelChange={(agentId, modelId) =>
        setPreferences((prev) => ({ ...prev, [agentId]: { ...prev[agentId], modelId } }))
      }
      onEffortChange={(agentId, effort) =>
        setPreferences((prev) => ({ ...prev, [agentId]: { ...prev[agentId], effort } }))
      }
    />
  );
};

// Radix's popover collision detection is expensive under jsdom, so every open costs seconds.
vi.setConfig({ testTimeout: 120_000 });

const POPOVER_TIMEOUT = { timeout: 60_000 };

const openPicker = async () => {
  const trigger = screen.getByTestId("agent-picker-trigger");
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument(), POPOVER_TIMEOUT);
  return trigger;
};

/** cmdk listens on its own root, so keyboard navigation has to be delivered there. */
const commandRoot = () => screen.getByRole("dialog").querySelector("[cmdk-root]") as HTMLElement;

const modelSelect = () => screen.getByLabelText("Model") as HTMLSelectElement;

describe("AgentPicker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // cmdk scrolls the highlighted item into view, which jsdom does not implement.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("swaps the model list when a different agent is chosen", async () => {
    render(<Harness />);
    await openPicker();

    expect(
      within(modelSelect())
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Default", "Claude Opus 5"]);

    fireEvent.click(screen.getByRole("option", { name: /Gemini/ }));

    await openPicker();
    expect(
      within(modelSelect())
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Default", "Gemini 3 Pro"]);
    expect(screen.queryByText("Claude Opus 5")).not.toBeInTheDocument();
  });

  it("restores an agent's own model after switching away and back", async () => {
    render(<Harness />);
    await openPicker();

    fireEvent.change(modelSelect(), { target: { value: "claude-opus-5" } });
    expect(modelSelect().value).toBe("claude-opus-5");

    fireEvent.click(screen.getByRole("option", { name: /Gemini/ }));
    await openPicker();
    // Gemini has its own memory, so it starts on its own default rather than Claude's model.
    expect(modelSelect().value).toBe("default");

    fireEvent.click(screen.getByRole("option", { name: /Claude/ }));
    await openPicker();
    expect(modelSelect().value).toBe("claude-opus-5");
    expect(screen.getByTestId("agent-picker-trigger")).toHaveAttribute(
      "aria-label",
      "Agent: Claude · Claude Opus 5 · Default",
    );
  });

  it("selects with the keyboard and returns focus to the trigger on Escape", async () => {
    render(<Harness />);
    // Opening is a click: a browser turns Enter on the trigger into one, jsdom does not.
    await openPicker();

    fireEvent.keyDown(commandRoot(), { key: "ArrowDown" });
    fireEvent.keyDown(commandRoot(), { key: "Enter" });

    await waitFor(
      () => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      POPOVER_TIMEOUT,
    );
    expect(screen.getByTestId("agent-picker-trigger")).toHaveAttribute(
      "aria-label",
      "Agent: Gemini · Default",
    );

    await openPicker();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(
      () => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      POPOVER_TIMEOUT,
    );
    expect(document.activeElement).toBe(screen.getByTestId("agent-picker-trigger"));
  });

  it("hides the effort control for an agent that does not support it", async () => {
    render(<Harness initialAgentId="gemini" />);
    await openPicker();

    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reasoning effort")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-picker-status")).toHaveTextContent("Gemini · Default");
  });

  it("shows the effort control, and announces it, for an agent that supports it", async () => {
    render(<Harness />);
    await openPicker();

    const effort = screen.getByLabelText("Reasoning effort") as HTMLSelectElement;
    expect(effort).toBeInTheDocument();

    fireEvent.change(effort, { target: { value: "high" } });
    expect(screen.getByTestId("agent-picker-status")).toHaveTextContent("Claude · Default · High");
  });

  it("still offers the selected agent when the catalog is empty", async () => {
    render(<Harness agents={[]} initialAgentId="claude" />);
    await openPicker();

    expect(screen.getByRole("option", { name: "claude" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
  });
});
