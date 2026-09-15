import React from "react";
import { Tooltip, type TooltipProps, formatShortcut } from "../ui/TuiTooltip";
import "./shell.css";

export type ShellTooltipProps = TooltipProps;
export { formatShortcut };

/**
 * The shared tooltip with the shell's default placement. Everything else about it - styling,
 * hover timing, the shortcut key cap - comes from `ui/TuiTooltip`, so a shell tooltip and a chat
 * tooltip are the same tooltip.
 */
export const ShellTooltip: React.FC<ShellTooltipProps> = ({ side = "right", ...rest }) => (
  <Tooltip side={side} {...rest} />
);
