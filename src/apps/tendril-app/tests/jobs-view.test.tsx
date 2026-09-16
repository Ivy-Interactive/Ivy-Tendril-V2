import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  JobsView,
  buildJobRowActions,
  buildJobRows,
  buildStatusSegments,
  extractJobNumber,
  formatJobCost,
  formatTokens,
  truncatePrompt,
  jobStatusMessage,
  RERUN_UNAVAILABLE_REASON,
  type JobRowActionCapabilities,
} from "../src/views/JobsView";
import { bridge } from "../src/api/bridge";
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

/**
 * The table now reads its rows through the daemon's jobs listing rather than off the `jobs` prop,
 * because that is what infinite scroll needs: `jobsStore` holds only the newest fifty and replaces
 * them on every poll, so a scrolled-open window could not survive one. The prop stays as the *live*
 * overlay (V1's per-cell update stream) and as the source of the header's counts and progress bar, so
 * every test below hands the same jobs to both.
 */
function renderJobs(jobs: Job[]) {
  vi.spyOn(bridge, "listJobs").mockImplementation((_status?: string, limit?: number) =>
    Promise.resolve(jobs.slice(0, limit ?? jobs.length)),
  );
  return render(<JobsView jobs={jobs} onStopAllQueued={() => {}} onStopAll={() => {}} />);
}

/** Resolves once the table has painted a row for every job served. */
async function waitForRows(count: number) {
  await waitFor(() => expect(document.querySelectorAll("tbody [data-row-id]")).toHaveLength(count));
}

describe("extractJobNumber", () => {
  // `JobsApp.Helpers.cs` `ExtractJobNumber`, which mirrors `int.TryParse` then a dash split.
  it("reads a padded id, a bare number and a suffixed one", () => {
    expect(extractJobNumber("00458")).toBe(458);
    expect(extractJobNumber("458")).toBe(458);
    expect(extractJobNumber(" 7 ")).toBe(7);
    expect(extractJobNumber("00458-ExecutePlan")).toBe(458);
    expect(extractJobNumber("ExecutePlan-00458")).toBe(458);
  });

  it("reports 0 for an id carrying no number at all", () => {
    expect(extractJobNumber("")).toBe(0);
    expect(extractJobNumber("legacy")).toBe(0);
    // Not `12`: `int.TryParse("12abc")` fails and there is no dash to split on.
    expect(extractJobNumber("12abc")).toBe(0);
  });
});

describe("job row ordering", () => {
  /**
   * `JobsApp.Data.cs:40`: `.OrderByDescending(r => ExtractJobNumber(r.Id))`. Numeric, which is the
   * whole point of the helper - a lexicographic sort puts `999` above `1000`, so an unpadded id (or
   * one that outgrew five digits) would file the newest job in the middle of the list.
   */
  it("orders by job number descending, not lexicographically", () => {
    const rows = buildJobRows([
      job("999", "Completed"),
      job("00021", "Completed"),
      job("1000", "Running"),
      job("100000", "Queued"),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["100000", "1000", "999", "00021"]);
  });

  it("keeps a suffixed or unnumbered id in its numeric place", () => {
    const rows = buildJobRows([
      job("legacy", "Completed"),
      job("00007", "Completed"),
      job("00458-ExecutePlan", "Failed"),
    ]);

    // `legacy` extracts 0, so it sorts last rather than being dropped or floated to the top.
    expect(rows.map((row) => row.id)).toEqual(["00458-ExecutePlan", "00007", "legacy"]);
  });

  it("renders the rows in that order", async () => {
    renderJobs([job("999", "Completed"), job("1000", "Running"), job("00021", "Queued")]);

    await waitForRows(3);
    const ids = Array.from(document.querySelectorAll("tbody [data-row-id]")).map((row) =>
      row.getAttribute("data-row-id"),
    );
    expect(ids).toEqual(["1000", "999", "00021"]);
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
    expect(menuTags("Blocked")).toEqual(["stop-job", "force-start-job", "delete-job"]);
    expect(menuTags("Queued")).not.toContain("force-start-job");
    expect(menuTags("Blocked", { canDelete: true, canForceStart: false })).toEqual([
      "stop-job",
      "delete-job",
    ]);
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
    expect(menuTags("Completed")).toEqual(["delete-job"]);
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

    const withoutDelete = { canDelete: false, canForceStart: false };
    expect(menuTags("Completed", withoutDelete)).toEqual([]);
    // A Running job still has Stop, so the menu is not empty.
    expect(menuTags("Running", withoutDelete)).toEqual(["stop-job"]);
  });

  // V1's order: Stop, Rerun, Force Start, (Debug), Delete.
  it("keeps V1's order", () => {
    expect(menuTags("Stopped")).toEqual(["rerun-job", "delete-job"]);
    expect(menuTags("Blocked")).toEqual(["stop-job", "force-start-job", "delete-job"]);
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
   * That the menu is *reachable*, which the parity contract calls out specifically: a row menu
   * nobody can open is the same as no row menu.
   *
   * Only its presence is asserted here. Radix's `DropdownMenu` does not open under this jsdom setup
   * at all - it gates its trigger on a `PointerEvent` jsdom does not implement - so the items
   * themselves are covered by `buildJobRowActions` above and the action each one performs by
   * `jobsStore`'s guarded-path tests in `job-actions.test.tsx`.
   */
  it("gives every row a reachable actions menu, and none to a row with no actions", async () => {
    const noCaps = renderJobs([job("00021", "Completed")]);
    await waitForRows(1);
    // The bridge can delete, so even a terminal row has a menu.
    expect(jobsStore.canDeleteJob()).toBe(true);
    expect(screen.getByRole("button", { name: "Job actions" })).toBeInTheDocument();
    noCaps.unmount();

    // With neither capability a Completed row has nothing to offer, and the cell renders nothing
    // rather than an empty menu.
    vi.spyOn(jobsStore, "canDeleteJob").mockReturnValue(false);
    vi.spyOn(jobsStore, "canForceStartJob").mockReturnValue(false);
    renderJobs([job("00022", "Completed")]);
    await waitForRows(1);
    expect(screen.queryByRole("button", { name: "Job actions" })).not.toBeInTheDocument();
  });
});

describe("jobsStore.clearJobs", () => {
  type OptionalBridge = { clearJobs?: unknown };

  beforeEach(() => {
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
  });

  afterEach(() => {
    delete (bridge as OptionalBridge).clearJobs;
    vi.restoreAllMocks();
  });

  // `JobsApp.DataTable.cs:279-289` (`Clear Completed` / `Clear Failed`) over the daemon's one route,
  // `POST /api/jobs/clear` with a scope.
  it("is not offered until the bridge can perform it", async () => {
    expect(jobsStore.canClearJobs()).toBe(false);
    await expect(jobsStore.clearJobs("completed")).rejects.toThrow(/bridge.clearJobs/);
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

  it("asks the daemon for a wider window until the table is fully loaded", async () => {
    const all = history(120);
    const listJobs = vi
      .spyOn(bridge, "listJobs")
      .mockImplementation((_status?: string, limit?: number) =>
        Promise.resolve(all.slice(0, limit ?? all.length)),
      );

    render(<JobsView jobs={[]} onStopAllQueued={() => {}} onStopAll={() => {}} />);

    // 50, then 100, then 150 - which comes back short at 120, and a short window is the end of the
    // table. `cmd_list_jobs` takes a limit and no offset, so each window is read from the top; the
    // limits are what say how far the scroll has reached.
    await waitFor(() => expect(listJobs.mock.calls.map((call) => call[1])).toEqual([50, 100, 150]));
    await waitForRows(120);

    // Accumulated, not replaced: the first window's rows are still there under the last window's.
    expect(document.querySelector('tbody [data-row-id="20000"]')).toBeInTheDocument();
    expect(document.querySelector('tbody [data-row-id="19881"]')).toBeInTheDocument();
    // And it stops rather than asking for a window past the end.
    expect(listJobs).toHaveBeenCalledTimes(3);
  });

  it("stops after one window when that window is the whole table", async () => {
    const all = history(12);
    const listJobs = vi
      .spyOn(bridge, "listJobs")
      .mockImplementation((_status?: string, limit?: number) =>
        Promise.resolve(all.slice(0, limit ?? all.length)),
      );

    render(<JobsView jobs={[]} onStopAllQueued={() => {}} onStopAll={() => {}} />);
    await waitForRows(12);
    expect(listJobs).toHaveBeenCalledTimes(1);
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
 * `c.AllowFiltering = true` with `c.ShowSearch = false` (`JobsApp.DataTable.cs:88-90`), reached through
 * a control per column in the sticky header rather than the framework's CodeMirror expression editor.
 * See `column-filters.ts` for why the payload is the same one either way.
 */
describe("Jobs header filters", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts a filter row in the header, with a control only on the columns V1 can filter", async () => {
    renderJobs([job("00021", "Running")]);
    await waitForRows(1);

    const headerRows = document.querySelectorAll("thead tr");
    expect(headerRows).toHaveLength(2);
    expect(headerRows[1]).toHaveAttribute("data-slot", "data-table-filter-row");

    expect(screen.getByRole("button", { name: "Filter by Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by Type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by Project" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter by Prompt" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter by Plan Id" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter by Status Message" })).toBeInTheDocument();

    // `.Filterable(t => t.Id, false)`, and `ShowSearch = false` - no free-text box over the table.
    expect(screen.queryByRole("textbox", { name: "Filter by Id" })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("filters free text on Enter, and says so when nothing matches", async () => {
    renderJobs([
      job("00021", "Failed", { statusMessage: "npm install failed" }),
      job("00022", "Failed", { statusMessage: "timed out waiting for review" }),
    ]);
    await waitForRows(2);

    const box = screen.getByRole("textbox", { name: "Filter by Status Message" });
    fireEvent.change(box, { target: { value: "npm" } });
    // Typing is not filtering: the framework's editor commits on Enter and so does this.
    expect(document.querySelectorAll("tbody [data-row-id]")).toHaveLength(2);

    fireEvent.keyDown(box, { key: "Enter" });
    await waitForRows(1);
    expect(document.querySelector('tbody [data-row-id="00021"]')).toBeInTheDocument();

    // Case-insensitive, because the daemon's `contains` compiles to SQLite `LIKE`.
    fireEvent.change(box, { target: { value: "NPM" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitForRows(1);

    fireEvent.change(box, { target: { value: "no such thing" } });
    fireEvent.keyDown(box, { key: "Enter" });
    // Filtered to nothing reads differently from empty, and must: they look identical and mean
    // opposite things.
    await waitFor(() => expect(screen.getByTestId("jobs-empty-filtered")).toBeInTheDocument());
    expect(screen.queryByTestId("jobs-empty")).not.toBeInTheDocument();
  });

  it("filters Plan Id by what it contains, not by equality", async () => {
    renderJobs([
      job("00021", "Running", { planId: "00638" }),
      job("00022", "Running", { planId: "00712" }),
    ]);
    await waitForRows(2);

    const box = screen.getByRole("textbox", { name: "Filter by Plan Id" });
    // A plan id is typed a digit at a time, and the daemon's column is `PlanFile`, whose value only
    // *starts* with the id - so `contains` is the only condition that can work here.
    fireEvent.change(box, { target: { value: "007" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitForRows(1);
    expect(document.querySelector('tbody [data-row-id="00022"]')).toBeInTheDocument();
  });

  /**
   * The three facet columns' *narrowing* is asserted where the popover can actually be opened, in
   * `packages/components`' `data-table.infinite-scroll.test.tsx` — Radix's popover and dropdown both
   * gate on pointer events this jsdom setup does not implement, which is the same reason the row menu
   * above is only asserted to be reachable. What is checked here is that the controls exist and carry
   * the conditions V1's columns imply; `matchesColumnFilters` and `columnFiltersToRemoteFilter` are
   * unit-tested against the daemon's semantics in the components package.
   */
  it("offers a facet only for the columns whose values are a closed set", async () => {
    renderJobs([
      job("00021", "Running", { project: "web, api" }),
      job("00022", "Completed", { type: "CreatePlan", project: "docs" }),
    ]);
    await waitForRows(2);

    for (const column of ["Status", "Type", "Project"]) {
      expect(screen.getByRole("button", { name: `Filter by ${column}` })).toBeEnabled();
    }
    // Timer, Agent Output, Cost, Tokens and Timestamp are filterable in V1 because every `JobItemRow`
    // property is a string there. Two of them are derived rather than stored and the other three are
    // numeric, so none gets a text box: a `contains` over a formatted number would filter the
    // rendering rather than the value.
    for (const column of ["Timer", "Agent Output", "Cost", "Tokens", "Timestamp"]) {
      expect(screen.queryByRole("button", { name: `Filter by ${column}` })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("textbox", { name: `Filter by ${column}` }),
      ).not.toBeInTheDocument();
    }
  });
});
