import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportClassName?: string;
    viewportStyle?: React.CSSProperties;
    hideScrollbar?: boolean;
    /**
     * Also scroll sideways. Opt-in because it is not only a scrollbar: Radix sets the viewport's
     * `overflow-x` to `hidden` until a horizontal scrollbar is mounted, so without this an area whose
     * content is too wide *clips* it with no way to reach it — not even by wheel or trackpad. Left off
     * by default so a container that only ever grows downwards keeps overflowing content clipped rather
     * than gaining a scrollbar it has no use for.
     */
    horizontal?: boolean;
  }
>(
  (
    {
      className,
      children,
      scrollHideDelay = 0,
      viewportClassName,
      viewportStyle,
      hideScrollbar,
      horizontal,
      ...props
    },
    ref,
  ) => (
    <ScrollAreaPrimitive.Root
      ref={ref}
      className={cn("relative overflow-hidden", className)}
      scrollHideDelay={scrollHideDelay}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        tabIndex={0}
        className={cn(
          "h-full w-full rounded-[inherit] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
          viewportClassName,
        )}
        style={viewportStyle}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar className={hideScrollbar ? "invisible-scrollbar" : undefined} />
      {horizontal && (
        <ScrollBar
          orientation="horizontal"
          className={hideScrollbar ? "invisible-scrollbar" : undefined}
        />
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  ),
);
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none z-20",
      orientation === "vertical" && "h-full w-1.5 p-px",
      orientation === "horizontal" && "h-1.5 flex-col p-px",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
