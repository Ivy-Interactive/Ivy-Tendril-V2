import React from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon = "📂",
}) => {
  return (
    <div
      role="region"
      aria-label={title}
      className="flex flex-col items-center justify-center rounded-box border border-dashed border-border bg-card/30 p-12 text-center"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/80 text-2xl text-muted-foreground">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-6 rounded-field bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
