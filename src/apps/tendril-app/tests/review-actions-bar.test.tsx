import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ReviewActionsBarView,
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

  it("renders action buttons with correct enabled/disabled state and tooltips", () => {
    render(<ReviewActionsBarView actions={actions} allocatedPorts={{ http: 8080 }} />);

    const enabledBtn = screen.getByRole("button", { name: "Run Tests" });
    expect(enabledBtn).toBeEnabled();
    expect(enabledBtn).toHaveAttribute("title", "Run: pnpm test (ports: http: 8080)");

    const disabledBtn = screen.getByRole("button", { name: "Start Server" });
    expect(disabledBtn).toBeDisabled();
    expect(disabledBtn).toHaveAttribute("title", "Disabled: Condition not met ($false)");
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

  it("offers the action and says the condition was not checked", () => {
    render(<ReviewActionsBarView actions={[action]} />);

    const btn = screen.getByRole("button", { name: "Dev Server" });
    expect(btn).toBeEnabled();
    expect(btn).toHaveAttribute(
      "title",
      "Run: pnpm dev:app. Condition not evaluated here: Test-Path src/apps/tendril-app",
    );
  });

  it("defers to a host that did evaluate the condition", () => {
    render(<ReviewActionsBarView actions={[action]} actionStates={{ "Dev Server": false }} />);

    const btn = screen.getByRole("button", { name: "Dev Server" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
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
    release?.();
  });
});
