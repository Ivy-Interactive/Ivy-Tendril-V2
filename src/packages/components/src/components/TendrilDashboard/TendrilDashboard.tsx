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

const formatCurrencyValue = (value: number): string =>
  value >= 1000 ? `$${Math.round(value).toLocaleString("en-US")}` : `$${value.toFixed(2)}`;

const formatPlansValue = (value: number): string =>
  `${Math.round(value)} plan${Math.round(value) === 1 ? "" : "s"}`;

/** The window the trend card plots, matching `DashboardApp.TrendDailyWindowDays`. */
const TREND_NAME = "Last 4 weeks";

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

  const statusItems = [
    { icon: <Feather size={16} />, count: draftCount, label: "Plans", event: "OnDrafts" },
    { icon: <Sprout size={16} />, count: inProgressCount, label: "In Progress", event: "OnJobs" },
    { icon: <Eye size={16} />, count: reviewCount, label: "Ready For Review", event: "OnReview" },
    { icon: <Check size={16} />, count: completedCount, label: "Completed", event: "OnJobs" },
    {
      icon: <MessageSquareWarning size={16} />,
      count: failedCount,
      label: "Failed",
      event: "OnJobs",
    },
  ];

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
                <React.Fragment key={item.label}>
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
                      aria-label={`View calculation breakdown for ${kpi.label}`}
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
                  <ChartSkeleton label="Loading cost and plan trend" />
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
                      Total Cost
                    </button>
                    <button
                      type="button"
                      className="tdb-tab"
                      data-active={tab === "plans"}
                      onClick={() => setTab("plans")}
                    >
                      Total Plans
                    </button>
                  </div>
                  <div className="tdb-trend-sep" />
                  <div className="tdb-legend">
                    <span className="tdb-legend-item">
                      <span className="tdb-legend-dot" />
                      {TREND_NAME}
                    </span>
                    <span className="tdb-legend-item">
                      <span className="tdb-legend-line-avg" />
                      7-day average
                    </span>
                  </div>
                </div>
                <div className="tdb-trend-chart">
                  <TrendChart
                    dates={activeTrend!.dates}
                    values={trendData.values}
                    rolling={trendData.rolling}
                    currentName={TREND_NAME}
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
              <div className="tdb-block-title">Git Activity</div>
              <div className="tdb-side-body">
                {loading ? (
                  <ChartSkeleton label="Loading Git activity" />
                ) : (
                  <ActivityGrid months={activity} />
                )}
              </div>
            </div>
            <div className="tdb-block tdb-side-block">
              <div className="tdb-side-head">
                <div className="tdb-block-title">Pull Requests</div>
                <div className="tdb-tabs tdb-side-tabs">
                  <button
                    type="button"
                    className="tdb-tab tdb-side-tab"
                    data-active={prPeriod === "week"}
                    onClick={() => setPrPeriod("week")}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    className="tdb-tab tdb-side-tab"
                    data-active={prPeriod === "month"}
                    onClick={() => setPrPeriod("month")}
                  >
                    Month
                  </button>
                </div>
              </div>
              <div className="tdb-side-body">
                {loading ? (
                  <ChartSkeleton label="Loading merged pull requests" />
                ) : (
                  <PillBars items={activePrs} />
                )}
              </div>
            </div>
            {hasSlotContent(slots?.TunnelQr) && (
              <div className="tdb-block tdb-side-block tdb-tunnel">
                <div className="tdb-side-head">
                  <div className="tdb-block-title">Tunnel</div>
                  {slots?.TunnelMenu}
                </div>
                <div className="tdb-tunnel-body">{slots?.TunnelQr}</div>
              </div>
            )}
          </div>

          {/* The factory and jobs cards share the grid's second row so their
              tops and bottoms always align across the two columns. */}
          <div className="tdb-block tdb-factory">
            <div className="tdb-block-title">Software Factory</div>
            <div className="tdb-factory-body">{slots?.ProcessViewer}</div>
          </div>

          <div className="tdb-block tdb-side-block tdb-jobs">
            <div className="tdb-block-title">Active Jobs</div>
            <div className="tdb-jobs-list">
              {jobs.length === 0 && <div className="tdb-empty-note">No jobs running</div>}
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
