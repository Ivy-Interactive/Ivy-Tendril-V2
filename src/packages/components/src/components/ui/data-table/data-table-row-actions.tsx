import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DataTableRowAction, DataTableRowActionEvent } from "./types";
import { getRenderableActions } from "./utils";

export interface DataTableRowActionsProps<TRow> {
  actions: DataTableRowAction<TRow>[];
  row: TRow;
  /** `getRowId(row, index)` — passed straight through to `onRowAction`. */
  rowId: string;
  onRowAction?: (event: DataTableRowActionEvent<TRow>) => void;
  className?: string;
}

function withTooltip(trigger: React.ReactElement, tooltip: string | undefined): React.ReactElement {
  if (!tooltip) return trigger;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The trailing actions cell for one row. Resolution mirrors the legacy `ActionRenderer`: separator
 * entries are skipped, an action with children becomes a dropdown, and one without becomes a plain
 * button. Every handler stops propagation first so a row action never triggers row activation or
 * selection.
 */
function DataTableRowActionsInner<TRow>(
  { actions, row, rowId, onRowAction, className }: DataTableRowActionsProps<TRow>,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const renderable = getRenderableActions(actions);
  if (renderable.length === 0) {
    return null;
  }

  const invoke = (action: DataTableRowAction<TRow>) => {
    onRowAction?.({ id: rowId, tag: action.tag, row });
  };

  const hasTooltip = renderable.some(
    (action) => action.tooltip || getRenderableActions(action.children).some((c) => c.tooltip),
  );

  const content = (
    <div ref={ref} className={cn("flex items-center justify-end gap-1", className)}>
      {renderable.map((action) => {
        const children = getRenderableActions(action.children);
        const destructive = action.variant === "destructive";

        if (children.length > 0) {
          return (
            <DropdownMenu key={action.tag}>
              {withTooltip(
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size={action.icon ? "icon" : "sm"}
                    aria-label={action.label}
                    disabled={action.disabled}
                    className={cn(destructive && "text-destructive")}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {action.icon ?? action.label}
                  </Button>
                </DropdownMenuTrigger>,
                action.tooltip,
              )}
              <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                {children.map((child) => (
                  <DropdownMenuItem
                    key={child.tag}
                    disabled={child.disabled}
                    className={cn(child.variant === "destructive" && "text-destructive")}
                    onClick={(event) => {
                      event.stopPropagation();
                      invoke(child);
                    }}
                  >
                    {child.icon}
                    {child.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }

        return (
          <React.Fragment key={action.tag}>
            {withTooltip(
              <Button
                type="button"
                variant="ghost"
                size={action.icon ? "icon" : "sm"}
                aria-label={action.label}
                disabled={action.disabled}
                className={cn(destructive && "text-destructive")}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  invoke(action);
                }}
              >
                {action.icon ?? action.label}
              </Button>,
              action.tooltip,
            )}
          </React.Fragment>
        );
      })}
    </div>
  );

  return hasTooltip ? <TooltipProvider>{content}</TooltipProvider> : content;
}

/** `forwardRef` erases the generic, so the row type is restored by the callable cast below. */
export interface DataTableRowActionsComponent {
  <TRow>(
    props: DataTableRowActionsProps<TRow> & { ref?: React.Ref<HTMLDivElement> },
  ): React.ReactElement | null;
  displayName?: string;
}

const DataTableRowActions = React.forwardRef(
  DataTableRowActionsInner,
) as DataTableRowActionsComponent;
DataTableRowActions.displayName = "DataTableRowActions";

export { DataTableRowActions };
