import * as React from "react";

import type { BladesContextValue } from "./types";

export const BladesContext = React.createContext<BladesContextValue | null>(null);

export function useBlades(): BladesContextValue {
  const context = React.useContext(BladesContext);
  if (!context) {
    throw new Error("useBlades must be used within a BladeContainer.");
  }

  return context;
}
