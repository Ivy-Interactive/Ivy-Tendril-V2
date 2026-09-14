import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export interface DataTableCellEditorProps {
  /** Initial text. The editor is uncontrolled from there — it never writes back to the row. */
  value: string;
  /** Enter, or blur to anything outside the editor. */
  onCommit: (value: string) => void;
  /** Escape. The draft is discarded. */
  onCancel: () => void;
  "aria-label"?: string;
  className?: string;
}

/**
 * The inline editor for one cell. It traps focus for the duration of the edit — Tab and Shift+Tab
 * are swallowed — so the editor cannot be tabbed out of half-committed. Focus is released back to
 * the cell wrapper by `useInlineCellEdit` once the session closes.
 */
const DataTableCellEditor = React.forwardRef<HTMLInputElement, DataTableCellEditorProps>(
  ({ value, onCommit, onCancel, className, "aria-label": ariaLabel }, ref) => {
    const [draft, setDraft] = React.useState(value);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    // Enter and Escape both settle the session; the guard keeps the trailing blur from committing
    // a second time.
    const settledRef = React.useRef(false);

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    React.useLayoutEffect(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    }, []);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        settledRef.current = true;
        onCommit(draft);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Keep a surrounding sheet or dialog from closing on the same Escape.
        event.stopPropagation();
        settledRef.current = true;
        onCancel();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
      }
    };

    return (
      <Input
        ref={inputRef}
        aria-label={ariaLabel}
        className={cn("h-7 w-full min-w-0 px-1 py-0", className)}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (settledRef.current) return;
          settledRef.current = true;
          onCommit(draft);
        }}
      />
    );
  },
);
DataTableCellEditor.displayName = "DataTableCellEditor";

export { DataTableCellEditor };
