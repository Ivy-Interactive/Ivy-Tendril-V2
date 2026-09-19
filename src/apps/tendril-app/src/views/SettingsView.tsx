import React, { useState, useEffect } from "react";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  Callout,
} from "@ivy-interactive/components/ui";
import { Plus } from "lucide-react";
import { bridge } from "../api/bridge";
import { notificationsStore } from "../state/notificationsStore";
import { uiStore } from "../state/uiStore";
import { readAppearance } from "../state/appearance";
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
  SettingsSection,
  SelectField,
  asOptions,
} from "./settings/fields";
import { asRecord, asString, parseLines } from "./settings/configValues";
import { readLevels, readProjectEntries, readVerificationDefs } from "./settings/projectConfig";
import { PROFILE_TIERS, readAgentEntries } from "./settings/codingAgents";
import { ProjectSettingsView } from "./settings/ProjectSettingsView";
import { AddProjectView } from "./settings/AddProjectView";
/**
 * `React.lazy` rather than a plain import, for the reason `App.tsx` lazies every view: this one
 * reaches CodeMirror and the whole embedded chat, and Settings is opened far more often than
 * `config.yaml` is hand-edited. Bundling it in would make every visit to Settings pay for both.
 */
const ConfigEditorView = React.lazy(() =>
  import("./settings/ConfigEditorView").then((m) => ({ default: m.ConfigEditorView })),
);
import { AppearanceSection } from "./settings/AppearanceSection";
import { CodingAgentSection } from "./settings/CodingAgentSection";
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

/**
 * Every editable key on this screen. The field names are the `config.yaml` keys verbatim, so a save
 * can write `putConfig(key, form[key])` without a translation table.
 */
interface SettingsForm {
  codingAgent: string;
  planTemplate: string;
  desktopNotifications: boolean;
  jobTimeout: number;
  staleOutputTimeout: number;
  maxConcurrentJobs: number;
  beta: boolean;
}

/**
 * `TendrilSettings`' own defaults, so an absent key reads the same here as it does daemon-side.
 * `desktopNotifications` absent means on. The appearance keys have their own defaults in
 * `state/appearance.ts`, because the pane that owns them applies them rather than form-editing them.
 */
const DEFAULTS: SettingsForm = {
  codingAgent: "claude",
  planTemplate: "",
  desktopNotifications: true,
  jobTimeout: 30,
  staleOutputTimeout: 10,
  maxConcurrentJobs: 20,
  beta: false,
};

/**
 * `staleOutputTimeout` and `beta` are not on `TendrilConfigDto`, so they are read out of the
 * untouched `raw` config the daemon returns alongside it.
 */
const rawOf = (cfg: TendrilConfig | null, key: string): unknown => cfg?.raw?.[key];

const formOf = (cfg: TendrilConfig | null): SettingsForm => {
  const staleOutputTimeout = rawOf(cfg, "staleOutputTimeout");
  const beta = rawOf(cfg, "beta");
  return {
    codingAgent: cfg?.codingAgent || DEFAULTS.codingAgent,
    planTemplate: cfg?.planTemplate ?? DEFAULTS.planTemplate,
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
    <SettingsSection
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

        <div className="flex flex-wrap items-end gap-2 pt-2">
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
    </SettingsSection>
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
  /**
   * The "Open config.yaml" action row, which is a branch of the content pane and not a section — the
   * same shape as {@link isAddingProject}, and for the same reason: V1 reaches both from the sidebar
   * without either becoming the selection.
   */
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  /** The project the Add Project blade wrote, so its harness step can read it back off the config. */
  const [createdProjectName, setCreatedProjectName] = useState<string | null>(null);
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
  /** The three appearance keys, for the pane that applies them. */
  const appearance = React.useMemo(() => readAppearance(config), [config]);

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
    setIsEditingConfig(false);
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

  /**
   * Step 0 of `AddProjectBladeView`: write the project row and re-read the config. It deliberately
   * does *not* move the selection - `AddProjectView` stays open for its agent and harness steps, and
   * V1's own `Pop(this)` (with the success toast) only happens at Finish. That is what
   * {@link finishAddProject} is.
   *
   * The created name is remembered so the harness step can read the project back once the setup
   * agent has written to it.
   */
  const createProject = async (name: string, repos: string[]) => {
    const created = await bridge.createProject({ name, repos });
    applyConfig(await bridge.getConfig());
    setCreatedProjectName(name);
    setIsProjectsExpanded(true);
    // A remote was cloned into TENDRIL_HOME; the response is where the caller learns the path.
    return created?.repos?.map((repo) => repo.path) ?? repos;
  };

  /** Re-reads config.yaml. The setup agent edits it through the `tendril` CLI, behind the app's back. */
  const reloadConfig = async () => {
    try {
      applyConfig(await bridge.getConfig());
    } catch {
      // A failed refresh leaves the last good config in place; the harness step says as much.
    }
  };

  /**
   * `AddProjectBladeView`'s two exits, both of which pop the blade and toast. V1 toasts
   * "Created background job for project '<name>'" from `onBgJob` and "Project '<name>' added
   * successfully" from the Crud step's Next.
   *
   * The name comes from the blade rather than from {@link createdProjectName}, which the background
   * exit races: it fires inside the same call that registered the project, before that state has
   * reached the blade's `onFinish` closure.
   */
  const finishAddProject = (outcome: "created" | "background", name: string) => {
    // Only the Finish exit lands on the project. V1's background `Pop(this)` returns to the list it
    // was opened from, and it has to: the hand-off happens in the same call that registered the
    // project, so this closure's `projects` predates the config refresh and could not find it.
    const index =
      outcome === "created"
        ? projects.findIndex((project) => project.name.toLowerCase() === name.toLowerCase())
        : -1;
    setIsAddingProject(false);
    setCreatedProjectName(null);
    setSelected(index >= 0 ? projectTag(index) : SettingsTag.Projects);
    if (outcome === "background") {
      notificationsStore.notifySuccess(
        "Job Started",
        `Created background job for project '${name}'`,
      );
    } else {
      notificationsStore.notifySuccess("Success", `Project '${name}' added successfully`);
    }
  };

  /**
   * `ConfigYamlUiHelper.OpenOrNavigate`, now taking its *navigate* arm.
   *
   * V1's helper has two: hand the file to the operator's editor, or navigate to `ConfigEditorApp`.
   * V2 took only the first, on the reasoning that V2 is always the desktop shell — which is true and
   * still gave the wrong answer, because it made "Open config.yaml" leave the app for TextEdit. The
   * second arm now exists ({@link ConfigEditorView}), so this navigates to it, and the daemon is
   * edited through the daemon rather than behind its back: the editor writes over the config route,
   * which validates the document before it lands and masks every secret on the way out.
   *
   * Like Add Project this is a branch of the content pane rather than a section, so the row it is
   * fired from never becomes the selection.
   */
  const openConfigYaml = () => {
    setIsAddingProject(false);
    setIsEditingConfig(true);
  };

  const isProjectTag = selected === SettingsTag.Projects || selected.startsWith(PROJECT_TAG_PREFIX);
  /** `TagSecurity` and `TagTunnel` select the same row and the same view. */
  const securitySelected = selected === SettingsTag.Security || selected === SettingsTag.Tunnel;
  const knownTags = new Set<string>([
    ...sections.map((section) => section.tag),
    SettingsTag.Tunnel,
  ]);
  const showsProject =
    !isEditingConfig && !isAddingProject && isProjectTag && selectedProject !== null;
  /** V1's two fallbacks to `CodingAgentSetupView`: no projects to show, and an unrecognised tag. */
  const fallsBackToCodingAgent =
    !isEditingConfig &&
    !isAddingProject &&
    ((isProjectTag && selectedProject === null) || (!isProjectTag && !knownTags.has(selected)));
  const on = (tag: string) => !isEditingConfig && !isAddingProject && selected === tag;
  const showCodingAgent = on(SettingsTag.CodingAgent) || fallsBackToCodingAgent;

  const projectNames = projects.map((project) => project.name);
  const currentLabel = isEditingConfig
    ? "config.yaml"
    : isAddingProject
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
                      /*
                       * `SettingsApp.cs:120-121`, exactly: `Enum.TryParse<Colors>(proj.Color, out var
                       * parsed) ? parsed : (config.GetProjectColor(proj.Name) ?? Colors.Slate)`. The
                       * second arm re-parses the same field, so it reduces to "the configured colour,
                       * else Slate" — a project with none gets V1's neutral marker rather than a
                       * colour implying a choice nobody made.
                       */
                      color={project.color.trim() === "" ? "Slate" : project.color.trim()}
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
                  ? securitySelected && !isEditingConfig && !isAddingProject
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

        {isEditingConfig ? (
          // No scroller and no inset, unlike the two branches below: the editor is a
          // `PlanWorkspace`, which owns its own chrome and expects the whole pane. Wrapping it in
          // `overflow-auto py-4 pl-4` would give the split pane a height of its content and collapse
          // the CodeMirror host, which sizes itself from the box it is given.
          <React.Suspense fallback={null}>
            <ConfigEditorView
              tendrilHome={serviceInfo?.tendrilHome}
              // `App.handleSelectPlan`'s navigation, minus its detail prefetch: a plan is
              // `PlansApp` plus args, so the app id carries the number and the args carry it again
              // for the page that reads them.
              onOpenPlan={(planId) => {
                uiStore.setSelectedPlanId(planId);
                uiStore.navigate({ appId: `plan-${planId}`, args: { planId } });
              }}
            />
          </React.Suspense>
        ) : showsProject && selectedProject ? (
          // The same inset and the same scroll owner as the section branch below. Settings is a
          // full-bleed page (V1's `SidebarLayout`), so the content pane is what supplies both;
          // leaving this branch bare made it the one settings section that took its padding from the
          // shell and scrolled the whole page instead of itself.
          //
          // The right padding is on the inner wrapper rather than here: a scrollbar is painted on
          // the padding edge, so `p-4` on the scroller pushed it 16px in from the pane and it read
          // as floating rather than riding the edge.
          <div className="min-h-0 flex-1 overflow-auto py-4 pl-4">
            <div className="pr-4">
              <ProjectSettingsView
                key={selectedProject.name}
                project={selectedProject}
                verificationDefs={verificationDefs}
                agent={saved.codingAgent}
                isBeta={isBeta}
                onSaveRaw={saveRawKey}
                onReloadConfig={reloadConfig}
              />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto py-4 pl-4">
            <div className="space-y-10 pr-4">
              {/* Sections draw no box of their own, as V1's draw none, so the gap between them is the
                only thing separating one from the next - wider than the `space-y-6` that was only
                ever spacing between two already-bordered boxes. */}
              {isAddingProject && (
                <AddProjectView
                  existingNames={projectNames}
                  onCreate={createProject}
                  createdProject={
                    createdProjectName
                      ? (projects.find(
                          (project) =>
                            project.name.toLowerCase() === createdProjectName.toLowerCase(),
                        ) ?? null)
                      : null
                  }
                  onFinish={finishAddProject}
                  onReloadConfig={reloadConfig}
                />
              )}

              {/* Row order follows `SettingsApp.Build`: Coding Agent, Plans, Appearance, Projects,
                Team Vault (beta), Promptwares, Levels, Notifications, Security & Tunneling,
                Advanced, Newsletter, then the "Open config.yaml" action row. */}
              {showCodingAgent && (
                <>
                  <CodingAgentSection
                    config={config}
                    savedAgent={saved.codingAgent}
                    onSaveRaw={saveRawKey}
                  />

                  {/* No V1 counterpart: V2 resolves models itself, and the catalogue governs which model
                    the agent above is launched with, so it sits inside that row rather than as its own. */}
                  <ModelCatalogCard />
                </>
              )}

              {on(SettingsTag.Plans) && (
                <SettingsSection
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

                    <Button
                      type="submit"
                      disabled={!planChanged || savingSection === "planTemplate"}
                    >
                      {savingSection === "planTemplate" ? "Saving..." : "Save"}
                    </Button>
                  </form>
                </SettingsSection>
              )}

              {on(SettingsTag.Appearance) && (
                <AppearanceSection settings={appearance} onSaveRaw={saveRawKey} />
              )}

              {/* `if (isBeta) rows.Add(("Team Vault", ...))`: gated, and labelled as V1 labels it. */}
              {isBeta && on(SettingsTag.Vault) && (
                <SettingsSection
                  title="Team Vault"
                  hint="Share and synchronize Tendril projects, custom skills, MCP servers, and security rules across your team via a versioned Git repository."
                  testId="vault-card"
                >
                  <VaultSettingsView tendrilHome={serviceInfo?.tendrilHome} />
                </SettingsSection>
              )}

              {on(SettingsTag.Promptwares) && (
                <PromptwaresCard
                  config={config}
                  profileOptions={[
                    ...new Set([
                      ...PROFILE_TIERS,
                      ...agentEntries.flatMap((entry) =>
                        entry.profiles.map((p) => asString(p.name)),
                      ),
                    ]),
                  ].filter((name) => name !== "")}
                  onSave={saveRawKey}
                />
              )}

              {on(SettingsTag.Levels) && <LevelsSection levels={levels} onSaveRaw={saveRawKey} />}

              {on(SettingsTag.Notifications) && (
                <SettingsSection
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
                </SettingsSection>
              )}

              {securitySelected && !isEditingConfig && !isAddingProject && (
                <SecurityTunnelingSection />
              )}

              {on(SettingsTag.Advanced) && (
                <>
                  <SettingsSection
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
                  </SettingsSection>

                  {/* No V1 counterpart: V2 supervises the daemon itself, so its diagnostics live here rather
          than in the C# app. They are part of Advanced rather than a top-level row, because V1's
          sidebar has no row for them and an extra row is itself a structural divergence. */}
                  <SettingsSection
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
                  </SettingsSection>

                  <ServiceSettingsView
                    serviceInfo={serviceInfo}
                    onRefreshHealth={onRefreshHealth}
                  />
                </>
              )}

              {on(SettingsTag.Newsletter) && (
                <SettingsSection
                  title="Newsletter"
                  hint="Subscribe to the Ivy & Tendril newsletter to receive updates, feature highlights, and release notes."
                  testId="newsletter-card"
                >
                  <NewsletterSignup />
                </SettingsSection>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
