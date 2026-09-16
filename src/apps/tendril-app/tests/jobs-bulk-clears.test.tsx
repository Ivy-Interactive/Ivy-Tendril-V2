import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  JobsView,
  countJobsByStatus,
  describeClearPrompt,
  JOB_CLEAR_SCOPES,
} from "../src/views/JobsView";
import { bridge } from "../src/api/bridge";
import {
  resetTableQueryTransport,
  setTableQueryTransport,
  type TableQueryTransport,
} from "../src/api/tableQuery";
import type { Job, JobStatus } from "../src/types/api";

/**
 * The Jobs table header's bulk clears, in a file of their own.
 *
 * Separate from `jobs-view.test.tsx` for a mechanical reason worth recording: opening a Radix dropdown
 * and dialog over a rendered `DataTable` costs several seconds of jsdom each, and sharing a file with
 * the infinite-scroll tests made *those* flaky — their virtualizer waits on a one-second `waitFor` that
 * a process still unwinding a menu does not always answer in time. A separate file is a separate
 * environment, so the cost stays here.
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

/** One request the table made, so a test can assert on what reached the daemon. */
interface Recorded {
  path: string;
  body: Record<string, unknown>;
}

/** A daemon serving `POST /api/jobs/query` and `POST /api/tables/jobs/values`. */
function installDaemon(jobs: Job[]): Recorded[] {
  const calls: Recorded[] = [];
  const transport: TableQueryTransport = (path, body) => {
    calls.push({ path, body });
    if (path === "/api/tables/jobs/values") {
      return Promise.resolve({ column: "", values: [], totalValues: 0 });
    }
    const offset = Number(body.offset ?? 0);
    const limit = Number(body.limit ?? 50);
    const rows = jobs.slice(offset, offset + limit);
    return Promise.resolve({
      encoding: "application/json",
      rows,
      offset,
      rowCount: rows.length,
      // The *filtered* total, over the whole table, which is what a clear has to be counted against.
      totalRows: jobs.length,
      limit,
    });
  };
  setTableQueryTransport(transport);
  return calls;
}

function renderJobs(jobs: Job[]) {
  const calls = installDaemon(jobs);
  render(<JobsView jobs={jobs} onStopAllQueued={() => {}} onStopAll={() => {}} />);
  return calls;
}

/** The bodies of the window requests, in order. Facet lookups are not window requests. */
function queries(calls: Recorded[]): Record<string, unknown>[] {
  return calls.filter((call) => call.path === "/api/jobs/query").map((call) => call.body);
}

afterEach(() => {
  resetTableQueryTransport();
});

/** Resolves once the table has painted a row for every job served. */
async function waitForRows(count: number) {
  await waitFor(() => expect(document.querySelectorAll("tbody [data-row-id]")).toHaveLength(count));
}

/**
 * Flushes the pending promises and the renders they cause.
 *
 * Used instead of `waitFor` for everything downstream of an open dialog: `waitFor` polls the whole
 * document on an interval, and over this table's DOM with Radix holding the rest of it `aria-hidden`
 * that costs seconds per call. Everything awaited here is one already-resolved promise deep, so a
 * microtask flush inside `act` is both faster and stricter — it asserts the state that exists rather
 * than the state that eventually arrives.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

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
 * Opens the toolbar's overflow menu, by keyboard.
 *
 * Not `click`: the trigger is Radix's, which toggles on `onPointerDown` with a primary button — and
 * jsdom implements no `PointerEvent`, so a synthesised `pointerDown` arrives without a `button` and the
 * trigger ignores it. `Enter` on the focused trigger is the other path Radix opens on, it is a path a
 * real keyboard user takes, and it is the one jsdom can express faithfully.
 */
function openHeaderMenu() {
  fireEvent.keyDown(screen.getByTestId("jobs-header-menu"), { key: "Enter" });
}

/** Opens the header menu and picks one item. Synchronous: Radix opens on the keystroke. */
function pickHeaderMenuItem(testId: string) {
  openHeaderMenu();
  fireEvent.click(screen.getByTestId(testId));
}

/**
 * The header menu's bulk clears.
 *
 * V1's menu holds two of them (`JobsApp.DataTable.cs:279-289`) over a service that was always a generic
 * predicate clear (`JobService.ClearJobsByStatus`), so the per-status list here is the rest of V1's own
 * primitive. Two properties are load-bearing: **no non-terminal status is offered** (that guarantee is
 * the daemon's, and this is the UI half of it), and **nothing is destroyed on a click** — every entry
 * opens a confirm that names the number of rows going.
 */
describe("Jobs bulk clears", () => {
  beforeEach(() => {
    vi.spyOn(bridge, "listJobs").mockResolvedValue([]);
  });

  // `vi.spyOn` throughout rather than assigning onto `bridge`: `clearJobs` is a real method now, and an
  // assignment (or a `delete` to undo one) mutates the bridge singleton for every test after it — which
  // is how the capability gate below came to be asserted against a method a previous test had removed.
  afterEach(() => vi.restoreAllMocks());

  /** The scopes the menu declares, so the daemon contract and the UI can be asserted against one list. */
  it("offers one clear per terminal status, plus the sweep, and no non-terminal status at all", () => {
    expect(JOB_CLEAR_SCOPES.map((entry) => entry.scope)).toEqual([
      "Completed",
      "Failed",
      "Timeout",
      "Stopped",
      "all",
    ]);
    // The user's wording mapped onto V2's names: "successful" is Completed, "cancelled" is Stopped.
    expect(JOB_CLEAR_SCOPES.map((entry) => entry.label)).toEqual([
      "Clear Completed",
      "Clear Failed",
      "Clear Timeout",
      "Clear Stopped",
      "Clear All Finished",
    ]);
    // `all` is exactly the union of the four, so the menu cannot drift from `clear_all_jobs`.
    const sweep = JOB_CLEAR_SCOPES[JOB_CLEAR_SCOPES.length - 1];
    expect(sweep.statuses).toEqual(["Completed", "Failed", "Timeout", "Stopped"]);
    // Nothing in flight is reachable from here. The daemon refuses these too — see
    // `CLEARABLE_STATUSES` in `jobs/manager.rs`.
    const offered = new Set(JOB_CLEAR_SCOPES.flatMap((entry) => entry.statuses));
    for (const forbidden of ["Running", "Queued", "Pending", "Blocked"] as const) {
      expect(offered.has(forbidden)).toBe(false);
    }
  });

  it("counts over the whole table, not the loaded window", async () => {
    // Twelve rows in the table, one window loaded. Anything derived from the rows in hand would say 1.
    const calls: Recorded[] = [];
    setTableQueryTransport((path, body) => {
      calls.push({ path, body });
      return Promise.resolve({ rows: [], totalRows: 12, rowCount: 0, offset: 0, limit: 1 });
    });

    expect(await countJobsByStatus(["Failed"])).toBe(12);
    expect(calls[0].path).toBe("/api/jobs/query");
    expect(calls[0].body).toMatchObject({
      filter: { condition: { column: "status", function: "inSet", args: ["Failed"] } },
      limit: 1,
    });
  });

  /**
   * The confirm's copy, which is the safety mechanism: V1 fires its clears straight off the menu item,
   * so the *sentence* is the whole of what V2 adds. Tested as a function rather than through the DOM —
   * a Radix menu and dialog opened over this table cost several seconds each in jsdom, and the flow
   * below already proves the wiring.
   */
  it("names the count and the noun, and arms nothing until there is something to remove", () => {
    const failed = JOB_CLEAR_SCOPES.find((entry) => entry.scope === "Failed")!;

    // Not counted yet: says so, and offers nothing to press.
    expect(describeClearPrompt(failed, null)).toEqual({
      body: "Counting failed jobs…",
      confirmLabel: "Clear",
      confirmDisabled: true,
    });

    // Nothing to remove: states that instead of asking a question with no answer.
    expect(describeClearPrompt(failed, 0)).toEqual({
      body: "There are no failed jobs to clear.",
      confirmLabel: "Clear",
      confirmDisabled: true,
    });

    // The decision: the number, the noun, and what goes with the rows.
    const many = describeClearPrompt(failed, 412);
    expect(many.body).toBe(
      "Delete 412 failed jobs? Their logs and output are removed with them, and this cannot be undone.",
    );
    expect(many).toMatchObject({ confirmLabel: "Clear 412", confirmDisabled: false });
    // Singular, because "Delete 1 failed jobs" reads as a bug.
    expect(describeClearPrompt(failed, 1).body).toContain("Delete 1 failed job?");

    // Every scope has copy that reads, including the sweep.
    for (const scope of JOB_CLEAR_SCOPES) {
      expect(describeClearPrompt(scope, 3).body).toContain(`3 ${scope.noun} jobs`);
    }
  });

  /**
   * One end-to-end pass over the menu: the items exist, a click destroys nothing, the confirm carries
   * the count, and confirming sends the scope and refetches. Slow by nature — Radix's menu and dialog
   * over a rendered table are seconds of jsdom each — so it is the only DOM test of the flow.
   */
  it(
    "opens a confirm rather than clearing, then clears the scope and refetches",
    async () => {
      const clear = vi.spyOn(bridge, "clearJobs").mockResolvedValue(7);
      const jobs = [job("00021", "Failed")];
      const calls = renderJobs(jobs);
      await waitForRows(1);

      // All five, in the declared order.
      openHeaderMenu();
      for (const scope of JOB_CLEAR_SCOPES) {
        expect(screen.getByTestId(`jobs-clear-${scope.scope.toLowerCase()}`)).toHaveTextContent(
          scope.label,
        );
      }

      fireEvent.click(screen.getByTestId("jobs-clear-failed"));

      // A confirm, and nothing deleted by the click that opened it.
      expect(screen.getByTestId("jobs-clear-dialog")).toHaveTextContent("Clear Failed");
      expect(clear).not.toHaveBeenCalled();

      // The count is the fake daemon's *filtered total*, i.e. the whole table rather than the window.
      await settle();
      expect(screen.getByTestId("jobs-clear-body")).toHaveTextContent("Delete 1 failed job?");
      // Framework's contract: Cancel first and focused, the destructive verb last, nothing to type.
      expect(screen.getByTestId("dialog-cancel")).toHaveTextContent("Cancel");
      expect(screen.getByTestId("dialog-confirm")).toHaveTextContent("Clear 1");
      expect(screen.getByTestId("dialog-cancel")).toHaveFocus();

      const windowsBefore = queries(calls).length;
      fireEvent.click(screen.getByTestId("dialog-confirm"));
      await settle();

      // The wire value is the scope, not the label.
      expect(clear).toHaveBeenCalledWith("Failed");
      // A clear changes *which rows exist*, which is the one case that must refetch — the opposite of a
      // cost or status-message change, which the live overlay absorbs without one.
      expect(queries(calls).length).toBeGreaterThan(windowsBefore);
      expect(screen.queryByTestId("jobs-clear-dialog")).not.toBeInTheDocument();
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  it(
    "keeps the confirm open and says so when the daemon refuses",
    async () => {
      vi.spyOn(bridge, "clearJobs").mockRejectedValue(new Error("daemon is gone"));
      const jobs = [job("00021", "Completed")];
      renderJobs(jobs);
      await waitForRows(1);

      pickHeaderMenuItem("jobs-clear-completed");
      await settle();
      fireEvent.click(screen.getByTestId("dialog-confirm"));
      await settle();

      expect(screen.getByRole("alert")).toHaveTextContent(/Clear failed:.*daemon is gone/);
      expect(screen.getByTestId("jobs-clear-dialog")).toBeInTheDocument();
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  /**
   * The menu itself, in V1's order: the two sweeps above the clears, all in one kebab beside the
   * progress bar (`JobsApp.DataTable.cs:263-293`). The sweeps carry their counts in their labels and are
   * present only when those counts are non-zero, exactly as V1's `if (queuedCount > 0)` /
   * `if (activeJobCount > 0)` have it; the clears are unconditional.
   */
  it(
    "puts both sweeps above the clears, with their counts, and calls through",
    async () => {
      vi.spyOn(bridge, "clearJobs").mockResolvedValue(0);
      const onStopAllQueued = vi.fn();
      const onStopAll = vi.fn();
      // Two Queued and one Running: `queuedCount` is 2 and `activeJobCount` counts all three.
      const jobs = [job("00021", "Queued"), job("00022", "Queued"), job("00023", "Running")];
      installDaemon(jobs);
      render(<JobsView jobs={jobs} onStopAllQueued={onStopAllQueued} onStopAll={onStopAll} />);
      await waitForRows(3);

      openHeaderMenu();
      const items = Array.from(
        screen.getByRole("menu").querySelectorAll("[data-testid^='jobs-']"),
      ).map((item) => [item.getAttribute("data-testid"), item.textContent]);

      expect(items).toEqual([
        ["jobs-stop-all-queued", "Stop All Queued (2)"],
        ["jobs-stop-all", "Stop All (3)"],
        ["jobs-clear-completed", "Clear Completed"],
        ["jobs-clear-failed", "Clear Failed"],
        ["jobs-clear-timeout", "Clear Timeout"],
        ["jobs-clear-stopped", "Clear Stopped"],
        ["jobs-clear-all", "Clear All Finished"],
      ]);

      // The sweeps' confirms live in `App.tsx` because they are shell-level dialogs the shell already
      // owns; the table surfaces the entries where V1 puts them and calls through.
      fireEvent.click(screen.getByTestId("jobs-stop-all-queued"));
      expect(onStopAllQueued).toHaveBeenCalledTimes(1);
      openHeaderMenu();
      fireEvent.click(screen.getByTestId("jobs-stop-all"));
      expect(onStopAll).toHaveBeenCalledTimes(1);
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  it(
    "drops a sweep whose count is zero rather than offering it as (0)",
    async () => {
      vi.spyOn(bridge, "clearJobs").mockResolvedValue(0);
      // Nothing queued and nothing active: V1 renders neither sweep, and the clears carry the menu.
      renderJobs([job("00021", "Completed")]);
      await waitForRows(1);

      openHeaderMenu();
      expect(screen.queryByTestId("jobs-stop-all-queued")).not.toBeInTheDocument();
      expect(screen.queryByTestId("jobs-stop-all")).not.toBeInTheDocument();
      expect(screen.getByTestId("jobs-clear-completed")).toBeInTheDocument();
    },
    RADIX_LAYER_TIMEOUT_MS,
  );
});
