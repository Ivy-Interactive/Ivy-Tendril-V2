import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { DataTable } from "./data-table";
import type { DataTableColumn } from "./types";

/**
 * Rectangular cell selection and copy — the DOM equivalent of the framework grid's
 * `rangeSelect: "rect"`, which is what every V1 table runs in
 * (`DataTableDefaults.ts:32-35` + `widgets/dataTables/utils/selectionModes.ts`).
 *
 * jsdom has no `ClipboardEvent` and no `DataTransfer`, so the copy is driven by firing a `copy`
 * event with a stub `clipboardData` and reading back what the handler wrote into it. That is exactly
 * what a browser hands the listener, so what is asserted is the real contract; only the object's
 * provenance differs.
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

const bodyRows = () => Array.from(document.querySelectorAll<HTMLElement>("tbody tr"));
const cell = (row: number, column: string) =>
  bodyRows()[row].querySelector<HTMLElement>(`td[data-column="${column}"]`)!;
const selectedText = () =>
  Array.from(document.querySelectorAll<HTMLElement>('td[data-selected="true"]')).map(
    (td) => td.textContent,
  );

/**
 * Fires a `copy` the way the browser would, with focus inside the table.
 *
 * The handler is guarded on `document.activeElement` being inside the table — Cmd+C anywhere else on
 * the page must still copy whatever it would have — so the focus has to be real, not implied.
 */
function copy(): Record<string, string> {
  const written: Record<string, string> = {};
  const clipboardData = {
    setData: (type: string, value: string) => {
      written[type] = value;
    },
  };
  const table = document.querySelector("table")!;
  const focusTarget = document.querySelector<HTMLElement>("tbody tr")!;
  focusTarget.focus();
  fireEvent.copy(table, { clipboardData });
  return written;
}

describe("rectangular cell selection", () => {
  it("selects a rectangle by dragging across rows and columns", () => {
    renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);

    expect(selectedText()).toEqual(["alpha", "Running", "beta", "Failed"]);
  });

  it("covers the same cells dragged backwards", () => {
    // `data-editor.tsx:1958-1961` normalises the rectangle, so an up-left drag is the same selection.
    renderTable();
    fireEvent.mouseDown(cell(1, "status"), { button: 0 });
    fireEvent.mouseEnter(cell(0, "name"));
    fireEvent.mouseUp(document);

    expect(selectedText()).toEqual(["alpha", "Running", "beta", "Failed"]);
  });

  it("does not paint a lone clicked cell as a selection", () => {
    // The grid draws a single cell as the *focused* cell, not as a highlighted block. Painting one
    // on every click would make ordinary clicking look like a mis-drag.
    renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseUp(document);
    expect(selectedText()).toEqual([]);
  });

  it("extends from the anchor on shift-click", () => {
    renderTable();
    fireEvent.mouseDown(cell(1, "status"), { button: 0 });
    fireEvent.mouseUp(document);
    fireEvent.mouseDown(cell(2, "owner"), { button: 0, shiftKey: true });

    expect(selectedText()).toEqual(["Failed", "bob", "Queued", "cyd"]);
  });

  it("pivots a shift-extend on the anchor rather than the nearest corner", () => {
    /*
     * The reason `DataTableCellRange` stores two cells rather than a normalised rectangle. Drag
     * down-right from (0,0) to (1,1), then shift-click up at (0, owner): the result must be the
     * rectangle from the *anchor* (0,0), not from the rectangle's corner.
     */
    renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);
    fireEvent.mouseDown(cell(0, "owner"), { button: 0, shiftKey: true });

    expect(selectedText()).toEqual(["alpha", "Running", "ada"]);
  });

  it("selects every cell on Cmd/Ctrl+A inside the table", () => {
    // `data-editor.tsx:3208-3225`: `selectAll` spans every column and every row.
    renderTable();
    const table = document.querySelector("table")!;
    fireEvent.keyDown(table, { key: "a", ctrlKey: true });

    expect(selectedText()).toHaveLength(9);
    expect(selectedText()[0]).toBe("alpha");
    expect(selectedText()[8]).toBe("cyd");
  });

  it("clears on Escape", () => {
    renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);
    fireEvent.keyDown(document.querySelector("table")!, { key: "Escape" });

    expect(selectedText()).toEqual([]);
  });

  it("clears when the operator presses somewhere else on the page", () => {
    // `dataTableEditor/DataTableEditor.tsx:384-400` listens on `document` for exactly this: a
    // selection left painted while the operator works elsewhere makes the next Cmd+C copy something
    // they are no longer looking at.
    renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);
    expect(selectedText()).toHaveLength(4);

    fireEvent.mouseDown(document.body);
    expect(selectedText()).toEqual([]);
  });

  it("drops the selection when the rows underneath change", () => {
    // The coordinates would still be in bounds but would name different cells, so re-pointing them
    // silently at data nobody selected is worse than dropping them.
    const { rerender } = renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);
    expect(selectedText()).toHaveLength(4);

    rerender(<DataTable columns={columns} rows={rows.slice(0, 2)} getRowId={(row) => row.id} />);
    expect(selectedText()).toEqual([]);
  });

  it("leaves a control inside a cell alone", () => {
    // A press aimed at a row-action button or a checkbox must reach it, not start a range out from
    // under it.
    const onClick = vi.fn();
    render(
      <DataTable
        columns={[
          { name: "name", header: "Name", cell: () => <button onClick={onClick}>Open</button> },
          ...columns.slice(1),
        ]}
        rows={rows}
        getRowId={(row) => row.id}
      />,
    );
    const button = screen.getAllByRole("button", { name: "Open" })[0];
    fireEvent.mouseDown(button, { button: 0 });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(selectedText()).toEqual([]);
  });
});

describe("copying a selection", () => {
  it("puts the rectangle on the clipboard as TSV", () => {
    renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);

    expect(copy()["text/plain"]).toBe("alpha\tRunning\nbeta\tFailed");
  });

  it("copies only the cells, never the headers", () => {
    // `data-editor.tsx:846`, `copyHeaders = false`, which V1 never overrides.
    renderTable();
    const table = document.querySelector("table")!;
    fireEvent.keyDown(table, { key: "a", metaKey: true });

    const text = copy()["text/plain"];
    expect(text).toBe("alpha\tRunning\tada\nbeta\tFailed\tbob\ngamma\tQueued\tcyd");
    expect(text).not.toContain("Name");
  });

  it("writes a table for the spreadsheets that prefer text/html", () => {
    // `data-editor-fns.ts:168-213` writes both flavours. Without the HTML one a paste into Sheets
    // lands as one string of tab-separated text in a single cell.
    renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(0, "status"));
    fireEvent.mouseUp(document);

    expect(copy()["text/html"]).toContain("<tr><td>alpha</td><td>Running</td></tr>");
  });

  it("copies a single clicked cell even though it is not painted as a block", () => {
    renderTable();
    fireEvent.mouseDown(cell(1, "status"), { button: 0 });
    fireEvent.mouseUp(document);

    expect(copy()["text/plain"]).toBe("Failed");
  });

  it("copies the value rather than what the cell rendered", () => {
    /*
     * `cellContent.ts:157` copies the untruncated string, and the framework's renderers set an
     * explicit `copyData` (`:330`, `:404`, `:456`). A cell that renders a badge or an icon has no
     * text to read back out of React, so the clipboard takes the value — or `getCellCopyText` when
     * the caller knows better.
     */
    render(
      <DataTable
        columns={[
          { name: "name", header: "Name", cell: (_value, row) => <span>▲ {row.name}</span> },
          ...columns.slice(1),
        ]}
        rows={rows}
        getRowId={(row) => row.id}
        getCellCopyText={(row, column) => (column.name === "name" ? row.name.toUpperCase() : "")}
      />,
    );
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseUp(document);

    expect(copy()["text/plain"]).toBe("ALPHA");
  });

  it("leaves the clipboard alone when focus is outside the table", () => {
    // `data-editor.tsx:3775-3779` guards the same way. Cmd+C elsewhere on the page must still copy
    // whatever it would have.
    renderTable();
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);

    const written: Record<string, string> = {};
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    fireEvent.copy(outside, {
      clipboardData: {
        setData: (type: string, value: string) => {
          written[type] = value;
        },
      },
    });
    outside.remove();

    expect(written).toEqual({});
  });

  it("copies nothing when the caller turns selection off", () => {
    renderTable({ allowCopySelection: false });
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);

    expect(selectedText()).toEqual([]);
    expect(copy()).toEqual({});
  });
});

describe("selection alongside a cell's own click", () => {
  it("still fires `onCellClick` on a plain click", () => {
    // `bd49fd09`'s per-column handler. Selecting is additive: a click that was only a click must
    // behave exactly as it did before any of this existed.
    const onCellClick = vi.fn();
    renderTable({
      columns: [{ name: "name", header: "Name", onCellClick }, ...columns.slice(1)],
    });
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseUp(document);
    fireEvent.click(cell(0, "name"));

    expect(onCellClick).toHaveBeenCalledTimes(1);
    expect(onCellClick).toHaveBeenCalledWith(rows[0], "1");
  });

  it("does not fire `onCellClick` at the end of a drag", () => {
    // The operator was selecting cells to copy, not asking to open a sheet.
    const onCellClick = vi.fn();
    renderTable({
      columns: [{ name: "name", header: "Name", onCellClick }, ...columns.slice(1)],
    });
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "name"));
    fireEvent.mouseUp(document);
    fireEvent.click(cell(1, "name"));

    expect(onCellClick).not.toHaveBeenCalled();
  });

  it("does not fire `onCellClick` on a shift-extend", () => {
    const onCellClick = vi.fn();
    renderTable({
      columns: [{ name: "name", header: "Name", onCellClick }, ...columns.slice(1)],
    });
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseUp(document);
    fireEvent.click(cell(0, "name"));
    onCellClick.mockClear();

    fireEvent.mouseDown(cell(2, "name"), { button: 0, shiftKey: true });
    fireEvent.click(cell(2, "name"));
    expect(onCellClick).not.toHaveBeenCalled();
  });

  it("does not fire `onRowClick` at the end of a drag either", () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);
    fireEvent.click(cell(1, "status"));

    expect(onRowClick).not.toHaveBeenCalled();

    // But a plain click on a row still opens it.
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseUp(document);
    fireEvent.click(cell(0, "name"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way of an editable table", () => {
    // The inline editor owns clicks and keys inside its cells; a range drag would fight it for the
    // same gesture, and the framework has the same exclusivity.
    renderTable({ editable: true });
    fireEvent.mouseDown(cell(0, "name"), { button: 0 });
    fireEvent.mouseEnter(cell(1, "status"));
    fireEvent.mouseUp(document);

    expect(selectedText()).toEqual([]);
  });
});
