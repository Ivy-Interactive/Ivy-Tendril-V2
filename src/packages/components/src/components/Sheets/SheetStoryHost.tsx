import * as React from "react";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { HeaderLayout } from "../ui/panel-layout";

/**
 * The host a sheet story renders inside, so the story shows what the operator actually sees.
 *
 * A sheet is not a component you can judge on its own. `JobDebugSheet` in particular is a sheet
 * *body* — the panel, its header and its close affordance live in `JobsView`, not in the component
 * — so rendering it bare shows a detail table floating on a page, which is not a thing that exists
 * in the app. Worse, it hides the two questions a sheet story should answer: does the content fit
 * the panel's width, and does a long body scroll under a header that stays put.
 *
 * So the story gets a **button that opens it**, exactly as the app does.
 *
 * The chrome below is copied from `JobsView`'s own host rather than approximated. The width ladder
 * (`w-full` → `sm:w-3/4` → `lg:w-1/2` → `xl:w-2/5`) is what decides whether a detail row wraps, and
 * `HeaderLayout` is why the title stays put while a long `Args` blob scrolls under it. Both are the
 * point of looking at all, so a story that used a plain panel would be reassuring about the wrong
 * thing.
 */
export interface SheetStoryHostProps {
  /** The sheet's title, as its header renders it. */
  title: string;
  /** Label for the trigger, named after the action that opens it in the app. */
  triggerLabel: string;
  children: React.ReactNode;
}

export function SheetStoryHost({ title, triggerLabel, children }: SheetStoryHostProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="sheet-story-trigger">
        {triggerLabel}
      </Button>
      <p className="text-xs text-muted-foreground">
        Opens the sheet on the panel the app uses, so the width ladder and the scroll behaviour are
        the real ones.
      </p>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          data-testid="sheet-story-panel"
          className="inset-y-0 flex w-full flex-col overflow-hidden p-0 sm:w-3/4 sm:max-w-none lg:w-1/2 xl:w-2/5"
        >
          <HeaderLayout
            className="min-h-0 flex-1"
            header={
              <SheetHeader className="pr-8">
                <SheetTitle>{title}</SheetTitle>
              </SheetHeader>
            }
          >
            {children}
          </HeaderLayout>
        </SheetContent>
      </Sheet>
    </div>
  );
}
