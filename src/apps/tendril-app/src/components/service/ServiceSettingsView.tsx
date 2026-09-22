import React, { useState, useEffect } from "react";
import { Badge, Button } from "@ivy-interactive/components/ui";
import { bridge } from "../../api/bridge";
import { SettingsSection } from "../../views/settings/fields";
import type { ProvisionReport, ServiceInfo } from "../../types/api";
import { useTranslation, type TFunction } from "../../i18n";
import { ownershipLabel, serviceStateLabel } from "./ServiceStatusBanner";

/** Paths and file names the copy names. Identifiers, so they travel as variables and are never translated. */
const BIN_DIR = "TENDRIL_HOME/bin";
const LOG_PATH = "TENDRIL_HOME/Logs/service.log";
const LOG_FILE = "service.log";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * A one-line summary of what an install run did.
 *
 * Every part of a run is independently allowed to fail - one binary can land, the other can fail and
 * autostart can still register - so this reports all of it rather than a bare "done".
 *
 * Each part is a whole sentence of its own. The binaries are a `list(type: unit)`, which is a plain
 * comma list in English (`tendril, opencode`), as the `join(", ")` it replaced was. `report.errors`
 * and the autostart `detail` are the native side's own text and are shown as they are.
 */
function describeProvision(t: TFunction<"common">, report: ProvisionReport): string {
  const parts: string[] = [];
  if (report.installed.length > 0) {
    parts.push(
      t("serviceSettings.provision.installed", {
        binaries: report.installed,
        dir: report.binDir,
      }),
    );
  } else if (report.upToDate.length > 0) {
    parts.push(
      t("serviceSettings.provision.upToDate", {
        binaries: report.upToDate,
        dir: report.binDir,
      }),
    );
  }
  if (report.missing.length > 0) {
    parts.push(t("serviceSettings.provision.missing", { binaries: report.missing }));
  }
  switch (report.autostart.kind) {
    case "registered":
      parts.push(t("serviceSettings.provision.registered", { detail: report.autostart.detail }));
      break;
    case "alreadyRegistered":
      parts.push(t("serviceSettings.provision.alreadyRegistered"));
      break;
    case "failed":
      parts.push(
        t("serviceSettings.provision.registerFailed", { detail: report.autostart.detail }),
      );
      break;
    case "skipped":
      parts.push(t("serviceSettings.provision.skipped", { detail: report.autostart.detail }));
      break;
  }
  parts.push(...report.errors);
  return parts.join(" ") || t("serviceSettings.provision.nothing");
}

interface ServiceSettingsViewProps {
  serviceInfo: ServiceInfo | null;
  onRefreshHealth: () => Promise<void>;
}

export const ServiceSettingsView: React.FC<ServiceSettingsViewProps> = ({
  serviceInfo,
  onRefreshHealth,
}) => {
  const { t } = useTranslation("common");
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const fetchLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const data = await bridge.getServiceLogs(100);
      setLogs(data);
    } catch (err) {
      setLogs([t("serviceSettings.logs.loadFailed", { error: errorText(err) })]);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
  }, []);

  const handleRestart = async () => {
    setIsBusy(true);
    setActionMessage(null);
    try {
      await bridge.restartService();
      await onRefreshHealth();
      setActionMessage(t("serviceSettings.messages.restartInitiated"));
      void fetchLogs();
    } catch (err) {
      setActionMessage(t("serviceSettings.messages.restartFailed", { error: errorText(err) }));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRepair = async () => {
    setIsBusy(true);
    setActionMessage(null);
    try {
      const res = await bridge.repairService();
      await onRefreshHealth();
      setActionMessage(res);
      void fetchLogs();
    } catch (err) {
      setActionMessage(t("serviceSettings.messages.repairFailed", { error: errorText(err) }));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Retries the install the app already attempted on first run.
   *
   * That run is silent and best-effort - a locked executable or a LaunchAgents directory that was not
   * writable yet leaves the machine without a daemon and with nothing in the UI to try again with.
   * This is that button.
   */
  const handleInstall = async () => {
    setIsBusy(true);
    setActionMessage(null);
    try {
      const report = await bridge.installService();
      setActionMessage(describeProvision(t, report));
      await onRefreshHealth();
      void fetchLogs();
    } catch (err) {
      setActionMessage(t("serviceSettings.messages.installFailed", { error: errorText(err) }));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisableAutostart = async () => {
    setIsBusy(true);
    setActionMessage(null);
    try {
      setActionMessage(await bridge.uninstallServiceAutostart());
    } catch (err) {
      setActionMessage(
        t("serviceSettings.messages.disableAutostartFailed", { error: errorText(err) }),
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleSwitchMode = async (mode: "managed" | "external") => {
    setIsBusy(true);
    setActionMessage(null);
    try {
      await bridge.switchServiceMode(mode);
      await onRefreshHealth();
      setActionMessage(
        mode === "managed"
          ? t("serviceSettings.messages.switchedToManaged")
          : t("serviceSettings.messages.switchedToExternal"),
      );
      void fetchLogs();
    } catch (err) {
      setActionMessage(t("serviceSettings.messages.switchFailed", { error: errorText(err) }));
    } finally {
      setIsBusy(false);
    }
  };

  // The daemon's own badge text as it is; otherwise the state, in words.
  const badge =
    serviceInfo?.statusBadge || serviceStateLabel(t, serviceInfo?.state || "Disconnected");

  return (
    <div className="space-y-10" data-testid="service-settings-view">
      <SettingsSection
        title={t("serviceSettings.controls.title")}
        hint={t("serviceSettings.controls.hint")}
        action={<Badge variant="secondary">{badge}</Badge>}
      >
        {actionMessage && (
          <div className="rounded bg-background p-2.5 text-xs text-success border border-success/40">
            {actionMessage}
          </div>
        )}

        {/* Action Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={handleRestart}
          >
            {t("serviceSettings.actions.restart")}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="warning"
            disabled={isBusy}
            onClick={handleRepair}
          >
            {t("serviceSettings.actions.repair")}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() =>
              handleSwitchMode(serviceInfo?.ownership === "Managed" ? "external" : "managed")
            }
          >
            {serviceInfo?.ownership === "Managed"
              ? t("serviceSettings.actions.switchToExternal")
              : t("serviceSettings.actions.adoptManaged")}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={handleInstall}
            title={t("serviceSettings.actions.installTooltip", { path: BIN_DIR })}
          >
            {t("serviceSettings.actions.install")}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={handleDisableAutostart}
            title={t("serviceSettings.actions.disableAutostartTooltip")}
          >
            {t("serviceSettings.actions.disableAutostart")}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isLoadingLogs}
            onClick={fetchLogs}
          >
            {isLoadingLogs
              ? t("serviceSettings.actions.loadingLogs")
              : t("serviceSettings.actions.refreshLogs")}
          </Button>
        </div>

        {/* Service Details */}
        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-box border border-border bg-background/60 p-3">
            <dt className="text-foreground">{t("serviceSettings.details.ownership")}</dt>
            <dd className="mt-1 font-semibold text-foreground">
              {serviceInfo?.ownership
                ? ownershipLabel(t, serviceInfo.ownership)
                : t("serviceSettings.details.ownershipFallback")}
            </dd>
          </div>
          <div className="rounded-box border border-border bg-background/60 p-3">
            <dt className="text-foreground">{t("serviceSettings.details.endpoint")}</dt>
            <dd className="mt-1 font-mono text-muted-foreground">
              {serviceInfo?.host || "127.0.0.1"}:
              {serviceInfo?.port || t("serviceSettings.details.notAvailable")}
            </dd>
          </div>
          <div className="rounded-box border border-border bg-background/60 p-3">
            <dt className="text-foreground">{t("serviceSettings.details.pid")}</dt>
            <dd className="mt-1 font-mono text-muted-foreground">
              {serviceInfo?.pid || t("serviceSettings.details.notAvailable")}
            </dd>
          </div>
          <div className="rounded-box border border-border bg-background/60 p-3">
            <dt className="text-foreground">{t("serviceSettings.details.crashCount")}</dt>
            <dd className="mt-1 font-semibold text-foreground">{serviceInfo?.crashCount ?? 0}</dd>
          </div>
        </dl>
      </SettingsSection>

      <SettingsSection
        title={t("serviceSettings.logs.title")}
        hint={t("serviceSettings.logs.hint", { path: LOG_PATH })}
      >
        <div
          data-testid="service-logs-container"
          className="mt-4 max-h-72 overflow-y-auto rounded-box border border-border bg-background p-3 font-mono text-xs text-muted-foreground space-y-1"
        >
          {logs.length === 0 ? (
            <p className="text-muted-foreground/70 italic">
              {t("serviceSettings.logs.empty", { file: LOG_FILE })}
            </p>
          ) : (
            logs.map((logLine, idx) => (
              <div key={idx} className="whitespace-pre-wrap break-all leading-relaxed">
                {logLine}
              </div>
            ))
          )}
        </div>
      </SettingsSection>
    </div>
  );
};
