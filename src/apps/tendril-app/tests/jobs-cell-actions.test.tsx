import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { JobsView } from "../src/views/JobsView";
import { jobsStore } from "../src/state/jobsStore";
import { resetTableQueryTransport, setTableQueryTransport } from "../src/api/tableQuery";
import type { Job, JobDetail } from "../src/types/api";

/**
 * V1's per-cell dispatch on the Jobs table (`JobsApp.DataTable.cs:95-175`), which hangs *five*
 * `.OnCellAction(t => t.Column, …)` handlers off five columns and sets `SelectionMode = None`.
 *
 * The property under test is that a click goes to the cell's *own* destination and to nothing else.
 * V2 had one catch-all `onRowClick` opening the output sheet, so every cell in the row opened the
 * agent output — the Cost, Tokens, Prompt and Plan Id cells all led to the same place. Each test here
 * clicks one cell and asserts both halves: the right sheet opened, and the output sheet did not.
 */

const listRow: Job = {
  id: "00158",
  type: "ExecutePlan",
  project: "Ivy-Tendril-V2",
  status: "Completed",
  planId: "00638",
  planTitle: "Rebuild the Jobs page",
  prompt: "Rebuild the Jobs page so every cell opens what it names",
  cost: 1.23456,
  costSource: "agent",
  tokens: 1_450_000,
  inputTokens: 1_000_000,
  outputTokens: 400_000,
  cacheReadTokens: 50_000,
  model: "claude-opus-5",
};

const fetched: JobDetail = {
  ...listRow,
  provider: "claude",
  executionProfile: "deep",
};

/** Clicks the cell under `columnName` in the table's single row. */
async function clickCell(columnName: string) {
  const row = await waitFor(() => {
    const found = document.querySelector("tbody [data-row-id]");
    if (!found) throw new Error("no row yet");
    return found as HTMLElement;
  });
  const cell = row.querySelector(`[data-column="${columnName}"]`);
  if (!cell) {
    throw new Error(
      `no ${columnName} cell; row has ${[...row.querySelectorAll("[data-column]")]
        .map((c) => c.getAttribute("data-column"))
        .join(", ")}`,
    );
  }
  fireEvent.click(cell);
}

function renderJobs(overrides: Partial<Job> = {}) {
  const row = { ...listRow, ...overrides };
  setTableQueryTransport(() =>
    Promise.resolve({ rows: [row], totalRows: 1, rowCount: 1, offset: 0, limit: 50 }),
  );
  return render(
    <JobsView
      jobs={[row]}
      jobDetails={{ "00158": { ...fetched, ...overrides } }}
      onStopAllQueued={() => {}}
      onStopAll={() => {}}
    />,
  );
}

/**
 * Timeout for a test that opens a Radix layer over a rendered `DataTable` — the same budget
 * `job-debug-sheet.test.tsx` documents, and for the same reason: the cost is jsdom's teardown of the
 * layer, and it grows with machine load, so a limit that only holds when idle is a flake.
 */
const RADIX_LAYER_TIMEOUT_MS = 60_000;

describe("the Jobs table's cell actions", () => {
  afterEach(() => {
    resetTableQueryTransport();
    vi.restoreAllMocks();
  });

  it(
    "opens the agent output sheet from the Agent Output cell, and only from there",
    async () => {
      vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue(fetched);
      renderJobs();

      await clickCell("agentOutput");
      await waitFor(() => expect(screen.getByTestId("job-output-sheet")).toBeInTheDocument());
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  it(
    "opens Cost & Tokens from the Cost cell rather than the agent output",
    async () => {
      const fetchJobDetail = vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue(fetched);
      renderJobs();

      await clickCell("cost");
      const sheet = await waitFor(() => screen.getByTestId("job-cost-sheet-panel"));
      expect(sheet).toHaveTextContent("Cost & Tokens");
      // The catch-all this replaced: the output sheet must not have opened alongside it.
      expect(screen.queryByTestId("job-output-sheet")).not.toBeInTheDocument();
      // The Profile and Provider rows are detail-only, so the sheet fetches for the same reason the
      // Debug sheet does.
      expect(fetchJobDetail).toHaveBeenCalledWith("00158");
      await waitFor(() =>
        expect(screen.getByTestId("job-cost-breakdown")).toHaveTextContent("Cache read"),
      );
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  it(
    "opens the same Cost & Tokens sheet from the Tokens cell",
    async () => {
      vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue(fetched);
      renderJobs();

      await clickCell("tokens");
      await waitFor(() => expect(screen.getByTestId("job-cost-sheet-panel")).toBeInTheDocument());
      expect(screen.queryByTestId("job-output-sheet")).not.toBeInTheDocument();
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  it(
    "opens the full, untruncated prompt from the Prompt cell",
    async () => {
      const long = `A ${"very ".repeat(200)}long request`;
      vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({ ...fetched, prompt: long });
      // No `planTitle`: `promptSource` walks title → prompt → id, and it is the *prompt* step this
      // sheet exists for — a `CreatePlan` whose plan does not exist yet has only that.
      renderJobs({ planTitle: undefined, prompt: long });

      await clickCell("prompt");
      const sheet = await waitFor(() => screen.getByTestId("job-prompt-sheet"));
      expect(sheet).toHaveTextContent("Full Prompt");
      expect(screen.queryByTestId("job-output-sheet")).not.toBeInTheDocument();
      // The cell truncates at 500 characters; the sheet is the place the whole thing is readable, so
      // a sheet that showed the truncation would have no reason to exist.
      await waitFor(() => expect(sheet.textContent ?? "").toContain(long));
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  it(
    "says so for a job type that carries no prompt of its own",
    async () => {
      vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue({
        ...fetched,
        planTitle: undefined,
        prompt: undefined,
        planId: undefined,
      });
      renderJobs({ type: "SplitPlan", planTitle: undefined, prompt: undefined, planId: undefined });

      await clickCell("prompt");
      await waitFor(() => expect(screen.getByTestId("job-prompt-empty")).toBeInTheDocument());
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  it(
    "navigates from the Plan Id cell instead of opening any sheet",
    async () => {
      const onSelectPlan = vi.fn();
      vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue(fetched);
      setTableQueryTransport(() =>
        Promise.resolve({ rows: [listRow], totalRows: 1, rowCount: 1, offset: 0, limit: 50 }),
      );
      render(
        <JobsView
          jobs={[listRow]}
          jobDetails={{ "00158": fetched }}
          onSelectPlan={onSelectPlan}
          onStopAllQueued={() => {}}
          onStopAll={() => {}}
        />,
      );

      await clickCell("planId");
      await waitFor(() => expect(onSelectPlan).toHaveBeenCalledWith("00638"));
      expect(screen.queryByTestId("job-output-sheet")).not.toBeInTheDocument();
      expect(screen.queryByTestId("job-cost-sheet-panel")).not.toBeInTheDocument();
    },
    RADIX_LAYER_TIMEOUT_MS,
  );

  it(
    "leaves a cell with no action of its own inert - V1 selects nothing and activates nothing",
    async () => {
      vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue(fetched);
      renderJobs();

      await clickCell("project");
      // `SelectionModes.None` on V1's grid: the row is not a button, so nothing opens.
      await waitFor(() => expect(screen.queryByTestId("job-output-sheet")).not.toBeInTheDocument());
      expect(screen.queryByTestId("job-cost-sheet-panel")).not.toBeInTheDocument();
      expect(screen.queryByTestId("job-prompt-sheet")).not.toBeInTheDocument();
    },
    RADIX_LAYER_TIMEOUT_MS,
  );
});

describe("the row's own cells", () => {
  afterEach(() => {
    resetTableQueryTransport();
    vi.restoreAllMocks();
  });

  it(
    "marks exactly the five columns V1 gives a cell action as clickable",
    async () => {
      vi.spyOn(jobsStore, "fetchJobDetail").mockResolvedValue(fetched);
      // With `onSelectPlan`, as the app mounts it. Plan Id is the one cell action that needs a
      // destination from outside the table, and it correctly declares itself inert without one.
      setTableQueryTransport(() =>
        Promise.resolve({ rows: [listRow], totalRows: 1, rowCount: 1, offset: 0, limit: 50 }),
      );
      render(
        <JobsView
          jobs={[listRow]}
          jobDetails={{ "00158": fetched }}
          onSelectPlan={() => {}}
          onStopAllQueued={() => {}}
          onStopAll={() => {}}
        />,
      );

      const row = await waitFor(() => {
        const found = document.querySelector("tbody [data-row-id]");
        if (!found) throw new Error("no row yet");
        return found as HTMLElement;
      });
      const clickable = [...within(row).getAllByRole("cell")]
        .filter((cell) => cell.getAttribute("data-clickable") === "true")
        .map((cell) => cell.getAttribute("data-column"));

      expect(new Set(clickable)).toEqual(
        new Set(["planId", "prompt", "cost", "tokens", "agentOutput"]),
      );
    },
    RADIX_LAYER_TIMEOUT_MS,
  );
});
