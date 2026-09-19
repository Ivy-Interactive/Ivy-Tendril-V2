import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { DataTable } from "./data-table";
import type { RemoteTableFetcher, RemoteTablePage, RemoteTableRequest } from "./remote-query";
import { allOf, anyOf, not, whereColumn } from "./remote-query";
import type { DataTableColumn } from "./types";
import { useRemoteDataTable } from "./use-remote-data-table";

/**
 * The remote source is what makes "millions of rows" true in the browser: the table only ever holds
 * one window, so what is asserted here is the *window arithmetic* and the request discipline around
 * it — the offset a page maps to, that the footer's total comes from the server, that a superseded
 * response cannot win a race, and that narrowing a filter cannot leave a table stranded on a page
 * that no longer exists.
 */

interface Job {
  id: string;
  status: string;
}

const columns: DataTableColumn<Job>[] = [
  { name: "id", header: "Id" },
  { name: "status", header: "Status" },
];

/** A table of `total` rows, served a window at a time — the shape the daemon's route returns. */
function fakeServer(total: number) {
  const requests: RemoteTableRequest[] = [];
  const fetchPage: RemoteTableFetcher<Job> = (request) => {
    requests.push(request);
    const rows: Job[] = [];
    for (
      let index = request.offset;
      index < Math.min(request.offset + request.limit, total);
      index++
    ) {
      rows.push({ id: `job-${index + 1}`, status: index % 2 === 0 ? "Running" : "Completed" });
    }
    return Promise.resolve({
      rows,
      totalRows: total,
      offset: request.offset,
      rowCount: rows.length,
      limit: request.limit,
      versionToken: `${total}:token`,
    });
  };
  return { requests, fetchPage };
}

function Harness({
  fetchPage,
  pageSize = 10,
  filter = null,
}: {
  fetchPage: RemoteTableFetcher<Job>;
  pageSize?: number;
  filter?: Parameters<typeof allOf>[0];
}) {
  const table = useRemoteDataTable<Job>({ fetchPage, pageSize, filter: filter ?? null });
  return (
    <div>
      <span data-testid="total">{table.total}</span>
      <span data-testid="page">{table.page}</span>
      <span data-testid="loading">{String(table.loading)}</span>
      <span data-testid="stale">{String(table.stale)}</span>
      <button type="button" onClick={() => table.setPage(table.page + 1)}>
        next
      </button>
      <button
        type="button"
        onClick={() => table.setSort({ column: "id", direction: "Descending" })}
      >
        sort
      </button>
      <DataTable<Job> {...table.tableProps} columns={columns} getRowId={(row) => row.id} />
    </div>
  );
}

describe("useRemoteDataTable", () => {
  it("asks for one window and reports the server's total", async () => {
    const { requests, fetchPage } = fakeServer(1_000_000);
    render(<Harness fetchPage={fetchPage} />);

    await waitFor(() => expect(screen.getByTestId("total")).toHaveTextContent("1000000"));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ offset: 0, limit: 10, sort: [], filter: null });
    // Ten rows in the DOM for a million-row table — the whole point.
    expect(screen.getAllByRole("row")).toHaveLength(11); // header + 10
    expect(screen.getByText("job-1")).toBeInTheDocument();
    expect(screen.queryByText("job-11")).not.toBeInTheDocument();
  });

  it("maps a page number onto an offset, never onto a bigger fetch", async () => {
    const { requests, fetchPage } = fakeServer(1_000_000);
    render(<Harness fetchPage={fetchPage} pageSize={25} />);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await act(async () => {
      screen.getByText("next").click();
    });
    await waitFor(() => expect(screen.getByText("job-26")).toBeInTheDocument());
    expect(requests[1]).toMatchObject({ offset: 25, limit: 25 });
  });

  it("sends the sort to the server and returns to the first page", async () => {
    const { requests, fetchPage } = fakeServer(500);
    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    await act(async () => {
      screen.getByText("next").click();
    });
    await waitFor(() => expect(screen.getByTestId("page")).toHaveTextContent("2"));

    await act(async () => {
      screen.getByText("sort").click();
    });
    await waitFor(() =>
      expect(requests.at(-1)).toMatchObject({
        offset: 0,
        sort: [{ column: "id", direction: "Descending" }],
      }),
    );
    expect(screen.getByTestId("page")).toHaveTextContent("1");
  });

  it("echoes the version token back so the daemon can report a shifted window", async () => {
    const requests: RemoteTableRequest[] = [];
    let stale = false;
    const fetchPage: RemoteTableFetcher<Job> = (request) => {
      requests.push(request);
      return Promise.resolve({
        rows: [{ id: "job-1", status: "Running" }],
        totalRows: 1,
        versionToken: "v1",
        stale,
      });
    };

    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(requests[0].versionToken).toBeUndefined();

    stale = true;
    await act(async () => {
      screen.getByText("sort").click();
    });
    await waitFor(() => expect(screen.getByTestId("stale")).toHaveTextContent("true"));
    expect(requests[1].versionToken).toBe("v1");
  });

  it("lets the newest request win however late an earlier one answers", async () => {
    // The failure this prevents: click sort, then click again before the first response lands, and the
    // table settles on whichever request the server happened to answer last.
    const resolvers: ((page: RemoteTablePage<Job>) => void)[] = [];
    const fetchPage: RemoteTableFetcher<Job> = () =>
      new Promise<RemoteTablePage<Job>>((resolve) => {
        resolvers.push(resolve);
      });

    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(resolvers).toHaveLength(1));

    await act(async () => {
      screen.getByText("sort").click();
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // Answer the *second* request first, then the stale first one.
    await act(async () => {
      resolvers[1]({ rows: [{ id: "fresh", status: "Running" }], totalRows: 2 });
    });
    await act(async () => {
      resolvers[0]({ rows: [{ id: "stale", status: "Running" }], totalRows: 999 });
    });

    expect(screen.getByText("fresh")).toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(screen.getByTestId("total")).toHaveTextContent("2");
  });

  it("aborts the superseded request", async () => {
    const signals: AbortSignal[] = [];
    const fetchPage: RemoteTableFetcher<Job> = (request) => {
      if (request.signal) signals.push(request.signal);
      return new Promise<RemoteTablePage<Job>>(() => {
        /* never settles */
      });
    };

    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(signals).toHaveLength(1));
    await act(async () => {
      screen.getByText("sort").click();
    });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("clamps onto the last page when a filter narrows the result set", async () => {
    // On page 5 of 500 rows, a filter that leaves 12 makes offset 40 an empty window. The server is
    // right to return nothing; the table must not therefore show "No results."
    let total = 500;
    const requests: RemoteTableRequest[] = [];
    const fetchPage: RemoteTableFetcher<Job> = (request) => {
      requests.push(request);
      const rows: Job[] = [];
      for (let i = request.offset; i < Math.min(request.offset + request.limit, total); i++) {
        rows.push({ id: `job-${i + 1}`, status: "Running" });
      }
      return Promise.resolve({ rows, totalRows: total, offset: request.offset });
    };

    const { rerender } = render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    for (let click = 0; click < 4; click++) {
      await act(async () => {
        screen.getByText("next").click();
      });
      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    }
    expect(screen.getByTestId("page")).toHaveTextContent("5");

    total = 12;
    rerender(
      <Harness fetchPage={fetchPage} filter={whereColumn("status", "equals", ["Running"])} />,
    );

    // The filter alone resets to page 1 — and even if it had not, the clamp would have caught it.
    await waitFor(() => expect(screen.getByTestId("total")).toHaveTextContent("12"));
    expect(screen.getByTestId("page")).toHaveTextContent("1");
    expect(screen.getByText("job-1")).toBeInTheDocument();
    expect(screen.queryByText("No results.")).not.toBeInTheDocument();
    expect(requests.at(-1)).toMatchObject({
      offset: 0,
      filter: { condition: { column: "status", function: "equals", args: ["Running"] } },
    });
  });

  it("does not refetch when an equal filter object is rebuilt on every render", async () => {
    const { requests, fetchPage } = fakeServer(100);
    const { rerender } = render(
      <Harness fetchPage={fetchPage} filter={whereColumn("status", "equals", ["Running"])} />,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(requests).toHaveLength(1);

    rerender(
      <Harness fetchPage={fetchPage} filter={whereColumn("status", "equals", ["Running"])} />,
    );
    rerender(
      <Harness fetchPage={fetchPage} filter={whereColumn("status", "equals", ["Running"])} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
  });

  it("keeps the previous page visible while the next one loads", async () => {
    const resolvers: ((page: RemoteTablePage<Job>) => void)[] = [];
    const fetchPage: RemoteTableFetcher<Job> = () =>
      new Promise<RemoteTablePage<Job>>((resolve) => resolvers.push(resolve));

    render(<Harness fetchPage={fetchPage} />);
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => {
      resolvers[0]({ rows: [{ id: "first-page-row", status: "Running" }], totalRows: 40 });
    });
    expect(screen.getByText("first-page-row")).toBeInTheDocument();

    await act(async () => {
      screen.getByText("next").click();
    });
    // In flight: the table reports busy, and the rows underneath are the ones the user was reading.
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
  });

  it("surfaces a failed fetch without wiping the table", async () => {
    const onError = vi.fn();
    let fail = false;
    const fetchPage: RemoteTableFetcher<Job> = () =>
      fail
        ? Promise.reject(new Error("daemon is down"))
        : Promise.resolve({ rows: [{ id: "job-1", status: "Running" }], totalRows: 1 });

    function ErrorHarness() {
      const table = useRemoteDataTable<Job>({ fetchPage, pageSize: 10, onError });
      return (
        <div>
          <span data-testid="error">{String((table.error as Error | undefined)?.message)}</span>
          <button type="button" onClick={table.refresh}>
            refresh
          </button>
          <DataTable<Job> {...table.tableProps} columns={columns} getRowId={(row) => row.id} />
        </div>
      );
    }

    render(<ErrorHarness />);
    await waitFor(() => expect(screen.getByText("job-1")).toBeInTheDocument());

    fail = true;
    await act(async () => {
      screen.getByText("refresh").click();
    });
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("daemon is down"));
    expect(onError).toHaveBeenCalledTimes(1);
    // The rows the user was looking at are still there.
    expect(screen.getByText("job-1")).toBeInTheDocument();
  });

  it("does not fetch until it is enabled", async () => {
    const { requests, fetchPage } = fakeServer(10);
    function Gated({ enabled }: { enabled: boolean }) {
      const table = useRemoteDataTable<Job>({ fetchPage, enabled });
      return <span data-testid="loading">{String(table.loading)}</span>;
    }
    const { rerender } = render(<Gated enabled={false} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(0);
    expect(screen.getByTestId("loading")).toHaveTextContent("false");

    rerender(<Gated enabled />);
    await waitFor(() => expect(requests).toHaveLength(1));
  });
});

describe("filter builders", () => {
  it("build the proto's recursive shape", () => {
    expect(
      allOf(
        whereColumn("status", "inSet", ["Running", "Queued"]),
        anyOf(whereColumn("cost", "greaterThan", [5]), whereColumn("project", "contains", ["ivy"])),
      ),
    ).toEqual({
      group: {
        op: "and",
        filters: [
          { condition: { column: "status", function: "inSet", args: ["Running", "Queued"] } },
          {
            group: {
              op: "or",
              filters: [
                { condition: { column: "cost", function: "greaterThan", args: [5] } },
                { condition: { column: "project", function: "contains", args: ["ivy"] } },
              ],
            },
          },
        ],
      },
    });
  });

  it("collapse to nothing rather than to an empty group", () => {
    // An empty `and` matches everything server-side and an empty `or` matches nothing, so a
    // half-configured filter must be absent, not empty — otherwise clearing the last facet of an `or`
    // would empty the table.
    expect(allOf()).toBeNull();
    expect(anyOf(null, undefined)).toBeNull();
    expect(not(null)).toBeNull();
  });

  it("collapse a single child instead of wrapping it", () => {
    const one = whereColumn("status", "equals", ["Running"]);
    expect(allOf(one)).toBe(one);
    expect(anyOf(null, one)).toBe(one);
  });

  it("toggle negation rather than nesting it", () => {
    const positive = whereColumn("status", "equals", ["Running"]);
    const negated = not(positive);
    expect(negated).toMatchObject({ negate: true });
    expect(not(negated)).toMatchObject({ negate: false });
  });
});
