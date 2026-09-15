import React, { useState, useEffect } from "react";
import { setThemeGlobal, type Theme } from "@ivy-interactive/components/theme";
import { bridge } from "../api/bridge";
import { notificationsStore } from "../state/notificationsStore";
import { describeBridgeError, type ServiceInfo, type TendrilConfig } from "../types/api";
import { ModelCatalogCard } from "../components/ModelCatalogCard";
import { NewsletterSignup } from "../components/NewsletterSignup";
import { ServiceSettingsView } from "../components/service";
import { VaultSettingsView } from "./VaultSettingsView";

interface SettingsViewProps {
  serviceInfo: ServiceInfo | null;
  onRefreshHealth: () => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ serviceInfo, onRefreshHealth }) => {
  const [config, setConfig] = useState<TendrilConfig | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form states for editable config
  const [codingAgent, setCodingAgent] = useState("claude");
  const [jobTimeout, setJobTimeout] = useState(1800);
  const [maxConcurrentJobs, setMaxConcurrentJobs] = useState(4);
  const [theme, setTheme] = useState("dark");
  // Absent in config.yaml means on, the same default the notifications store applies.
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  const applyConfig = (cfg: TendrilConfig) => {
    setConfig(cfg);
    if (cfg.codingAgent) setCodingAgent(cfg.codingAgent);
    if (cfg.jobTimeout) setJobTimeout(cfg.jobTimeout);
    if (cfg.maxConcurrentJobs) setMaxConcurrentJobs(cfg.maxConcurrentJobs);
    if (cfg.theme) setTheme(cfg.theme);
    setDesktopNotifications(cfg.desktopNotifications ?? true);
  };

  useEffect(() => {
    async function loadConfig() {
      try {
        const cfg = await bridge.getConfig();
        applyConfig(cfg);
      } catch {
        // Use default config values
      }
    }
    void loadConfig();
  }, []);

  const handleThemeChange = (value: string) => {
    setTheme(value);
    // Apply the choice immediately; the form's Save still persists it to config.
    setThemeGlobal(value as Theme);
  };

  // Saved on its own rather than with the preferences form: the store has to be told the moment the
  // setting changes so routing follows without a reload, which is what upstream got from reading the
  // setting at notification time.
  const handleSaveNotifications = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingNotifications(true);
    setNotificationsError(null);

    try {
      await bridge.putConfig("desktopNotifications", desktopNotifications);
      setConfig((prev) => (prev ? { ...prev, desktopNotifications } : prev));
      notificationsStore.setDesktopNotifications(desktopNotifications);
      notificationsStore.notifySuccess("Saved", "Notification settings saved");
    } catch (err) {
      setNotificationsError(`Failed to save: ${describeBridgeError(err)}`);
    } finally {
      setIsSavingNotifications(false);
    }
  };

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
    setSaveError(null);

    // Only changed keys: a full-object overwrite would clobber a concurrent edit to config.yaml.
    const pending: Array<[string, string | number]> = [];
    if (codingAgent !== config?.codingAgent) pending.push(["codingAgent", codingAgent]);
    if (jobTimeout !== config?.jobTimeout) pending.push(["jobTimeout", jobTimeout]);
    if (maxConcurrentJobs !== config?.maxConcurrentJobs)
      pending.push(["maxConcurrentJobs", maxConcurrentJobs]);
    if (theme !== config?.theme) pending.push(["theme", theme]);

    try {
      for (const [key, value] of pending) {
        await bridge.putConfig(key, value);
      }
      // Re-read so the form shows what is actually on disk, not optimistic local state.
      const fresh = await bridge.getConfig();
      applyConfig(fresh);
      setSaveMessage(
        pending.length === 0 ? "No changes to save." : "Configuration saved to config.yaml.",
      );
    } catch (err) {
      setSaveError(`Failed to save: ${describeBridgeError(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-view">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Settings & Service Diagnostics
        </h1>
        <p className="text-xs text-muted-foreground">
          Inspect local Tendril daemon connectivity and configure operator defaults.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Service Daemon Diagnostics */}
        <div className="rounded-xl border border-border bg-card/60 p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <h2 className="text-base font-semibold text-foreground">Daemon Diagnostics</h2>
            <button
              type="button"
              disabled={isPinging}
              onClick={handlePing}
              className="rounded-lg bg-primary/80 px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {isPinging ? "Pinging..." : "Test Latency (Ping)"}
            </button>
          </div>

          {pingResult && (
            <div className="mt-3 rounded bg-background p-2 font-mono text-xs text-success">
              {pingResult}
            </div>
          )}

          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Connection State:</dt>
              <dd className="font-semibold text-foreground">
                {serviceInfo?.state || "NotRunning"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Daemon Host & Port:</dt>
              <dd className="font-mono text-xs text-muted-foreground">
                {serviceInfo?.host || "127.0.0.1"}:{serviceInfo?.port || "N/A"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Process PID:</dt>
              <dd className="font-mono text-xs text-muted-foreground">
                {serviceInfo?.pid || "N/A"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">TENDRIL_HOME:</dt>
              <dd
                className="font-mono text-xs text-muted-foreground truncate max-w-[200px]"
                title={serviceInfo?.tendrilHome}
              >
                {serviceInfo?.tendrilHome || "~/.tendril"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Security / Secret:</dt>
              <dd className="font-mono text-xs text-success">
                Managed natively (hidden from webview storage)
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Capabilities:</dt>
              <dd className="text-xs text-muted-foreground">
                {serviceInfo?.capabilities?.join(", ") || "None reported"}
              </dd>
            </div>
          </dl>
        </div>

        {/* Configuration Editor */}
        <div className="rounded-xl border border-border bg-card/60 p-6">
          <h2 className="border-b border-border pb-4 text-base font-semibold text-foreground">
            Operator Configuration
          </h2>

          {saveMessage && (
            <div className="mt-3 rounded bg-background p-2 text-xs text-success border border-success/50">
              {saveMessage}
            </div>
          )}

          {saveError && (
            <div className="mt-3 rounded bg-background p-2 text-xs text-destructive border border-destructive/50">
              {saveError}
            </div>
          )}

          <form onSubmit={handleSaveConfig} className="mt-4 space-y-4 text-sm">
            <div>
              <label
                htmlFor="coding-agent-select"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Coding Agent CLI
              </label>
              <select
                id="coding-agent-select"
                aria-label="Coding Agent CLI"
                value={codingAgent}
                onChange={(e) => setCodingAgent(e.target.value)}
                className="w-full rounded-lg border border-border bg-background p-2.5 text-xs text-foreground focus:border-ring focus:outline-none"
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
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  Job Timeout (seconds)
                </label>
                <input
                  id="job-timeout-input"
                  aria-label="Job Timeout (seconds)"
                  type="number"
                  value={jobTimeout}
                  onChange={(e) => setJobTimeout(parseInt(e.target.value, 10) || 1800)}
                  className="w-full rounded-lg border border-border bg-background p-2.5 text-xs text-foreground focus:border-ring focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="max-concurrent-jobs-input"
                  className="block text-xs font-medium text-muted-foreground mb-1"
                >
                  Max Concurrent Jobs
                </label>
                <input
                  id="max-concurrent-jobs-input"
                  aria-label="Max Concurrent Jobs"
                  type="number"
                  value={maxConcurrentJobs}
                  onChange={(e) => setMaxConcurrentJobs(parseInt(e.target.value, 10) || 4)}
                  className="w-full rounded-lg border border-border bg-background p-2.5 text-xs text-foreground focus:border-ring focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="theme-select"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Theme
              </label>
              <select
                id="theme-select"
                aria-label="Theme"
                value={theme}
                onChange={(e) => handleThemeChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-background p-2.5 text-xs text-foreground focus:border-ring focus:outline-none"
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
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save Preferences"}
              </button>
            </div>
          </form>
        </div>

        <ModelCatalogCard />

        {/* Notifications */}
        <div
          className="rounded-xl border border-border bg-card/60 p-6"
          data-testid="notifications-card"
        >
          <div className="border-b border-border pb-4">
            <h2 className="text-base font-semibold text-foreground">Notifications</h2>
            <p className="text-xs text-muted-foreground">
              Configure how Tendril notifies you about job completions, failures, and other events.
            </p>
          </div>

          {notificationsError && (
            <div className="mt-3 rounded bg-background p-2 text-xs text-destructive border border-destructive/50">
              {notificationsError}
            </div>
          )}

          <form onSubmit={handleSaveNotifications} className="mt-4 space-y-4 text-sm">
            <label className="flex items-start gap-3" htmlFor="desktop-notifications-checkbox">
              <input
                id="desktop-notifications-checkbox"
                type="checkbox"
                checked={desktopNotifications}
                onChange={(e) => setDesktopNotifications(e.target.checked)}
                className="mt-0.5 size-4 rounded border-border bg-background accent-primary"
              />
              <span>
                <span className="block text-xs font-medium text-foreground">
                  Enable Desktop Notifications
                </span>
                <span className="block text-xs text-muted-foreground">
                  Show native OS notifications when jobs finish. With this off, Tendril shows an
                  in-app toast instead.
                </span>
              </span>
            </label>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSavingNotifications}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {isSavingNotifications ? "Saving..." : "Save Notification Settings"}
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-border bg-card/60 p-6">
          <div className="border-b border-border pb-4">
            <h2 className="text-base font-semibold text-foreground">Newsletter</h2>
            <p className="text-xs text-muted-foreground">
              Subscribe to the Ivy & Tendril newsletter to receive updates, feature highlights, and
              release notes.
            </p>
          </div>
          <div className="mt-4">
            <NewsletterSignup />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/60 p-6">
        <div className="border-b border-border pb-4">
          <h2 className="text-base font-semibold text-foreground">Team Vault</h2>
          <p className="text-xs text-muted-foreground">
            Share projects, skills, MCP servers and security policies with your team through a
            versioned Git repository.
          </p>
        </div>
        <div className="pt-4">
          <VaultSettingsView tendrilHome={serviceInfo?.tendrilHome} />
        </div>
      </div>

      <ServiceSettingsView serviceInfo={serviceInfo} onRefreshHealth={onRefreshHealth} />
    </div>
  );
};
