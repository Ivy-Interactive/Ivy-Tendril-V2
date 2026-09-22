import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDensity } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import { useTranslation } from "@/i18n/uiCommon";
import {
  calloutIconSize,
  calloutIconVariant,
  calloutTitleLeading,
  calloutVariant,
} from "./callout-variant";

export type CalloutVariant = NonNullable<VariantProps<typeof calloutVariant>["variant"]>;

export interface CalloutProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    Omit<VariantProps<typeof calloutVariant>, "density"> {
  title?: React.ReactNode;
  /** Overrides the per-variant default. `false` renders no icon. */
  icon?: React.ReactNode | false;
  /** Renders a dismiss button when provided. */
  onDismiss?: () => void;
  dismissLabel?: string;
  density?: Densities;
}

const calloutDefaultIcon: Record<CalloutVariant, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  // Shape-distinct from `error` so warning stays distinguishable without relying on colour alone.
  warning: TriangleAlert,
  error: CircleAlert,
  neutral: Info,
};

/** `error` and `warning` interrupt; everything else is announced politely. */
const assertiveVariants: readonly CalloutVariant[] = ["error", "warning"];

const CalloutRoot = React.forwardRef<HTMLDivElement, CalloutProps>(
  (
    { className, variant, density, title, icon, onDismiss, dismissLabel, children, ...props },
    ref,
  ) => {
    const { t } = useTranslation("uiCommon");
    const contextDensity = useDensity();
    const effectiveDensity = density ?? contextDensity;
    const effectiveVariant: CalloutVariant = variant ?? "info";

    const uid = React.useId();
    const titleId = `${uid}-title`;
    const bodyId = `${uid}-body`;

    const DefaultIcon = calloutDefaultIcon[effectiveVariant];
    const iconNode =
      icon === false ? null : (icon ?? <DefaultIcon size={calloutIconSize[effectiveDensity]} />);

    const hasTitle = title !== undefined && title !== null;
    const hasBody = children !== undefined && children !== null;

    return (
      <div
        ref={ref}
        role={assertiveVariants.includes(effectiveVariant) ? "alert" : "status"}
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-describedby={hasBody ? bodyId : undefined}
        className={cn(
          calloutVariant({ variant: effectiveVariant, density: effectiveDensity }),
          className,
        )}
        {...props}
      >
        {iconNode !== null && (
          <span
            aria-hidden="true"
            className={cn(
              "mr-3.5 shrink-0 opacity-90",
              calloutIconVariant({ variant: effectiveVariant }),
            )}
          >
            {iconNode}
          </span>
        )}
        <div className={cn("flex min-w-0 flex-1 flex-col", onDismiss && "pr-8")}>
          {hasTitle && (
            <div
              id={titleId}
              className={cn("mb-1 font-medium", calloutTitleLeading[effectiveDensity])}
            >
              {title}
            </div>
          )}
          {hasBody && (
            <div
              id={bodyId}
              className="text-sm leading-relaxed opacity-90 [&_p]:mb-0 [&_p]:text-sm"
            >
              {children}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel ?? t("callout.dismiss")}
            className="absolute right-3 top-3 rounded-selector p-1 opacity-70 transition-opacity hover:bg-secondary/60 hover:text-foreground hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    );
  },
);
CalloutRoot.displayName = "Callout";

export type CalloutSemanticProps = Omit<CalloutProps, "variant">;

type CalloutSemanticComponent = React.ForwardRefExoticComponent<
  CalloutSemanticProps & React.RefAttributes<HTMLDivElement>
>;

function semanticCallout(variant: CalloutVariant, displayName: string): CalloutSemanticComponent {
  const Component = React.forwardRef<HTMLDivElement, CalloutSemanticProps>((props, ref) => (
    <CalloutRoot ref={ref} variant={variant} {...props} />
  ));
  Component.displayName = displayName;
  return Component;
}

export interface CalloutComponent extends React.ForwardRefExoticComponent<
  CalloutProps & React.RefAttributes<HTMLDivElement>
> {
  Info: CalloutSemanticComponent;
  Success: CalloutSemanticComponent;
  Warning: CalloutSemanticComponent;
  Error: CalloutSemanticComponent;
  Neutral: CalloutSemanticComponent;
}

/**
 * Semantic banner. Both spellings ship: `<Callout variant="error">` and `<Callout.Error>`, the
 * latter reading like the legacy `Callout.Error(msg, "Commits At Risk")` factory at the call site.
 */
const Callout = Object.assign(CalloutRoot, {
  Info: semanticCallout("info", "Callout.Info"),
  Success: semanticCallout("success", "Callout.Success"),
  Warning: semanticCallout("warning", "Callout.Warning"),
  Error: semanticCallout("error", "Callout.Error"),
  Neutral: semanticCallout("neutral", "Callout.Neutral"),
}) as CalloutComponent;

export { Callout };
