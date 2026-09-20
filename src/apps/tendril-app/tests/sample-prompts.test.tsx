import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatView } from "../src/views/ChatView";
import { chatStore } from "../src/state/chatStore";
import { chatApi } from "../src/api/chatApi";
import type { ChatSession } from "../src/types/chat";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("Sample Prompt Chips", () => {
  const emptySession: ChatSession = {
    id: "session-empty",
    title: "Empty Session",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    spawnedJobIds: [],
    messages: [],
  };

  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([emptySession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(emptySession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders sample prompt chips when active chat has 0 messages", async () => {
    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByTestId("sample-prompts")).toBeInTheDocument();
    });

    expect(screen.getByText("Add a new project")).toBeInTheDocument();
    expect(screen.getByText("Edit verifications")).toBeInTheDocument();
    expect(screen.getByText("Create a team vault")).toBeInTheDocument();
    expect(screen.getByText("What should I work on next?")).toBeInTheDocument();
    expect(screen.getByText("What shipped this week?")).toBeInTheDocument();
  });

  it("populates composer input when clicking a sample prompt chip", async () => {
    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByTestId("sample-prompts")).toBeInTheDocument();
    });

    const chip = screen.getByText("Add a new project");
    fireEvent.click(chip);

    const textarea = screen.getByPlaceholderText(/Ask Tendril anything/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Add a new project to my tendril");
  });
});

/**
 * The chips' wrapping rule, ported from V1.
 *
 * V1's `.chat-sample-prompts` is `display: flex; flex-wrap: wrap; justify-content: center` and it
 * lives inside `.chat-thread`, which is `max-width: var(--tch-thread-width)` (775px) with
 * `margin: 0 auto`. There is no rule anywhere in V1 that counts the chips — the "3 above, 2
 * beneath" in the report is what greedy flex wrapping produces once the row has a width to wrap
 * at: as many chips as fit go on the first line, the remainder centre themselves underneath, so
 * the top row is the longer one. The same rule handles every other count for free — two short
 * chips stay on one line, seven long ones take three.
 *
 * V2 had inherited the `flex-wrap` but not the cap: nothing between the chips and the window
 * constrained the row, so on a wide window five chips always had room for one line.
 *
 * Asserted against the class list rather than a measured width because jsdom computes no layout —
 * there is no geometry here to observe, so the cap is only visible as the class that applies it.
 * `plan-markdown.css.test.ts` makes the same trade for the same reason.
 */
describe("Sample Prompt Chip Wrapping", () => {
  const emptySession: ChatSession = {
    id: "session-empty",
    title: "Empty Session",
    createdAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    spawnedJobIds: [],
    messages: [],
  };

  beforeEach(() => {
    chatStore.resetForTesting();
    vi.restoreAllMocks();
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([emptySession]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(emptySession);
    vi.spyOn(chatApi, "getQueue").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caps the empty state at the thread width, which is what gives the chips a wrap point", async () => {
    render(<ChatView />);

    const chips = await screen.findByTestId("sample-prompts");

    // `max-w-3xl` is 48rem/768px — the same cap `ChatMessageList` and the composer already use for
    // the thread column, and V1's 775px thread width to within a rounding of the token scale.
    expect(chips.parentElement?.className).toContain("max-w-3xl");
  });

  it("wraps the row at that cap rather than scrolling or clipping it", async () => {
    render(<ChatView />);

    const chips = await screen.findByTestId("sample-prompts");

    // `w-full` is what makes the wrap happen at the column's width: without it the row is a
    // shrink-to-fit flex item and its wrap point depends on the parent's alignment rather than
    // on the cap.
    expect(chips.className).toContain("flex-wrap");
    expect(chips.className).toContain("w-full");
  });
});
