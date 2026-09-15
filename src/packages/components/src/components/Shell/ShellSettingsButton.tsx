import React from "react";
import { Inbox, type LucideIcon, Settings } from "lucide-react";
import { useShell } from "./ShellContext.tsx";
import type { ShellWidgetProps } from "./types.ts";
import { ShellTooltip } from "./ShellTooltip.tsx";
import "./shell.css";

interface ShellSettingsButtonProps
  extends ShellWidgetProps, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "id" | "children"> {
  label?: string;
  icon?: string;
  showLabel?: boolean;
  isActive?: boolean;
}

/* Only the icons the sidebar footer hosts are bundled; unknown names fall back
   to the settings cog. */
const footerIcons: Record<string, LucideIcon> = {
  Settings,
  Inbox,
};

/**
 * Sidebar footer button. Fires OnClick when used standalone; when hosted as a
 * dropdown-menu trigger the menu owns the click instead. With the label hidden it
 * is icon-only and names itself in a tooltip.
 *
 * V1's widget is a plain function component because the Ivy framework intercepts the
 * trigger click server-side. V2's menu is Radix, whose `asChild` trigger hands the
 * child a ref and its own handlers, so this forwards both.
 */
export const ShellSettingsButton = React.forwardRef<HTMLButtonElement, ShellSettingsButtonProps>(
  (
    {
      id,
      events = [],
      eventHandler,
      label = "Settings",
      icon = "Settings",
      showLabel = true,
      isActive = false,
      onClick,
      ...rest
    },
    ref,
  ) => {
    const { collapsed } = useShell();
    const Icon = footerIcons[icon] ?? Settings;

    return (
      <ShellTooltip
        content={label}
        enabled={collapsed || !showLabel}
        side={collapsed ? "right" : "top"}
      >
        <button
          {...rest}
          ref={ref}
          className="tsh-settings"
          data-icon-only={!showLabel}
          data-active={isActive}
          aria-label={label}
          onClick={(e) => {
            onClick?.(e);
            if (events.includes("OnClick")) eventHandler("OnClick", id, []);
          }}
        >
          <span className="tsh-row">
            <Icon size={16} />
            {showLabel && <span className="tsh-settings-label">{label}</span>}
          </span>
        </button>
      </ShellTooltip>
    );
  },
);

ShellSettingsButton.displayName = "ShellSettingsButton";
