import React, { useState, useEffect } from "react";
import { bridge } from "../../api/bridge";
import type { ServiceInfo } from "../../types/api";

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
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Service Supervision & Controls
            </h2>
            <p className="text-xs text-slate-400">
              Manage local companion daemon lifecycle, ownership adoption, and crash recovery.
            </p>
          </div>
          <span className="inline-flex items-center space-x-1.5 rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200">
            <span>Status:</span>
            <span className="font-semibold text-emerald-400">{badge}</span>
          </span>
        </div>

        {actionMessage && (
          <div className="mt-4 rounded bg-slate-950 p-2.5 text-xs text-emerald-300 border border-emerald-900/40">
            {actionMessage}
          </div>
        )}

        {/* Action Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isBusy}
            onClick={handleRestart}
            className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 transition"
          >
            Restart Service
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={handleRepair}
            className="rounded-lg bg-amber-600/80 px-3.5 py-2 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition"
          >
            Repair Service
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() =>
              handleSwitchMode(serviceInfo?.ownership === "Managed" ? "external" : "managed")
            }
            className="rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-900 disabled:opacity-50 transition"
          >
            {serviceInfo?.ownership === "Managed"
              ? "Switch to External Daemon"
              : "Adopt Managed Companion"}
          </button>

          <button
            type="button"
            disabled={isLoadingLogs}
            onClick={fetchLogs}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-slate-900 disabled:opacity-50 transition"
          >
            {isLoadingLogs ? "Loading Logs..." : "Refresh Logs"}
          </button>
        </div>

        {/* Service Details */}
        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <dt className="text-slate-500">Ownership</dt>
            <dd className="mt-1 font-semibold text-slate-200">
              {serviceInfo?.ownership || "External / Standalone"}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <dt className="text-slate-500">Endpoint</dt>
            <dd className="mt-1 font-mono text-slate-300">
              {serviceInfo?.host || "127.0.0.1"}:{serviceInfo?.port || "N/A"}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <dt className="text-slate-500">Process PID</dt>
            <dd className="mt-1 font-mono text-slate-300">{serviceInfo?.pid || "N/A"}</dd>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <dt className="text-slate-500">Crash Count</dt>
            <dd className="mt-1 font-semibold text-slate-200">{serviceInfo?.crashCount ?? 0}</dd>
          </div>
        </dl>
      </div>

      {/* Diagnostics Log Viewer */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-sm font-semibold text-slate-200">
            Daemon Diagnostics & Service Logs (Sensitive Tokens Redacted)
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">
            TENDRIL_HOME/Logs/service.log
          </span>
        </div>

        <div
          data-testid="service-logs-container"
          className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-300 space-y-1"
        >
          {logs.length === 0 ? (
            <p className="text-slate-500 italic">No logs recorded yet in service.log.</p>
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
