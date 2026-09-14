import { describe, it, expect } from "vitest";
import { formatSystemEvent } from "../src/utils/systemEvents";

describe("formatSystemEvent", () => {
  it("condenses a completed job into a verb, a noun and a plan reference", () => {
    const view = formatSystemEvent(
      "[System Event] Job 02991 (ExecutePlan) for '00059: Add dark mode toggle' has finished with status: Completed. Please review the outcome and report back to the user.",
    );

    expect(view).toMatchObject({
      kind: "completed",
      text: "Completed plan",
      plan: { id: "00059", label: "#59 Add dark mode toggle" },
      jobId: "02991",
    });
    // The instructions are addressed to the agent, not the reader.
    expect(view.detail).toBeUndefined();
  });

  it("keeps the failure summary as the detail", () => {
    const view = formatSystemEvent(
      "[System Event] Job 02992 (ExecutePlan) for '00060: Port the picker' has finished with status: Failed (NpmTest failed on 3 tests)",
    );

    expect(view).toMatchObject({
      kind: "failed",
      text: "Failed plan",
      detail: "NpmTest failed on 3 tests",
    });
  });

  it("drops a summary that merely repeats the status", () => {
    const view = formatSystemEvent(
      "[System Event] Job 02993 (ExecutePlan) for '00061: Something' has finished with status: Failed (failed)",
    );

    expect(view.kind).toBe("failed");
    expect(view.detail).toBeUndefined();
  });

  it("reads a timeout as a failure and a cancellation as neither", () => {
    const timedOut = formatSystemEvent(
      "[System Event] Job 1 (ExecutePlan) for '00062: A' has finished with status: Timeout",
    );
    expect(timedOut).toMatchObject({ kind: "failed", text: "Timed out plan" });

    const cancelled = formatSystemEvent(
      "[System Event] Job 2 (ExecutePlan) for '00063: B' has finished with status: Cancelled",
    );
    expect(cancelled).toMatchObject({ kind: "info", text: "Cancelled plan" });
  });

  it("names a pull request job for what it is", () => {
    const view = formatSystemEvent(
      "[System Event] Job 3 (CreatePr) for '00064: C' has finished with status: Completed",
    );
    expect(view.text).toBe("Completed pull request");
  });

  it("quotes the raw subject when it is not a plan reference", () => {
    const view = formatSystemEvent(
      "[System Event] Job 4 (ExecutePlan) for 'some ad-hoc thing' has finished with status: Completed",
    );

    expect(view.text).toBe("Completed plan 'some ad-hoc thing'");
    expect(view.plan).toBeUndefined();
  });

  it("recognises a manual approval", () => {
    const view = formatSystemEvent(
      "[System Event] Manual approval granted and execution started for plan '00065: Wire the picker' (Job 02995). Begin work now.",
    );

    expect(view).toMatchObject({
      kind: "started",
      text: "Started plan '00065: Wire the picker'",
      jobId: "02995",
    });
  });

  it("passes an unrecognised event through, without its prefix", () => {
    const view = formatSystemEvent("[System Event] The daemon restarted.");
    expect(view).toEqual({ kind: "info", text: "The daemon restarted." });
  });

  it("handles a message that carries no prefix at all", () => {
    expect(formatSystemEvent("Something happened")).toEqual({
      kind: "info",
      text: "Something happened",
    });
  });
});
