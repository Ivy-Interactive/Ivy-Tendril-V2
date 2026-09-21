import type { TendrilConfig } from "../../types/api";
import {
  asArray,
  asBool,
  asRecord,
  asString,
  asStringMap,
  oneOf,
  parseLines,
} from "./configValues";

/**
 * The project subtree of `config.yaml`, field for field with `models/project.rs`'s `ProjectConfig`
 * and V1's `ConfigService.ProjectConfig`. There is no TypeScript model for any of it in
 * `types/api.ts` - `ProjectSummary` flattens `repos` and `verifications` to name strings - so the
 * per-project screens read `TendrilConfig.raw.projects` directly, the way `readProjects` already did
 * for the security block.
 *
 * ## What can and cannot be written
 *
 * The only write path the app has is `putConfig(key, value)` -> `PUT /api/config` ->
 * `update_config_raw`, whose rules (`tendril-core/src/config.rs`) decide what a config editor is
 * even capable of:
 *
 * - The root `projects` sequence is merged **by name**, case-insensitively, so a payload of
 *   `[{ name, ...onlyTheKeysThatChanged }]` patches one project and leaves every other project and
 *   every unmentioned key alone. Omission is explicitly not deletion.
 * - Inside a project, **sequences replace**. So `repos`, `verifications`, `reviewActions`,
 *   `mcpServers`, `skills`, `envFiles`, `hooks`, `filePermissions`, `networkAccessRules` and
 *   `allowedTerminalCommands` are fully editable, deletions and reordering included: send the whole
 *   list.
 * - Inside a project, **mappings deep-merge**. `ports` is a mapping, so a port can be added and
 *   changed but **not deleted or renamed** - a removed key survives in the merged file and a rename
 *   leaves the old key behind alongside the new one. `PORTS_ARE_MERGED` is that limitation as a
 *   constant so the UI can say so instead of pretending.
 * - Renaming or deleting a **project** is not possible over `PUT /api/config` at all: a renamed
 *   entry matches nothing and is appended next to the original, and omission is not deletion. Both
 *   go through their own daemon route instead - `PUT /api/projects/:name` with `newName`, and
 *   `DELETE /api/projects/:name` - which the bridge reaches as `renameProject` and `removeProject`.
 *   Deleting a project's *data* is a third route again, `DELETE /api/projects/:name/data`.
 */

export const PORTS_ARE_MERGED =
  "Ports are a mapping, and PUT /api/config deep-merges mappings, so a port can be added or changed here but not removed or renamed.";

export interface RepoRef {
  path: string;
  baseBranch?: string;
  subdirectory?: string;
  /** Every key the entry arrived with that is not modeled, preserved on write-back. */
  rest: Record<string, unknown>;
}

export interface ProjectVerificationRef {
  name: string;
  required: boolean;
  rest: Record<string, unknown>;
}

export interface ReviewActionConfigEntry {
  name: string;
  condition: string;
  command: string;
  paths: string[];
  rest: Record<string, unknown>;
}

export interface PromptwareHookConfigEntry {
  name: string;
  /** `PromptwareHookConfig.when`, defaulting to `before` the way the daemon's serde default does. */
  when: string;
  promptwares: string[];
  condition: string;
  action: string;
  rest: Record<string, unknown>;
}

export interface ProjectPortConfigEntry {
  name: string;
  defaultPort: number;
  description: string;
  rest: Record<string, unknown>;
}

export interface ProjectEnvFileConfigEntry {
  path: string;
  template: string;
  overrides: Record<string, string>;
  rest: Record<string, unknown>;
}

export interface ProjectMcpServerRefEntry {
  name: string;
  command: string;
  arguments: string[];
  environment: Record<string, string>;
  disabled: boolean;
  rest: Record<string, unknown>;
}

export interface ProjectSkillRefEntry {
  name: string;
  description: string;
  path: string;
  instructions: string;
  disabled: boolean;
  rest: Record<string, unknown>;
}

/** `SandboxMode`, in the spelling `normalize_enum_token` canonicalises to. */
export const SANDBOX_MODES = ["InheritGeneral", "Enabled", "Disabled"];
export const SECURITY_PRESETS = ["Custom", "Permissive", "Restricted", "Strict"];
export const OUTSIDE_FILE_POLICIES = ["Allow", "Ask", "Deny"];
export const TERMINAL_AUTO_EXECUTIONS = ["InheritGeneral", "AlwaysProceed", "AlwaysAsk"];
export const AUTO_IMPLEMENT_OPTIONS: { value: string; label: string }[] = [
  { value: "AutoImplementPlans", label: "Auto-Implement Plans" },
  { value: "AlwaysAskReview", label: "Always Ask Review" },
];

/** The seven flattened agent security keys of one project, plus its review policy. */
export interface ProjectSecurityForm {
  sandboxMode: string;
  securityPreset: string;
  outsideFileAccessPolicy: string;
  terminalAutoExecution: string;
  filePermissions: { path: string; mode: string }[];
  networkAccessRules: { urlPattern: string; mode: string }[];
  allowedTerminalCommands: string[];
  autoImplementPlans: string;
}

export interface ProjectEntry {
  name: string;
  color: string;
  context: string;
  repos: RepoRef[];
  verifications: ProjectVerificationRef[];
  reviewActions: ReviewActionConfigEntry[];
  hooks: PromptwareHookConfigEntry[];
  ports: ProjectPortConfigEntry[];
  envFiles: ProjectEnvFileConfigEntry[];
  mcpServers: ProjectMcpServerRefEntry[];
  skills: ProjectSkillRefEntry[];
  security: ProjectSecurityForm;
}

/** One entry of the top-level `verifications` registry (`VerificationConfig`). */
export interface VerificationDef {
  name: string;
  prompt: string;
  rest: Record<string, unknown>;
}

/** One entry of the top-level `levels` list (`LevelConfig`). */
export interface LevelEntry {
  name: string;
  color: string;
  badge?: string;
  rest: Record<string, unknown>;
}

const restOf = (entry: Record<string, unknown>, known: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entry).filter(([key]) => !known.includes(key)));

const readRepos = (value: unknown): RepoRef[] =>
  asArray(value)
    .map(asRecord)
    .map((entry) => ({
      path: asString(entry.path),
      baseBranch: asString(entry.baseBranch) || undefined,
      subdirectory: asString(entry.subdirectory) || undefined,
      rest: restOf(entry, ["path", "baseBranch", "subdirectory"]),
    }))
    .filter((repo) => repo.path !== "");

const readVerifications = (value: unknown): ProjectVerificationRef[] =>
  asArray(value)
    .map(asRecord)
    .map((entry) => ({
      name: asString(entry.name),
      required: asBool(entry.required),
      rest: restOf(entry, ["name", "required"]),
    }))
    .filter((ref) => ref.name !== "");

const readReviewActions = (value: unknown): ReviewActionConfigEntry[] =>
  asArray(value)
    .map(asRecord)
    .map((entry) => ({
      name: asString(entry.name),
      condition: asString(entry.condition),
      command: asString(entry.command),
      paths: asArray(entry.paths)
        .map(asString)
        .filter((path) => path !== ""),
      rest: restOf(entry, ["name", "condition", "command", "paths"]),
    }))
    .filter((action) => action.name !== "");

const readHooks = (value: unknown): PromptwareHookConfigEntry[] =>
  asArray(value)
    .map(asRecord)
    .map((entry) => ({
      name: asString(entry.name),
      when: asString(entry.when) || "before",
      promptwares: asArray(entry.promptwares).map(asString),
      condition: asString(entry.condition),
      action: asString(entry.action),
      rest: restOf(entry, ["name", "when", "promptwares", "condition", "action"]),
    }))
    .filter((hook) => hook.name !== "");

const readPorts = (value: unknown): ProjectPortConfigEntry[] =>
  Object.entries(asRecord(value)).map(([name, raw]) => {
    const entry = asRecord(raw);
    return {
      name,
      defaultPort: typeof entry.defaultPort === "number" ? entry.defaultPort : 0,
      description: asString(entry.description),
      rest: restOf(entry, ["defaultPort", "description"]),
    };
  });

const readEnvFiles = (value: unknown): ProjectEnvFileConfigEntry[] =>
  asArray(value)
    .map(asRecord)
    .map((entry) => ({
      path: asString(entry.path),
      template: asString(entry.template),
      overrides: asStringMap(entry.overrides),
      rest: restOf(entry, ["path", "template", "overrides"]),
    }))
    .filter((file) => file.path !== "");

const readMcpServers = (value: unknown): ProjectMcpServerRefEntry[] =>
  asArray(value)
    .map(asRecord)
    .map((entry) => ({
      name: asString(entry.name),
      command: asString(entry.command),
      arguments: asArray(entry.arguments).map(asString),
      environment: asStringMap(entry.environment),
      disabled: asBool(entry.disabled),
      rest: restOf(entry, ["name", "command", "arguments", "environment", "disabled"]),
    }))
    .filter((server) => server.name !== "");

const readSkills = (value: unknown): ProjectSkillRefEntry[] =>
  asArray(value)
    .map(asRecord)
    .map((entry) => ({
      name: asString(entry.name),
      description: asString(entry.description),
      path: asString(entry.path),
      instructions: asString(entry.instructions),
      disabled: asBool(entry.disabled),
      rest: restOf(entry, ["name", "description", "path", "instructions", "disabled"]),
    }))
    .filter((skill) => skill.name !== "");

const readSecurity = (entry: Record<string, unknown>): ProjectSecurityForm => ({
  sandboxMode: oneOf(entry.sandboxMode, SANDBOX_MODES, "InheritGeneral"),
  securityPreset: oneOf(entry.securityPreset, SECURITY_PRESETS, "Custom"),
  outsideFileAccessPolicy: oneOf(entry.outsideFileAccessPolicy, OUTSIDE_FILE_POLICIES, "Allow"),
  terminalAutoExecution: oneOf(
    entry.terminalAutoExecution,
    TERMINAL_AUTO_EXECUTIONS,
    "InheritGeneral",
  ),
  filePermissions: asArray(entry.filePermissions)
    .map(asRecord)
    .map((rule) => ({
      path: asString(rule.path),
      mode: oneOf(rule.mode, OUTSIDE_FILE_POLICIES, "Allow"),
    }))
    .filter((rule) => rule.path !== ""),
  networkAccessRules: asArray(entry.networkAccessRules)
    .map(asRecord)
    .map((rule) => ({
      urlPattern: asString(rule.urlPattern),
      mode: oneOf(rule.mode, OUTSIDE_FILE_POLICIES, "Allow"),
    }))
    .filter((rule) => rule.urlPattern !== ""),
  allowedTerminalCommands: asArray(entry.allowedTerminalCommands)
    .map(asString)
    .filter((cmd) => cmd !== ""),
  autoImplementPlans:
    asString(entry.autoImplementPlans) === "AutoImplementPlans" ||
    asString(entry.autoImplementPlans) === "Auto-Implement Plans"
      ? "AutoImplementPlans"
      : "AlwaysAskReview",
});

/**
 * Every project in `config.yaml`, in file order - which is what a `project:<n>` sidebar tag indexes
 * into, exactly as `config.Settings.Projects` does in V1.
 */
export function readProjectEntries(cfg: TendrilConfig | null): ProjectEntry[] {
  return asArray(cfg?.raw?.projects)
    .map(asRecord)
    .filter((entry) => asString(entry.name) !== "")
    .map((entry) => ({
      name: asString(entry.name),
      color: asString(entry.color),
      context: asString(entry.context),
      repos: readRepos(entry.repos),
      verifications: readVerifications(entry.verifications),
      reviewActions: readReviewActions(entry.reviewActions),
      hooks: readHooks(entry.hooks),
      ports: readPorts(entry.ports),
      envFiles: readEnvFiles(entry.envFiles),
      mcpServers: readMcpServers(entry.mcpServers),
      skills: readSkills(entry.skills),
      security: readSecurity(entry),
    }));
}

/** The top-level `verifications` registry, which `EditVerificationBladeView` appends to. */
export function readVerificationDefs(cfg: TendrilConfig | null): VerificationDef[] {
  return asArray(cfg?.raw?.verifications)
    .map(asRecord)
    .map((entry) => ({
      name: asString(entry.name),
      prompt: asString(entry.prompt),
      rest: restOf(entry, ["name", "prompt"]),
    }))
    .filter((def) => def.name !== "");
}

/** The top-level `levels` list, in `config.yaml` order - `LevelsSetupView` deliberately not sorted. */
export function readLevels(cfg: TendrilConfig | null): LevelEntry[] {
  return asArray(cfg?.raw?.levels)
    .map(asRecord)
    .map((entry) => ({
      name: asString(entry.name),
      color: asString(entry.color),
      badge: asString(entry.badge) || undefined,
      rest: restOf(entry, ["name", "color", "badge"]),
    }))
    .filter((level) => level.name !== "");
}

/* ------------------------------------------------------------------ serialisation */

const compact = (entry: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));

export const repoToWire = (repo: RepoRef): Record<string, unknown> =>
  compact({
    ...repo.rest,
    path: repo.path,
    baseBranch: repo.baseBranch,
    subdirectory: repo.subdirectory,
  });

export const verificationToWire = (ref: ProjectVerificationRef): Record<string, unknown> => ({
  ...ref.rest,
  name: ref.name,
  required: ref.required,
});

export const reviewActionToWire = (action: ReviewActionConfigEntry): Record<string, unknown> => ({
  ...action.rest,
  name: action.name,
  condition: action.condition,
  command: action.command,
  paths: action.paths,
});

export const envFileToWire = (file: ProjectEnvFileConfigEntry): Record<string, unknown> =>
  compact({
    ...file.rest,
    path: file.path,
    template: file.template === "" ? undefined : file.template,
    overrides: file.overrides,
  });

export const mcpServerToWire = (server: ProjectMcpServerRefEntry): Record<string, unknown> => ({
  ...server.rest,
  name: server.name,
  command: server.command,
  arguments: server.arguments,
  environment: server.environment,
  disabled: server.disabled,
});

export const skillToWire = (skill: ProjectSkillRefEntry): Record<string, unknown> =>
  compact({
    ...skill.rest,
    name: skill.name,
    description: skill.description,
    path: skill.path === "" ? undefined : skill.path,
    instructions: skill.instructions === "" ? undefined : skill.instructions,
    disabled: skill.disabled,
  });

export const portsToWire = (ports: ProjectPortConfigEntry[]): Record<string, unknown> =>
  Object.fromEntries(
    ports.map((port) => [
      port.name,
      { ...port.rest, defaultPort: port.defaultPort, description: port.description },
    ]),
  );

/**
 * One project patch, as the single-element `projects` array `merge_projects_by_name` matches on. The
 * name is always carried because it is the match key; nothing else is sent unless it is being
 * changed, so no untouched key can be clobbered.
 */
export const projectPatch = (
  name: string,
  changes: Record<string, unknown>,
): Record<string, unknown>[] => [{ name, ...changes }];

/* ------------------------------------------------------------- verification order */

/**
 * `EditProjectBladeView.OrderForDisplay`: the project's enabled verifications first, in the order
 * the project lists them, then every remaining registry entry. That ordering is the whole point -
 * a project's `verifications` array **is** its run order.
 *
 * A project entry naming a verification the registry does not define is dropped, exactly as V1's
 * `globalByName.TryGetValue` guard does.
 */
export function orderForDisplay(
  projectVerifications: ProjectVerificationRef[],
  globalVerifications: VerificationDef[],
): VerificationDef[] {
  const globalByName = new Map(globalVerifications.map((def) => [def.name.toLowerCase(), def]));
  const result: VerificationDef[] = [];
  const added = new Set<string>();

  for (const ref of projectVerifications) {
    const def = globalByName.get(ref.name.toLowerCase());
    if (def && !added.has(def.name.toLowerCase())) {
      added.add(def.name.toLowerCase());
      result.push(def);
    }
  }
  for (const def of globalVerifications) {
    if (!added.has(def.name.toLowerCase())) {
      added.add(def.name.toLowerCase());
      result.push(def);
    }
  }
  return result;
}

/**
 * `EditProjectBladeView.ReorderProjectVerifications`: the displayed order is remapped, only the
 * enabled ones are kept (a disabled row has no place in the run order), and any enabled entry the
 * mapping did not mention is appended so a reorder can never silently drop one.
 */
export function reorderProjectVerifications(
  newIndices: number[],
  displayed: VerificationDef[],
  current: ProjectVerificationRef[],
): ProjectVerificationRef[] {
  const byName = new Map(current.map((ref) => [ref.name.toLowerCase(), ref]));
  const result: ProjectVerificationRef[] = [];
  const processed = new Set<string>();

  for (const index of newIndices) {
    if (index < 0 || index >= displayed.length) continue;
    const key = displayed[index].name.toLowerCase();
    const ref = byName.get(key);
    if (ref && !processed.has(key)) {
      processed.add(key);
      result.push({ ...ref, name: displayed[index].name });
    }
  }
  for (const ref of current) {
    const key = ref.name.toLowerCase();
    if (!processed.has(key)) {
      processed.add(key);
      result.push(ref);
    }
  }
  return result;
}

/**
 * `EditProjectBladeView.ApplyVerificationChange`: ticking `enabled` appends the verification,
 * unticking it removes it, and a tick on `required` while already enabled only updates the flag.
 */
export function applyVerificationChange(
  item: { name: string; enabled: boolean; required: boolean },
  current: ProjectVerificationRef[],
): ProjectVerificationRef[] {
  if (item.name === "") return current;
  const index = current.findIndex((ref) => ref.name.toLowerCase() === item.name.toLowerCase());

  if (item.enabled && index < 0) {
    return [...current, { name: item.name, required: item.required, rest: {} }];
  }
  if (!item.enabled && index >= 0) {
    return current.filter((_, i) => i !== index);
  }
  if (index >= 0) {
    const next = [...current];
    next[index] = { ...next[index], required: item.required };
    return next;
  }
  return current;
}

/* ------------------------------------------------------- effective security values */

/** `AgentSecurityConfig::effective_sandbox_mode`: a preset wins over the explicit field. */
export const effectiveSandboxMode = (s: ProjectSecurityForm): string => {
  if (s.securityPreset === "Permissive") return "Disabled";
  if (s.securityPreset === "Strict" || s.securityPreset === "Restricted") return "Enabled";
  return s.sandboxMode === "InheritGeneral" ? "Disabled" : s.sandboxMode;
};

/** `effective_outside_file_access`, same precedence. */
export const effectiveOutsideFileAccess = (s: ProjectSecurityForm): string => {
  if (s.securityPreset === "Permissive") return "Allow";
  if (s.securityPreset === "Strict") return "Deny";
  if (s.securityPreset === "Restricted") return "Ask";
  return s.outsideFileAccessPolicy;
};

/** `effective_terminal_auto_execution`: independent of the preset, `InheritGeneral` proceeds. */
export const effectiveTerminalAutoExecution = (s: ProjectSecurityForm): string =>
  s.terminalAutoExecution === "InheritGeneral" ? "AlwaysProceed" : s.terminalAutoExecution;

/** `is_network_allowed`: `Strict`, or any single deny rule, denies network access outright. */
export const effectiveNetworkAllowed = (s: ProjectSecurityForm): boolean =>
  s.securityPreset !== "Strict" &&
  !s.networkAccessRules.some((rule) => rule.mode.toLowerCase() === "deny");

/**
 * Which of the fields `apply_security_settings` populates each provider's `build_*_spec` actually
 * renders into its command line. Read straight off `providers.rs`; a control the selected agent does
 * not honour is called out in the UI rather than left looking effective.
 */
export const SECURITY_ENFORCEMENT: Record<
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

/** `resolution.rs`'s `normalize_agent_name`: `claudecode` is the legacy spelling of `claude`. */
export const normalizeAgentName = (name: string): string => {
  const lower = name.trim().toLowerCase();
  return lower === "claudecode" ? "claude" : lower;
};

export const enforcementFor = (agent: string) =>
  SECURITY_ENFORCEMENT[normalizeAgentName(agent)] ?? {
    sandbox: false,
    network: false,
    terminalPrompt: false,
    fileRules: false,
  };

/**
 * `Allow|Ask|Deny <value>` lines, the shape the file and network rule editors use. A line with no
 * leading mode is `Allow`, matching the daemon's `default_allow_mode`.
 */
export function parseModeLines(text: string): { mode: string; value: string }[] {
  return parseLines(text).map((line) => {
    const [head, ...tail] = line.split(/\s+/);
    const mode = oneOf(head, OUTSIDE_FILE_POLICIES, "");
    return mode === "" ? { mode: "Allow", value: line } : { mode, value: tail.join(" ") };
  });
}
