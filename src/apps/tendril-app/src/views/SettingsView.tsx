import React, { useState, useEffect } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
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
import { Check, Moon, Plus, Sun, SunMoon } from "lucide-react";
import { bridge } from "../api/bridge";
import { notificationsStore } from "../state/notificationsStore";
import { describeBridgeError, type ServiceInfo, type TendrilConfig } from "../types/api";
import { ModelCatalogCard } from "../components/ModelCatalogCard";
import { NewsletterSignup } from "../components/NewsletterSignup";
import { ServiceSettingsView } from "../components/service";
import { VaultSettingsView } from "./VaultSettingsView";
import { SidebarExpandableRow, SidebarRow, SidebarSubItem } from "./settings/SidebarListRow";
import {
  OpenConfigIcon,
  PROJECT_TAG_PREFIX,
  SettingsTag,
  projectIndexOf,
  projectTag,
  sectionLabel,
  settingsSections,
} from "./settings/sections";
import {
  LinesField,
  NumberField,
  SaveError,
  SectionCard,
  SelectField,
  asOptions,
} from "./settings/fields";
import {
  asRecord,
  asString,
  asStringMap,
  formatEnvLines,
  parseEnvLines,
  parseLines,
} from "./settings/configValues";
import {
  normalizeAgentName,
  readLevels,
  readProjectEntries,
  readVerificationDefs,
} from "./settings/projectConfig";
import { ProjectSettingsView } from "./settings/ProjectSettingsView";
import { AddProjectView } from "./settings/AddProjectView";
import { LevelsSection } from "./settings/LevelsSection";
import { SecurityTunnelingSection } from "./settings/SecurityTunnelingSection";

interface SettingsViewProps {
  serviceInfo: ServiceInfo | null;
  onRefreshHealth: () => Promise<void>;
  /**
   * The section to open on, spelled as `SettingsApp.cs`'s tag (`coding-agent`, `plans`, ...) or as
   * `project:<n>`. This is V1's `SettingsAppArgs.Section`, which `SettingsApp` seeds `selected` from.
   * `App.tsx` does not pass it yet - see the report - so an absent value opens Coding Agent, exactly
   * as `args?.Section ?? TagCodingAgent` does.
   */
  initialSection?: string;
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

export const SettingsView: React.FC<SettingsViewProps> = ({
  serviceInfo,
  onRefreshHealth,
  initialSection,
}) => {
  // `SettingsApp.Build`'s two pieces of navigation state: which row is selected, and whether the
  // Projects row is expanded. `args?.Section ?? TagCodingAgent` is the initial selection.
  const [selected, setSelected] = useState<string>(initialSection ?? SettingsTag.CodingAgent);
  const [isProjectsExpanded, setIsProjectsExpanded] = useState<boolean>(
    (initialSection ?? "") === SettingsTag.Projects ||
      (initialSection ?? "").startsWith(PROJECT_TAG_PREFIX),
  );
  /** The "Add Project" sub-item. V1 opens `AddProjectDialog`; this area owns no dialog files. */
  const [isAddingProject, setIsAddingProject] = useState(false);
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

  /* ------------------------------------------------------------- nested sidebar */

  const projects = React.useMemo(() => readProjectEntries(config), [config]);
  const verificationDefs = React.useMemo(() => readVerificationDefs(config), [config]);
  const levels = React.useMemo(() => readLevels(config), [config]);

  // `BetaHelper.IsBeta(tendrilArgs, config)`, minus the CLI flag V2 has no equivalent of. It gates
  // the Team Vault row, and V1's three per-project blocks.
  const isBeta = saved.beta;
  const sections = React.useMemo(() => settingsSections(isBeta), [isBeta]);

  /**
   * `SettingsApp.Build`'s expandable-row handler: expanding jumps to the first project when the
   * current selection is not already a project, so opening the group lands somewhere rather than
   * leaving the content area showing an unrelated section.
   */
  const toggleProjects = () => {
    const willExpand = !isProjectsExpanded;
    setIsProjectsExpanded(willExpand);
    if (
      willExpand &&
      selected !== SettingsTag.Projects &&
      !selected.startsWith(PROJECT_TAG_PREFIX) &&
      projects.length > 0
    ) {
      setIsAddingProject(false);
      setSelected(projectTag(0));
    }
  };

  const selectSection = (tag: string) => {
    setIsAddingProject(false);
    setSelected(tag);
  };

  /**
   * `SettingsApp.Build`'s `project:` branch, including its fallbacks: an index that does not resolve
   * falls back to the first project, and no projects at all falls back to the Coding Agent view.
   */
  const selectedProject = (() => {
    const index = projectIndexOf(selected);
    if (index === null && selected !== SettingsTag.Projects) return null;
    if (projects.length === 0) return null;
    return projects[index ?? 0] ?? projects[0];
  })();

  /** `AddProjectDialog`'s `onCreated`: the new project becomes the selection. */
  const createProject = async (name: string, repos: string[]) => {
    await bridge.createProject({ name, repos });
    const next = await bridge.getConfig();
    applyConfig(next);
    const index = readProjectEntries(next).findIndex(
      (project) => project.name.toLowerCase() === name.toLowerCase(),
    );
    setIsAddingProject(false);
    setIsProjectsExpanded(true);
    setSelected(index >= 0 ? projectTag(index) : SettingsTag.Projects);
    notificationsStore.notifySuccess("Success", `Project '${name}' added successfully`);
  };

  /**
   * `ConfigYamlUiHelper.OpenOrNavigate`. On a desktop shell V1 opens `config.yaml` in the configured
   * editor; V2 is always the desktop shell, so it hands the path to the OS. V1's web fallback
   * (`ConfigEditorApp`) has no V2 counterpart, so there is nothing to navigate to instead.
   */
  const openConfigYaml = () => {
    const home = serviceInfo?.tendrilHome;
    if (!home) return;
    void openPath(`${home.replace(/[/\\]+$/, "")}/config.yaml`).catch((err) => {
      notificationsStore.notifyError(`Failed to open config.yaml: ${describeBridgeError(err)}`);
    });
  };

  const isProjectTag = selected === SettingsTag.Projects || selected.startsWith(PROJECT_TAG_PREFIX);
  /** `TagSecurity` and `TagTunnel` select the same row and the same view. */
  const securitySelected = selected === SettingsTag.Security || selected === SettingsTag.Tunnel;
  const knownTags = new Set<string>([
    ...sections.map((section) => section.tag),
    SettingsTag.Tunnel,
  ]);
  const showsProject = !isAddingProject && isProjectTag && selectedProject !== null;
  /** V1's two fallbacks to `CodingAgentSetupView`: no projects to show, and an unrecognised tag. */
  const fallsBackToCodingAgent =
    !isAddingProject &&
    ((isProjectTag && selectedProject === null) || (!isProjectTag && !knownTags.has(selected)));
  const on = (tag: string) => !isAddingProject && selected === tag;
  const showCodingAgent = on(SettingsTag.CodingAgent) || fallsBackToCodingAgent;

  const projectNames = projects.map((project) => project.name);
  const currentLabel = isAddingProject
    ? "Add Project"
    : sectionLabel(selected, sections, projectNames);

  return (
    <div className="flex h-full min-h-0" data-testid="settings-view">
      {/* `new SidebarLayout(content, sidebar)`: the nested sidebar, hidden at the breakpoints where
          `sections.ShowOn(Breakpoint.Mobile, Breakpoint.Tablet)` swaps in the picker instead. */}
      <nav
        aria-label="Configuration sections"
        role="tablist"
        data-testid="settings-sidebar"
        className="hidden w-56 shrink-0 gap-1 overflow-y-auto border-r border-border p-2 md:flex md:flex-col"
      >
        {sections.map((section) =>
          section.expandable ? (
            <React.Fragment key={section.tag}>
              <SidebarExpandableRow
                icon={section.icon}
                label={section.label}
                expanded={isProjectsExpanded}
                selected={selected === SettingsTag.Projects && !isAddingProject}
                onClick={toggleProjects}
                testId="settings-row-projects"
              />
              {isProjectsExpanded && (
                <>
                  {projects.map((project, index) => (
                    <SidebarSubItem
                      key={project.name}
                      label={project.name}
                      selected={
                        !isAddingProject &&
                        (selected === projectTag(index) ||
                          (selected === SettingsTag.Projects && index === 0))
                      }
                      onClick={() => selectSection(projectTag(index))}
                      testId={`settings-row-project-${index}`}
                    />
                  ))}
                  {/* `SidebarListRow.BuildSubItem("Add Project", Icons.Plus, ...)`. */}
                  <SidebarSubItem
                    label="Add Project"
                    icon={Plus}
                    selected={isAddingProject}
                    onClick={() => setIsAddingProject(true)}
                    testId="settings-row-add-project"
                  />
                </>
              )}
            </React.Fragment>
          ) : (
            <SidebarRow
              key={section.tag}
              icon={section.icon}
              label={section.label}
              selected={
                section.tag === SettingsTag.Security
                  ? securitySelected && !isAddingProject
                  : on(section.tag)
              }
              onClick={() => selectSection(section.tag)}
              testId={`settings-row-${section.tag}`}
            />
          ),
        )}
        {/* An action row, not a section: V1 passes `false` for selected because it never becomes
            the selection. */}
        <SidebarRow
          icon={OpenConfigIcon}
          label="Open config.yaml"
          selected={false}
          onClick={openConfigYaml}
          testId="settings-row-open-config"
        />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* `MobileItemPicker.Build(currentLabel, sections, ...)`, which V1 shows only on Mobile and
            Tablet. A `Select` stands in for its `DropDownMenu`; the trigger reads the same. */}
        <div className="border-b border-border p-2 md:hidden">
          {/* `sections` has no row for a single project or for `tunnel`, so both resolve to the row
              that owns them - Projects, and Security & Tunneling. */}
          <Select
            value={
              isProjectTag || isAddingProject
                ? SettingsTag.Projects
                : securitySelected
                  ? SettingsTag.Security
                  : selected
            }
            onValueChange={selectSection}
          >
            <SelectTrigger aria-label="Configuration section" data-testid="settings-mobile-picker">
              <SelectValue placeholder={currentLabel} />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section) => (
                <SelectItem key={section.tag} value={section.tag}>
                  {section.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showsProject && selectedProject ? (
          <div className="min-h-0 flex-1">
            <ProjectSettingsView
              key={selectedProject.name}
              project={selectedProject}
              verificationDefs={verificationDefs}
              agent={saved.codingAgent}
              isBeta={isBeta}
              onSaveRaw={saveRawKey}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-6 overflow-auto p-4">
            {isAddingProject && (
              <AddProjectView existingNames={projectNames} onCreate={createProject} />
            )}

            {/* Row order follows `SettingsApp.Build`: Coding Agent, Plans, Appearance, Projects,
                Team Vault (beta), Promptwares, Levels, Notifications, Security & Tunneling,
                Advanced, Newsletter, then the "Open config.yaml" action row. */}
            {showCodingAgent && (
              <>
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
                            <span className="text-sm font-medium text-foreground">
                              {agent.label}
                            </span>
                            {selected && (
                              <Check className="ml-auto size-4 text-primary" aria-hidden="true" />
                            )}
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
                                    model:
                                      e.target.value.trim() === "" ? "default" : e.target.value,
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
                                setProfiles((prev) => ({
                                  ...prev,
                                  [tier]: { ...prev[tier], effort: value },
                                }))
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

                    <Button
                      type="submit"
                      disabled={!agentChanged || savingSection === "codingAgent"}
                    >
                      {savingSection === "codingAgent" ? "Saving..." : "Save"}
                    </Button>
                  </form>
                </SectionCard>

                {/* No V1 counterpart: V2 resolves models itself, and the catalogue governs which model the
          agent above is launched with, so it sits inside that row rather than as its own. */}
                <ModelCatalogCard />
              </>
            )}

            {on(SettingsTag.Plans) && (
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
            )}

            {on(SettingsTag.Appearance) && (
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
            )}

            {/* `if (isBeta) rows.Add(("Team Vault", ...))`: gated, and labelled as V1 labels it. */}
            {isBeta && on(SettingsTag.Vault) && (
              <SectionCard
                title="Team Vault"
                hint="Share and synchronize Tendril projects, custom skills, MCP servers, and security rules across your team via a versioned Git repository."
                testId="vault-card"
              >
                <VaultSettingsView tendrilHome={serviceInfo?.tendrilHome} />
              </SectionCard>
            )}

            {on(SettingsTag.Promptwares) && (
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
            )}

            {on(SettingsTag.Levels) && <LevelsSection levels={levels} onSaveRaw={saveRawKey} />}

            {on(SettingsTag.Notifications) && (
              <SectionCard
                title="Notifications"
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
            )}

            {securitySelected && !isAddingProject && <SecurityTunnelingSection />}

            {on(SettingsTag.Advanced) && (
              <>
                <SectionCard
                  title="Advanced"
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

                    <Button
                      type="submit"
                      disabled={!advancedChanged || savingSection === "advanced"}
                    >
                      {savingSection === "advanced" ? "Saving..." : "Save"}
                    </Button>
                  </form>
                </SectionCard>

                {/* No V1 counterpart: V2 supervises the daemon itself, so its diagnostics live here rather
          than in the C# app. They are part of Advanced rather than a top-level row, because V1's
          sidebar has no row for them and an extra row is itself a structural divergence. */}
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
              </>
            )}

            {on(SettingsTag.Newsletter) && (
              <SectionCard
                title="Newsletter"
                hint="Subscribe to the Ivy & Tendril newsletter to receive updates, feature highlights, and release notes."
                testId="newsletter-card"
              >
                <NewsletterSignup />
              </SectionCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
