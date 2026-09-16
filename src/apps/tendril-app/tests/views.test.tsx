import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardView } from "../src/views/DashboardView";
import { PlansView } from "../src/views/PlansView";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { NewPlanModal } from "../src/views/NewPlanModal";
import { ShellLayout } from "../src/views/ShellLayout";
import { bridge } from "../src/api/bridge";
import { planDetail, planSummary } from "./fixtures/plan.fixture";
import type { PlanSummary, Job, ProjectSummary } from "../src/types/api";

// The verifications tab fetches reports through the bridge; without a stub the
// tab would try to reach a real daemon over Tauri's invoke(). The dashboard's five
// analytics calls are stubbed for the same reason — these cases cover the process
// viewer and the job list rather than the analytics, and an empty activity leaves
// the view on its in-memory KPI fallback, which is what they assert against.
beforeEach(() => {
  vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
  vi.spyOn(bridge, "getDashboardActivity").mockRejectedValue(new Error("no daemon under test"));
  vi.spyOn(bridge, "getShippedFeatures").mockResolvedValue([]);
  vi.spyOn(bridge, "getAgentCostBreakdown").mockResolvedValue([]);
  vi.spyOn(bridge, "getRecentPlanCosts").mockResolvedValue([]);
  vi.spyOn(bridge, "getRecentMergedPrs").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Operator Views Component & Accessibility Tests", () => {
  const mockPlans: PlanSummary[] = [
    planSummary({
      id: "00010",
      title: "First Accessible Plan",
      state: "Draft",
      project: "Project-A",
      level: "Feature",
      verifications: [{ name: "RustBuild", status: "Pass" }],
    }),
    planSummary({
      id: "00020",
      title: "Reviewable Bug Fix",
      state: "Review",
      project: "Project-B",
      level: "Bug",
      verifications: [
        { name: "RustClippy", status: "Pass" },
        { name: "RustTest", status: "Pass" },
      ],
    }),
  ];

  const mockJobs: Job[] = [
    {
      id: "00100",
      type: "ExecutePlan",
      planId: "00010",
      planTitle: "First Accessible Plan",
      project: "Project-A",
      status: "Running",
      cost: 0.05,
      tokens: 12000,
    },
  ];

  const mockPlanDetail = planDetail({
    ...mockPlans[0],
    repos: ["/Users/rorychatt/repos/test"],
    verifications: [{ name: "RustBuild", status: "Pass" }],
    dependsOn: [],
    relatedPlans: [],
    commits: ["commit-123"],
    prs: [],
    latestRevisionContent: "# Test Revision Content\n\nDetailed problem and solution.",
  });

  const mockProjects: ProjectSummary[] = [
    { name: "Tendril-App", repos: ["/repos/Tendril-App"], verifications: ["RustBuild"] },
  ];

  describe("DashboardView", () => {
    it("renders KPIs, process counts, and recent jobs", () => {
      render(<DashboardView plans={mockPlans} jobs={mockJobs} onSelectJob={() => {}} />);

      expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
      expect(screen.getByText("What Are We Producing Today?")).toBeInTheDocument();
      expect(screen.getByText("First Accessible Plan")).toBeInTheDocument();
    });
  });

  describe("DashboardView process viewer navigation", () => {
    it("clicking the New Plan box calls onNewPlan and never onNavigate", () => {
      const onNewPlan = vi.fn();
      const onNavigate = vi.fn();
      const { container } = render(
        <DashboardView
          plans={mockPlans}
          jobs={mockJobs}
          onNavigate={onNavigate}
          onNewPlan={onNewPlan}
        />,
      );

      const createBox = container.querySelector(".tpv-box-create");
      expect(createBox).not.toBeNull();
      fireEvent.click(createBox!);

      expect(onNewPlan).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it("clicking the process viewer Drafts box calls onNavigate('plans')", () => {
      const onNavigate = vi.fn();
      const { container } = render(
        <DashboardView plans={mockPlans} jobs={mockJobs} onNavigate={onNavigate} />,
      );

      const stageBoxes = container.querySelectorAll(".tpv-box-stage");
      fireEvent.click(stageBoxes[0]);

      expect(onNavigate).toHaveBeenCalledWith("plans");
    });

    it("clicking the process viewer Review box calls onNavigate('review')", () => {
      const onNavigate = vi.fn();
      const { container } = render(
        <DashboardView plans={mockPlans} jobs={mockJobs} onNavigate={onNavigate} />,
      );

      const stageBoxes = container.querySelectorAll(".tpv-box-stage");
      fireEvent.click(stageBoxes[1]);

      expect(onNavigate).toHaveBeenCalledWith("review");
    });

    it("clicking an arrow count label calls onNavigate('jobs')", () => {
      const onNavigate = vi.fn();
      const plansWithExecuting: PlanSummary[] = [
        ...mockPlans,
        planSummary({
          id: "00030",
          title: "Executing Plan",
          state: "Executing",
          project: "Project-A",
          level: "Feature",
          verifications: [],
        }),
      ];
      const { container } = render(
        <DashboardView plans={plansWithExecuting} jobs={mockJobs} onNavigate={onNavigate} />,
      );

      const arrowLabel = container.querySelector(".tpv-arrow-label");
      expect(arrowLabel).not.toBeNull();
      fireEvent.click(arrowLabel!);

      expect(onNavigate).toHaveBeenCalledWith("jobs");
    });

    it("clicking the Ready For Review status pill navigates, and OnJob still selects the job", () => {
      const onNavigate = vi.fn();
      const onSelectJob = vi.fn();
      const { container } = render(
        <DashboardView
          plans={mockPlans}
          jobs={mockJobs}
          onNavigate={onNavigate}
          onSelectJob={onSelectJob}
        />,
      );

      const statusItems = container.querySelectorAll(".tdb-status-item");
      fireEvent.click(statusItems[2]);
      expect(onNavigate).toHaveBeenCalledWith("review");

      const jobRow = container.querySelector(".tdb-job-row");
      expect(jobRow).not.toBeNull();
      fireEvent.click(jobRow!);
      expect(onSelectJob).toHaveBeenCalledWith("00100");
    });
  });

  describe("DashboardView process viewer job counts", () => {
    it("renders the retry loop arrow for an active RetryPlan job", () => {
      const jobs: Job[] = [
        ...mockJobs,
        {
          id: "00101",
          type: "RetryPlan",
          planId: "00020",
          project: "Project-B",
          status: "Running",
        },
      ];
      const { container } = render(<DashboardView plans={mockPlans} jobs={jobs} />);

      const loopArrow = container.querySelector(".tpv-loop-arrow");
      expect(loopArrow).not.toBeNull();
      expect(loopArrow!.querySelector(".tpv-arrow-count")?.textContent).toBe("1");
    });

    it("renders the PR n sub-label for an active CreatePr job", () => {
      const jobs: Job[] = [
        ...mockJobs,
        {
          id: "00102",
          type: "CreatePr",
          planId: "00020",
          project: "Project-B",
          status: "Queued",
        },
      ];
      render(<DashboardView plans={mockPlans} jobs={jobs} />);

      expect(screen.getByText("PR 1")).toBeInTheDocument();
    });

    it("does not count finished RetryPlan/CreatePr jobs", () => {
      const jobs: Job[] = [
        ...mockJobs,
        {
          id: "00101",
          type: "RetryPlan",
          planId: "00020",
          project: "Project-B",
          status: "Completed",
        },
        {
          id: "00102",
          type: "CreatePr",
          planId: "00020",
          project: "Project-B",
          status: "Failed",
        },
      ];
      const { container } = render(<DashboardView plans={mockPlans} jobs={jobs} />);

      expect(container.querySelector(".tpv-loop-arrow")).toBeNull();
      expect(screen.queryByText(/^PR \d+$/)).toBeNull();
    });

    // Changed from "counts two RetryPlan jobs on the same plan once". V1's counter is
    // `activeJobs.Count(j => j.Type == Constants.JobTypes.RetryPlan)`
    // (`TendrilProcessStatusService.Compute`) — jobs, not distinct plans. Two retries queued against
    // one plan are two runs to wait for, and reporting 1 understates the queue.
    it("counts every active RetryPlan job, including two on the same plan", () => {
      const jobs: Job[] = [
        ...mockJobs,
        {
          id: "00101",
          type: "RetryPlan",
          planId: "00020",
          project: "Project-B",
          status: "Running",
        },
        {
          id: "00103",
          type: "RetryPlan",
          planId: "00020",
          project: "Project-B",
          status: "Running",
        },
      ];
      const { container } = render(<DashboardView plans={mockPlans} jobs={jobs} />);

      const loopArrow = container.querySelector(".tpv-loop-arrow");
      expect(loopArrow).not.toBeNull();
      expect(loopArrow!.querySelector(".tpv-arrow-count")?.textContent).toBe("2");
    });

    it("clicking the retry loop arrow and the PR label calls onNavigate('jobs')", () => {
      const onNavigate = vi.fn();
      const jobs: Job[] = [
        ...mockJobs,
        {
          id: "00101",
          type: "RetryPlan",
          planId: "00020",
          project: "Project-B",
          status: "Running",
        },
        {
          id: "00102",
          type: "CreatePr",
          planId: "00020",
          project: "Project-B",
          status: "Queued",
        },
      ];
      const { container } = render(
        <DashboardView plans={mockPlans} jobs={jobs} onNavigate={onNavigate} />,
      );

      const loopArrowLabel = container.querySelector(".tpv-loop-arrow .tpv-arrow-label");
      expect(loopArrowLabel).not.toBeNull();
      fireEvent.click(loopArrowLabel!);
      expect(onNavigate).toHaveBeenCalledWith("jobs");

      const subLabel = container.querySelector(".tpv-sub-label");
      expect(subLabel).not.toBeNull();
      fireEvent.click(subLabel!);
      expect(onNavigate).toHaveBeenCalledWith("jobs");
    });
  });

  describe("PlansView", () => {
    /*
     * The page draws no list and no search of its own: `PlansApp.Build` publishes its list into the
     * shell sidebar (`BuildSidebarList`) and returns a content view that is the selected plan. The
     * list's own assertions live in `plans-view-behaviour.test.tsx`, against what it publishes.
     */
    it("renders the selection, not a list", () => {
      render(<PlansView plans={mockPlans} onSelectPlan={vi.fn()} onNewPlan={() => {}} />);

      expect(screen.getByTestId("plans-view")).toBeInTheDocument();
      expect(screen.queryByRole("searchbox", { name: /search plans/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.getByTestId("plans-no-selection")).toHaveTextContent(
        "Select a plan from the sidebar",
      );
    });

    // `ContentView.BuildNoSelectionView`: `NoContentView("No plans", "Plans you create will appear
    // here")` when there is nothing to list at all.
    it("renders the no-plans empty state for a workspace with no plans", () => {
      render(<PlansView plans={[]} onSelectPlan={() => {}} onNewPlan={() => {}} />);

      expect(screen.getByText("No plans")).toBeInTheDocument();
      expect(screen.getByText("Plans you create will appear here")).toBeInTheDocument();
    });
  });

  describe("PlanDetailView", () => {
    it("renders plan title, lifecycle badge, and specification tabs", () => {
      render(<PlanDetailView plan={mockPlanDetail} allPlans={mockPlans} onExecute={() => {}} />);

      expect(screen.getByTestId("plan-detail-view")).toBeInTheDocument();
      expect(screen.getByText("First Accessible Plan")).toBeInTheDocument();
      // The workspace's own tab strip is a `role="tablist"` of `role="tab"` buttons
      // (`PlanWorkspace.tsx`), which is what V1 renders and what these were asserting as plain
      // buttons before the page adopted the widget. Order is `ContentView.Build`'s: Plan, Details.
      expect(screen.getByRole("tab", { name: "Plan" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Diff View" })).toBeInTheDocument();
      // Verifications is no longer a tab: V1 puts it in the tab strip's corner dropdown
      // (`VerificationsPanelView` in the workspace's `Verifications` slot).
      expect(screen.queryByRole("tab", { name: /Verifications/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Verifications" })).toBeInTheDocument();
    });

    it("opens the Verifications dropdown, and switches to the Details tab on click", () => {
      render(<PlanDetailView plan={mockPlanDetail} allPlans={mockPlans} />);

      fireEvent.click(screen.getByRole("button", { name: "Verifications" }));
      expect(screen.getByRole("group", { name: "Verifications" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: "Details" }));
      expect(screen.getByText("Repositories")).toBeInTheDocument();
      expect(screen.getByText("/Users/rorychatt/repos/test")).toBeInTheDocument();
    });
  });

  describe("NewPlanModal", () => {
    it("renders accessible modal with project picker and submission controls", () => {
      const handleClose = vi.fn();
      render(<NewPlanModal isOpen={true} onClose={handleClose} projects={mockProjects} />);

      const dialog = screen.getByRole("dialog", { name: /create new plan/i });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByLabelText(/target project/i)).toBeInTheDocument();
      // V1's dialog body is the project picker over one ContentInput, which owns the Create
      // button (`SubmitLabel("Create")`); there is no separate footer submit.
      expect(screen.getByTitle("Create")).toBeInTheDocument();

      const closeBtn = screen.getByRole("button", { name: /close modal/i });
      fireEvent.click(closeBtn);
      expect(handleClose).toHaveBeenCalled();
    });

    it("does not render when isOpen is false", () => {
      render(<NewPlanModal isOpen={false} onClose={() => {}} projects={mockProjects} />);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("pre-fills description and target project when initial values are supplied", () => {
      render(
        <NewPlanModal
          isOpen={true}
          onClose={() => {}}
          projects={mockProjects}
          initialTitle="Fix OAuth callback"
          initialDescription="Token refresh fails on redirect"
          initialSourceUrl="https://github.com/SpaceCorps/Tendril-App/issues/88"
          initialProject="Tendril-App"
        />,
      );

      expect(
        screen.getByText("Fix OAuth callback Token refresh fails on redirect", {
          exact: false,
        }),
      ).toBeInTheDocument();
      // One configured project means no "Auto" and no choice to make, so the toggle variant
      // renders it pre-selected (`CreatePlanDialog._defaultProject`).
      expect(screen.getByRole("radio", { name: "Tendril-App" })).toBeChecked();
    });
  });

  describe("ShellLayout", () => {
    // Inbox is a footer button, not a nav row, and it is icon-only: V1's `ShowLabel(!inboxInFooter)`
    // is false once Inbox sits in the footer, so there is no "Inbox" text node to find.
    it("renders Inbox as an icon-only footer button", () => {
      const handleSelectNav = vi.fn();
      render(
        <ShellLayout
          activeNav="inbox"
          activeTabs={["dashboard", "inbox", "plans"]}
          serviceInfo={null}
          connectionStatus="online"
          reconnectCountdown={0}
          onSelectNav={handleSelectNav}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onNewPlan={() => {}}
          onOpenShortcuts={() => {}}
          onReconnect={() => {}}
        >
          <div>Inbox View Content</div>
        </ShellLayout>,
      );

      expect(screen.getByText("Inbox View Content")).toBeInTheDocument();
      expect(screen.getByLabelText("Inbox")).toBeInTheDocument();
    });

    it("calls onSelectNav with the item id when a nav item is clicked", () => {
      const handleSelectNav = vi.fn();
      render(
        <ShellLayout
          activeNav="dashboard"
          activeTabs={["dashboard"]}
          serviceInfo={null}
          connectionStatus="online"
          reconnectCountdown={0}
          onSelectNav={handleSelectNav}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onNewPlan={() => {}}
          onOpenShortcuts={() => {}}
          onReconnect={() => {}}
        >
          <div>Dashboard View Content</div>
        </ShellLayout>,
      );

      fireEvent.click(screen.getByLabelText("Jobs"));
      expect(handleSelectNav).toHaveBeenCalledWith("jobs");
    });

    it("exposes Pull Requests via the settings menu, which selects the cross-plan view", () => {
      const handleSelectNav = vi.fn();
      render(
        <ShellLayout
          activeNav="pull-requests"
          activeTabs={["dashboard", "pull-requests"]}
          serviceInfo={null}
          connectionStatus="online"
          reconnectCountdown={0}
          onSelectNav={handleSelectNav}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onNewPlan={() => {}}
          onOpenShortcuts={() => {}}
          onReconnect={() => {}}
        >
          <div>Pull Requests View Content</div>
        </ShellLayout>,
      );

      expect(screen.getByText("Pull Requests View Content")).toBeInTheDocument();

      // V1 marks the Pull Requests app `isVisible: false` and reaches it from the footer cog's
      // menu (`settingsMenuItems`), so it is no longer a nav row.
      // Radix opens the menu on keydown/pointerdown, not click: same approach as toolbar.test.tsx.
      fireEvent.keyDown(screen.getByLabelText("Settings"), { key: "Enter" });
      fireEvent.click(screen.getByText("Pull Requests"));
      expect(handleSelectNav).toHaveBeenCalledWith("pull-requests");
    });

    it("renders Recommendations in sidebar nav and calls onSelectNav with 'recommendations'", () => {
      const handleSelectNav = vi.fn();
      render(
        <ShellLayout
          activeNav="dashboard"
          activeTabs={["dashboard"]}
          serviceInfo={null}
          connectionStatus="online"
          reconnectCountdown={0}
          onSelectNav={handleSelectNav}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onNewPlan={() => {}}
          onOpenShortcuts={() => {}}
          onReconnect={() => {}}
        >
          <div>Dashboard View Content</div>
        </ShellLayout>,
      );

      const recNavItem = screen.getByLabelText("Recommendations");
      expect(recNavItem).toBeInTheDocument();
      fireEvent.click(recNavItem);
      expect(handleSelectNav).toHaveBeenCalledWith("recommendations");
    });

    it("exposes Icebox and Check for Updates via the settings menu", () => {
      const handleSelectNav = vi.fn();
      const handleCheckForUpdates = vi.fn();
      render(
        <ShellLayout
          activeNav="dashboard"
          activeTabs={["dashboard"]}
          serviceInfo={null}
          connectionStatus="online"
          reconnectCountdown={0}
          onSelectNav={handleSelectNav}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onNewPlan={() => {}}
          onOpenShortcuts={() => {}}
          onReconnect={() => {}}
          onCheckForUpdates={handleCheckForUpdates}
        >
          <div>Dashboard View Content</div>
        </ShellLayout>,
      );

      fireEvent.keyDown(screen.getByLabelText("Settings"), { key: "Enter" });
      expect(screen.getByText("Icebox")).toBeInTheDocument();
      expect(screen.getByText("Check for Updates")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Icebox"));
      expect(handleSelectNav).toHaveBeenCalledWith("icebox");
    });

    it("renders badge counts for plans, review, recommendations, jobs, and chat", () => {
      render(
        <ShellLayout
          activeNav="dashboard"
          activeTabs={["dashboard"]}
          serviceInfo={null}
          connectionStatus="online"
          reconnectCountdown={0}
          onSelectNav={() => {}}
          onSelectTab={() => {}}
          onCloseTab={() => {}}
          onNewPlan={() => {}}
          onOpenShortcuts={() => {}}
          onReconnect={() => {}}
          draftCount={3}
          reviewCount={5}
          recommendationsCount={2}
          jobCount={4}
          chatCount={7}
        >
          <div>Dashboard View Content</div>
        </ShellLayout>,
      );

      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("5")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
    });

    /* Updated for V1's strip (`TendrilAppShell.BuildStripTabs`): the strip is the non-closable
       `$page` tab plus the session panes, and a page - a plan included - is never a tab, so there is
       no "Close Plan 00010" control to click any more. The assertion this test exists for is
       unchanged: a session tab's X routes to `onCloseTab` and not to `onSelectTab`. */
    it("calls onCloseTab (not onSelectTab) with the tab id when a tab's close control is clicked", () => {
      const handleSelectTab = vi.fn();
      const handleCloseTab = vi.fn();
      render(
        <ShellLayout
          activeNav="plans"
          sessionTabs={[
            {
              id: "review-action:Tendril:00010:Run Tests",
              appId: "review-action",
              title: "#10 Run Tests",
              args: {},
            },
          ]}
          serviceInfo={null}
          connectionStatus="online"
          reconnectCountdown={0}
          onSelectNav={() => {}}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewPlan={() => {}}
          onOpenShortcuts={() => {}}
          onReconnect={() => {}}
        >
          <div>Plans View Content</div>
        </ShellLayout>,
      );

      fireEvent.click(screen.getByLabelText("Close #10 Run Tests"));
      expect(handleCloseTab).toHaveBeenCalledWith("review-action:Tendril:00010:Run Tests");
      expect(handleSelectTab).not.toHaveBeenCalled();
    });
  });
});
