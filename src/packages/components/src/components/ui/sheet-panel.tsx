import * as React from "react";

import { cn } from "@/lib/utils";
import { HeaderLayout } from "@/components/ui/panel-layout";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * V1's `UxHelper.SheetWidth` (`Ivy-Tendril/src/Ivy.Tendril/Helpers/UxHelper.cs`): full width on
 * mobile, three quarters on tablet, half on desktop, two fifths when wide.
 *
 * `inset-y-0` repeats the `side="right"` variant on purpose, as every ported sheet does, and `p-0`
 * hands the padding to the header and body below, the way the framework's `remove-parent-padding`
 * does for a `HeaderLayout` inside a sheet.
 */
const SHEET_PANEL_CLASS =
  "inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5";

export interface SheetPanelProps {
  /** Whether the sheet is showing. */
  open: boolean;
  /** Called once the reader dismisses it: the close button, Escape, or a click on the overlay. */
  onClose: () => void;
  /** The heading, and the sheet's accessible name. A string is also its tooltip when truncated. */
  title: React.ReactNode;
  /**
   * The line under the heading, and the sheet's accessible description. A string is also its
   * tooltip when truncated; pass an element to give it a different one. Omitted, the sheet has no
   * description at all rather than an empty one.
   */
  description?: React.ReactNode;
  /** Keeps `description` for assistive technology only, for a sheet whose title says it all. */
  hideDescription?: boolean;
  /** Beside the heading, such as the status badge on a verification report. */
  titleAccessory?: React.ReactNode;
  /** Header controls, right-aligned and kept clear of the sheet's own close button. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  /** Merged onto the scrolling body, whose default is the sheet's `px-6 py-4` gutter. */
  bodyClassName?: string;
  "data-testid"?: string;
}

/**
 * A right-hand detail sheet: a header that stays put over a body that scrolls, at V1's
 * `UxHelper.SheetWidth`. This is the chrome the ported sheets used to spell out one by one —
 * `Sheet`, a `SheetContent` carrying the width ladder, `HeaderLayout` and a `SheetHeader` padded
 * clear of the close button — and the copies had started to drift apart: one drew a `border-b` of
 * its own under `HeaderLayout`'s divider, which is a double rule.
 *
 * Owned here, so the parts that are easy to get wrong are right once:
 *
 * - **One rule under the header.** `HeaderLayout` draws the divider; the header adds none.
 * - **The close button.** `SheetContent` pins its X at `right-4 top-4`, so the header keeps `pr-10`
 *   and its actions end before the X, in line with it.
 * - **The body is a plain `overflow-y-auto` box, not `HeaderLayout`'s `ScrollArea`.** Radix's
 *   viewport wraps its content in a `display: table` div that grows to its widest child, so a wide
 *   code block would widen the sheet rather than scroll inside its own `pre`.
 * - **Titles truncate.** A file name or a report name is the heading here, and it can be long.
 */
export function SheetPanel({
  open,
  onClose,
  title,
  description,
  hideDescription = false,
  titleAccessory,
  actions,
  children,
  bodyClassName,
  "data-testid": testId,
}: SheetPanelProps) {
  const hasDescription = description !== undefined && description !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        data-testid={testId}
        className={SHEET_PANEL_CLASS}
        // Radix warns about a dialog with no description unless it is told there is none on purpose.
        {...(hasDescription ? {} : { "aria-describedby": undefined })}
      >
        <HeaderLayout
          className="min-h-0 flex-1"
          scrollContent={false}
          contentClassName="flex h-full min-h-0 flex-col"
          header={
            /* `pl-4` over the layout's own `p-2` lines the title up with the body's `px-6`. */
            <SheetHeader
              data-slot="sheet-panel-header"
              className="flex flex-row items-start justify-between gap-3 py-2 pl-4 pr-10 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-h-7 min-w-0 items-center gap-3">
                  <SheetTitle
                    className="min-w-0 truncate"
                    title={typeof title === "string" ? title : undefined}
                  >
                    {title}
                  </SheetTitle>
                  {titleAccessory}
                </div>
                {hasDescription && (
                  <SheetDescription
                    className={hideDescription ? "sr-only" : "truncate text-xs"}
                    title={typeof description === "string" ? description : undefined}
                  >
                    {description}
                  </SheetDescription>
                )}
              </div>
              {actions && (
                /* `min-h-7` is the title's line box, so a text action centres on the title too. */
                <div className="flex min-h-7 shrink-0 items-center gap-1">{actions}</div>
              )}
            </SheetHeader>
          }
        >
          <div
            data-slot="sheet-panel-body"
            className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-4", bodyClassName)}
          >
            {children}
          </div>
        </HeaderLayout>
      </SheetContent>
    </Sheet>
  );
}
