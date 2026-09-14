import React from "react";
import type { RecommendationItem } from "../types/api";

export interface RecommendationCardProps {
  recommendation: RecommendationItem;
  onAccept: (title: string) => void;
  onDecline: (title: string) => void;
  disabled?: boolean;
}

export const REC_STATUS_CLASS: Record<string, string> = {
  Accepted: "bg-success/10 text-success border border-success/40",
  AcceptedWithNotes: "bg-success/10 text-success border border-success/40",
  Declined: "bg-muted text-muted-foreground border border-border",
  Pending: "bg-warning/10 text-warning border border-warning/40",
};

export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  recommendation,
  onAccept,
  onDecline,
  disabled = false,
}) => {
  const statusKey = recommendation.state || "Pending";
  const badgeClass = REC_STATUS_CLASS[statusKey] ?? REC_STATUS_CLASS.Pending;

  return (
    <div
      data-testid={`recommendation-card-${recommendation.title}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium text-foreground">{recommendation.title}</h4>
          {recommendation.impact && (
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {recommendation.impact} impact
            </span>
          )}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
            {statusKey}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{recommendation.description}</p>
        {recommendation.declineReason && (
          <p className="text-xs text-muted-foreground">
            {recommendation.state === "Declined" ? "Decline reason: " : "Notes: "}
            {recommendation.declineReason}
          </p>
        )}
      </div>

      {(!recommendation.state || recommendation.state === "Pending") && (
        <div className="flex shrink-0 items-center space-x-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAccept(recommendation.title)}
            className="rounded bg-primary/80 px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDecline(recommendation.title)}
            className="rounded bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}
    </div>
  );
};
