import React from "react";
import { Tooltip, type TooltipProps, formatShortcut } from "../ui/TuiTooltip";

export type ShellTooltipProps = TooltipProps;

export { formatShortcut };

/** The shell's tooltip: `Tooltip` with a right-side default, so callers do not repeat it. */
export const ShellTooltip: React.FC<ShellTooltipProps> = ({ side = "right", ...rest }) => (
  <Tooltip side={side} {...rest} />
);
