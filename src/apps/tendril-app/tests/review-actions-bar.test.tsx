import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  ReviewActionsBarView,
  evaluateCondition,
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
    const executeSpy = vi.spyOn(bridge, "executeReviewAction").mockResolvedValue({ status: "ok" });

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
    const executeSpy = vi.spyOn(bridge, "executeReviewAction").mockResolvedValue({ status: "ok" });

    render(
      <ReviewView
        plans={[samplePlan]}
        onSelectPlan={() => {}}
        onCreatePr={() => {}}
        onRetry={() => {}}
      />,
    );

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
});
