import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VerificationReportSheet } from "../src/views/sheets/VerificationReportSheet";
import { PlanVerifications } from "../src/views/PlanVerifications";
import { ReviewView } from "../src/views/ReviewView";
import { bridge } from "../src/api/bridge";
import { planSummary, planDetail, verification, verificationReport } from "./fixtures/plan.fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VerificationReportSheet", () => {
  it("renders report title, badge, date, and markdown content when open", async () => {
    const report = verificationReport({
      name: "CheckResult",
      result: "Pass",
      date: "2026-09-22T10:16:56Z",
      content: "# CheckResult\n\nAll requirements have been met.",
    });
    const getReport = vi.spyOn(bridge, "getVerificationReport").mockResolvedValue(report);

    render(
      <VerificationReportSheet
        planId="00006"
        verificationName="CheckResult"
        initialStatus="Pass"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("verification-report-sheet")).toBeInTheDocument();
    });

    expect(getReport).toHaveBeenCalledWith("00006", "CheckResult");
    expect(screen.getByRole("heading", { name: "CheckResult", level: 2 })).toBeInTheDocument();
    expect(screen.getByTestId("verification-sheet-status")).toHaveTextContent("Pass");
    expect(screen.getByText("2026-09-22T10:16:56Z")).toBeInTheDocument();
    expect(await screen.findByText("All requirements have been met.")).toBeInTheDocument();
  });

  it("displays an error banner when report fetch fails", async () => {
    vi.spyOn(bridge, "getVerificationReport").mockRejectedValue(new Error("File not found"));

    render(
      <VerificationReportSheet
        planId="00006"
        verificationName="MissingReport"
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("verification-sheet-error")).toBeInTheDocument();
    });
    expect(screen.getByText(/File not found/i)).toBeInTheDocument();
  });

  it("does not render when verificationName is null", () => {
    render(
      <VerificationReportSheet
        planId="00006"
        verificationName={null}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("verification-report-sheet")).not.toBeInTheDocument();
  });
});

describe("ReviewView verification click interactions", () => {
  const testPlan = planSummary({
    id: "00006",
    title: "Implement Apple Foundation Model CLI",
    verifications: [
      verification("CheckResult", "Pass"),
      verification("DotnetTest", "Fail"),
    ],
  });

  beforeEach(() => {
    vi.spyOn(bridge, "getPlan").mockResolvedValue(
      planDetail({
        id: "00006",
        title: "Implement Apple Foundation Model CLI",
        verifications: [
          verification("CheckResult", "Pass"),
          verification("DotnetTest", "Fail"),
        ],
      }),
    );
    vi.spyOn(bridge, "listRecommendations").mockResolvedValue([]);
    vi.spyOn(bridge, "listDiffComments").mockResolvedValue([]);
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);
    vi.spyOn(bridge, "getPlanGit").mockResolvedValue({
      worktrees: [],
      unassociatedCommits: [],
      unassociatedCommitRefStatus: {},
    });
    vi.spyOn(bridge, "getPlanChanges").mockResolvedValue({
      files: [],
      rawDiff: "",
      totalAdditions: 0,
      totalDeletions: 0,
    });
    vi.spyOn(bridge, "getPlanSummary").mockResolvedValue("# Summary");
    vi.spyOn(bridge, "getPlanArtifacts").mockResolvedValue({ screenshots: [], other: [] });
    vi.spyOn(bridge, "getVerificationReport").mockResolvedValue(
      verificationReport({
        name: "CheckResult",
        result: "Pass",
        content: "# CheckResult Report Content",
      }),
    );
  });

  it("opens VerificationReportSheet when clicking verification in the corner dropdown", async () => {
    render(
      <ReviewView
        plans={[testPlan]}
        selectedPlanId="00006"
        onSelectPlan={vi.fn()}
      />,
    );

    // Open Verifications dropdown
    const verifBtn = await screen.findByRole("button", { name: "Verifications" });
    fireEvent.click(verifBtn);

    // Verify verification items are present
    const checkResultBtn = await screen.findByTestId("review-verification-button-CheckResult");
    expect(checkResultBtn).toBeInTheDocument();

    // Click the verification name
    fireEvent.click(checkResultBtn);

    // Sheet should open
    await waitFor(() => {
      expect(screen.getByTestId("verification-report-sheet")).toBeInTheDocument();
    });
    expect(await screen.findByText("CheckResult Report Content")).toBeInTheDocument();
  });

  it("opens VerificationReportSheet when clicking verification in Details tab", async () => {
    render(
      <ReviewView
        plans={[testPlan]}
        selectedPlanId="00006"
        onSelectPlan={vi.fn()}
      />,
    );

    // Switch to Details tab
    const detailsTab = await screen.findByRole("tab", { name: "Details" });
    fireEvent.click(detailsTab);

    // Click on verification in Details tab
    const detailVerifBtn = await screen.findByTestId("details-verification-button-CheckResult");
    expect(detailVerifBtn).toBeInTheDocument();

    fireEvent.click(detailVerifBtn);

    // Sheet should open
    await waitFor(() => {
      expect(screen.getByTestId("verification-report-sheet")).toBeInTheDocument();
    });
    expect(await screen.findByText("CheckResult Report Content")).toBeInTheDocument();
  });
});

describe("PlanVerifications onOpenReport callback", () => {
  it("calls onOpenReport when clicking View report, name, or badge", async () => {
    const onOpen = vi.fn();
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([
      verificationReport({ name: "RustTest", result: "Fail" }),
    ]);

    render(
      <PlanVerifications
        planId="00021"
        planState="Review"
        verifications={[verification("RustTest", "Fail")]}
        onOpenReport={onOpen}
      />,
    );

    const viewBtn = await screen.findByRole("button", { name: /view report/i });
    fireEvent.click(viewBtn);
    expect(onOpen).toHaveBeenCalledWith("RustTest");

    // Click the name
    fireEvent.click(screen.getByText("RustTest"));
    expect(onOpen).toHaveBeenCalledWith("RustTest");
  });
});
