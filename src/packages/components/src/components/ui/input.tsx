import * as React from "react";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { inputVariant } from "./input/variant";
import { useDensity } from "@/contexts/density-context";

export interface InputProps
  extends Omit<React.ComponentProps<"input">, "size">, VariantProps<typeof inputVariant> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, density, ...props }, ref) => {
    const contextDensity = useDensity();
    return (
      <input
        type={type}
        data-1p-ignore
        autoComplete="off"
        className={cn(inputVariant({ density: density ?? contextDensity, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
