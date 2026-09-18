import { cva } from "class-variance-authority";

export const badgeVariant = cva(
  "inline-flex items-center rounded-selector border font-normal leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-ivy-green-tint-bg text-ivy-green-tint-fg",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive-tint-bg text-destructive-tint-fg",
        outline: "text-foreground",
        success: "border-transparent bg-success-tint-bg text-success-tint-fg",
        warning: "border-transparent bg-warning-tint-bg text-warning-tint-fg",
        info: "border-transparent bg-info-tint-bg text-info-tint-fg",
        /**
         * A badge in an arbitrary Ivy `Colors` name — the framework's `BadgeColorMapping`, which is how
         * V1 colours its Jobs Status, Type and Project columns from `Constants.JobStatusColors` and
         * friends. The fill and the text come from `--badge-tint-*`, which `Badge`'s `color` prop sets
         * per element from that name; the tokens exist for exactly this and `styles/index.css` defines
         * the utility.
         *
         * Selected by passing `color`, not by naming the variant: without a colour there is nothing to
         * tint and the badge would render on the fallback `--muted`.
         */
        tinted: "border-transparent badge-tinted",
      },
      density: {
        Small: "px-1 py-0 text-2xs",
        Medium: "px-2 py-0.5 text-xs",
        Large: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      density: "Medium",
    },
  },
);
