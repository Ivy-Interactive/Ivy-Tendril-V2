import React from "react";

interface ErrorBannerProps {
  children: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  "data-testid"?: string;
  className?: string;
}

/**
 * The app's one error banner: a destructive-tinted box for a backend error reported where the
 * operator pressed the button. Every view hand-rolled the same
 * `border-destructive/40 bg-destructive/10` box before this existed; this is that box, with an
 * optional dismiss control for the views that offer one.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  children,
  onDismiss,
  dismissLabel = "Dismiss error",
  "data-testid": testId,
  className = "",
}) => (
  <div
    role="alert"
    data-testid={testId}
    className={`flex items-start justify-between gap-3 rounded-box border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive ${className}`.trim()}
  >
    <div className="min-w-0 flex-1">{children}</div>
    {onDismiss && (
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="text-destructive hover:text-destructive/80"
      >
        ✕
      </button>
    )}
  </div>
);
