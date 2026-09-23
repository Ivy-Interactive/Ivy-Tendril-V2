import React, { useState } from "react";
import {
  Check,
  Eye,
  Feather,
  LoaderCircle,
  MessageSquareWarning,
  Sprout,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  type TendrilDashboardProps,
  formatCountTick,
  formatCurrencyTick,
  hasSlotContent,
} from "./types.ts";
import { TrendChart } from "./TrendChart.tsx";
import { ActivityGrid } from "./ActivityGrid.tsx";
import { PillBars } from "./PillBars.tsx";
import { ChartSkeleton, KpiSkeletonGrid } from "./DashboardSkeleton.tsx";
import { TuiBadge } from "../ui/TuiBadge";
import { formatCurrency, useTranslation } from "@/i18n/uiShell";
import "../ui/ui.css";
import "./dashboard.css";

interface StatusItemProps {
  icon: React.ReactNode;
  count: number;
  label: string;
  onClick: () => void;
}

const StatusItem: React.FC<StatusItemProps> = ({ icon, count, label, onClick }) => (
  <button type="button" className="tdb-status-item" onClick={onClick}>
    {icon}
    <span className="tdb-status-count">{count}</span>
    <span className="tdb-status-label">{label}</span>
  </button>
);

const WHOLE_DOLLARS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
};

/** Ungrouped like the old `toFixed(2)`: $999.996 rounds to "$1000.00", not "$1,000.00". */
const CENTS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
};

/**
 * A trend value: whole dollars from $1,000 up, cents below, in the current language. Rounded by
 * `Math.round` and `toFixed` first, as before: `Intl` rounds ties in a number's shortest decimal form
 * ($87.455 to $87.46) where `toFixed` rounds its binary value ($87.45).
 */
const formatCurrencyValue = (value: number): string =>
  value >= 1000
    ? formatCurrency(Math.round(value), "USD", WHOLE_DOLLARS)
    : formatCurrency(Number(value.toFixed(2)), "USD", CENTS);

export const TendrilDashboard: React.FC<TendrilDashboardProps> = ({
  id,
  events = [],
  eventHandler,
  dateText = "",
  greeting = "",
  headline = "",
  draftCount = 0,
  inProgressCount = 0,
  reviewCount = 0,
  completedCount = 0,
  failedCount = 0,
  kpis = [],
  trend = null,
  trendWeekly = null,
  pullRequests = [],
  pullRequestsWeekly = [],
  activity = [],
  jobs = [],
  loading = false,
  slots,
}) => {
  const { t } = useTranslation("uiShell");
  const [tab, setTab] = useState<"cost" | "plans">("cost");
  /**
   * Weeks, not months.
   *
   * Six Monday-to-Sunday weeks is the resolution the card can act on: a plan takes minutes and the
   * question the operator has in front of a Pull Requests card is "are we shipping this week", which a
   * bar covering the whole of last month cannot answer. It is also the range the card has room for —
   * a month bar carries a wider label than a week bar in the same 280px side column.
   */
  const [prPeriod, setPrPeriod] = useState<"week" | "month">("week");
  const activePrs = prPeriod === "week" ? (pullRequestsWeekly ?? []) : (pullRequests ?? []);

  const fireEvent = (eventName: string) => {
    if (events.includes(eventName)) {
      eventHandler(eventName, id, []);
    }
  };

  const fireJobEvent = (jobId: string) => {
    if (events.includes("OnJob")) {
      eventHandler("OnJob", id, [jobId]);
    }
  };

  const fireKpiEvent = (kpiId: string) => {
    if (events.includes("OnSelectKpi")) {
      eventHandler("OnSelectKpi", id, [kpiId]);
    }
  };

  // `id` keys the row, so the key does not change with the language; `event` is the host's.
  const statusItems = [
    {
      id: "plans",
      icon: <Feather size={16} />,
      count: draftCount,
      label: t("dashboard.status.plans"),
      event: "OnDrafts",
    },
    {
      id: "inProgress",
      icon: <Sprout size={16} />,
      count: inProgressCount,
      label: t("dashboard.status.inProgress"),
      event: "OnJobs",
    },
    {
      id: "review",
      icon: <Eye size={16} />,
      count: reviewCount,
      label: t("dashboard.status.readyForReview"),
      event: "OnReview",
    },
    {
      id: "completed",
      icon: <Check size={16} />,
      count: completedCount,
      label: t("dashboard.status.completed"),
      event: "OnJobs",
    },
    {
      id: "failed",
      icon: <MessageSquareWarning size={16} />,
      count: failedCount,
      label: t("dashboard.status.failed"),
      event: "OnJobs",
    },
  ];

  /** The window the trend card plots, matching `DashboardApp.TrendDailyWindowDays`. */
  const trendName = t("dashboard.trend.currentName");
  const formatPlansValue = (value: number): string =>
    t("dashboard.trend.plansValue", { count: Math.round(value) });

  const activeTrend = trendWeekly ?? trend;

  const trendData =
    activeTrend == null
      ? null
      : tab === "cost"
        ? {
            values: activeTrend.cost,
            rolling: activeTrend.rollingCost,
            formatTick: formatCurrencyTick,
            formatValue: formatCurrencyValue,
          }
        : {
            values: activeTrend.plans,
            rolling: activeTrend.rollingPlans,
            formatTick: formatCountTick,
            formatValue: formatPlansValue,
          };

  return (
    <div className="tdb-root">
      <div className="tdb-inner">
        <div className="tdb-grid">
          <div className="tdb-col">
            <header className="tdb-header">
              <div className="tdb-date">{dateText}</div>
              <h1 className="tdb-greeting">{greeting}</h1>
              <h1 className="tdb-headline">{headline}</h1>
            </header>

            <div className="tdb-block tdb-status">
              {statusItems.map((item, index) => (
                <React.Fragment key={item.id}>
                  {index > 0 && <div className="tdb-status-sep" />}
                  <StatusItem
                    icon={item.icon}
                    count={item.count}
                    label={item.label}
                    onClick={() => fireEvent(item.event)}
                  />
                </React.Fragment>
              ))}
            </div>

            {/* Placeholders while no figures exist yet, so the row is never four dashes. Once they
                have arrived a refresh keeps rendering them: `loading` goes false and stays false. */}
            {loading && <KpiSkeletonGrid />}

            {!loading && kpis.length > 0 && (
              <div className="tdb-kpis">
                {kpis.map((kpi, index) => {
                  const body = (
                    <>
                      <div className="tdb-kpi-label">{kpi.label}</div>
                      <div className="tdb-kpi-row">
                        <span className="tdb-kpi-value">{kpi.value}</span>
                        {kpi.subValue && <span className="tdb-kpi-subvalue">{kpi.subValue}</span>}
                        {kpi.delta && (
                          <span className="tdb-kpi-delta">
                            {kpi.delta}
                            {kpi.direction === "down" ? <TrendingDown /> : <TrendingUp />}
                          </span>
                        )}
                      </div>
                      {kpi.hint && <div className="tdb-kpi-hint">{kpi.hint}</div>}
                    </>
                  );
                  const kpiId = kpi.id;
                  const key = kpiId ?? kpi.label;

                  // Only an identified KPI is a control. A tile with nothing to drill into stays a
                  // plain div, so it is not focusable and does not promise a click target.
                  return kpiId == null ? (
                    <div className="tdb-kpi" data-tone={index % 4} key={key}>
                      {body}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="tdb-kpi"
                      data-clickable="true"
                      data-tone={index % 4}
                      key={key}
                      aria-label={t("dashboard.kpi.breakdownAriaLabel", { label: kpi.label })}
                      onClick={() => fireKpiEvent(kpiId)}
                    >
                      {body}
                    </button>
                  );
                })}
              </div>
            )}

            {/* The card itself, not just its chart: the trend block is skipped entirely when there is
                no series, so drawing the frame here is what stops the whole left column reflowing
                when one arrives. The tabs and legend stay out until they have a series to switch
                between — a control that does nothing is worse than one that is not there yet. */}
            {loading && (
              <div className="tdb-block tdb-trend">
                <div className="tdb-trend-chart">
                  <ChartSkeleton label={t("dashboard.trend.loading")} />
                </div>
              </div>
            )}

            {!loading && trendData && (
              <div className="tdb-block tdb-trend">
                <div className="tdb-trend-header">
                  <div className="tdb-tabs">
                    <button
                      type="button"
                      className="tdb-tab"
                      data-active={tab === "cost"}
                      onClick={() => setTab("cost")}
                    >
                      {t("dashboard.trend.costTab")}
                    </button>
                    <button
                      type="button"
                      className="tdb-tab"
                      data-active={tab === "plans"}
                      onClick={() => setTab("plans")}
                    >
                      {t("dashboard.trend.plansTab")}
                    </button>
                  </div>
                  <div className="tdb-trend-sep" />
                  <div className="tdb-legend">
                    <span className="tdb-legend-item">
                      <span className="tdb-legend-dot" />
                      {trendName}
                    </span>
                    <span className="tdb-legend-item">
                      <span className="tdb-legend-line-avg" />
                      {t("dashboard.trend.rollingLegend")}
                    </span>
                  </div>
                </div>
                <div className="tdb-trend-chart">
                  <TrendChart
                    dates={activeTrend!.dates}
                    values={trendData.values}
                    rolling={trendData.rolling}
                    currentName={trendName}
                    formatTick={trendData.formatTick}
                    formatValue={trendData.formatValue}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="tdb-col tdb-col-side">
            <div className="tdb-update-slot">{slots?.UpdateNotice}</div>
            <div className="tdb-block tdb-side-block">
              <div className="tdb-block-title">{t("dashboard.gitActivity.title")}</div>
              <div className="tdb-side-body">
                {loading ? (
                  <ChartSkeleton label={t("dashboard.gitActivity.loading")} />
                ) : (
                  <ActivityGrid months={activity} />
                )}
              </div>
            </div>
            <div className="tdb-block tdb-side-block">
              <div className="tdb-side-head">
                <div className="tdb-block-title">{t("dashboard.pullRequests.title")}</div>
                <div className="tdb-tabs tdb-side-tabs">
                  <button
                    type="button"
                    className="tdb-tab tdb-side-tab"
                    data-active={prPeriod === "week"}
                    onClick={() => setPrPeriod("week")}
                  >
                    {t("dashboard.pullRequests.weekTab")}
                  </button>
                  <button
                    type="button"
                    className="tdb-tab tdb-side-tab"
                    data-active={prPeriod === "month"}
                    onClick={() => setPrPeriod("month")}
                  >
                    {t("dashboard.pullRequests.monthTab")}
                  </button>
                </div>
              </div>
              <div className="tdb-side-body">
                {loading ? (
                  <ChartSkeleton label={t("dashboard.pullRequests.loading")} />
                ) : (
                  <PillBars items={activePrs} />
                )}
              </div>
            </div>
            {hasSlotContent(slots?.TunnelQr) && (
              <div className="tdb-block tdb-side-block tdb-tunnel">
                <div className="tdb-side-head">
                  <div className="tdb-block-title">{t("dashboard.tunnel.title")}</div>
                  {slots?.TunnelMenu}
                </div>
                <div className="tdb-tunnel-body">{slots?.TunnelQr}</div>
              </div>
            )}
          </div>

          {/* The factory and jobs cards share the grid's second row so their
              tops and bottoms always align across the two columns. */}
          <div className="tdb-block tdb-factory">
            <div className="tdb-block-title">{t("dashboard.factory.title")}</div>
            <div className="tdb-factory-body">{slots?.ProcessViewer}</div>
          </div>

          <div className="tdb-block tdb-side-block tdb-jobs">
            <div className="tdb-block-title">{t("dashboard.jobs.title")}</div>
            <div className="tdb-jobs-list hidden-scrollbar">
              {jobs.length === 0 && (
                <div className="tdb-empty-note">{t("dashboard.jobs.empty")}</div>
              )}
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className="tdb-job-row"
                  onClick={() => fireJobEvent(job.id)}
                >
                  <LoaderCircle
                    size={14}
                    className="tdb-job-spinner"
                    data-spinning={job.status === "running"}
                  />
                  {job.planId && (
                    <TuiBadge className="tdb-job-tag" size="md" numeric>
                      {job.planId}
                    </TuiBadge>
                  )}
                  <span className="tdb-job-title">{job.title}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
