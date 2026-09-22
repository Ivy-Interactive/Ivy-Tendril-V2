import * as React from "react";

export interface UseColumnReorderOptions {
  enabled: boolean;
  /** Visible column names in their current order — the drag operates on positions in this list. */
  orderedNames: string[];
  /** Commits a move, by position among the visible columns. */
  moveColumn: (from: number, to: number) => void;
}

export interface UseColumnReorderResult {
  /** The column currently being dragged, or `null`. */
  draggingName: string | null;
  /** The column the drop would land on, or `null`. */
  dropTargetName: string | null;
  /** Begins a drag from a column's grip. */
  beginDrag: (name: string) => void;
  /** Called as the pointer passes over a header while dragging. */
  dragOver: (name: string) => void;
  /** Ends the drag, committing the move if it landed somewhere new. */
  endDrag: () => void;
  /** Moves a column one position left or right — the grip's keyboard equivalent. */
  nudge: (name: string, direction: -1 | 1) => void;
}

/**
 * Column reordering by dragging a header's grip.
 *
 * The move itself is `useColumnLayout`'s (ported from
 * `widgets/dataTables/dataTableContext/hooks/useColumnManagement.ts:152-189`); this is only the
 * gesture around it.
 *
 * Mouse tracking rather than HTML5 drag-and-drop. A `draggable` `<th>` would hand the browser a drag
 * image of the whole header cell and a `dragover`/`drop` protocol whose `dataTransfer` is
 * inaccessible during the drag on some browsers — and glide, which V1 uses, tracks the pointer
 * itself for exactly this (`data-grid-dnd.ts`). Tracking `mouseenter` on each header also gives the
 * live drop indicator for free.
 *
 * The drag ends on a window `mouseup`, so releasing outside the table still ends it rather than
 * leaving the table stuck in a drag nobody can see.
 */
export function useColumnReorder({
  enabled,
  orderedNames,
  moveColumn,
}: UseColumnReorderOptions): UseColumnReorderResult {
  const [draggingName, setDraggingName] = React.useState<string | null>(null);
  const [dropTargetName, setDropTargetName] = React.useState<string | null>(null);

  const draggingRef = React.useRef<string | null>(null);
  const dropTargetRef = React.useRef<string | null>(null);
  draggingRef.current = draggingName;
  dropTargetRef.current = dropTargetName;

  const namesRef = React.useRef(orderedNames);
  namesRef.current = orderedNames;

  const commit = React.useCallback(() => {
    const from = draggingRef.current;
    const to = dropTargetRef.current;
    draggingRef.current = null;
    dropTargetRef.current = null;
    setDraggingName(null);
    setDropTargetName(null);
    if (!from || !to || from === to) return;
    const names = namesRef.current;
    moveColumn(names.indexOf(from), names.indexOf(to));
  }, [moveColumn]);

  React.useEffect(() => {
    if (!enabled || !draggingName) return;
    const onMouseUp = () => commit();
    // Escape abandons the drag where it stands, which is the convention every other drag in the app
    // follows and the only way out once a reader has decided they did not mean it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      draggingRef.current = null;
      dropTargetRef.current = null;
      setDraggingName(null);
      setDropTargetName(null);
    };
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commit, draggingName, enabled]);

  const beginDrag = React.useCallback(
    (name: string) => {
      if (!enabled) return;
      setDraggingName(name);
      setDropTargetName(name);
    },
    [enabled],
  );

  const dragOver = React.useCallback(
    (name: string) => {
      if (!enabled || !draggingRef.current) return;
      setDropTargetName(name);
    },
    [enabled],
  );

  const nudge = React.useCallback(
    (name: string, direction: -1 | 1) => {
      if (!enabled) return;
      const names = namesRef.current;
      const from = names.indexOf(name);
      if (from === -1) return;
      const to = from + direction;
      if (to < 0 || to >= names.length) return;
      moveColumn(from, to);
    },
    [enabled, moveColumn],
  );

  return { draggingName, dropTargetName, beginDrag, dragOver, endDrag: commit, nudge };
}
