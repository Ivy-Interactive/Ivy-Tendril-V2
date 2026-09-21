import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  JobDebugSheet,
  buildJobDebugFields,
  formatJobDebugDetails,
} from "../src/views/JobDebugSheet";
import { JobsView } from "../src/views/JobsView";
import { jobsStore } from "../src/state/jobsStore";
import { resetTableQueryTransport, setTableQueryTransport } from "../src/api/tableQuery";
import type { Job, JobDetail } from "../src/types/api";

/**
 * V1's Job Debug sheet (`Apps/Views/Sheets/JobDebugSheet.cs`), which the Jobs table's Debug row action
 * opens. Two properties carry the feature: the field list is V1's, and the copied text is a projection
 * of the *same* record the panel renders, so a paste into a bug report cannot disagree with what was on
 * screen.
 */

function detail(extra: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "00158",
    type: "ExecutePlan",
    project: "Ivy-Tendril-V2",
    status: "Completed",
    ...extra,
  };
}

const labels = (job: JobDetail) => buildJobDebugFields(job).map((field) => field.label);

afterEach(() => vi.restoreAllMocks());

describe("job debug fields", () => {
  it("keeps V1's labels and order", () => {
    const full = detail({
      planId: "00638",
      planTitle: "Rebuild the Jobs page",
      statusMessage: "Verification passed",
      model: "claude-opus-5",
      startedAt: "2026-01-01T09:00:00Z",
      completedAt: "2026-01-01T09:12:34Z",
      lastOutputAt: "2026-01-01T09:12:30Z",
      durationSeconds: 754,
      cost: 1.23456,
      tokens: 1_450_000,
      processId: 4242,
      detached: true,
      workingDirectory: "/repos/Ivy-Tendril-V2",
      args: '{"folderPath":"/plans/00638-Jobs"}',
      reportedFailureReason: "none",
      permissionDenials: ["Bash(rm -rf /)", "WebFetch(evil.example)"],
      provider: "claude",
      cliCommand: "claude -p --output-format stream-json",
      planFolder: "/plans/00638-Jobs",
      jobLogPath: "/home/.tendril/Logs/Jobs/00158.md",
      jobPromptPath: "/home/.tendril/Logs/Jobs/00158.prompt.md",
      jobRawLogPath: "/home/.tendril/Logs/Jobs/00158.raw.jsonl",
      jobEventwirePath: "/home/.tendril/Logs/Jobs/00158.eventwire.jsonl",
    });

    expect(labels(full)).toEqual([
      "Job Id",
      "Plan Id",
      "Prompt/Title",
      "Status",
      "Type",
      "Project",
      "Provider",
      "Model",
      "Started",
      "Completed",
      "Last Output",
      "Duration",
      "Cost",
      "Tokens",
      "Process Id",
      "Detached",
      "Working Directory",
      // V1's label for `CliCommand`, the command line the agent ran, ahead of the submitted args.
      "Arguments",
      "Args",
      "Failure Reason",
      "Permission Denials",
      // Paths last, as V1 groups them for a readable paste.
      "Plan Folder",
      "Job Log",
      "Job Prompt",
      "Job Raw Log",
      "Job Eventwire Log",
    ]);
  });

  /**
   * The diagnostic fields the projection used to drop: without them the sheet could not say which agent
   * ran, what it was launched with, or where the run's artifacts are — which is most of what the panel
   * is for on a job that hung.
   */
  it("carries the provider, the agent command line and the artifact paths", () => {
    const fields = buildJobDebugFields(
      detail({
        provider: "codex",
        cliCommand: "codex exec --json",
        planFolder: "/plans/00638-Jobs",
        jobRawLogPath: "/home/.tendril/Logs/Jobs/00158.raw.jsonl",
      }),
    );
    const value = (label: string) => fields.find((field) => field.label === label)?.value;

    expect(value("Provider")).toBe("codex");
    expect(value("Arguments")).toBe("codex exec --json");
    expect(value("Plan Folder")).toBe("/plans/00638-Jobs");
    expect(value("Job Raw Log")).toBe("/home/.tendril/Logs/Jobs/00158.raw.jsonl");
    // The DTO only reports an artifact that exists, so an absent one is a dropped row rather than a
    // path that cannot be opened.
    expect(labels(detail({ provider: "codex" }))).not.toContain("Job Log");
  });

  it("formats each value the way V1's record does", () => {
    const fields = buildJobDebugFields(
      detail({
        statusMessage: "Verification passed",
        startedAt: "2026-01-01T09:00:00.512Z",
        durationSeconds: 754,
        cost: 1.23456,
        tokens: 1_450_000,
        permissionDenials: ["Bash(rm -rf /)", "WebFetch(evil.example)"],
      }),
    );
    const value = (label: string) => fields.find((field) => field.label === label)?.value;

    // V1 folds the message into the status rather than giving it a field of its own.
    expect(value("Status")).toBe("Completed: Verification passed");
    // `"u"`: sortable, unambiguous, UTC, and the sub-second part dropped.
    expect(value("Started")).toBe("2026-01-01 09:00:00Z");
    expect(value("Duration")).toBe("754s");
    // Four decimals, not the table's two: a sub-cent run must not read as free here.
    expect(value("Cost")).toBe("$1.2346");
    expect(value("Tokens")).toBe("1,450,000");
    // One denial per line, which is why the field is multiline.
    expect(value("Permission Denials")).toBe("Bash(rm -rf /)\nWebFetch(evil.example)");
    expect(fields.find((field) => field.label === "Permission Denials")?.multiline).toBe(true);
  });

  /**
   * V1's `.RemoveEmpty()`, and the `Where(!IsNullOrEmpty)` in its copy projection. A panel of twenty
   * blank rows buries the three fields that were actually populated.
   */
  it("drops every field the job has no value for", () => {
    // A queued job: an id, a type, a project, a status, and nothing else recorded yet.
    expect(labels(detail({ status: "Queued" }))).toEqual(["Job Id", "Status", "Type", "Project"]);
    // `detached` and a zero cost are the two that must not be mistaken for absent — and `false` must
    // not be rendered as a value, matching how the daemon reports it.
    expect(labels(detail({ detached: false }))).not.toContain("Detached");
    expect(labels(detail({ detached: true }))).toContain("Detached");
    const zeroCost = buildJobDebugFields(detail({ cost: 0, tokens: 0 }));
    expect(zeroCost.find((f) => f.label === "Cost")?.value).toBe("$0.0000");
    expect(zeroCost.find((f) => f.label === "Tokens")?.value).toBe("0");
  });

  it("projects the copied text from the same record the panel renders", () => {
    const job = detail({ planId: "00638", tokens: 1000 });
    const fields = buildJobDebugFields(job);
    const text = formatJobDebugDetails(fields);

    // `FormatCopyDetails`: `Label: value`, one per line, in the panel's order, nothing extra.
    expect(text.split("\n")).toEqual(fields.map((field) => `${field.label}: ${field.value}`));
    expect(text).toContain("Job Id: 00158");
    expect(text).toContain("Plan Id: 00638");
    // A field the panel dropped is absent from the paste too, rather than appearing as an empty line.
    expect(text).not.toContain("Model:");
    expect(text.split("\n").every((line) => line.trim().length > 0)).toBe(true);
  });
});

describe("JobDebugSheet", () => {
  it("renders the fields and copies the same text the projection produces", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const job = detail({ planId: "00638", args: '{"folderPath":"/plans/00638"}' });
    render(<JobDebugSheet job={job} />);

    expect(screen.getByTestId("job-debug-fields")).toHaveTextContent("Job Id");
    expect(screen.getByTestId("job-debug-fields")).toHaveTextContent("00158");
    expect(screen.getByTestId("job-debug-fields")).toHaveTextContent(
      '{"folderPath":"/plans/00638"}',
    );

    fireEvent.click(screen.getByTestId("job-debug-copy"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(formatJobDebugDetails(buildJobDebugFields(job))),
    );
    // The button says so, because a copy that left no trace looks identical to one that failed.
    await waitFor(() => expect(screen.getByTestId("job-debug-copy")).toHaveTextContent("Copied"));
  });

  it("says so when the webview refuses the clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("clipboard blocked")) },
    });

    render(<JobDebugSheet job={detail()} />);
    fireEvent.click(screen.getByTestId("job-debug-copy"));

    // `copyToClipboard` tries the async Clipboard API and then an `execCommand` fallback before
    // giving up, so by the time this rejects the message describes that both mechanisms failed
    // rather than repeating `writeText`'s own error (which the helper keeps as `cause`, not text).
    // The whole point of the button is that the text left the app; a silent failure is worse than none.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not copy to the clipboard"),
    );
    expect(screen.getByTestId("job-debug-copy")).not.toHaveTextContent("Copied");
  });
});

/**
 * Timeout for a test that opens a Radix layer over a rendered `DataTable`.
 *
 * Generous on purpose. The test bodies here run in well under a second — the cost is jsdom's, spent
 * unwinding an open dropdown or dialog after the body has finished, and it grows with how loaded the
 * machine is: about ten seconds a test alone, and past twenty under a full parallel suite. A limit that
 * only holds on an idle machine is a flake, so this is set where contention cannot reach it.
 */
const RADIX_LAYER_TIMEOUT_MS = 60_000;

/**
 * The path a user actually takes: the row's kebab, then Debug, then the sheet.
 *
 * In its own file because opening a Radix menu over a rendered `DataTable` costs seconds of jsdom, and
 * sharing a file with the table's timing-sensitive tests made those flaky.
 */
describe("the Debug row action", () => {
  afterEach(() => {
    resetTableQueryTransport();
    vi.restoreAllMocks();
  });

  const listRow: Job = {
    id: "00158",
    type: "ExecutePlan",
    project: "Ivy-Tendril-V2",
    status: "Failed",
    planId: "00638",
  };

  it(
    "opens the Job Debug sheet on the row's detail",
    async () => {
      // The detail *is* the sheet: `args`, `workingDirectory` and `reportedFailureReason` are all
      // detail-only, so a panel built from the list row would show none of them.
      const fetched = detail({
        status: "Failed",
        statusMessage: "Verification 'Build' failed",
        planId: "00638",
        args: '{"folderPath":"/plans/00638-Jobs"}',
        workingDirectory: "/repos/Ivy-Tendril-V2",
        reportedFailureReason: "exit code 1",
      });
      const fetchJobDetail = vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue(fetched);
      setTableQueryTransport(() =>
        Promise.resolve({ rows: [listRow], totalRows: 1, rowCount: 1, offset: 0, limit: 50 }),
      );

      render(
        <JobsView
          jobs={[listRow]}
          jobDetails={{ "00158": fetched }}
          onStopAllQueued={() => {}}
          onStopAll={() => {}}
        />,
      );
      await waitFor(() => expect(document.querySelectorAll("tbody [data-row-id]")).toHaveLength(1));

      // `keyDown` rather than `click`: Radix's trigger toggles on a `PointerEvent` jsdom does not
      // implement, and `Enter` on the focused trigger is the other path it opens on.
      fireEvent.keyDown(screen.getByRole("button", { name: "Job actions" }), { key: "Enter" });
      fireEvent.click(screen.getByRole("menuitem", { name: /Debug/ }));

      const sheet = await waitFor(() => screen.getByTestId("job-debug-sheet"));
      expect(sheet).toHaveTextContent("Job Debug");
      expect(fetchJobDetail).toHaveBeenCalledWith("00158");

      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(screen.getByTestId("job-debug-fields")).toBeInTheDocument());
      const fields = screen.getByTestId("job-debug-fields");
      // The three detail-only fields, which is the proof the sheet is on the fetched record and not on
      // the list row it was opened from.
      expect(fields).toHaveTextContent("Failed: Verification 'Build' failed");
      expect(fields).toHaveTextContent("/repos/Ivy-Tendril-V2");
      expect(fields).toHaveTextContent('{"folderPath":"/plans/00638-Jobs"}');
      expect(fields).toHaveTextContent("exit code 1");
    },
    RADIX_LAYER_TIMEOUT_MS,
  );
});
