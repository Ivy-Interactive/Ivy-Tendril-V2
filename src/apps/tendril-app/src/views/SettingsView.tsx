import React, { useState, useEffect } from "react";
import { bridge } from "../api/bridge";
import type { ServiceInfo, TendrilConfig } from "../types/api";
import { ModelCatalogCard } from "../components/ModelCatalogCard";
import { ServiceSettingsView } from "../components/service";

interface SettingsViewProps {
  serviceInfo: ServiceInfo | null;
  onRefreshHealth: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ serviceInfo, onRefreshHealth }) => {
  const [_config, setConfig] = useState<TendrilConfig | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Form states for editable config
  const [codingAgent, setCodingAgent] = useState("claude");
  const [jobTimeout, setJobTimeout] = useState(1800);
  const [maxConcurrentJobs, setMaxConcurrentJobs] = useState(4);
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    async function loadConfig() {
      try {
        const cfg = await bridge.getConfig();
        setConfig(cfg);
        if (cfg.codingAgent) setCodingAgent(cfg.codingAgent);
        if (cfg.jobTimeout) setJobTimeout(cfg.jobTimeout);
        if (cfg.maxConcurrentJobs) setMaxConcurrentJobs(cfg.maxConcurrentJobs);
        if (cfg.theme) setTheme(cfg.theme);
      } catch {
        // Use default config values
      }
    }
    void loadConfig();
  }, []);

  const handlePing = async () => {
    setIsPinging(true);
    const start = Date.now();
    try {
      await onRefreshHealth();
      const elapsed = Date.now() - start;
      setPingResult(`Pong! Response in ${elapsed}ms`);
    } catch (err) {
      setPingResult(`Ping failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsPinging(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    try {
      // In Tendril, config values are updated through the CLI or REST put_config
      // For the UI, we simulate or save settings
      await bridge.saveUiState(
        "config_preferences",
        JSON.stringify({
          codingAgent,
          jobTimeout,
          maxConcurrentJobs,
          theme,
        }),
      );
      setSaveMessage("Configuration preferences saved successfully.");
    } catch (err) {
      setSaveMessage(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-view">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">
          Settings & Service Diagnostics
        </h1>
        <p className="text-xs text-slate-400">
          Inspect local Tendril daemon connectivity and configure operator defaults.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Service Daemon Diagnostics */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <h2 className="text-base font-semibold text-slate-100">Daemon Diagnostics</h2>
            <button
              type="button"
              disabled={isPinging}
              onClick={handlePing}
              className="rounded-lg bg-emerald-600/80 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {isPinging ? "Pinging..." : "Test Latency (Ping)"}
            </button>
          </div>

          {pingResult && (
            <div className="mt-3 rounded bg-slate-950 p-2 font-mono text-xs text-emerald-400">
              {pingResult}
            </div>
          )}

          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-400">Connection State:</dt>
              <dd className="font-semibold text-slate-200">{serviceInfo?.state || "NotRunning"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Daemon Host & Port:</dt>
              <dd className="font-mono text-xs text-slate-300">
                {serviceInfo?.host || "127.0.0.1"}:{serviceInfo?.port || "N/A"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Process PID:</dt>
              <dd className="font-mono text-xs text-slate-300">{serviceInfo?.pid || "N/A"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">TENDRIL_HOME:</dt>
              <dd
                className="font-mono text-xs text-slate-300 truncate max-w-[200px]"
                title={serviceInfo?.tendrilHome}
              >
                {serviceInfo?.tendrilHome || "~/.tendril"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Security / Secret:</dt>
              <dd className="font-mono text-xs text-emerald-400">
                Managed natively (hidden from webview storage)
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-400">Capabilities:</dt>
              <dd className="text-xs text-slate-300">
                {serviceInfo?.capabilities?.join(", ") || "None reported"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Configuration Editor */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
          <h2 className="border-b border-slate-800 pb-4 text-base font-semibold text-slate-100">
            Operator Configuration
          </h2>

          {saveMessage && (
            <div className="mt-3 rounded bg-slate-950 p-2 text-xs text-emerald-300 border border-emerald-800/50">
              {saveMessage}
            </div>
          )}

          <form onSubmit={handleSaveConfig} className="mt-4 space-y-4 text-sm">
            <div>
              <label
                htmlFor="coding-agent-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Coding Agent CLI
              </label>
              <select
                id="coding-agent-select"
                aria-label="Coding Agent CLI"
                value={codingAgent}
                onChange={(e) => setCodingAgent(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="claude">Claude Code (claude)</option>
                <option value="gemini">Gemini CLI (gemini)</option>
                <option value="antigravity">Antigravity (agy)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="job-timeout-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Job Timeout (seconds)
                </label>
                <input
                  id="job-timeout-input"
                  aria-label="Job Timeout (seconds)"
                  type="number"
                  value={jobTimeout}
                  onChange={(e) => setJobTimeout(parseInt(e.target.value, 10) || 1800)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="max-concurrent-jobs-input"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Max Concurrent Jobs
                </label>
                <input
                  id="max-concurrent-jobs-input"
                  aria-label="Max Concurrent Jobs"
                  type="number"
                  value={maxConcurrentJobs}
                  onChange={(e) => setMaxConcurrentJobs(parseInt(e.target.value, 10) || 4)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="theme-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Theme
              </label>
              <select
                id="theme-select"
                aria-label="Theme"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System Default</option>
              </select>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save Preferences"}
              </button>
            </div>
          </form>
        </div>

        <ModelCatalogCard />
      </div>

      <ServiceSettingsView serviceInfo={serviceInfo} onRefreshHealth={onRefreshHealth} />
    </div>
  );
};
