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

  /**
   * The daemon does not replace the message body on each text event, it *appends*: whole messages
   * are joined with a blank line (`chat/execution/streaming.rs`'s `next_text_delta`). So `content`
   * for an interleaved turn is every utterance concatenated, which is what these fixtures build.
   */
  describe("a turn's tool activity", () => {
    const text = (value: string) => JSON.stringify({ kind: "text", text: value, delta: false });
    const toolCall = (id: string, file: string) =>
      JSON.stringify({
        kind: "tool_call",
        tool_use_id: id,
        tool_name: "Read",
        input: { file_path: file },
      });
    const toolResult = (id: string) =>
      JSON.stringify({ kind: "tool_result", tool_use_id: id, output: "ok" });

    /** What the daemon's accumulated body looks like for these utterances. */
    const body = (...blocks: string[]) => blocks.join("\n\n");

    const rawStream = [
      text("Reading the file"),
      toolCall("t1", "/src/app.ts"),
      toolResult("t1"),
    ].join("\n");

    it("renders what the turn did, from the raw stream V1 renders the whole turn from", () => {
      render(<ChatMessageRow message={message({ rawStream, content: "Reading the file" })} />);

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
      render(
        <ChatMessageRow
          message={message({
            rawStream: `${rawStream}\n{"kind":"tool_ca`,
            content: "Reading the file",
          })}
        />,
      );

      expect(screen.getByTestId("chat-turn-activity")).toBeInTheDocument();
    });

    /**
     * The interleaving is the point of #257: a turn that spoke, ran a tool, then spoke again reads
     * in that order, rather than stacking every tool card above one block of prose.
     */
    it("renders text, tool and text in the order the stream produced them", () => {
      const interleaved = [
        text("First I look."),
        toolCall("t1", "/src/app.ts"),
        toolResult("t1"),
        text("Then I answer."),
      ].join("\n");

      render(
        <ChatMessageRow
          message={message({
            rawStream: interleaved,
            content: body("First I look.", "Then I answer."),
          })}
        />,
      );

      const activity = screen.getByTestId("chat-turn-activity");
      const kinds = [
        ...activity.querySelectorAll(
          "[data-testid='chat-turn-text'],[data-testid='chat-turn-tool']",
        ),
      ].map((node) => node.getAttribute("data-testid"));
      expect(kinds).toEqual(["chat-turn-text", "chat-turn-tool", "chat-turn-text"]);
      expect(screen.getAllByText("First I look.")).toHaveLength(1);
      expect(screen.getAllByText("Then I answer.")).toHaveLength(1);
    });

    /**
     * The blocker the first cut shipped: `content` carries the pre-tool prose too, so swapping it
     * wholesale into the trailing segment printed the opening sentence a second time.
     */
    it("says each block exactly once for a two-tool turn", () => {
      const interleaved = [
        text("First I look."),
        toolCall("t1", "/src/app.ts"),
        toolResult("t1"),
        text("Now the config."),
        toolCall("t2", "/src/config.ts"),
        toolResult("t2"),
        text("Then I answer."),
      ].join("\n");

      render(
        <ChatMessageRow
          message={message({
            rawStream: interleaved,
            content: body("First I look.", "Now the config.", "Then I answer."),
          })}
        />,
      );

      for (const block of ["First I look.", "Now the config.", "Then I answer."]) {
        expect(screen.getAllByText(block)).toHaveLength(1);
      }
      const activity = screen.getByTestId("chat-turn-activity");
      const kinds = [
        ...activity.querySelectorAll(
          "[data-testid='chat-turn-text'],[data-testid='chat-turn-tool']",
        ),
      ].map((node) => node.getAttribute("data-testid"));
      expect(kinds).toEqual([
        "chat-turn-text",
        "chat-turn-tool",
        "chat-turn-text",
        "chat-turn-tool",
        "chat-turn-text",
      ]);
    });

    it("says each block exactly once for a one-tool turn", () => {
      const interleaved = [
        text("First I look."),
        toolCall("t1", "/src/app.ts"),
        toolResult("t1"),
        text("Then I answer."),
      ].join("\n");

      render(
        <ChatMessageRow
          message={message({
            rawStream: interleaved,
            content: body("First I look.", "Then I answer."),
          })}
        />,
      );

      expect(screen.getAllByText("First I look.")).toHaveLength(1);
      expect(screen.getAllByText("Then I answer.")).toHaveLength(1);
    });

    /** A stream that ended on a tool call still shows what `content` holds, appended after it. */
    it("appends the unspoken remainder of content when the stream ended on a tool call", () => {
      render(
        <ChatMessageRow
          message={message({ rawStream, content: body("Reading the file", "All done.") })}
        />,
      );

      const activity = screen.getByTestId("chat-turn-activity");
      const kinds = [
        ...activity.querySelectorAll(
          "[data-testid='chat-turn-text'],[data-testid='chat-turn-tool']",
        ),
      ].map((node) => node.getAttribute("data-testid"));
      expect(kinds).toEqual(["chat-turn-text", "chat-turn-tool", "chat-turn-text"]);
      expect(screen.getAllByText("Reading the file")).toHaveLength(1);
      expect(screen.getAllByText("All done.")).toHaveLength(1);
    });

    /**
     * The tail exists in `content` before the stream's closing text node arrives, so its key must
     * not change when that node lands - a changed key flips the renderer's id and remounts the
     * prose mid-stream.
     */
    it("keeps the tail's key stable when the closing text node arrives", () => {
      const content = body("Reading the file", "All done.");
      const tailKey = () =>
        screen.getAllByTestId("chat-turn-text").at(-1)?.getAttribute("data-segment-key");

      const { rerender } = render(<ChatMessageRow message={message({ rawStream, content })} />);
      const before = tailKey();

      rerender(
        <ChatMessageRow
          message={message({ rawStream: `${rawStream}\n${text("All done.")}`, content })}
        />,
      );

      expect(tailKey()).toBe(before);
      expect(screen.getAllByText("All done.")).toHaveLength(1);
    });

    /**
     * Stream text that is not a prefix of `content` cannot be reconciled - a daemon that replaced
     * rather than appended, or a re-read message whose body was rewritten. The body is then rendered
     * once, on its own, rather than beside stream segments that would duplicate it.
     */
    it("falls back to the single body when the stream is not a prefix of content", () => {
      const interleaved = [
        text("Something else entirely."),
        toolCall("t1", "/src/app.ts"),
        toolResult("t1"),
        text("Then I answer."),
      ].join("\n");

      render(
        <ChatMessageRow message={message({ rawStream: interleaved, content: "Then I answer." })} />,
      );

      expect(screen.queryByTestId("chat-turn-activity")).not.toBeInTheDocument();
      expect(screen.getAllByText("Then I answer.")).toHaveLength(1);
      expect(screen.queryByText("Something else entirely.")).not.toBeInTheDocument();
    });

    /**
     * The reason the old code rendered `content` rather than the stream: an in-flight answer patches
     * the `questions` fence onto `content`, and that patch has to survive the interleaving.
     */
    it("still applies the questions-fence patch to the trailing segment with tools present", () => {
      const withQuestions = [
        text("Looking into it."),
        toolCall("t1", "/src/app.ts"),
        toolResult("t1"),
        text("A question for you."),
      ].join("\n");
      const content = body(
        "Looking into it.",
        [
          "A question for you.",
          "",
          "```questions",
          "- id: q1",
          "  title: Which one?",
          "  options: [Alpha, Beta]",
          "```",
        ].join("\n"),
      );

      render(
        <ChatMessageRow
          message={message({ rawStream: withQuestions, content })}
          inProgressAnswers={{ q1: ["Alpha"] }}
        />,
      );

      const activity = screen.getByTestId("chat-turn-activity");
      expect(screen.getByText("Read")).toBeInTheDocument();
      expect(screen.getByText("Which one?")).toBeInTheDocument();
      // The fence rendered as a live block rather than as a code fence of raw YAML.
      expect(activity.textContent).not.toContain("```questions");
      // Each spoken block still appears exactly once alongside the patched fence.
      expect(screen.getAllByText("Looking into it.")).toHaveLength(1);
      expect(screen.getAllByText("A question for you.")).toHaveLength(1);
    });
  });

  /**
   * #258: the run's own account of itself, under the turn that spent it. The figures were already
   * folded out of `rawStream` for `AgentViewer`; chat simply never showed them.
   */
  describe("a turn's cost and output time", () => {
    const completed = [
      JSON.stringify({
        kind: "text",
        text: "Done.",
        delta: false,
        timestamp: "2026-09-14T10:00:00Z",
      }),
      JSON.stringify({
        kind: "result",
        is_success: true,
        duration_ms: 12000,
        timestamp: "2026-09-14T10:00:12Z",
        usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.1234, cost_source: "reported" },
      }),
    ].join("\n");

    it("renders the footer with what the run cost and how long it took", () => {
      render(<ChatMessageRow message={message({ rawStream: completed, content: "Done." })} />);

      expect(screen.getByTestId("agent-metrics-footer")).toBeInTheDocument();
      expect(screen.getByTestId("agent-metrics-cost")).toHaveTextContent("$0.1234");
      expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("12s");
      // Billed, not priced from a list: no "~".
      expect(screen.getByTestId("agent-metrics-cost")).toHaveAttribute("data-estimated", "false");
    });

    it("renders no footer for a user message", () => {
      render(
        <ChatMessageRow
          message={message({ id: "u1", role: "user", content: "hi", rawStream: undefined })}
        />,
      );

      expect(screen.queryByTestId("agent-metrics-footer")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chat-turn-metrics")).not.toBeInTheDocument();
    });

    it("renders no footer for an assistant turn with no stream", () => {
      render(<ChatMessageRow message={message({ rawStream: undefined })} />);

      expect(screen.queryByTestId("chat-turn-metrics")).not.toBeInTheDocument();
    });

    it("renders nothing when the stream carries no figures worth a line", () => {
      render(
        <ChatMessageRow
          message={message({ rawStream: JSON.stringify({ kind: "session_init" }) })}
        />,
      );

      expect(screen.queryByTestId("agent-metrics-footer")).not.toBeInTheDocument();
    });

    /**
     * A turn that was interrupted, crashed, or was cut off by a daemon restart never reports a
     * `result`. Keying completion off that wire left it ticking forever; only the session's live
     * turn is unfinished, so an abandoned one freezes at the span its own events covered.
     */
    it("freezes the clock on an abandoned turn that never reported a result", () => {
      const abandoned = [
        JSON.stringify({
          kind: "text",
          text: "Starting.",
          delta: false,
          timestamp: "2026-09-14T10:00:00Z",
        }),
        JSON.stringify({
          kind: "text",
          text: "More.",
          delta: true,
          timestamp: "2026-09-14T10:00:05Z",
        }),
      ].join("\n");

      render(<ChatMessageRow message={message({ rawStream: abandoned })} />);

      // Measured from the first event to the last, not ticking on against the wall clock.
      expect(screen.getByTestId("agent-metrics-elapsed")).toHaveTextContent("5s");
    });

    it("keeps the clock running on the turn the session is generating", () => {
      const live = JSON.stringify({
        kind: "text",
        text: "Working.",
        delta: false,
        timestamp: "2026-09-14T10:00:00Z",
      });

      render(<ChatMessageRow message={message({ rawStream: live })} isLiveTurn />);

      expect(screen.getByTestId("agent-metrics-elapsed")).toBeInTheDocument();
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
