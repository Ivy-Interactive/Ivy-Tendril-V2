import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../api/bridge";
import type {
  AgentCostBreakdown,
  DashboardActivity,
  RecentMergedPr,
  RecentPlanCost,
  ShippedFeatureDay,
} from "../types/api";

export interface DashboardAnalytics {
  activity: DashboardActivity | null;
  shippedFeatures: ShippedFeatureDay[];
  agentCosts: AgentCostBreakdown[];
  planCosts: RecentPlanCost[];
  mergedPrs: RecentMergedPr[];
  loading: boolean;
  /** Set when the last fetch failed. The caller falls back rather than blanking the page. */
  error: string | null;
}

/**
 * Aggregation is not cheap and the numbers move slowly — a plan takes minutes, not milliseconds — so
 * this polls well below the 3s/5s job and plan intervals in `api/polling.ts`.
 */
const POLL_INTERVAL_MS = 60_000;

/** Enough plan-cost rows to fill the drill-down table without paging it. */
const PLAN_COST_DAYS = 30;

/**
 * Two 30-day periods, so `featuresShipped` can report a delta against the prior one. The daemon's
 * own default is 60 too, but stating it here is what ties the window to the delta that needs it.
 */
const SHIPPED_FEATURE_DAYS = 60;

const EMPTY: Omit<DashboardAnalytics, "loading" | "error"> = {
  activity: null,
  shippedFeatures: [],
  agentCosts: [],
  planCosts: [],
  mergedPrs: [],
};

/**
 * The five dashboard analytics queries, fetched together on mount and on a slow tick.
 *
 * A failure leaves the previously fetched data in place and only sets `error`: a daemon that drops
 * out for one tick should not empty a dashboard that was correct a minute ago.
 */
export function useDashboardAnalytics(): DashboardAnalytics {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Survives unmount mid-flight: the five requests are in the air for as long as the daemon takes,
  // and setting state after teardown is a warning at best and a leak at worst.
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    try {
      const [activity, shippedFeatures, agentCosts, planCosts, mergedPrs] = await Promise.all([
        bridge.getDashboardActivity(),
        bridge.getShippedFeatures(SHIPPED_FEATURE_DAYS),
        bridge.getAgentCostBreakdown(),
        bridge.getRecentPlanCosts(PLAN_COST_DAYS),
        bridge.getRecentMergedPrs(),
      ]);
      if (!mountedRef.current) return;
      setData({ activity, shippedFeatures, agentCosts, planCosts, mergedPrs });
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchAll();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchAll]);

  useEffect(() => {
    const id = window.setInterval(() => {
      // Skip hidden ticks: five aggregations nobody is looking at is pure daemon load.
      if (document.visibilityState === "hidden") return;
      void fetchAll();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [fetchAll]);

  return { ...data, loading, error };
}
