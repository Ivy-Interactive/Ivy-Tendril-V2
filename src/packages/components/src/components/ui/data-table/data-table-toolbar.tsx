import * as React from "react";

import { cn } from "@/lib/utils";
import { useDensity } from "@/contexts/density-context";
import type { Densities } from "@/types/density";
import { dataTableToolbarVariant } from "./variant";

export interface DataTableToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Grows to fill the row — filters, search, titles. */
  left?: React.ReactNode;
  /** Stays at its natural width on the right — actions, column options. */
  right?: React.ReactNode;
  density?: Densities;
}

/** The row above the table, matching the legacy widget's header layout. */
const DataTableToolbar = React.forwardRef<HTMLDivElement, DataTableToolbarProps>(
  ({ left, right, density: propDensity, className, children, ...props }, ref) => {
    const contextDensity = useDensity();
    const density = propDensity ?? contextDensity;

    return (
      <div
        ref={ref}
        className={cn(dataTableToolbarVariant({ density }), "justify-between", className)}
        {...props}
      >
        <div className={cn(dataTableToolbarVariant({ density }), "min-w-0 flex-1")}>
          {left}
          {children}
        </div>
        <div className={cn(dataTableToolbarVariant({ density }), "shrink-0 justify-end")}>
          {right}
        </div>
      </div>
    );
  },
);
DataTableToolbar.displayName = "DataTableToolbar";

export { DataTableToolbar };
