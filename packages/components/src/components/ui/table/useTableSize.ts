import { useContext } from "react";
import { TableContext } from "./TableContext";
import { useDensity } from "@/contexts/density-context";
import type { Densities } from "@/types/density";

export const useTableScale = (): Densities => {
  const context = useContext(TableContext);
  const globalDensity = useDensity();
  return (context.density as Densities | undefined) ?? globalDensity;
};
