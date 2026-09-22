import React from "react";
import { Plus } from "lucide-react";
import { useShell } from "./ShellContext.tsx";
import { type ShellWidgetProps, isMac } from "./types.ts";
import { ShellTooltip } from "./ShellTooltip.tsx";
import { TuiKbd } from "../ui/TuiKbd";
import { useTranslation } from "@/i18n/uiShell";
import "./shell.css";

interface ShellNewPlanButtonProps extends ShellWidgetProps {
  label?: string;
}

/**
 * The primary New Plan CTA. The keyboard shortcut (Ctrl+Alt+N) is bound by
 * the server through the framework's ShortcutKey mechanism: this widget only
 * displays the hint and fires OnClick.
 */
export const ShellNewPlanButton: React.FC<ShellNewPlanButtonProps> = ({
  id,
  events = [],
  eventHandler,
  label: labelProp,
}) => {
  const { t } = useTranslation("uiShell");
  const label = labelProp ?? t("newPlanButton.label");
  const { collapsed } = useShell();
  const hintKeys = isMac() ? ["⌘", "⌥", "N"] : ["Ctrl", "Alt", "N"];

  const fire = () => {
    if (events.includes("OnClick")) eventHandler("OnClick", id, []);
  };

  return (
    <div className="tsh-newplan-wrap">
      <ShellTooltip content={label} shortcut={hintKeys} enabled={collapsed} side="right">
        <button className="tsh-newplan" onClick={fire} aria-label={label}>
          <span className="tsh-row">
            <span className="tsh-newplan-label-group">
              <Plus size={16} />
              <span className="tsh-newplan-label">{label}</span>
            </span>
            <TuiKbd keys={hintKeys} variant="bare" className="tsh-kbd" />
          </span>
        </button>
      </ShellTooltip>
    </div>
  );
};
