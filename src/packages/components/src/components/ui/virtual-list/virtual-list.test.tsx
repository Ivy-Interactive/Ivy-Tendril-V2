import "@testing-library/jest-dom/vitest";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { VirtualList } from "./virtual-list";

/** Measured height of every item. `estimateSize` matches it so the total size is exact. */
const ITEM_HEIGHT = 40;
const VIEWPORT_HEIGHT = 400;
const ITEM_COUNT = 1000;
const TOTAL_HEIGHT = ITEM_COUNT * ITEM_HEIGHT;
const TEST_ID = "virtual-list";

interface Entry {
  id: string;
  label: string;
}

const entries: Entry[] = Array.from({ length: ITEM_COUNT }, (_, index) => ({
  id: `e${index + 1}`,
  // Zero-padded so "Entry 1" cannot substring-match "Entry 1000".
  label: `Entry ${String(index + 1).padStart(4, "0")}`,
}));

const itemKey = (item: Entry): string => item.id;

function renderList(items: Entry[] = entries) {
  return render(
    <VirtualList
      items={items}
      getItemKey={itemKey}
      estimateSize={ITEM_HEIGHT}
      data-testid={TEST_ID}
      aria-label="Entries"
      renderItem={(item) => <div>{item.label}</div>}
    />,
  );
}

function scroller(): HTMLElement {
  return screen.getByTestId(TEST_ID);
}

/** The inner element whose height stands in for every unrendered item. */
function spacer(): HTMLElement {
  const node = scroller().firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error("No spacer rendered");
  return node;
}

function renderedItems(): HTMLElement[] {
  return Array.from(spacer().querySelectorAll<HTMLElement>("[data-index]"));
}

/** jsdom does no layout, so a scroll has to be driven by hand. */
function scrollTo(offset: number) {
  const element = scroller();
  act(() => {
    element.scrollTop = offset;
    element.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  // virtual-core measures with `offsetHeight`, which jsdom always reports as 0 — without this the
  // virtualizer renders nothing at all.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-index")) return ITEM_HEIGHT;
      if (this.dataset.testid === TEST_ID) return VIEWPORT_HEIGHT;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testid === TEST_ID ? VIEWPORT_HEIGHT : 0;
    },
  });
});

afterEach(() => {
  // @ts-expect-error - restoring jsdom's own (non-configurable-by-default) getters
  delete HTMLElement.prototype.offsetHeight;
  // @ts-expect-error - as above
  delete HTMLElement.prototype.clientHeight;
});

describe("VirtualList", () => {
  it("mounts a bounded window while reporting the full scroll height", () => {
    renderList();

    const rendered = renderedItems();
    expect(rendered.length).toBeGreaterThan(0);
    // Not an exact count: overscan is tunable, a blown-open window is not.
    expect(rendered.length).toBeLessThan(60);
    expect(spacer().style.height).toBe(`${TOTAL_HEIGHT}px`);
    expect(screen.getByText("Entry 0001")).toBeInTheDocument();
    expect(screen.queryByText("Entry 1000")).not.toBeInTheDocument();
  });

  it("renders the last item at the end of the range and the first back at the top", () => {
    renderList();

    scrollTo(TOTAL_HEIGHT - VIEWPORT_HEIGHT);
    expect(screen.getByText("Entry 1000")).toBeInTheDocument();
    expect(screen.queryByText("Entry 0001")).not.toBeInTheDocument();

    scrollTo(0);
    expect(screen.getByText("Entry 0001")).toBeInTheDocument();
    expect(screen.queryByText("Entry 1000")).not.toBeInTheDocument();
  });

  it("tags every rendered item with the data-index measureElement reads back", () => {
    renderList();

    const indexes = renderedItems().map((node) => Number(node.dataset.index));
    expect(indexes).toEqual(indexes.map((_, position) => indexes[0] + position));
    expect(indexes.every((index) => Number.isInteger(index))).toBe(true);
  });

  it("keys items by getItemKey, so mutating one item does not remount its neighbours", () => {
    const { rerender } = renderList();

    const before = renderedItems();
    const neighbours = [before[0], before[2]];

    const mutated = entries.slice();
    mutated[1] = { ...mutated[1], label: "Entry 0002 (edited)" };
    act(() => {
      rerender(
        <VirtualList
          items={mutated}
          getItemKey={itemKey}
          estimateSize={ITEM_HEIGHT}
          data-testid={TEST_ID}
          aria-label="Entries"
          renderItem={(item) => <div>{item.label}</div>}
        />,
      );
    });

    expect(screen.getByText("Entry 0002 (edited)")).toBeInTheDocument();
    // Same DOM nodes, not replacements: the key is the item id, not the array position.
    const after = renderedItems();
    expect(after[0]).toBe(neighbours[0]);
    expect(after[2]).toBe(neighbours[1]);
  });
});
