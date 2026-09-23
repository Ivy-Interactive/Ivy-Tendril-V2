import * as React from "react";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n/uiCommon";
import {
  clampColumnWidth,
  DATA_TABLE_DEFAULT_COLUMN_WIDTH,
  DATA_TABLE_MAX_COLUMN_WIDTH,
  DATA_TABLE_MIN_COLUMN_WIDTH,
  DATA_TABLE_RESIZE_SHIFT_STEP,
  DATA_TABLE_RESIZE_STEP,
} from "./use-column-layout";

export interface DataTableColumnResizerProps {
  /**
   * `id` of the header's own label text.
   *
   * The column name is the handle's accessible *description*, never part of its name — see the note
   * in `data-table-column-header.tsx`. One of these ships on every header of every table, and a name
   * containing the column label would make "the Timer button" ambiguous between the sort button, the
   * reorder grip and this.
   */
  describedBy?: string;
  /**
   * The column's width in px when it is known — a live resize override, or a `column.width` that
   * parsed to pixels.
   *
   * `undefined` means "whatever the browser laid this column out at", which is the usual case: most
   * columns declare no width at all. The handle then measures its own `<th>` at the moment a drag or
   * a key press starts, which is the only moment the answer is both needed and available.
   */
  width?: number;
  onResize: (width: number) => void;
  /** Double-click: drops the override and returns the column to its declared width. */
  onReset: () => void;
}

/**
 * The drag handle on a column's trailing edge.
 *
 * `role="separator"` with `aria-valuenow`/`min`/`max` and Arrow/Home/End keys, which is the contract
 * this repo's existing `use-resizable-sidebar.ts` already implements for the sidebar's splitter —
 * same role, same keys, same 10px / 50px steps. Matching it rather than inventing a second resize
 * idiom is the point: an operator who has learned one of them has learned both. (The hook itself is
 * not reusable here — it resizes from `clientX` against the *window*, whereas a column resizes
 * against the `<th>`'s own left edge, and its `storageKey` persistence is exactly what V1 does not
 * do.)
 *
 * Keyboard equivalence is not optional. A drag handle with no key bindings is a mouse-only
 * affordance, and every one of these ships on every table in the app.
 *
 * Pointer events with pointer capture, not mouse events: capture is what keeps the drag alive when
 * the cursor outruns the 6px-wide handle, which at any real drag speed it does immediately.
 */
export function DataTableColumnResizer({
  describedBy,
  width,
  onResize,
  onReset,
}: DataTableColumnResizerProps) {
  const { t } = useTranslation("uiCommon");
  const handleRef = React.useRef<HTMLDivElement | null>(null);

  /**
   * The width a gesture starts from: the known width, else the rendered `<th>`'s.
   *
   * Measuring lazily rather than on mount is deliberate. A `<th>`'s width is not settled until
   * layout has run and it changes with the container, so a measurement taken at mount and held would
   * be stale by the first resize; and under `table-layout: auto` it changes again as content
   * arrives. `DATA_TABLE_DEFAULT_COLUMN_WIDTH` is the last resort for an environment that measures
   * nothing at all (jsdom reports 0 for every box) — V1's own fallback, `columnSizing.ts:9-10`.
   */
  const startingWidth = React.useCallback(() => {
    if (width !== undefined) return width;
    const measured = handleRef.current?.closest("th")?.getBoundingClientRect().width ?? 0;
    return measured > 0 ? measured : DATA_TABLE_DEFAULT_COLUMN_WIDTH;
  }, [width]);
  // The drag's frame of reference, captured on press: the pointer x at which the column had exactly
  // `width`. Deriving each move from this rather than from the previous move means a drag cannot
  // accumulate rounding error, and a clamped drag re-expands from the right place instead of
  // sticking at the clamp.
  const originRef = React.useRef<{ x: number; width: number } | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // The header's sort button is behind this handle; a press that starts a resize is not a request
    // to sort, and `stopPropagation` is what keeps the two apart.
    event.preventDefault();
    event.stopPropagation();
    originRef.current = { x: event.clientX, width: startingWidth() };
    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Not every environment implements capture (jsdom does not). The drag still tracks; it just
      // ends when the pointer leaves the handle.
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = originRef.current;
    if (!origin) return;
    event.preventDefault();
    onResize(clampColumnWidth(origin.width + (event.clientX - origin.x)));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!originRef.current) return;
    originRef.current = null;
    setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // See above.
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? DATA_TABLE_RESIZE_SHIFT_STEP : DATA_TABLE_RESIZE_STEP;
    const current = startingWidth();
    switch (event.key) {
      case "ArrowLeft":
        onResize(clampColumnWidth(current - step));
        break;
      case "ArrowRight":
        onResize(clampColumnWidth(current + step));
        break;
      case "Home":
        onResize(DATA_TABLE_MIN_COLUMN_WIDTH);
        break;
      case "End":
        onResize(DATA_TABLE_MAX_COLUMN_WIDTH);
        break;
      // The keyboard's equivalent of the handle's double-click, so "put it back" is reachable
      // without a mouse.
      case "Enter":
      case "Backspace":
      case "Delete":
        onReset();
        break;
      default:
        return;
    }
    event.preventDefault();
    // Arrow keys move row focus (`use-data-table-row-focus.ts`) and scroll the viewport; neither is
    // what this key press meant.
    event.stopPropagation();
  };

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("dataTable.columnHeader.resize")}
      aria-describedby={describedBy}
      /* Only reported once the width is actually known. An `aria-valuenow` of 0 on a column that
         merely has not been resized yet would be a lie a screen reader reads out. */
      aria-valuenow={width !== undefined ? Math.round(width) : undefined}
      aria-valuemin={DATA_TABLE_MIN_COLUMN_WIDTH}
      aria-valuemax={DATA_TABLE_MAX_COLUMN_WIDTH}
      tabIndex={0}
      data-slot="data-table-column-resizer"
      data-dragging={isDragging ? "true" : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset();
      }}
      onKeyDown={handleKeyDown}
      // A press on the handle must not also start a cell range selection or a header drag.
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      className={cn(
        // Overhanging the cell's right padding by design: the grab target spans the border rather
        // than sitting inside one column, which is where a reader aims. `touch-none` stops a touch
        // drag scrolling the viewport instead of resizing.
        "absolute inset-y-0 -right-[3px] z-10 w-[6px] cursor-col-resize touch-none select-none",
        // The visible line is a child pseudo-element so the grab target can be wider than the mark.
        // Transparent at rest: the header cell already paints a `border-border` divider in exactly
        // this place (see `data-table.css`), so a second line here would double it. Pointing at the
        // handle replaces that divider with the brighter one below, which is why the highlight has to
        // sit *over* the cell's own — hence the `z-10` on the handle above.
        "after:absolute after:inset-y-1 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent",
        "hover:after:bg-foreground/40 focus-visible:after:bg-ring data-[dragging=true]:after:bg-ring",
        "focus-visible:outline-none",
      )}
    />
  );
}
