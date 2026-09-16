import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { DataTable } from "./data-table";
import { DataTableRowActions } from "./data-table-row-actions";
import type { DataTableColumn, DataTableRowAction } from "./types";

/**
 * The quick-actions menu.
 *
 * The framework renders row actions as an HTML overlay pinned to the hovered row's right edge
 * (`widgets/dataTables/dataTableRowAction/rowActionButtons.tsx`), resolved by `ActionRenderer`: an
 * action with `children` becomes a kebab dropdown, one without becomes a button, and a `Separator`
 * renders nothing. V1's Jobs table is the caller — `RowActions(row => …)` returns a `MenuItem[]` per
 * row, so which entries exist depends on the row's status (`Apps/Jobs/JobsApp.DataTable.cs:178-211`).
 *
 * What is asserted here is that resolution and the dispatch: which control a shape produces, that a
 * row with nothing to offer gets no cell at all, and that an invoked action reports the row it belongs
 * to. Opening the dropdown is not — Radix gates its trigger on pointer events jsdom does not
 * implement — so a menu's *items* are covered by the per-row factory that builds them.
 */

interface Row {
  id: string;
  status: string;
}

const rows: Row[] = [
  { id: "job-1", status: "Running" },
  { id: "job-2", status: "Completed" },
];

const columns: DataTableColumn<Row>[] = [
  { name: "id", header: "Id" },
  { name: "status", header: "Status" },
];

/** V1's shape: one parent holding the menu, which is what Ivy's `MenuItem[]` renders as. */
const jobMenu = (children: DataTableRowAction<Row>[]): DataTableRowAction<Row>[] => [
  { tag: "job-menu", label: "Job actions", icon: <span aria-hidden="true">⋮</span>, children },
];

describe("DataTableRowActions", () => {
  it("renders a parent with children as one menu trigger, not as its items", () => {
    render(
      <DataTableRowActions
        actions={jobMenu([
          { tag: "stop-job", label: "Stop" },
          { tag: "delete-job", label: "Delete", variant: "destructive" },
        ])}
        row={rows[0]}
        rowId="job-1"
      />,
    );

    expect(screen.getByRole("button", { name: "Job actions" })).toBeInTheDocument();
    // Collapsed: a per-row overflow menu, which is what V1's `MenuItem[]` becomes.
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("renders a childless action as a button and reports the row it was invoked on", () => {
    const onRowAction = vi.fn();
    render(
      <DataTableRowActions
        actions={[{ tag: "stop-job", label: "Stop", icon: <span aria-hidden="true">⏸</span> }]}
        row={rows[0]}
        rowId="job-1"
        onRowAction={onRowAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onRowAction).toHaveBeenCalledWith({ id: "job-1", tag: "stop-job", row: rows[0] });
  });

  it("disables an action that carries its reason rather than hiding it", () => {
    // V1 toasts "Cannot rerun: original args were not preserved." after the click; a disabled entry
    // with the reason on it says the same thing before the click.
    render(
      <DataTableRowActions
        actions={[
          { tag: "rerun-job", label: "Rerun", disabled: true, tooltip: "Cannot rerun: no args" },
        ]}
        row={rows[0]}
        rowId="job-1"
      />,
    );

    expect(screen.getByRole("button", { name: "Rerun" })).toBeDisabled();
  });

  it("renders nothing for a row whose only entries are separators", () => {
    const { container } = render(
      <DataTableRowActions
        actions={[{ tag: "sep", label: "", variant: "separator" }]}
        row={rows[0]}
        rowId="job-1"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("DataTable row actions column", () => {
  it("gives each row the menu its own status earns", () => {
    render(
      <DataTable<Row>
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        paginated={false}
        rowActions={(row) =>
          row.status === "Running"
            ? jobMenu([{ tag: "stop-job", label: "Stop" }])
            : [{ tag: "delete-job", label: "Delete" }]
        }
      />,
    );

    // The per-row factory is `perRowActions`: the Running row gets the menu, the Completed row a
    // single button, and neither is offered the other's entry.
    expect(screen.getByRole("button", { name: "Job actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("drops the actions column entirely when no row has an action", () => {
    const { container } = render(
      <DataTable<Row>
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        paginated={false}
        rowActions={() => []}
      />,
    );

    // Not an empty cell per row: a column of nothing is a column that should not be there.
    expect(container.querySelectorAll("thead th")).toHaveLength(2);
    expect(screen.queryByText("Row actions")).not.toBeInTheDocument();
  });

  it("keeps a row action from activating the row", () => {
    const onRowClick = vi.fn();
    const onRowAction = vi.fn();
    render(
      <DataTable<Row>
        columns={columns}
        rows={[rows[0]]}
        getRowId={(row) => row.id}
        paginated={false}
        onRowClick={onRowClick}
        rowActions={[{ tag: "stop-job", label: "Stop" }]}
        onRowAction={onRowAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onRowAction).toHaveBeenCalledTimes(1);
    // V1 hangs cell actions off cells and a menu off the row; stopping one triggering the other is what
    // keeps "Stop" from also opening the job's output sheet.
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
