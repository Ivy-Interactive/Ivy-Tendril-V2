import React, { useState, useEffect } from "react";
import { bridge } from "../../api/bridge";
import type { ProvisionReport, ServiceInfo } from "../../types/api";

/**
 * A one-line summary of what an install run did.
 *
 * Every part of a run is independently allowed to fail - one binary can land, the other can fail and
 * autostart can still register - so this reports all of it rather than a bare "done".
 */
function describeProvision(report: ProvisionReport): string {
  const parts: string[] = [];
  if (report.installed.length > 0) {
    parts.push(`Installed ${report.installed.join(", ")} into ${report.binDir}.`);
  } else if (report.upToDate.length > 0) {
    parts.push(`${report.upToDate.join(", ")} already up to date in ${report.binDir}.`);
  }
  if (report.missing.length > 0) {
    parts.push(`This build does not bundle ${report.missing.join(", ")}.`);
  }
  switch (report.autostart.kind) {
    case "registered":
      parts.push(`Registered to start with your session (${report.autostart.detail}).`);
      break;
    case "alreadyRegistered":
      parts.push("Already registered to start with your session.");
      break;
    case "failed":
      parts.push(`Could not register start at login: ${report.autostart.detail}`);
      break;
    case "skipped":
      parts.push(`Start at login skipped: ${report.autostart.detail}`);
      break;
  }
  parts.push(...report.errors);
  return parts.join(" ") || "Nothing to install.";
}

interface ServiceSettingsViewProps {
  serviceInfo: ServiceInfo | null;
  onRefreshHealth: () => Promise<void>;
}

export const ServiceSettingsView: React.FC<ServiceSettingsViewProps> = ({
  serviceInfo,
  onRefreshHealth,
}) => {
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
      setLogs([`Failed to load service logs: ${err instanceof Error ? err.message : String(err)}`]);
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
      setActionMessage("Service restart initiated.");
      void fetchLogs();
    } catch (err) {
      setActionMessage(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
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
      setActionMessage(`Repair failed: ${err instanceof Error ? err.message : String(err)}`);
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
      setActionMessage(describeProvision(report));
      await onRefreshHealth();
      void fetchLogs();
    } catch (err) {
      setActionMessage(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
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
        `Could not disable start at login: ${err instanceof Error ? err.message : String(err)}`,
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
      setActionMessage(`Switched service ownership mode to ${mode}.`);
      void fetchLogs();
    } catch (err) {
      setActionMessage(`Mode switch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const badge = serviceInfo?.statusBadge || serviceInfo?.state || "Disconnected";

  return (
    <div className="space-y-6" data-testid="service-settings-view">
      <div className="rounded-box border border-border bg-card/60 p-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Service Supervision & Controls
            </h2>
            <p className="text-xs text-muted-foreground">
              Manage local companion daemon lifecycle, ownership adoption, and crash recovery.
            </p>
          </div>
          <span className="inline-flex items-center space-x-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground">
            <span>Status:</span>
            <span className="font-semibold text-success">{badge}</span>
          </span>
        </div>

        {actionMessage && (
          <div className="mt-4 rounded bg-background p-2.5 text-xs text-success border border-success/40">
            {actionMessage}
          </div>
        )}

        {/* Action Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isBusy}
            onClick={handleRestart}
            className="rounded-field bg-muted px-3.5 py-2 text-xs font-medium text-accent-foreground hover:bg-accent disabled:opacity-50 transition"
          >
            Restart Service
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handleRepair}
            className="rounded-field bg-warning/80 px-3.5 py-2 text-xs font-medium text-warning-foreground hover:bg-warning/90 disabled:opacity-50 transition"
          >
            Repair Service
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              handleSwitchMode(serviceInfo?.ownership === "Managed" ? "external" : "managed")
            }
            className="rounded-field border border-border bg-background px-3.5 py-2 text-xs font-medium text-foreground hover:bg-card disabled:opacity-50 transition"
          >
            {serviceInfo?.ownership === "Managed"
              ? "Switch to External Daemon"
              : "Adopt Managed Companion"}
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handleInstall}
            title="Copy the bundled daemon into TENDRIL_HOME/bin and start it with your session"
            className="rounded-field border border-border bg-background px-3.5 py-2 text-xs font-medium text-foreground hover:bg-card disabled:opacity-50 transition"
          >
            Install Background Service
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handleDisableAutostart}
            title="Stop the daemon starting at login. The installed binaries stay where they are."
            className="rounded-field border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-card disabled:opacity-50 transition"
          >
            Disable Start at Login
          </button>

          <button
            type="button"
            disabled={isLoadingLogs}
            onClick={fetchLogs}
            className="rounded-field border border-border bg-background px-3.5 py-2 text-xs font-medium text-muted-foreground hover:bg-card disabled:opacity-50 transition"
          >
            {isLoadingLogs ? "Loading Logs..." : "Refresh Logs"}
          </button>
        </div>

        {/* Service Details */}
        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-box border border-border bg-background/60 p-3">
            <dt className="text-muted-foreground/70">Ownership</dt>
            <dd className="mt-1 font-semibold text-foreground">
              {serviceInfo?.ownership || "External / Standalone"}
            </dd>
          </div>
          <div className="rounded-box border border-border bg-background/60 p-3">
            <dt className="text-muted-foreground/70">Endpoint</dt>
            <dd className="mt-1 font-mono text-muted-foreground">
              {serviceInfo?.host || "127.0.0.1"}:{serviceInfo?.port || "N/A"}
            </dd>
          </div>
          <div className="rounded-box border border-border bg-background/60 p-3">
            <dt className="text-muted-foreground/70">Process PID</dt>
            <dd className="mt-1 font-mono text-muted-foreground">{serviceInfo?.pid || "N/A"}</dd>
          </div>
          <div className="rounded-box border border-border bg-background/60 p-3">
            <dt className="text-muted-foreground/70">Crash Count</dt>
            <dd className="mt-1 font-semibold text-foreground">{serviceInfo?.crashCount ?? 0}</dd>
          </div>
        </dl>
      </div>

      {/* Diagnostics Log Viewer */}
      <div className="rounded-box border border-border bg-card/60 p-6">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h3 className="text-sm font-semibold text-foreground">
            Daemon Diagnostics & Service Logs (Sensitive Tokens Redacted)
          </h3>
          <span className="text-xs-tight text-muted-foreground font-mono">
            TENDRIL_HOME/Logs/service.log
          </span>
        </div>

        <div
          data-testid="service-logs-container"
          className="mt-4 max-h-72 overflow-y-auto rounded-box border border-border bg-background p-3 font-mono text-xs text-muted-foreground space-y-1"
        >
          {logs.length === 0 ? (
            <p className="text-muted-foreground/70 italic">No logs recorded yet in service.log.</p>
          ) : (
            logs.map((logLine, idx) => (
              <div key={idx} className="whitespace-pre-wrap break-all leading-relaxed">
                {logLine}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
