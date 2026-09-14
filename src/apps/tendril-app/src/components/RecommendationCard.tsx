import React from "react";
import type { RecommendationItem } from "../types/api";

export interface RecommendationCardProps {
  recommendation: RecommendationItem;
  onAccept: (title: string) => void;
  onDecline: (title: string) => void;
  disabled?: boolean;
}

export const REC_STATUS_CLASS: Record<string, string> = {
  Accepted: "bg-emerald-950 text-emerald-300 border border-emerald-800",
  AcceptedWithNotes: "bg-emerald-950 text-emerald-300 border border-emerald-800",
  Declined: "bg-slate-800 text-slate-400 border border-slate-700",
  Pending: "bg-amber-950 text-amber-300 border border-amber-800",
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
      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950 p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium text-slate-200">{recommendation.title}</h4>
          {recommendation.impact && (
            <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {recommendation.impact} impact
            </span>
          )}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
            {statusKey}
          </span>
        </div>
        <p className="text-xs text-slate-300">{recommendation.description}</p>
        {recommendation.declineReason && (
          <p className="text-xs text-slate-400">
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
            className="rounded bg-emerald-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDecline(recommendation.title)}
            className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}
    </div>
  );
};
