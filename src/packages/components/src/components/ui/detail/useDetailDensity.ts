import { useContext } from "react";
import { DetailContext } from "./DetailContext";
import { useDensity } from "@/contexts/density-context";
import type { Densities } from "@/types/density";

export const useDetailDensity = (): Densities => {
  const context = useContext(DetailContext);
  const globalDensity = useDensity();
  return (context.density as Densities | undefined) ?? globalDensity;
};
