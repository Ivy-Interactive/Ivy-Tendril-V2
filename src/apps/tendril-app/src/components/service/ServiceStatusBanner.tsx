import React from "react";
import { Button } from "@ivy-interactive/components/ui";
import type { ServiceInfo } from "../../types/api";
import { useTranslation, type TFunction } from "../../i18n";

const SERVICE_STATE_LABEL_KEYS = {
  Connected: "service.state.connected",
  Disconnected: "service.state.disconnected",
  Unauthenticated: "service.state.unauthenticated",
  NotRunning: "service.state.notRunning",
  ForeignMaster: "service.state.foreignMaster",
} as const;

const OWNERSHIP_LABEL_KEYS = {
  AdoptedExternal: "service.ownership.adoptedExternal",
  Managed: "service.ownership.managed",
} as const;

/**
 * The words for the daemon's connection state (`ServiceInfo.state`), which the banner and the
 * Service pane show when the daemon supplies no `statusBadge` of its own. English is the raw value,
 * as before; a value this build does not know is shown as it is. Only the text is looked up - the
 * colour logic keeps reading the raw value.
 */
export const serviceStateLabel = (t: TFunction<"common">, state: string): string =>
  Object.hasOwn(SERVICE_STATE_LABEL_KEYS, state)
    ? t(SERVICE_STATE_LABEL_KEYS[state as keyof typeof SERVICE_STATE_LABEL_KEYS])
    : state;

/** The words for `ServiceInfo.ownership`, on the same terms as {@link serviceStateLabel}. */
export const ownershipLabel = (t: TFunction<"common">, ownership: string): string =>
  Object.hasOwn(OWNERSHIP_LABEL_KEYS, ownership)
    ? t(OWNERSHIP_LABEL_KEYS[ownership as keyof typeof OWNERSHIP_LABEL_KEYS])
    : ownership;

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
  const { t } = useTranslation("common");

  /* The colour is read off the raw, English value - the daemon's own `statusBadge` or its `state` -
     so it is the same in every language. What the badge says is looked up separately: the daemon's
     badge is its own text and is shown as it is, and only the words this banner supplies itself are
     translated. */
  const badge =
    serviceInfo?.statusBadge ||
    (serviceInfo?.state === "Connected"
      ? "Connected (External)"
      : serviceInfo?.state || "Disconnected");
  const badgeLabel =
    serviceInfo?.statusBadge ||
    (serviceInfo?.state === "Connected"
      ? t("serviceStatus.connectedExternal")
      : serviceStateLabel(t, serviceInfo?.state || "Disconnected"));

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
          <span>{badgeLabel}</span>
        </span>
        <span className="text-muted-foreground">
          {serviceInfo?.host || "127.0.0.1"}:
          {serviceInfo?.port || t("serviceStatus.portUnavailable")}
        </span>
        {serviceInfo?.ownership && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
            {ownershipLabel(t, serviceInfo.ownership)}
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
            {t("serviceStatus.restart")}
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
            {t("serviceStatus.repair")}
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
            {t("serviceStatus.diagnostics")}
          </Button>
        )}
      </div>
    </div>
  );
};
