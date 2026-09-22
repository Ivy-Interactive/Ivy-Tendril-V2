import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { DataTable } from "./data-table";
import {
  DATA_TABLE_DEFAULT_COLUMN_WIDTH,
  DATA_TABLE_MAX_COLUMN_WIDTH,
  DATA_TABLE_MIN_COLUMN_WIDTH,
  DATA_TABLE_RESIZE_STEP,
} from "./use-column-layout";
import type { DataTableColumn } from "./types";

/**
 * Column resizing and reordering, ported from
 * `widgets/dataTables/dataTableContext/hooks/useColumnManagement.ts`.
 *
 * jsdom lays nothing out — `getBoundingClientRect()` is all zeros and `setPointerCapture` does not
 * exist — so these assert the state the component *commits*: the inline `width` it writes onto the
 * `<th>` and the order it renders cells in. What a browser then does with a `width` on a `<th>` is
 * the browser's business and not something a unit test can or should second-guess.
 */

interface Row {
  id: string;
  name: string;
  status: string;
  owner: string;
}

const rows: Row[] = [
  { id: "1", name: "alpha", status: "Running", owner: "ada" },
  { id: "2", name: "beta", status: "Failed", owner: "bob" },
  { id: "3", name: "gamma", status: "Queued", owner: "cyd" },
];

const columns: DataTableColumn<Row>[] = [
  { name: "name", header: "Name" },
  { name: "status", header: "Status" },
  { name: "owner", header: "Owner" },
];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} {...props} />);
}

const headerCells = () => Array.from(document.querySelectorAll<HTMLElement>("thead th"));
const headerLabels = () => headerCells().map((cell) => cell.textContent?.trim());
const resizerFor = (header: string) =>
  within(headerCells().find((cell) => cell.textContent?.trim().startsWith(header))!).getByRole(
    "separator",
  );
const gripFor = (header: string) =>
  within(headerCells().find((cell) => cell.textContent?.trim().startsWith(header))!).getByRole(
    "button",
    { name: /^Reorder column/ },
  );

describe("column resizing", () => {
  it("is on for every table without being asked for", () => {
    // `DataTableDefaults.ts:33`, `allowColumnResizing: true`. The user's ask was "all datatables",
    // so the default is the feature.
    renderTable();
    expect(screen.getAllByRole("separator", { name: "Resize column" })).toHaveLength(3);
  });

  it("writes the dragged width onto the column", () => {
    renderTable();
    const handle = resizerFor("Name");
    // No declared width and no layout, so the drag starts from `columnSizing.ts:9-10`'s 150.
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(headerCells()[0]).toHaveStyle({ width: `${DATA_TABLE_DEFAULT_COLUMN_WIDTH + 60}px` });
  });

  it("refuses to drag a column narrower than the minimum", () => {
    // `useMobileColumnResize.ts:4` and `data-editor.tsx:862` both floor at 50. Below it the label
    // has no room and the column stops being identifiable.
    renderTable();
    const handle = resizerFor("Name");
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: -1000, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    expect(headerCells()[0]).toHaveStyle({ width: `${DATA_TABLE_MIN_COLUMN_WIDTH}px` });
  });

  it("keeps a resized width across a re-render with fresh column objects", () => {
    /*
     * `useColumnManagement.ts:75-79`: `if (Object.keys(prevWidths).length > 0) return prevWidths;`
     * — once anything has been dragged the defaults never recompute. A call site that builds its
     * columns inline re-renders with a new array on every keystroke elsewhere in the app, and
     * snapping the operator's widths back each time would make the feature unusable.
     */
    const { rerender } = renderTable();
    const handle = resizerFor("Name");
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 40, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });

    rerender(
      <DataTable
        columns={columns.map((column) => ({ ...column }))}
        rows={[...rows]}
        getRowId={(row) => row.id}
      />,
    );

    expect(headerCells()[0]).toHaveStyle({ width: `${DATA_TABLE_DEFAULT_COLUMN_WIDTH + 40}px` });
  });

  it("starts from the declared width rather than fighting it", () => {
    // `column.width` is the *starting* width. A first keyboard step must move from it, not jump to
    // a default first.
    render(
      <DataTable
        columns={[{ name: "name", header: "Name", width: "240px" }, ...columns.slice(1)]}
        rows={rows}
        getRowId={(row) => row.id}
      />,
    );
    const handle = resizerFor("Name");
    expect(handle).toHaveAttribute("aria-valuenow", "240");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(headerCells()[0]).toHaveStyle({ width: `${240 + DATA_TABLE_RESIZE_STEP}px` });
  });

  it("resizes from the keyboard, so the handle is not mouse-only", () => {
    renderTable();
    const handle = resizerFor("Name");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(headerCells()[0]).toHaveStyle({
      width: `${DATA_TABLE_DEFAULT_COLUMN_WIDTH + DATA_TABLE_RESIZE_STEP}px`,
    });

    fireEvent.keyDown(handle, { key: "Home" });
    expect(headerCells()[0]).toHaveStyle({ width: `${DATA_TABLE_MIN_COLUMN_WIDTH}px` });

    fireEvent.keyDown(handle, { key: "End" });
    expect(headerCells()[0]).toHaveStyle({ width: `${DATA_TABLE_MAX_COLUMN_WIDTH}px` });
  });

  it("returns a column to its declared width on double-click", () => {
    render(
      <DataTable
        columns={[{ name: "name", header: "Name", width: "240px" }, ...columns.slice(1)]}
        rows={rows}
        getRowId={(row) => row.id}
      />,
    );
    const handle = resizerFor("Name");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(headerCells()[0]).toHaveStyle({ width: "250px" });

    fireEvent.doubleClick(handle);
    expect(headerCells()[0]).toHaveStyle({ width: "240px" });
  });

  it("keeps the footer cell the same width as the header it sits under", () => {
    render(
      <DataTable
        columns={[{ name: "name", header: "Name", footer: "3 jobs" }, ...columns.slice(1)]}
        rows={rows}
        getRowId={(row) => row.id}
      />,
    );
    fireEvent.keyDown(resizerFor("Name"), { key: "ArrowRight" });
    const footerCell = document.querySelector<HTMLElement>("tfoot td");
    expect(footerCell).toHaveStyle({ width: `${DATA_TABLE_DEFAULT_COLUMN_WIDTH + 10}px` });
  });

  it("drops the handles when the caller turns resizing off", () => {
    renderTable({ allowColumnResizing: false });
    expect(screen.queryByRole("separator", { name: "Resize column" })).not.toBeInTheDocument();
  });

  it("does not put the column name in the handle's accessible name", () => {
    /*
     * Two of these ship on every header cell of every table. If the column label were part of their
     * names then "the Timer button" would name three controls — the sort button, the grip and the
     * resizer — which is an ambiguity for anyone driving by voice or by an element list. The label
     * is the accessible *description* instead, so it is still announced.
     */
    renderTable({ allowSorting: true });
    const handle = resizerFor("Name");
    expect(handle).toHaveAccessibleName("Resize column");
    expect(handle).toHaveAccessibleDescription("Name");

    // Exactly one button still answers to the column name — the sort button, which is what
    // `jobs-view.test.tsx:178` and its neighbours have always meant by it.
    const named = screen.getAllByRole("button", { name: /Name/ });
    expect(named).toHaveLength(1);
    expect(named[0]).toHaveAccessibleName("Sort by Name ascending");

    // And the grip announces the column without competing for its name.
    expect(gripFor("Name")).toHaveAccessibleName("Reorder column, position 1 of 3");
    expect(gripFor("Name")).toHaveAccessibleDescription("Name");
  });
});

describe("column reordering", () => {
  it("is on for every table without being asked for", () => {
    // `DataTableDefaults.ts:32`, `allowColumnReordering: true`.
    renderTable();
    expect(screen.getAllByRole("button", { name: /^Reorder column/ })).toHaveLength(3);
  });

  it("moves a column, and the cells follow their header", () => {
    renderTable();
    expect(headerLabels()).toEqual(["Name", "Status", "Owner"]);

    fireEvent.mouseDown(gripFor("Name"), { button: 0 });
    fireEvent.mouseEnter(headerCells()[2]);
    fireEvent.mouseUp(window);

    expect(headerLabels()).toEqual(["Status", "Owner", "Name"]);

    // The cells moved with it rather than the header alone sliding over a fixed body — the failure
    // this test exists for, since the header and the body iterate the same list precisely so it
    // cannot happen.
    const firstRow = document.querySelectorAll("tbody tr")[0];
    expect(Array.from(firstRow.querySelectorAll("td")).map((cell) => cell.textContent)).toEqual([
      "Running",
      "ada",
      "alpha",
    ]);
  });

  it("keeps `data-column` pointing at the right column after a move", () => {
    // `bd49fd09` added `data-column` as the other half of the cell coordinate. A reorder that left
    // it stale would silently route a cell click to the wrong column.
    renderTable();
    fireEvent.mouseDown(gripFor("Name"), { button: 0 });
    fireEvent.mouseEnter(headerCells()[2]);
    fireEvent.mouseUp(window);

    const firstRow = document.querySelectorAll("tbody tr")[0];
    expect(
      Array.from(firstRow.querySelectorAll("td")).map((cell) => cell.getAttribute("data-column")),
    ).toEqual(["status", "owner", "name"]);
    expect(firstRow.querySelector('[data-column="name"]')?.textContent).toBe("alpha");
  });

  it("reorders from the keyboard", () => {
    renderTable();
    fireEvent.keyDown(gripFor("Name"), { key: "ArrowRight" });
    expect(headerLabels()).toEqual(["Status", "Name", "Owner"]);

    fireEvent.keyDown(gripFor("Name"), { key: "ArrowLeft" });
    expect(headerLabels()).toEqual(["Name", "Status", "Owner"]);
  });

  it("will not nudge a column off either end", () => {
    renderTable();
    fireEvent.keyDown(gripFor("Name"), { key: "ArrowLeft" });
    expect(headerLabels()).toEqual(["Name", "Status", "Owner"]);
    fireEvent.keyDown(gripFor("Owner"), { key: "ArrowRight" });
    expect(headerLabels()).toEqual(["Name", "Status", "Owner"]);
  });

  it("abandons a drag on Escape", () => {
    renderTable();
    fireEvent.mouseDown(gripFor("Name"), { button: 0 });
    fireEvent.mouseEnter(headerCells()[2]);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseUp(window);
    expect(headerLabels()).toEqual(["Name", "Status", "Owner"]);
  });

  it("does not sort when the grip is pressed", () => {
    // The grip sits inside the header cell next to the sort button; a drag that also sorted would
    // reshuffle the rows under the operator mid-gesture.
    const onSortChange = vi.fn();
    renderTable({ allowSorting: true, onSortChange });
    fireEvent.mouseDown(gripFor("Name"), { button: 0 });
    fireEvent.click(gripFor("Name"));
    fireEvent.mouseUp(window);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("survives a re-render that only changes column metadata", () => {
    // `useColumnManagement.ts:36-48`: only a *structural* change resets the order.
    const { rerender } = renderTable();
    fireEvent.keyDown(gripFor("Name"), { key: "ArrowRight" });
    expect(headerLabels()).toEqual(["Status", "Name", "Owner"]);

    rerender(
      <DataTable
        columns={columns.map((column) => ({ ...column, help: "changed" }))}
        rows={rows}
        getRowId={(row) => row.id}
      />,
    );
    expect(headerLabels()).toEqual(["Status", "Name", "Owner"]);
  });

  it("resets the order when the columns themselves change", () => {
    // `useColumnManagement.ts:36-48` (`syncColumns`). A stale order over a different set of columns
    // is not the operator's order, it is an accident.
    const { rerender } = renderTable();
    fireEvent.keyDown(gripFor("Name"), { key: "ArrowRight" });
    expect(headerLabels()).toEqual(["Status", "Name", "Owner"]);

    rerender(
      <DataTable
        columns={[...columns, { name: "id", header: "Id" }]}
        rows={rows}
        getRowId={(row) => row.id}
      />,
    );
    expect(headerLabels()).toEqual(["Name", "Status", "Owner", "Id"]);
  });

  it("does not persist a layout across a remount", () => {
    /*
     * V1 holds widths and order in plain `useState` — there is not one `localStorage`,
     * `sessionStorage` or `persist` reference anywhere under `widgets/dataTables/`. Persisting would
     * make V2 behave differently from the thing it was asked to match, and would resurrect a layout
     * for a table whose columns had since changed meaning.
     */
    const first = renderTable();
    fireEvent.keyDown(gripFor("Name"), { key: "ArrowRight" });
    fireEvent.keyDown(resizerFor("Name"), { key: "ArrowRight" });
    expect(headerLabels()).toEqual(["Status", "Name", "Owner"]);
    first.unmount();

    renderTable();
    expect(headerLabels()).toEqual(["Name", "Status", "Owner"]);
    expect(headerCells()[0].style.width).toBe("");
  });

  it("drops the grips when the caller turns reordering off", () => {
    renderTable({ allowColumnReordering: false });
    expect(screen.queryByRole("button", { name: /^Reorder column/ })).not.toBeInTheDocument();
  });

  it("reports the move to a controlled caller", () => {
    const onColumnOrderChange = vi.fn();
    renderTable({ onColumnOrderChange });
    fireEvent.keyDown(gripFor("Name"), { key: "ArrowRight" });
    expect(onColumnOrderChange).toHaveBeenCalledWith(["status", "name", "owner"]);
  });

  it("never drops a column when a controlled order has gone stale", () => {
    // A stale order that silently lost a column would make it vanish with no affordance to bring it
    // back, so an unmentioned column is appended rather than filtered out.
    renderTable({ columnOrder: ["owner", "nope"] });
    expect(headerLabels()).toEqual(["Owner", "Name", "Status"]);
  });
});
