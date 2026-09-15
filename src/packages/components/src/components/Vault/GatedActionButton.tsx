import React from "react";
import { Button, type ButtonProps } from "../ui/button/button";
import { Tooltip } from "../ui/TuiTooltip";
import type { VaultGate } from "./gate";

export interface GatedActionButtonProps extends Omit<ButtonProps, "disabled" | "children"> {
  children: React.ReactNode;
  /** The gate from `computeVaultGate`; a disabled gate carries the reason to show. */
  gate: VaultGate;
  /** Shown when the gate allows the action — a plain hint rather than an explanation. */
  tooltip?: React.ReactNode;
}

/**
 * A vault action button that never fails silently: when its gate is closed the button is disabled and
 * the reason is reachable both as a tooltip and as the native `title`, so neither a hovering user nor
 * an assertion has to guess why nothing happens.
 *
 * The tooltip is anchored on a wrapper (`wrapTrigger`) because a disabled button emits no pointer
 * events — which is exactly when the reason matters most.
 */
export const GatedActionButton: React.FC<GatedActionButtonProps> = ({
  children,
  gate,
  tooltip,
  onClick,
  ...rest
}) => {
  const reason = gate.disabled ? gate.reason : undefined;
  const content = reason ?? tooltip;

  return (
    <Tooltip content={content} wrapTrigger triggerDisabled={gate.disabled}>
      <Button
        {...rest}
        disabled={gate.disabled}
        aria-disabled={gate.disabled}
        title={typeof content === "string" ? content : undefined}
        onClick={gate.disabled ? undefined : onClick}
      >
        {children}
      </Button>
    </Tooltip>
  );
};
