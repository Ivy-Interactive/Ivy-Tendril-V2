import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { nativeSelectVariant, nativeSelectChevronVariant } from "./native-select/variant";
import { useDensity } from "@/contexts/density-context";

export interface NativeSelectProps
  extends Omit<React.ComponentProps<"select">, "size">, VariantProps<typeof nativeSelectVariant> {
  /** Applied to the positioning wrapper the chevron is anchored to, not to the `<select>`. */
  wrapperClassName?: string;
}

/**
 * A native `<select>` styled to match `Input`: flat, token-bordered, with a drawn chevron.
 *
 * The element stays native wherever a test or a screen reader's forms mode drives it with
 * `change` on the control itself, which the Radix `Select` - a button over a portalled listbox -
 * has nothing to receive. `bg-background` rather than a transparent fill because a native
 * select's background propagates to its own option list, which would otherwise render unreadable.
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, density, children, ...props }, ref) => {
    const contextDensity = useDensity();
    const resolved = density ?? contextDensity;
    return (
      <div className={cn("relative", wrapperClassName)}>
        <select
          ref={ref}
          className={cn(nativeSelectVariant({ density: resolved, className }))}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className={nativeSelectChevronVariant({ density: resolved })}
        />
      </div>
    );
  },
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
