import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanVerifications } from "../src/views/PlanVerifications";
import { bridge } from "../src/api/bridge";
import { verification, verificationReport } from "./fixtures/plan.fixture";
import { bridgeError } from "./fixtures/recommendation.fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlanVerifications", () => {
  const verifications = [
    verification("RustClippy", "Pass"),
    verification("RustTest", "Fail"),
    verification("CheckResult", "Pending"),
  ];

  it("lists every verification with its status", async () => {
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([]);

    render(<PlanVerifications planId="00021" verifications={verifications} />);

    await waitFor(() => expect(screen.getByTestId("plan-verifications")).toBeInTheDocument());
    expect(screen.getByText("RustClippy")).toBeInTheDocument();
    // A checkbox per verification, and a badge only for the two terminal outcomes: V1's
    // `VerificationRowView` conveys Pending and Skipped with the box alone.
    expect(screen.getByTestId("verification-checkbox-RustClippy")).toBeChecked();
    expect(screen.getByTestId("verification-status-RustClippy")).toHaveTextContent("Pass");
    expect(screen.getByTestId("verification-status-RustTest")).toHaveTextContent("Fail");
    expect(screen.getByTestId("verification-checkbox-CheckResult")).toBeChecked();
    expect(screen.queryByTestId("verification-status-CheckResult")).not.toBeInTheDocument();
  });

  it("expands a report so a failure can be diagnosed in-app", async () => {
    const listVerificationReports = vi
      .spyOn(bridge, "listVerificationReports")
      .mockResolvedValue([verificationReport()]);

    render(<PlanVerifications planId="00021" verifications={verifications} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /view report/i })).toBeInTheDocument(),
    );
    expect(listVerificationReports).toHaveBeenCalledWith("00021");

    // Report content is hidden until asked for.
    expect(screen.queryByTestId("verification-report-RustTest")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view report/i }));

    expect(screen.getByTestId("verification-report-RustTest")).toHaveTextContent(
      /2 tests failed: dto_mapping, revision_diff/,
    );
    expect(screen.getByText("2026-09-07T10:41:11Z")).toBeInTheDocument();
  });

  it("collapses the report again on a second click", async () => {
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([verificationReport()]);

    render(<PlanVerifications planId="00021" verifications={verifications} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /view report/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /view report/i }));
    fireEvent.click(screen.getByRole("button", { name: /hide report/i }));

    expect(screen.queryByTestId("verification-report-RustTest")).not.toBeInTheDocument();
  });

  it("marks verifications that have not run yet as having no report", async () => {
    vi.spyOn(bridge, "listVerificationReports").mockResolvedValue([
      verificationReport({ name: "RustClippy", result: "Pass" }),
    ]);

    render(<PlanVerifications planId="00021" verifications={verifications} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /view report/i })).toBeInTheDocument(),
    );
    // RustTest and CheckResult have no report on disk.
    expect(screen.getAllByText("No report yet")).toHaveLength(2);
  });

  it("reports a bridge failure rather than pretending no reports exist", async () => {
    vi.spyOn(bridge, "listVerificationReports").mockRejectedValue(
      bridgeError({
        code: "NOT_FOUND",
        message: "Plan '00021' reported no folder path",
        details: null,
      }),
    );

    render(<PlanVerifications planId="00021" verifications={verifications} />);

    await waitFor(() =>
      expect(screen.getByTestId("verification-reports-error")).toHaveTextContent(
        /reported no folder path/,
      ),
    );
    // Statuses still render; only the report content is unavailable.
    expect(screen.getByText("RustClippy")).toBeInTheDocument();
    expect(screen.getAllByText("No report yet")).toHaveLength(3);
  });

  it("shows an explicit empty state for a plan with no verifications", () => {
    const listVerificationReports = vi.spyOn(bridge, "listVerificationReports");

    render(<PlanVerifications planId="00021" verifications={[]} />);

    expect(screen.getByTestId("no-verifications")).toBeInTheDocument();
    // No verifications means nothing to fetch reports for.
    expect(listVerificationReports).not.toHaveBeenCalled();
  });
});
