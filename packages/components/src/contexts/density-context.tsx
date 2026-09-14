import * as React from "react";
import { Densities } from "@/types/density";
import {
  controlHeight,
  controlSize,
  densityHeight,
  densityHeightLg,
  densityText,
  densityTreeGap,
} from "@/components/ui/density-scale";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface DensityContextValue {
  density: Densities;
  setDensity?: (density: Densities) => void;
}

export const DensityContext = React.createContext<DensityContextValue>({
  density: Densities.Medium,
});

export interface DensityProviderProps {
  density?: Densities;
  children: React.ReactNode;
}

export const DensityProvider: React.FC<DensityProviderProps> = ({
  density = Densities.Medium,
  children,
}) => {
  return <DensityContext.Provider value={{ density }}>{children}</DensityContext.Provider>;
};

export function useDensity(): Densities {
  const context = React.useContext(DensityContext);
  return context.density ?? Densities.Medium;
}

export interface DensityScaleValue {
  density: Densities;
  controlHeight: string;
  controlSize: string;
  height: string;
  heightLg: string;
  text: string;
  treeGap: string;
}

export function useDensityScale(density?: Densities): DensityScaleValue {
  const contextDensity = useDensity();
  const effectiveDensity = density ?? contextDensity;

  return {
    density: effectiveDensity,
    controlHeight: controlHeight[effectiveDensity],
    controlSize: controlSize[effectiveDensity],
    height: densityHeight[effectiveDensity],
    heightLg: densityHeightLg[effectiveDensity],
    text: densityText[effectiveDensity],
    treeGap: densityTreeGap[effectiveDensity],
  };
}

export interface DensityScaleProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: Densities;
  asChild?: boolean;
  children?: React.ReactNode;
}

export const DensityScale = React.forwardRef<HTMLDivElement, DensityScaleProps>(
  ({ density, asChild = false, children, className, ...props }, ref) => {
    const contextDensity = useDensity();
    const effectiveDensity = density ?? contextDensity;
    const Comp = asChild ? Slot : "div";

    return (
      <DensityContext.Provider value={{ density: effectiveDensity }}>
        <Comp
          ref={ref}
          className={cn(densityText[effectiveDensity], className)}
          data-density={effectiveDensity.toLowerCase()}
          {...props}
        >
          {children}
        </Comp>
      </DensityContext.Provider>
    );
  },
);

DensityScale.displayName = "DensityScale";
