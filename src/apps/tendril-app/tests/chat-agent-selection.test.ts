import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChatStore, chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import { agentsApi } from "../src/api/agentsApi";
import {
  AGENT_PREFERENCES_STORAGE_KEY,
  SELECTED_AGENT_STORAGE_KEY,
} from "../src/state/agentPreferences";
import type { AgentOption } from "../src/types/agents";
import type { ChatSession } from "../src/types/chat";

const CATALOG: AgentOption[] = [
  {
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
  },
  {
    id: "codex",
    label: "Codex",
    models: [
      { id: "default", displayName: "Default" },
      { id: "gpt-5.5", displayName: "GPT-5.5" },
    ],
    supportsEffort: true,
    efforts: [
      { id: "default", displayName: "Default" },
      { id: "high", displayName: "High" },
    ],
  },
];

const SESSION: ChatSession = {
  id: "session-1",
  title: "Picker session",
  createdAt: "2026-09-14T10:00:00Z",
  updatedAt: "2026-09-14T10:00:00Z",
  messages: [],
  spawnedJobIds: [],
};

describe("chatStore agent / model / effort selection", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const loadCatalog = async () => {
    vi.spyOn(agentsApi, "listAgents").mockResolvedValue(CATALOG);
    await chatStore.loadAgents();
  };

  it("remembers a model per agent and restores it when the agent comes back", async () => {
    await loadCatalog();

    chatStore.setAgent("claude");
    chatStore.setModelForAgent("claude", "claude-opus-5");
    expect(chatStore.getState().selectedModelId).toBe("claude-opus-5");

    chatStore.setAgent("codex");
    // Codex has no remembered model, so it falls back to the head of its own list.
    expect(chatStore.getState().selectedModelId).toBe("default");
    chatStore.setModelForAgent("codex", "gpt-5.5");
    expect(chatStore.getState().selectedModelId).toBe("gpt-5.5");

    chatStore.setAgent("claude");
    expect(chatStore.getState().selectedAgentId).toBe("claude");
    expect(chatStore.getState().selectedModelId).toBe("claude-opus-5");
  });

  it("remembers a model for an agent that is not currently selected", async () => {
    await loadCatalog();
    chatStore.setAgent("claude");

    chatStore.setModelForAgent("codex", "gpt-5.5");

    // The live selection is untouched...
    expect(chatStore.getState().selectedModelId).toBe("default");
    // ...but codex carries the choice when it is picked.
    expect(chatStore.getAgentPreference("codex").modelId).toBe("gpt-5.5");
    chatStore.setAgent("codex");
    expect(chatStore.getState().selectedModelId).toBe("gpt-5.5");
  });

  it("persists the selection to localStorage and rehydrates it in a fresh store", async () => {
    await loadCatalog();
    chatStore.setAgent("codex");
    chatStore.setModelForAgent("codex", "gpt-5.5");
    chatStore.setEffortForAgent("codex", "high");

    expect(localStorage.getItem(SELECTED_AGENT_STORAGE_KEY)).toBe("codex");
    expect(JSON.parse(localStorage.getItem(AGENT_PREFERENCES_STORAGE_KEY)!)).toEqual({
      codex: { modelId: "gpt-5.5", effort: "high" },
    });

    const fresh = new ChatStore();
    expect(fresh.getState().selectedAgentId).toBe("codex");
    expect(fresh.getState().selectedModelId).toBe("gpt-5.5");
    expect(fresh.getState().selectedEffort).toBe("high");
  });

  it("sends the selection on the outbound turn instead of posting a message", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([SESSION]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(SESSION);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    await chatStore.fetchSessions();
    await loadCatalog();

    chatStore.setAgent("codex");
    chatStore.setModelForAgent("codex", "gpt-5.5");
    chatStore.setEffortForAgent("codex", "high");

    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);
    const postSpy = vi.spyOn(chatApi, "postMessage").mockResolvedValue({ started: true });

    await chatStore.sendMessage("hi");

    expect(executeSpy).toHaveBeenCalledWith("session-1", {
      prompt: "hi",
      agentId: "codex",
      modelId: "gpt-5.5",
      effort: "high",
    });
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("drops a default model or effort rather than sending the literal string", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([SESSION]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(SESSION);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    await chatStore.fetchSessions();
    await loadCatalog();
    chatStore.setAgent("claude");

    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);
    await chatStore.sendMessage("hi");

    expect(executeSpy).toHaveBeenCalledWith("session-1", {
      prompt: "hi",
      agentId: "claude",
      modelId: undefined,
      effort: undefined,
    });
  });

  it("keeps queueing on postMessage, since only it persists attachments", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([SESSION]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(SESSION);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    await chatStore.fetchSessions();

    const executeSpy = vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);
    const postSpy = vi.spyOn(chatApi, "postMessage").mockResolvedValue({ queued: true });

    await chatStore.sendMessage("later", { enqueue: true });

    expect(postSpy).toHaveBeenCalledWith("session-1", "later", { enqueue: true });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("forwards the current selection when creating a session", async () => {
    await loadCatalog();
    chatStore.setAgent("codex");
    chatStore.setModelForAgent("codex", "gpt-5.5");

    const createSpy = vi.spyOn(chatApi, "createSession").mockResolvedValue(SESSION);
    await chatStore.createSession("New Chat");

    expect(createSpy).toHaveBeenCalledWith({
      title: "New Chat",
      agentId: "codex",
      modelId: "gpt-5.5",
      effort: undefined,
    });
  });

  it("stays usable on the claude/default floor when the catalog cannot be fetched", async () => {
    vi.spyOn(agentsApi, "listAgents").mockRejectedValue(new Error("service down"));

    const agents = await chatStore.loadAgents();

    expect(agents).toEqual([]);
    const state = chatStore.getState();
    expect(state.agents).toEqual([]);
    expect(state.selectedAgentId).toBe("claude");
    expect(state.selectedModelId).toBe("default");
    expect(state.selectedEffort).toBe("default");
    expect(state.error).toBeNull();
  });

  /* Issue #240: the catalog fetch that loses a race with a still-starting daemon used to be the last
     one the process ever made. `loadAgents` swallows its failure, so `runInit` succeeds, so `init()`
     keeps its memo — and nothing else calls `loadAgents`, leaving the picker on `AgentPicker`'s
     synthetic single row with no models until a restart. */
  describe("the one retry a failed catalog fetch gets", () => {
    it("fills the picker when the second fetch succeeds", async () => {
      const listAgents = vi
        .spyOn(agentsApi, "listAgents")
        .mockRejectedValueOnce(new Error("daemon still starting"))
        .mockResolvedValueOnce(CATALOG);

      const agents = await chatStore.loadAgents();

      expect(listAgents).toHaveBeenCalledTimes(2);
      expect(agents).toEqual(CATALOG);
      // The catalog landing late is the whole point: the picker has real models again.
      expect(chatStore.getState().agents).toEqual(CATALOG);
      expect(chatStore.getState().selectedAgentId).toBe("claude");
    });

    it("restores the remembered agent on the retry, exactly as a first-try fetch would", async () => {
      localStorage.setItem(SELECTED_AGENT_STORAGE_KEY, "codex");
      vi.spyOn(agentsApi, "listAgents")
        .mockRejectedValueOnce(new Error("daemon still starting"))
        .mockResolvedValueOnce(CATALOG);

      await chatStore.loadAgents();

      expect(chatStore.getState().selectedAgentId).toBe("codex");
    });

    it("degrades to the empty floor rather than hanging when the retry also fails", async () => {
      const listAgents = vi
        .spyOn(agentsApi, "listAgents")
        .mockRejectedValue(new Error("service down"));

      const agents = await chatStore.loadAgents();

      // Exactly two: one retry, not a loop that keeps the awaited `init()` off screen.
      expect(listAgents).toHaveBeenCalledTimes(2);
      expect(agents).toEqual([]);
      expect(chatStore.getState().agents).toEqual([]);
      expect(chatStore.getState().selectedAgentId).toBe("claude");
      expect(chatStore.getState().selectedModelId).toBe("default");
    });

    it("resolves init() rather than leaving it pending on the retry", async () => {
      vi.spyOn(agentsApi, "listAgents")
        .mockRejectedValueOnce(new Error("daemon still starting"))
        .mockResolvedValueOnce(CATALOG);
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);

      // The delay sits inside the promise `init()` memoizes, so both StrictMode calls must settle on
      // it — the guard the memo exists for has to survive the extra await window.
      await Promise.all([chatStore.init(), chatStore.init()]);

      expect(chatStore.getState().agents).toEqual(CATALOG);
    });

    it("leaves a store destroyed mid-wait alone", async () => {
      const store = new ChatStore();
      vi.spyOn(agentsApi, "listAgents")
        .mockRejectedValueOnce(new Error("daemon still starting"))
        .mockResolvedValueOnce(CATALOG);

      const pending = store.loadAgents();
      // The plan panel is torn down inside exactly this window under StrictMode.
      store.destroy();
      await pending;

      expect(store.getState().agents).toEqual([]);
    });
  });
});
