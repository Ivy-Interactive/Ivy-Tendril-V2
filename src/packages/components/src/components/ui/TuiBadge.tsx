import React from "react";
import { X } from "lucide-react";
import { ivyColorVar } from "@/lib/ivy-color";
import { useTranslation } from "@/i18n/uiCommon";
import "./ui.css";

export type BadgeKind =
  | "neutral"
  | "primary"
  | "project"
  | "success"
  | "warning"
  | "danger"
  | "color";
export type BadgeSize = "sm" | "md";
export type BadgeShape = "rounded" | "pill";

export interface TuiBadgeProps {
  kind?: BadgeKind;
  /** An Ivy color name the host assigned (e.g. "Blue"); it tints the badge and overrides `kind`. */
  color?: string;
  children: React.ReactNode;
  /** Numeric styling: a fixed minimum width and tabular figures, so a ticking count is steady. */
  numeric?: boolean;
  size?: BadgeSize;
  shape?: BadgeShape;
  /** Absolutely positions the badge at the top-right corner of a `position: relative` parent. */
  floating?: boolean;
  mono?: boolean;
  caps?: boolean;
  /** A leading icon, rendered before the label. */
  icon?: React.ReactNode;
  /** Renders an accessible remove button after the label. */
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Native title, for a badge whose label is abbreviated. */
  title?: string;
  "aria-label"?: string;
}

/**
 * A small label chip: the bundle's one badge shape, tinted by kind.
 *
 * Named `TuiBadge` (not `Badge`) so it does not collide with the shadcn `Badge` this package
 * already exports from `components/ui/badge`.
 */
export const TuiBadge: React.FC<TuiBadgeProps> = ({
  kind = "neutral",
  color,
  children,
  numeric = false,
  size,
  shape,
  floating = false,
  mono = false,
  caps = false,
  icon,
  onRemove,
  removeLabel,
  className = "",
  style,
  title,
  "aria-label": ariaLabel,
}) => (
  <span
    className={`tui-badge ${numeric ? "tui-badge--count" : ""} ${className}`
      .replace(/\s+/g, " ")
      .trim()}
    data-kind={color ? "color" : kind}
    data-size={size}
    data-shape={shape}
    data-floating={floating ? "true" : undefined}
    data-mono={mono ? "true" : undefined}
    data-caps={caps ? "true" : undefined}
    style={
      color ? ({ "--tui-badge-color": ivyColorVar(color), ...style } as React.CSSProperties) : style
    }
    title={title}
    aria-label={ariaLabel}
  >
    {icon}
    {children}
    {onRemove && <TuiBadgeRemoveButton label={removeLabel} onRemove={onRemove} />}
  </span>
);

/** The badge's remove control: its own component so only a removable badge subscribes to the language. */
function TuiBadgeRemoveButton({ label, onRemove }: { label?: string; onRemove: () => void }) {
  const { t } = useTranslation("uiCommon");
  return (
    <button
      type="button"
      className="tui-badge-remove"
      aria-label={label ?? t("tuiBadge.remove")}
      onClick={onRemove}
    >
      <X size={10} aria-hidden="true" />
    </button>
  );
}

export interface CountBadgeProps {
  count: number;
  /** Counts above this render as "99+". */
  max?: number;
  kind?: BadgeKind;
  className?: string;
  /** Accessible name, e.g. "3 unread plans". Defaults to the number alone. */
  label?: string;
}

/** Formats a count for a notification badge: 100 with max 99 becomes "99+". */
export const formatCount = (count: number, max = 99): string =>
  count > max ? `${max}+` : `${count}`;

/**
 * The bundle's one notification/count indicator. Renders nothing for a non-positive count, so
 * a caller can hand it a raw number.
 */
export const CountBadge: React.FC<CountBadgeProps> = ({
  count,
  max = 99,
  kind = "neutral",
  className = "",
  label,
}) => {
  if (!Number.isFinite(count) || count <= 0) return null;
  const text = formatCount(count, max);
  return (
    <TuiBadge numeric kind={kind} className={className} aria-label={label ?? text}>
      {text}
    </TuiBadge>
  );
};

export type DotTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusDotProps {
  tone?: DotTone;
  /** Pulses while something is in flight. */
  pulse?: boolean;
  /** Absolutely positions the dot at the top-right corner of a `position: relative` parent. */
  floating?: boolean;
  /** The ring color around a floating dot; defaults to the theme background. */
  ring?: string;
  className?: string;
  label?: string;
}

/** A status dot — the small round sibling of the count badge. */
export const StatusDot: React.FC<StatusDotProps> = ({
  tone = "neutral",
  pulse = false,
  floating = false,
  ring,
  className = "",
  label,
}) => (
  <span
    className={`tui-dot ${className}`.trim()}
    data-tone={tone}
    data-pulse={pulse}
    data-floating={floating ? "true" : undefined}
    style={ring ? ({ "--tui-dot-ring": ring } as React.CSSProperties) : undefined}
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  />
);
