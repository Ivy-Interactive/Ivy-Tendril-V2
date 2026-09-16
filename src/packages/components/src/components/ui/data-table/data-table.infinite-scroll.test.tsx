import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { DataTableColumnFilters } from "./column-filters";
import { columnFiltersToRemoteFilter } from "./column-filters";
import { DataTable } from "./data-table";
import type { RemoteTableFetcher, RemoteTableRequest } from "./remote-query";
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
    // A column holding a joined list is not *equal* to any one project, so its facet says `contains`.
    filter: { kind: "select", options: [{ value: "web" }, { value: "api" }], function: "contains" },
  },
  { name: "prompt", header: "Prompt", filter: { kind: "text" } },
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
  const [filters, setFilters] = React.useState<DataTableColumnFilters>({});
  const filter = React.useMemo(() => columnFiltersToRemoteFilter(columns, filters), [filters]);
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
      <DataTable<Job>
        {...table.tableProps}
        columns={columns}
        getRowId={(row) => row.id}
        virtualized={false}
        loadMoreThreshold={THRESHOLD_ROWS}
        showColumnFilters
        columnFilters={filters}
        onColumnFiltersChange={(next) => {
          setFilters(next);
          onFilterChange?.(columnFiltersToRemoteFilter(columns, next));
        }}
      />
    </div>
  );
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
});

describe("DataTable header filters", () => {
  it("renders a sticky filter row inside the header, under the labels", async () => {
    const { fetchPage } = fakeServer(100);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    const headerRows = container.querySelectorAll("thead tr");
    expect(headerRows).toHaveLength(2);
    expect(headerRows[1]).toHaveAttribute("data-slot", "data-table-filter-row");
    // One control per filterable column, and none for the column that declares no filter.
    expect(screen.getByRole("button", { name: "Filter by Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter by Project" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Filter by Prompt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Filter by Id" })).not.toBeInTheDocument();
  });

  it("sends a facet selection as one `inSet` condition, from the first window", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Filter by Status" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByLabelText("Running"));
    });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].filter).toEqual({
      condition: { column: "status", function: "inSet", args: ["Running"] },
    });
    // A new filter is a new result set, so it starts at the top rather than appending to the old one.
    expect(requests[1].offset).toBe(0);
  });

  it("ANDs two columns' filters", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Filter by Status" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByLabelText("Completed"));
    });
    await waitFor(() => expect(requests).toHaveLength(2));

    const prompt = screen.getByRole("textbox", { name: "Filter by Prompt" });
    await act(async () => {
      fireEvent.change(prompt, { target: { value: "deploy" } });
      fireEvent.keyDown(prompt, { key: "Enter" });
    });

    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].filter).toEqual({
      group: {
        op: "and",
        filters: [
          { condition: { column: "status", function: "inSet", args: ["Completed"] } },
          { condition: { column: "prompt", function: "contains", args: ["deploy"] } },
        ],
      },
    });
  });

  it("commits a text filter on Enter and not on every keystroke", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    const prompt = screen.getByRole("textbox", { name: "Filter by Prompt" });
    await act(async () => {
      fireEvent.change(prompt, { target: { value: "d" } });
      fireEvent.change(prompt, { target: { value: "de" } });
      fireEvent.change(prompt, { target: { value: "dep" } });
    });
    // Typing is not filtering — the framework's editor commits on Enter, and a server-side filter is
    // exactly where one request per keystroke is unaffordable.
    expect(requests).toHaveLength(1);

    await act(async () => {
      fireEvent.keyDown(prompt, { key: "Enter" });
    });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].filter).toEqual({
      condition: { column: "prompt", function: "contains", args: ["dep"] },
    });
  });

  it("honours a column's function override for a joined-list column", async () => {
    const { requests, fetchPage } = fakeServer(100);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Filter by Project" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByLabelText("web"));
    });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].filter).toEqual({
      condition: { column: "project", function: "contains", args: ["web"] },
    });
  });

  it("drops the rows it holds when a filter narrows the table", async () => {
    const { fetchPage } = fakeServer(100);
    const { container } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));
    scrollTo(scrollerFor(container), 400);
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("40"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Filter by Status" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByLabelText("Running"));
    });

    // Forty rows of the old result set are not the first forty of the new one, so the accumulation is
    // dropped and the scroll starts again — which is what the framework does on a filter change too
    // (`useDataLoading.ts` resets its loaded-row count).
    await waitFor(() => expect(screen.getByTestId("loaded")).toHaveTextContent("20"));
  });
});
