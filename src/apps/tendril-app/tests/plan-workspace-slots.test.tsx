import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { PlanDetailView, findPlanChatSession } from "../src/views/PlanDetailView";
import { bridge } from "../src/api/bridge";
import { chatApi } from "../src/api/chatApi";
import { job } from "./fixtures/job.fixture";
import { planDetail, planGit, verification } from "./fixtures/plan.fixture";
import type { PlanDetail } from "../src/types/api";
import type { ChatSession } from "../src/types/chat";

/**
 * The plan page's frame, now that it renders `PlanWorkspace` rather than a hand-rolled header.
 *
 * V1's composition is `ContentView.Build`:
 * `actions.ApplyTo(new PlanWorkspace(tabContent, new PlanChatView(plan),
 * new VerificationsPanelView(plan, ...), questionsPanel).PlanId(...).Title(...).ProjectBadges(...)
 * .Meta(...).Source(...).Tabs(...).SelectedTab(...).QuestionsLabel(...).UnansweredQuestions(...)
 * .OnTabSelect(...))`. Every assertion below names the part of that expression it is checking.
 */

const QUESTIONS_PLAN = `# Build Desktop Operator Experience

## Problem

The operator cannot answer a plan's questions.

\`\`\`questions
questions:
  - id: store
    title: Which store should hold the answers?
    options:
      - title: SQLite
        value: sqlite
      - title: Files
        value: files
  - id: telemetry
    title: Should we ship telemetry?
    optional: true
  - id: naming
    title: What should the route be called?
    answer: revisions/latest
\`\`\`

## Approach

Wire the Questions slot.

\`\`\`md
## Not A Real Heading
\`\`\`

### Details
`;

function plan(overrides: Partial<PlanDetail> = {}): PlanDetail {
  return planDetail({
    id: "00021",
    state: "Draft",
    revisionCount: 2,
    dependsOn: [],
    verifications: [verification("RustClippy", "Pass")],
    latestRevisionContent: "# Build Desktop Operator Experience\n\n## Problem\n\n### Detail\n",
    ...overrides,
  });
}

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "sess-1",
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
  vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
  vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
  vi.spyOn(bridge, "listPullRequests").mockResolvedValue([]);
  vi.spyOn(bridge, "getPlanGit").mockResolvedValue(planGit());
  vi.spyOn(bridge, "getRepoStatus").mockResolvedValue([]);
  vi.spyOn(bridge, "listAnnotations").mockResolvedValue([]);
  vi.spyOn(bridge, "listProjects").mockResolvedValue([]);
  vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the workspace topbar", () => {
  it("renders the plan id, title, meta line and source link", () => {
    const { container } = render(
      <PlanDetailView plan={plan()} allPlans={[{ ...plan(), verifications: [] }]} />,
    );

    const topbar = container.querySelector(".pws-topbar");
    expect(topbar).not.toBeNull();
    // `.PlanId($"#{selectedPlan.Id}")` — `#21`, not `#00021`.
    expect(topbar?.querySelector(".pws-plan-id")?.textContent).toBe("#21");
    expect(topbar?.querySelector(".pws-title")?.textContent).toBe(
      "Build Desktop Operator Experience",
    );
    // `.Meta(BuildMeta(...))` — position in the list.
    expect(topbar?.querySelector(".pws-meta")?.textContent).toContain("1/1 plans");
    // `.Source(SourceUrl, IsPullRequestSource ? "PR" : "Issue")`.
    expect(screen.getByRole("link", { name: "Issue" })).toHaveAttribute(
      "href",
      "https://github.com/SpaceCorps/Tendril-App/issues/7",
    );
  });

  it("fills the ProjectBadges slot with the state, the project and the level", () => {
    const { container } = render(<PlanDetailView plan={plan()} />);

    const badges = container.querySelector(".pws-project-badges");
    expect(badges).not.toBeNull();
    expect(badges?.textContent).toContain("Draft");
    expect(badges?.textContent).toContain("Tendril-App");
    expect(badges?.textContent).toContain("Feature");
    expect(screen.getByTestId("plan-state-badge")).toHaveTextContent("Draft");
  });

  /**
   * `DraftActions`: "Update and Share as icons, everything else in the overflow menu", with
   * `SetPrimary("Execute", ...)` as the one labelled CTA and `AddSecondary` for the badged roll-up.
   */
  it("places Update as an icon action, Execute as the primary, and the rest in the overflow menu", () => {
    const { container } = render(<PlanDetailView plan={plan()} />);

    const icon = screen.getByRole("button", { name: "Update Plan…" });
    expect(icon).toHaveClass("pws-icon-btn");
    expect(icon).toHaveAttribute("data-tag", "update");

    const primary = container.querySelector(".pws-btn--primary");
    expect(primary).toHaveAttribute("data-tag", "execute");

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(menu.textContent).toContain("Expand Plan");
    expect(menu.textContent).toContain("Split Plan");
    expect(menu.textContent).toContain("Delete Plan…");
    expect(menu.textContent).toContain("Discuss with agent");
    // `danger: true` on Delete.
    expect(screen.getByRole("menuitem", { name: /^Delete Plan/ })).toHaveAttribute(
      "data-danger",
      "true",
    );
  });

  /**
   * `AddSecondary("UpdatePlan", "Update Plan", ..., badge: (activeAnnotationCount +
   * answeredQuestions))` — "Both kinds of pending work go through one button, because one job answers
   * both: an UpdatePlan that folds them into the plan. The badge counts them together."
   */
  it("badges the secondary Update Plan button with the pending annotations and answers", async () => {
    vi.spyOn(bridge, "listAnnotations").mockResolvedValue([
      {
        id: "a1",
        selectedText: "Problem",
        comment: "Say more",
        startOffset: 0,
        endOffset: 7,
        isResolved: false,
      },
    ]);

    const { container } = render(
      <PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />,
    );

    // One unresolved annotation plus the one question already carrying an answer.
    await waitFor(() =>
      expect(
        container.querySelector('.pws-btn--secondary[data-tag="UpdatePlan"]')?.textContent,
      ).toContain("2"),
    );
  });

  /** `if (activeAnnotationCount > 0 || answeredQuestions > 0)` — the button only exists to clear work. */
  it("has no secondary Update Plan button when there is no pending work", async () => {
    const { container } = render(<PlanDetailView plan={plan()} />);

    // The annotation list is fetched on mount, so let it land before concluding there is none.
    await waitFor(() => expect(bridge.listAnnotations).toHaveBeenCalled());
    expect(container.querySelector('.pws-btn--secondary[data-tag="UpdatePlan"]')).toBeNull();
  });

  /**
   * An answer picked on the page counts towards the badge immediately, because it is written back into
   * the same revision on the click — the badge is not waiting for a refetch to tell it what happened.
   */
  it("takes an answer into the badge as soon as it is written", async () => {
    vi.spyOn(bridge, "updateLatestRevision").mockResolvedValue({
      revision: 2,
      message: "Revision 002 updated",
    });
    const withoutAnswers = QUESTIONS_PLAN.replace("    answer: revisions/latest\n", "");
    const { container } = render(
      <PlanDetailView plan={plan({ latestRevisionContent: withoutAnswers })} />,
    );

    await waitFor(() => expect(bridge.listAnnotations).toHaveBeenCalled());
    expect(container.querySelector('.pws-btn--secondary[data-tag="UpdatePlan"]')).toBeNull();

    fireEvent.click(await waitFor(() => screen.getByText("SQLite")));

    await waitFor(() =>
      expect(
        container.querySelector('.pws-btn--secondary[data-tag="UpdatePlan"]')?.textContent,
      ).toContain("1"),
    );
  });

  /**
   * `disabled: HasActiveJob<UpdatePlanArgs>()` — "the guard is stated twice because a disabled button
   * that still fires is how a plan gets two agents rewriting it at once". An UpdatePlan job does not
   * make the plan in-flight, so the button stays on screen; it is only refused.
   */
  it("disables the Update Plan button while an UpdatePlan job is already running", async () => {
    const { container } = render(
      <PlanDetailView
        plan={plan({ latestRevisionContent: QUESTIONS_PLAN })}
        jobs={[job({ id: "00200", type: "UpdatePlan", status: "Running" })]}
      />,
    );

    const secondary = await waitFor(() => {
      const found = container.querySelector('.pws-btn--secondary[data-tag="UpdatePlan"]');
      expect(found).not.toBeNull();
      return found as HTMLButtonElement;
    });
    expect(secondary).toBeDisabled();
    // And the icon action that opens the same dialog is refused for the same reason.
    expect(screen.getByRole("button", { name: "Update Plan…" })).toBeDisabled();
  });

  it("offers no plan-writing action while a job holds the plan", () => {
    const { container } = render(<PlanDetailView plan={plan({ state: "Executing" })} />);

    expect(container.querySelector(".pws-btn--primary")).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });
});

describe("the workspace tab strip", () => {
  it("is a tablist in V1's order, with Verifications as a corner dropdown rather than a tab", () => {
    render(<PlanDetailView plan={plan()} />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const labels = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(labels.slice(0, 2)).toEqual(["Plan", "Details"]);
    expect(screen.queryByRole("tab", { name: /Verifications/ })).not.toBeInTheDocument();
  });

  /** `new VerificationsPanelView(selectedPlan, planService, config, chatExecution)`. */
  it("fills the Verifications slot from the tab strip's corner", async () => {
    render(<PlanDetailView plan={plan()} />);

    expect(screen.queryByTestId("plan-verifications")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Verifications" }));

    await waitFor(() => expect(screen.getByTestId("plan-verifications")).toBeInTheDocument());
    expect(screen.getByTestId("verification-checkbox-RustClippy")).toBeInTheDocument();
  });
});

/**
 * The plan document has no table of contents, and `PlanMarkdown`'s pinned `StickyContent` slot is left
 * empty — which is what V1 does: `Apps/Plans/ContentView.Build` never fills it.
 *
 * A contents panel lived in that slot earlier, added at the user's request when the plan page had no
 * navigation, questions or chat at all. They then asked for it back out: it took width from the chat
 * beside it, which is the surface that earns it. This test is inverted rather than deleted so that
 * re-adding it is a deliberate act with a failing test attached, not drift.
 */
describe("the pinned StickyContent slot", () => {
  it("is left empty, as V1 leaves it", () => {
    const { container } = render(
      <PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />,
    );

    expect(screen.queryByTestId("plan-toc")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Plan contents" })).not.toBeInTheDocument();
    // Nothing is pinned beside the document, so the chat keeps the width.
    expect(container.querySelector(".pmv-sticky")?.textContent ?? "").toBe("");
  });

  /** The widget's own slot stays: V1 has it too and simply passes nothing to it. */
  it("still renders the plan document itself", () => {
    const { container } = render(
      <PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />,
    );

    expect(container.querySelector(".pmv-markdown")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Problem" })).toBeInTheDocument();
  });
});

describe("the Questions slot", () => {
  /**
   * `QuestionsPanelView`: the count line, the strikethrough on an answered entry, and the
   * "(Optional)" suffix that stays live until answered because "optional means the plan does not wait
   * on it, not that anybody has dealt with it".
   */
  it("indexes every question, with V1's count line, strikethrough and Optional suffix", async () => {
    render(<PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />);

    fireEvent.click(screen.getByRole("button", { name: /^Questions/ }));

    const panel = await waitFor(() => screen.getByTestId("plan-questions-panel"));
    expect(panel.textContent).toContain("1 of 3 answered");
    expect(screen.getByTestId("plan-question-store")).not.toHaveClass("line-through");
    expect(screen.getByTestId("plan-question-naming")).toHaveClass("line-through");
    expect(screen.getByTestId("plan-question-telemetry").textContent).toBe(
      "Should we ship telemetry? (Optional)",
    );
  });

  /** `.QuestionsLabel(unanswered > 0 ? $"Questions ({unanswered} unanswered)" : "Questions")`. */
  it("counts the unanswered questions in the tool label, optional ones included", () => {
    render(<PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />);

    expect(screen.getByRole("button", { name: "Questions (2 unanswered)" })).toBeInTheDocument();
  });

  it("has no Questions tool at all on a plan with no questions", () => {
    render(<PlanDetailView plan={plan()} />);

    expect(screen.queryByRole("button", { name: /^Questions/ })).not.toBeInTheDocument();
  });

  /**
   * `new QuestionsPanelView(questions, id => { selectedTab.Set(PlanTab); scrollTo.Set(...) })` — an
   * entry clicked from another tab brings the reader back to the plan first.
   */
  it("returns to the Plan tab when an entry is clicked", async () => {
    render(<PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />);

    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByText("Repositories")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Questions/ }));
    fireEvent.click(await waitFor(() => screen.getByTestId("plan-question-store")));

    expect(screen.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("answering a question", () => {
  /**
   * V1's `ContentView.ApplyAnswer` merges the answer into the same revision and writes it back with
   * `UpdateLatestRevision`. The in-place write is the whole point: falling back to `writeRevision`
   * would **append**, which claims the agent produced a new plan and inflates `revisionCount` — the
   * term `executeGuards.unfoldedAnswerCount` reads as `revisionCount === 1`, so a single answer would
   * switch that guard off.
   */
  it("writes the answer back into the same revision, and never appends one", async () => {
    const writeRevision = vi.spyOn(bridge, "writeRevision");
    const update = vi
      .spyOn(bridge, "updateLatestRevision")
      .mockResolvedValue({ revision: 2, message: "Revision 002 updated" });
    render(<PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />);

    const sqlite = await waitFor(() => screen.getByText("SQLite"));
    fireEvent.click(sqlite);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const [planId, written] = update.mock.calls[0];
    expect(planId).toBe("00021");
    // Only the addressed question's `answer` key moved; the rest of the document is untouched.
    expect(written).toContain('answer: "sqlite"');
    expect(written).toContain("answer: revisions/latest");
    expect(written).toContain("## Approach");

    // The index has taken the answer: two answered of three.
    fireEvent.click(screen.getByRole("button", { name: /^Questions/ }));
    await waitFor(() =>
      expect(screen.getByTestId("plan-questions-panel").textContent).toContain("2 of 3 answered"),
    );
    expect(screen.getByTestId("plan-question-store")).toHaveClass("line-through");

    // Nothing was appended, and nothing failed.
    expect(writeRevision).not.toHaveBeenCalled();
    expect(screen.queryByTestId("plan-action-error")).not.toBeInTheDocument();
  });

  /** The revision number the service reports back is the one that did not move. */
  it("keeps the revision count where it was", async () => {
    const update = vi
      .spyOn(bridge, "updateLatestRevision")
      .mockResolvedValue({ revision: 2, message: "Revision 002 updated" });
    render(
      <PlanDetailView plan={plan({ revisionCount: 2, latestRevisionContent: QUESTIONS_PLAN })} />,
    );

    fireEvent.click(await waitFor(() => screen.getByText("SQLite")));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await expect(update.mock.results[0].value).resolves.toMatchObject({ revision: 2 });
  });

  /** The dot and the label follow the answer, as V1's do: both read the revision the page holds. */
  it("drops the unanswered count as soon as the answer lands", async () => {
    vi.spyOn(bridge, "updateLatestRevision").mockResolvedValue({
      revision: 2,
      message: "Revision 002 updated",
    });
    render(<PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />);

    expect(screen.getByRole("button", { name: "Questions (2 unanswered)" })).toBeInTheDocument();

    fireEvent.click(await waitFor(() => screen.getByText("SQLite")));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Questions (1 unanswered)" })).toBeInTheDocument(),
    );
  });

  /**
   * A refused write is rolled back. An answer left on the page after the service said no would be
   * counted by the Update Plan badge and by the execute guard as though it were on disk.
   */
  it("rolls the answer back and says why when the write is refused", async () => {
    vi.spyOn(bridge, "updateLatestRevision").mockRejectedValue(new Error("daemon unreachable"));
    render(<PlanDetailView plan={plan({ latestRevisionContent: QUESTIONS_PLAN })} />);

    fireEvent.click(await waitFor(() => screen.getByText("SQLite")));

    await waitFor(() =>
      expect(screen.getByTestId("plan-action-error")).toHaveTextContent(/Failed to save answer/),
    );
    // Back to one of three, and the entry is live again.
    expect(screen.getByRole("button", { name: "Questions (2 unanswered)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Questions/ }));
    await waitFor(() =>
      expect(screen.getByTestId("plan-questions-panel").textContent).toContain("1 of 3 answered"),
    );
  });
});

describe("the Chat slot", () => {
  /**
   * `isShareMode ? null : new PlanChatView(selectedPlan)`, under `PlanChatView.Headline`.
   *
   * The panel is `Chat.ContentView(embedded: true)` — the real chat view — so these assertions are
   * about what V1's embedded mode shows, and the chat's own behaviour is covered by every
   * `ChatView` test there already is.
   */
  it("renders the plan's chat beside it, with V1's headline and a composer", async () => {
    const { container } = render(<PlanDetailView plan={plan()} />);

    const aside = container.querySelector(".pws-chat");
    expect(aside).not.toBeNull();
    expect(aside?.getAttribute("aria-label")).toBe("Plan chat");
    expect(await screen.findByTestId("embedded-chat-view")).toBeInTheDocument();
    expect(screen.getByText("Ask Tendril to Change Anything")).toBeInTheDocument();
    // The plan's own name, which is `ContentView`'s `greeting` in embedded mode.
    expect(screen.getByText("#21 Build Desktop Operator Experience")).toBeInTheDocument();
    expect(container.querySelector(".pws-chat textarea")).not.toBeNull();
    // V1's resizer, which `chatWidth.ts` persists.
    expect(screen.getByRole("separator", { name: "Resize chat" })).toBeInTheDocument();
  });

  it("shows the plan's own session, found by the folder it records", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([
      session({ id: "other", planFolderName: "00099-SomethingElse" }),
      session(),
    ]);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(
      session({
        messages: [
          {
            id: "m1",
            role: "assistant",
            content: "I looked at the plan.",
            timestamp: "2026-09-07T10:00:00Z",
          },
        ],
      }),
    );

    render(<PlanDetailView plan={plan()} />);

    await waitFor(() => expect(screen.getByText("I looked at the plan.")).toBeInTheDocument());
  });

  /**
   * `PlanActionDto.focusChat`: "Puts the caret in the chat composer when fired, so 'Update' starts a
   * conversation." V1's own opening line comes from `PlanChatSessions.DiscussPrompt`.
   */
  it("puts the caret in the composer and drafts V1's opening line for Discuss with agent", () => {
    const { container } = render(<PlanDetailView plan={plan()} />);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Discuss with agent" }));

    const composer = container.querySelector<HTMLTextAreaElement>(".pws-chat textarea");
    expect(composer).not.toBeNull();
    expect(document.activeElement).toBe(composer);
    expect(composer?.value).toContain("I want to discuss this plan before executing it");
  });

  it("phrases the opening line for a finished plan instead", () => {
    const { container } = render(
      <PlanDetailView plan={plan({ state: "Failed", verifications: [] })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Discuss with agent" }));

    expect(container.querySelector<HTMLTextAreaElement>(".pws-chat textarea")?.value).toContain(
      "I want to discuss the outcome of this plan",
    );
  });

  /**
   * `PlanChatView`: "The session is created on the first message, so opening the panel to look leaves
   * nothing behind." `planFolderName` is what attaches it, per `PlanChatSessions.CreateForPlan`, and it
   * is the only thing that lets the panel find the conversation again next time.
   */
  it("creates the plan's session on the first message, attached to the plan", async () => {
    const created = session({ id: "sess-new", messages: [] });
    const listSessions = vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    const createSession = vi.spyOn(chatApi, "createSession").mockResolvedValue(created);
    const executeTurn = vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);
    vi.spyOn(chatApi, "getSession").mockResolvedValue(created);

    const { container } = render(<PlanDetailView plan={plan()} />);

    // Nothing is created merely by opening the panel.
    await waitFor(() => expect(listSessions).toHaveBeenCalled());
    expect(createSession).not.toHaveBeenCalled();

    const composer = container.querySelector<HTMLTextAreaElement>(".pws-chat textarea")!;
    fireEvent.change(composer, { target: { value: "Tighten the approach" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          // `$"#{plan.Id} {plan.Title}"`, so the session is recognisable in the Chat app's own list.
          title: "#21 Build Desktop Operator Experience",
          planFolderName: "00021-BuildDesktopOperator",
        }),
      ),
    );
    // And the message goes into the session that was just made, not nowhere.
    await waitFor(() =>
      expect(executeTurn).toHaveBeenCalledWith(
        "sess-new",
        expect.objectContaining({ prompt: "Tighten the approach" }),
      ),
    );
  });

  it("sends into the plan's session when it has one, without creating another", async () => {
    vi.spyOn(chatApi, "listSessions").mockResolvedValue([session()]);
    const getSession = vi.spyOn(chatApi, "getSession").mockResolvedValue(session());
    const executeTurn = vi.spyOn(chatApi, "executeTurn").mockResolvedValue(undefined);
    const createSession = vi.spyOn(chatApi, "createSession");

    const { container } = render(<PlanDetailView plan={plan()} />);
    await waitFor(() => expect(getSession).toHaveBeenCalledWith("sess-1"));

    const composer = container.querySelector<HTMLTextAreaElement>(".pws-chat textarea")!;
    fireEvent.change(composer, { target: { value: "Tighten the approach" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(executeTurn).toHaveBeenCalledWith(
        "sess-1",
        expect.objectContaining({ prompt: "Tighten the approach" }),
      ),
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  /** `ChatStore.sendMessage` reports a refused turn in the chat's own error banner. */
  it("reports a refused session creation rather than losing the message silently", async () => {
    vi.spyOn(chatApi, "createSession").mockRejectedValue(new Error("daemon unreachable"));
    const listSessions = vi.spyOn(chatApi, "listSessions").mockResolvedValue([]);
    const { container } = render(<PlanDetailView plan={plan()} />);
    await waitFor(() => expect(listSessions).toHaveBeenCalled());

    const composer = container.querySelector<HTMLTextAreaElement>(".pws-chat textarea")!;
    fireEvent.change(composer, { target: { value: "Tighten the approach" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByText("daemon unreachable")).toBeInTheDocument());
  });
});

describe("findPlanChatSession", () => {
  /** `PlanChatSessions.BelongsTo`, matched case-insensitively as V1's `OrdinalIgnoreCase` does. */
  it("matches the folder the session records, whatever its case", () => {
    const found = findPlanChatSession([session({ planFolderName: "00021-BUILDDESKTOPOPERATOR" })], {
      ...plan(),
    });
    expect(found?.id).toBe("sess-1");
  });

  it("falls back to the plan's id prefix when the plan carries no folder path", () => {
    const found = findPlanChatSession([session({ planFolderName: "00021-Whatever" })], {
      ...plan(),
      folderPath: undefined,
    });
    expect(found?.id).toBe("sess-1");
  });

  it("claims no session for another plan", () => {
    expect(
      findPlanChatSession([session({ planFolderName: "00099-Other" })], {
        ...plan(),
      }),
    ).toBeUndefined();
  });
});

describe("the workspace's keyboard shortcuts", () => {
  /** `SetPrimary("Execute", ..., "x")`. */
  it("fires the primary action from its key while nothing editable has focus", async () => {
    const onExecute = vi.fn();
    render(<PlanDetailView plan={plan()} onExecute={onExecute} />);

    fireEvent.keyDown(document.body, { key: "x", code: "KeyX" });

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
  });

  /**
   * `Action("Update", "Update", Icons.WandSparkles, ctx.ShowUpdateDialog, "U")`. Asserted on its own
   * render: Execute moves the plan to `Creating` optimistically, and a plan a job holds offers no
   * actions at all, so the two keys cannot be exercised against one mount.
   */
  it("fires an icon action from its key", async () => {
    render(<PlanDetailView plan={plan()} />);

    fireEvent.keyDown(document.body, { key: "u", code: "KeyU" });

    expect(await screen.findByTestId("update-plan-dialog")).toBeInTheDocument();
  });

  it("stays quiet while the chat composer has focus", async () => {
    const onExecute = vi.fn();
    const { container } = render(<PlanDetailView plan={plan()} onExecute={onExecute} />);

    const composer = container.querySelector<HTMLTextAreaElement>(".pws-chat textarea")!;
    act(() => composer.focus());
    fireEvent.keyDown(composer, { key: "x", code: "KeyX" });

    await waitFor(() => expect(onExecute).not.toHaveBeenCalled());
  });

  /**
   * The registry keys registrations by id, and the id used to be `planWorkspace:${tag}` for every
   * instance: the second workspace to mount overwrote the first's entry, and the first to unmount then
   * deleted the second's. `ReviewView` is adopting the same widget, so two mounted at once is a real
   * arrangement, not a hypothetical.
   */
  it("has both mounted workspaces answer the key, not just the last one to register", async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(<PlanDetailView plan={plan()} onExecute={first} />);
    render(<PlanDetailView plan={plan({ id: "00022" })} onExecute={second} />);

    fireEvent.keyDown(document.body, { key: "x", code: "KeyX" });

    // With one shared id there is one registration, so only one of these would ever be called.
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("leaves the survivor's keys alive when the other workspace unmounts", async () => {
    const { unmount } = render(<PlanDetailView plan={plan()} />);
    render(<PlanDetailView plan={plan({ id: "00022" })} />);

    // With one shared id, this cleanup deletes the registration the second mount made.
    unmount();
    fireEvent.keyDown(document.body, { key: "u", code: "KeyU" });

    expect(await screen.findByTestId("update-plan-dialog")).toBeInTheDocument();
  });
});
