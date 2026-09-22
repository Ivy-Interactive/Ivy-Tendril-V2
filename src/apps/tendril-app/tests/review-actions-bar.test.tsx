import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ReviewActionsBarView,
  conditionVerdictsFrom,
  evaluateCondition,
  evaluateConditionState,
  getReviewActionTooltip,
} from "../src/components/ReviewActionsBarView";
import { ReviewView } from "../src/views/ReviewView";
import { bridge } from "../src/api/bridge";
import { planSummary } from "./fixtures/plan.fixture";
import type { ReviewActionConfig } from "../src/types/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("evaluateCondition", () => {
  it("returns true for empty or undefined condition", () => {
    expect(evaluateCondition(undefined)).toBe(true);
    expect(evaluateCondition("")).toBe(true);
    expect(evaluateCondition("   ")).toBe(true);
  });

  it("handles literal booleans", () => {
    expect(evaluateCondition("$true")).toBe(true);
    expect(evaluateCondition("true")).toBe(true);
    expect(evaluateCondition("$false")).toBe(false);
    expect(evaluateCondition("false")).toBe(false);
  });

  it("evaluates -or expressions", () => {
    expect(evaluateCondition("$false -or $true")).toBe(true);
    expect(evaluateCondition("$false -or $false")).toBe(false);
  });

  it("evaluates -and expressions", () => {
    expect(evaluateCondition("$true -and $true")).toBe(true);
    expect(evaluateCondition("$true -and $false")).toBe(false);
  });

  it("evaluates Test-Path against provided paths", () => {
    const context = {
      existingPaths: ["/repo/src/App.tsx", "/repo/package.json"],
    };
    expect(evaluateCondition('Test-Path "package.json"', context)).toBe(true);
    expect(evaluateCondition('Test-Path "missing.txt"', context)).toBe(false);
  });
});

describe("getReviewActionTooltip", () => {
  const action: ReviewActionConfig = {
    name: "Serve Web",
    condition: 'Test-Path "dist"',
    command: "pnpm preview",
  };

  it("formats disabled tooltip when condition is not met", () => {
    expect(getReviewActionTooltip(action, false)).toBe(
      'Disabled: Condition not met (Test-Path "dist")',
    );

    const noCondAction: ReviewActionConfig = {
      name: "Serve Web",
      condition: "",
      command: "pnpm preview",
    };
    expect(getReviewActionTooltip(noCondAction, false)).toBe("Disabled: Condition not met");
  });

  it("formats run tooltip without ports", () => {
    expect(getReviewActionTooltip(action, true)).toBe("Run: pnpm preview");
  });

  it("formats run tooltip with alphabetically sorted allocated ports", () => {
    const ports = {
      web: 3000,
      api: 8080,
    };
    expect(getReviewActionTooltip(action, true, ports)).toBe(
      "Run: pnpm preview (ports: api: 8080, web: 3000)",
    );
  });

  it("falls back to action name if command is empty", () => {
    const emptyCmdAction: ReviewActionConfig = {
      name: "Custom Step",
      condition: "$true",
      command: "",
    };
    expect(getReviewActionTooltip(emptyCmdAction, true)).toBe("Run Custom Step");
  });
});

describe("ReviewActionsBarView component", () => {
  const actions: ReviewActionConfig[] = [
    {
      name: "Run Tests",
      condition: "$true",
      command: "pnpm test",
    },
    {
      name: "Start Server",
      condition: "$false",
      command: "pnpm start",
    },
  ];

  it("renders nothing when actions list is empty", () => {
    const { container } = render(<ReviewActionsBarView actions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  /*
   * Asserted as the accessible description rather than a `title`, deliberately: the native `title`
   * was the bug. A disabled button emits no pointer events, so the one tooltip explaining it never
   * showed. The hover itself is covered in "ReviewActionsBarView disabled reasons" below.
   */
  it("renders action buttons with correct enabled/disabled state and descriptions", () => {
    render(<ReviewActionsBarView actions={actions} allocatedPorts={{ http: 8080 }} />);

    const enabledBtn = screen.getByRole("button", { name: "Run Tests" });
    expect(enabledBtn).toBeEnabled();
    expect(enabledBtn).toHaveAccessibleDescription("Run: pnpm test (ports: http: 8080)");
    expect(enabledBtn).not.toHaveAttribute("title");

    const disabledBtn = screen.getByRole("button", { name: "Start Server" });
    expect(disabledBtn).toBeDisabled();
    expect(disabledBtn).toHaveAccessibleDescription("Disabled: Condition not met ($false)");
    expect(disabledBtn).not.toHaveAttribute("title");
  });

  it("calls onExecuteAction callback when clicked", async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);
    render(<ReviewActionsBarView actions={actions} onExecuteAction={onExecute} />);

    const enabledBtn = screen.getByRole("button", { name: "Run Tests" });
    fireEvent.click(enabledBtn);

    await waitFor(() => expect(onExecute).toHaveBeenCalledWith("Run Tests"));
  });

  it("calls bridge.executeReviewAction when onExecuteAction is not provided", async () => {
    const executeSpy = vi
      .spyOn(bridge, "executeReviewAction")
      .mockResolvedValue({ sessionId: "s1", encoding: "base64", rows: 24, cols: 80 });

    render(<ReviewActionsBarView project="MyProject" planId="00123" actions={actions} />);

    const enabledBtn = screen.getByRole("button", { name: "Run Tests" });
    fireEvent.click(enabledBtn);

    await waitFor(() => expect(executeSpy).toHaveBeenCalledWith("MyProject", "Run Tests", "00123"));
  });

  it("respects actionStates override if provided", () => {
    render(
      <ReviewActionsBarView
        actions={actions}
        actionStates={{
          "Run Tests": false,
          "Start Server": true,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Run Tests" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start Server" })).toBeEnabled();
  });
});

describe("ReviewView integration with ReviewActionsBarView", () => {
  const samplePlan = planSummary({
    id: "00509",
    project: "Ivy-Tendril-V2",
    state: "Review",
  });

  it("fetches and renders project review actions", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getPlan").mockResolvedValue({
      ...samplePlan,
      revisionCount: 1,
      repos: [],
      dependsOn: [],
      relatedPlans: [],
      commits: [],
      prs: [],
      recommendations: [],
      allocatedPorts: { dev: 5173 },
    });
    vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([
      {
        name: "Dev Server",
        condition: "$true",
        command: "vp dev",
      },
    ]);
    const executeSpy = vi
      .spyOn(bridge, "executeReviewAction")
      .mockResolvedValue({ sessionId: "s1", encoding: "base64", rows: 24, cols: 80 });

    render(<ReviewView plans={[samplePlan]} onSelectPlan={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId("review-actions-bar-container")).toBeInTheDocument();
    });

    const actionBtn = screen.getByRole("button", { name: "Dev Server" });
    expect(actionBtn).toBeInTheDocument();
    expect(actionBtn).toBeEnabled();

    fireEvent.click(actionBtn);

    await waitFor(() => {
      expect(executeSpy).toHaveBeenCalledWith("Ivy-Tendril-V2", "Dev Server", "00509");
    });
  });

  /**
   * The run has to be started by the view that shows it, or its first output — the banner with the
   * app's URL in it — is printed to nobody. So a shell that can host the view gets the action handed
   * to it instead of the bridge being called here.
   */
  it("hands the action to the shell instead of starting it blind", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([
      { name: "Dev Server", condition: "$true", command: "vp dev" },
    ]);
    const executeSpy = vi.spyOn(bridge, "executeReviewAction");
    const onOpenReviewAction = vi.fn();

    render(
      <ReviewView
        plans={[samplePlan]}
        onSelectPlan={() => {}}
        onOpenReviewAction={onOpenReviewAction}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Dev Server" }));

    await waitFor(() => {
      expect(onOpenReviewAction).toHaveBeenCalledWith({
        project: "Ivy-Tendril-V2",
        actionName: "Dev Server",
        planId: "00509",
      });
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });
});

/**
 * The case V1 does not have. `PlatformHelper.EvaluatePowerShellCondition` runs the condition against
 * the real filesystem, so every condition reaches a verdict and a button is disabled only on a verdict
 * of "does not hold". This evaluator has no filesystem, so it has to distinguish a condition that
 * failed from one it never ran - folding the second into the first disabled every conditioned review
 * action in the app permanently, under a tooltip claiming the condition had been checked.
 */
describe("evaluateConditionState", () => {
  it("decides what it can, exactly as evaluateCondition does", () => {
    expect(evaluateConditionState(undefined)).toBe(true);
    expect(evaluateConditionState("$true")).toBe(true);
    expect(evaluateConditionState("$false")).toBe(false);
    expect(evaluateConditionState("$false -or $true")).toBe(true);
    expect(evaluateConditionState("$true -and $false")).toBe(false);
    expect(
      evaluateConditionState('Test-Path "package.json"', { existingPaths: ["/r/package.json"] }),
    ).toBe(true);
    expect(
      evaluateConditionState('Test-Path "gone.txt"', { existingPaths: ["/r/package.json"] }),
    ).toBe(false);
  });

  it("reports a Test-Path with nothing to test against as undecided, not as failed", () => {
    expect(evaluateConditionState('Test-Path "dist"')).toBe("unknown");
    expect(evaluateConditionState("Test-Path src/apps/tendril-app")).toBe("unknown");
  });

  it("reports grammar outside its subset as undecided", () => {
    expect(evaluateConditionState("$env:CI -eq 'true'")).toBe("unknown");
  });

  it("short-circuits three-valued logic the way PowerShell would", () => {
    // One true settles an -or; one false settles an -and. Only a genuinely open question stays open.
    expect(evaluateConditionState('$true -or Test-Path "dist"')).toBe(true);
    expect(evaluateConditionState('$false -or Test-Path "dist"')).toBe("unknown");
    expect(evaluateConditionState('$false -and Test-Path "dist"')).toBe(false);
    expect(evaluateConditionState('$true -and Test-Path "dist"')).toBe("unknown");
  });

  it("keeps evaluateCondition's own contract, which tendril-core mirrors for hooks", () => {
    // A hook whose condition cannot be evaluated does not run, so undecided reads as false here.
    expect(evaluateCondition('Test-Path "dist"')).toBe(false);
    expect(evaluateCondition("$env:CI -eq 'true'")).toBe(false);
  });
});

describe("ReviewActionsBarView undecidable conditions", () => {
  const action: ReviewActionConfig = {
    name: "Dev Server",
    condition: "Test-Path src/apps/tendril-app",
    command: "pnpm dev:app",
  };

  it("disables the action and says the condition was not matched", () => {
    render(<ReviewActionsBarView actions={[action]} />);

    const btn = screen.getByRole("button", { name: "Dev Server" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(
      "Disabled: Condition not met (Test-Path src/apps/tendril-app)",
    );
  });

  it("defers to a host that did evaluate the condition", () => {
    render(<ReviewActionsBarView actions={[action]} actionStates={{ "Dev Server": false }} />);

    const btn = screen.getByRole("button", { name: "Dev Server" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(
      "Disabled: Condition not met (Test-Path src/apps/tendril-app)",
    );
  });

  it("only quiets the button that was pressed, since V1 allows duplicate action tabs", async () => {
    let release: (() => void) | undefined;
    const onExecute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <ReviewActionsBarView
        actions={[
          { name: "Dev Server", condition: "$true", command: "pnpm dev:app" },
          { name: "Docs", condition: "$true", command: "pnpm docs" },
        ]}
        onExecuteAction={onExecute}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dev Server" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Dev Server" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Docs" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));
    await waitFor(() => expect(onExecute).toHaveBeenCalledWith("Docs"));
    // Inside `act`: settling the handover re-renders the bar from its `finally`.
    await act(async () => {
      release?.();
    });
  });
});

/**
 * Hovers a review-action button's wrapper, which is where the tooltip is anchored: a disabled button
 * emits no pointer events of its own, so the wrapper is where the hover has to land for the reason
 * to show. jsdom cannot say whether a real pointer gets there — it applies no `pointer-events` and
 * blocks nothing on a disabled element — so the `disabled:pointer-events-none` that lets the hover
 * through is pinned by a class assertion in the test that uses this, not by this.
 */
function hoverAction(button: HTMLElement): void {
  const wrapper = button.parentElement!;
  fireEvent.pointerEnter(wrapper, { pointerType: "mouse" });
  fireEvent.pointerMove(wrapper, { pointerType: "mouse" });
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

describe("ReviewActionsBarView disabled reasons", () => {
  const docs: ReviewActionConfig = {
    name: "Docs",
    condition: 'Test-Path "Worktrees/ivy-framework/src/Ivy.Docs"',
    command: "dotnet watch",
  };

  it("shows why a disabled action is disabled when it is hovered", () => {
    vi.useFakeTimers();
    try {
      render(<ReviewActionsBarView actions={[docs]} actionStates={{ Docs: { state: false } }} />);

      const btn = screen.getByRole("button", { name: "Docs" });
      expect(btn).toBeDisabled();
      expect(screen.queryByRole("tooltip")).toBeNull();
      // What gets a real pointer past the disabled button to the wrapper, and what gives that
      // wrapper the `not-allowed` cursor the button can no longer show (base.css `[data-disabled]`).
      expect(btn).toHaveClass("disabled:pointer-events-none");
      expect(btn.parentElement).toHaveAttribute("data-disabled", "");

      hoverAction(btn);

      expect(screen.getByRole("tooltip")).toHaveTextContent(
        'Disabled: Condition not met (Test-Path "Worktrees/ivy-framework/src/Ivy.Docs")',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a keyboard reach the reason too, through the wrapper, only while disabled", () => {
    const { rerender } = render(
      <ReviewActionsBarView actions={[docs]} actionStates={{ Docs: false }} />,
    );
    // A disabled button is not focusable, so the wrapper stands in for it as the tab stop...
    expect(screen.getByRole("button", { name: "Docs" }).parentElement).toHaveAttribute(
      "tabindex",
      "0",
    );

    rerender(<ReviewActionsBarView actions={[docs]} actionStates={{ Docs: true }} />);
    // ...and steps aside once the button can take focus itself.
    expect(screen.getByRole("button", { name: "Docs" }).parentElement).not.toHaveAttribute(
      "tabindex",
    );
  });

  it("still shows what an enabled action runs on hover", () => {
    vi.useFakeTimers();
    try {
      render(<ReviewActionsBarView actions={[docs]} actionStates={{ Docs: { state: true } }} />);

      hoverAction(screen.getByRole("button", { name: "Docs" }));

      expect(screen.getByRole("tooltip")).toHaveTextContent("Run: dotnet watch");
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables an action the daemon could not evaluate, and says why", () => {
    render(
      <ReviewActionsBarView
        actions={[docs]}
        actionStates={{
          Docs: { state: "unknown", reason: "the condition timed out after 5s and was terminated" },
        }}
      />,
    );

    const btn = screen.getByRole("button", { name: "Docs" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription(
      'Disabled: Condition could not be evaluated (Test-Path "Worktrees/ivy-framework/src/Ivy.Docs"): the condition timed out after 5s and was terminated',
    );
  });

  it("holds an action it cannot decide itself while the host is still checking", () => {
    const always: ReviewActionConfig = { name: "Always", condition: "$true", command: "echo" };
    const never: ReviewActionConfig = { name: "Never", condition: "$false", command: "echo" };
    render(<ReviewActionsBarView actions={[docs, always, never]} conditionsPending />);

    const btn = screen.getByRole("button", { name: "Docs" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAccessibleDescription(
      'Checking the condition: Test-Path "Worktrees/ivy-framework/src/Ivy.Docs"',
    );
    // Drawn as the disabled action it is, not as one that looks pressable and swallows the click.
    const notMet = screen.getByRole("button", { name: "Never" });
    expect(notMet).toBeDisabled();
    expect(btn.className).toBe(notMet.className);
    // A condition the bar can decide on its own does not wait for anyone.
    const enabled = screen.getByRole("button", { name: "Always" });
    expect(enabled).toBeEnabled();
    expect(enabled.className).not.toBe(notMet.className);
  });

  it("says why when the whole bar is disabled, instead of what the action would run", () => {
    render(
      <ReviewActionsBarView
        actions={[docs]}
        actionStates={{ Docs: true }}
        disabled
        disabledReason="the plan is being updated"
      />,
    );

    const btn = screen.getByRole("button", { name: "Docs" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleDescription("Disabled: the plan is being updated");
  });

  it("says the action is starting while it is handed over", async () => {
    let release: (() => void) | undefined;
    const onExecute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <ReviewActionsBarView
        actions={[docs]}
        actionStates={{ Docs: true }}
        onExecuteAction={onExecute}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Docs" })).toHaveAccessibleDescription(
        "Starting Docs…",
      ),
    );
    expect(screen.getByRole("button", { name: "Docs" })).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      release?.();
    });
    // Handed over, the button is itself again.
    const btn = screen.getByRole("button", { name: "Docs" });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute("aria-busy");
    expect(btn).toHaveAccessibleDescription("Run: dotnet watch");
  });
});

describe("conditionVerdictsFrom", () => {
  it("maps the daemon's states onto the bar's, keeping only an unknown's reason", () => {
    expect(
      conditionVerdictsFrom([
        { name: "A", condition: "$true", state: "met" },
        { name: "B", condition: "$false", state: "notMet" },
        { name: "C", condition: "$env:CI", state: "unknown", reason: "unsupported" },
      ]),
    ).toEqual({
      A: { state: true, reason: undefined },
      B: { state: false, reason: undefined },
      C: { state: "unknown", reason: "unsupported" },
    });
  });

  it("reads a state it does not recognise as undecided rather than guessing", () => {
    expect(
      conditionVerdictsFrom([{ name: "A", condition: "x", state: "somethingNew" }]).A.state,
    ).toBe("unknown");
  });
});

describe("ReviewView asks the daemon whether each condition holds", () => {
  const samplePlan = planSummary({ id: "00509", project: "Ivy-Tendril-V2", state: "Review" });
  const docsAction: ReviewActionConfig = {
    name: "Docs",
    condition: 'Test-Path "Worktrees/ivy-framework/src/Ivy.Docs"',
    command: "dotnet watch",
  };

  it("disables an action whose condition does not hold for the plan, and says why", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([
      docsAction,
      { name: "Dev Server", condition: "", command: "vp dev" },
    ]);
    const conditions = vi.spyOn(bridge, "getReviewActionConditions").mockResolvedValue([
      { name: "Docs", condition: docsAction.condition, state: "notMet" },
      { name: "Dev Server", condition: "", state: "met" },
    ]);

    render(<ReviewView plans={[samplePlan]} onSelectPlan={() => {}} />);

    const docs = await screen.findByRole("button", { name: "Docs" });
    await waitFor(() =>
      expect(docs).toHaveAccessibleDescription(
        'Disabled: Condition not met (Test-Path "Worktrees/ivy-framework/src/Ivy.Docs")',
      ),
    );
    expect(docs).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dev Server" })).toBeEnabled();
    expect(conditions).toHaveBeenCalledWith("Ivy-Tendril-V2", "00509");
  });

  it("enables an action whose condition the daemon found to hold", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([docsAction]);
    vi.spyOn(bridge, "getReviewActionConditions").mockResolvedValue([
      { name: "Docs", condition: docsAction.condition, state: "met" },
    ]);

    render(<ReviewView plans={[samplePlan]} onSelectPlan={() => {}} />);

    const docs = await screen.findByRole("button", { name: "Docs" });
    await waitFor(() => expect(docs).toBeEnabled());
    expect(docs).toHaveAccessibleDescription("Run: dotnet watch");
  });

  /*
   * The answer is held with the plan it is about. Switching plans while the next answer is still out
   * must not leave the previous plan's "not met" on the new plan's buttons, which would be a false
   * reason on a button that may well be usable.
   */
  it("never shows one plan's verdicts on another plan's buttons", async () => {
    const planA = planSummary({ id: "00509", project: "Ivy-Tendril-V2", state: "Review" });
    const planB = planSummary({ id: "00510", project: "Ivy-Tendril-V2", state: "Review" });
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([docsAction]);
    const conditions = vi
      .spyOn(bridge, "getReviewActionConditions")
      .mockImplementation((_project, planId) =>
        planId === "00509"
          ? Promise.resolve([{ name: "Docs", condition: docsAction.condition, state: "notMet" }])
          : new Promise(() => {}),
      );

    const { rerender } = render(
      <ReviewView plans={[planA, planB]} selectedPlanId="00509" onSelectPlan={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Docs" })).toHaveAccessibleDescription(
        'Disabled: Condition not met (Test-Path "Worktrees/ivy-framework/src/Ivy.Docs")',
      ),
    );

    rerender(<ReviewView plans={[planA, planB]} selectedPlanId="00510" onSelectPlan={() => {}} />);

    await waitFor(() => expect(conditions).toHaveBeenCalledWith("Ivy-Tendril-V2", "00510"));
    const docs = screen.getByRole("button", { name: "Docs" });
    expect(docs).toBeDisabled();
    expect(docs).toHaveAccessibleDescription(
      'Checking the condition: Test-Path "Worktrees/ivy-framework/src/Ivy.Docs"',
    );
  });

  /*
   * A new worktree or commit moves the plan's `updated`, and can change what a `Test-Path` finds, so
   * the conditions are asked again for the same plan, as V1's query re-ran when the plan reloaded.
   */
  it("asks again when the plan's updated timestamp moves", async () => {
    const plan = planSummary({
      id: "00509",
      project: "Ivy-Tendril-V2",
      state: "Review",
      updated: "2026-09-07T10:41:11Z",
    });
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([docsAction]);
    let answer: "met" | "notMet" = "notMet";
    const conditions = vi
      .spyOn(bridge, "getReviewActionConditions")
      .mockImplementation(() =>
        Promise.resolve([{ name: "Docs", condition: docsAction.condition, state: answer }]),
      );

    const { rerender } = render(<ReviewView plans={[plan]} onSelectPlan={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Docs" })).toBeDisabled());
    const callsBefore = conditions.mock.calls.length;

    answer = "met";
    rerender(
      <ReviewView plans={[{ ...plan, updated: "2026-09-07T11:02:00Z" }]} onSelectPlan={() => {}} />,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Docs" })).toBeEnabled());
    expect(conditions.mock.calls.length).toBe(callsBefore + 1);
    expect(conditions).toHaveBeenLastCalledWith("Ivy-Tendril-V2", "00509");
    expect(screen.getByRole("button", { name: "Docs" })).toHaveAccessibleDescription(
      "Run: dotnet watch",
    );
  });

  /*
   * A daemon without the route (or one that is down) must not leave the bar waiting forever: the
   * bar goes back to what it could decide before there was a daemon answer at all.
   */
  it("falls back to deciding what it can when the daemon cannot answer", async () => {
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "getProjectReviewActions").mockResolvedValue([docsAction]);
    vi.spyOn(bridge, "getReviewActionConditions").mockRejectedValue(new Error("404"));

    render(<ReviewView plans={[samplePlan]} onSelectPlan={() => {}} />);

    const docs = await screen.findByRole("button", { name: "Docs" });
    await waitFor(() => expect(docs).toBeDisabled());
    expect(docs).toHaveAccessibleDescription(
      'Disabled: Condition not met (Test-Path "Worktrees/ivy-framework/src/Ivy.Docs")',
    );
  });
});
