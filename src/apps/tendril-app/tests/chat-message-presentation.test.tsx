import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChatMessageRow, parseUserMessageContent } from "../src/views/ChatMessageRow";
import { ChatView, buildChatSamplePrompts } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import { sidebarListStore } from "../src/state/sidebarListStore";
import { plansStore } from "../src/state/plansStore";
import { jobsStore } from "../src/state/jobsStore";
import type { ChatMessage, ChatSession } from "../src/types/chat";
import type { Job, PlanSummary } from "../src/types/api";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  role: "assistant",
  content: "Here is the answer.",
  timestamp: "2026-09-14T10:00:00Z",
  ...overrides,
});

const plan = (overrides: Partial<PlanSummary>): PlanSummary => ({
  id: "00007",
  title: "A plan",
  state: "Draft",
  project: "web",
  level: "Feature",
  verifications: [],
  ...overrides,
});

describe("chat message presentation parity", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("a turn's tool activity", () => {
    const rawStream = [
      JSON.stringify({ kind: "text", text: "Reading the file", delta: false }),
      JSON.stringify({
        kind: "tool_call",
        tool_use_id: "t1",
        tool_name: "Read",
        input: { file_path: "/src/app.ts" },
      }),
      JSON.stringify({ kind: "tool_result", tool_use_id: "t1", output: "ok" }),
    ].join("\n");

    it("renders what the turn did, from the raw stream V1 renders the whole turn from", () => {
      render(<ChatMessageRow message={message({ rawStream })} />);

      expect(screen.getByTestId("chat-turn-activity")).toBeInTheDocument();
      expect(screen.getByText("Read")).toBeInTheDocument();
    });

    it("renders nothing extra for a turn that only spoke", () => {
      render(
        <ChatMessageRow
          message={message({ rawStream: JSON.stringify({ kind: "text", text: "hello" }) })}
        />,
      );

      expect(screen.queryByTestId("chat-turn-activity")).not.toBeInTheDocument();
    });

    it("survives a half-written trailing line", () => {
      render(<ChatMessageRow message={message({ rawStream: `${rawStream}\n{"kind":"tool_ca` })} />);

      expect(screen.getByTestId("chat-turn-activity")).toBeInTheDocument();
    });
  });

  describe("a user message reloaded from disk", () => {
    it("splits the [Attached Files] block back into chips", () => {
      render(
        <ChatMessageRow
          message={message({
            id: "u1",
            role: "user",
            content: "Look at this\n\n[Attached Files]:\n- /tmp/notes.md",
            rawStream: undefined,
          })}
        />,
      );

      expect(screen.getByText("Look at this")).toBeInTheDocument();
      expect(screen.getByText("notes.md")).toBeInTheDocument();
      expect(screen.queryByText(/\[Attached Files\]/)).not.toBeInTheDocument();
    });

    it("parses the prompt and the paths", () => {
      expect(parseUserMessageContent("Do it\n\n[Attached Files]:\n- /a/b.txt\n- /c/d.png")).toEqual(
        {
          prompt: "Do it",
          attachments: [
            { name: "b.txt", path: "/a/b.txt" },
            { name: "d.png", path: "/c/d.png" },
          ],
        },
      );
    });

    it("leaves an ordinary prompt untouched", () => {
      expect(parseUserMessageContent("just text")).toEqual({
        prompt: "just text",
        attachments: [],
      });
    });
  });

  describe("sample prompts", () => {
    it("leads with what needs attention and fills the rest, capped at five", () => {
      const prompts = buildChatSamplePrompts(
        [
          plan({ id: "00012", title: "Ship the picker", state: "Review" }),
          plan({ id: "00013", title: "Port the shell", state: "Review" }),
          plan({ id: "00014", title: "Fix the diff", state: "Failed", updated: "2026-09-10" }),
          plan({ id: "00015", title: "Old failure", state: "Failed", updated: "2026-09-01" }),
          plan({ id: "00016", title: "Blocked thing", state: "Blocked", updated: "2026-09-11" }),
        ],
        [{ id: "j1", type: "ExecutePlan", project: "web", status: "Running" } as Job],
      );

      expect(prompts.map((p) => p.label)).toEqual([
        "Review the 2 plans waiting",
        "Why did #14 fail?",
        "What is blocking #16?",
        "What are my jobs doing?",
        "Add a new project",
      ]);
      expect(prompts[0].prompt).toContain("#12 Ship the picker, #13 Port the shell");
    });

    it("falls back to the five generic prompts with nothing to report", () => {
      expect(buildChatSamplePrompts([], []).map((p) => p.label)).toEqual([
        "Add a new project",
        "Edit verifications",
        "Create a team vault",
        "What should I work on next?",
        "What shipped this week?",
      ]);
    });

    it("shows the plan-driven chip in the empty state", async () => {
      const empty: ChatSession = {
        id: "s1",
        title: "New Chat",
        createdAt: "2026-09-14T10:00:00Z",
        updatedAt: "2026-09-14T10:00:00Z",
        messages: [],
        spawnedJobIds: [],
      };
      vi.spyOn(chatApi, "listSessions").mockResolvedValue([empty]);
      vi.spyOn(chatApi, "getSession").mockResolvedValue(empty);
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
      plansStore.setPlans([plan({ id: "00021", title: "Ready", state: "Review" })]);

      render(<ChatView />);

      await waitFor(() => {
        expect(screen.getByText("Review the 1 plans waiting")).toBeInTheDocument();
      });
      plansStore.setPlans([]);
      jobsStore.getState().jobs = [];
    });
  });

  describe("the Chats list", () => {
    it("marks the row of a chat that is working somewhere else", async () => {
      const sessions: ChatSession[] = [
        {
          id: "a",
          title: "Active",
          createdAt: "2026-09-14T10:00:00Z",
          updatedAt: "2026-09-14T10:00:02Z",
          messages: [{ id: "a1", role: "user", content: "hi", timestamp: "2026-09-14T10:00:00Z" }],
          spawnedJobIds: [],
        },
        {
          id: "b",
          title: "Busy",
          createdAt: "2026-09-14T10:00:00Z",
          updatedAt: "2026-09-14T10:00:01Z",
          messages: [{ id: "b1", role: "user", content: "hi", timestamp: "2026-09-14T10:00:00Z" }],
          spawnedJobIds: [],
        },
      ];
      vi.spyOn(chatApi, "listSessions").mockResolvedValue(sessions);
      vi.spyOn(chatApi, "getSession").mockImplementation(async (id: string) =>
        sessions.find((s) => s.id === id)!,
      );
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

      render(<ChatView />);
      // The list is the shell sidebar's now (`ChatApp.BuildSidebarList`), so the row state is read
      // off what this view published rather than off markup it no longer owns.
      await waitFor(() => {
        expect(sidebarListStore.getState()?.items.length).toBe(2);
      });
      const list = sidebarListStore.getState();
      expect(list?.appId).toBe("chat");
      expect(list?.title).toBe("Chats");
      // The flags V1 sets on this list and on no other: a flyout in the collapsed rail, its own
      // search, and the three row actions.
      expect(list?.collapsedMenu).toBe(true);
      expect(list?.searchLabel).toBe("Search chats");
      expect(list?.onSearch).toBeTypeOf("function");
      expect(list?.newLabel).toBe("New chat");
      expect(list?.onRename).toBeTypeOf("function");
      expect(list?.onDelete).toBeTypeOf("function");
      expect(list?.onTogglePin).toBeTypeOf("function");

      chatStore.handleChatEvent({
        type: "chat.generating_state",
        sessionId: "b",
        isGenerating: true,
      });

      // `ChatApp.BuildRowState`: the row of the chat that is working says so, and the one on screen
      // does not.
      await waitFor(() => {
        const items = sidebarListStore.getState()?.items ?? [];
        expect(items.find((i) => i.id === "b")?.state).toBe("working");
        expect(items.find((i) => i.id === "a")?.state).toBeUndefined();
      });
      // The composer belongs to the chat on screen, which is not the one working.
      expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    });

    it("renders no Chats list of its own: the page is the conversation", async () => {
      const sessions: ChatSession[] = [
        {
          id: "a",
          title: "Active",
          createdAt: "2026-09-14T10:00:00Z",
          updatedAt: "2026-09-14T10:00:02Z",
          messages: [{ id: "a1", role: "user", content: "hi", timestamp: "2026-09-14T10:00:00Z" }],
          spawnedJobIds: [],
        },
        {
          id: "b",
          title: "Other chat",
          createdAt: "2026-09-14T10:00:00Z",
          updatedAt: "2026-09-14T10:00:01Z",
          messages: [],
          spawnedJobIds: [],
        },
      ];
      vi.spyOn(chatApi, "listSessions").mockResolvedValue(sessions);
      vi.spyOn(chatApi, "getSession").mockImplementation(async (id: string) =>
        sessions.find((s) => s.id === id)!,
      );
      vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);

      render(<ChatView />);
      await waitFor(() => {
        expect(sidebarListStore.getState()?.items.length).toBe(2);
      });

      expect(screen.queryAllByTestId("chat-session-row")).toHaveLength(0);
      // The other chat is a sidebar row; only the open one names itself, in the header.
      expect(screen.queryByText("Other chat")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "New Chat" })).not.toBeInTheDocument();
    });
  });
});

/**
 * A turn renders the markdown body, not the plan page.
 *
 * V1 has two renderers and so never has to choose: `ChatWidget`/`AssistantTurn` render
 * `BlockMarkdown` — react-markdown with `BlockHandler`, no wrapper — inside a plain
 * `.chat-markdown-body`, while `.pmv-root`'s shell (the `Cap()` stand-in, the 1.5rem gutter, the
 * widget's own `overflow-y: auto`) belongs to the plan tab. V2 shares one component, so the thread
 * inherits that page unless the call site opts out, and a code block — bordered, full-bleed, the
 * widest thing in a turn — is where the inherited gutter shows as a misaligned left edge.
 *
 * What the gutter and the cap actually do is layout, which jsdom does not compute; `packages/
 * components/src/components/PlanMarkdown/plan-markdown.css.test.ts` pins the declarations. What is
 * observable here is that chat is the surface asking for the variant, which is the half of the fix
 * a call-site change can regress on its own.
 */
describe("a turn's markdown renderer", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the body without the plan page's chrome around it", () => {
    const { container } = render(
      <ChatMessageRow message={message({ content: "Here is a line.\n\n```\nplain\n```" })} />,
    );

    const root = container.querySelector(".pmv-root");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("pmv-root--flow")).toBe(true);
  });

  it("still renders the code block's own frame, which was never the broken part", () => {
    // The variant strips the page and nothing else: the block keeps its border, its padding and,
    // crucially, its own horizontal scroll — the shell must not clip that on its way out.
    const { container } = render(
      <ChatMessageRow message={message({ content: "```\na long line of code\n```" })} />,
    );

    const pre = container.querySelector<HTMLElement>(".pmv-code-block pre");
    expect(pre).not.toBeNull();
    expect(pre?.style.overflowX).toBe("auto");
    expect(pre?.style.maxWidth).toBe("100%");
  });
});

describe("a submitted answers turn", () => {
  beforeEach(() => {
    chatStore.resetForTesting();
  });

  const summary = [
    "Answers:",
    "- **How should we proceed?**: Open a PR",
    "- **Which checks should run?**: Lint, Test",
    "- **Which environment?**: *(no preference, your call)*",
    "- **Anything else?**: *(skipped)*",
  ].join("\n");

  it("presents the answers as a card rather than as the markdown that travels to the agent", () => {
    render(<ChatMessageRow message={message({ role: "user", content: summary })} />);

    const card = screen.getByTestId("answers-summary-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("How should we proceed?")).toBeInTheDocument();
    expect(screen.getByText("Open a PR")).toBeInTheDocument();
    expect(screen.getByText("Lint, Test")).toBeInTheDocument();
    expect(screen.getByText("Not answered (not required)")).toBeInTheDocument();
    expect(screen.getByText("Not answered (agent decided)")).toBeInTheDocument();
    expect(card.textContent).not.toContain("**");
    expect(card.querySelector(".bg-primary")).toBeNull();
  });

  it("keeps a plain user message that merely uses bold as raw text in its bubble", () => {
    const content = "Please make the **title** bold";
    render(<ChatMessageRow message={message({ role: "user", content })} />);

    expect(screen.queryByTestId("answers-summary-card")).not.toBeInTheDocument();
    expect(screen.getByText(content)).toBeInTheDocument();
  });
});
