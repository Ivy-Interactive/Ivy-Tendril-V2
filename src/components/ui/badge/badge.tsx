import * as React from "react";
import type { VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { badgeVariant } from "./variant";
import { useDensity } from "@/contexts/density-context";
import { densityToBadgeDensity } from "@/components/ui/density-scale";

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariant> {}

function Badge({ className, variant, density, ...props }: BadgeProps) {
  const contextDensity = useDensity();
  return (
    <div
      className={cn(
        badgeVariant({ variant, density: density ?? densityToBadgeDensity(contextDensity) }),
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
