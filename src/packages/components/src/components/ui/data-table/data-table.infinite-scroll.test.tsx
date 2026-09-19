import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DataTable } from "./data-table";
import type { RemoteTableFetcher, RemoteTableFilter, RemoteTableRequest } from "./remote-query";
import type { DataTableColumn } from "./types";
import { useRemoteDataTable } from "./use-remote-data-table";

/**
 * Infinite scroll, end to end: the scroll container, the threshold, the appended window and the
 * request each one sends.
 *
 * This is the framework's row-loading model (`widgets/dataTables/hooks/useDataLoading.ts`: append
 * `batchSize` rows when the visible region comes within ten of the end) reached through a `<table>`
 * rather than a canvas grid, and V1's Jobs table is the caller it exists for — `c.BatchSize = 50`,
 * no pager, no `LoadAllRows` (`Apps/Jobs/JobsApp.DataTable.cs:93`).
 *
 * jsdom does no layout, so both halves of the check are mocked to fixed numbers and scrolls are
 * dispatched by hand, exactly as `data-table.virtualization.test.tsx` does.
 */

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 400;
/** Two rows of lead time, so the arithmetic in each test is legible. The default is ten. */
const THRESHOLD_ROWS = 2;

interface Job {
  id: string;
  status: string;
  project: string;
  prompt: string;
}

const columns: DataTableColumn<Job>[] = [
  { name: "id", header: "Id" },
  {
    name: "status",
    header: "Status",
    filter: {
      kind: "select",
      options: [{ value: "Running" }, { value: "Completed" }],
      placeholder: "All",
    },
  },
  {
    name: "project",
    header: "Project",
    // A column holding a joined list is not *equal* to any one project, so its default says `contains`.
    filter: { kind: "select", options: [{ value: "web" }, { value: "api" }], function: "contains" },
  },
  // The wire name differs from the displayed one, which is the case that proves the expression is
  // translated to the server's schema rather than passed through verbatim.
  { name: "prompt", header: "Prompt", filter: { kind: "text", column: "reportedPlanTitle" } },
];

function makeJob(index: number): Job {
  return {
    id: `job-${String(index + 1).padStart(4, "0")}`,
    status: index % 2 === 0 ? "Running" : "Completed",
    project: "web",
    prompt: `Prompt ${index + 1}`,
  };
}

/** A table of `total` rows served a window at a time, recording every request it is asked for. */
function fakeServer(total: number) {
  const requests: RemoteTableRequest[] = [];
  const fetchPage: RemoteTableFetcher<Job> = (request) => {
    requests.push(request);
    const rows: Job[] = [];
    for (let i = request.offset; i < Math.min(request.offset + request.limit, total); i++) {
      rows.push(makeJob(i));
    }
    return Promise.resolve({
      rows,
      totalRows: total,
      offset: request.offset,
      rowCount: rows.length,
    });
  };
  return { requests, fetchPage };
}

interface HarnessProps {
  fetchPage: RemoteTableFetcher<Job>;
  pageSize?: number;
  /** Reported back so a test can assert the wire filter without reaching into the hook. */
  onFilterChange?: (filter: unknown) => void;
}

function Harness({ fetchPage, pageSize = 20, onFilterChange }: HarnessProps) {
  const [expression, setExpression] = React.useState("");
  const [filter, setFilter] = React.useState<RemoteTableFilter | null>(null);
  const table = useRemoteDataTable<Job>({
    fetchPage,
    pageSize,
    filter,
    infinite: true,
    getRowKey: (row) => row.id,
  });

  return (
    <div>
      <span data-testid="total">{table.total}</span>
      <span data-testid="loaded">{table.rows.length}</span>
      <span data-testid="has-more">{String(table.hasMore)}</span>
      <button type="button" onClick={table.refresh}>
        refresh
      </button>
      <DataTable<Job>
        {...table.tableProps}
        columns={columns}
        getRowId={(row) => row.id}
        virtualized={false}
        loadMoreThreshold={THRESHOLD_ROWS}
        showFilter
        filterExpression={expression}
        onFilterExpressionChange={(next, parsed) => {
          setExpression(next);
          setFilter(parsed);
          onFilterChange?.(parsed);
        }}
      />
    </div>
  );
}

/**
 * The editor, expanding the toolbar's filter option first if it is still collapsed — which is what a
 * user does, and what the framework's `DataTableOption` requires of one.
 */
async function openFilterEditor(): Promise<HTMLElement> {
  const existing = screen.queryByRole("textbox", { name: "Filter expression" });
  if (existing) return existing;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  });
  return screen.getByRole("textbox", { name: "Filter expression" });
}

/** Types an expression into the toolbar's editor and commits it the way a user does. */
async function commitExpression(text: string): Promise<HTMLElement> {
  const box = await openFilterEditor();
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
  return box;
}

function scrollerFor(container: HTMLElement): HTMLDivElement {
  const scroller = container.querySelector<HTMLDivElement>(".overflow-auto");
  if (!scroller) throw new Error("No scroll container rendered");
  return scroller;
}

function dataRows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]"));
}

/** jsdom does no layout: a scroll has to be driven, and the offsets it reads have to be supplied. */
function scrollTo(scroller: HTMLElement, offset: number) {
  act(() => {
    scroller.scrollTop = offset;
    scroller.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  // The scroll container's content is as tall as the rows it holds, which is what makes the distance
  // to the end change as windows are appended.
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains("overflow-auto")) return 0;
      return this.querySelectorAll("tr[data-row-id]").length * ROW_HEIGHT;
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
  delete HTMLElement.prototype.scrollHeight;
  // @ts-expect-error - as above
  delete HTMLElement.prototype.clientHeight;
});

describe("DataTable infinite scroll", () => {
  it("loads one window, and no more until the viewport nears the end", async () => {
    const { requests, fetchPage } = fakeServer(1_000_000);
    const { container } = render(<Harness fetchPage={fetchPage} />);

    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));
    // One window of a million rows. The footer's count is the server's, not the client's.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ offset: 0, limit: 20 });
    expect(screen.getByTestId("total")).toHaveTextContent("1000000");
    expect(dataRows(container)).toHaveLength(20);

    // 800px of content in a 400px viewport at the top: 400px from the end, and the threshold is 80.
    scrollTo(scrollerFor(container), 100);
    expect(requests).toHaveLength(1);
  });

  it("appends the next window when scrolled within the threshold", async () => {
    const { requests, fetchPage } = fakeServer(1_000_000);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    scrollTo(scrollerFor(container), 400);

    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("40"));
    expect(requests).toHaveLength(2);
    // The second window's offset is the first window's end, and its limit is unchanged.
    expect(requests[1]).toMatchObject({ offset: 20, limit: 20 });
    // Appended, not replaced: the first row is still there under the fortieth.
    expect(screen.getByText("job-0001")).toBeInTheDocument();
    expect(screen.getByText("job-0040")).toBeInTheDocument();
    expect(dataRows(container)).toHaveLength(40);
  });

  it("keeps requesting until the rows cover the viewport", async () => {
    // Five-row windows in a ten-row viewport: one window cannot fill it, and no scroll event can ever
    // fire in a container that does not overflow, so the fetch has to chain on its own.
    const { requests, fetchPage } = fakeServer(15);
    render(<Harness fetchPage={fetchPage} pageSize={5} />);

    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("15"));
    expect(requests.map((request) => request.offset)).toEqual([0, 5, 10]);
    // Every row is in hand, so it stops rather than asking for a window past the end.
    expect(screen.getByTestId("has-more")).toHaveTextContent("false");
  });

  it("stops at the last row instead of asking for a window past the end", async () => {
    const { requests, fetchPage } = fakeServer(30);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    scrollTo(scrollerFor(container), 400);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("30"));
    expect(screen.getByTestId("has-more")).toHaveTextContent("false");

    // Scrolling on past the end of a fully loaded table asks for nothing.
    scrollTo(scrollerFor(container), 800);
    scrollTo(scrollerFor(container), 1200);
    expect(requests).toHaveLength(2);
  });

  it("de-duplicates a row an appended window repeats", async () => {
    // A live table shifts: this server hands back row 20 again as row 21's window opens, which is what
    // a job completing between two requests does to an ordered result set.
    const requests: RemoteTableRequest[] = [];
    const fetchPage: RemoteTableFetcher<Job> = (request) => {
      requests.push(request);
      const start = request.offset === 0 ? 0 : request.offset - 1;
      const rows = Array.from({ length: request.limit }, (_, i) => makeJob(start + i));
      return Promise.resolve({ rows, totalRows: 100, offset: request.offset });
    };
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    scrollTo(scrollerFor(container), 400);
    await waitFor(() => expect(requests).toHaveLength(2));

    // Nineteen new rows, not twenty, and `job-0020` appears exactly once — a repeat reaching a keyed
    // `<tbody>` twice is a React key collision, not a cosmetic duplicate.
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("39"));
    expect(screen.getAllByText("job-0020")).toHaveLength(1);
  });

  it("shows a loading-more row rather than replacing the table with a skeleton", async () => {
    let release: (() => void) | undefined;
    const { fetchPage } = fakeServer(100);
    const gated: RemoteTableFetcher<Job> = (request) => {
      if (request.offset === 0) return fetchPage(request);
      return new Promise((resolve) => {
        release = () => resolve(fetchPage(request));
      });
    };

    const { container } = render(<Harness fetchPage={gated} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    scrollTo(scrollerFor(container), 400);
    await waitFor(() =>
      expect(container.querySelector('tr[data-slot="data-table-load-more"]')).toBeInTheDocument(),
    );
    // The rows already fetched are still readable while the next window is in flight.
    expect(screen.getByText("job-0001")).toBeInTheDocument();
    expect(dataRows(container)).toHaveLength(20);
    expect(screen.getByText("Loading more…")).toBeInTheDocument();

    await act(async () => {
      release?.();
    });
    await waitFor(() =>
      expect(
        container.querySelector('tr[data-slot="data-table-load-more"]'),
      ).not.toBeInTheDocument(),
    );
  });

  it("has no pager, because scrolling is the pager", async () => {
    const { fetchPage } = fakeServer(1_000);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    // `useRemoteDataTable` reports `paginated: false` under `infinite`, so the footer never renders.
    expect(screen.queryByRole("button", { name: /next page/i })).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="data-table-pagination"]')).not.toBeInTheDocument();
  });

  it("keeps a scroll that lands before the first window's reset effect runs", async () => {
    /* The first window grows the table from *no* rows, which is an append: nothing was replaced. It
       used to read as a replacement, and the reset a replacement triggers runs in an effect, one
       commit after the rows it reacts to. A scroll landing in that gap was rewound to zero, and under
       infinite scroll that also swallowed the window it asked for - the load-more check then measured
       the distance to the end from the top of the table and declined.

       Waiting with bare timers rather than `waitFor` is the point: `waitFor` runs its callback inside
       `asyncWrapper`, which flushes React's pending passive effects, so the reset has always already
       happened by the time it returns and the gap this closes cannot be observed. Polling the DOM
       outside `act` stops at the commit that rendered the rows, which is where a loaded CI machine
       delivers a scroll. */
    const { requests, fetchPage } = fakeServer(100);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    for (let i = 0; i < 500 && dataRows(container).length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(dataRows(container)).toHaveLength(20);

    scrollTo(scrollerFor(container), 400);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].offset).toBe(20);
    // The scroll that asked for the window is still where the reader left it.
    expect(scrollerFor(container).scrollTop).toBe(400);
  });
});

/**
 * The filter, as the framework has it: **one** expression control at the top-left of the toolbar, not a
 * band of per-column widgets. `DataTableWidget.tsx` renders it as the first child of the header's left
 * group, and there is no filter row in `<thead>` anywhere in the framework's grid.
 *
 * The payload is what these assert. The front end changed; the wire filter — `inSet` for a set,
 * `contains` for free text, an `and` group across columns, the daemon's own column names — did not.
 */
describe("DataTable filter expression", () => {
  it("puts one filter control at the top-left of the toolbar, and no filter row in the header", async () => {
    const { fetchPage } = fakeServer(100);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    // One header row: the labels. The filter is not in the table at all.
    expect(container.querySelectorAll("thead tr")).toHaveLength(1);
    expect(container.querySelector('[data-slot="data-table-filter-row"]')).not.toBeInTheDocument();

    // And it is the *first* thing in the toolbar's left group, which is where the framework puts it.
    const toolbar = container.querySelector('[data-slot="data-table-filter"]');
    expect(toolbar).toBeInTheDocument();
    expect(toolbar?.parentElement?.firstElementChild).toBe(toolbar);
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();

    // No per-column controls survive.
    expect(screen.queryByRole("button", { name: "Filter by Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Filter by Prompt" })).not.toBeInTheDocument();
  });

  it("expands into an editor whose placeholder is built from the table's own columns", async () => {
    const { fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    const box = await openFilterEditor();
    // The first filterable column, so the syntax is learnable from the control rather than from docs.
    expect(box).toHaveAttribute("placeholder", '[Status] contains "…"');
  });

  it("sends a set as one `inSet` condition, from the first window", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    await commitExpression('[Status] in ("Running")');

    await waitFor(() => expect(requests).toHaveLength(2));
    // One `IN`, which the daemon serves from an index — not a tree of ORed equalities.
    expect(requests[1].filter).toEqual({
      condition: { column: "status", function: "inSet", args: ["Running"] },
    });
    // A new filter is a new result set, so it starts at the top rather than appending to the old one.
    expect(requests[1].offset).toBe(0);
  });

  it("ANDs two columns, and translates each to the server's own column name", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    await commitExpression('[Status] = "Completed" AND [Prompt] contains "deploy"');

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].filter).toEqual({
      group: {
        op: "and",
        filters: [
          { condition: { column: "status", function: "equals", args: ["Completed"] } },
          // `Prompt` is displayed; `reportedPlanTitle` is what the schema calls it.
          { condition: { column: "reportedPlanTitle", function: "contains", args: ["deploy"] } },
        ],
      },
    });
  });

  it("ORs across columns, which a control per column could never express", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    await commitExpression('[Status] = "Running" OR [Project] contains "api"');

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].filter).toEqual({
      group: {
        op: "or",
        filters: [
          { condition: { column: "status", function: "equals", args: ["Running"] } },
          { condition: { column: "project", function: "contains", args: ["api"] } },
        ],
      },
    });
  });

  it("commits on Enter and not on every keystroke", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    const box = await openFilterEditor();
    await act(async () => {
      fireEvent.change(box, { target: { value: '[Prompt] contains "d' } });
      fireEvent.change(box, { target: { value: '[Prompt] contains "de' } });
      fireEvent.change(box, { target: { value: '[Prompt] contains "dep"' } });
    });
    // Typing is not filtering — the framework's editor commits on Enter, and a server-side filter is
    // exactly where one request per keystroke is unaffordable. Two of those three are not even valid.
    expect(requests).toHaveLength(1);

    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].filter).toEqual({
      condition: { column: "reportedPlanTitle", function: "contains", args: ["dep"] },
    });
  });

  it("refuses an expression it cannot read, and says which columns it accepts", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    const box = await commitExpression('[Nope] = "x"');

    // Not committed: the daemon would answer 400 and the table would empty for no visible reason.
    expect(requests).toHaveLength(1);
    const error = screen.getByTestId("data-table-filter-error");
    expect(error).toHaveTextContent("Unknown column 'Nope'");
    expect(error).toHaveTextContent("[Status]");
    // The text survives, so the typo can be corrected rather than retyped.
    expect(box).toHaveValue('[Nope] = "x"');
    expect(box).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the filter, restoring the whole table", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    await commitExpression('[Status] = "Running"');
    await waitFor(() => expect(requests).toHaveLength(2));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    });

    await waitFor(() => expect(requests).toHaveLength(3));
    // No constraint, never "matches nothing".
    expect(requests[2].filter).toBeNull();
  });

  it("re-reads every window it holds on a refresh, in one request, without shrinking", async () => {
    /* The bug: `refresh()` used to drop to the first window. A live table refreshes itself whenever
       the rows change structurally, so a reader scrolled to row 180 of 200 had the table collapse to
       50 rows under them - in the same commit that left `scrollTop` where it was, which points past
       the end of the new content and paints an empty body until the clamp lands. That is the "it
       goes empty for a moment and then renders" half of the Jobs flicker. */
    const { requests, fetchPage } = fakeServer(100);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));
    scrollTo(scrollerFor(container), 400);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("40"));
    scrollTo(scrollerFor(container), 1200);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("60"));
    expect(requests).toHaveLength(3);

    await act(async () => {
      screen.getByText("refresh").click();
    });
    await waitFor(() => expect(requests).toHaveLength(4));

    // One request for the whole span, from the top - not three, and not the first window alone.
    expect(requests[3].offset).toBe(0);
    expect(requests[3].limit).toBe(60);

    // The row set never shrinks, so the offset the reader is at stays inside the content.
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("60"));
    expect(dataRows(container)).toHaveLength(60);
    expect(dataRows(container)[0]).toHaveAttribute("data-row-id", "job-0001");

    // And the next window still follows the span rather than restarting after it.
    scrollTo(scrollerFor(container), 2000);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("80"));
    expect(requests[4].offset).toBe(60);
    expect(requests[4].limit).toBe(20);
  });

  it("refreshes a single held window as a single window", async () => {
    // The unscrolled case, which is where a refresh is cheapest and must stay so: no reader has
    // asked for more than the first window, so re-reading the span is re-reading that window.
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    await act(async () => {
      screen.getByText("refresh").click();
    });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].offset).toBe(0);
    expect(requests[1].limit).toBe(20);
    expect(screen.getByTestId("loaded")).toHaveTextContent("20");
  });

  it("returns to the top when a refresh finds the rows it held are gone", async () => {
    /* Rows deleted server-side make the re-read span shorter than what is held, so it is not a
       superset and `isRowIdentityAppend` correctly says so. The table then resets rather than
       holding an offset into rows that no longer exist - a visible jump, but the honest one. */
    let total = 100;
    const requests: RemoteTableRequest[] = [];
    const fetchPage: RemoteTableFetcher<Job> = (request) => {
      requests.push(request);
      const rows: Job[] = [];
      for (let i = request.offset; i < Math.min(request.offset + request.limit, total); i++) {
        rows.push(makeJob(i));
      }
      return Promise.resolve({
        rows,
        totalRows: total,
        offset: request.offset,
        rowCount: rows.length,
      });
    };

    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));
    scrollTo(scrollerFor(container), 400);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("40"));

    total = 10;
    await act(async () => {
      screen.getByText("refresh").click();
    });
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("10"));
    // The request still asked for the span; the server simply has less to give.
    expect(requests[2].offset).toBe(0);
    expect(requests[2].limit).toBe(40);
    expect(screen.getByTestId("total")).toHaveTextContent("10");
  });

  it("drops the rows it holds when a filter narrows the table", async () => {
    const { fetchPage } = fakeServer(100);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));
    scrollTo(scrollerFor(container), 400);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("40"));

    await commitExpression('[Status] = "Running"');

    // Forty rows of the old result set are not the first forty of the new one, so the accumulation is
    // dropped and the scroll starts again — which is what the framework does on a filter change too
    // (`useDataLoading.ts` resets its loaded-row count).
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));
  });
});

/**
 * The row actions sit above the row on the z axis, and their column has a real width.
 *
 * The bug this pins: `w-0` on the actions column is taken literally under `table-layout: fixed`, and a
 * collapsed `justify-end` cell lays its buttons out overflowing *leftwards* over the previous cell,
 * where a ghost button's transparent fill lets that cell's text read straight through the controls.
 */
describe("DataTable row actions stacking", () => {
  function ActionsHarness({ fixed }: { fixed: boolean }) {
    const { fetchPage } = fakeServer(4);
    const table = useRemoteDataTable<Job>({
      fetchPage,
      pageSize: 4,
      infinite: true,
      getRowKey: (row) => row.id,
    });
    return (
      <DataTable<Job>
        {...table.tableProps}
        columns={columns}
        getRowId={(row) => row.id}
        virtualized={false}
        className={fixed ? "[&_table.ivy-data-table]:table-fixed" : undefined}
        selectable
        rowActions={[
          { tag: "menu", label: "Job actions", children: [{ tag: "stop", label: "Stop" }] },
        ]}
      />
    );
  }

  it("gives the action and selection columns a real width, windowed or not", async () => {
    const { container } = render(<ActionsHarness fixed />);
    await waitFor(() => expect(dataRows(container)).toHaveLength(4));

    // Four rows is far below the windowing threshold, which is exactly the case that used to fall back
    // to `w-0` while the call site had already forced fixed layout.
    expect(container.querySelector("table")).not.toHaveClass("ivy-data-table-virtualized");
    for (const row of dataRows(container)) {
      const actions = row.querySelector("td.ivy-data-table-fit-actions");
      expect(actions).toBeInTheDocument();
      expect(actions).not.toHaveClass("w-0");
      expect(row.querySelector("td.ivy-data-table-fit-select")).toBeInTheDocument();
    }
    // And the header cells, which is where fixed layout actually reads the widths from.
    expect(container.querySelector("th.ivy-data-table-fit-actions")).toBeInTheDocument();
  });

  it("keeps the actions reachable on a selected row", async () => {
    const { container } = render(<ActionsHarness fixed={false} />);
    await waitFor(() => expect(dataRows(container)).toHaveLength(4));

    const row = dataRows(container)[3];
    await act(async () => {
      fireEvent.click(row.querySelector('button[role="checkbox"]') ?? row);
    });

    // A selected row paints `bg-muted`; the actions cell is a stacking level above the row's content, so
    // the trigger is still there and still labelled.
    expect(row.querySelector("td.ivy-data-table-fit-actions")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Job actions" })).toHaveLength(4);
  });
});
