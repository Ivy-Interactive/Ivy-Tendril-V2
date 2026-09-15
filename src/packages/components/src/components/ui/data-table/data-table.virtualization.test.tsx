import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DataTable, type DataTableColumn, type DataTableProps } from "./index";

/**
 * Measured height of every data row. `estimateRowHeight` is passed to match it, so the total size is
 * exactly `ROW_COUNT × ROW_HEIGHT` whether or not a given row has been measured yet.
 */
const ROW_HEIGHT = 40;
/** Height of the scroll viewport, i.e. ten rows plus the overscan on either side. */
const VIEWPORT_HEIGHT = 400;
const ROW_COUNT = 1000;
const TOTAL_HEIGHT = ROW_COUNT * ROW_HEIGHT;

interface Widget {
  id: string;
  name: string;
  score: number;
}

const rows: Widget[] = Array.from({ length: ROW_COUNT }, (_, index) => ({
  id: `w${index + 1}`,
  // Zero-padded so "Widget 1" cannot substring-match "Widget 1000".
  name: `Widget ${String(index + 1).padStart(4, "0")}`,
  score: ROW_COUNT - index,
}));

const columns: DataTableColumn<Widget>[] = [
  { name: "name", header: "Name" },
  { name: "score", header: "Score", align: "Right" },
];

const rowId = (row: Widget): string => row.id;

/** Renders `rows` windowed, with the estimate pinned to the height the mocks report. */
function renderVirtualized(props: Partial<DataTableProps<Widget>> = {}) {
  return render(
    <DataTable
      columns={columns}
      rows={rows}
      getRowId={rowId}
      paginated={false}
      virtualized
      estimateRowHeight={ROW_HEIGHT}
      {...props}
    />,
  );
}

/**
 * `Table`'s `overflow-auto` wrapper — the element the virtualizer observes and scrolls. Looked up by
 * that class because it is what the mocked `offsetHeight` keys the viewport height off.
 */
function scrollerFor(container: HTMLElement): HTMLDivElement {
  const scroller = container.querySelector<HTMLDivElement>(".overflow-auto");
  if (!scroller) throw new Error("No scroll container rendered");
  return scroller;
}

function renderedRows(container: HTMLElement): HTMLTableRowElement[] {
  return Array.from(container.querySelectorAll<HTMLTableRowElement>("tr[data-row-id]"));
}

function spacerHeights(container: HTMLElement): number[] {
  return Array.from(
    container.querySelectorAll<HTMLTableCellElement>('tr[aria-hidden="true"] > td'),
  ).map((cell) => Number.parseFloat(cell.style.height) || 0);
}

/** jsdom does no layout, so a scroll has to be driven by hand — see the plan's harness notes. */
function scrollTo(scroller: HTMLElement, offset: number) {
  act(() => {
    scroller.scrollTop = offset;
    scroller.dispatchEvent(new Event("scroll"));
  });
}

// The descriptor rather than the method itself: reading `HTMLElement.prototype.scrollTo` as a value
// is an unbound-method reference, and restoring the descriptor also preserves its writability.
let originalScrollTo: PropertyDescriptor | undefined;

beforeEach(() => {
  // virtual-core measures with `offsetHeight` (`getRect` and the default `measureElement` both read
  // it) and jsdom always reports 0, which would leave the virtualizer rendering nothing.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-index")) return ROW_HEIGHT;
      if (this.classList.contains("overflow-auto")) return VIEWPORT_HEIGHT;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("overflow-auto") ? VIEWPORT_HEIGHT : 0;
    },
  });
  // jsdom has no `scrollTo` at all, so `elementScroll`'s optional call would silently do nothing and
  // `scrollToIndex` (used by keyboard navigation) would never move the window.
  originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: function scrollToStub(
      this: HTMLElement,
      options?: number | ScrollToOptions,
      y?: number,
    ) {
      const top = typeof options === "number" ? y : options?.top;
      if (typeof top !== "number") return;
      this.scrollTop = top;
      this.dispatchEvent(new Event("scroll"));
    },
  });
});

afterEach(() => {
  // @ts-expect-error - restoring jsdom's own (non-configurable-by-default) getters
  delete HTMLElement.prototype.offsetHeight;
  // @ts-expect-error - as above
  delete HTMLElement.prototype.clientHeight;
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  } else {
    // @ts-expect-error - jsdom never defined it
    delete HTMLElement.prototype.scrollTo;
  }
});

describe("DataTable virtualization", () => {
  it("renders a bounded window instead of all 1,000 rows", () => {
    const { container } = renderVirtualized();

    const rendered = renderedRows(container);
    expect(rendered.length).toBeGreaterThan(0);
    // Not an exact count: overscan is tunable, a blown-open window is not.
    expect(rendered.length).toBeLessThan(60);
    expect(screen.getByText("Widget 0001")).toBeInTheDocument();
    expect(screen.queryByText("Widget 1000")).not.toBeInTheDocument();
  });

  it("reports the full scroll height through its spacer rows", () => {
    const { container } = renderVirtualized();

    const spacers = spacerHeights(container);
    const padSum = spacers.reduce((sum, height) => sum + height, 0);
    // One trailing spacer only: at the top there is nothing to pad before the first row, and with
    // nothing pinned the window is contiguous so there are no gap spacers either.
    expect(spacers).toHaveLength(1);
    expect(padSum + renderedRows(container).length * ROW_HEIGHT).toBe(TOTAL_HEIGHT);
  });

  it("renders the last row and drops the first when scrolled to the end", () => {
    const { container } = renderVirtualized();

    scrollTo(scrollerFor(container), TOTAL_HEIGHT - VIEWPORT_HEIGHT);

    expect(screen.getByText("Widget 1000")).toBeInTheDocument();
    expect(screen.queryByText("Widget 0001")).not.toBeInTheDocument();
  });

  it("keeps the sticky header mounted across a scroll", () => {
    const { container } = renderVirtualized();

    const table = container.querySelector("table");
    expect(table).toHaveClass("ivy-data-table");
    expect(table).toHaveClass("ivy-data-table-virtualized");

    scrollTo(scrollerFor(container), TOTAL_HEIGHT - VIEWPORT_HEIGHT);

    // The header is outside the windowed range by construction: only `<tbody>` rows are windowed.
    expect(container.querySelector("thead")).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual([
      "Name",
      "Score",
    ]);
  });

  it("reports the true row count and absolute row indexes", () => {
    const { container } = renderVirtualized();

    expect(container.querySelector("table")).toHaveAttribute("aria-rowcount", String(ROW_COUNT));
    expect(renderedRows(container).length).toBeLessThan(ROW_COUNT);
    expect(renderedRows(container)[0]).toHaveAttribute("aria-rowindex", "1");

    scrollTo(scrollerFor(container), 499 * ROW_HEIGHT);

    // Mid-list rows report their absolute position, not their offset within the window.
    const row500 = container.querySelector('tr[data-row-id="w500"]');
    expect(row500).toBeInTheDocument();
    expect(row500).toHaveAttribute("aria-rowindex", "500");
    expect(container.querySelector("table")).toHaveAttribute("aria-rowcount", String(ROW_COUNT));
  });

  it("moves focus across a window boundary with ArrowDown", () => {
    const { container } = renderVirtualized();

    const firstRow = renderedRows(container)[0];
    act(() => {
      firstRow.focus();
    });
    expect(document.activeElement).toBe(firstRow);

    // The 400px viewport holds ten rows, so this crosses the initial window twice over.
    for (let press = 0; press < 20; press++) {
      act(() => {
        fireEvent.keyDown(document.activeElement ?? container, { key: "ArrowDown" });
      });
    }

    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("TR");
    expect(active.getAttribute("data-row-id")).toBe("w21");
    expect(active.isConnected).toBe(true);
  });

  it("keeps the focused row mounted when it scrolls out of view", () => {
    const { container } = renderVirtualized();

    const row5 = container.querySelector<HTMLTableRowElement>('tr[data-row-id="w5"]');
    expect(row5).toBeInTheDocument();
    act(() => {
      row5?.focus();
    });

    scrollTo(scrollerFor(container), TOTAL_HEIGHT - VIEWPORT_HEIGHT);

    // Pinned by the rangeExtractor: without it the row would unmount and activeElement would fall
    // back to <body>.
    expect(container.querySelector('tr[data-row-id="w5"]')).toBeInTheDocument();
    expect(document.activeElement).toBe(row5);
    expect(screen.getByText("Widget 1000")).toBeInTheDocument();
  });

  it("preserves document order, so a selection can span two rows", () => {
    const { container } = renderVirtualized();

    const [first, second] = renderedRows(container);
    const start = first.querySelectorAll("td")[0].firstChild;
    const end = second.querySelectorAll("td")[0].firstChild;
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();

    const range = document.createRange();
    range.setStart(start as Node, 0);
    range.setEnd(end as Node, (end as Text).textContent?.length ?? 0);

    const text = range.toString();
    expect(text).toContain("Widget 0001");
    expect(text).toContain("Widget 0002");
  });

  it("re-sorts while windowed, from the top and with honest spacers", () => {
    const { container } = renderVirtualized();

    scrollTo(scrollerFor(container), 400 * ROW_HEIGHT);
    expect(screen.queryByText("Widget 0001")).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Sort by Score ascending" }));
    });

    // Score descends with the row index, so ascending order puts the last row first.
    expect(screen.getByText("Widget 1000")).toBeInTheDocument();
    expect(renderedRows(container)[0]).toHaveAttribute("data-row-id", "w1000");
    expect(container.querySelector("table")).toHaveAttribute("aria-rowcount", String(ROW_COUNT));

    const padSum = spacerHeights(container).reduce((sum, height) => sum + height, 0);
    expect(padSum + renderedRows(container).length * ROW_HEIGHT).toBe(TOTAL_HEIGHT);
  });
});

describe("DataTable without virtualization", () => {
  it("renders every row, with no spacers and no bounded viewport", () => {
    const twelve = rows.slice(0, 12);
    const { container } = render(
      <DataTable columns={columns} rows={twelve} getRowId={rowId} paginated={false} />,
    );

    // 12 rows is under the "auto" threshold of 50, so the default props must change nothing.
    expect(renderedRows(container)).toHaveLength(12);
    expect(container.querySelectorAll('tr[aria-hidden="true"]')).toHaveLength(0);
    expect(container.querySelector("table")).not.toHaveClass("ivy-data-table-virtualized");
    expect(scrollerFor(container).style.maxHeight).toBe("");
  });
});
