import React, { createContext } from "react";
import type { VariantProps } from "class-variance-authority";
import { tableCellSizeVariant } from "./table-variant";
import { Densities } from "@/types/density";

type TableContextValue = VariantProps<typeof tableCellSizeVariant>;

// oxlint-disable-next-line react-refresh/only-export-components
export const TableContext = createContext<TableContextValue>({});

export const TableProvider: React.FC<{
  density?: Densities;
  children: React.ReactNode;
}> = ({ density, children }) => {
  return <TableContext.Provider value={{ density }}>{children}</TableContext.Provider>;
};
