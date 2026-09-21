import * as React from "react";

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useScrollShadow as useScrollShadowHook } from "@/hooks/use-scroll-shadow";

/**
 * The two layouts a panel with fixed chrome and scrolling content needs, and the scroll shadow that makes
 * them readable.
 *
 * Ports `Ivy-Framework/src/frontend/src/widgets/layouts/HeaderLayoutWidget.tsx` and
 * `FooterLayoutWidget.tsx` — the framework's own answer to "a title that stays put, a body that scrolls,
 * and buttons that do not scroll away". Every side sheet in the app wants this shape, which is why it is a
 * primitive here rather than a `div` tower in one view.
 *
 * The load-bearing parts, in the framework's own order:
 *
 * - `flex flex-col h-full` on the outside, `flex-none` on the chrome, `flex-1 min-h-0` on the scroller.
 *   **`min-h-0` is the whole trick**: a flex item refuses to shrink below its content without it, so the
 *   scroll container grows to fit the body, the panel grows past its parent, and the "fixed" chrome
 *   scrolls away with the page. It is the same constraint `DataTable`'s `fillHeight` needs, and the same
 *   reason a sticky header silently stops sticking.
 * - **The scroll shadow.** The header takes one once the body has been scrolled *down* from the top; the
 *   footer takes one while content remains *below*. That is how the layout says "there is more", and it
 *   is the part that is easy to leave out — a footer with no shadow over a scrollable body reads as the
 *   end of the content.
 */

/** Which edge a shadow belongs on, i.e. which "there is more" the shadow reports. */
export type ScrollShadowEdge = "top" | "bottom";

/**
 * Whether a scroll container has content past the edge a shadow would sit on.
 *
 * `bottom` (the header's case) is simply "scrolled away from the top". `top` (the footer's case) is "there
 * is more below", which needs the content's *size* as well as the scroll position — so it observes resizes
 * and mutations too, because content that streams in changes the answer without anyone scrolling.
 *
 * A thin adapter over `hooks/use-scroll-shadow.ts` — same measurement, reversed argument order
 * (`edge` first, to match this module's own `HeaderLayout`/`FooterLayout` call sites) and a
 * `shadowed` field name kept for this module's existing callers.
 */
export function useScrollShadow(
  edge: ScrollShadowEdge = "bottom",
  selector = "[data-radix-scroll-area-viewport]",
): { shadowed: boolean; scrollRef: React.RefObject<HTMLDivElement | null> } {
  const { isScrolled, scrollRef } = useScrollShadowHook(selector, edge);
  return { shadowed: isScrolled, scrollRef };
}

export interface HeaderLayoutProps {
  /** The chrome that stays put. A title, a status line, a row of tabs. */
  header: React.ReactNode;
  children: React.ReactNode;
  /** The `border-b` under the header. Defaults to true, as the framework's `showHeaderDivider` does. */
  showDivider?: boolean;
  /**
   * `false` hands scrolling to the content itself — for a body that windows its own rows, where an outer
   * scroll container would fight the virtualizer for the scroll position.
   */
  scrollContent?: boolean;
  className?: string;
  /** Applied to the padded wrapper inside the scroller, so a caller can drop the default `p-4`. */
  contentClassName?: string;
  "data-testid"?: string;
}

/**
 * A fixed header over scrolling content — `HeaderLayoutWidget.tsx`, class for class.
 *
 * The header gains a `shadow-sm` once the body is scrolled, which is the framework's own signal that the
 * content continues above the fold.
 */
const HeaderLayout = React.forwardRef<HTMLDivElement, HeaderLayoutProps>(
  (
    {
      header,
      children,
      showDivider = true,
      scrollContent = true,
      className,
      contentClassName,
      "data-testid": testId,
    },
    ref,
  ) => {
    const { shadowed, scrollRef } = useScrollShadow("bottom");

    return (
      <div
        ref={ref}
        data-slot="header-layout"
        data-testid={testId}
        className={cn("flex h-full w-full flex-col", className)}
      >
        <div
          data-slot="header-layout-header"
          className={cn(
            "w-full flex-none p-2 transition-shadow",
            showDivider && "border-b border-border",
            shadowed && "shadow-sm",
          )}
        >
          {header}
        </div>
        <div ref={scrollRef} className="min-h-0 w-full flex-1 overflow-hidden">
          {scrollContent ? (
            <ScrollArea className="h-full w-full">
              <div className={cn("w-full p-4", contentClassName)}>{children}</div>
            </ScrollArea>
          ) : (
            <div className={cn("h-full w-full", contentClassName)}>{children}</div>
          )}
        </div>
      </div>
    );
  },
);
HeaderLayout.displayName = "HeaderLayout";

export interface FooterLayoutProps {
  /** The chrome that stays put at the bottom. Usually the buttons that finish the panel's job. */
  footer: React.ReactNode;
  children: React.ReactNode;
  /** `false` hands scrolling to the content itself. See {@link HeaderLayoutProps.scrollContent}. */
  scrollContent?: boolean;
  className?: string;
  contentClassName?: string;
  "data-testid"?: string;
}

/**
 * Scrolling content over a sticky footer — `FooterLayoutWidget.tsx`, class for class.
 *
 * The footer carries `shadow-[0_-2px_4px_rgba(0,0,0,0.1)]` **while content remains below**, and loses it
 * at the end. That is the whole point of it: buttons pinned over a body with no shadow look like the end
 * of the content, and a reader stops scrolling.
 */
const FooterLayout = React.forwardRef<HTMLDivElement, FooterLayoutProps>(
  (
    { footer, children, scrollContent = true, className, contentClassName, "data-testid": testId },
    ref,
  ) => {
    const { shadowed: hasMoreBelow, scrollRef } = useScrollShadow("top");

    return (
      <div
        ref={ref}
        data-slot="footer-layout"
        data-testid={testId}
        className={cn("relative flex h-full w-full flex-col", className)}
      >
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-hidden">
          {scrollContent ? (
            <ScrollArea className="h-full">
              <div className={cn("p-4", contentClassName)}>{children}</div>
            </ScrollArea>
          ) : (
            <div className={cn("h-full", contentClassName)}>{children}</div>
          )}
        </div>
        <div
          data-slot="footer-layout-footer"
          className={cn(
            "w-full flex-none bg-background transition-shadow",
            hasMoreBelow && "shadow-[0_-2px_4px_rgba(0,0,0,0.1)]",
          )}
        >
          <div className="border-t border-border" />
          <div className="p-4">{footer}</div>
        </div>
      </div>
    );
  },
);
FooterLayout.displayName = "FooterLayout";

export { FooterLayout, HeaderLayout };
