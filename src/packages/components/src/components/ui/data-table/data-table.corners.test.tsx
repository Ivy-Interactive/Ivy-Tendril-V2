import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { DataTable } from "./data-table";
import type { DataTableColumn } from "./types";

/**
 * The rounded corners of the table's own border.
 *
 * The bug this pins: the outer box draws `rounded-box border`, the header row inside it is square,
 * and without a clip the header's opaque background paints straight over the corner arcs — the table
 * reads as cropped at the top corners. It only ever looked right under `fillHeight`, which happened
 * to add `overflow-hidden` for its own (flex) reasons, so every ordinary table in the app showed it.
 *
 * jsdom applies no CSS, so what is asserted is the class contract: the clip and the radius are on the
 * same element, unconditionally. What a browser then paints is the browser's business.
 */

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [{ id: "1", name: "alpha" }];
const columns: DataTableColumn<Row>[] = [{ name: "name", header: "Name" }];

/** The box that draws the border — the one ancestor of the `<table>` carrying `rounded-box`. */
function borderBox(): HTMLElement {
  const table = document.querySelector("table")!;
  let node: HTMLElement | null = table.parentElement;
  while (node) {
    if (node.classList.contains("rounded-box")) return node;
    node = node.parentElement;
  }
  throw new Error("no bordered box around the table");
}

describe("the table's rounded corners", () => {
  it("clips the header against the border on an ordinary table", () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} />);
    const box = borderBox();
    expect(box).toHaveClass("rounded-box");
    expect(box).toHaveClass("border");
    // The fix: unconditional, not conditional on `fillHeight`.
    expect(box).toHaveClass("overflow-hidden");
  });

  it("clips it under `fillHeight` too, which is where it already worked", () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} fillHeight />);
    const box = borderBox();
    expect(box).toHaveClass("overflow-hidden");
    expect(box).toHaveClass("min-h-0");
  });

  it("clips a paginated table, whose footer owns the bottom corners", () => {
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} paginated />);
    expect(borderBox()).toHaveClass("overflow-hidden");
  });

  it("puts the clip on the same element as the radius, not on an ancestor", () => {
    /*
     * The clip only works if it is the element that draws the arcs. An `overflow-hidden` one level
     * out clips nothing that overlaps the radius, which is how this bug survives a casual fix.
     */
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} />);
    const box = borderBox();
    expect(box.className).toMatch(/overflow-hidden/);
    expect(box.className).toMatch(/rounded-box/);
  });

  it("does not clip the scrolling ancestor the sticky header pins against", () => {
    /*
     * The one thing worth checking before adding `overflow-hidden` anywhere: `position: sticky` pins
     * against the nearest *scrolling* ancestor. That is the `overflow-auto` div `Table` renders
     * (`table.tsx:48-52`), which is a child of this box — so the clip cannot unstick the header. If a
     * future edit moved the scroll onto the bordered box itself, this fails.
     */
    const { container } = render(
      <DataTable columns={columns} rows={rows} getRowId={(row) => row.id} />,
    );
    const box = borderBox();
    expect(box.className).not.toMatch(/overflow-auto/);
    const scroller = container.querySelector(".overflow-auto");
    expect(scroller).not.toBeNull();
    expect(box.contains(scroller!)).toBe(true);
  });

  it("leaves the overlays that must escape the box outside it", () => {
    /*
     * The other half of the check, and the reason clipping here is safe at all. Every overlay a
     * table opens is portalled to `document.body` by Radix — the row-actions menu, the
     * column-options popover, tooltips — so none of them are descendants of the clipped box at
     * paint time and the clip cannot cut one off.
     */
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        rowActions={[{ tag: "more", label: "More", children: [{ tag: "stop", label: "Stop" }] }]}
      />,
    );
    const box = borderBox();
    fireEvent.pointerDown(screen.getByRole("button", { name: "More" }), {
      button: 0,
      ctrlKey: false,
    });

    const item = screen.getByRole("menuitem", { name: "Stop" });
    expect(box.contains(item)).toBe(false);
    expect(document.body.contains(item)).toBe(true);
  });

  it("keeps the page-size popup out of the clip by using a native control", () => {
    /*
     * The pagination bar sits *inside* the clipped box, so its page-size menu would be the one
     * overlay at risk — except it is a deliberate native `<select>`
     * (`data-table-pagination.tsx:132`), whose popup the browser renders outside the page entirely
     * and no CSS can clip. Pinned here because swapping it for a styled listbox would quietly
     * reintroduce the problem.
     */
    render(<DataTable columns={columns} rows={rows} getRowId={(row) => row.id} paginated />);
    const pageSize = screen.getByLabelText(/rows per page/i);
    expect(pageSize.tagName).toBe("SELECT");
    expect(borderBox().contains(pageSize)).toBe(true);
  });
});
