import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { chatLauncher, NEW_CHAT_TITLE } from "../src/state/chatLauncher";
import { applyChangeEvent } from "../src/api/changes";
import { chatStore } from "../src/state/chatStore";
import { uiStore } from "../src/state/uiStore";
import { bridge } from "../src/api/bridge";
import { ChatHeader } from "../src/views/ChatHeader";
import type { ChatMode } from "../src/state/appearance";
import type { ChatSession } from "../src/types/chat";
import type { TendrilConfig } from "../src/types/api";

/**
 * The `chatMode` setting, end to end.
 *
 * The bug this covers: V2 grew four new-chat affordances -- the shell's Chat row and its
 * Cmd/Ctrl+Alt+N chord, the Chats list "+", the collapsed rail flyout's "+", and the chat header's
 * button -- and only the first consulted `chatMode`. `ChatView.handleCreateSession` called
 * `chatStore.createSession` directly, and `ShellLayout`'s `(source?.onNew ?? onNewChat)` routes the
 * other three into that same handler whenever the Chats list is published. So picking "terminal" in
 * Appearance appeared to do nothing for every button a user actually presses from inside Chat.
 *
 * V1 has one launcher (`ChatLauncher.TargetFor`) that every caller goes through; these tests hold
 * that shape by asserting on the launcher itself rather than on any one button's wiring.
 */

const session = (id: string): ChatSession => ({
  id,
  title: NEW_CHAT_TITLE,
  createdAt: "2026-09-20T12:00:00Z",
  updatedAt: "2026-09-20T12:00:00Z",
  messages: [],
  spawnedJobIds: [],
});

const configWith = (chatMode?: string): TendrilConfig => ({
  codingAgent: "claude",
  raw: chatMode === undefined ? {} : { chatMode },
});

describe("chatLauncher: every new-chat entry point honours chatMode", () => {
  let createSession: ReturnType<typeof vi.spyOn>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let openTerminal: ReturnType<typeof vi.fn<(sessionId: string, prompt?: string) => void>>;

  beforeEach(() => {
    chatLauncher.resetForTesting();
    createSession = vi
      .spyOn(chatStore, "createSession")
      .mockImplementation(async () => session("s-1"));
    navigate = vi.spyOn(uiStore, "navigate").mockImplementation(() => {});
    openTerminal = vi.fn<(sessionId: string, prompt?: string) => void>();
    chatLauncher.registerTerminalOpener(openTerminal);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the chat view when the setting is chat, and the terminal when it is terminal", async () => {
    chatLauncher.setMode("chat");
    await chatLauncher.startNew();
    expect(navigate).toHaveBeenCalledWith({ appId: "chat" });
    expect(openTerminal).not.toHaveBeenCalled();
    // The session is created either way: V1 defers creation to the page in chat mode, but the
    // terminal route needs one to exist before it can resolve an agent, so both arms create it.
    expect(createSession).toHaveBeenCalledWith(NEW_CHAT_TITLE);

    navigate.mockClear();
    createSession.mockClear();

    chatLauncher.setMode("terminal");
    await chatLauncher.startNew();
    expect(openTerminal).toHaveBeenCalledWith("s-1");
    expect(navigate).not.toHaveBeenCalledWith({ appId: "chat" });
    expect(createSession).toHaveBeenCalledWith(NEW_CHAT_TITLE);
  });

  it("lets an explicit override beat the configured default, in both directions", async () => {
    chatLauncher.setMode("chat");
    await chatLauncher.startNew("terminal");
    expect(openTerminal).toHaveBeenCalledWith("s-1");
    expect(navigate).not.toHaveBeenCalledWith({ appId: "chat" });

    openTerminal.mockClear();
    navigate.mockClear();

    chatLauncher.setMode("terminal");
    await chatLauncher.startNew("chat");
    expect(navigate).toHaveBeenCalledWith({ appId: "chat" });
    expect(openTerminal).not.toHaveBeenCalled();
  });

  it("falls back to the chat view when the host registered no terminal pane", async () => {
    chatLauncher.resetForTesting();
    chatLauncher.setMode("terminal");
    // A host that renders the chat view alone has nowhere to put a terminal, and a session created
    // with nowhere to go would be a chat the user cannot reach.
    expect(chatLauncher.targetFor()).toBe("chat");
    await chatLauncher.startNew();
    expect(navigate).toHaveBeenCalledWith({ appId: "chat" });
  });

  it("reads the mode from config at start-up and again on refresh", async () => {
    const getConfig = vi.spyOn(bridge, "getConfig").mockResolvedValue(configWith("terminal"));
    expect(await chatLauncher.init()).toBe("terminal");
    expect(chatLauncher.getMode()).toBe("terminal");

    // The half of the bug that survived a correct launcher: the mode used to be a `useState` seeded
    // once at mount, so a change in Appearance did nothing until the app was restarted.
    getConfig.mockResolvedValue(configWith("chat"));
    expect(await chatLauncher.refresh()).toBe("chat");
    expect(chatLauncher.getMode()).toBe("chat");
  });

  it("keeps the last known mode when a refresh cannot reach the daemon", async () => {
    chatLauncher.setMode("terminal");
    vi.spyOn(bridge, "getConfig").mockRejectedValue(new Error("offline"));
    expect(await chatLauncher.refresh()).toBe("terminal");
  });

  it("normalises an unrecognised chatMode to the chat view", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(configWith("Console"));
    // `ChatModes.Normalize`: only the exact `terminal` opt-in counts, so a hand-edited config.yaml
    // cannot drop a user into a pane they may not know how to leave.
    expect(await chatLauncher.refresh()).toBe("chat");
  });

  it("notifies subscribers, so a mode change reaches a rendered button", () => {
    const seen: ChatMode[] = [];
    const unsubscribe = chatLauncher.subscribe(() => seen.push(chatLauncher.getMode()));
    chatLauncher.setMode("terminal");
    chatLauncher.setMode("terminal");
    chatLauncher.setMode("chat");
    unsubscribe();
    expect(seen).toEqual(["terminal", "chat"]);
  });
});

describe("the mode buttons beside New chat", () => {
  const headerProps = {
    title: "Planning",
  };

  beforeEach(() => {
    chatLauncher.resetForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers the mode the default is not, and passes it as an override", () => {
    const onNewChat = vi.fn();
    render(<ChatHeader {...headerProps} onNewChat={onNewChat} />);

    // Default is `chat`, so the override button is the terminal one.
    expect(screen.getByTestId("new-chat-override")).toHaveAttribute("data-mode", "terminal");
    fireEvent.click(screen.getByTestId("new-chat-override"));
    expect(onNewChat).toHaveBeenCalledWith("terminal");

    // The plain button passes nothing, which is what keeps the setting meaningful: it is the one
    // affordance whose behaviour the default still governs.
    onNewChat.mockClear();
    fireEvent.click(screen.getByTestId("new-chat-default"));
    expect(onNewChat).toHaveBeenCalledWith();
  });

  it("flips which mode the override offers when the setting changes", () => {
    const onNewChat = vi.fn();
    render(<ChatHeader {...headerProps} onNewChat={onNewChat} />);

    act(() => chatLauncher.setMode("terminal"));

    expect(screen.getByTestId("new-chat-override")).toHaveAttribute("data-mode", "chat");
    fireEvent.click(screen.getByTestId("new-chat-override"));
    expect(onNewChat).toHaveBeenCalledWith("chat");
  });

  it("gives both buttons the same size, as requested", () => {
    render(<ChatHeader {...headerProps} onNewChat={vi.fn()} />);
    expect(screen.getByTestId("new-chat-default").getAttribute("data-size")).toBe(
      screen.getByTestId("new-chat-override").getAttribute("data-size"),
    );
  });
});

describe("a config change re-reads the mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes chatMode when config.yaml changes, not only the project list", () => {
    const refreshChatMode = vi.fn();
    applyChangeEvent(
      { type: "fs.change", target: { kind: "config" } },
      {
        refreshPlans: vi.fn(),
        refreshPlanDetail: vi.fn(),
        refreshJobs: vi.fn(),
        refreshProjects: vi.fn(),
        refreshChatMode,
      },
    );
    expect(refreshChatMode).toHaveBeenCalledTimes(1);
  });

  it("leaves a plans change alone, so an unrelated edit does not re-read config", () => {
    const refreshChatMode = vi.fn();
    applyChangeEvent(
      { type: "fs.change", target: { kind: "plans", folder: null } },
      {
        refreshPlans: vi.fn(),
        refreshPlanDetail: vi.fn(),
        refreshJobs: vi.fn(),
        refreshProjects: vi.fn(),
        refreshChatMode,
      },
    );
    expect(refreshChatMode).not.toHaveBeenCalled();
  });
});
