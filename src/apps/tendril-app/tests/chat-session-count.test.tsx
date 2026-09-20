import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import {
  getChatSessionCount,
  resetChatSessionCountForTesting,
  seedChatSessionCount,
  useChatSessionCount,
} from "../src/state/chatSessionCount";
import type { ChatSession } from "../src/types/chat";

/**
 * The sidebar Chat button's badge, against V1's `TendrilAppShell.Build`, which reads
 * `chatService.GetSessions().Count` on every build (`AppShell/TendrilAppShell.cs:1085`) and hides it
 * at zero (`ChatRowBadge`, line 296).
 *
 * The bug this pins: V2's shell filled the count from a single `chatApi.listSessions()` at mount and
 * held it. Deleting every chat left the badge showing the number the user had when the shell
 * started - it only cleared on a reload. Nothing that changes the session list ran through the
 * shell, because `App.tsx` cannot import `chatStore`: it is the one eager module and the chat stack
 * would land in an entry chunk already at 94% of the `code-splitting` budget.
 */

function session(id: string): ChatSession {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: "2026-09-18T12:00:00Z",
    updatedAt: "2026-09-18T12:00:00Z",
    messages: [{ id: `m-${id}`, role: "user", content: "hi", timestamp: "2026-09-18T12:00:00Z" }],
    spawnedJobIds: [],
  };
}

const Badge: React.FC = () => {
  const count = useChatSessionCount();
  // V1's `ChatRowBadge`: nothing at all below one.
  return <span data-testid="badge">{count > 0 ? String(count) : "none"}</span>;
};

describe("Chat session count badge", () => {
  beforeEach(() => {
    resetChatSessionCountForTesting();
    chatStore.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears when the last chat is deleted, without a reload", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a"), session("b")]);
    vi.spyOn(chatApi, "getSession").mockImplementation((id) => Promise.resolve(session(id)));
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    vi.spyOn(chatApi, "deleteSession").mockResolvedValue(undefined);

    render(<Badge />);
    await act(async () => {
      await chatStore.fetchSessions();
    });
    expect(screen.getByTestId("badge").textContent).toBe("2");

    await act(async () => {
      await chatStore.deleteSession("a");
    });
    expect(screen.getByTestId("badge").textContent).toBe("1");

    // The one that used to stick: the badge kept reading "2" over an empty Chats list.
    await act(async () => {
      await chatStore.deleteSession("b");
    });
    expect(screen.getByTestId("badge").textContent).toBe("none");
  });

  it("counts a chat the moment it is created", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
    vi.spyOn(chatApi, "createSession").mockResolvedValue(session("new"));

    render(<Badge />);
    await act(async () => {
      await chatStore.fetchSessions();
    });
    expect(screen.getByTestId("badge").textContent).toBe("none");

    await act(async () => {
      await chatStore.createSession("New Chat");
    });
    expect(screen.getByTestId("badge").textContent).toBe("1");
  });

  /* The shell's startup fetch and the store's first load race, and the store's answer is the live
     one. A seed landing second must not put its own number back on the badge. */
  it("lets the store's count win over a late startup seed", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a")]);
    vi.spyOn(chatApi, "getSession").mockImplementation((id) => Promise.resolve(session(id)));
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.fetchSessions();
    expect(getChatSessionCount()).toBe(1);

    // The shell's `listSessions()` resolving late, from before the user deleted anything.
    seedChatSessionCount(9);
    expect(getChatSessionCount()).toBe(1);
  });

  it("shows a count before anything has loaded the chat store", () => {
    render(<Badge />);
    expect(screen.getByTestId("badge").textContent).toBe("none");

    act(() => {
      seedChatSessionCount(3);
    });
    expect(screen.getByTestId("badge").textContent).toBe("3");
  });

  /* A plan's chat panel runs its own scoped store whose list is one conversation. V1 counts every
     chat the user has, so that store must not publish over the app-wide one. */
  it("ignores a plan-scoped store's narrowed list", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session("a"), session("b")]);
    vi.spyOn(chatApi, "getSession").mockImplementation((id) => Promise.resolve(session(id)));
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

    await chatStore.fetchSessions();
    expect(getChatSessionCount()).toBe(2);

    const { ChatStore } = await import("../src/state/chatStore");
    const scoped = new ChatStore({
      planId: "00638",
      folderName: "00638-a-plan",
      sessionTitle: "Plan chat",
    });
    await scoped.fetchSessions();

    expect(getChatSessionCount()).toBe(2);
    scoped.destroy();
  });
});
