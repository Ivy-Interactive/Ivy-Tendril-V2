import React, { useState, useEffect } from "react";
import { setThemeGlobal, type Theme } from "@ivy-interactive/components/theme";
import { BrandIcon } from "@ivy-interactive/components/tendril";
import { Button, Input, Label, Switch, Textarea } from "@ivy-interactive/components/ui";
import { Check, Moon, Sun, SunMoon } from "lucide-react";
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

/**
 * The agents the card grid offers, in `CodingAgentSetupView.Agents` order with its labels and its
 * `AgentBranding.IconFor` mapping. Every id is one `build_agent_spec` can launch.
 */
const CODING_AGENTS: { id: string; label: string; icon: string }[] = [
  { id: "claude", label: "Claude", icon: "ClaudeCode" },
  { id: "copilot", label: "Copilot", icon: "Copilot" },
  { id: "codex", label: "Codex", icon: "OpenAI" },
  { id: "gemini", label: "Gemini", icon: "Gemini" },
  { id: "antigravity", label: "Antigravity", icon: "Antigravity" },
  { id: "opencode", label: "OpenCode", icon: "OpenCode" },
];

/** `AppearanceSetupView`'s button row: Light, Dark, System, with its icons and its toast wording. */
const THEME_MODES: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "Light", icon: <Sun className="size-4" aria-hidden="true" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-4" aria-hidden="true" /> },
  { value: "system", label: "System", icon: <SunMoon className="size-4" aria-hidden="true" /> },
];

/**
 * Every editable key on this screen. The field names are the `config.yaml` keys verbatim, so a save
 * can write `putConfig(key, form[key])` without a translation table.
 */
interface SettingsForm {
  codingAgent: string;
  planTemplate: string;
  themeMode: string;
  desktopNotifications: boolean;
  jobTimeout: number;
  staleOutputTimeout: number;
  maxConcurrentJobs: number;
  beta: boolean;
}

/**
 * `TendrilSettings`' own defaults, so an absent key reads the same here as it does daemon-side.
 * `desktopNotifications` absent means on, and `themeMode` absent means system.
 */
const DEFAULTS: SettingsForm = {
  codingAgent: "claude",
  planTemplate: "",
  themeMode: "system",
  desktopNotifications: true,
  jobTimeout: 30,
  staleOutputTimeout: 10,
  maxConcurrentJobs: 20,
  beta: false,
};

/**
 * `themeMode`, `staleOutputTimeout` and `beta` are not on `TendrilConfigDto`, so they are read out of
 * the untouched `raw` config the daemon returns alongside it.
 */
const rawOf = (cfg: TendrilConfig | null, key: string): unknown => cfg?.raw?.[key];

const formOf = (cfg: TendrilConfig | null): SettingsForm => {
  const themeMode = rawOf(cfg, "themeMode");
  const staleOutputTimeout = rawOf(cfg, "staleOutputTimeout");
  const beta = rawOf(cfg, "beta");
  return {
    codingAgent: cfg?.codingAgent || DEFAULTS.codingAgent,
    planTemplate: cfg?.planTemplate ?? DEFAULTS.planTemplate,
    themeMode: typeof themeMode === "string" && themeMode ? themeMode : DEFAULTS.themeMode,
    desktopNotifications: cfg?.desktopNotifications ?? DEFAULTS.desktopNotifications,
    jobTimeout: cfg?.jobTimeout || DEFAULTS.jobTimeout,
    staleOutputTimeout:
      typeof staleOutputTimeout === "number" && staleOutputTimeout > 0
        ? staleOutputTimeout
        : DEFAULTS.staleOutputTimeout,
    maxConcurrentJobs: cfg?.maxConcurrentJobs || DEFAULTS.maxConcurrentJobs,
    beta: typeof beta === "boolean" ? beta : DEFAULTS.beta,
  };
};

/** Section heading and hint, the `Text.Block(...).Bold()` / `Text.Muted(...).Small()` pair V1 opens every setup view with. */
const SectionCard: React.FC<{
  title: string;
  hint?: string;
  testId?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, hint, testId, action, children }) => (
  <div className="rounded-xl border border-border bg-card/60 p-6" data-testid={testId}>
    <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

/** V1 reports a failed save as destructive body text under the fields, not as a toast. */
const SaveError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? <p className="text-xs text-destructive">{message}</p> : null;

/** A number field with V1's `Min`/`Max` bounds and its `Suffix` unit. */
const NumberField: React.FC<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}> = ({ id, label, value, min, max, suffix, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <div className="relative">
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        // Clearing the field parses as NaN, which would make the input uncontrolled; V1's
        // NumberInput has no empty state either, so it falls back to the lower bound.
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10) || min)}
        className={suffix ? "pr-12" : undefined}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  </div>
);

export const SettingsView: React.FC<SettingsViewProps> = ({ serviceInfo, onRefreshHealth }) => {
  // `saved` is what config.yaml last said; `form` is what the operator has typed. Every section's
  // Save is disabled until the two differ, which is V1's `hasChanges` gate.
  const [saved, setSaved] = useState<SettingsForm>(DEFAULTS);
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setError = (section: string, message: string | null) =>
    setErrors((prev) => ({ ...prev, [section]: message }));

  const applyConfig = (cfg: TendrilConfig) => {
    const next = formOf(cfg);
    setSaved(next);
    setForm(next);
  };

  useEffect(() => {
    async function loadConfig() {
      try {
        applyConfig(await bridge.getConfig());
      } catch {
        // Use default config values
      }
    }
    void loadConfig();
  }, []);

  /**
   * One section's Save. Only changed keys are written: a full-object overwrite would clobber a
   * concurrent edit to config.yaml. On success the config is re-read so the form shows what is
   * actually on disk, not optimistic local state; on failure nothing is re-read, so a retry does not
   * need the operator's input again.
   */
  const saveSection = async (
    section: string,
    keys: (keyof SettingsForm)[],
    toastMessage: string,
    onSaved?: () => void,
  ) => {
    setSavingSection(section);
    setError(section, null);
    try {
      for (const key of keys) {
        if (form[key] !== saved[key]) await bridge.putConfig(key, form[key]);
      }
      applyConfig(await bridge.getConfig());
      onSaved?.();
      notificationsStore.notifySuccess("Saved", toastMessage);
    } catch (err) {
      setError(section, `Failed to save: ${describeBridgeError(err)}`);
    } finally {
      setSavingSection(null);
    }
  };

  /**
   * V1's appearance buttons apply and persist on the click, with no form to submit: the theme is a
   * preference you judge by looking at it, so it cannot wait behind a Save.
   */
  const handleThemeMode = async (mode: Theme, label: string) => {
    set("themeMode", mode);
    setThemeGlobal(mode);
    setError("appearance", null);
    try {
      await bridge.putConfig("themeMode", mode);
      setSaved((prev) => ({ ...prev, themeMode: mode }));
      notificationsStore.notifySuccess("Saved", `Appearance set to ${label}`);
    } catch (err) {
      setError("appearance", `Failed to save: ${describeBridgeError(err)}`);
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

  const agentChanged = form.codingAgent !== saved.codingAgent;
  const planChanged = form.planTemplate !== saved.planTemplate;
  const notificationsChanged = form.desktopNotifications !== saved.desktopNotifications;
  const advancedChanged =
    form.jobTimeout !== saved.jobTimeout ||
    form.staleOutputTimeout !== saved.staleOutputTimeout ||
    form.maxConcurrentJobs !== saved.maxConcurrentJobs ||
    form.beta !== saved.beta;

  return (
    <div className="space-y-6" data-testid="settings-view">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Configuration</h1>

      {/* Section order follows `SettingsApp.Build`: Coding Agent, Plans, Appearance, Team Vault,
          Notifications, Advanced, Newsletter. The daemon cards after that have no V1 counterpart. */}
      <SectionCard
        title="Coding Agent"
        hint="Tendril connects to your configured AI coding agent or bundled open source engines like OpenCode."
        testId="coding-agent-card"
      >
        <form
          className="max-w-170 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveSection("codingAgent", ["codingAgent"], "Coding agent settings saved");
          }}
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {CODING_AGENTS.map((agent) => {
              const selected = form.codingAgent === agent.id;
              return (
                <button
                  key={agent.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => set("codingAgent", agent.id)}
                  data-testid={`coding-agent-${agent.id}`}
                  className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <BrandIcon name={agent.icon} size={32} className="text-foreground" />
                  <span className="text-sm font-medium text-foreground">{agent.label}</span>
                  {selected && <Check className="ml-auto size-4 text-primary" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <SaveError message={errors.codingAgent ?? null} />

          <Button type="submit" disabled={!agentChanged || savingSection === "codingAgent"}>
            {savingSection === "codingAgent" ? "Saving..." : "Save"}
          </Button>
        </form>
      </SectionCard>

      <ModelCatalogCard />

      <SectionCard
        title="Plans"
        hint="Configure the default plan template used when creating new plans."
        testId="plans-settings-card"
      >
        <form
          className="max-w-120 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveSection("planTemplate", ["planTemplate"], "Plan template saved");
          }}
        >
          <div className="space-y-1">
            <Label
              htmlFor="plan-template-input"
              className="text-xs font-medium text-muted-foreground"
            >
              Plan Template
            </Label>
            <Textarea
              id="plan-template-input"
              placeholder="Plan template..."
              value={form.planTemplate}
              onChange={(e) => set("planTemplate", e.target.value)}
              className="h-80 font-mono text-xs"
            />
          </div>

          <SaveError message={errors.planTemplate ?? null} />

          <Button type="submit" disabled={!planChanged || savingSection === "planTemplate"}>
            {savingSection === "planTemplate" ? "Saving..." : "Save"}
          </Button>
        </form>
      </SectionCard>

      <SectionCard
        title="Appearance"
        hint="Choose how Tendril appears. System matches your OS setting."
        testId="appearance-card"
      >
        <div className="max-w-120 space-y-4">
          <div className="flex flex-wrap gap-2">
            {THEME_MODES.map((mode) => (
              <Button
                key={mode.value}
                type="button"
                variant={form.themeMode === mode.value ? "default" : "outline"}
                aria-pressed={form.themeMode === mode.value}
                onClick={() => void handleThemeMode(mode.value, mode.label)}
              >
                {mode.icon}
                {mode.label}
              </Button>
            ))}
          </div>

          <SaveError message={errors.appearance ?? null} />
        </div>
      </SectionCard>

      <SectionCard
        title="Team Configuration Vault"
        hint="Share and synchronize Tendril projects, custom skills, MCP servers, and security rules across your team via a versioned Git repository."
      >
        <VaultSettingsView tendrilHome={serviceInfo?.tendrilHome} />
      </SectionCard>

      <SectionCard
        title="Notification Settings"
        hint="Configure how Tendril notifies you about job completions, failures, and other events."
        testId="notifications-card"
      >
        <form
          className="max-w-120 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            // The store has to be told the moment the setting is saved so routing follows without a
            // reload, which is what reading the setting at notification time gave V1.
            void saveSection(
              "desktopNotifications",
              ["desktopNotifications"],
              "Notification settings saved",
              () => notificationsStore.setDesktopNotifications(form.desktopNotifications),
            );
          }}
        >
          <div className="flex items-center gap-3">
            <Switch
              id="desktop-notifications-switch"
              aria-labelledby="desktop-notifications-label"
              checked={form.desktopNotifications}
              onCheckedChange={(checked) => set("desktopNotifications", checked)}
            />
            <Label
              id="desktop-notifications-label"
              htmlFor="desktop-notifications-switch"
              className="text-xs font-medium text-foreground"
            >
              Enable Desktop Notifications
            </Label>
          </div>

          <SaveError message={errors.desktopNotifications ?? null} />

          <Button
            type="submit"
            disabled={!notificationsChanged || savingSection === "desktopNotifications"}
          >
            {savingSection === "desktopNotifications" ? "Saving..." : "Save"}
          </Button>
        </form>
      </SectionCard>

      <SectionCard
        title="Advanced Settings"
        hint="Configure timeouts and concurrency limits."
        testId="advanced-settings-card"
      >
        <form
          className="max-w-120 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveSection(
              "advanced",
              ["jobTimeout", "staleOutputTimeout", "maxConcurrentJobs", "beta"],
              "Settings saved and applied",
            );
          }}
        >
          <h3 className="text-sm font-semibold text-foreground">Timeouts</h3>
          <NumberField
            id="job-timeout-input"
            label="Job Timeout"
            value={form.jobTimeout}
            min={1}
            max={120}
            suffix="min"
            onChange={(value) => set("jobTimeout", value)}
          />
          <NumberField
            id="stale-output-timeout-input"
            label="Stale Output Timeout"
            value={form.staleOutputTimeout}
            min={1}
            max={60}
            suffix="min"
            onChange={(value) => set("staleOutputTimeout", value)}
          />
          <NumberField
            id="max-concurrent-jobs-input"
            label="Max Concurrent Jobs"
            value={form.maxConcurrentJobs}
            min={1}
            max={512}
            onChange={(value) => set("maxConcurrentJobs", value)}
          />

          <h3 className="text-sm font-semibold text-foreground">Beta Features</h3>
          <div className="flex items-center gap-3">
            <Switch
              id="beta-switch"
              aria-labelledby="beta-label"
              checked={form.beta}
              onCheckedChange={(checked) => set("beta", checked)}
            />
            <Label
              id="beta-label"
              htmlFor="beta-switch"
              className="text-xs font-medium text-foreground"
            >
              Opt-in to beta features
            </Label>
          </div>

          <p className="text-xs text-muted-foreground">
            A Tendril restart is required for changes to take effect.
          </p>

          <SaveError message={errors.advanced ?? null} />

          <Button type="submit" disabled={!advancedChanged || savingSection === "advanced"}>
            {savingSection === "advanced" ? "Saving..." : "Save"}
          </Button>
        </form>
      </SectionCard>

      <SectionCard
        title="Newsletter"
        hint="Subscribe to the Ivy & Tendril newsletter to receive updates, feature highlights, and release notes."
      >
        <NewsletterSignup />
      </SectionCard>

      {/* No V1 counterpart: V2 supervises the daemon itself, so its diagnostics live here rather
          than in the C# app, and they sit after every ported section. */}
      <SectionCard
        title="Daemon Diagnostics"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPinging}
            onClick={handlePing}
          >
            {isPinging ? "Pinging..." : "Test Latency (Ping)"}
          </Button>
        }
      >
        {pingResult && (
          <div className="mb-3 rounded bg-background p-2 font-mono text-xs text-success">
            {pingResult}
          </div>
        )}

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Connection State:</dt>
            <dd className="font-semibold text-foreground">{serviceInfo?.state || "NotRunning"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Daemon Host & Port:</dt>
            <dd className="font-mono text-xs text-muted-foreground">
              {serviceInfo?.host || "127.0.0.1"}:{serviceInfo?.port || "N/A"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Process PID:</dt>
            <dd className="font-mono text-xs text-muted-foreground">{serviceInfo?.pid || "N/A"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">TENDRIL_HOME:</dt>
            <dd
              className="max-w-50 truncate font-mono text-xs text-muted-foreground"
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
      </SectionCard>

      <ServiceSettingsView serviceInfo={serviceInfo} onRefreshHealth={onRefreshHealth} />
    </div>
  );
};
