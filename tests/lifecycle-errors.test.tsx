import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanDetailView } from "../src/views/PlanDetailView";
import { JobSessionView } from "../src/views/JobSessionView";
import { bridge } from "../src/api/bridge";
import { jobsStore } from "../src/state/jobsStore";
import { planDetail, planSummary } from "./fixtures/plan.fixture";
import { failedJobDetail, job, jobDetail } from "./fixtures/job.fixture";
import { bridgeError } from "./fixtures/recommendation.fixture";
import { bridgeErrorCode, describeBridgeError, isBridgeError } from "../src/types/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BridgeError helpers", () => {
  it("recognises a structured Tauri rejection", () => {
    expect(isBridgeError(bridgeError())).toBe(true);
    expect(isBridgeError(new Error("plain"))).toBe(false);
    expect(isBridgeError("string")).toBe(false);
    expect(isBridgeError(null)).toBe(false);
  });

  it("describes structured, Error and unknown rejections alike", () => {
    expect(describeBridgeError({ code: "X", message: "boom", details: "detail" })).toBe(
      "boom (detail)",
    );
    expect(describeBridgeError({ code: "X", message: "boom" })).toBe("boom");
    expect(describeBridgeError(new Error("thrown"))).toBe("thrown");
    expect(describeBridgeError("raw")).toBe("raw");
  });

  it("exposes the code so callers can branch without string matching", () => {
    expect(bridgeErrorCode(bridgeError({ code: "DISCONNECTED" }))).toBe("DISCONNECTED");
    expect(bridgeErrorCode(new Error("nope"))).toBeUndefined();
  });
});

describe("PlanDetailView lifecycle actions", () => {
  const draftPlan = planDetail({
    id: "00030",
    state: "Draft",
    dependsOn: [],
    verifications: [],
    revisionCount: 1,
  });

  it("reports an Execute failure instead of silently doing nothing", async () => {
    const onExecute = vi.fn().mockRejectedValue(
      bridgeError({
        code: "DISCONNECTED",
        message: "Tendril service is not running",
        details: "daemon metadata (.master) not found",
      }),
    );

    render(<PlanDetailView plan={draftPlan} allPlans={[]} onExecute={onExecute} />);

    fireEvent.click(screen.getByRole("button", { name: /execute plan/i }));

    await waitFor(() =>
      expect(screen.getByTestId("plan-action-error")).toHaveTextContent(
        /Execute Plan failed: Tendril service is not running/,
      ),
    );
    expect(onExecute).toHaveBeenCalledWith("00030");
  });

  it("shows no error banner when Execute succeeds", async () => {
    const onExecute = vi.fn().mockResolvedValue(undefined);

    render(<PlanDetailView plan={draftPlan} allPlans={[]} onExecute={onExecute} />);
    fireEvent.click(screen.getByRole("button", { name: /execute plan/i }));

    await waitFor(() => expect(onExecute).toHaveBeenCalled());
    expect(screen.queryByTestId("plan-action-error")).not.toBeInTheDocument();
  });

  it("reports Retry and Create PR failures from the Review state toolbar", async () => {
    const reviewPlan = planDetail({
      id: "00021",
      state: "Review",
      verifications: [
        { name: "RustClippy", status: "Pass" },
        { name: "RustTest", status: "Pass" },
      ],
    });
    const onRetry = vi
      .fn()
      .mockRejectedValue(bridgeError({ code: "START_JOB_FAILED", message: "queue is full" }));

    render(<PlanDetailView plan={reviewPlan} allPlans={[planSummary()]} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /retry plan/i }));

    await waitFor(() =>
      expect(screen.getByTestId("plan-action-error")).toHaveTextContent(
        /Retry Plan failed: queue is full/,
      ),
    );
  });

  it("awaits an async handler, which the old sync try/catch could not do", async () => {
    // Regression guard: handleExecute used to be synchronous, so a rejected
    // promise from onExecute escaped as an unhandled rejection and the
    // operator saw nothing at all.
    let reject: (err: unknown) => void = () => {};
    const onExecute = vi.fn(
      () =>
        new Promise<void>((_resolve, rej) => {
          reject = rej;
        }),
    );

    render(<PlanDetailView plan={draftPlan} allPlans={[]} onExecute={onExecute} />);
    fireEvent.click(screen.getByRole("button", { name: /execute plan/i }));

    // While in flight the button reflects the pending action.
    await waitFor(() => expect(screen.getByRole("button", { name: /starting/i })).toBeDisabled());

    reject(bridgeError({ code: "TIMEOUT", message: "service did not respond" }));

    await waitFor(() =>
      expect(screen.getByTestId("plan-action-error")).toHaveTextContent(/service did not respond/),
    );
  });
});

describe("JobSessionView", () => {
  it("surfaces the promptware's reported failure reason", () => {
    const failed = failedJobDetail();

    render(<JobSessionView job={failed} events={[]} />);

    expect(screen.getByTestId("job-failure-reason")).toHaveTextContent(
      /RustTest verification failed after 3 attempts/,
    );
  });

  it("falls back to statusMessage for a failed job with no reported reason", () => {
    render(
      <JobSessionView
        job={jobDetail({
          status: "Blocked",
          statusMessage: "Blocked on plan 00024",
          reportedFailureReason: undefined,
        })}
        events={[]}
      />,
    );

    expect(screen.getByTestId("job-failure-reason")).toHaveTextContent(/Blocked on plan 00024/);
  });

  it("shows no failure panel for a running job", () => {
    render(<JobSessionView job={job()} events={[]} />);

    expect(screen.queryByTestId("job-failure-reason")).not.toBeInTheDocument();
  });

  it("reports a failed cancel, because the job is still running", async () => {
    vi.spyOn(bridge, "cancelJob").mockRejectedValue(
      bridgeError({
        code: "CANCEL_JOB_FAILED",
        message: "Job 00158 already completed",
        details: null,
      }),
    );

    render(<JobSessionView job={job()} events={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /cancel job/i }));

    await waitFor(() =>
      expect(screen.getByTestId("job-cancel-error")).toHaveTextContent(
        /Cancel failed: Job 00158 already completed/,
      ),
    );
    // Re-enabled so the operator can try again.
    expect(screen.getByRole("button", { name: /cancel job/i })).toBeEnabled();
  });

  it("awaits an injected onCancel handler and reports its rejection", async () => {
    const onCancel = vi
      .fn()
      .mockRejectedValue(bridgeError({ code: "DISCONNECTED", message: "no daemon" }));

    render(<JobSessionView job={job()} events={[]} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel job/i }));

    await waitFor(() =>
      expect(screen.getByTestId("job-cancel-error")).toHaveTextContent(/Cancel failed: no daemon/),
    );
  });
});

describe("jobsStore.fetchJobDetail", () => {
  it("caches the detail that carries reportedFailureReason", async () => {
    const detail = failedJobDetail({ id: "00159" });
    vi.spyOn(bridge, "getJob").mockResolvedValue(detail);

    await jobsStore.fetchJobDetail("00159");

    expect(jobsStore.getJobDetail("00159")?.reportedFailureReason).toBe(
      detail.reportedFailureReason,
    );
    expect(jobsStore.getState().jobDetails["00159"]).toEqual(detail);
  });

  it("propagates a rejection rather than caching a partial job", async () => {
    vi.spyOn(bridge, "getJob").mockRejectedValue(
      bridgeError({ code: "NOT_FOUND", message: "no such job" }),
    );

    await expect(jobsStore.fetchJobDetail("99999")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(jobsStore.getJobDetail("99999")).toBeUndefined();
  });
});
