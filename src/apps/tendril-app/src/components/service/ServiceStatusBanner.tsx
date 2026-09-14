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

  let badgeColor = "bg-destructive/20 text-destructive border-destructive/30";
  let dotColor = "bg-destructive";

  if (badge.includes("Connected")) {
    badgeColor = "bg-success/20 text-success border-success/30";
    dotColor = "bg-success";
  } else if (badge.includes("Starting")) {
    badgeColor = "bg-warning/20 text-warning border-warning/30";
    dotColor = "bg-warning animate-pulse";
  } else if (badge.includes("Degraded")) {
    badgeColor = "bg-warning/20 text-warning border-warning/30";
    dotColor = "bg-warning";
  }

  return (
    <div
      data-testid="service-status-banner"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/80 px-4 py-2 text-xs text-muted-foreground backdrop-blur"
    >
      <div className="flex items-center space-x-2.5">
        <span
          data-testid="service-health-badge"
          className={`inline-flex items-center space-x-1.5 rounded-full border px-2.5 py-0.5 font-medium ${badgeColor}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span>{badge}</span>
        </span>
        <span className="text-muted-foreground">
          {serviceInfo?.host || "127.0.0.1"}:{serviceInfo?.port || "N/A"}
        </span>
        {serviceInfo?.ownership && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {serviceInfo.ownership}
          </span>
        )}
      </div>

      <div className="flex items-center space-x-2">
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="rounded bg-muted px-2 py-1 text-xs text-foreground hover:bg-accent transition"
          >
            Restart Service
          </button>
        )}
        {onRepair && (
          <button
            type="button"
            onClick={onRepair}
            className="rounded bg-warning/10 border border-warning/40 px-2 py-1 text-xs text-warning hover:bg-warning/20 transition"
          >
            Repair Service
          </button>
        )}
        {onViewDiagnostics && (
          <button
            type="button"
            onClick={onViewDiagnostics}
            className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition"
          >
            Diagnostics
          </button>
        )}
      </div>
    </div>
  );
};
