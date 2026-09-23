import React from "react";
import { Callout, Densities } from "@ivy-interactive/components/ui";
import { useTranslation } from "../i18n";

interface ErrorBannerProps {
  children: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  "data-testid"?: string;
  className?: string;
}

/**
 * The app's one error banner, over the library's `Callout.Error`.
 *
 * V1 spells this `Callout.Error(message)` at every site (`GitTabView.cs:135`,
 * `TunnelSetupView.cs:52`, `CodingAgentStepView.cs:290`, ...), so the library component *is* the
 * parity target - this wrapper exists only because two dozen call sites here pass `children` rather
 * than a message string, and because `Small` density is what a banner inside a panel wants where
 * `Callout`'s own default is `Medium`.
 *
 * Prefer `Callout.Error` directly in new code, as `JobSessionView` does.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  children,
  onDismiss,
  dismissLabel,
  "data-testid": testId,
  className = "",
}) => {
  const { t } = useTranslation("common");
  return (
    <Callout.Error
      data-testid={testId}
      density={Densities.Small}
      /* No icon: this replaced a hand-rolled box that never had one, and it sits inline in panels and
         table toolbars where a 20px glyph re-flows the row. `Callout`'s own `role="alert"` and dismiss
         button carry over. */
      icon={false}
      onDismiss={onDismiss}
      dismissLabel={dismissLabel ?? t("errorBanner.dismiss")}
      className={`text-xs text-destructive [&_p]:text-xs ${className}`.trim()}
    >
      {children}
    </Callout.Error>
  );
};
