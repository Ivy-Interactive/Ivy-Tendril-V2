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
  /**
   * True only while nothing has ever been fetched *and* nothing is cached from an earlier visit.
   *
   * This is deliberately not "a request is in flight": a refresh is invisible, because the previous
   * snapshot is still on screen throughout it. Callers therefore read `loading` as "there is no
   * number to show yet, draw a placeholder", and `activity == null && !loading` as "the daemon
   * answered and has nothing" — two states the view used to conflate into one row of dashes.
   */
  loading: boolean;
  /** Set when the last fetch failed. The caller falls back rather than blanking the page. */
  error: string | null;
}

/** Everything the five queries produce, i.e. `DashboardAnalytics` minus the fetch's own status. */
type DashboardAnalyticsData = Omit<DashboardAnalytics, "loading" | "error">;

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

const EMPTY: DashboardAnalyticsData = {
  activity: null,
  shippedFeatures: [],
  agentCosts: [],
  planCosts: [],
  mergedPrs: [],
};

/**
 * The last snapshot the daemon answered with, held at module scope rather than in the hook.
 *
 * `App.tsx` renders exactly one view per nav id, so leaving the Dashboard unmounts it and every
 * `useState` in this hook goes back to `EMPTY`. Coming back therefore re-ran all five aggregations
 * from nothing and the KPI row flashed its no-data vocabulary — a dash and an "n/a" — for as long as
 * the daemon took, every single time. Keeping the snapshot outside React makes a return visit paint
 * the figures it last showed and revalidate them behind the operator's back, which is the
 * stale-while-revalidate half of this: a number that is a minute old is enormously closer to the
 * truth than a dash.
 *
 * Module scope is the right lifetime because the data is not per-component: the numbers are the
 * install's, so two mounted dashboards would want the same ones. It is cleared on reload, which is
 * exactly when the daemon might be a different one.
 */
let lastSnapshot: DashboardAnalyticsData | null = null;

/**
 * Drops the cached snapshot. Only tests need this — each one stubs a different daemon, and a
 * snapshot left behind by the previous case would render before that stub was ever consulted.
 */
export function resetDashboardAnalyticsCache(): void {
  lastSnapshot = null;
}

/**
 * The five dashboard analytics queries, fetched together on mount and on a slow tick.
 *
 * A failure leaves the previously fetched data in place and only sets `error`: a daemon that drops
 * out for one tick should not empty a dashboard that was correct a minute ago.
 */
export function useDashboardAnalytics(): DashboardAnalytics {
  const [data, setData] = useState<DashboardAnalyticsData>(() => lastSnapshot ?? EMPTY);
  // A cached snapshot means the first paint already has numbers on it, so this mount is a refresh,
  // not a load, and must not ask the view for placeholders.
  const [loading, setLoading] = useState(() => lastSnapshot == null);
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
      const snapshot: DashboardAnalyticsData = {
        activity,
        shippedFeatures,
        agentCosts,
        planCosts,
        mergedPrs,
      };
      // Cached before the mount check, because a fetch that lands after the operator has navigated
      // away is still the freshest answer there is and the next visit should open on it.
      lastSnapshot = snapshot;
      if (!mountedRef.current) return;
      setData(snapshot);
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
