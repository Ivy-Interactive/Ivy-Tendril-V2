import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "vite-plus/test";

import { DataTable } from "./data-table";
import type { DataTableColumn } from "./types";

/**
 * The footer's row range against the rows actually on screen.
 *
 * `getPageRange` computes `end` as `min(page * pageSize, total)`, which under `manualPagination`
 * trusts the caller's `rowCount` completely. The Inbox passed a server total of 51 alongside 44
 * rows — it drops pull requests client-side after paging — and the footer duly read
 * "Showing 1-50 of 51" above 44 rendered rows, which is what the user hit when Select All filled
 * 44. The count is the caller's to get right; printing a range the body contradicts is the
 * component's, so the range is clamped here regardless.
 */

interface Row {
  id: string;
  title: string;
}

const columns: DataTableColumn<Row>[] = [
  { name: "id", header: "Id" },
  { name: "title", header: "Title" },
];

const rows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: String(i + 1), title: `Row ${i + 1}` }));

describe("the paginated footer's row range", () => {
  it("never claims more rows than the page rendered", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows(44)}
        getRowId={(row) => row.id}
        paginated
        manualPagination
        rowCount={51}
        defaultPageSize={50}
      />,
    );

    expect(screen.getByText("Showing 1–44 of 51")).toBeInTheDocument();
  });

  it("leaves an honest range alone", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows(50)}
        getRowId={(row) => row.id}
        paginated
        manualPagination
        rowCount={120}
        defaultPageSize={50}
      />,
    );

    expect(screen.getByText("Showing 1–50 of 120")).toBeInTheDocument();
  });

  it("reports the whole range on a short final page", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows(7)}
        getRowId={(row) => row.id}
        paginated
        manualPagination
        rowCount={7}
        defaultPageSize={50}
      />,
    );

    expect(screen.getByText("Showing 1–7 of 7")).toBeInTheDocument();
  });

  it("says so when there are no rows at all", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        getRowId={(row) => row.id}
        paginated
        manualPagination
        rowCount={0}
        defaultPageSize={50}
      />,
    );

    expect(screen.getByText("No rows")).toBeInTheDocument();
  });
});
