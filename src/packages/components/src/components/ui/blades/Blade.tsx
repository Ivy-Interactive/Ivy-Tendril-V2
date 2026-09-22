import * as React from "react";
import { ChevronLeft, RotateCw, X } from "lucide-react";

import { buttonVariant } from "@/components/ui/button/variant";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import { bladeHeaderVariant, bladeVariant, bladeWidthVariant } from "./variant";
import { isBladeWidthHint, type ResolvedBlade } from "./types";

export interface BladeProps extends ResolvedBlade {
  /** Zero-based position in the stack. Index 0 is the root blade and is never closable. */
  index: number;
  /** True for the last blade in the stack. */
  isDeepest?: boolean;
  /** True while the stack is collapsed to a single blade on a narrow viewport. */
  collapsed?: boolean;
  /** Title of the blade one level up, used for the collapsed back button's label. */
  parentTitle?: string;
  /** True while the blade is animating out after being popped. */
  exiting?: boolean;
  /** False disables the enter/exit animation classes. */
  animate?: boolean;
  /** ms, written through as an inline `animationDuration` so a custom duration takes effect. */
  transitionDuration?: number;
  className?: string;
  /** Invoked by the close/back button and by a middle-click on the header. */
  onRequestClose?: () => void;
  /** Arrow-key traversal between blade sections; `delta` is -1 for left and 1 for right. */
  onNavigate?: (delta: -1 | 1) => void;
  /** Called once an exiting blade's animation has finished. */
  onExited?: (id: string) => void;
}

/**
 * One panel of a `BladeContainer`. A `<section>` with an accessible name is an implicit `region`
 * landmark, so every blade is reachable as a landmark named after its title.
 */
export const Blade = React.forwardRef<HTMLElement, BladeProps>(function Blade(
  {
    id,
    title,
    titleSlot,
    subtitle,
    width,
    headerAction,
    content,
    onRefresh,
    closable = true,
    index,
    isDeepest = false,
    collapsed = false,
    parentTitle,
    exiting = false,
    animate = true,
    transitionDuration = 200,
    className,
    onRequestClose,
    onNavigate,
    onExited,
  },
  ref,
) {
  const headingId = `${id}-title`;
  const subtitleId = `${id}-subtitle`;

  const namedWidth = isBladeWidthHint(width) ? width : undefined;
  const rawWidth = namedWidth ? undefined : width;

  const style: React.CSSProperties = {};
  if (rawWidth && !collapsed) {
    style.width = rawWidth;
    style.maxWidth = rawWidth;
  }
  if (animate) {
    style.animationDuration = `${transitionDuration}ms`;
  }

  const widthClass = collapsed
    ? undefined
    : rawWidth
      ? "shrink-0"
      : bladeWidthVariant({ width: namedWidth });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Roving-landmark traversal: only when the section itself has focus, so arrow keys keep
    // working normally inside inputs, lists and other content in the blade body.
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onNavigate?.(event.key === "ArrowLeft" ? -1 : 1);
    }
  };

  const handleHeaderMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    // Middle-click closes, matching the legacy blade widget.
    if (event.button !== 1 || index === 0 || !closable) return;
    event.preventDefault();
    onRequestClose?.();
  };

  const showCloseAffordance = index > 0 && closable;

  return (
    <section
      ref={ref}
      tabIndex={exiting ? undefined : -1}
      aria-labelledby={exiting ? undefined : headingId}
      aria-describedby={!exiting && subtitle ? subtitleId : undefined}
      aria-current={isDeepest && !exiting ? "true" : undefined}
      aria-hidden={exiting ? true : undefined}
      inert={exiting ? true : undefined}
      data-blade-index={index}
      data-blade-id={id}
      data-blade-active={isDeepest && !exiting ? "" : undefined}
      data-blade-exiting={exiting ? "" : undefined}
      style={style}
      className={cn(
        bladeVariant({ collapsed }),
        widthClass,
        animate && (exiting ? "blade-animate-exit" : index > 0 && "blade-animate-enter"),
        className,
      )}
      onKeyDown={exiting ? undefined : handleKeyDown}
      onAnimationEnd={exiting ? () => onExited?.(id) : undefined}
    >
      <header
        className={bladeHeaderVariant()}
        data-blade-header=""
        onMouseDown={handleHeaderMouseDown}
        role="presentation"
      >
        <div className="flex min-w-0 items-center gap-2">
          {showCloseAffordance && collapsed && (
            <button
              type="button"
              aria-label={parentTitle ? `Back to ${parentTitle}` : "Back"}
              className={buttonVariant({ variant: "ghost", size: "icon" })}
              onClick={onRequestClose}
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
          <div className="min-w-0">
            {/* `titleSlot` replaces the heading, not the accessible name: the section is still
                labelled by `headingId`, so an editor swapped in here cannot leave the landmark
                unnamed. The heading stays in the tree, visually hidden, for exactly that reason. */}
            {titleSlot ? (
              <>
                <h2 id={headingId} className="sr-only">
                  {title}
                </h2>
                {titleSlot}
              </>
            ) : (
              <h2
                id={headingId}
                className="truncate text-base font-semibold leading-none tracking-tight"
              >
                {title}
              </h2>
            )}
            {subtitle && (
              <p id={subtitleId} className="mt-1 truncate text-sm text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {headerAction}
          {onRefresh && (
            <button
              type="button"
              aria-label={`Refresh ${title}`}
              className={buttonVariant({ variant: "ghost", size: "icon" })}
              onClick={onRefresh}
            >
              <RotateCw className="size-4" />
            </button>
          )}
          {showCloseAffordance && !collapsed && (
            <button
              type="button"
              aria-label={`Close ${title}`}
              className={buttonVariant({ variant: "ghost", size: "icon" })}
              onClick={onRequestClose}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1 bg-background contain-inline-size">
        {/* `fitWidth`: the body is laid out at the blade's width, not at the widest thing in it.
            Without it Radix's shrink-to-fit wrapper took its width from the content, so one table
            with a long path in a `nowrap` column widened every callout and detail row with it,
            past the blade's right edge — clipped there, since this area only scrolls downwards.
            With it that table scrolls inside its own frame and nothing else moves. */}
        <ScrollArea type="hover" fitWidth className="h-full">
          <div className="p-4">{content}</div>
        </ScrollArea>
      </div>
    </section>
  );
});
