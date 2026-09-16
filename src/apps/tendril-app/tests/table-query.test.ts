import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTableFetcher,
  fetchTableColumnValues,
  queryJobsPage,
  resetTableQueryTransport,
  setTableQueryTransport,
  toTableQueryBody,
  type TableQueryTransport,
} from "../src/api/tableQuery";
import type { Job } from "../src/types/api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/**
 * The wire half of the server-paged table. What matters is the *body*: `offset`/`limit` are the whole
 * mechanism by which a table of any size costs one page, and a filter has to reach the daemon in the
 * recursive shape it validates rather than as something flattened on the way out.
 */

interface Call {
  path: string;
  body: Record<string, unknown>;
}

function recordingTransport(reply: unknown): { calls: Call[]; transport: TableQueryTransport } {
  const calls: Call[] = [];
  const transport: TableQueryTransport = (path, body) => {
    calls.push({ path, body });
    return Promise.resolve(reply);
  };
  return { calls, transport };
}

afterEach(() => {
  resetTableQueryTransport();
  vi.restoreAllMocks();
});

describe("toTableQueryBody", () => {
  it("sends the window and omits the fields whose default is the empty case", () => {
    expect(toTableQueryBody({ offset: 0, limit: 50, sort: [] })).toEqual({ limit: 50 });
  });

  it("carries sort, filter, offset, projection, aggregates and the version token", () => {
    expect(
      toTableQueryBody({
        offset: 100,
        limit: 25,
        sort: [{ column: "cost", direction: "Descending" }],
        filter: {
          group: {
            op: "and",
            filters: [{ condition: { column: "status", function: "inSet", args: ["Running"] } }],
          },
        },
        selectColumns: ["id", "status"],
        aggregations: [{ column: "cost", function: "sum" }],
        versionToken: "25:2026-01-01",
      }),
    ).toEqual({
      offset: 100,
      limit: 25,
      sort: [{ column: "cost", direction: "Descending" }],
      filter: {
        group: {
          op: "and",
          filters: [{ condition: { column: "status", function: "inSet", args: ["Running"] } }],
        },
      },
      selectColumns: ["id", "status"],
      aggregations: [{ column: "cost", function: "sum" }],
      versionToken: "25:2026-01-01",
    });
  });
});

describe("queryJobsPage", () => {
  it("posts to the jobs query route and returns the page with the server's total", async () => {
    const rows: Partial<Job>[] = [{ id: "00042", status: "Running" as Job["status"] }];
    const { calls, transport } = recordingTransport({
      encoding: "application/json",
      rows,
      offset: 40,
      rowCount: 1,
      totalRows: 2_500_000,
      limit: 20,
      versionToken: "t1",
      stale: false,
      aggregations: [{ column: "Cost", function: "sum", value: 12.5 }],
    });
    setTableQueryTransport(transport);

    const page = await queryJobsPage({ offset: 40, limit: 20, sort: [] });

    expect(calls).toEqual([{ path: "/api/jobs/query", body: { offset: 40, limit: 20 } }]);
    expect(page.totalRows).toBe(2_500_000);
    expect(page.rows).toHaveLength(1);
    expect(page.versionToken).toBe("t1");
    expect(page.aggregations?.[0].value).toBe(12.5);
  });

  it("falls back to the page length when a reply carries no total", async () => {
    // Reporting zero would make a full page look empty to the footer.
    const { transport } = recordingTransport({ rows: [{ id: "1" }, { id: "2" }] });
    setTableQueryTransport(transport);
    const page = await queryJobsPage({ offset: 0, limit: 10, sort: [] });
    expect(page.totalRows).toBe(2);
    expect(page.rowCount).toBe(2);
  });
});

describe("createTableFetcher", () => {
  it("targets the generic route for the named table", async () => {
    const { calls, transport } = recordingTransport({ rows: [], totalRows: 0 });
    setTableQueryTransport(transport);

    await createTableFetcher("plans")({
      offset: 0,
      limit: 10,
      sort: [{ column: "updated", direction: "Descending" }],
      selectColumns: ["id", "title"],
    });

    expect(calls[0].path).toBe("/api/tables/plans/query");
    expect(calls[0].body).toEqual({
      limit: 10,
      sort: [{ column: "updated", direction: "Descending" }],
      selectColumns: ["id", "title"],
    });
  });

  it("escapes the table segment rather than pasting it into the path", async () => {
    const { calls, transport } = recordingTransport({ rows: [], totalRows: 0 });
    setTableQueryTransport(transport);
    await createTableFetcher("../jobs")({ offset: 0, limit: 1, sort: [] });
    expect(calls[0].path).toBe("/api/tables/..%2Fjobs/query");
  });
});

describe("fetchTableColumnValues", () => {
  it("asks the daemon for a facet's values instead of deriving them from rows", async () => {
    const { calls, transport } = recordingTransport({
      column: "Project",
      values: ["alpha", "beta"],
      totalValues: 2,
    });
    setTableQueryTransport(transport);

    const result = await fetchTableColumnValues("jobs", "project", { search: "a", limit: 20 });

    expect(calls[0]).toEqual({
      path: "/api/tables/jobs/values",
      body: { column: "project", search: "a", limit: 20 },
    });
    expect(result).toEqual({ column: "Project", values: ["alpha", "beta"], totalValues: 2 });
  });
});

/**
 * Inside the shell the only reachable transport is `cmd_query_table`: the webview holds no bearer secret
 * and there is no `/api` proxy, so a relative `fetch` resolves against the asset origin.
 */
describe("the Tauri transport", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("invokes the command with the path and the body, and never touches fetch", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue({ rows: [], totalRows: 7 });

    const page = await queryJobsPage({ offset: 50, limit: 50, sort: [] });

    expect(invoke).toHaveBeenCalledWith("cmd_query_table", {
      path: "/api/jobs/query",
      body: { offset: 50, limit: 50 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.totalRows).toBe(7);
  });

  it("surfaces the command's failure instead of retrying over HTTP", async () => {
    // The retry could only reach the asset origin, so it would replace the daemon's reason ("unknown
    // column …") with a confusing one. This is a `BridgeError`, which the app renders by `code`.
    const { invoke } = await import("@tauri-apps/api/core");
    const bridgeError = {
      code: "TABLE_QUERY_FAILED",
      message: "unknown column 'costt' for table 'Jobs'",
      details: null,
    };
    vi.mocked(invoke).mockRejectedValue(bridgeError);

    await expect(queryJobsPage({ offset: 0, limit: 10, sort: [] })).rejects.toBe(bridgeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the HTTP transport", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  it("posts JSON, asks for JSON, and passes the abort signal through", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rows: [], totalRows: 0 }),
    });
    const controller = new AbortController();

    await queryJobsPage({ offset: 0, limit: 10, sort: [], signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(path).toBe("/api/jobs/query");
    expect(init.method).toBe("POST");
    expect(init.headers.Accept).toBe("application/json");
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(String(init.body))).toEqual({ limit: 10 });
  });

  it("surfaces the daemon's reason for a rejected query, not just the status", async () => {
    // A 400 from this API names the column or function that was wrong. Swallowing it would leave a
    // filter UI with nothing to show the user.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "unknown column 'costt' for table 'Jobs'" }),
    });

    await expect(queryJobsPage({ offset: 0, limit: 10, sort: [] })).rejects.toThrow(
      "unknown column 'costt' for table 'Jobs'",
    );
  });

  it("still fails clearly when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error("not json")),
    });

    await expect(queryJobsPage({ offset: 0, limit: 10, sort: [] })).rejects.toThrow(
      "Request to /api/jobs/query failed (502)",
    );
  });
});
