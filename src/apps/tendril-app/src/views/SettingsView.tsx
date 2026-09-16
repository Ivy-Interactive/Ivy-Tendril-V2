import React, { useState, useEffect } from "react";
import { setThemeGlobal, type Theme } from "@ivy-interactive/components/theme";
import { BrandIcon } from "@ivy-interactive/components/tendril";
import {
  Button,
  Callout,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@ivy-interactive/components/ui";
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

/**
 * The bounds `ConfigCommand.ApplyField` enforces and `ConfigService.ValidateSettings` re-checks on
 * load. They are validated here because nothing on the V2 write path does: `PUT /api/config` only
 * checks that the merged file still deserializes, and V2 has no load-time clamp, so an out-of-range
 * value written from this screen would be honoured rather than reset to a default.
 */
const NUMERIC_BOUNDS: Partial<Record<keyof SettingsForm, [number, number]>> = {
  jobTimeout: [1, 480],
  staleOutputTimeout: [1, 60],
  maxConcurrentJobs: [1, 512],
};

/** `ConfigCommand.ParseBoundedInt`'s two refusals, verbatim. */
function boundsError(key: keyof SettingsForm, value: unknown): string | null {
  const bounds = NUMERIC_BOUNDS[key];
  if (!bounds) return null;
  const [min, max] = bounds;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `${key} must be an integer, got '${String(value)}'.`;
  }
  if (value < min || value > max) return `${key} must be between ${min} and ${max}, got ${value}.`;
  return null;
}

/** `resolution.rs`'s `normalize_agent_name`: `claudecode` is the legacy spelling of `claude`. */
const normalizeAgentName = (name: string): string => {
  const lower = name.trim().toLowerCase();
  return lower === "claudecode" ? "claude" : lower;
};

/** `ConfigCommand.ValidateCodingAgent`'s refusal, with the same sorted valid-agent list. */
const unknownAgentMessage = (value: string): string =>
  `Unknown coding agent '${value}'. Valid agents: ${CODING_AGENTS.map((a) => a.id)
    .slice()
    .sort()
    .join(", ")}`;

/** The three tiers `apply_profile` maps by name, in `CodingAgentSetupView`'s order. */
const PROFILE_TIERS = ["deep", "balanced", "quick"] as const;
type ProfileTier = (typeof PROFILE_TIERS)[number];

/**
 * `resolution.rs`'s `default_profiles`, so an empty field can show what the tier falls back to
 * rather than looking like "nothing will be passed".
 */
const TIER_DEFAULTS: Record<string, Record<ProfileTier, { model: string; effort: string }>> = {
  claude: {
    deep: { model: "opus", effort: "max" },
    balanced: { model: "sonnet", effort: "high" },
    quick: { model: "haiku", effort: "low" },
  },
  codex: {
    deep: { model: "gpt-5.6-sol", effort: "high" },
    balanced: { model: "gpt-5.6-terra", effort: "medium" },
    quick: { model: "gpt-5.6-luna", effort: "low" },
  },
  gemini: {
    deep: { model: "gemini-3.7-flash", effort: "" },
    balanced: { model: "gemini-3.7-flash", effort: "" },
    quick: { model: "gemini-3.7-flash", effort: "" },
  },
  opencode: {
    deep: { model: "default", effort: "high" },
    balanced: { model: "default", effort: "medium" },
    quick: { model: "default", effort: "low" },
  },
  copilot: {
    deep: { model: "", effort: "high" },
    balanced: { model: "", effort: "medium" },
    quick: { model: "", effort: "low" },
  },
  antigravity: {
    deep: { model: "gemini-3.7-flash", effort: "medium" },
    balanced: { model: "gemini-3.7-flash", effort: "medium" },
    quick: { model: "gemini-3.7-flash", effort: "medium" },
  },
};

const tierDefaults = (agent: string) =>
  TIER_DEFAULTS[normalizeAgentName(agent)] ?? TIER_DEFAULTS.claude;

/** `agent_capabilities`: Gemini's CLI has no effort argument, so an effort field there is inert. */
const supportsEffort = (agent: string): boolean => normalizeAgentName(agent) !== "gemini";

/** `Default` plus the efforts `default_profiles` actually uses. `default` means "leave it unset". */
const EFFORT_OPTIONS = ["default", "low", "medium", "high", "max"];

/** One `codingAgents` entry, with every key it also carried preserved for the write-back. */
interface AgentEntry {
  name: string;
  arguments: string;
  environmentVariables: Record<string, string>;
  profiles: Record<string, unknown>[];
  rest: Record<string, unknown>;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

const asStringMap = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

/**
 * Reads `codingAgents` out of the raw config, tolerating both shapes `deserialize_coding_agents`
 * accepts: a sequence of entries, or a mapping of agent name to entry.
 */
function readAgentEntries(cfg: TendrilConfig | null): AgentEntry[] {
  const raw = cfg?.raw?.codingAgents;
  const entries: [string, Record<string, unknown>][] = Array.isArray(raw)
    ? raw.map((item) => [asString(asRecord(item).name), asRecord(item)])
    : Object.entries(asRecord(raw)).map(([key, value]) => [
        asString(asRecord(value).name) || key,
        asRecord(value),
      ]);

  return entries
    .filter(([name]) => name !== "")
    .map(([name, entry]) => {
      const { name: _n, arguments: _a, environmentVariables: _e, profiles: _p, ...rest } = entry;
      return {
        name,
        arguments: asString(entry.arguments),
        environmentVariables: asStringMap(entry.environmentVariables),
        profiles: Array.isArray(entry.profiles) ? entry.profiles.map(asRecord) : [],
        rest,
      };
    });
}

/** `CodingAgentSetupView.GetProfileModel`: an unset model reads back as the literal `default`. */
function profileValue(entry: AgentEntry | undefined, tier: ProfileTier, field: "model" | "effort") {
  const profile = entry?.profiles.find((p) => asString(p.name).toLowerCase() === tier);
  const value = asString(profile?.[field]);
  return value.trim() === "" ? "default" : field === "effort" ? value.toLowerCase() : value;
}

/**
 * The `codingAgents` array to write, with `agent`'s three tier profiles set and every other agent
 * (and every unmodeled key) left exactly as it was. The whole array has to be sent because
 * `merge_config_value` replaces sequences rather than merging them.
 */
function withProfiles(
  entries: AgentEntry[],
  agent: string,
  profiles: Record<ProfileTier, { model: string; effort: string }>,
  extraArguments: string,
  environmentVariables: Record<string, string>,
): Record<string, unknown>[] {
  const id = normalizeAgentName(agent);
  const known = entries.some((e) => normalizeAgentName(e.name) === id);
  const target: AgentEntry[] = known
    ? entries
    : [...entries, { name: id, arguments: "", environmentVariables: {}, profiles: [], rest: {} }];

  return target.map((entry) => {
    const serialized: Record<string, unknown> = {
      ...entry.rest,
      name: entry.name,
      arguments: entry.arguments,
      environmentVariables: entry.environmentVariables,
      profiles: entry.profiles,
    };
    if (normalizeAgentName(entry.name) !== id) return serialized;

    // `SetProfile` upserts by name and normalises `default`/blank effort to the empty string, which
    // is what `is_set` in `resolution.rs` treats as "leave it to the CLI".
    const nextProfiles = entry.profiles.map((p) => ({ ...p }));
    for (const tier of PROFILE_TIERS) {
      const model = profiles[tier].model.trim();
      const effort = profiles[tier].effort.trim();
      const next = {
        model: model.toLowerCase() === "default" ? "" : model,
        effort: effort.toLowerCase() === "default" ? "" : effort.toLowerCase(),
      };
      const index = nextProfiles.findIndex((p) => asString(p.name).toLowerCase() === tier);
      if (index >= 0) nextProfiles[index] = { ...nextProfiles[index], ...next };
      else nextProfiles.push({ name: tier, ...next });
    }

    return {
      ...serialized,
      arguments: extraArguments,
      environmentVariables,
      profiles: nextProfiles,
    };
  });
}

/** `key=value` lines, the shape V1's env editors use, into the map `AgentConfig` stores. */
function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const formatEnvLines = (env: Record<string, string>): string =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

/** Newline-separated list <-> string array, matching how V1's `ToCodeInput` tool editors split. */
const parseLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/**
 * One `promptwares` entry. `_default` is the reserved key `resolve_tools` and `resolve_agent_config`
 * apply to every promptware, so it is offered alongside the named ones.
 */
interface PromptwareEntry {
  key: string;
  profile: string;
  allowedTools: string[];
  deniedTools: string[];
  rest: Record<string, unknown>;
}

/** The reserved key, spelled as `resolution.rs`'s `DEFAULT_PROMPTWARE_KEY`. */
const DEFAULT_PROMPTWARE_KEY = "_default";

/** The promptwares `BUILT_IN_EXTRA_TOOLS` and the job types name, offered as suggestions. */
const BUILT_IN_PROMPTWARES = [
  "CreatePlan",
  "ExpandPlan",
  "SplitPlan",
  "ExecutePlan",
  "RetryPlan",
  "ReviewPlan",
  "IvyFrameworkVerification",
];

function readPromptwares(cfg: TendrilConfig | null): PromptwareEntry[] {
  return Object.entries(asRecord(cfg?.raw?.promptwares)).map(([key, value]) => {
    const entry = asRecord(value);
    const { profile: _p, allowedTools: _a, deniedTools: _d, ...rest } = entry;
    return {
      key,
      profile: asString(entry.profile),
      allowedTools: Array.isArray(entry.allowedTools) ? entry.allowedTools.map(asString) : [],
      deniedTools: Array.isArray(entry.deniedTools) ? entry.deniedTools.map(asString) : [],
      rest,
    };
  });
}

/** `SandboxMode`, in the spelling `normalize_enum_token` canonicalises to. */
const SANDBOX_MODES = ["InheritGeneral", "Enabled", "Disabled"];
const SECURITY_PRESETS = ["Custom", "Permissive", "Restricted", "Strict"];
const OUTSIDE_FILE_POLICIES = ["Allow", "Ask", "Deny"];
const TERMINAL_AUTO_EXECUTIONS = ["InheritGeneral", "AlwaysProceed", "AlwaysAsk"];
const AUTO_IMPLEMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "AutoImplementPlans", label: "Auto-Implement Plans" },
  { value: "AlwaysAskReview", label: "Always Ask Review" },
];

/** The seven flattened agent security keys of one project, plus its review policy. */
interface ProjectSecurityForm {
  sandboxMode: string;
  securityPreset: string;
  outsideFileAccessPolicy: string;
  terminalAutoExecution: string;
  filePermissions: { path: string; mode: string }[];
  networkAccessRules: { urlPattern: string; mode: string }[];
  allowedTerminalCommands: string[];
  autoImplementPlans: string;
}

interface ProjectEntry {
  name: string;
  security: ProjectSecurityForm;
}

const oneOf = (value: unknown, options: string[], fallback: string): string => {
  const token = asString(value)
    .replace(/[\s_-]/g, "")
    .toLowerCase();
  return options.find((option) => option.toLowerCase() === token) ?? fallback;
};

function readProjects(cfg: TendrilConfig | null): ProjectEntry[] {
  const raw = cfg?.raw?.projects;
  if (!Array.isArray(raw)) return [];
  return raw
    .map(asRecord)
    .filter((entry) => asString(entry.name) !== "")
    .map((entry) => ({
      name: asString(entry.name),
      security: {
        sandboxMode: oneOf(entry.sandboxMode, SANDBOX_MODES, "InheritGeneral"),
        securityPreset: oneOf(entry.securityPreset, SECURITY_PRESETS, "Custom"),
        outsideFileAccessPolicy: oneOf(
          entry.outsideFileAccessPolicy,
          OUTSIDE_FILE_POLICIES,
          "Allow",
        ),
        terminalAutoExecution: oneOf(
          entry.terminalAutoExecution,
          TERMINAL_AUTO_EXECUTIONS,
          "InheritGeneral",
        ),
        filePermissions: (Array.isArray(entry.filePermissions) ? entry.filePermissions : [])
          .map(asRecord)
          .map((rule) => ({
            path: asString(rule.path),
            mode: oneOf(rule.mode, OUTSIDE_FILE_POLICIES, "Allow"),
          }))
          .filter((rule) => rule.path !== ""),
        networkAccessRules: (Array.isArray(entry.networkAccessRules)
          ? entry.networkAccessRules
          : []
        )
          .map(asRecord)
          .map((rule) => ({
            urlPattern: asString(rule.urlPattern),
            mode: oneOf(rule.mode, OUTSIDE_FILE_POLICIES, "Allow"),
          }))
          .filter((rule) => rule.urlPattern !== ""),
        allowedTerminalCommands: (Array.isArray(entry.allowedTerminalCommands)
          ? entry.allowedTerminalCommands
          : []
        )
          .map(asString)
          .filter((cmd) => cmd !== ""),
        autoImplementPlans:
          asString(entry.autoImplementPlans) === "AutoImplementPlans" ||
          asString(entry.autoImplementPlans) === "Auto-Implement Plans"
            ? "AutoImplementPlans"
            : "AlwaysAskReview",
      },
    }));
}

/** `AgentSecurityConfig::effective_sandbox_mode`: a preset wins over the explicit field. */
const effectiveSandboxMode = (s: ProjectSecurityForm): string => {
  if (s.securityPreset === "Permissive") return "Disabled";
  if (s.securityPreset === "Strict" || s.securityPreset === "Restricted") return "Enabled";
  return s.sandboxMode === "InheritGeneral" ? "Disabled" : s.sandboxMode;
};

/** `effective_outside_file_access`, same precedence. */
const effectiveOutsideFileAccess = (s: ProjectSecurityForm): string => {
  if (s.securityPreset === "Permissive") return "Allow";
  if (s.securityPreset === "Strict") return "Deny";
  if (s.securityPreset === "Restricted") return "Ask";
  return s.outsideFileAccessPolicy;
};

/** `effective_terminal_auto_execution`: independent of the preset, `InheritGeneral` proceeds. */
const effectiveTerminalAutoExecution = (s: ProjectSecurityForm): string =>
  s.terminalAutoExecution === "InheritGeneral" ? "AlwaysProceed" : s.terminalAutoExecution;

/** `is_network_allowed`: `Strict`, or any single deny rule, denies network access outright. */
const effectiveNetworkAllowed = (s: ProjectSecurityForm): boolean =>
  s.securityPreset !== "Strict" &&
  !s.networkAccessRules.some((rule) => rule.mode.toLowerCase() === "deny");

/**
 * Which of the fields `apply_security_settings` populates each provider's `build_*_spec` actually
 * renders into its command line. Read straight off `providers.rs`; a control the selected agent does
 * not honour is called out in the UI rather than left looking effective.
 */
const SECURITY_ENFORCEMENT: Record<
  string,
  { sandbox: boolean; network: boolean; terminalPrompt: boolean; fileRules: boolean }
> = {
  claude: { sandbox: true, network: true, terminalPrompt: true, fileRules: true },
  codex: { sandbox: true, network: true, terminalPrompt: false, fileRules: true },
  gemini: { sandbox: true, network: false, terminalPrompt: true, fileRules: true },
  antigravity: { sandbox: true, network: false, terminalPrompt: false, fileRules: true },
  copilot: { sandbox: false, network: false, terminalPrompt: false, fileRules: true },
  opencode: { sandbox: false, network: false, terminalPrompt: false, fileRules: false },
};

const enforcementFor = (agent: string) =>
  SECURITY_ENFORCEMENT[normalizeAgentName(agent)] ?? {
    sandbox: false,
    network: false,
    terminalPrompt: false,
    fileRules: false,
  };

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
    // A present number is shown as-is, including `0` and anything out of bounds. Substituting the
    // default would show a timeout the daemon is not using: V2 reads `jobTimeout <= 0` as "no
    // timeout at all", and unlike V1 it has no load-time clamp to fall back on.
    jobTimeout: typeof cfg?.jobTimeout === "number" ? cfg.jobTimeout : DEFAULTS.jobTimeout,
    staleOutputTimeout:
      typeof staleOutputTimeout === "number" ? staleOutputTimeout : DEFAULTS.staleOutputTimeout,
    maxConcurrentJobs:
      typeof cfg?.maxConcurrentJobs === "number"
        ? cfg.maxConcurrentJobs
        : DEFAULTS.maxConcurrentJobs,
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

/** A labelled select, the `WithField().Label(...)` wrapper V1 puts round every `ToSelectInput`. */
const SelectField: React.FC<{
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  hint?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}> = ({ id, label, value, options, hint, disabled, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

/** A labelled multiline field, for the newline-separated lists V1 edits with `ToCodeInput`. */
const LinesField: React.FC<{
  id: string;
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}> = ({ id, label, value, hint, placeholder, onChange }) => (
  <div className="space-y-1">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {label}
    </Label>
    <Textarea
      id={id}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-24 font-mono text-xs"
    />
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const asOptions = (values: string[]): { value: string; label: string }[] =>
  values.map((value) => ({ value, label: value }));

/**
 * `PromptwaresSetupView` plus its `EditPromptwareDialogContent`, as one inline editor.
 *
 * Two deliberate departures from the original, both forced by how V2 writes config: the entries are
 * edited in place rather than in a dialog (this area owns no dialog files), and there is no Delete.
 * `merge_config_value` deep-merges mappings, so a `promptwares` payload can add and change keys but
 * cannot remove one; Reset clears the entry's settings instead, which is what makes
 * `resolve_tools`/`resolve_agent_config` skip it.
 */
const PromptwaresCard: React.FC<{
  config: TendrilConfig | null;
  profileOptions: string[];
  onSave: (key: string, value: unknown) => Promise<void>;
}> = ({ config, profileOptions, onSave }) => {
  const entries = React.useMemo(() => readPromptwares(config), [config]);
  const [selected, setSelected] = React.useState<string>(DEFAULT_PROMPTWARE_KEY);
  const [draft, setDraft] = React.useState({ profile: "", allowed: "", denied: "" });
  const [newName, setNewName] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const current = entries.find((entry) => entry.key === selected);

  // Re-seeded from config on every load and every selection change, so the editor always shows what
  // is on disk for the selected key rather than the previous key's values.
  React.useEffect(() => {
    setDraft({
      profile: current?.profile ?? "",
      allowed: (current?.allowedTools ?? []).join("\n"),
      denied: (current?.deniedTools ?? []).join("\n"),
    });
    setError(null);
  }, [selected, current?.profile, current?.allowedTools, current?.deniedTools]);

  // `selected` is in the list even when it is a name the operator has only just typed, so the picker
  // never shows an empty trigger for a promptware that does not exist yet.
  const known = [
    DEFAULT_PROMPTWARE_KEY,
    ...entries.map((entry) => entry.key),
    ...BUILT_IN_PROMPTWARES,
    selected,
  ].filter((key, index, all) => all.indexOf(key) === index);

  const changed =
    draft.profile !== (current?.profile ?? "") ||
    parseLines(draft.allowed).join("\n") !== (current?.allowedTools ?? []).join("\n") ||
    parseLines(draft.denied).join("\n") !== (current?.deniedTools ?? []).join("\n");

  const write = async (key: string, value: Record<string, unknown>) => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave("promptwares", { [key]: value });
      notificationsStore.notifySuccess("Saved", "Promptware saved");
    } catch (err) {
      setError(`Failed to save promptware: ${describeBridgeError(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionCard
      title="Promptware Configuration"
      hint="Configure agent profile and tool permissions for each promptware."
      testId="promptwares-card"
    >
      <div className="max-w-170 space-y-4">
        <SelectField
          id="promptware-select"
          label="Promptware"
          value={selected}
          options={known.map((key) => ({
            value: key,
            label: key === DEFAULT_PROMPTWARE_KEY ? "_default (every promptware)" : key,
          }))}
          hint={
            entries.some((entry) => entry.key === selected)
              ? undefined
              : "Not configured yet. Saving creates the entry."
          }
          onChange={setSelected}
        />

        <SelectField
          id="promptware-profile-select"
          label="Profile"
          value={draft.profile === "" ? "default" : draft.profile}
          options={[{ value: "default", label: "Default (unset)" }, ...asOptions(profileOptions)]}
          hint="Last writer wins: _default, then this promptware, then a per-plan or CLI override."
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, profile: value === "default" ? "" : value }))
          }
        />

        <LinesField
          id="promptware-allowed-tools"
          label="Allowed Tools"
          value={draft.allowed}
          placeholder={"Write(src/**)\nBash(pnpm *)"}
          hint="Added on top of the base tool set, one rule per line. It never replaces it."
          onChange={(value) => setDraft((prev) => ({ ...prev, allowed: value }))}
        />

        <LinesField
          id="promptware-denied-tools"
          label="Denied Tools"
          value={draft.denied}
          placeholder={"Write(.env)"}
          hint="Subtracted from the merged allowlist, and unioned with _default rather than narrowing it."
          onChange={(value) => setDraft((prev) => ({ ...prev, denied: value }))}
        />

        <SaveError message={error} />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={!changed || isSaving}
            onClick={() =>
              void write(selected, {
                ...current?.rest,
                profile: draft.profile,
                allowedTools: parseLines(draft.allowed),
                deniedTools: parseLines(draft.denied),
              })
            }
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!current || isSaving}
            onClick={() =>
              void write(selected, {
                ...current?.rest,
                profile: "",
                allowedTools: [],
                deniedTools: [],
              })
            }
          >
            Reset
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="space-y-1">
            <Label
              htmlFor="promptware-new-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Add Promptware
            </Label>
            <Input
              id="promptware-new-name"
              value={newName}
              placeholder="Promptware name (e.g. CreatePlan)..."
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          {/* `EditPromptwareDialogContent` refuses a blank name outright rather than reporting it. */}
          <Button
            type="button"
            variant="outline"
            disabled={newName.trim() === ""}
            onClick={() => {
              setSelected(newName.trim());
              setNewName("");
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </SectionCard>
  );
};

/**
 * The seven flattened agent security controls of one project, plus its review policy.
 *
 * There is no V1 counterpart: `ProjectDetailView` never exposed the security block, which
 * `VaultService` writes on import and `apply_security_settings` reads on every job launch. The
 * effective values are shown next to the raw ones because a preset silently overrides four of the
 * fields, and per-agent enforcement is called out because most providers render only some of them.
 */
const ProjectSecurityCard: React.FC<{
  config: TendrilConfig | null;
  agent: string;
  onSave: (key: string, value: unknown) => Promise<void>;
}> = ({ config, agent, onSave }) => {
  const projects = React.useMemo(() => readProjects(config), [config]);
  const [selected, setSelected] = React.useState<string>("");
  const [draft, setDraft] = React.useState<ProjectSecurityForm | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const active = projects.find((p) => p.name === selected) ?? projects[0] ?? null;

  React.useEffect(() => {
    setSelected((current) =>
      projects.some((p) => p.name === current) ? current : (projects[0]?.name ?? ""),
    );
  }, [projects]);

  React.useEffect(() => {
    setDraft(active ? { ...active.security } : null);
    setError(null);
  }, [active]);

  if (projects.length === 0) {
    return (
      <SectionCard
        title="Project Security"
        hint="Sandboxing, file and network rules, and terminal confirmation, per project."
        testId="project-security-card"
      >
        <p className="text-sm text-muted-foreground">
          No projects are configured yet, so there is nothing to secure.
        </p>
      </SectionCard>
    );
  }

  if (!draft) return null;

  const set = <K extends keyof ProjectSecurityForm>(key: K, value: ProjectSecurityForm[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const changed = JSON.stringify(draft) !== JSON.stringify(active?.security);
  const presetOverrides = draft.securityPreset !== "Custom";
  const enforcement = enforcementFor(agent);
  const agentLabel = CODING_AGENTS.find((a) => a.id === normalizeAgentName(agent))?.label ?? agent;

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      // A `projects` payload is merged by name and key, so only the project named here and only the
      // keys listed change; every other project and every unmodeled key is untouched.
      await onSave("projects", [
        {
          name: active?.name,
          sandboxMode: draft.sandboxMode,
          securityPreset: draft.securityPreset,
          outsideFileAccessPolicy: draft.outsideFileAccessPolicy,
          terminalAutoExecution: draft.terminalAutoExecution,
          filePermissions: draft.filePermissions,
          networkAccessRules: draft.networkAccessRules,
          allowedTerminalCommands: draft.allowedTerminalCommands,
          autoImplementPlans: draft.autoImplementPlans,
        },
      ]);
      notificationsStore.notifySuccess("Saved", `Security settings saved for ${active?.name}`);
    } catch (err) {
      setError(`Failed to save project settings: ${describeBridgeError(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SectionCard
      title="Project Security"
      hint="Sandboxing, file and network rules, and terminal confirmation, per project."
      testId="project-security-card"
    >
      <form
        className="max-w-170 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <SelectField
          id="project-security-project"
          label="Project"
          value={active?.name ?? ""}
          options={projects.map((p) => ({ value: p.name, label: p.name }))}
          onChange={setSelected}
        />

        <SelectField
          id="project-security-preset"
          label="Security Preset"
          value={draft.securityPreset}
          options={asOptions(SECURITY_PRESETS)}
          hint="Anything other than Custom overrides the sandbox and file/network fields below."
          onChange={(value) => set("securityPreset", value)}
        />

        <SelectField
          id="project-sandbox-mode"
          label="Sandbox Mode"
          value={draft.sandboxMode}
          options={asOptions(SANDBOX_MODES)}
          disabled={presetOverrides}
          hint={`Inherit General means no sandbox. Effective: ${effectiveSandboxMode(draft)}.`}
          onChange={(value) => set("sandboxMode", value)}
        />

        <SelectField
          id="project-outside-file-access"
          label="Outside File Access"
          value={draft.outsideFileAccessPolicy}
          options={asOptions(OUTSIDE_FILE_POLICIES)}
          disabled={presetOverrides}
          hint={`Deny drops every file rule below. Effective: ${effectiveOutsideFileAccess(draft)}.`}
          onChange={(value) => set("outsideFileAccessPolicy", value)}
        />

        <SelectField
          id="project-terminal-auto-execution"
          label="Terminal Auto-Execution"
          value={draft.terminalAutoExecution}
          options={asOptions(TERMINAL_AUTO_EXECUTIONS)}
          hint={`Not affected by the preset. Effective: ${effectiveTerminalAutoExecution(draft)}.`}
          onChange={(value) => set("terminalAutoExecution", value)}
        />

        <LinesField
          id="project-file-permissions"
          label="File Permissions"
          value={draft.filePermissions.map((rule) => `${rule.mode} ${rule.path}`).join("\n")}
          placeholder={"Allow src/**\nDeny .env"}
          hint="One `Allow|Ask|Deny <path>` per line. Allow adds a writable directory; Deny denies Write and Edit on the path."
          onChange={(value) =>
            set(
              "filePermissions",
              parseLines(value).map((line) => {
                const [head, ...tail] = line.split(/\s+/);
                const mode = oneOf(head, OUTSIDE_FILE_POLICIES, "");
                return mode === "" ? { path: line, mode: "Allow" } : { path: tail.join(" "), mode };
              }),
            )
          }
        />

        <LinesField
          id="project-network-rules"
          label="Network Access Rules"
          value={draft.networkAccessRules
            .map((rule) => `${rule.mode} ${rule.urlPattern}`)
            .join("\n")}
          placeholder={"Deny https://example.com/*"}
          hint={`One \`Allow|Deny <url pattern>\` per line. A single Deny turns network access off entirely. Effective: ${
            effectiveNetworkAllowed(draft) ? "allowed" : "denied"
          }.`}
          onChange={(value) =>
            set(
              "networkAccessRules",
              parseLines(value).map((line) => {
                const [head, ...tail] = line.split(/\s+/);
                const mode = oneOf(head, OUTSIDE_FILE_POLICIES, "");
                return mode === ""
                  ? { urlPattern: line, mode: "Allow" }
                  : { urlPattern: tail.join(" "), mode };
              }),
            )
          }
        />

        <LinesField
          id="project-allowed-terminal-commands"
          label="Allowed Terminal Commands"
          value={draft.allowedTerminalCommands.join("\n")}
          placeholder={"pnpm\ncargo"}
          hint="One command per line, each allowed as `Bash(<command> *)`."
          onChange={(value) => set("allowedTerminalCommands", parseLines(value))}
        />

        <SelectField
          id="project-auto-implement"
          label="Artifact Review / Auto-Implement Policy"
          value={draft.autoImplementPlans}
          options={AUTO_IMPLEMENT_OPTIONS}
          onChange={(value) => set("autoImplementPlans", value)}
        />

        {/* A control the configured agent's CLI has no argument for is inert, so say which. */}
        <Callout.Info data-testid="project-security-enforcement">
          <div className="space-y-1">
            <p>
              {agentLabel} enforces:{" "}
              {[
                ["sandbox mode", enforcement.sandbox],
                ["network access", enforcement.network],
                ["terminal confirmation", enforcement.terminalPrompt],
                ["file and command rules", enforcement.fileRules],
              ]
                .filter(([, on]) => on)
                .map(([name]) => name)
                .join(", ") || "none of these controls"}
              .
            </p>
            {[
              ["sandbox mode", enforcement.sandbox],
              ["network access", enforcement.network],
              ["terminal confirmation", enforcement.terminalPrompt],
              ["file and command rules", enforcement.fileRules],
            ].some(([, on]) => !on) && (
              <p className="text-xs">
                Ignored by {agentLabel}:{" "}
                {[
                  ["sandbox mode", enforcement.sandbox],
                  ["network access", enforcement.network],
                  ["terminal confirmation", enforcement.terminalPrompt],
                  ["file and command rules", enforcement.fileRules],
                ]
                  .filter(([, on]) => !on)
                  .map(([name]) => name)
                  .join(", ")}
                . Those keys are still written and honoured by agents that support them.
              </p>
            )}
          </div>
        </Callout.Info>

        <SaveError message={error} />

        <Button type="submit" disabled={!changed || isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </form>
    </SectionCard>
  );
};

export const SettingsView: React.FC<SettingsViewProps> = ({ serviceInfo, onRefreshHealth }) => {
  // `saved` is what config.yaml last said; `form` is what the operator has typed. Every section's
  // Save is disabled until the two differ, which is V1's `hasChanges` gate.
  const [saved, setSaved] = useState<SettingsForm>(DEFAULTS);
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  // The untouched config, kept because the structured sections (`codingAgents`, `promptwares`,
  // `projects`) are only on `raw` and have to be written back with every key they arrived with.
  const [config, setConfig] = useState<TendrilConfig | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [profiles, setProfiles] = useState<Record<ProfileTier, { model: string; effort: string }>>({
    deep: { model: "default", effort: "default" },
    balanced: { model: "default", effort: "default" },
    quick: { model: "default", effort: "default" },
  });
  const [agentArguments, setAgentArguments] = useState("");
  const [agentEnv, setAgentEnv] = useState("");

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setError = (section: string, message: string | null) =>
    setErrors((prev) => ({ ...prev, [section]: message }));

  const applyConfig = (cfg: TendrilConfig) => {
    const next = formOf(cfg);
    setSaved(next);
    setForm(next);
    setConfig(cfg);
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

  const agentEntries = React.useMemo(() => readAgentEntries(config), [config]);
  const selectedAgentEntry = agentEntries.find(
    (entry) => normalizeAgentName(entry.name) === normalizeAgentName(form.codingAgent),
  );
  const savedProfiles = React.useMemo(
    () =>
      Object.fromEntries(
        PROFILE_TIERS.map((tier) => [
          tier,
          {
            model: profileValue(selectedAgentEntry, tier, "model"),
            effort: profileValue(selectedAgentEntry, tier, "effort"),
          },
        ]),
      ) as Record<ProfileTier, { model: string; effort: string }>,
    [selectedAgentEntry],
  );
  const savedAgentArguments = selectedAgentEntry?.arguments ?? "";
  const savedAgentEnv = formatEnvLines(selectedAgentEntry?.environmentVariables ?? {});

  // `CodingAgentSetupView` re-seeds every profile field from config when the selected agent changes,
  // so switching cards shows that agent's profiles rather than the previous agent's.
  useEffect(() => {
    setProfiles(savedProfiles);
    setAgentArguments(savedAgentArguments);
    setAgentEnv(savedAgentEnv);
  }, [savedProfiles, savedAgentArguments, savedAgentEnv]);

  /**
   * One section's Save. Only changed keys are written: a full-object overwrite would clobber a
   * concurrent edit to config.yaml. Bounds are checked before the first write, the way
   * `ConfigSetCommand.Execute` validates ahead of taking the config lock, so a section with one bad
   * field does not persist half of itself. On success the config is re-read so the form shows what is
   * actually on disk, not optimistic local state; on failure nothing is re-read, so a retry does not
   * need the operator's input again.
   */
  const saveSection = async (
    section: string,
    keys: (keyof SettingsForm)[],
    toastMessage: string,
    onSaved?: () => void,
  ) => {
    const changedKeys = keys.filter((key) => form[key] !== saved[key]);
    for (const key of changedKeys) {
      const message = boundsError(key, form[key]);
      if (message) {
        setError(section, message);
        return;
      }
    }

    setSavingSection(section);
    setError(section, null);
    try {
      for (const key of changedKeys) {
        await bridge.putConfig(key, form[key]);
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

  /** Writes one structured key and re-reads the config, for the sections that own `raw` subtrees. */
  const saveRawKey = async (key: string, value: unknown) => {
    await bridge.putConfig(key, value);
    applyConfig(await bridge.getConfig());
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

  const agentIdChanged = form.codingAgent !== saved.codingAgent;
  const profilesChanged = JSON.stringify(profiles) !== JSON.stringify(savedProfiles);
  const agentDetailsChanged = agentArguments !== savedAgentArguments || agentEnv !== savedAgentEnv;
  // `CodingAgentSetupView.hasChanges` is the union of the agent id, its profiles and its credentials,
  // and the one Save writes all of them together.
  const agentChanged = agentIdChanged || profilesChanged || agentDetailsChanged;
  // A `config.yaml` naming an agent no build of Tendril can launch leaves the grid with nothing
  // selected, which on its own reads as "not configured yet" rather than "misconfigured".
  const unknownAgent =
    saved.codingAgent !== "" &&
    !CODING_AGENTS.some((agent) => agent.id === normalizeAgentName(saved.codingAgent))
      ? saved.codingAgent
      : null;
  const effortSupported = supportsEffort(form.codingAgent);
  const defaults = tierDefaults(form.codingAgent);

  /** `CodingAgentSetupView`'s Save: the agent id and its profiles in one write. */
  const saveCodingAgent = async () => {
    setSavingSection("codingAgent");
    setError("codingAgent", null);
    try {
      if (agentIdChanged) await bridge.putConfig("codingAgent", form.codingAgent);
      // Deliberately narrower than `CodingAgentSetupView`, which calls `SaveProfiles` on every save
      // and so materialises an `AgentConfig` with three blank profiles for any agent you merely
      // select. That is not inert in V2: `apply_profile` returns nothing at all when the agent has no
      // config entry, but falls back to the `balanced` tier once an entry exists, so writing the
      // empty entry would quietly change which model a job runs with.
      if (profilesChanged || agentDetailsChanged) {
        await bridge.putConfig(
          "codingAgents",
          withProfiles(
            agentEntries,
            form.codingAgent,
            profiles,
            agentArguments,
            parseEnvLines(agentEnv),
          ),
        );
      }
      applyConfig(await bridge.getConfig());
      notificationsStore.notifySuccess("Saved", "Coding agent settings saved");
    } catch (err) {
      setError("codingAgent", `Failed to save: ${describeBridgeError(err)}`);
    } finally {
      setSavingSection(null);
    }
  };

  const planChanged = form.planTemplate !== saved.planTemplate;
  const notificationsChanged = form.desktopNotifications !== saved.desktopNotifications;
  /** What config.yaml already holds outside the bounds the daemon documents, if anything. */
  const outOfBoundsOnDisk = (Object.keys(NUMERIC_BOUNDS) as (keyof SettingsForm)[])
    .map((key) => boundsError(key, saved[key]))
    .filter((message): message is string => message !== null);

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
            void saveCodingAgent();
          }}
        >
          {unknownAgent && (
            <Callout.Error data-testid="unknown-coding-agent">
              {unknownAgentMessage(unknownAgent)}
            </Callout.Error>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {CODING_AGENTS.map((agent) => {
              const selected = normalizeAgentName(form.codingAgent) === agent.id;
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

          {/* `CodingAgentSetupView`'s "Profile Models" block. `deep`, `balanced` and `quick` are the
              three tiers `apply_profile` maps by name; anything left as Default falls through to the
              agent's built-in tier default, which the placeholder names. */}
          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Profile Models</h3>
            <p className="text-xs text-muted-foreground">
              The model and effort each execution profile runs with.
              {effortSupported
                ? ""
                : " This agent's CLI takes no effort argument, so effort is ignored."}
            </p>
            {PROFILE_TIERS.map((tier) => (
              <div key={tier} className="flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1 space-y-1">
                  <Label
                    htmlFor={`profile-model-${tier}`}
                    className="text-xs font-medium text-muted-foreground capitalize"
                  >
                    {tier}
                  </Label>
                  <Input
                    id={`profile-model-${tier}`}
                    value={profiles[tier].model === "default" ? "" : profiles[tier].model}
                    placeholder={defaults[tier].model || "default"}
                    onChange={(e) =>
                      setProfiles((prev) => ({
                        ...prev,
                        [tier]: {
                          ...prev[tier],
                          model: e.target.value.trim() === "" ? "default" : e.target.value,
                        },
                      }))
                    }
                  />
                </div>
                <div className="w-36">
                  <SelectField
                    id={`profile-effort-${tier}`}
                    label="Effort"
                    value={profiles[tier].effort}
                    options={EFFORT_OPTIONS.map((effort) => ({
                      value: effort,
                      label: effort === "default" ? "Default" : effort,
                    }))}
                    disabled={!effortSupported}
                    onChange={(value) =>
                      setProfiles((prev) => ({ ...prev, [tier]: { ...prev[tier], effort: value } }))
                    }
                  />
                </div>
              </div>
            ))}
          </div>

          {/* `AgentConfig.arguments` and `AgentConfig.environmentVariables`: both are read by
              `resolve_agent_config` for every launch and were previously only settable by hand. */}
          <div className="space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              Extra Arguments &amp; Environment
            </h3>
            <div className="space-y-1">
              <Label
                htmlFor="agent-arguments"
                className="text-xs font-medium text-muted-foreground"
              >
                Extra Arguments
              </Label>
              <Input
                id="agent-arguments"
                value={agentArguments}
                placeholder="e.g. --verbose"
                onChange={(e) => setAgentArguments(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Split on whitespace and appended to every launch of this agent.
              </p>
            </div>
            <LinesField
              id="agent-environment"
              label="Environment Variables"
              value={agentEnv}
              placeholder={"ANTHROPIC_API_KEY=sk-..."}
              hint="One KEY=value per line. Lines starting with # are ignored."
              onChange={setAgentEnv}
            />
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

      <ProjectSecurityCard config={config} agent={saved.codingAgent} onSave={saveRawKey} />

      <SectionCard
        title="Team Configuration Vault"
        hint="Share and synchronize Tendril projects, custom skills, MCP servers, and security rules across your team via a versioned Git repository."
      >
        <VaultSettingsView tendrilHome={serviceInfo?.tendrilHome} />
      </SectionCard>

      <PromptwaresCard
        config={config}
        profileOptions={[
          ...new Set([
            ...PROFILE_TIERS,
            ...agentEntries.flatMap((entry) => entry.profiles.map((p) => asString(p.name))),
          ]),
        ].filter((name) => name !== "")}
        onSave={saveRawKey}
      />

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
        {/* `noValidate`: `min`/`max` still drive the spinners, but an out-of-range value is refused
            with `ParseBoundedInt`'s message rather than a browser bubble. */}
        <form
          noValidate
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
          {/* The bounds are `ConfigService.ValidateSettings`', not `AdvancedSetupView`'s: V1's own
              number input caps Job Timeout at 120 while its config service accepts up to 480, and a
              config.yaml holding 300 must stay editable here rather than be silently rejected. */}
          <NumberField
            id="job-timeout-input"
            label="Job Timeout"
            value={form.jobTimeout}
            min={NUMERIC_BOUNDS.jobTimeout![0]}
            max={NUMERIC_BOUNDS.jobTimeout![1]}
            suffix="min"
            onChange={(value) => set("jobTimeout", value)}
          />
          <NumberField
            id="stale-output-timeout-input"
            label="Stale Output Timeout"
            value={form.staleOutputTimeout}
            min={NUMERIC_BOUNDS.staleOutputTimeout![0]}
            max={NUMERIC_BOUNDS.staleOutputTimeout![1]}
            suffix="min"
            onChange={(value) => set("staleOutputTimeout", value)}
          />
          <NumberField
            id="max-concurrent-jobs-input"
            label="Max Concurrent Jobs"
            value={form.maxConcurrentJobs}
            min={NUMERIC_BOUNDS.maxConcurrentJobs![0]}
            max={NUMERIC_BOUNDS.maxConcurrentJobs![1]}
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

          {/* V1 clamps an out-of-range value on load and logs it; V2 keeps it and honours it, so the
              only place it can be pointed out is here. */}
          {outOfBoundsOnDisk.length > 0 && (
            <Callout.Warning data-testid="advanced-out-of-bounds">
              {outOfBoundsOnDisk.join(" ")}
            </Callout.Warning>
          )}

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
