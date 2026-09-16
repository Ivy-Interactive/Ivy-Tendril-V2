import React from "react";
import { Pencil, Plus, X } from "lucide-react";
import {
  BladeContainer,
  Button,
  Callout,
  DataTable,
  Input,
  Switch,
  useBlades,
  type BladeDescriptor,
  type DataTableColumn,
  type DataTableRowAction,
} from "@ivy-interactive/components/ui";
import { SortableVerificationList } from "@ivy-interactive/components/tendril";
import { notificationsStore } from "../../state/notificationsStore";
import { describeBridgeError } from "../../types/api";
import { LinesField, SaveError, SelectField, SubSection, TextField, asOptions } from "./fields";
import { formatEnvLines, parseEnvLines, parseLines } from "./configValues";
import {
  AUTO_IMPLEMENT_OPTIONS,
  OUTSIDE_FILE_POLICIES,
  PORTS_ARE_MERGED,
  SANDBOX_MODES,
  SECURITY_PRESETS,
  TERMINAL_AUTO_EXECUTIONS,
  applyVerificationChange,
  effectiveNetworkAllowed,
  effectiveOutsideFileAccess,
  effectiveSandboxMode,
  effectiveTerminalAutoExecution,
  enforcementFor,
  envFileToWire,
  mcpServerToWire,
  normalizeAgentName,
  orderForDisplay,
  parseModeLines,
  portsToWire,
  projectPatch,
  reorderProjectVerifications,
  repoToWire,
  reviewActionToWire,
  skillToWire,
  verificationToWire,
  type ProjectEnvFileConfigEntry,
  type ProjectEntry,
  type ProjectMcpServerRefEntry,
  type ProjectPortConfigEntry,
  type ProjectSecurityForm,
  type ProjectSkillRefEntry,
  type RepoRef,
  type ReviewActionConfigEntry,
  type VerificationDef,
} from "./projectConfig";

/**
 * `Apps/Settings/ProjectDetailView.cs` plus the editors in `Apps/Settings/Blades/`, which is where
 * V1 puts every per-project setting. V2 had none of it: repos and base branches, verifications and
 * their run order, review actions, MCP servers, skills, ports, env files, colour and Delete Project
 * had no counterpart anywhere in the app.
 *
 * The block order is `ProjectDetailView.innerContent`'s: header, repositories, review actions,
 * verifications, ports, environment files, agent behaviour, security, local permissions (MCP),
 * customizations (skills), danger zone. `isBeta` gates the same three blocks it gates in V1.
 *
 * V1 opens each editor as a blade (`IBladeContext.Push`/`Pop`); this uses `BladeContainer`, whose
 * `push`/`pop` are the same contract, with the project detail as the non-closable root at depth 1.
 *
 * Saving mirrors `ProjectDetailView.SaveProjectChanges`: an edit is persisted the moment it is
 * confirmed rather than behind a form-wide Save, because that is what V1's
 * `UseEffect(SaveProjectChanges, [...])` does. Each write sends only the keys that changed, as the
 * one-element `projects` array `merge_projects_by_name` matches by name.
 */

export interface ProjectSettingsViewProps {
  project: ProjectEntry;
  /** The top-level `verifications` registry - a project can only enable what it defines. */
  verificationDefs: VerificationDef[];
  /** The configured coding agent, for the enforcement note on the security block. */
  agent: string;
  isBeta: boolean;
  /** Writes one top-level config key and re-reads the config. */
  onSaveRaw: (key: string, value: unknown) => Promise<void>;
}

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude",
  copilot: "Copilot",
  codex: "Codex",
  gemini: "Gemini",
  antigravity: "Antigravity",
  opencode: "OpenCode",
};

/**
 * Neither rename nor delete is reachable from the app: `PUT /api/config` merges `projects` by name,
 * so a renamed entry matches nothing and is appended beside the original, and its own documentation
 * says omission is not deletion. Both need `PUT /api/projects/:name` (`newName`) and
 * `DELETE /api/projects/:name`, which the daemon has and the Tauri bridge does not expose.
 */
const RENAME_UNAVAILABLE =
  "Renaming needs PUT /api/projects/:name, which the app's bridge does not expose yet. A rename written through PUT /api/config would add a second project instead of renaming this one.";
const DELETE_UNAVAILABLE =
  "Deleting needs DELETE /api/projects/:name, which the app's bridge does not expose yet. PUT /api/config cannot remove a project: omitting one leaves it exactly as it was.";

/** The Cancel/confirm pair every V1 `*BladeView` ends with. */
const BladeFooter: React.FC<{
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}> = ({ confirmLabel, disabled, onConfirm }) => {
  const { pop } = useBlades();
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <Button type="button" variant="outline" onClick={() => pop(1)}>
        Cancel
      </Button>
      <Button type="button" disabled={disabled} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
};

/* ------------------------------------------------------------------------- blades */

/** `Blades/EditReviewActionBladeView.cs`: name and command are required, condition optional. */
const ReviewActionBlade: React.FC<{
  existing: ReviewActionConfigEntry | null;
  onSubmit: (action: ReviewActionConfigEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [command, setCommand] = React.useState(existing?.command ?? "");
  const [condition, setCondition] = React.useState(existing?.condition ?? "");

  const invalid = name.trim() === "" || command.trim() === "";

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="review-action-name"
        label="Name"
        value={name}
        placeholder="Action name..."
        onChange={setName}
      />
      <TextField
        id="review-action-command"
        label="Command"
        value={command}
        placeholder="e.g. dotnet test"
        onChange={setCommand}
      />
      <TextField
        id="review-action-condition"
        label="Condition"
        value={condition}
        placeholder="e.g. ${hasChanges}"
        onChange={setCondition}
      />
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
        disabled={invalid}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { paths: [], rest: {} }),
            name: name.trim(),
            command,
            condition,
          })
        }
      />
    </div>
  );
};

/**
 * `Blades/EditVerificationBladeView.cs`: it appends to the **global** `verifications` registry and
 * then enables the new entry on the project, which is why it takes both writes.
 */
const VerificationBlade: React.FC<{
  onSubmit: (name: string, prompt: string) => void;
  existingNames: string[];
}> = ({ onSubmit, existingNames }) => {
  const [name, setName] = React.useState("");
  const [prompt, setPrompt] = React.useState("");

  const trimmed = name.trim();
  const duplicate =
    trimmed !== "" && existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="verification-name"
        label="Name"
        value={name}
        placeholder="Verification name..."
        error={duplicate ? `A verification named '${trimmed}' already exists.` : null}
        onChange={setName}
      />
      <LinesField
        id="verification-prompt"
        label="Prompt"
        value={prompt}
        rows="tall"
        placeholder="Verification prompt..."
        onChange={setPrompt}
      />
      <BladeFooter
        confirmLabel="Add"
        disabled={trimmed === "" || duplicate}
        onConfirm={() => onSubmit(trimmed, prompt)}
      />
    </div>
  );
};

/** `Blades/EditMcpServerBladeView.cs`, including its whitespace-split arguments. */
const McpServerBlade: React.FC<{
  existing: ProjectMcpServerRefEntry | null;
  onSubmit: (server: ProjectMcpServerRefEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [command, setCommand] = React.useState(existing?.command ?? "");
  const [args, setArgs] = React.useState((existing?.arguments ?? []).join(" "));
  const [env, setEnv] = React.useState(formatEnvLines(existing?.environment ?? {}));
  const [disabled, setDisabled] = React.useState(existing?.disabled ?? false);

  const invalid = name.trim() === "" || command.trim() === "";

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="mcp-name"
        label="Name"
        value={name}
        placeholder="Server name (e.g. sqlite)..."
        onChange={setName}
      />
      <TextField
        id="mcp-command"
        label="Command"
        value={command}
        placeholder="Command executable (e.g. npx)..."
        onChange={setCommand}
      />
      <TextField
        id="mcp-arguments"
        label="Arguments"
        value={args}
        placeholder="Arguments (e.g. -y @modelcontextprotocol/server-sqlite)..."
        hint="Split on whitespace, the way EditMcpServerBladeView splits them."
        onChange={setArgs}
      />
      <LinesField
        id="mcp-environment"
        label="Environment Variables"
        value={env}
        placeholder={"KEY=VALUE"}
        hint="One KEY=VALUE per line."
        onChange={setEnv}
      />
      <div className="flex items-center gap-3">
        <Switch
          id="mcp-disabled"
          aria-labelledby="mcp-disabled-label"
          checked={disabled}
          onCheckedChange={setDisabled}
        />
        <label
          id="mcp-disabled-label"
          htmlFor="mcp-disabled"
          className="text-xs font-medium text-foreground"
        >
          Disabled
        </label>
      </div>
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
        disabled={invalid}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { rest: {} }),
            name: name.trim(),
            command: command.trim(),
            arguments: args.split(/\s+/).filter((arg) => arg !== ""),
            environment: parseEnvLines(env),
            disabled,
          })
        }
      />
    </div>
  );
};

/** `Blades/EditSkillBladeView.cs`. */
const SkillBlade: React.FC<{
  existing: ProjectSkillRefEntry | null;
  onSubmit: (skill: ProjectSkillRefEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [description, setDescription] = React.useState(existing?.description ?? "");
  const [instructions, setInstructions] = React.useState(existing?.instructions ?? "");
  const [path, setPath] = React.useState(existing?.path ?? "");
  const [disabled, setDisabled] = React.useState(existing?.disabled ?? false);

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="skill-name"
        label="Name"
        value={name}
        placeholder="Skill name (e.g. code-review)..."
        onChange={setName}
      />
      <TextField
        id="skill-description"
        label="Description"
        value={description}
        placeholder="Short description..."
        onChange={setDescription}
      />
      <LinesField
        id="skill-instructions"
        label="Instructions"
        value={instructions}
        rows="tall"
        placeholder="Markdown instructions for the agent..."
        onChange={setInstructions}
      />
      <TextField
        id="skill-path"
        label="File/Folder Path"
        value={path}
        placeholder="Path to skill folder/file (e.g. %TENDRIL_HOME%/Skills/my-skill)..."
        onChange={setPath}
      />
      <div className="flex items-center gap-3">
        <Switch
          id="skill-disabled"
          aria-labelledby="skill-disabled-label"
          checked={disabled}
          onCheckedChange={setDisabled}
        />
        <label
          id="skill-disabled-label"
          htmlFor="skill-disabled"
          className="text-xs font-medium text-foreground"
        >
          Disabled
        </label>
      </div>
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
        disabled={name.trim() === ""}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { rest: {} }),
            name: name.trim(),
            description: description.trim(),
            instructions,
            path,
            disabled,
          })
        }
      />
    </div>
  );
};

/** `Dialogs/EditProjectPortDialog.cs`, as a blade so every project editor opens the same way. */
const PortBlade: React.FC<{
  existing: ProjectPortConfigEntry | null;
  onSubmit: (port: ProjectPortConfigEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [name, setName] = React.useState(existing?.name ?? "");
  const [port, setPort] = React.useState(String(existing?.defaultPort ?? 3000));
  const [description, setDescription] = React.useState(existing?.description ?? "");

  const parsed = Number.parseInt(port, 10);
  const portInvalid = !Number.isInteger(parsed) || parsed < 1 || parsed > 65535;
  // A rename would leave the old key behind, because the merge cannot remove one.
  const renaming = existing !== null && name.trim() !== existing.name;

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="port-name"
        label="Name"
        value={name}
        placeholder="e.g. backend"
        error={renaming ? PORTS_ARE_MERGED : null}
        hint="Port identifier referenced in environment overrides via ${ports.<name>} placeholders."
        onChange={setName}
      />
      <TextField
        id="port-default"
        label="Default Port"
        value={port}
        placeholder="3000"
        error={portInvalid ? "Default Port must be between 1 and 65535." : null}
        hint="Preferred port. If it is already taken, Tendril allocates a free one instead."
        onChange={setPort}
      />
      <TextField
        id="port-description"
        label="Description"
        value={description}
        placeholder="What listens here..."
        onChange={setDescription}
      />
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
        disabled={name.trim() === "" || portInvalid || renaming}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { rest: {} }),
            name: name.trim(),
            defaultPort: parsed,
            description,
          })
        }
      />
    </div>
  );
};

/** `Dialogs/EditProjectEnvFileDialog.cs`, with its `KEY=VALUE` override lines. */
const EnvFileBlade: React.FC<{
  existing: ProjectEnvFileConfigEntry | null;
  onSubmit: (file: ProjectEnvFileConfigEntry) => void;
}> = ({ existing, onSubmit }) => {
  const [path, setPath] = React.useState(existing?.path ?? "");
  const [template, setTemplate] = React.useState(existing?.template ?? "");
  const [overrides, setOverrides] = React.useState(formatEnvLines(existing?.overrides ?? {}));

  return (
    <div className="max-w-170 space-y-4">
      <TextField
        id="env-file-path"
        label="Path"
        value={path}
        placeholder="e.g. apps/web/.env"
        hint="Relative path to the environment file recreated inside the plan worktree."
        onChange={setPath}
      />
      <TextField
        id="env-file-template"
        label="Template"
        value={template}
        placeholder="e.g. .env.example"
        hint="Optional base template copied into the worktree before overrides are applied."
        onChange={setTemplate}
      />
      <LinesField
        id="env-file-overrides"
        label="Overrides"
        value={overrides}
        rows="tall"
        placeholder={"PORT=${ports.backend}"}
        hint="KEY=VALUE lines supporting ${ports.<name>}, ${env.<VAR>} and %VAR% placeholders."
        onChange={setOverrides}
      />
      <BladeFooter
        confirmLabel={existing ? "Save" : "Add"}
        disabled={path.trim() === ""}
        onConfirm={() =>
          onSubmit({
            ...(existing ?? { rest: {} }),
            path: path.trim(),
            template: template.trim(),
            overrides: parseEnvLines(overrides),
          })
        }
      />
    </div>
  );
};

/* ------------------------------------------------------------------- detail body */

/** `Icons.Pencil` / `Icons.Trash`, the two row buttons every V1 project table carries. */
const editDeleteActions = <TRow,>(): DataTableRowAction<TRow>[] => [
  { tag: "edit", label: "Edit" },
  { tag: "delete", label: "Delete", variant: "destructive" },
];

const ProjectDetailBody: React.FC<ProjectSettingsViewProps> = ({
  project,
  verificationDefs,
  agent,
  isBeta,
  onSaveRaw,
}) => {
  const { push, pop } = useBlades();
  const [error, setError] = React.useState<string | null>(null);
  const [repoDraft, setRepoDraft] = React.useState("");
  const [basic, setBasic] = React.useState({ color: project.color, context: project.context });
  const [security, setSecurity] = React.useState<ProjectSecurityForm>(project.security);

  // Re-seeded whenever the project on disk changes, so switching sidebar rows or re-reading after a
  // save shows what config.yaml holds rather than the previous project's values.
  React.useEffect(() => {
    setBasic({ color: project.color, context: project.context });
    setSecurity(project.security);
    setError(null);
    setRepoDraft("");
  }, [project]);

  /**
   * One project patch: only the named keys are sent, so no untouched key on this project - and no
   * other project - can be clobbered. On success the caller re-reads the config.
   */
  const patch = async (changes: Record<string, unknown>, message: string) => {
    setError(null);
    try {
      await onSaveRaw("projects", projectPatch(project.name, changes));
      notificationsStore.notifySuccess("Saved", message);
    } catch (err) {
      setError(`Failed to save project: ${describeBridgeError(err)}`);
    }
  };

  const openBlade = (title: string, content: React.ReactNode) => {
    const blade: BladeDescriptor = { title, width: "md", content };
    push(blade);
  };

  /* --------------------------------------------------------------- repositories */

  const saveRepos = (repos: RepoRef[], message: string) =>
    void patch({ repos: repos.map(repoToWire) }, message);

  const addRepo = () => {
    const path = repoDraft.trim();
    if (path === "") return;
    if (project.repos.some((repo) => repo.path.toLowerCase() === path.toLowerCase())) {
      setRepoDraft("");
      return;
    }
    saveRepos([...project.repos, { path, rest: {} }], `Added ${path}`);
    setRepoDraft("");
  };

  /* ----------------------------------------------------------- review actions */

  const reviewActionColumns: DataTableColumn<ReviewActionConfigEntry>[] = [
    { name: "name", header: "Action Name", accessor: (row) => row.name },
    { name: "command", header: "Command", accessor: (row) => row.command },
    { name: "condition", header: "Condition", accessor: (row) => row.condition },
  ];

  const submitReviewAction = (action: ReviewActionConfigEntry, index: number | null) => {
    const next = [...project.reviewActions];
    if (index === null) next.push(action);
    else next[index] = action;
    pop(1);
    void patch(
      { reviewActions: next.map(reviewActionToWire) },
      `Review action '${action.name}' saved`,
    );
  };

  /* ------------------------------------------------------------ verifications */

  const displayed = React.useMemo(
    () => orderForDisplay(project.verifications, verificationDefs),
    [project.verifications, verificationDefs],
  );

  const verificationItemsJson = React.useMemo(
    () =>
      JSON.stringify(
        displayed.map((def) => {
          const ref = project.verifications.find(
            (v) => v.name.toLowerCase() === def.name.toLowerCase(),
          );
          return { name: def.name, enabled: ref !== undefined, required: ref?.required ?? false };
        }),
      ),
    [displayed, project.verifications],
  );

  const saveVerifications = (next: ReturnType<typeof applyVerificationChange>, message: string) =>
    void patch({ verifications: next.map(verificationToWire) }, message);

  /**
   * `SortableVerificationList` is a C#-bridge-shaped widget: it only emits an event whose name is in
   * `events`, and both payloads arrive as a single JSON string. It is exported from the components
   * package and imported by nothing, which is exactly why verification run order had no UI.
   */
  const verificationEvents = React.useMemo(() => ["OnChange", "OnReorder"], []);

  const onVerificationEvent = (eventName: string, _widgetId: string, args: unknown[]) => {
    const payload = typeof args[0] === "string" ? args[0] : "";
    if (payload === "") return;
    if (eventName === "OnChange") {
      const item = JSON.parse(payload) as { name: string; enabled: boolean; required: boolean };
      saveVerifications(
        applyVerificationChange(item, project.verifications),
        `Verifications updated for ${project.name}`,
      );
      return;
    }
    if (eventName === "OnReorder") {
      const indices = JSON.parse(payload) as number[];
      saveVerifications(
        reorderProjectVerifications(indices, displayed, project.verifications),
        "Verification run order saved",
      );
    }
  };

  const addVerification = (name: string, prompt: string) => {
    pop(1);
    void (async () => {
      setError(null);
      try {
        // The registry is a top-level sequence, which the merge replaces, so the whole list is sent.
        await onSaveRaw("verifications", [
          ...verificationDefs.map((def) => ({ ...def.rest, name: def.name, prompt: def.prompt })),
          { name, prompt },
        ]);
        await onSaveRaw(
          "projects",
          projectPatch(project.name, {
            verifications: [...project.verifications, { name, required: false }].map((ref) => ({
              name: ref.name,
              required: ref.required,
            })),
          }),
        );
        notificationsStore.notifySuccess("Saved", "Verification added");
      } catch (err) {
        setError(`Failed to add verification: ${describeBridgeError(err)}`);
      }
    })();
  };

  /* -------------------------------------------------------------------- ports */

  const portColumns: DataTableColumn<ProjectPortConfigEntry>[] = [
    { name: "name", header: "Name", accessor: (row) => row.name },
    { name: "defaultPort", header: "Default Port", accessor: (row) => row.defaultPort },
    { name: "description", header: "Description", accessor: (row) => row.description },
  ];

  const submitPort = (port: ProjectPortConfigEntry, existing: ProjectPortConfigEntry | null) => {
    const others = project.ports.filter((p) => p.name !== existing?.name);
    pop(1);
    void patch({ ports: portsToWire([...others, port]) }, `Port '${port.name}' saved`);
  };

  /* --------------------------------------------------------- environment files */

  const envFileColumns: DataTableColumn<ProjectEnvFileConfigEntry>[] = [
    { name: "path", header: "Path", accessor: (row) => row.path },
    { name: "template", header: "Template", accessor: (row) => row.template },
    {
      name: "overrides",
      header: "Overrides",
      accessor: (row) => Object.keys(row.overrides).join(", "),
    },
  ];

  const submitEnvFile = (file: ProjectEnvFileConfigEntry, index: number | null) => {
    const next = [...project.envFiles];
    if (index === null) next.push(file);
    else next[index] = file;
    pop(1);
    void patch({ envFiles: next.map(envFileToWire) }, `Environment file '${file.path}' saved`);
  };

  /* ------------------------------------------------------------- mcp / skills */

  const mcpColumns: DataTableColumn<ProjectMcpServerRefEntry>[] = [
    { name: "name", header: "Name", accessor: (row) => row.name },
    {
      name: "command",
      header: "Command",
      accessor: (row) => [row.command, ...row.arguments].join(" "),
    },
    { name: "disabled", header: "Disabled", accessor: (row) => (row.disabled ? "Yes" : "No") },
  ];

  const submitMcpServer = (server: ProjectMcpServerRefEntry, index: number | null) => {
    const next = [...project.mcpServers];
    if (index === null) next.push(server);
    else next[index] = server;
    pop(1);
    void patch({ mcpServers: next.map(mcpServerToWire) }, `MCP server '${server.name}' saved`);
  };

  const skillColumns: DataTableColumn<ProjectSkillRefEntry>[] = [
    { name: "name", header: "Name", accessor: (row) => row.name },
    { name: "description", header: "Description", accessor: (row) => row.description },
    { name: "path", header: "Path", accessor: (row) => row.path },
  ];

  const submitSkill = (skill: ProjectSkillRefEntry, index: number | null) => {
    const next = [...project.skills];
    if (index === null) next.push(skill);
    else next[index] = skill;
    pop(1);
    void patch({ skills: next.map(skillToWire) }, `Skill '${skill.name}' saved`);
  };

  /* ----------------------------------------------------------------- security */

  const presetOverrides = security.securityPreset !== "Custom";
  const enforcement = enforcementFor(agent);
  const agentLabel = AGENT_LABELS[normalizeAgentName(agent)] ?? agent;
  const securityChanged = JSON.stringify(security) !== JSON.stringify(project.security);
  const basicChanged = basic.color !== project.color || basic.context !== project.context;
  const setSecurityField = <K extends keyof ProjectSecurityForm>(
    key: K,
    value: ProjectSecurityForm[K],
  ) => setSecurity((prev) => ({ ...prev, [key]: value }));

  const enforcementPairs: [string, boolean][] = [
    ["sandbox mode", enforcement.sandbox],
    ["network access", enforcement.network],
    ["terminal confirmation", enforcement.terminalPrompt],
    ["file and command rules", enforcement.fileRules],
  ];

  return (
    <div className="space-y-6" data-testid={`project-settings-${project.name}`}>
      {/* Section 1: header. V1 renders a colour swatch, the name and a Rename pencil. */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-foreground">{project.name}</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          title={RENAME_UNAVAILABLE}
          aria-label="Rename Project"
        >
          <Pencil className="size-4" aria-hidden />
        </Button>
      </div>

      <SaveError message={error} />

      <SubSection
        title="Basic"
        hint="The project's colour and the AI context handed to every agent working on it."
      >
        <form
          className="max-w-170 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ color: basic.color, context: basic.context }, "Project saved");
          }}
        >
          {/* V1 uses `ToColorInput(SwatchPicker)` over the Ivy `Colors` enum. V2's palette is
              generated and carries no per-name colour token, and the parity contract forbids adding
              one, so the colour is edited as the enum name it is stored as. */}
          <TextField
            id="project-color"
            label="Color"
            value={basic.color}
            placeholder="e.g. Emerald"
            hint="An Ivy colour name, as config.yaml stores it (Red, Blue, Purple, Slate, Green...)."
            onChange={(value) => setBasic((prev) => ({ ...prev, color: value }))}
          />
          <LinesField
            id="project-context"
            label="Context"
            value={basic.context}
            rows="tall"
            placeholder="What an agent should know about this project..."
            onChange={(value) => setBasic((prev) => ({ ...prev, context: value }))}
          />
          <Button type="submit" disabled={!basicChanged}>
            Save
          </Button>
        </form>
      </SubSection>

      {/* Section 2: repositories. V1's `ProjectRepoPickerView` is a list, not a table, with the
          base branch editable per row. Its Sync button is omitted: no bridge method syncs a repo. */}
      <SubSection
        title="Repositories"
        hint="Source repositories, and the base branch each plan branches from."
        count={project.repos.length}
        testId="project-repos"
      >
        <div className="max-w-170 space-y-2">
          {project.repos.length === 0 && (
            <p className="text-sm text-muted-foreground">No repositories yet.</p>
          )}
          {project.repos.map((repo, index) => (
            <div
              key={repo.path}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-primary">
                {repo.path}
              </span>
              <Input
                aria-label={`Base branch for ${repo.path}`}
                value={repo.baseBranch ?? ""}
                placeholder="Base branch"
                className="w-40"
                onChange={(e) => {
                  const next = [...project.repos];
                  const value = e.target.value.trim();
                  next[index] = { ...repo, baseBranch: value === "" ? undefined : value };
                  saveRepos(next, `Base branch saved for ${repo.path}`);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Remove ${repo.path}`}
                onClick={() =>
                  saveRepos(
                    project.repos.filter((_, i) => i !== index),
                    `Removed ${repo.path}`,
                  )
                }
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Repository URL or Local Path"
              value={repoDraft}
              placeholder="Repository URL or Local Path"
              className="min-w-60 flex-1"
              onChange={(e) => setRepoDraft(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={repoDraft.trim() === ""}
              onClick={addRepo}
            >
              <Plus className="size-4" aria-hidden />
              Add Repository
            </Button>
          </div>
          {/* V1 clones a remote URL into TENDRIL_HOME on add and resolves the real default branch
              first; neither is reachable from V2, so a remote URL is stored verbatim. */}
          <p className="text-xs text-muted-foreground">
            V1 clones a remote URL into TENDRIL_HOME and detects its default branch on add. Neither
            is reachable from this app, so a path is stored exactly as typed.
          </p>
        </div>
      </SubSection>

      {/* Section 3: review actions. */}
      <SubSection
        title="Review Actions"
        hint="Quick-launch buttons shown during review to preview or run the app."
        count={project.reviewActions.length}
        testId="project-review-actions"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openBlade(
                "Add Review Action",
                <ReviewActionBlade
                  existing={null}
                  onSubmit={(action) => submitReviewAction(action, null)}
                />,
              )
            }
          >
            <Plus className="size-4" aria-hidden />
            Add Review Action
          </Button>
        }
      >
        <DataTable<ReviewActionConfigEntry>
          data-testid="project-review-actions-table"
          paginated={false}
          columns={reviewActionColumns}
          rows={project.reviewActions}
          getRowId={(row) => row.name}
          rowActions={editDeleteActions<ReviewActionConfigEntry>()}
          emptyState={
            <span className="text-muted-foreground">No review actions for this project.</span>
          }
          onRowAction={({ tag, row }) => {
            const index = project.reviewActions.findIndex((a) => a.name === row.name);
            if (tag === "edit") {
              openBlade(
                "Edit Review Action",
                <ReviewActionBlade
                  existing={row}
                  onSubmit={(action) => submitReviewAction(action, index)}
                />,
              );
            } else if (tag === "delete") {
              void patch(
                {
                  reviewActions: project.reviewActions
                    .filter((_, i) => i !== index)
                    .map(reviewActionToWire),
                },
                `Review action '${row.name}' deleted`,
              );
            }
          }}
        />
      </SubSection>

      {/* Section 4: verifications, with the run order the project's own array encodes. */}
      <SubSection
        title="Verifications"
        hint="Quality checks required before plans are marked complete. Drag to set the run order."
        count={project.verifications.length}
        testId="project-verifications"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openBlade(
                "Add Verification",
                <VerificationBlade
                  existingNames={verificationDefs.map((def) => def.name)}
                  onSubmit={addVerification}
                />,
              )
            }
          >
            <Plus className="size-4" aria-hidden />
            Add Verification
          </Button>
        }
      >
        {displayed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No verifications are defined in config.yaml, so there is nothing to enable. Add one to
            create it and enable it here.
          </p>
        ) : (
          <div className="max-h-80 max-w-170 overflow-auto">
            <SortableVerificationList
              id="project-verifications-list"
              itemsJson={verificationItemsJson}
              events={verificationEvents}
              eventHandler={onVerificationEvent}
            />
          </div>
        )}
      </SubSection>

      {/* Section 5: ports. */}
      <SubSection
        title="Ports"
        hint="Named service ports. A plan falls back to a free port when the default is taken."
        count={project.ports.length}
        testId="project-ports"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openBlade(
                "Add Port",
                <PortBlade existing={null} onSubmit={(p) => submitPort(p, null)} />,
              )
            }
          >
            <Plus className="size-4" aria-hidden />
            Add Port
          </Button>
        }
      >
        <DataTable<ProjectPortConfigEntry>
          data-testid="project-ports-table"
          paginated={false}
          columns={portColumns}
          rows={project.ports}
          getRowId={(row) => row.name}
          rowActions={[{ tag: "edit", label: "Edit" }]}
          emptyState={
            <span className="text-muted-foreground">
              No service ports configured. Define named ports for dynamic port allocation across
              concurrent plan reviews.
            </span>
          }
          onRowAction={({ tag, row }) => {
            if (tag === "edit") {
              openBlade(
                "Edit Port",
                <PortBlade existing={row} onSubmit={(p) => submitPort(p, row)} />,
              );
            }
          }}
        />
        {/* V1 can delete and rename a port because it rewrites the whole file. This app cannot. */}
        <Callout.Warning data-testid="project-ports-merge-note">{PORTS_ARE_MERGED}</Callout.Warning>
      </SubSection>

      {/* Section 6: environment files. */}
      <SubSection
        title="Environment Files"
        hint="Files recreated inside every plan worktree, which starts without untracked .env files."
        count={project.envFiles.length}
        testId="project-env-files"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openBlade(
                "Add Environment File",
                <EnvFileBlade existing={null} onSubmit={(f) => submitEnvFile(f, null)} />,
              )
            }
          >
            <Plus className="size-4" aria-hidden />
            Add Environment File
          </Button>
        }
      >
        <DataTable<ProjectEnvFileConfigEntry>
          data-testid="project-env-files-table"
          paginated={false}
          columns={envFileColumns}
          rows={project.envFiles}
          getRowId={(row) => row.path}
          rowActions={editDeleteActions<ProjectEnvFileConfigEntry>()}
          emptyState={
            <span className="text-muted-foreground">
              No environment files configured. Define environment files to materialize .env
              templates and inject variables into plan worktrees.
            </span>
          }
          onRowAction={({ tag, row }) => {
            const index = project.envFiles.findIndex((f) => f.path === row.path);
            if (tag === "edit") {
              openBlade(
                "Edit Environment File",
                <EnvFileBlade existing={row} onSubmit={(f) => submitEnvFile(f, index)} />,
              );
            } else if (tag === "delete") {
              void patch(
                { envFiles: project.envFiles.filter((_, i) => i !== index).map(envFileToWire) },
                `Environment file '${row.path}' deleted`,
              );
            }
          }}
        />
      </SubSection>

      {/* Section 7: agent behaviour, `isBeta` in V1. */}
      {isBeta && (
        <SubSection title="Agent Behavior" testId="project-agent-behavior">
          <div className="max-w-170">
            <SelectField
              id="project-auto-implement"
              label="Artifact Review / Auto-Implement Policy"
              value={security.autoImplementPlans}
              options={AUTO_IMPLEMENT_OPTIONS}
              onChange={(value) => {
                setSecurityField("autoImplementPlans", value);
                void patch({ autoImplementPlans: value }, "Agent behaviour saved");
              }}
            />
          </div>
        </SubSection>
      )}

      {/* Security. No V1 counterpart at all: `ProjectDetailView` never exposed the seven flattened
          `AgentSecurityConfig` keys that `apply_security_settings` reads on every job launch. They
          belong to one project, so they live here rather than as a top-level settings section. */}
      <SubSection
        title="Security"
        hint="Sandboxing, file and network rules, and terminal confirmation, for this project."
        testId="project-security"
      >
        <form
          className="max-w-170 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void patch(
              {
                sandboxMode: security.sandboxMode,
                securityPreset: security.securityPreset,
                outsideFileAccessPolicy: security.outsideFileAccessPolicy,
                terminalAutoExecution: security.terminalAutoExecution,
                filePermissions: security.filePermissions,
                networkAccessRules: security.networkAccessRules,
                allowedTerminalCommands: security.allowedTerminalCommands,
              },
              `Security settings saved for ${project.name}`,
            );
          }}
        >
          <SelectField
            id="project-security-preset"
            label="Security Preset"
            value={security.securityPreset}
            options={asOptions(SECURITY_PRESETS)}
            hint="Anything other than Custom overrides the sandbox and file/network fields below."
            onChange={(value) => setSecurityField("securityPreset", value)}
          />
          <SelectField
            id="project-sandbox-mode"
            label="Sandbox Mode"
            value={security.sandboxMode}
            options={asOptions(SANDBOX_MODES)}
            disabled={presetOverrides}
            hint={`Inherit General means no sandbox. Effective: ${effectiveSandboxMode(security)}.`}
            onChange={(value) => setSecurityField("sandboxMode", value)}
          />
          <SelectField
            id="project-outside-file-access"
            label="Outside File Access"
            value={security.outsideFileAccessPolicy}
            options={asOptions(OUTSIDE_FILE_POLICIES)}
            disabled={presetOverrides}
            hint={`Deny drops every file rule below. Effective: ${effectiveOutsideFileAccess(security)}.`}
            onChange={(value) => setSecurityField("outsideFileAccessPolicy", value)}
          />
          <SelectField
            id="project-terminal-auto-execution"
            label="Terminal Auto-Execution"
            value={security.terminalAutoExecution}
            options={asOptions(TERMINAL_AUTO_EXECUTIONS)}
            hint={`Not affected by the preset. Effective: ${effectiveTerminalAutoExecution(security)}.`}
            onChange={(value) => setSecurityField("terminalAutoExecution", value)}
          />
          <LinesField
            id="project-file-permissions"
            label="File Permissions"
            value={security.filePermissions.map((rule) => `${rule.mode} ${rule.path}`).join("\n")}
            placeholder={"Allow src/**\nDeny .env"}
            hint="One `Allow|Ask|Deny <path>` per line. Allow adds a writable directory; Deny denies Write and Edit on the path."
            onChange={(value) =>
              setSecurityField(
                "filePermissions",
                parseModeLines(value).map((rule) => ({ path: rule.value, mode: rule.mode })),
              )
            }
          />
          <LinesField
            id="project-network-rules"
            label="Network Access Rules"
            value={security.networkAccessRules
              .map((rule) => `${rule.mode} ${rule.urlPattern}`)
              .join("\n")}
            placeholder={"Deny https://example.com/*"}
            hint={`One \`Allow|Deny <url pattern>\` per line. A single Deny turns network access off entirely. Effective: ${
              effectiveNetworkAllowed(security) ? "allowed" : "denied"
            }.`}
            onChange={(value) =>
              setSecurityField(
                "networkAccessRules",
                parseModeLines(value).map((rule) => ({ urlPattern: rule.value, mode: rule.mode })),
              )
            }
          />
          <LinesField
            id="project-allowed-terminal-commands"
            label="Allowed Terminal Commands"
            value={security.allowedTerminalCommands.join("\n")}
            placeholder={"pnpm\ncargo"}
            hint="One command per line, each allowed as `Bash(<command> *)`."
            onChange={(value) => setSecurityField("allowedTerminalCommands", parseLines(value))}
          />

          {/* A control the configured agent's CLI has no argument for is inert, so say which. */}
          <Callout.Info data-testid="project-security-enforcement">
            <div className="space-y-1">
              <p>
                {agentLabel} enforces:{" "}
                {enforcementPairs
                  .filter(([, on]) => on)
                  .map(([name]) => name)
                  .join(", ") || "none of these controls"}
                .
              </p>
              {enforcementPairs.some(([, on]) => !on) && (
                <p className="text-xs">
                  Ignored by {agentLabel}:{" "}
                  {enforcementPairs
                    .filter(([, on]) => !on)
                    .map(([name]) => name)
                    .join(", ")}
                  . Those keys are still written and honoured by agents that support them.
                </p>
              )}
            </div>
          </Callout.Info>

          <Button type="submit" disabled={!securityChanged}>
            Save
          </Button>
        </form>
      </SubSection>

      {/* Section 8: local permissions (MCP), `isBeta` in V1. */}
      {isBeta && (
        <SubSection
          title="Local Permissions"
          hint="Custom Model Context Protocol servers for this project."
          count={project.mcpServers.length}
          testId="project-mcp-servers"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                openBlade(
                  "Add MCP Server",
                  <McpServerBlade existing={null} onSubmit={(s) => submitMcpServer(s, null)} />,
                )
              }
            >
              <Plus className="size-4" aria-hidden />
              Add MCP Server
            </Button>
          }
        >
          <DataTable<ProjectMcpServerRefEntry>
            data-testid="project-mcp-servers-table"
            paginated={false}
            columns={mcpColumns}
            rows={project.mcpServers}
            getRowId={(row) => row.name}
            rowActions={editDeleteActions<ProjectMcpServerRefEntry>()}
            emptyState={
              <span className="text-muted-foreground">
                No MCP servers configured for this project.
              </span>
            }
            onRowAction={({ tag, row }) => {
              const index = project.mcpServers.findIndex((s) => s.name === row.name);
              if (tag === "edit") {
                openBlade(
                  "Edit MCP Server",
                  <McpServerBlade existing={row} onSubmit={(s) => submitMcpServer(s, index)} />,
                );
              } else if (tag === "delete") {
                void patch(
                  {
                    mcpServers: project.mcpServers
                      .filter((_, i) => i !== index)
                      .map(mcpServerToWire),
                  },
                  `MCP server '${row.name}' deleted`,
                );
              }
            }}
          />
        </SubSection>
      )}

      {/* Section 9: customizations (skills and memories), `isBeta` in V1. */}
      {isBeta && (
        <SubSection
          title="Customizations"
          hint="Custom skills and prompt instructions for agents working on this project."
          count={project.skills.length}
          testId="project-skills"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                openBlade(
                  "Add Custom Skill",
                  <SkillBlade existing={null} onSubmit={(s) => submitSkill(s, null)} />,
                )
              }
            >
              <Plus className="size-4" aria-hidden />
              Add Custom Skill
            </Button>
          }
        >
          <DataTable<ProjectSkillRefEntry>
            data-testid="project-skills-table"
            paginated={false}
            columns={skillColumns}
            rows={project.skills}
            getRowId={(row) => row.name}
            rowActions={editDeleteActions<ProjectSkillRefEntry>()}
            emptyState={
              <span className="text-muted-foreground">
                No custom skills configured for this project.
              </span>
            }
            onRowAction={({ tag, row }) => {
              const index = project.skills.findIndex((s) => s.name === row.name);
              if (tag === "edit") {
                openBlade(
                  "Edit Custom Skill",
                  <SkillBlade existing={row} onSubmit={(s) => submitSkill(s, index)} />,
                );
              } else if (tag === "delete") {
                void patch(
                  { skills: project.skills.filter((_, i) => i !== index).map(skillToWire) },
                  `Skill '${row.name}' deleted`,
                );
              }
            }}
          />
          {/* `ProjectMemoryTableView` and `EditProjectMemoryBladeView` read and write markdown files
              under `<TENDRIL_HOME>/Projects/<Project>/memory/`. The daemon has no memory route and
              the bridge has no filesystem access, so project memories stay unreachable. */}
          <Callout.Info data-testid="project-memory-note">
            Project memories live as markdown files under
            {" <TENDRIL_HOME>/Projects/<Project>/memory/"}. The daemon exposes no route for them, so
            they cannot be edited here yet.
          </Callout.Info>
        </SubSection>
      )}

      {/* Section 10: danger zone. */}
      <SubSection title="Danger Zone" testId="project-danger-zone">
        <div className="space-y-2">
          <Button type="button" variant="destructive" disabled title={DELETE_UNAVAILABLE}>
            Delete Project
          </Button>
          <p className="text-xs text-muted-foreground">{DELETE_UNAVAILABLE}</p>
        </div>
      </SubSection>
    </div>
  );
};

/**
 * The project screen, with `ProjectDetailView` as the non-closable root blade and every editor
 * pushed on top of it - V1's `bladeContext.Push(this, new Edit...BladeView(...))`.
 */
export const ProjectSettingsView: React.FC<ProjectSettingsViewProps> = (props) => (
  <BladeContainer
    aria-label="Project configuration"
    data-testid="project-settings-blades"
    root={{
      title: props.project.name,
      subtitle: "Project configuration",
      width: "flex",
      content: <ProjectDetailBody {...props} />,
    }}
  />
);
