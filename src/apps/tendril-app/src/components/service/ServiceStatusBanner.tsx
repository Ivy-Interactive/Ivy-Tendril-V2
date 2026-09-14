import React from "react";
import type { ServiceInfo } from "../../types/api";

interface ServiceStatusBannerProps {
  serviceInfo: ServiceInfo | null;
  onRestart?: () => void;
  onRepair?: () => void;
  onViewDiagnostics?: () => void;
}

export const ServiceStatusBanner: React.FC<ServiceStatusBannerProps> = ({
  serviceInfo,
  onRestart,
  onRepair,
  onViewDiagnostics,
}) => {
  const badge =
    serviceInfo?.statusBadge ||
    (serviceInfo?.state === "Connected"
      ? "Connected (External)"
      : serviceInfo?.state || "Disconnected");

  let badgeColor = "bg-rose-500/20 text-rose-300 border-rose-500/30";
  let dotColor = "bg-rose-500";

  if (badge.includes("Connected")) {
    badgeColor = "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    dotColor = "bg-emerald-500";
  } else if (badge.includes("Starting")) {
    badgeColor = "bg-amber-500/20 text-amber-300 border-amber-500/30";
    dotColor = "bg-amber-500 animate-pulse";
  } else if (badge.includes("Degraded")) {
    badgeColor = "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
    dotColor = "bg-yellow-500";
  }

  return (
    <div
      data-testid="service-status-banner"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/80 px-4 py-2 text-xs text-slate-300 backdrop-blur"
    >
      <div className="flex items-center space-x-2.5">
        <span
          data-testid="service-health-badge"
          className={`inline-flex items-center space-x-1.5 rounded-full border px-2.5 py-0.5 font-medium ${badgeColor}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span>{badge}</span>
        </span>
        <span className="text-slate-400">
          {serviceInfo?.host || "127.0.0.1"}:{serviceInfo?.port || "N/A"}
        </span>
        {serviceInfo?.ownership && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {serviceInfo.ownership}
          </span>
        )}
      </div>

      <div className="flex items-center space-x-2">
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 transition"
          >
            Restart Service
          </button>
        )}
        {onRepair && (
          <button
            type="button"
            onClick={onRepair}
            className="rounded bg-amber-900/40 border border-amber-700/50 px-2 py-1 text-xs text-amber-300 hover:bg-amber-800/40 transition"
          >
            Repair Service
          </button>
        )}
        {onViewDiagnostics && (
          <button
            type="button"
            onClick={onViewDiagnostics}
            className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 transition"
          >
            Diagnostics
          </button>
        )}
      </div>
    </div>
  );
};
