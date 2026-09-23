import React from "react";
import { KpiBreakdownSheet, type KpiBreakdownData } from "@ivy-interactive/components/dialogs";
import type { DashboardAnalytics } from "../../hooks/useDashboardAnalytics";

/**
 * The connected half of the library's `KpiBreakdownSheet` (V1 `Apps/Views/Sheets/KpiBreakdownSheet.cs`):
 * the Dashboard's KPI drill-down.
 *
 * It hands the sheet the analytics snapshot the Dashboard already holds - the same five series the
 * cards are computed from (`utils/dashboardMetrics.ts`) - and the sheet does its own window
 * arithmetic, as V1's does. Mapping into `KpiBreakdownData` here is also what keeps the daemon's
 * DTOs and the library's shapes honest: a field renamed on either side fails `tsc` in this file.
 */
export interface DashboardKpiSheetProps {
  /** The clicked card's KPI id, or `null` to keep the sheet closed. An id with no panel is ignored. */
  kpiId: string | null;
  analytics: Pick<
    DashboardAnalytics,
    "activity" | "shippedFeatures" | "mergedPrs" | "planCosts" | "agentCosts"
  >;
  onClose: () => void;
}

export const DashboardKpiSheet: React.FC<DashboardKpiSheetProps> = ({
  kpiId,
  analytics,
  onClose,
}) => {
  const data = React.useMemo<KpiBreakdownData>(
    () => ({
      activity: analytics.activity,
      shippedFeatures: analytics.shippedFeatures,
      mergedPrs: analytics.mergedPrs,
      planCosts: analytics.planCosts,
      agentCosts: analytics.agentCosts,
    }),
    [
      analytics.activity,
      analytics.shippedFeatures,
      analytics.mergedPrs,
      analytics.planCosts,
      analytics.agentCosts,
    ],
  );
  return <KpiBreakdownSheet kpiId={kpiId} data={data} onClose={onClose} />;
};
