import * as React from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDensity } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import {
  stackedProgressDotSize,
  stackedProgressLabelVariant,
  stackedProgressSegmentColor,
  type StackedProgressColor,
} from "./stacked-progress-variant";

export interface StackedProgressSegment {
  value: number;
  label?: string;
  color?: StackedProgressColor;
  indeterminate?: boolean;
  className?: string;
}

export interface StackedProgressProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "aria-label" | "onSelect"
> {
  segments: StackedProgressSegment[];
  /** Defaults to the sum of segment values. Pass explicitly to leave a remainder gap. */
  total?: number;
  barHeight?: number;
  rounded?: boolean;
  showLabels?: boolean;
  selected?: number;
  onSelect?: (index: number) => void;
  density?: Densities;
  /** Required: names the `role="group"` wrapping the per-segment progressbars. */
  "aria-label": string;
}

const SELECTED_RING = "ring-2 ring-foreground ring-offset-1";

/**
 * Multi-segment progress bar. A single `progressbar` cannot express per-segment values, so the
 * track is a labelled `role="group"` of `role="progressbar"` children.
 */
const StackedProgress = React.forwardRef<HTMLDivElement, StackedProgressProps>(
  (
    {
      className,
      segments,
      total: totalProp,
      barHeight = 8,
      rounded = true,
      showLabels = false,
      selected,
      onSelect,
      density,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    const contextDensity = useDensity();
    const effectiveDensity = density ?? contextDensity;
    const total = totalProp ?? segments.reduce((sum, segment) => sum + segment.value, 0);

    const trackStyle: React.CSSProperties = {
      display: "flex",
      height: `${barHeight}px`,
      borderRadius: rounded ? `${barHeight / 2}px` : undefined,
      overflow: "hidden",
      minWidth: 0,
      maxWidth: "100%",
    };

    const renderSegment = (segment: StackedProgressSegment, index: number) => {
      const label = segment.label ?? `Segment ${index + 1}`;
      const percentage = total > 0 ? (segment.value / total) * 100 : 0;
      // An indeterminate segment with no value still fills the remaining track.
      const flex = segment.indeterminate && segment.value === 0 ? "1 1 0%" : `${percentage} 1 0%`;
      const isSelected = selected === index;

      // No `aria-valuenow` *is* the ARIA indeterminate state; `0` or `null` would be wrong.
      const progressAria = segment.indeterminate
        ? { "aria-valuetext": "Indeterminate" }
        : {
            "aria-valuenow": segment.value,
            "aria-valuetext": `${label}: ${segment.value} of ${total}`,
          };

      const visualClass = cn(
        "h-full min-w-0 transition-all duration-300 ease-in-out",
        stackedProgressSegmentColor[segment.color ?? "primary"],
        segment.indeterminate && "animate-indeterminate",
        segment.className,
      );

      const key = `${segment.label ?? ""}-${segment.color ?? ""}-${index}`;

      const element = onSelect ? (
        <button
          key={key}
          type="button"
          aria-label={`Select ${label}`}
          onClick={() => onSelect(index)}
          className={cn(
            "min-w-0 cursor-pointer p-0 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isSelected && SELECTED_RING,
          )}
          style={{ flex, height: "100%" }}
        >
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={total}
            {...progressAria}
            className={visualClass}
          />
        </button>
      ) : (
        <div
          key={key}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={total}
          {...progressAria}
          className={cn(visualClass, isSelected && SELECTED_RING)}
          style={{ flex }}
        />
      );

      if (segment.label === undefined && segment.value <= 0) return element;

      return (
        <Tooltip key={`tooltip-${key}`}>
          <TooltipTrigger asChild>{element}</TooltipTrigger>
          <TooltipContent>
            <span>{segment.label ? `${segment.label}: ${segment.value}` : `${segment.value}`}</span>
          </TooltipContent>
        </Tooltip>
      );
    };

    const labelled = segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => segment.label !== undefined);

    return (
      <TooltipProvider>
        <div ref={ref} className={cn("flex min-w-0 flex-col gap-1", className)} {...props}>
          <div role="group" aria-label={ariaLabel} className="bg-muted" style={trackStyle}>
            {total > 0 && segments.map(renderSegment)}
          </div>
          <span className="sr-only">{`Total: ${total}`}</span>
          {showLabels && (
            // The values are already announced by the progressbars; announcing them twice is noise.
            <div
              aria-hidden="true"
              className={stackedProgressLabelVariant({ density: effectiveDensity })}
            >
              {labelled.map(({ segment, index }) => (
                <div
                  key={`label-${segment.label ?? ""}-${index}`}
                  className={cn(
                    "flex items-center gap-1.5 text-muted-foreground",
                    selected === index && "font-semibold text-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "rounded-full",
                      stackedProgressSegmentColor[segment.color ?? "primary"],
                      selected === index && "ring-2 ring-foreground",
                    )}
                    style={{
                      width: stackedProgressDotSize[effectiveDensity],
                      height: stackedProgressDotSize[effectiveDensity],
                    }}
                  />
                  <span>{segment.label}</span>
                  <span className="font-medium text-foreground">{segment.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  },
);
StackedProgress.displayName = "StackedProgress";

export { StackedProgress };
