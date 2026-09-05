import { cva } from "class-variance-authority";

export const badgeVariant = cva(
  "inline-flex items-center rounded-selector border font-normal leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-[var(--ivy-green-200)] text-[var(--ivy-green-800)] dark:bg-[var(--ivy-green-800)] dark:text-[var(--ivy-green-100)]",
        secondary:
          "border-transparent bg-[var(--slate-200)] text-[var(--slate-800)] dark:bg-[var(--slate-800)] dark:text-[var(--slate-100)]",
        destructive:
          "border-transparent bg-[var(--destructive-200)] text-[var(--destructive-800)] dark:bg-[var(--destructive-800)] dark:text-[var(--destructive-100)]",
        outline: "text-foreground",
        success:
          "border-transparent bg-[var(--success-200)] text-[var(--success-800)] dark:bg-[var(--success-800)] dark:text-[var(--success-100)]",
        warning:
          "border-transparent bg-[var(--warning-200)] text-[var(--warning-800)] dark:bg-[var(--warning-800)] dark:text-[var(--warning-100)]",
        info: "border-transparent bg-[var(--info-200)] text-[var(--info-800)] dark:bg-[var(--info-800)] dark:text-[var(--info-100)]",
      },
      density: {
        medium: "px-2 py-0.5 text-xs",
        small: "px-1 py-0 text-[10px]",
        large: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "primary",
      density: "medium",
    },
  },
);
