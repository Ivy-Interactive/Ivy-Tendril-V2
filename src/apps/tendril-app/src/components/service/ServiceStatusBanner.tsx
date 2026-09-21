import React from "react";
import { Button } from "@ivy-interactive/components/ui";
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
          <span className={`size-1.5 rounded-full ${dotColor}`} />
          <span>{badge}</span>
        </span>
        <span className="text-muted-foreground">
          {serviceInfo?.host || "127.0.0.1"}:{serviceInfo?.port || "N/A"}
        </span>
        {serviceInfo?.ownership && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
            {serviceInfo.ownership}
          </span>
        )}
      </div>

      <div className="flex items-center space-x-2">
        {onRestart && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onRestart}
            className="bg-muted px-2 text-xs text-foreground"
          >
            Restart Service
          </Button>
        )}
        {/* Repair is the one that changes something on the machine, so it keeps the warning tint
            it had — see the note on `UpdateNotice` for why that is a className and not a variant. */}
        {onRepair && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRepair}
            className="border-warning/40 bg-warning/10 px-2 text-xs text-warning hover:bg-warning/20 hover:text-warning"
          >
            Repair Service
          </Button>
        )}
        {onViewDiagnostics && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onViewDiagnostics}
            className="bg-muted px-2 text-xs text-muted-foreground"
          >
            Diagnostics
          </Button>
        )}
      </div>
    </div>
  );
};
