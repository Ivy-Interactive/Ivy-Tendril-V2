import * as React from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import { Blade } from "./Blade";
import { BladesContext } from "./context";
import { useBladeStack } from "./use-blade-stack";
import type {
  BladeContainerHandle,
  BladeDescriptor,
  BladesContextValue,
  ResolvedBlade,
} from "./types";

export interface BladeContainerProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** The always-present, non-closable blade at depth 1. */
  root: BladeDescriptor;
  /** Extra blades to open on mount (uncontrolled initial state). */
  initialBlades?: BladeDescriptor[];
  onDepthChange?: (depth: number) => void;
  /** px width below which the stack collapses to the deepest blade. Default 768. */
  collapseBreakpoint?: number;
  /** ms; 0 disables enter/exit animation (used by tests). Default 200. */
  transitionDuration?: number;
}

/**
 * A horizontally stacked master → detail → edit navigation container. The stack is owned
 * client-side: blades are pushed and popped through `useBlades()` or the imperative handle, and the
 * newest blade is scrolled into view as the row grows.
 */
export const BladeContainer = React.forwardRef<BladeContainerHandle, BladeContainerProps>(
  function BladeContainer(
    {
      root,
      initialBlades,
      onDepthChange,
      collapseBreakpoint = 768,
      transitionDuration = 200,
      className,
      "aria-label": ariaLabel = "Blades",
      onKeyDown,
      ...props
    },
    ref,
  ) {
    const animate = transitionDuration > 0;
    const {
      blades: stackBlades,
      exiting,
      depth,
      seq,
      push,
      pop,
      popTo,
      popToId,
      replace,
      reset,
      settle,
      invokersRef,
      pendingFocusRef,
    } = useBladeStack({ root, initialBlades, animate });

    const isCollapsed = useIsMobile(collapseBreakpoint);

    const scrollAreaRef = React.useRef<HTMLDivElement>(null);
    const rowRef = React.useRef<HTMLDivElement>(null);
    const sectionsRef = React.useRef(new Map<string, HTMLElement>());
    const sectionRefCallbacks = React.useRef(new Map<string, React.RefCallback<HTMLElement>>());

    // The root blade lives at index 0 of the stack but is owned by the `root` prop, so re-render it
    // from the current prop instead of the descriptor captured when the stack was initialized.
    const blades = React.useMemo<readonly ResolvedBlade[]>(() => {
      const [first, ...rest] = stackBlades;
      return [{ ...root, id: first.id }, ...rest];
    }, [root, stackBlades]);

    const bladesRef = React.useRef(blades);
    bladesRef.current = blades;

    const visibleBlades = isCollapsed ? blades.slice(-1) : blades;

    const getSectionRef = (id: string): React.RefCallback<HTMLElement> => {
      let callback = sectionRefCallbacks.current.get(id);
      if (!callback) {
        callback = (element: HTMLElement | null) => {
          if (element) sectionsRef.current.set(id, element);
          else sectionsRef.current.delete(id);
        };
        sectionRefCallbacks.current.set(id, callback);
      }
      return callback;
    };

    const focusBlade = React.useCallback((id: string) => {
      sectionsRef.current.get(id)?.focus({ preventScroll: true });
    }, []);

    // Focus moves into a pushed blade, and back to the invoking control when one is popped.
    React.useEffect(() => {
      const pending = pendingFocusRef.current;
      if (!pending) return;
      pendingFocusRef.current = null;

      if (pending.kind === "blade") {
        focusBlade(pending.id);
        return;
      }

      const invoker = invokersRef.current.get(pending.id);
      invokersRef.current.delete(pending.id);
      if (invoker && document.contains(invoker)) {
        invoker.focus({ preventScroll: true });
        return;
      }

      const current = bladesRef.current;
      const deepest = current[current.length - 1];
      if (deepest) focusBlade(deepest.id);
    }, [seq, focusBlade, invokersRef, pendingFocusRef]);

    // Scroll the newest blade into view whenever the row grows, reproducing the legacy container.
    React.useEffect(() => {
      const row = rowRef.current;
      const rootElement = scrollAreaRef.current;
      if (!row || !rootElement) return;

      const viewport = rootElement.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
      if (!viewport) return;

      const observer = new ResizeObserver(() => {
        const left = row.scrollWidth - viewport.clientWidth;
        if (left > 0 && typeof viewport.scrollTo === "function") {
          viewport.scrollTo({ left, behavior: "smooth" });
        }
      });
      observer.observe(row);
      return () => observer.disconnect();
    }, []);

    // jsdom fires no animation events, and a blade unmounted mid-animation never fires one either,
    // so every exiting blade also gets a timeout fallback.
    const exitTimersRef = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const handleExited = React.useCallback(
      (id: string) => {
        const timer = exitTimersRef.current.get(id);
        if (timer !== undefined) {
          clearTimeout(timer);
          exitTimersRef.current.delete(id);
        }
        settle(id);
      },
      [settle],
    );

    React.useEffect(() => {
      const timers = exitTimersRef.current;
      for (const blade of exiting) {
        if (timers.has(blade.id)) continue;
        timers.set(
          blade.id,
          setTimeout(() => handleExited(blade.id), transitionDuration),
        );
      }
    }, [exiting, transitionDuration, handleExited]);

    React.useEffect(() => {
      const timers = exitTimersRef.current;
      return () => {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      };
    }, []);

    const previousDepthRef = React.useRef(depth);
    React.useEffect(() => {
      if (previousDepthRef.current === depth) return;
      previousDepthRef.current = depth;
      onDepthChange?.(depth);
    }, [depth, onDepthChange]);

    React.useImperativeHandle(ref, () => ({ push, pop, popTo, popToId, replace, reset }), [
      push,
      pop,
      popTo,
      popToId,
      replace,
      reset,
    ]);

    const contextValue = React.useMemo<BladesContextValue>(
      () => ({ blades, depth, push, pop, popTo, popToId, replace, reset, isCollapsed }),
      [blades, depth, push, pop, popTo, popToId, replace, reset, isCollapsed],
    );

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // At depth 1 the root blade is not closable, so the event is left for an enclosing dialog.
      if (depth <= 1) return;
      event.stopPropagation();
      pop(1);
    };

    const focusBladeAt = (index: number) => {
      const target = visibleBlades[index];
      if (target) focusBlade(target.id);
    };

    return (
      <BladesContext.Provider value={contextValue}>
        <div
          role="group"
          aria-label={ariaLabel}
          className={cn("h-full bg-background", className)}
          onKeyDown={handleKeyDown}
          {...props}
        >
          {/* `horizontal` because this is the axis the stack grows along: pushing a child blade makes
              the row wider than the pane on purpose. Without it Radix left the viewport
              `overflow-x: hidden`, so the blades past the edge could only be reached by the
              `scrollIntoView` below — a blade the user had not just opened was unreachable. */}
          <ScrollArea
            ref={scrollAreaRef}
            type="hover"
            horizontal
            fitWidth
            className="h-full w-full overflow-y-hidden"
            viewportClassName="[&>div]:!h-full"
          >
            {/* `w-max` is what lets a stack of fixed-width blades grow past the container and be
                scrolled through. `min-w-full` is what stops it collapsing *below* the container.
                Neither stops it growing past the container on a `width: "flex"` blade's say-so:
                in a max-content row every item is asked for its max-content width, and a flex
                blade's is its content's widest unwrapped line — so the row, and the blade with it,
                came out as wide as a long sentence, and the scroll-into-view below then scrolled
                the start of every line off the left edge. `bladeWidthVariant`'s `flex` answers that
                question as if the blade were empty (`contain-inline-size`, over a `min-w-80` floor),
                which leaves a flex blade exactly the room the row has to spare. A stack of
                fixed-width blades that is wider than the pane still is, and still scrolls. */}
            <div
              ref={rowRef}
              className={cn("flex h-full", isCollapsed ? "w-full" : "w-max min-w-full")}
            >
              {visibleBlades.map((blade, index) => {
                const stackIndex = isCollapsed ? blades.length - 1 : index;
                return (
                  <Blade
                    key={blade.id}
                    {...blade}
                    ref={getSectionRef(blade.id)}
                    index={stackIndex}
                    isDeepest={stackIndex === blades.length - 1}
                    collapsed={isCollapsed}
                    parentTitle={blades[stackIndex - 1]?.title}
                    animate={animate}
                    transitionDuration={transitionDuration}
                    onRequestClose={() => popTo(stackIndex)}
                    onNavigate={(delta) => focusBladeAt(index + delta)}
                  />
                );
              })}
              {!isCollapsed &&
                exiting.map((blade) => (
                  <Blade
                    key={`exiting-${blade.id}`}
                    {...blade}
                    index={blades.length}
                    exiting
                    animate={animate}
                    transitionDuration={transitionDuration}
                    onExited={handleExited}
                  />
                ))}
            </div>
          </ScrollArea>
        </div>
      </BladesContext.Provider>
    );
  },
);
