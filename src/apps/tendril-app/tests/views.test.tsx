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
      expect(screen.getByText("Tendril Dashboard")).toBeInTheDocument();
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

    it("counts two RetryPlan jobs on the same plan once", () => {
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
      expect(loopArrow!.querySelector(".tpv-arrow-count")?.textContent).toBe("1");
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
    it("renders searchable plan list and provides accessible search input", () => {
      const handleSelect = vi.fn();
      render(<PlansView plans={mockPlans} onSelectPlan={handleSelect} onNewPlan={() => {}} />);

      expect(screen.getByTestId("plans-view")).toBeInTheDocument();
      const searchBox = screen.getByRole("searchbox", { name: /search plans/i });
      expect(searchBox).toBeInTheDocument();

      // Search filter interaction
      fireEvent.change(searchBox, { target: { value: "Reviewable" } });
      expect(screen.getByText("Reviewable Bug Fix")).toBeInTheDocument();
      expect(screen.queryByText("First Accessible Plan")).not.toBeInTheDocument();
    });

    it("renders empty state when no plans match filter", () => {
      render(<PlansView plans={[]} onSelectPlan={() => {}} onNewPlan={() => {}} />);

      expect(screen.getByText("No plans found")).toBeInTheDocument();
    });
  });

  describe("PlanDetailView", () => {
    it("renders plan title, lifecycle badge, and specification tabs", () => {
      render(<PlanDetailView plan={mockPlanDetail} allPlans={mockPlans} onExecute={() => {}} />);

      expect(screen.getByTestId("plan-detail-view")).toBeInTheDocument();
      expect(screen.getByText("First Accessible Plan")).toBeInTheDocument();
      expect(screen.getByText("Plan Specification")).toBeInTheDocument();
      expect(screen.getByText("Diff View")).toBeInTheDocument();
      expect(screen.getByText(/Verifications/)).toBeInTheDocument();
    });

    it("switches to Verifications and Metadata tabs on click", () => {
      render(<PlanDetailView plan={mockPlanDetail} allPlans={mockPlans} />);

      const verificationsTab = screen.getByText(/Verifications/);
      fireEvent.click(verificationsTab);
      expect(screen.getByText("Plan Verifications")).toBeInTheDocument();

      const metadataTab = screen.getByText("Metadata & History");
      fireEvent.click(metadataTab);
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
      expect(screen.getAllByRole("button", { name: /start createplan/i }).length).toBeGreaterThan(
        0,
      );

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

      const textarea = screen.getByLabelText(/task description/i);
      expect(textarea).toHaveValue("Fix OAuth callback\n\nToken refresh fails on redirect");
      expect(screen.getByLabelText(/target project/i)).toHaveValue("Tendril-App");
    });
  });

  describe("ShellLayout", () => {
    it("renders Inbox navigation item and Inbox tab", () => {
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
      // Verify Inbox tab is rendered in ShellTabs
      expect(screen.getAllByText("Inbox").length).toBeGreaterThan(0);
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

      fireEvent.click(screen.getByTitle("Jobs"));
      expect(handleSelectNav).toHaveBeenCalledWith("jobs");
    });

    it("exposes a Pull Requests nav entry that selects the cross-plan view", () => {
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
      // The nav item plus the tab.
      expect(screen.getAllByText("Pull Requests").length).toBeGreaterThan(0);

      fireEvent.click(screen.getByTitle("Pull Requests"));
      expect(handleSelectNav).toHaveBeenCalledWith("pull-requests");
    });

    it("calls onCloseTab (not onSelectTab) with the tab id when a tab's close control is clicked", () => {
      const handleSelectTab = vi.fn();
      const handleCloseTab = vi.fn();
      render(
        <ShellLayout
          activeNav="plans"
          activeTabs={["dashboard", "plan-00010"]}
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

      fireEvent.click(screen.getByLabelText("Close Plan 00010"));
      expect(handleCloseTab).toHaveBeenCalledWith("plan-00010");
      expect(handleSelectTab).not.toHaveBeenCalled();
    });
  });
});
