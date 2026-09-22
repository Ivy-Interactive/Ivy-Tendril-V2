import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ChatView, buildPlanSamplePrompts } from "../src/views/ChatView";
import { PlanChatPanel } from "../src/components/chat/PlanChatPanel";
import { ChatStore, chatStore, sessionBelongsToPlan } from "../src/state/chatStore";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { chatApi } from "../src/api/chatApi";
import { planDetail, verification } from "./fixtures/plan.fixture";
import type { ChatSession } from "../src/types/chat";
import type { PlanDetail } from "../src/types/api";
import type { DragDropEvent } from "@tauri-apps/api/webview";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

/**
 * The webview drag-drop listener, counted rather than driven: what matters here is *how many*
 * consumers register, because the listener is on the window rather than on a subtree.
 */
const dragRegistrations: ((e: { payload: DragDropEvent }) => void)[] = [];
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (e: { payload: DragDropEvent }) => void) => {
      dragRegistrations.push(handler);
      return Promise.resolve(() => {});
    },
  }),
}));

/** The `chat-event` handlers the two stores subscribe, so an event can be aimed at one of them. */
const chatEventHandlers: ((event: unknown) => void)[] = [];
vi.mock("../src/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/events")>();
  return {
    ...actual,
    onChatEvent: (handler: (event: never) => void) => {
      chatEventHandlers.push(handler as (event: unknown) => void);
      return Promise.resolve(() => {
        const index = chatEventHandlers.indexOf(handler as (event: unknown) => void);
        if (index >= 0) chatEventHandlers.splice(index, 1);
      });
    },
  };
});

function plan(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return planDetail({
    id: "00021",
    title: "Build Desktop Operator Experience",
    state: "Draft",
    dependsOn: [],
    prs: [],
    verifications: [verification("RustClippy", "Pass")],
    ...overrides,
  });
}

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "sess-plan",
    title: "#21 Build Desktop Operator Experience",
    createdAt: "2026-09-07T10:00:00Z",
    updatedAt: "2026-09-07T10:00:00Z",
    messages: [],
    spawnedJobIds: [],
    planFolderName: "00021-BuildDesktopOperator",
    ...overrides,
  };
}

beforeEach(() => {
  chatStore.resetForTesting();
  sidebarListStore.resetForTesting();
  dragRegistrations.length = 0;
  chatEventHandlers.length = 0;
  vi.restoreAllMocks();
  vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
  vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The plan panel is the real chat view. V1 builds it by constructing `new Chat.ContentView(...)` with
 * `embedded: true`, and these are the differences that mode makes — everything else about the
 * conversation is covered by the `ChatView` tests, because it is the same component.
 */
describe("the plan chat is the chat view, embedded", () => {
  it("renders the chat view rather than a panel of its own", async () => {
    render(<PlanChatPanel plan={plan()} />);

    expect(await screen.findByTestId("embedded-chat-view")).toBeInTheDocument();
    // The composer `PlanWorkspace.focusChat` reaches for, and the chat's own thread controls.
    expect(screen.getByLabelText("Chat prompt")).toBeInTheDocument();
    expect(screen.getByTestId("chat-composer-area")).toBeInTheDocument();
  });

  /**
   * The embedded composer's md (28px) buttons sat low against the 32px textarea under `items-end`;
   * this is the same row as the standalone page's, so it centers here too.
   */
  it("vertically centers the composer's input row", async () => {
    render(<PlanChatPanel plan={plan()} />);

    await screen.findByTestId("embedded-chat-view");
    const textarea = screen.getByLabelText("Chat prompt");
    const inputRow = textarea.closest("[data-multiline]");
    expect(inputRow).not.toBeNull();
    expect(inputRow).toHaveAttribute("data-multiline", "false");
    expect(inputRow?.className).toContain("items-center");
  });

  /**
   * V1 hangs nothing off an assistant turn. `AssistantTurn.tsx` closes with a `chat-turn-meta` line
   * carrying duration, tokens and cost, and that is the whole of it - no copy button, no "create
   * plan from this message". V2 grew both, and they read as an extra row of chrome under every
   * reply.
   *
   * Asserted on the embedded panel as well as the page because the panel is where they were wired
   * "unconditionally", after V1's `ContentView`; that reading was of a prop V1 does not have.
   */
  it("hangs no per-message actions off an assistant turn, as V1 does not", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session()]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue({
      ...session(),
      messages: [{ id: "m1", role: "assistant", content: "Add pagination to the jobs table." }],
    } as never);

    render(<PlanChatPanel plan={plan()} />);

    await screen.findByText("Add pagination to the jobs table.");
    expect(screen.queryByTitle("Create Plan from message")).toBeNull();
    expect(screen.queryByTitle("Copy message")).toBeNull();
  });

  /** `greeting: $"#{plan.Id} {plan.Title}"` and `headline: PlanChatView.Headline`. */
  it("carries the plan's name and V1's headline", async () => {
    render(<PlanChatPanel plan={plan()} />);

    expect(await screen.findByText("#21 Build Desktop Operator Experience")).toBeInTheDocument();
    expect(screen.getByText("Ask Tendril to Change Anything")).toBeInTheDocument();
    // Not the standalone page's headline, which the same markup shows when it is the page.
    expect(screen.queryByText("What Are We Producing Today?")).not.toBeInTheDocument();
  });

  /** `samplePrompts: SamplePrompts.ForPlan(plan)`, not `ForChat`. */
  it("offers the plan's sample prompts, not the tendril's", async () => {
    render(<PlanChatPanel plan={plan()} />);

    const chips = await screen.findByTestId("sample-prompts");
    expect([...chips.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Tighten the scope",
      "Explain the solution",
      "What could go wrong?",
    ]);
    // One of `ForChat`'s fallbacks, which would be here if the chips had come from the wrong rule.
    expect(screen.queryByText("Add a new project")).not.toBeInTheDocument();
  });

  /**
   * The panel is only as wide as the plan page leaves it, and three chips do not fit on one line. Laid
   * out `flex-nowrap … overflow-x-auto` the later ones sat off the right edge, and with no room for a
   * horizontal scrollbar there was no way to reach them — the chips existed and could not be clicked.
   */
  it("wraps its chips onto another line rather than off the edge", async () => {
    render(<PlanChatPanel plan={plan()} />);

    const chips = await screen.findByTestId("sample-prompts");
    expect(chips).toHaveClass("flex-wrap");
    expect(chips).not.toHaveClass("flex-nowrap");
    expect(chips.className).not.toMatch(/overflow-x-auto/);
    // A chip that cannot shrink and cannot break its text overflows a narrow panel on its own, so the
    // per-chip escapes have to go too.
    for (const chip of chips.querySelectorAll("button")) {
      expect(chip).not.toHaveClass("whitespace-nowrap");
      expect(chip).not.toHaveClass("shrink-0");
    }
  });

  /**
   * …and centres them, like every other line of the empty state.
   *
   * `justify-content: flex-start` is V1's, but V1 only has it because embedded it lays the chips out
   * as a `flex-wrap: nowrap` overflow-x scroller, where "centering an overflowing nowrap scroller
   * would push leading chips past the scroll origin" (`chat-widget.css:1848`). The test above is the
   * decision to drop that scroller; the `flex-start` came across with it and outlived its reason, so
   * the panel's chips hung off the left under a centred greeting and a centred headline.
   *
   * Asserted as a class because jsdom computes no layout — the same trade `Sample Prompt Chip
   * Wrapping` and `plan-markdown.css.test.ts` make. The geometry behind it was measured in Chromium
   * against the panel's real class chain: at a 420px panel the first row's chips sat 32px left of the
   * row's centre and the wrapped row 103px, and both went to 0 with `justify-center`.
   */
  it("centres its chips, rather than hanging them off the left of a centred empty state", async () => {
    render(<PlanChatPanel plan={plan()} />);

    const chips = await screen.findByTestId("sample-prompts");
    expect(chips).toHaveClass("justify-center");
    expect(chips).not.toHaveClass("justify-start");
  });

  it("drafts a chip into the composer instead of sending it", async () => {
    const executeTurn = vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);
    render(<PlanChatPanel plan={plan()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Tighten the scope" }));

    expect(screen.getByLabelText<HTMLTextAreaElement>("Chat prompt").value).toContain(
      "Read the latest revision of this plan",
    );
    expect(executeTurn).not.toHaveBeenCalled();
  });

  /** `startNewChat: () => { }` — a no-op, so `embedded` drops the affordance rather than wiring it. */
  it("offers no new-chat affordance", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session()]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(session());
    render(<PlanChatPanel plan={plan()} />);
    await screen.findByTestId("embedded-chat-view");

    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
    // The whole header goes with it: no rename, no delete menu, no title bar.
    expect(screen.queryByRole("button", { name: "Chat options" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-title-input")).not.toBeInTheDocument();
  });

  /** `compact={embedded}` in `ChatWidget.tsx`: the trigger is icon-only in the narrow composer. */
  it("renders the compact agent picker", async () => {
    render(<PlanChatPanel plan={plan()} />);

    const trigger = await screen.findByTestId("agent-picker-compact-trigger");
    expect(trigger.getAttribute("data-compact")).toBe("true");
    // The labelled variant the Chat page uses is not the one that rendered.
    expect(screen.queryByTestId("agent-picker-trigger")).not.toBeInTheDocument();
  });

  it("keeps the labelled picker on the standalone page", async () => {
    render(<ChatView />);

    const trigger = await screen.findByTestId("agent-picker-trigger");
    expect(trigger.getAttribute("data-compact")).toBe("false");
    expect(screen.queryByTestId("agent-picker-compact-trigger")).not.toBeInTheDocument();
  });
});

/**
 * The global effects. Each is checked from the embedded instance *and* from the standalone page, so a
 * gate that turned one off everywhere would fail here rather than in the app.
 */
describe("the embedded chat's global side effects", () => {
  it("publishes no sidebar list, where the page publishes the Chats list", async () => {
    render(<PlanChatPanel plan={plan()} />);
    await screen.findByTestId("embedded-chat-view");

    expect(sidebarListStore.getState()).toBeNull();
  });

  it("still publishes the Chats list from the standalone page", async () => {
    render(<ChatView />);
    await screen.findByTestId("chat-view");

    await waitFor(() => expect(sidebarListStore.getState()?.appId).toBe("chat"));
    expect(sidebarListStore.getState()?.title).toBe("Chats");
  });

  it("registers no webview drop listener, where the page registers one", async () => {
    render(<PlanChatPanel plan={plan()} />);
    await screen.findByTestId("embedded-chat-view");

    expect(dragRegistrations).toHaveLength(0);
  });

  it("still registers the webview drop listener on the standalone page", async () => {
    render(<ChatView />);
    await screen.findByTestId("chat-view");

    await waitFor(() => expect(dragRegistrations).toHaveLength(1));
  });

  /**
   * The Chats search dialog is only reachable through the published list, so an embedded panel could
   * not open it — but it must not be rendered either, or the plan page carries a second `Dialog`.
   */
  it("renders no chat search dialog", async () => {
    render(<PlanChatPanel plan={plan()} />);
    await screen.findByTestId("embedded-chat-view");

    expect(sidebarListStore.getState()).toBeNull();
    expect(screen.queryByTestId("chat-search-dialog")).not.toBeInTheDocument();
  });

  /**
   * The panel's own store is torn down with it, so a plan page opened and closed repeatedly leaves one
   * `chat-event` listener rather than one per visit.
   */
  it("takes its chat-event subscription down on unmount", async () => {
    const { unmount } = render(<PlanChatPanel plan={plan()} />);
    await screen.findByTestId("embedded-chat-view");
    await waitFor(() => expect(chatEventHandlers.length).toBeGreaterThan(0));

    unmount();
    await waitFor(() => expect(chatEventHandlers).toHaveLength(0));
  });

  it("leaves no listener behind across repeated visits", async () => {
    for (let visit = 0; visit < 3; visit += 1) {
      const { unmount } = render(<PlanChatPanel plan={plan()} />);
      await screen.findByTestId("embedded-chat-view");
      await waitFor(() => expect(chatEventHandlers).toHaveLength(1));
      unmount();
      await waitFor(() => expect(chatEventHandlers).toHaveLength(0));
    }
  });
});

/**
 * The point of hosting the real chat view: the eventwire stream, and so the tool cards, arrive in the
 * plan panel too. The old bespoke panel rendered `message.content` as plain text and showed none of
 * this.
 *
 * The lines below are a verbatim capture from a live turn run against the daemon
 * (`POST /api/chat/sessions/:id/execute` on a session attached to a plan folder), so this is the
 * frame shape the panel actually receives rather than one invented for the test.
 */
describe("the plan chat's live tool-call stream", () => {
  const LIVE_FRAMES = [
    '{"kind":"session_init","model":"us.anthropic.claude-opus-5[1m]","session_id":"35dd0383","timestamp":"2026-09-16T16:20:58.201881+00:00","tools":["Task","Bash"]}',
    '{"delta":false,"kind":"text","text":"I\'ll list the files in the working directory.","timestamp":"2026-09-16T16:21:00.853361+00:00"}',
    '{"description":"List files in working directory","input":{"command":"ls -la /private/tmp/tendril-preview-live","description":"List files in working directory"},"kind":"tool_call","timestamp":"2026-09-16T16:21:01.409039+00:00","tool_name":"Bash","tool_use_id":"toolu_live_1"}',
    '{"is_error":false,"kind":"tool_result","output":"total 448","timestamp":"2026-09-16T16:21:02.0+00:00","tool_name":"Bash","tool_use_id":"toolu_live_1"}',
  ];

  it("renders a tool card as the turn streams", async () => {
    const attached = session({ id: "sess-plan", messages: [] });
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([attached]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(attached);

    render(<PlanChatPanel plan={plan()} />);
    await screen.findByTestId("embedded-chat-view");
    await waitFor(() => expect(chatEventHandlers).toHaveLength(1));

    act(() => {
      for (const line of LIVE_FRAMES) {
        for (const handler of chatEventHandlers) {
          handler({
            type: "chat.stream_event",
            sessionId: "sess-plan",
            messageId: "m-live",
            line,
          });
        }
      }
    });

    // The card the events became, with the tool it ran named on it.
    const activity = await screen.findByTestId("chat-turn-activity");
    // The tool it ran, what it was for, and the result it came back with.
    expect(activity.textContent).toBe("BashList files in working directory \u2192 total 448");
  });

  it("writes a turn for another conversation nowhere near this one", async () => {
    const attached = session({ id: "sess-plan", messages: [] });
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([attached]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(attached);

    render(<PlanChatPanel plan={plan()} />);
    await screen.findByTestId("embedded-chat-view");
    await waitFor(() => expect(chatEventHandlers).toHaveLength(1));

    act(() => {
      for (const handler of chatEventHandlers) {
        handler({
          type: "chat.stream_event",
          sessionId: "sess-somebody-else",
          messageId: "m-live",
          line: LIVE_FRAMES[2],
        });
      }
    });

    expect(screen.queryByTestId("chat-turn-activity")).not.toBeInTheDocument();
  });
});

/**
 * Two stores over one event stream. Both subscribe, so both see every frame; each has to recognise
 * only its own conversation, or a turn answered in the plan panel would be written into whatever the
 * Chat page happened to be showing.
 */
describe("two chat stores over one event stream", () => {
  const planSession = session({ id: "sess-plan" });
  const otherSession: ChatSession = {
    id: "sess-other",
    title: "Somebody else's chat",
    createdAt: "2026-09-07T10:00:00Z",
    updatedAt: "2026-09-07T10:00:00Z",
    messages: [],
    spawnedJobIds: [],
  };

  it("delivers a stream delta only to the store whose session it names", async () => {
    const scoped = new ChatStore({
      planId: "00021",
      folderName: "00021-BuildDesktopOperator",
      sessionTitle: "#21 Build Desktop Operator Experience",
    });
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([planSession, otherSession]);
    vi.spyOn(chatApi, "getSession").mockImplementation((id) =>
      Promise.resolve(id === "sess-plan" ? planSession : otherSession),
    );

    await scoped.init();
    await chatStore.init();

    // The scoped store landed on the plan's session; the app-wide one on the newest of all of them.
    expect(scoped.getState().activeSessionId).toBe("sess-plan");
    expect(scoped.getState().sessions.map((s) => s.id)).toEqual(["sess-plan"]);
    expect(
      chatStore
        .getState()
        .sessions.map((s) => s.id)
        .sort(),
    ).toEqual(["sess-other", "sess-plan"]);
    await chatStore.selectSession("sess-other");

    const delta = {
      type: "chat.stream_delta" as const,
      sessionId: "sess-plan",
      messageId: "m1",
      delta: "for the plan",
    };
    act(() => {
      for (const handler of chatEventHandlers) handler(delta);
    });

    expect(scoped.getState().activeSession?.messages.map((m) => m.content)).toEqual([
      "for the plan",
    ]);
    // The other conversation is untouched, even though its store saw the same frame.
    expect(chatStore.getState().activeSession?.messages).toEqual([]);

    scoped.destroy();
  });

  it("keeps each store's active session its own", async () => {
    const scoped = new ChatStore({
      planId: "00021",
      folderName: "00021-BuildDesktopOperator",
      sessionTitle: "#21 Build Desktop Operator Experience",
    });
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([planSession, otherSession]);
    vi.spyOn(chatApi, "getSession").mockImplementation((id) =>
      Promise.resolve(id === "sess-plan" ? planSession : otherSession),
    );

    await chatStore.init();
    await chatStore.selectSession("sess-other");
    await scoped.init();

    // Attaching the panel did not move the Chat page's selection, which is the whole reason the
    // panel has a store of its own (`PlanChatView` keeps its own `activeSessionId`).
    expect(chatStore.getState().activeSessionId).toBe("sess-other");
    expect(scoped.getState().activeSessionId).toBe("sess-plan");

    scoped.destroy();
  });

  /** A plan with no conversation attaches to nothing rather than to the newest chat in the list. */
  it("selects nothing when the plan has no session yet", async () => {
    const scoped = new ChatStore({ planId: "00099", sessionTitle: "#99 Something" });
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([planSession, otherSession]);

    await scoped.init();

    expect(scoped.getState().activeSessionId).toBeNull();
    expect(scoped.getState().sessions).toEqual([]);

    scoped.destroy();
  });
});

/** `PlanChatSessions.BelongsTo`, which is what narrows a scoped store's list. */
describe("sessionBelongsToPlan", () => {
  const scope = {
    planId: "00021",
    folderName: "00021-BuildDesktopOperator",
    sessionTitle: "#21 T",
  };

  it("matches the folder the session records, whatever its case", () => {
    expect(
      sessionBelongsToPlan(session({ planFolderName: "00021-BUILDDESKTOPOPERATOR" }), scope),
    ).toBe(true);
  });

  it("falls back to the plan's id prefix when the plan carries no folder", () => {
    expect(
      sessionBelongsToPlan(session({ planFolderName: "00021-Whatever" }), {
        planId: "00021",
        sessionTitle: "#21 T",
      }),
    ).toBe(true);
  });

  it("claims neither another plan's session nor a free-standing chat", () => {
    expect(sessionBelongsToPlan(session({ planFolderName: "00099-Other" }), scope)).toBe(false);
    expect(sessionBelongsToPlan(session({ planFolderName: undefined }), scope)).toBe(false);
  });
});

/** Port of `SamplePrompts.ForPlan`: source order is priority, deduped by label, capped at five. */
describe("buildPlanSamplePrompts", () => {
  it("leads with the failed verification and names its report", () => {
    const [first] = buildPlanSamplePrompts({
      state: "Review",
      verifications: [verification("NpmTest", "Pass"), verification("RustClippy", "Fail")],
    });
    expect(first.label).toBe("Why did RustClippy fail?");
    expect(first.prompt).toContain("Verification/RustClippy.md");
  });

  it("asks about the first PR when the plan records one", () => {
    const labels = buildPlanSamplePrompts({
      state: "Review",
      prs: ["https://github.com/o/r/pull/7", "https://github.com/o/r/pull/8"],
    }).map((p) => p.label);
    expect(labels[0]).toBe("Summarize the PR feedback");
    const prompt = buildPlanSamplePrompts({ state: "Review", prs: ["pr-7", "pr-8"] })[0].prompt;
    expect(prompt).toContain("pr-7");
    expect(prompt).not.toContain("pr-8");
  });

  it("names the dependencies of a blocked plan", () => {
    const [first] = buildPlanSamplePrompts({ state: "Blocked", dependsOn: ["00019", "00020"] });
    expect(first.label).toBe("What is blocking this?");
    expect(first.prompt).toContain("00019, 00020");
  });

  /** Blocked and Draft are exclusive, so only the last fallback can ever be pushed out. */
  it("caps at five, dropping the last fallback first", () => {
    const prompts = buildPlanSamplePrompts({
      state: "Blocked",
      dependsOn: ["00019"],
      prs: ["pr-1"],
      verifications: [verification("RustClippy", "Fail")],
    });
    expect(prompts.map((p) => p.label)).toEqual([
      "Why did RustClippy fail?",
      "Summarize the PR feedback",
      "What is blocking this?",
      "Explain the solution",
      "What could go wrong?",
    ]);
  });

  it("always ends in the two unconditional fallbacks", () => {
    expect(buildPlanSamplePrompts({ state: "Completed" }).map((p) => p.label)).toEqual([
      "Explain the solution",
      "What could go wrong?",
    ]);
  });
});
