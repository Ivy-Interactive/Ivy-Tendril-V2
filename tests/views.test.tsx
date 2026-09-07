import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardView } from "../src/views/DashboardView";
import { PlansView } from "../src/views/PlansView";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { NewPlanModal } from "../src/views/NewPlanModal";
import { bridge } from "../src/api/bridge";
import { planDetail, planSummary } from "./fixtures/plan.fixture";
import type { PlanSummary, Job, ProjectSummary } from "../src/types/api";

// The verifications tab fetches reports through the bridge; without a stub the
// tab would try to reach a real daemon over Tauri's invoke().
beforeEach(() => {
  vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
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
      render(
        <DashboardView
          plans={mockPlans}
          jobs={mockJobs}
          onSelectPlan={() => {}}
          onSelectJob={() => {}}
        />
      );

      expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
      expect(screen.getByText("Tendril Dashboard")).toBeInTheDocument();
      expect(screen.getByText("First Accessible Plan")).toBeInTheDocument();
    });
  });

  describe("PlansView", () => {
    it("renders searchable plan list and provides accessible search input", () => {
      const handleSelect = vi.fn();
      render(
        <PlansView
          plans={mockPlans}
          onSelectPlan={handleSelect}
          onNewPlan={() => {}}
        />
      );

      expect(screen.getByTestId("plans-view")).toBeInTheDocument();
      const searchBox = screen.getByRole("searchbox", { name: /search plans/i });
      expect(searchBox).toBeInTheDocument();

      // Search filter interaction
      fireEvent.change(searchBox, { target: { value: "Reviewable" } });
      expect(screen.getByText("Reviewable Bug Fix")).toBeInTheDocument();
      expect(screen.queryByText("First Accessible Plan")).not.toBeInTheDocument();
    });

    it("renders empty state when no plans match filter", () => {
      render(
        <PlansView
          plans={[]}
          onSelectPlan={() => {}}
          onNewPlan={() => {}}
        />
      );

      expect(screen.getByText("No plans found")).toBeInTheDocument();
    });
  });

  describe("PlanDetailView", () => {
    it("renders plan title, lifecycle badge, and specification tabs", () => {
      render(
        <PlanDetailView
          plan={mockPlanDetail}
          allPlans={mockPlans}
          onExecute={() => {}}
        />
      );

      expect(screen.getByTestId("plan-detail-view")).toBeInTheDocument();
      expect(screen.getByText("First Accessible Plan")).toBeInTheDocument();
      expect(screen.getByText("Plan Specification")).toBeInTheDocument();
      expect(screen.getByText("Diff View")).toBeInTheDocument();
      expect(screen.getByText(/Verifications/)).toBeInTheDocument();
    });

    it("switches to Verifications and Metadata tabs on click", () => {
      render(
        <PlanDetailView
          plan={mockPlanDetail}
          allPlans={mockPlans}
        />
      );

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
      render(
        <NewPlanModal
          isOpen={true}
          onClose={handleClose}
          projects={mockProjects}
        />
      );

      const dialog = screen.getByRole("dialog", { name: /create new plan/i });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByLabelText(/target project/i)).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /start createplan/i }).length).toBeGreaterThan(0);

      const closeBtn = screen.getByRole("button", { name: /close modal/i });
      fireEvent.click(closeBtn);
      expect(handleClose).toHaveBeenCalled();
    });

    it("does not render when isOpen is false", () => {
      render(
        <NewPlanModal
          isOpen={false}
          onClose={() => {}}
          projects={mockProjects}
        />
      );

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
