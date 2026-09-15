import * as React from "react";

/** Selector for anything inside a row that owns its own keyboard handling. */
const INTERACTIVE_WITHIN_ROW =
  'button, input, select, textarea, a[href], [role="button"], [role="checkbox"], [role="menuitem"], [contenteditable="true"]';

/** Fallback PageUp/PageDown step when the viewport height is not measurable (e.g. under jsdom). */
const FALLBACK_PAGE_STEP = 10;

export interface UseDataTableRowFocusOptions {
  /** Number of data rows currently rendered by the table (the page, under client pagination). */
  count: number;
  /** The table's scroll container. Rows are looked up inside it to be focused. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Brings a row into the window before it is focused. */
  scrollToIndex: (index: number) => void;
  /** Row height used to translate the viewport height into a PageUp/PageDown step. */
  estimatedRowHeight: number;
}

export interface UseDataTableRowFocusResult {
  /**
   * The one row in the tab order. Also the index the virtualizer pins into its rendered range once
   * `pinnedIndex` is set, so a focused row is never unmounted by scrolling.
   */
  activeIndex: number;
  /** `activeIndex` once a row has been focused, `undefined` before that. */
  pinnedIndex: number | undefined;
  /** `0` for the active row, `-1` for the rest, so the whole body is a single tab stop. */
  rowTabIndex: (index: number) => 0 | -1;
  handleRowFocus: (index: number) => void;
  handleKeyDown: React.KeyboardEventHandler<HTMLElement>;
}

/**
 * Roving focus over data rows.
 *
 * Rows are not focusable in an un-virtualized table either, so this is additive behaviour rather
 * than a virtualization detail — but it is what makes focus *retention* across a window boundary
 * observable: the active index is pinned into the virtualizer's rendered range, so scrolling the
 * focused row out of view never unmounts it and never drops `document.activeElement` to `<body>`.
 *
 * A row that is not rendered yet cannot be focused, so `handleKeyDown` records the target index and
 * an effect focuses it on the first commit where it exists.
 */
export function useDataTableRowFocus({
  count,
  containerRef,
  scrollToIndex,
  estimatedRowHeight,
}: UseDataTableRowFocusOptions): UseDataTableRowFocusResult {
  const [activeIndex, setActiveIndex] = React.useState(0);
  // Sticky once set: the pin costs one extra rendered row, and clearing it on blur would race the
  // "focus the row once it mounts" effect below and let the row it is protecting unmount.
  const [engaged, setEngaged] = React.useState(false);
  const pendingFocus = React.useRef<number | null>(null);

  const clampedActive = count > 0 ? Math.min(activeIndex, count - 1) : 0;

  // No dependency list: the target row may take more than one commit to appear, and this must retry
  // until it does.
  React.useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    const row = containerRef.current?.querySelector<HTMLTableRowElement>(
      `tr[data-row-id][data-index="${index}"]`,
    );
    if (!row) return;
    pendingFocus.current = null;
    row.focus();
  });

  const handleRowFocus = React.useCallback((index: number) => {
    setEngaged(true);
    setActiveIndex(index);
  }, []);

  const moveTo = React.useCallback(
    (index: number) => {
      if (count === 0) return;
      const next = Math.min(count - 1, Math.max(0, index));
      setEngaged(true);
      setActiveIndex(next);
      pendingFocus.current = next;
      scrollToIndex(next);
    },
    [count, scrollToIndex],
  );

  const handleKeyDown = React.useCallback<React.KeyboardEventHandler<HTMLElement>>(
    (event) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      // A checkbox, row-action button or inline-edit cell owns its own keys.
      if (target?.closest(INTERACTIVE_WITHIN_ROW)) return;
      if (!target?.closest("tr[data-row-id]")) return;

      const viewport = containerRef.current?.clientHeight ?? 0;
      const pageStep =
        viewport > 0 && estimatedRowHeight > 0
          ? Math.max(1, Math.floor(viewport / estimatedRowHeight))
          : FALLBACK_PAGE_STEP;

      switch (event.key) {
        case "ArrowDown":
          moveTo(clampedActive + 1);
          break;
        case "ArrowUp":
          moveTo(clampedActive - 1);
          break;
        case "Home":
          moveTo(0);
          break;
        case "End":
          moveTo(count - 1);
          break;
        case "PageDown":
          moveTo(clampedActive + pageStep);
          break;
        case "PageUp":
          moveTo(clampedActive - pageStep);
          break;
        default:
          return;
      }
      // Only reached for a handled key: stop the scroll container scrolling under us as well.
      event.preventDefault();
    },
    [clampedActive, containerRef, count, estimatedRowHeight, moveTo],
  );

  const rowTabIndex = React.useCallback(
    (index: number): 0 | -1 => (index === clampedActive ? 0 : -1),
    [clampedActive],
  );

  return {
    activeIndex: clampedActive,
    pinnedIndex: engaged ? clampedActive : undefined,
    rowTabIndex,
    handleRowFocus,
    handleKeyDown,
  };
}
