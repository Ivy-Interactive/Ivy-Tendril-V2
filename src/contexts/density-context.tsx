import * as React from "react";
import { Densities } from "@/types/density";

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
