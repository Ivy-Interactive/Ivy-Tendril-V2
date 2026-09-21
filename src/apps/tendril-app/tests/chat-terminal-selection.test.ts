import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chatApi } from "../src/api/chatApi";
import { chatLauncher } from "../src/state/chatLauncher";
import { chatStore } from "../src/state/chatStore";
import { buildChatSidebarList } from "../src/views/chat/sidebarList";
import type { ChatSession } from "../src/types/chat";

/**
 * A conversation running as a terminal is never adopted by the chat view.
 *
 * V1 guards this once, at the top of `ChatApp.SelectSession`: "Terminal sessions belong to the
 * AgentApp pane, never here." V2 grew three ways to select a session and guarded the wrong one.
 *
 * `App.tsx`'s `handleSelectSidebarItem` held the only check, and it could not work: `ShellLayout`
 * routes a click as `onSelectSidebarItem(appId, itemId, source.buildSelectArgs(itemId))`, and
 * `chat/sidebarList.ts`'s `buildSelectArgs` calls `onSelect` **while computing those args** — so the
 * store had already been asked before the handler holding the guard was entered. The other two paths,
 * `ChatView`'s own list action and `ChatSearchDialog`'s result button, call the store directly and
 * never reach that handler at all.
 *
 * The symptom, from the report: switching to the empty chat and back left the chat view showing the
 * terminal session as an empty conversation. Worse than cosmetic — `selectSession` prunes an empty
 * *previous* session on its way out, so adopting a terminal session arms that prune against the chat
 * the user came from.
 */

const session = (id: string, messages: ChatSession["messages"] = []): ChatSession => ({
  id,
  title: id,
  createdAt: "2026-09-21T12:00:00Z",
  updatedAt: "2026-09-21T12:00:00Z",
  messages,
  spawnedJobIds: [],
});

describe("terminal sessions belong to the AgentApp pane, never the chat view", () => {
  let getSession: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    chatStore.resetForTesting();
    chatLauncher.resetForTesting();
    getSession = vi.spyOn(chatApi, "getSession").mockImplementation(async (id) => session(id));
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  });

  afterEach(() => {
    chatStore.resetForTesting();
    chatLauncher.resetForTesting();
    vi.restoreAllMocks();
  });

  it("reveals the pane instead of selecting, whichever path asked", async () => {
    const openTerminal = vi.fn();
    chatLauncher.registerTerminalOpener(openTerminal);
    chatLauncher.registerOpenTerminals(["term-1"]);

    await chatStore.selectSession("term-1");

    expect(openTerminal).toHaveBeenCalledWith("term-1");
    // The chat view's selection is untouched: a terminal session holds no messages, so adopting it
    // would paint the conversation as empty.
    expect(chatStore.getState().activeSessionId).toBeNull();
    expect(getSession).not.toHaveBeenCalledWith("term-1");
  });

  it("covers the sidebar click, whose args are produced by a call that selects", async () => {
    const openTerminal = vi.fn();
    chatLauncher.registerTerminalOpener(openTerminal);
    chatLauncher.registerOpenTerminals(["term-1"]);

    const list = buildChatSidebarList([session("term-1")], null, () => null, {
      onNew: vi.fn(),
      onSearch: vi.fn(),
      onSelect: (id) => void chatStore.selectSession(id),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onTogglePin: vi.fn(),
    });

    // This is `ShellLayout`'s own call, and it is where the selection actually happens -- the args it
    // returns reach the guard in `App.tsx` only afterwards.
    const args = list.buildSelectArgs?.("term-1");
    await Promise.resolve();

    expect(args).toEqual({ sessionId: "term-1" });
    expect(openTerminal).toHaveBeenCalledWith("term-1");
    expect(chatStore.getState().activeSessionId).toBeNull();
  });

  it("leaves an ordinary chat alone", async () => {
    const openTerminal = vi.fn();
    chatLauncher.registerTerminalOpener(openTerminal);
    chatLauncher.registerOpenTerminals(["term-1"]);

    await chatStore.selectSession("chat-1");

    expect(openTerminal).not.toHaveBeenCalled();
    expect(chatStore.getState().activeSessionId).toBe("chat-1");
  });

  it("selects a session whose terminal pane has been closed", async () => {
    const openTerminal = vi.fn();
    chatLauncher.registerTerminalOpener(openTerminal);
    chatLauncher.registerOpenTerminals(["term-1"]);
    // The pane registry is republished on every commit, so closing the pane empties it.
    chatLauncher.registerOpenTerminals([]);

    await chatStore.selectSession("term-1");

    expect(openTerminal).not.toHaveBeenCalled();
    expect(chatStore.getState().activeSessionId).toBe("term-1");
  });
});
