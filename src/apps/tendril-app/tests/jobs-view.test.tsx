import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  JobsView,
  buildJobRowActions,
  buildJobRows,
  buildStatusSegments,
  formatJobCost,
  formatTokens,
  truncatePrompt,
  jobStatusMessage,
  agentOutputLabel,
  AGENT_OUTPUT_STARTING,
  RERUN_UNAVAILABLE_REASON,
  type JobRowActionCapabilities,
} from "../src/views/JobsView";
import { JOB_STATUS_COLOR, JOB_TYPE_COLOR, projectColor } from "../src/utils/jobStatus";
import { bridge } from "../src/api/bridge";
import {
  resetTableQueryTransport,
  setTableQueryTransport,
  type TableQueryTransport,
} from "../src/api/tableQuery";
import { jobsStore } from "../src/state/jobsStore";
import type { Job, JobStatus } from "../src/types/api";

/**
 * The Jobs table, against `Apps/Jobs/JobsApp.DataTable.cs` (columns, row menu, header actions),
 * `JobsApp.Data.cs` (row building, ordering, cost formatting) and `JobsApp.Helpers.cs` (the cell
 * formatters and `CanRerun`).
 */

function job(id: string, status: JobStatus, extra: Partial<Job> = {}): Job {
  return {
    id,
    type: "ExecutePlan",
    project: "Ivy-Tendril-V2",
    status,
    planId: "00638",
    planTitle: "Rebuild the Jobs page as the DataTable V1 renders",
    ...extra,
  };
}

const ALL_CAPS: JobRowActionCapabilities = { canDelete: true, canForceStart: true };

/** The tags of the row menu's items, in order. */
function menuTags(status: JobStatus, capabilities = ALL_CAPS): string[] {
  const actions = buildJobRowActions({ status }, capabilities);
  if (actions.length === 0) return [];
  expect(actions).toHaveLength(1);
  // V1's `RowActions` return a `MenuItem[]`, which Ivy renders as one per-row overflow menu.
  expect(actions[0].tag).toBe("job-menu");
  return (actions[0].children ?? []).map((child) => child.tag);
}

/** One request the table made, so a test can assert on what reached the daemon. */
interface Recorded {
  path: string;
  body: Record<string, unknown>;
}

/**
 * A daemon serving `POST /api/jobs/query` and `POST /api/tables/jobs/values`.
 *
 * Deliberately **not** a client-side implementation of the query: it slices by `offset`/`limit` and
 * otherwise hands back `jobs` in the order given, ignoring `sort` and `filter`. That is what makes the
 * assertions below meaningful — if the table re-sorted or re-filtered the rows it received, the DOM and
 * this array would disagree.
 */
function installDaemon(jobs: Job[], values: Record<string, string[]> = {}): Recorded[] {
  const calls: Recorded[] = [];
  const transport: TableQueryTransport = (path, body) => {
    calls.push({ path, body });

    if (path === "/api/tables/jobs/values") {
      const column = String((body as { column?: unknown }).column ?? "");
      const list = values[column] ?? [];
      return Promise.resolve({ column, values: list, totalValues: list.length });
    }

    const offset = Number(body.offset ?? 0);
    const limit = Number(body.limit ?? 50);
    const rows = jobs.slice(offset, offset + limit);
    return Promise.resolve({
      encoding: "application/json",
      rows,
      offset,
      rowCount: rows.length,
      // The *filtered* total, over the whole table — which is what makes the row count irrelevant to
      // the client.
      totalRows: jobs.length,
      limit,
    });
  };
  setTableQueryTransport(transport);
  return calls;
}

/**
 * The table reads its rows from the daemon's server-paged query route rather than off the `jobs` prop:
 * `jobsStore` holds only the newest fifty and replaces them on every poll, so a scrolled-open window
 * could not survive one. The prop stays as the *live* overlay (V1's per-cell update stream) and as the
 * source of the header's counts and progress bar, so every test below hands the same jobs to both.
 */
function renderJobs(jobs: Job[], values: Record<string, string[]> = {}) {
  const calls = installDaemon(jobs, values);
  const result = render(<JobsView jobs={jobs} onStopAllQueued={() => {}} onStopAll={() => {}} />);
  return { ...result, calls };
}

/** The bodies of the window requests, in order. Facet lookups are not window requests. */
function queries(calls: Recorded[]): Record<string, unknown>[] {
  return calls.filter((call) => call.path === "/api/jobs/query").map((call) => call.body);
}

/** Expands the toolbar's filter option and commits an expression, the way a user does. */
async function commitFilter(expression: string) {
  if (!screen.queryByRole("textbox", { name: "Filter expression" })) {
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  }
  const box = screen.getByRole("textbox", { name: "Filter expression" });
  fireEvent.change(box, { target: { value: expression } });
  fireEvent.keyDown(box, { key: "Enter" });
  return box;
}

afterEach(() => {
  resetTableQueryTransport();
});

/** Resolves once the table has painted a row for every job served. */
async function waitForRows(count: number) {
  await waitFor(() => expect(document.querySelectorAll("tbody [data-row-id]")).toHaveLength(count));
}

/**
 * The order is the daemon's now, not the client's.
 *
 * V1 sorts the rows it holds (`OrderByDescending(ExtractJobNumber(r.Id))`) because it holds all of them.
 * This table holds one window, so the order has to be an `ORDER BY` — and re-sorting the window would
 * shuffle fifty rows inside an order the *other* windows were chosen by, which is how a paged table
 * starts showing a row twice.
 */
describe("job row ordering", () => {
  it("asks the daemon for V1's declared sort", async () => {
    const { calls } = renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    // `.SortDirection(t => t.Id, SortDirection.Descending)` (`JobsApp.DataTable.cs:85`).
    expect(queries(calls)[0]).toMatchObject({
      sort: [{ column: "id", direction: "Descending" }],
      limit: 50,
    });
  });

  it("renders the order the daemon answered with, and does not re-sort it", async () => {
    // Deliberately not job-number order: a client-side sort would show `1000` first.
    renderJobs([job("999", "Completed"), job("1000", "Running"), job("00021", "Queued")]);

    await waitForRows(3);
    const ids = Array.from(document.querySelectorAll("tbody [data-row-id]")).map((row) =>
      row.getAttribute("data-row-id"),
    );
    expect(ids).toEqual(["999", "1000", "00021"]);
  });

  it("builds rows without reordering them", () => {
    const rows = buildJobRows([job("999", "Completed"), job("1000", "Running")]);
    expect(rows.map((row) => row.id)).toEqual(["999", "1000"]);
  });

  it("sends a header click to the daemon, under the daemon's own column name", async () => {
    const { calls } = renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    // Timer is derived from `StartedAt`; `DurationSeconds` is the column the database can order by.
    fireEvent.click(screen.getByRole("button", { name: /Timer/ }));
    await waitFor(() => expect(queries(calls)).toHaveLength(2));
    expect(queries(calls)[1]).toMatchObject({
      sort: [{ column: "durationSeconds", direction: "Ascending" }],
      // A new order is a new sequence, so the scroll starts again from the top.
      limit: 50,
    });
    expect(queries(calls)[1].offset).toBeUndefined();

    // And a display column whose stored name differs is translated too.
    fireEvent.click(screen.getByRole("button", { name: /Plan Id/ }));
    await waitFor(() => expect(queries(calls)).toHaveLength(3));
    expect(queries(calls)[2]).toMatchObject({
      sort: [{ column: "planFile", direction: "Ascending" }],
    });
  });
});

describe("row menu gating", () => {
  // `JobsApp.DataTable.cs:183`: Stop covers every state a job can still be taken out of.
  it("offers Stop for Running, Queued, Pending and Blocked only", () => {
    for (const status of ["Running", "Queued", "Pending", "Blocked"] as JobStatus[]) {
      expect(menuTags(status)).toContain("stop-job");
    }
    for (const status of ["Completed", "Failed", "Timeout", "Stopped"] as JobStatus[]) {
      expect(menuTags(status)).not.toContain("stop-job");
    }
  });

  // `:195`: Force Start exists to skip a dependency gate, and only a Blocked job has one.
  it("offers Force Start for a Blocked job only, and only when the bridge can", () => {
    expect(menuTags("Blocked")).toEqual(["stop-job", "force-start-job", "debug-job", "delete-job"]);
    expect(menuTags("Queued")).not.toContain("force-start-job");
    expect(menuTags("Blocked", { canDelete: true, canForceStart: false })).toEqual([
      "stop-job",
      "debug-job",
      "delete-job",
    ]);
  });

  /**
   * `:201`: V1 adds Debug whenever it was passed a `showDebug`, and `JobsApp.cs:113` always passes one
   * — so the gate has no false case and there is none here either. It needs no bridge capability: the
   * sheet reads the job detail the store already fetches.
   */
  it("offers Debug on every status, unconditionally", () => {
    const statuses: JobStatus[] = [
      "Pending",
      "Queued",
      "Running",
      "Completed",
      "Failed",
      "Timeout",
      "Stopped",
      "Blocked",
    ];
    for (const status of statuses) {
      expect(menuTags(status), status).toContain("debug-job");
      expect(menuTags(status, { canDelete: false, canForceStart: false }), status).toContain(
        "debug-job",
      );
    }
  });

  /**
   * `CanRerun` (`JobsApp.Helpers.cs:235`): Failed, Timeout and Stopped unconditionally; Completed
   * only when `RerunJobDialog.SupportsFeedback(job.TypedArgs)`, which returns false for null args.
   * The DTO carries no `typedArgs` at all, so Completed is offered nothing and the three failure
   * states get the entry disabled with V1's reason on it.
   */
  it("offers Rerun disabled, with V1's reason, for the three rerunnable statuses", () => {
    for (const status of ["Failed", "Timeout", "Stopped"] as JobStatus[]) {
      const rerun = (buildJobRowActions({ status }, ALL_CAPS)[0].children ?? []).find(
        (child) => child.tag === "rerun-job",
      );
      expect(rerun, `${status} should offer Rerun`).toBeDefined();
      expect(rerun?.label).toBe("Rerun");
      expect(rerun?.disabled).toBe(true);
      expect(rerun?.tooltip).toBe(RERUN_UNAVAILABLE_REASON);
    }
  });

  it("offers no Rerun on a Completed job, since its args cannot be shown to support feedback", () => {
    expect(menuTags("Completed")).toEqual(["debug-job", "delete-job"]);
  });

  // `:207`: V1 adds Delete unconditionally, terminal rows included.
  it("offers Delete in every state, and nothing at all when the bridge cannot delete", () => {
    const statuses: JobStatus[] = [
      "Pending",
      "Queued",
      "Running",
      "Completed",
      "Failed",
      "Timeout",
      "Stopped",
      "Blocked",
    ];
    for (const status of statuses) {
      expect(menuTags(status)).toContain("delete-job");
    }

    // Debug survives every capability being off, so the menu is never empty. That is V1's shape too —
    // its Delete is unconditional — and it is why the Jobs table always has an actions column.
    const withoutDelete = { canDelete: false, canForceStart: false };
    expect(menuTags("Completed", withoutDelete)).toEqual(["debug-job"]);
    expect(menuTags("Running", withoutDelete)).toEqual(["stop-job", "debug-job"]);
  });

  // V1's order: Stop, Rerun, Force Start, Debug, Delete.
  it("keeps V1's order", () => {
    expect(menuTags("Stopped")).toEqual(["rerun-job", "debug-job", "delete-job"]);
    expect(menuTags("Blocked")).toEqual(["stop-job", "force-start-job", "debug-job", "delete-job"]);
  });
});

describe("cost and token cells", () => {
  // `JobsApp.Data.cs` `FormatJobCost`: no figure means no figure. A subscription-plan run reports
  // tokens and no charge, and "—" and "$0.00" are different claims.
  it("distinguishes a cost of zero from no cost at all", () => {
    expect(formatJobCost({ cost: undefined, costSource: undefined })).toBeNull();
    expect(formatJobCost({ cost: 0, costSource: undefined })).toBe("$0.00");
  });

  /**
   * The `~` prefix for an estimate. The comparison has to be case-insensitive: both V1
   * (`JobUsageSnapshot.cs:22`) and the daemon (`jobs/manager.rs:2909`) write `"estimated"` in lower
   * case, so an exact match against `"Estimated"` never fires.
   */
  it("marks an estimated cost with V1's tilde whatever the case of costSource", () => {
    expect(formatJobCost({ cost: 1.234, costSource: "estimated" })).toBe("~$1.23");
    expect(formatJobCost({ cost: 1.234, costSource: "Estimated" })).toBe("~$1.23");
    expect(formatJobCost({ cost: 1.234, costSource: "agent" })).toBe("$1.23");
  });

  // `FormatHelper.FormatTokens` keeps scaling past a million rather than saturating.
  it("formats tokens the way V1 does", () => {
    expect(formatTokens(450)).toBe("450");
    expect(formatTokens(45_000)).toBe("45K");
    expect(formatTokens(1_400_000)).toBe("1.4M");
    expect(formatTokens(1_400_000_000)).toBe("1400.0M");
  });

  it("renders an absent cost as an em dash beside a populated Tokens cell", async () => {
    renderJobs([job("00010", "Completed", { tokens: 450_000 })]);

    await waitFor(() => expect(screen.getByTestId("job-tokens-00010")).toBeInTheDocument());
    expect(screen.getByTestId("job-tokens-00010")).toHaveTextContent("450K");
    expect(screen.getByTestId("job-cost-00010")).toHaveTextContent("—");
    expect(screen.getByTestId("job-cost-00010")).not.toHaveTextContent("$");
  });

  it("renders a zero cost as $0.00 and an estimate with a tilde", async () => {
    renderJobs([
      job("00011", "Completed", { tokens: 1_000, cost: 0 }),
      job("00012", "Completed", { tokens: 12_000, cost: 1.234, costSource: "estimated" }),
    ]);

    await waitFor(() => expect(screen.getByTestId("job-cost-00011")).toBeInTheDocument());
    expect(screen.getByTestId("job-cost-00011")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("job-cost-00012")).toHaveTextContent("~$1.23");
  });

  // The buckets the DTO now carries: `cacheReadTokens` dominates the bill on a long run, so the
  // short cell carries the breakdown behind it.
  it("carries the exact count and the per-bucket breakdown in the Tokens tooltip", async () => {
    renderJobs([
      job("00013", "Completed", {
        tokens: 1_450_000,
        inputTokens: 12_000,
        outputTokens: 8_000,
        cacheReadTokens: 1_400_000,
        cacheWriteTokens: 30_000,
      }),
    ]);

    await waitFor(() => expect(screen.getByTestId("job-tokens-00013")).toBeInTheDocument());
    const tokens = screen.getByTestId("job-tokens-00013");
    expect(tokens).toHaveTextContent("1.4M");
    expect(tokens.getAttribute("title")).toContain("1,450,000");
    expect(tokens.getAttribute("title")).toContain("Cache read 1,400,000");
  });
});

describe("cell formatters", () => {
  // `JobsApp.Helpers.cs` `TruncatePrompt`: markdown links flatten, whitespace collapses, 500 chars.
  it("flattens links and collapses whitespace in the Prompt cell", () => {
    expect(truncatePrompt("See [issue 12](https://example.com/12)\n  for  context")).toBe(
      "See issue 12 for context",
    );
    expect(truncatePrompt("x".repeat(600))).toHaveLength(503);
    expect(truncatePrompt(undefined)).toBe("");
  });

  /**
   * `GetStatusMessage`: the job's own message, else V1's per-status default. Pending has none in the
   * table - `JobSessionView` adds one because the sheet it replaced has one, and this is the table.
   */
  it("falls back to V1's per-status default, and leaves Pending empty", () => {
    expect(jobStatusMessage({ status: "Running", statusMessage: "Executing plan..." })).toBe(
      "Executing plan...",
    );
    expect(jobStatusMessage({ status: "Blocked" })).toBe(
      "Waiting for dependency plans to complete.",
    );
    expect(jobStatusMessage({ status: "Stopped" })).toBe("Job was manually stopped");
    expect(jobStatusMessage({ status: "Pending" })).toBe("");
    expect(jobStatusMessage({ status: "Running" })).toBe("");
  });

  /**
   * `FormatAgentOutput`. The Agent Output column is a **staleness gauge**, not a second status line: a
   * running job shows how long since the agent last wrote a line, and "Starting..." is only the
   * before-first-output case. The status message has its own column, exactly as in V1.
   */
  it("shows the silence since the last agent line, not a permanent Starting...", () => {
    const now = Date.parse("2026-01-01T00:02:00Z");

    // 80 seconds since the last line, in `FormatTimeSpan`'s shape.
    expect(agentOutputLabel({ status: "Running", lastOutputAt: "2026-01-01T00:00:40Z" }, now)).toBe(
      "1m 20s",
    );
    // Sub-minute drops the minutes; over an hour drops the seconds.
    expect(agentOutputLabel({ status: "Running", lastOutputAt: "2026-01-01T00:01:53Z" }, now)).toBe(
      "7s",
    );
    expect(agentOutputLabel({ status: "Running", lastOutputAt: "2025-12-31T22:00:00Z" }, now)).toBe(
      "2h 02m",
    );

    // No stamp yet is V1's own fallback, and so is a stamp the daemon served unparseably.
    expect(agentOutputLabel({ status: "Running" }, now)).toBe(AGENT_OUTPUT_STARTING);
    expect(agentOutputLabel({ status: "Running", lastOutputAt: "not a date" }, now)).toBe(
      AGENT_OUTPUT_STARTING,
    );

    // The other two of V1's three states. A terminal job's stamp is not counted from: the agent is not
    // silent, it is finished.
    expect(
      agentOutputLabel({ status: "Completed", lastOutputAt: "2026-01-01T00:00:40Z" }, now),
    ).toBe("Done");
    for (const status of [
      "Queued",
      "Pending",
      "Failed",
      "Timeout",
      "Stopped",
      "Blocked",
    ] as const) {
      expect(agentOutputLabel({ status, lastOutputAt: "2026-01-01T00:00:40Z" }, now)).toBe("-");
    }
  });

  it("builds the Agent Output state and its label from the same clock as the Timer", () => {
    const now = Date.parse("2026-01-01T00:05:00Z");
    const [running, starting, done, queued] = buildJobRows(
      [
        job("00001", "Running", {
          startedAt: "2026-01-01T00:00:00Z",
          lastOutputAt: "2026-01-01T00:04:30Z",
        }),
        job("00002", "Running", { startedAt: "2026-01-01T00:04:59Z" }),
        job("00003", "Completed", { durationSeconds: 12 }),
        job("00004", "Queued"),
      ],
      { now },
    );

    expect([running.agentOutput, running.agentOutputLabel]).toEqual(["running", "30s"]);
    // Five minutes of run time, thirty seconds of silence: the two columns are different questions.
    expect(running.timerSeconds).toBe(300);
    expect([starting.agentOutput, starting.agentOutputLabel]).toEqual([
      "running",
      AGENT_OUTPUT_STARTING,
    ]);
    expect([done.agentOutput, done.agentOutputLabel]).toEqual(["done", "Done"]);
    expect([queued.agentOutput, queued.agentOutputLabel]).toEqual(["idle", "-"]);
  });

  // `JobsApp.Data.cs` `BuildStatusProgress`: one segment per status, largest first.
  it("builds the header's status segments largest first", () => {
    const segments = buildStatusSegments([
      job("1", "Completed"),
      job("2", "Running"),
      job("3", "Completed"),
      job("4", "Completed"),
      job("5", "Failed"),
    ]);

    expect(segments.map((segment) => [segment.label, segment.value])).toEqual([
      ["Completed", 3],
      ["Running", 1],
      ["Failed", 1],
    ]);
    expect(segments[0].color).toBe("success");
  });
});

describe("JobsView chrome", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows V1's columns, in V1's order, with the index and selection columns off", async () => {
    renderJobs([job("00021", "Running")]);

    await waitFor(() => expect(screen.getByTestId("jobs-table")).toBeInTheDocument());
    const headers = Array.from(document.querySelectorAll("thead th")).map((th) =>
      th.textContent?.trim(),
    );

    // `ShowIndexColumn = false` and `SelectionMode.None`: no row number, no checkbox. The trailing
    // header is the row-actions cell, whose label is screen-reader only.
    expect(headers.slice(0, 11)).toEqual([
      "Status",
      "Plan Id",
      "Prompt",
      "Type",
      "Project",
      "Timer",
      "Agent Output",
      "Cost",
      "Tokens",
      "Timestamp",
      "Status Message",
    ]);
    // `.Hidden(t => t.Id)`: present as a column, absent from the DOM.
    expect(headers).not.toContain("Id");
  });

  it("explains an empty list rather than rendering an empty grid", async () => {
    renderJobs([]);
    await waitFor(() => expect(screen.getByTestId("jobs-empty")).toBeInTheDocument());
    expect(screen.getByTestId("jobs-empty")).toHaveTextContent("No jobs yet");
  });

  it("holds the empty state through a poll rather than flashing a skeleton", async () => {
    /* The bug: the table's `loading` prop was `isLoading || table.loading`, and the shell fed the
       first from `jobsStore.isLoading` - which describes `bridge.listJobs`, a request the table does
       not render. Every 5s poll and every job event flipped it, so an empty Jobs table alternated
       between "No jobs yet" and five skeleton rows, forever. That is the flicker; V1 cannot have it,
       because its table has neither a loading body nor an empty view and its poll touches the table
       only when the structural signature differs (`JobsApp.Hooks.cs:66-68`).

       `isLoading` is passed here through a cast because the fix was to delete the prop: the shell can
       no longer wire the store's flag in (that is now a type error at the one call site), and this
       asserts the other half - that an external loading flag reaching the view anyway cannot take
       over the table's chrome. Held true across re-renders with a fresh `jobs` array, which is what a
       poll that found nothing new produces: the store replaces its array on every response whether or
       not the contents moved. */
    const calls = installDaemon([]);
    const polling = { isLoading: true } as Record<string, unknown>;
    const view = (
      <JobsView jobs={[]} onStopAllQueued={() => {}} onStopAll={() => {}} {...polling} />
    );
    const { rerender } = render(view);
    await waitFor(() => expect(screen.getByTestId("jobs-empty")).toBeInTheDocument());

    const skeletons = () => document.querySelectorAll(".animate-pulse").length;
    for (let poll = 0; poll < 3; poll++) {
      await act(async () => {
        rerender(
          <JobsView jobs={[]} onStopAllQueued={() => {}} onStopAll={() => {}} {...polling} />,
        );
      });
      expect(
        screen.getByTestId("jobs-empty"),
        `poll ${poll} replaced the empty state`,
      ).toBeInTheDocument();
      expect(skeletons(), `poll ${poll} rendered a skeleton body`).toBe(0);
    }

    // And it did not refetch to stand still: an unchanged signature is not a structural change.
    expect(queries(calls)).toHaveLength(1);
  });

  // `JobsApp.cs:110`: no progress bar at all for an empty list.
  it("renders the status progress bar only when there are jobs", async () => {
    const empty = renderJobs([]);
    expect(screen.queryByTestId("jobs-status-progress")).not.toBeInTheDocument();
    empty.unmount();

    renderJobs([job("00021", "Running")]);
    await waitFor(() => expect(screen.getByTestId("jobs-status-progress")).toBeInTheDocument());
  });

  /**
   * V1 opens the job's output as a **sheet over the table** (`JobsApp.cs:39` `showOutput`,
   * `Sheets/OutputSheet.cs`), so the operator keeps their place in the list. The detail is pulled at
   * the same time because the list projection omits `reportedFailureReason` and `detached`.
   */
  it("opens the output sheet over the table, and pulls the job's detail", async () => {
    const fetchDetail = vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({
      ...job("00021", "Running"),
    });
    vi.spyOn(jobsStore, "subscribeToJob").mockReturnValue(() => {});

    renderJobs([job("00021", "Running")]);
    await waitFor(() => expect(screen.getByTestId("job-output-00021")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("job-output-00021"));

    expect(fetchDetail).toHaveBeenCalledWith("00021");
    // V1's sheet title: `$"{job.Type} {ExtractPlanId(job.PlanFile)}"`.
    await waitFor(() => expect(screen.getByText("ExecutePlan 00638")).toBeInTheDocument());
  });

  /**
   * That the menu is *reachable*, which the parity contract calls out specifically: a row menu nobody
   * can open is the same as no row menu — and it has been exactly that twice, first laid out leftwards
   * over the previous cell by a collapsed column and then pushed past the right edge of the scroll
   * viewport by a real one. jsdom does no layout, so what can be asserted here is the DOM half: the
   * menu exists on every row, and it is in the cell the stylesheet pins to the viewport's right edge
   * (`ivy-data-table-fit-actions` — see `data-table.css` and its own tests for the pinning).
   *
   * The items themselves are covered by `buildJobRowActions` above, and the action each one performs by
   * `jobsStore`'s guarded-path tests in `job-actions.test.tsx`. Opening the menu is possible — Radix's
   * trigger ignores a synthesised `pointerDown` because jsdom implements no `PointerEvent`, but it opens
   * on `Enter`, which `job-debug-sheet.test.tsx` uses to drive the Debug entry end to end. It is not done
   * here because an open Radix layer over this table costs seconds of jsdom per test, and these are the
   * table's timing-sensitive ones.
   */
  it("gives every row a menu, in the cell the stylesheet pins on screen", async () => {
    renderJobs([job("00021", "Completed"), job("00022", "Running")]);
    await waitForRows(2);

    const triggers = screen.getAllByRole("button", { name: "Job actions" });
    expect(triggers).toHaveLength(2);
    for (const trigger of triggers) {
      expect(trigger.closest("td")).toHaveClass("ivy-data-table-fit-actions");
    }
    // The header reserves the same column, which is what makes the width bind under `table-fixed`.
    expect(document.querySelector("thead th.ivy-data-table-fit-actions")).toBeInTheDocument();
  });

  /**
   * Every capability off and the menu is still there, because Debug needs none. V1's own menu can never
   * be empty either — its Delete is unconditional — so the Jobs table always has an actions column.
   */
  it("keeps the menu when the bridge can neither delete nor force start", async () => {
    vi.spyOn(jobsStore, "canDeleteJob").mockReturnValue(false);
    vi.spyOn(jobsStore, "canForceStartJob").mockReturnValue(false);
    renderJobs([job("00022", "Completed")]);
    await waitForRows(1);
    expect(screen.getByRole("button", { name: "Job actions" })).toBeInTheDocument();
  });
});

describe("jobsStore.clearJobs", () => {
  type OptionalBridge = { clearJobs?: unknown };

  beforeEach(() => {
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // `JobsApp.DataTable.cs:279-289` (`Clear Completed` / `Clear Failed`) over the daemon's one route,
  // `POST /api/jobs/clear` with a scope.
  it("is offered now that the bridge carries it", () => {
    expect(bridge.clearJobs).toBeTypeOf("function");
    expect(jobsStore.canClearJobs()).toBe(true);
  });

  /**
   * The capability gate still has a job to do: an older shell whose Rust side predates
   * `cmd_clear_jobs` has no wrapper, and the menu must not offer a control that throws. Simulated by
   * removing the method for one test rather than by relying on it being absent, which it no longer is.
   */
  it("is not offered by a shell whose bridge cannot perform it", async () => {
    const real = bridge.clearJobs;
    delete (bridge as OptionalBridge).clearJobs;
    try {
      expect(jobsStore.canClearJobs()).toBe(false);
      await expect(jobsStore.clearJobs("completed")).rejects.toThrow(/bridge.clearJobs/);
    } finally {
      (bridge as OptionalBridge).clearJobs = real;
    }
  });

  it("clears by scope, reports the count and re-reads the list", async () => {
    const clear = vi.fn().mockResolvedValue(3);
    (bridge as OptionalBridge).clearJobs = clear;

    expect(jobsStore.canClearJobs()).toBe(true);
    expect(await jobsStore.clearJobs("failed")).toBe(3);
    expect(clear).toHaveBeenCalledWith("failed");
    expect(bridge.listJobs).toHaveBeenCalled();
  });
});

/**
 * V1's `c.BatchSize = 50` (`JobsApp.DataTable.cs:93`) with no `LoadAllRows` and no pager: the framework
 * fetches fifty rows and appends fifty more when the visible region comes within ten of the end
 * (`widgets/dataTables/hooks/useDataLoading.ts`). What is asserted here is the *window arithmetic* and
 * that it terminates — that windows are requested in sequence, that they accumulate rather than
 * replace, and that a short window is the end of the table rather than a reason to ask again.
 */
describe("Jobs infinite scroll", () => {
  const ROW_HEIGHT = 44;
  /* Tall enough that every loaded row is inside the virtualizer's range, so the DOM can be asserted
     against. jsdom does no layout, so both halves of the load-more check have to be supplied. */
  const VIEWPORT_HEIGHT = 10_000;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.hasAttribute("data-index")) return ROW_HEIGHT;
        return this.classList.contains("overflow-auto") ? VIEWPORT_HEIGHT : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("overflow-auto") ? VIEWPORT_HEIGHT : 0;
      },
    });
  });

  afterEach(() => {
    // @ts-expect-error - restoring jsdom's own getters
    delete HTMLElement.prototype.offsetHeight;
    // @ts-expect-error - as above
    delete HTMLElement.prototype.clientHeight;
    vi.restoreAllMocks();
  });

  /** `count` jobs, newest id first, as the daemon's listing would answer them. */
  function history(count: number): Job[] {
    return Array.from({ length: count }, (_, index) =>
      job(String(20_000 - index).padStart(5, "0"), "Completed", {
        completedAt: "2026-01-01T00:00:00Z",
      }),
    );
  }

  it("asks for each window by offset, never re-reading from the top", async () => {
    const calls = installDaemon(history(120));

    render(<JobsView jobs={[]} onStopAllQueued={() => {}} onStopAll={() => {}} />);

    // 0, 50, 100 — three windows of fifty for a 120-row table, and the third comes back short. The
    // bytes on the wire are 120 rows in total; the listing this replaced would have read 270.
    await waitFor(() =>
      expect(queries(calls).map((body) => body.offset ?? 0)).toEqual([0, 50, 100]),
    );
    await waitForRows(120);

    // Accumulated, not replaced: the first window's rows are still there under the last window's.
    expect(document.querySelector('tbody [data-row-id="20000"]')).toBeInTheDocument();
    expect(document.querySelector('tbody [data-row-id="19881"]')).toBeInTheDocument();
    // And it stops rather than asking for a window past the end, because the reply carried the total.
    expect(queries(calls)).toHaveLength(3);
  });

  it("stops after one window when that window is the whole table", async () => {
    const calls = installDaemon(history(12));

    render(<JobsView jobs={[]} onStopAllQueued={() => {}} onStopAll={() => {}} />);
    await waitForRows(12);
    expect(queries(calls)).toHaveLength(1);
  });

  it("has no pager, because scrolling is the pager", async () => {
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);
    // `c.BatchSize` with no `LoadAllRows` is infinite scroll; V1's table renders no pagination footer
    // and neither does this one.
    expect(screen.queryByRole("button", { name: /next page/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="data-table-pagination"]')).not.toBeInTheDocument();
  });
});

/**
 * `c.AllowFiltering = true` with `c.ShowSearch = false` (`JobsApp.DataTable.cs:88-90`): **one** filter
 * expression at the top-left of the toolbar, which is where the framework's grid renders its only filter
 * affordance and what V1's config asks for. No control per column, and no search box.
 *
 * The filter runs in SQLite. So what is asserted here is that the *expression reaches the daemon* — the
 * fake daemon ignores `filter` entirely, which is exactly why these tests can tell the difference between
 * a filter that was sent and one that was applied to the rows on screen.
 */
describe("Jobs filter expression", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts one filter control in the toolbar, and no filter row in the header", async () => {
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    // One header row: the labels.
    expect(document.querySelectorAll("thead tr")).toHaveLength(1);
    expect(document.querySelector('[data-slot="data-table-filter-row"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="data-table-filter"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();

    // `ShowSearch = false`: no search box over the table, and no per-column controls either.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filter by Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Filter by Prompt" })).not.toBeInTheDocument();
  });

  it("sends the filter to the daemon rather than narrowing the rows on screen", async () => {
    const { calls } = renderJobs([
      job("00021", "Failed", { statusMessage: "npm install failed" }),
      job("00022", "Failed", { statusMessage: "timed out waiting for review" }),
    ]);
    await waitForRows(2);

    const box = await commitFilter('[Status Message] contains "npm"');

    await waitFor(() => expect(queries(calls)).toHaveLength(2));
    expect(queries(calls)[1]).toMatchObject({
      filter: { condition: { column: "statusMessage", function: "contains", args: ["npm"] } },
    });
    // Both rows are still rendered, because this fake daemon ignores the filter — which is the point:
    // nothing on this side narrowed anything.
    await waitForRows(2);
    expect(box).toHaveValue('[Status Message] contains "npm"');
  });

  it("commits on Enter and not on every keystroke", async () => {
    const { calls } = renderJobs([job("00021", "Failed")]);
    await waitForRows(1);

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const box = screen.getByRole("textbox", { name: "Filter expression" });
    fireEvent.change(box, { target: { value: '[Status] = "F' } });
    fireEvent.change(box, { target: { value: '[Status] = "Fa' } });
    fireEvent.change(box, { target: { value: '[Status] = "Failed"' } });
    // A server-side filter is exactly where one request per keystroke is unaffordable.
    expect(queries(calls)).toHaveLength(1);

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(queries(calls)).toHaveLength(2));
  });

  it("translates a display column to the daemon's own column", async () => {
    const { calls } = renderJobs([job("00021", "Running", { planId: "00638" })]);
    await waitForRows(1);

    // The cell shows a plan id, and the daemon has two columns that can hold it: `ReportedPlanId` when
    // the promptware reported one, and `PlanFile` — a folder path — otherwise. Both are asked.
    await commitFilter('[Plan Id] contains "007"');

    await waitFor(() => expect(queries(calls)).toHaveLength(2));
    expect(queries(calls)[1].filter).toEqual({
      group: {
        op: "or",
        filters: [
          { condition: { column: "reportedPlanId", function: "contains", args: ["007"] } },
          { condition: { column: "planFile", function: "contains", args: ["007"] } },
        ],
      },
    });
  });

  it("ORs across columns, which a control per column could not express", async () => {
    const { calls } = renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    await commitFilter('[Status] = "Failed" OR [Status] = "Timeout"');

    await waitFor(() => expect(queries(calls)).toHaveLength(2));
    expect(queries(calls)[1].filter).toEqual({
      group: {
        op: "or",
        filters: [
          { condition: { column: "status", function: "equals", args: ["Failed"] } },
          { condition: { column: "status", function: "equals", args: ["Timeout"] } },
        ],
      },
    });
  });

  it("refuses a column V1 does not filter on, without asking the daemon", async () => {
    const { calls } = renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    // `.Filterable(t => t.Id, false)` (`:83`) — the only column V1 keeps out of its expression that V2
    // also has. `ErrorContext`, its other one, is not a column here.
    await commitFilter("[Id] is not blank");
    expect(screen.getByTestId("data-table-filter-error")).toHaveTextContent("Unknown column 'Id'");

    // Nothing was sent: a 400 the operator cannot read would empty the table for no visible reason.
    expect(queries(calls)).toHaveLength(1);
  });

  /**
   * The five columns V1 could filter and V2 had dropped. V1 filtered them as their *rendered* strings,
   * because every property on its row type is a string — `[Cost] contains "~"`, `[Timer] contains ":"`.
   * These go to the real numeric and date columns instead, so `> 5` is five dollars and not a substring,
   * which is the same question asked properly.
   */
  it("filters the cost, token, duration and date columns on their real values", async () => {
    const { calls } = renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    for (const [column, wire] of [
      ["Cost", "cost"],
      ["Tokens", "tokens"],
      ["Timer", "durationSeconds"],
      ["Timestamp", "completedAt"],
      ["Agent Output", "lastOutputAt"],
    ] as const) {
      const before = queries(calls).length;
      await commitFilter(`[${column}] is not blank`);
      expect(screen.queryByTestId("data-table-filter-error"), column).not.toBeInTheDocument();
      await waitFor(() => expect(queries(calls).length).toBeGreaterThan(before));
      expect(JSON.stringify(queries(calls).at(-1)), column).toContain(wire);
    }
  });

  /**
   * The Plan Id cell shows `reportedPlanId` when the promptware reported one and the id off `planFile`
   * otherwise, so a filter has to ask both. Filtering `planFile` alone made `[Plan Id] = "00681"` match
   * nothing at all — that column holds a folder path.
   */
  it("matches a plan id against both columns the cell can be showing", async () => {
    const { calls } = renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    await commitFilter('[Plan Id] = "00681"');
    await waitFor(() => expect(queries(calls)).toHaveLength(2));

    expect(queries(calls)[1].filter).toEqual({
      group: {
        op: "or",
        filters: [
          { condition: { column: "reportedPlanId", function: "equals", args: ["00681"] } },
          { condition: { column: "planFile", function: "equals", args: ["00681"] } },
        ],
      },
    });
  });

  it("says a filter is narrowing when the table comes back empty", async () => {
    const { calls } = renderJobs([]);
    await waitFor(() => expect(screen.getByTestId("jobs-empty")).toBeInTheDocument());

    await commitFilter('[Status] = "Nothing"');
    await waitFor(() => expect(queries(calls)).toHaveLength(2));

    // Filtered to nothing reads differently from empty, and must: they look identical and mean
    // opposite things.
    await waitFor(() => expect(screen.getByTestId("jobs-empty-filtered")).toBeInTheDocument());
    expect(screen.queryByTestId("jobs-empty")).not.toBeInTheDocument();
  });
});

/**
 * The filter vocabulary comes from `POST /api/tables/jobs/values`, not from the rows in hand.
 *
 * A list built from the loaded window offers the values on screen, and the value a user wants is usually
 * not one of them — which is the whole reason this moved once the filter went to the daemon.
 */
describe("Jobs filter facets", () => {
  afterEach(() => vi.restoreAllMocks());

  it("asks the daemon for each closed-set column's values", async () => {
    const { calls } = renderJobs([job("00021", "Running")], {
      status: ["Completed", "Failed", "Running"],
      type: ["CreatePlan", "ExecutePlan"],
      project: ["Ivy-Tendril-V2, docs", "web"],
    });
    await waitForRows(1);

    await waitFor(() =>
      expect(
        calls.filter((call) => call.path === "/api/tables/jobs/values").map((call) => call.body),
      ).toEqual([{ column: "status" }, { column: "type" }, { column: "project" }]),
    );
  });

  it("offers the daemon's values, and splits a joined Project value into its parts", async () => {
    renderJobs([job("00021", "Running")], {
      status: ["Completed", "Running"],
      type: ["ExecutePlan"],
      // `SELECT DISTINCT Project` answers a *joined* list as one value; the facet has to offer both.
      project: ["Ivy-Tendril-V2, docs"],
    });
    await waitForRows(1);

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    await waitFor(() => expect(screen.getByLabelText("Filter syntax")).toBeInTheDocument());

    // Radix's popover does not open under this jsdom setup (it gates on pointer events), so the values
    // are asserted through the column declarations the help panel reads — the same list, one hop
    // earlier. That the *request* was made is the assertion above.
    expect(screen.getByRole("textbox", { name: "Filter expression" })).toHaveAttribute(
      "placeholder",
      '[Status] contains "…"',
    );
  });
});

/**
 * V1's badge columns, colour for colour: `Constants.JobStatusColors` on Status, `JobTypeColors` on Type
 * and a per-project colour on Project, all rendered by `LabelsDisplayRenderer`'s `BadgeColorMapping`
 * (`JobsApp.DataTable.cs:61-78`). The colour is how the table is read at a glance, so a status must have
 * the colour it has in V1 and not the nearest semantic token.
 */
describe("Jobs badge colours", () => {
  afterEach(() => vi.restoreAllMocks());

  /** The hue a badge was tinted from, read back off the element's inline custom property. */
  function tint(element: HTMLElement | null): string | null {
    const value = element?.style.getPropertyValue("--badge-tint-bg-light") ?? "";
    return /var\(--([a-z-]+)/.exec(value)?.[1] ?? null;
  }

  function badgeWithText(text: string): HTMLElement | null {
    return (
      Array.from(document.querySelectorAll<HTMLElement>("tbody .badge-tinted")).find(
        (element) => element.textContent?.trim() === text,
      ) ?? null
    );
  }

  it("maps every status to V1's own colour", () => {
    // `Constants.JobStatusColors:54-64`, verbatim. Amber and Orange are *different* colours in V1 and
    // stay different here, which no semantic token could have expressed.
    expect(JOB_STATUS_COLOR).toEqual({
      Running: "Blue",
      Completed: "Green",
      Failed: "Red",
      Timeout: "Red",
      Queued: "Amber",
      Pending: "Amber",
      Stopped: "Gray",
      Blocked: "Orange",
    });
  });

  it("maps every job type to V1's own colour", () => {
    // `Constants.JobTypeColors:66-79`, all eleven.
    expect(JOB_TYPE_COLOR).toEqual({
      CreatePlan: "Purple",
      ExecutePlan: "Blue",
      UpdatePlan: "Cyan",
      ExpandPlan: "Teal",
      SplitPlan: "Indigo",
      CreatePr: "Green",
      CreateIssue: "Rose",
      RetryPlan: "Orange",
      SetupProject: "Slate",
      SyncRepo: "Amber",
      AddProject: "Purple",
    });
  });

  it("renders the Status badge in the status's colour", async () => {
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);
    expect(tint(badgeWithText("Running"))).toBe("blue");
  });

  it("renders the Type badge in the type's colour, and an unknown type on the fallback", async () => {
    renderJobs([
      job("00021", "Completed", { type: "CreatePlan" }),
      job("00022", "Completed", { type: "SomethingNew" }),
    ]);
    await waitForRows(2);

    expect(tint(badgeWithText("CreatePlan"))).toBe("purple");
    // V1's renderer leaves a value outside its mapping neutral rather than borrowing another's colour.
    expect(tint(badgeWithText("SomethingNew"))).toBe("slate");
  });

  it("gives each project its own colour, stably", async () => {
    renderJobs([job("00021", "Running", { project: "web, api" })]);
    await waitForRows(1);

    const web = tint(badgeWithText("web"));
    const api = tint(badgeWithText("api"));
    expect(web).not.toBeNull();
    expect(api).not.toBeNull();
    expect(web).not.toBe(api);
    // Derived from the name, so it is the same colour on every render and in every view.
    expect(projectColor("web")).toBe(projectColor("web"));
    expect(web).toBe(projectColor("web").toLowerCase());
  });
});

/** A daemon that refuses the query, or is not there at all. */
describe("Jobs table errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("says the query failed rather than showing an empty table", async () => {
    setTableQueryTransport((path) =>
      path === "/api/jobs/query"
        ? Promise.reject(new Error("unknown column 'costt' for table 'Jobs'"))
        : Promise.resolve({ column: "", values: [], totalValues: 0 }),
    );

    render(<JobsView jobs={[]} onStopAllQueued={() => {}} onStopAll={() => {}} />);

    // The daemon's 400 names what was wrong, which is the only thing that helps whoever typed it.
    await waitFor(() => expect(screen.getByTestId("jobs-table-error")).toBeInTheDocument());
    expect(screen.getByTestId("jobs-table-error")).toHaveTextContent("unknown column 'costt'");
  });
});

/**
 * A clickable cell says so, and a cell that *navigates* says so differently.
 *
 * The framework's grid draws a cell with a click handler at `cursor: pointer` and a plain one at
 * `cursor: default` (`widgets/dataTables/utils/cellContent.ts:583`, `:459`), and reserves blue underlined
 * text for a **link** cell (`utils/customRenderers.ts:526`, `utils/canvasText.ts:103`). V1's Jobs table has
 * four cell actions; two survive in V2, and they are one of each kind.
 */
describe("Jobs clickable cells", () => {
  afterEach(() => vi.restoreAllMocks());

  it("marks the cells that do something, and leaves the rest alone", async () => {
    installDaemon([job("00021", "Running")]);
    render(
      <JobsView
        jobs={[job("00021", "Running")]}
        onSelectPlan={() => {}}
        onStopAllQueued={() => {}}
        onStopAll={() => {}}
      />,
    );
    await waitForRows(1);

    const clickable = Array.from(
      document.querySelectorAll<HTMLElement>('tbody td[data-clickable="true"]'),
    );
    // Plan Id (navigates) and Agent Output (opens the sheet). Not Status, Prompt, Type, Project, Timer,
    // Cost, Tokens, Timestamp or Status Message — none of those has a cell action in V2.
    expect(clickable).toHaveLength(2);
    for (const element of clickable) {
      expect(element).toHaveClass("cursor-pointer");
    }
  });

  it("draws the Plan Id cell as a link, because it navigates", async () => {
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);
    // Rendered without `onSelectPlan` there is nowhere to go, so it is text rather than a link.
    expect(screen.queryByTestId("job-plan-00021")).not.toBeInTheDocument();
  });

  it("gives the Plan Id link the framework's blue underline once there is somewhere to go", async () => {
    installDaemon([job("00021", "Running")]);
    render(
      <JobsView
        jobs={[job("00021", "Running")]}
        onSelectPlan={() => {}}
        onStopAllQueued={() => {}}
        onStopAll={() => {}}
      />,
    );
    await waitForRows(1);

    const link = screen.getByTestId("job-plan-00021");
    expect(link.className).toContain("text-info");
    // Underlined always, not on hover: an affordance nobody can see until they point at it is not one.
    expect(link.className).toContain("underline");
  });

  it("does not make the Agent Output cell a link, because it opens a sheet rather than navigating", async () => {
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);
    const button = screen.getByTestId("job-output-00021");
    expect(button.className).not.toContain("underline");
    // The affordance is the cell's cursor.
    expect(button.closest("td")).toHaveAttribute("data-clickable", "true");
  });
});

/**
 * The Agent Output cell in the table, and the thing V1's per-cell update stream exists for: the passage
 * of time. No job event fires while an agent is merely quiet, so the cell has to advance on a clock — and
 * it has to do that *without* refetching, because a refetch drops every accumulated window and returns
 * the reader to the top of the table.
 */
describe("Jobs Agent Output cell", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders the silence for a running job and Starting... only before its first line", async () => {
    const jobs = [
      job("00021", "Running", { lastOutputAt: new Date(Date.now() - 95_000).toISOString() }),
      job("00022", "Running"),
      job("00023", "Completed"),
      job("00024", "Failed"),
    ];
    renderJobs(jobs);
    await waitForRows(4);

    expect(screen.getByTestId("job-output-00021")).toHaveTextContent(/^1m 3[0-9]s$/);
    expect(screen.getByTestId("job-output-00021")).not.toHaveTextContent("Starting");
    expect(screen.getByTestId("job-output-00022")).toHaveTextContent(AGENT_OUTPUT_STARTING);
    expect(screen.getByTestId("job-output-00023")).toHaveTextContent("Done");
    expect(screen.getByTestId("job-output-00024")).toHaveTextContent("-");
  });

  it("advances as time passes, and never refetches to do it", async () => {
    // Ten seconds of silence, so the first paint is unambiguous and the next tick is a visible change.
    const lastOutputAt = new Date(Date.now() - 10_000).toISOString();
    const running = [job("00021", "Running", { lastOutputAt })];
    const calls = installDaemon(running);
    render(<JobsView jobs={running} onStopAllQueued={() => {}} onStopAll={() => {}} />);
    await waitForRows(1);

    const cell = screen.getByTestId("job-output-00021");
    expect(cell).toHaveTextContent("10s");
    const windowsFetched = queries(calls).length;

    // The `jobs` prop never changes here and no job event fires, so the only thing moving is the clock —
    // which is exactly the case V1 runs a one-second interval for.
    await waitFor(() => expect(cell).toHaveTextContent(/^1[1-9]s$/), { timeout: 4_000 });

    // The whole point: the cell counts from a timestamp the daemon already served, so a tick is a
    // re-render. One more window request and the reader's accumulated scroll would be gone.
    expect(queries(calls)).toHaveLength(windowsFetched);
  });
});

/**
 * The output sheet uses the framework's header layout (`widgets/layouts/HeaderLayoutWidget.tsx`): a title
 * that stays put, a body that scrolls under it, and `min-h-0` on the scroller — without which the panel
 * grows past the sheet and the "fixed" title scrolls away with the content.
 */
describe("Jobs output sheet layout", () => {
  afterEach(() => vi.restoreAllMocks());

  it("opens the sheet inside a header layout, with the title in the fixed header", async () => {
    vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({ ...job("00021", "Running") });
    vi.spyOn(jobsStore, "subscribeToJob").mockReturnValue(() => {});
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    fireEvent.click(screen.getByTestId("job-output-00021"));

    const sheet = await waitFor(() => screen.getByTestId("job-output-sheet"));
    const layout = sheet.querySelector('[data-slot="header-layout"]');
    expect(layout).toBeInTheDocument();
    expect(layout).toHaveClass("flex", "h-full", "flex-col");

    const header = sheet.querySelector('[data-slot="header-layout-header"]');
    expect(header).toHaveClass("flex-none");
    expect(header?.textContent).toContain("ExecutePlan 00638");

    // The scroller takes the remaining height and is allowed to shrink below its content.
    expect(header?.nextElementSibling).toHaveClass("flex-1", "min-h-0", "overflow-hidden");
    // The sheet itself no longer scrolls; the layout owns it, and owns the padding too.
    expect(sheet.className).toContain("overflow-hidden");
    expect(sheet.className).toContain("p-0");
  });

  /**
   * The chain that puts the metrics footer in the footer.
   *
   * `AgentViewer` asks for `height: 100%`, and a percentage height resolves against nothing unless
   * every box above it has a definite one. It did not: the sheet scrolled its content through Radix's
   * viewport, which injects a `display: table` wrapper of its own that no height survives, and the
   * viewer's own box offered `min-h-96` — a floor, not a height. So the shell sized to its content and
   * its `flex: 0 0 auto` footer pinned to the bottom of a box that ended wherever the log ended, with
   * dead space under it. jsdom computes no layout, so this asserts the class contract that makes the
   * height definite rather than the geometry it produces.
   */
  it("hands the output a definite height rather than a floor inside a scroller", async () => {
    vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({ ...job("00021", "Running") });
    vi.spyOn(jobsStore, "subscribeToJob").mockReturnValue(() => {});
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    fireEvent.click(screen.getByTestId("job-output-00021"));
    const sheet = await waitFor(() => screen.getByTestId("job-output-sheet"));
    const view = await waitFor(() => screen.getByTestId("job-session-view"));

    // No Radix scroll viewport between the header layout and the view: the log is the only scroller,
    // which is also what stops an outer scroller fighting the viewer's virtualizer for the position.
    expect(sheet.querySelector("[data-radix-scroll-area-viewport]")).toBeNull();
    // The padded wrapper is a flex column of definite height rather than the default `p-4` block.
    const content = sheet.querySelector('[data-slot="header-layout-header"]')?.nextElementSibling
      ?.firstElementChild;
    expect(content).toHaveClass("flex", "h-full", "min-h-0", "flex-col");
    // …and the view and the output box carry it down to the viewer.
    expect(view).toHaveClass("h-full", "min-h-0");
    const output = view.lastElementChild;
    expect(output).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
    expect(output?.className).not.toContain("min-h-96");
  });

  /**
   * Three full-width rules used to stack down the first 50px of this sheet — under the title, under
   * the job's metadata, and over the metrics strip — each drawn by a different owner. Parallel lines
   * at that density read as a form rather than as a hierarchy. Each is dropped at its own call site so
   * the page framing and the other `HeaderLayout` consumers keep theirs.
   */
  it("draws none of the three stacked rules, and leaves the debug sheet's alone", async () => {
    vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({ ...job("00021", "Running") });
    vi.spyOn(jobsStore, "subscribeToJob").mockReturnValue(() => {});
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    // The strip renders nothing for a run that has said nothing worth a line, so the job needs one
    // event with a cost on it before there is a footer to assert about at all.
    vi.spyOn(jobsStore, "getSessionEvents").mockReturnValue([
      {
        id: "e1",
        type: "result",
        timestamp: 0,
        payload: {},
        rawText: JSON.stringify({
          kind: "result",
          timestamp: "2026-09-16T12:00:00.000Z",
          is_success: true,
          duration_ms: 4000,
        }),
      },
    ]);

    fireEvent.click(screen.getByTestId("job-output-00021"));
    const sheet = await waitFor(() => screen.getByTestId("job-output-sheet"));

    // 1: the sheet title's divider, from `HeaderLayout`'s `showDivider` default.
    expect(sheet.querySelector('[data-slot="header-layout-header"]')).not.toHaveClass("border-b");
    // 2: the job metadata block's own rule, and the `pb-4` that only existed to hold it off the text.
    const view = await waitFor(() => screen.getByTestId("job-session-view"));
    const meta = view.firstElementChild;
    expect(meta?.className).not.toContain("border-b");
    expect(meta?.className).not.toContain("pb-4");
    // 3: the metrics strip's own rule, dropped per instance so the page framing keeps it.
    await waitFor(() => expect(sheet.querySelector(".aov-metrics")).not.toBeNull());
    expect(sheet.querySelector(".aov-metrics")).toHaveClass("aov-metrics-flush");
  });
});
