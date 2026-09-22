import React from "react";
import { Button } from "@ivy-interactive/components/ui";
import type { RecommendationItem } from "../types/api";
import { useTranslation, type TFunction } from "../i18n";

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

/** `RecommendationsTabView` badges impact High -> Success, Medium -> Warning, anything else Outline. */
export const REC_IMPACT_CLASS: Record<string, string> = {
  High: "bg-success/10 text-success border border-success/40",
  Medium: "bg-warning/10 text-warning border border-warning/40",
};

const REC_IMPACT_FALLBACK = "border border-border text-muted-foreground";

/**
 * The badges' words. The raw values stay the keys of the class maps above and of every comparison;
 * only the text on the badge is looked up. English is the raw value, which is what the badge showed
 * before, and a value this build has no label for is shown as it is.
 */
const REC_STATE_LABEL_KEYS = {
  Pending: "recommendationCard.state.pending",
  Accepted: "recommendationCard.state.accepted",
  AcceptedWithNotes: "recommendationCard.state.acceptedWithNotes",
  Declined: "recommendationCard.state.declined",
} as const;

const REC_IMPACT_LABEL_KEYS = {
  Small: "recommendationCard.impact.small",
  Medium: "recommendationCard.impact.medium",
  High: "recommendationCard.impact.high",
} as const;

const labelFrom = <K extends string>(
  keys: Readonly<Record<string, K>>,
  t: (key: K) => string,
  value: string,
): string => (Object.hasOwn(keys, value) ? t(keys[value] as K) : value);

const recStateLabel = (t: TFunction<"common">, state: string) =>
  labelFrom(REC_STATE_LABEL_KEYS, t, state);

const recImpactLabel = (t: TFunction<"common">, impact: string) =>
  labelFrom(REC_IMPACT_LABEL_KEYS, t, impact);

export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  recommendation,
  onAccept,
  onDecline,
  disabled = false,
}) => {
  const { t } = useTranslation("common");
  const statusKey = recommendation.state || "Pending";
  const badgeClass = REC_STATUS_CLASS[statusKey] ?? REC_STATUS_CLASS.Pending;
  const impactClass = recommendation.impact
    ? (REC_IMPACT_CLASS[recommendation.impact] ?? REC_IMPACT_FALLBACK)
    : REC_IMPACT_FALLBACK;
  // A decline reason and an accept note live in separate fields, so which one is
  // shown follows the state rather than one field being relabelled for both.
  const rationale = statusKey === "Declined" ? recommendation.declineReason : recommendation.notes;

  return (
    <div
      data-testid={`recommendation-card-${recommendation.title}`}
      className="flex flex-col gap-3 rounded-box border border-border bg-background p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium text-foreground">{recommendation.title}</h4>
          {recommendation.impact && (
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${impactClass}`}>
              {recImpactLabel(t, recommendation.impact)}
            </span>
          )}
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
            {recStateLabel(t, statusKey)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{recommendation.description}</p>
        {rationale && (
          <p className="text-xs text-muted-foreground">
            {statusKey === "Declined"
              ? t("recommendationCard.declineReason", { reason: rationale })
              : t("recommendationCard.notes", { notes: rationale })}
          </p>
        )}
      </div>

      {(!recommendation.state || recommendation.state === "Pending") && (
        <div className="flex shrink-0 items-center space-x-2">
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => onAccept(recommendation.title)}
            className="px-2.5 text-xs"
          >
            {t("recommendationCard.accept")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => onDecline(recommendation.title)}
            className="bg-muted px-2.5 text-xs text-muted-foreground"
          >
            {t("recommendationCard.decline")}
          </Button>
        </div>
      )}
    </div>
  );
};
