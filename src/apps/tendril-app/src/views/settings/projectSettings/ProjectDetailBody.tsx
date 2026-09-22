import React from "react";
import { Plus, X } from "lucide-react";
import {
  Button,
  Callout,
  DataTable,
  Input,
  Spinner,
  type BladeDescriptor,
  type DataTableColumn,
  type DataTableRowAction,
  useBlades,
} from "@ivy-interactive/components/ui";
import { SortableVerificationList } from "@ivy-interactive/components/tendril";
import { bridge } from "../../../api/bridge";
import { notificationsStore } from "../../../state/notificationsStore";
import { describeBridgeError } from "../../../types/api";
import {
  ColorSwatchField,
  LinesField,
  SETTINGS_CONTAINER,
  SaveError,
  SelectField,
  SubSection,
  asOptions,
} from "../fields";
import { useRemovalConfirm } from "../useRemovalConfirm";
import { parseLines } from "../configValues";
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
  type ProjectMcpServerRefEntry,
  type ProjectPortConfigEntry,
  type ProjectSecurityForm,
  type ProjectSkillRefEntry,
  type RepoRef,
  type ReviewActionConfigEntry,
} from "../projectConfig";
import { classifyRepoPath, isValidRepoPath, normalizeRepoPath } from "../../onboarding/validation";
import { DeleteProjectDialog } from "../../dialogs/DeleteProjectDialog";
import { RemoveProjectDialog } from "../../dialogs/RemoveProjectDialog";
import {
  EnvFileBlade,
  McpServerBlade,
  PortBlade,
  ReviewActionBlade,
  SkillBlade,
  VerificationBlade,
} from "./blades";
import { AGENT_LABELS, type ProjectSettingsViewProps } from "./types";

/* ------------------------------------------------------------------- detail body */

/** `Icons.Pencil` / `Icons.Trash`, the two row buttons every V1 project table carries. */
const editDeleteActions = <TRow,>(): DataTableRowAction<TRow>[] => [
  { tag: "edit", label: "Edit" },
  { tag: "delete", label: "Delete", variant: "destructive" },
];

/**
 * A cell whose value may be one long unbroken string — a review action's command, an env file path, a
 * skill path — capped so it cannot dictate how wide this screen is.
 *
 * Why it is needed at all: a `<td>`'s min-content width is its longest unbreakable run, and a URL has
 * no spaces to break on, so one long command made the table wider than the blade. The blade's content
 * sits inside a Radix `ScrollArea`, whose content wrapper is `display: table` and therefore
 * shrink-to-fit — so it grew to match, and the whole project screen gained a horizontal scrollbar.
 *
 * V1 never hit this because `ReviewActionsTableView` (`Apps/Settings/Blades/ProjectTableViews.cs:385`)
 * renders **only** `Action Name` and the button column — the command and condition are not in its
 * table at all, they live in the edit blade. V2 shows them, which is more useful, so they are kept and
 * bounded rather than dropped back to V1's two columns.
 *
 * `max-w` makes the cap definite, which is what lets `truncate` ellipsize; `title` keeps the whole
 * value readable, so nothing is lost — and `Edit` still shows it in full in a field.
 */
const CappedCell: React.FC<{ value: string }> = ({ value }) =>
  value === "" ? null : (
    <span className="block max-w-90 truncate" title={value}>
      {value}
    </span>
  );

/** `cell` for a column whose accessor already returns the string to show. */
const cappedCell =
  <TRow,>(read: (row: TRow) => string) =>
  (_value: unknown, row: TRow) => <CappedCell value={read(row)} />;

export const ProjectDetailBody: React.FC<ProjectSettingsViewProps> = ({
  project,
  verificationDefs,
  agent,
  isBeta,
  onSaveRaw,
  onReloadConfig,
  onRemoved,
  onDeleted,
}) => {
  const { push, pop } = useBlades();
  const [error, setError] = React.useState<string | null>(null);
  const [repoDraft, setRepoDraft] = React.useState("");
  const [repoError, setRepoError] = React.useState<string | null>(null);
  const [isAddingRepo, setIsAddingRepo] = React.useState(false);
  const [isRemoving, setIsRemoving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
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

  /**
   * Every destructive row action on this screen goes through one confirm, per Framework's
   * "never delete on single click". Each of them rewrites `config.yaml` with the entry gone, and
   * `merge_config_value` replaces sequences wholesale, so the click was the whole transaction.
   */
  const { requestRemoval, removalDialog } = useRemovalConfirm();

  /* --------------------------------------------------------------- repositories */

  const saveRepos = (repos: RepoRef[], message: string) =>
    void patch({ repos: repos.map(repoToWire) }, message);

  /**
   * V1 `ProjectRepoPickerView.AddAsync`: normalize, refuse what `RepoPathValidator` does not
   * recognise, dedupe, add.
   *
   * A remote is the one row action on this screen that is *not* a `PUT /api/config` write, and it
   * cannot be one. That route saves what it is handed, so a URL added through it is what ends up in
   * `config.yaml`: any credential the URL carries is persisted verbatim, and the entry is dead
   * weight besides, because `resolve_working_directory` only ever picks a repo path that is a
   * directory on disk. `POST /api/projects/:name/repos` is the only route that clones, so a remote
   * goes there and the project is re-read afterwards - the stored path is the clone's directory and
   * the response is the only place it is named. A local path still goes through the config write,
   * which is all V1 does with one too.
   */
  const addRepo = async () => {
    const path = normalizeRepoPath(repoDraft);
    if (path === "") return;
    setRepoError(null);

    if (!isValidRepoPath(path)) {
      setRepoError("Invalid repository path.");
      return;
    }

    if (project.repos.some((repo) => repo.path.toLowerCase() === path.toLowerCase())) {
      setRepoDraft("");
      return;
    }

    if (classifyRepoPath(path) === "local") {
      saveRepos([...project.repos, { path, rest: {} }], `Added ${path}`);
      setRepoDraft("");
      return;
    }

    // The clone runs inside the request and can take minutes on a large repository, so the button
    // stays down for the whole of it rather than letting a second click start a second clone.
    setIsAddingRepo(true);
    try {
      const added = await bridge.addProjectRepo(project.name, path);
      await onReloadConfig();
      setRepoDraft("");
      // The clone path, never `path`. A remote URL can carry a token, and a toast is copied into
      // screenshots and bug reports; the daemon's answer is a directory under TENDRIL_HOME and
      // cannot carry one. `redact_credentials` is the daemon's guard on the same hazard.
      notificationsStore.notifySuccess("Cloned", `Repository cloned to ${added.path}`);
    } catch (err) {
      // The daemon has already put every URL its clone errors mention through `redact_credentials`,
      // so relaying its message is safe and re-stating the typed URL here would undo that.
      setRepoError(`Failed to add repository: ${describeBridgeError(err)}`);
    } finally {
      setIsAddingRepo(false);
    }
  };

  /* ----------------------------------------------------------- review actions */

  const reviewActionColumns: DataTableColumn<ReviewActionConfigEntry>[] = [
    { name: "name", header: "Action Name", accessor: (row) => row.name },
    {
      name: "command",
      header: "Command",
      accessor: (row) => row.command,
      cell: cappedCell<ReviewActionConfigEntry>((row) => row.command),
    },
    {
      name: "condition",
      header: "Condition",
      accessor: (row) => row.condition,
      cell: cappedCell<ReviewActionConfigEntry>((row) => row.condition),
    },
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
    {
      name: "path",
      header: "Path",
      accessor: (row) => row.path,
      cell: cappedCell<ProjectEnvFileConfigEntry>((row) => row.path),
    },
    {
      name: "template",
      header: "Template",
      accessor: (row) => row.template,
      cell: cappedCell<ProjectEnvFileConfigEntry>((row) => row.template),
    },
    {
      name: "overrides",
      header: "Overrides",
      accessor: (row) => Object.keys(row.overrides).join(", "),
      cell: cappedCell<ProjectEnvFileConfigEntry>((row) => Object.keys(row.overrides).join(", ")),
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
      cell: cappedCell<ProjectMcpServerRefEntry>((row) =>
        [row.command, ...row.arguments].join(" "),
      ),
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
    {
      name: "description",
      header: "Description",
      accessor: (row) => row.description,
      cell: cappedCell<ProjectSkillRefEntry>((row) => row.description),
    },
    {
      name: "path",
      header: "Path",
      accessor: (row) => row.path,
      cell: cappedCell<ProjectSkillRefEntry>((row) => row.path),
    },
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
    // The pane is capped at the shared settings width, which bounds every child at once. Without it
    // only the *content* was bounded while `SubSection`'s header stretched to the pane, so on a wide
    // window every "Add …" button sat far out to the right of the fields it belonged to, and a wide
    // table pushed rows past the edge with no way to scroll to them.
    <div
      className={`${SETTINGS_CONTAINER} space-y-6`}
      data-testid={`project-settings-${project.name}`}
    >
      {/* No in-body header: the blade header above already prints the project name, and printing it
          twice cost a whole row before the first field. The Rename pencil V1 puts beside the name
          moved up there with it, as the blade's `headerAction`. */}
      <SaveError message={error} />

      <SubSection
        title="Basic"
        hint="The project's colour and the AI context handed to every agent working on it."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ color: basic.color, context: basic.context }, "Project saved");
          }}
        >
          {/* V1's `projectColor.ToColorInput().Variant(ColorInputVariant.SwatchPicker)`
              (`ProjectDetailView.cs:222`): the 32 Ivy `Colors` names as a swatch grid behind a
              filled trigger. This was a free `TextField` on the reasoning that V2 carried no
              per-name colour token - which has not been true since `tokens.css` grew the named
              palette, and the free field let an operator type a value V1's own `ConfigService`
              would rewrite to `Slate` on the next save. */}
          <ColorSwatchField
            id="project-color"
            label="Color"
            value={basic.color}
            hint="An Ivy colour name, as config.yaml stores it."
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
        <div className="space-y-2">
          {project.repos.length === 0 && (
            <p className="text-sm text-muted-foreground">No repositories yet.</p>
          )}
          {project.repos.map((repo, index) => (
            <div
              key={repo.path}
              className="flex flex-wrap items-center gap-2 rounded-selector bg-muted/50 p-2"
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
                  requestRemoval({
                    kind: "repository",
                    name: repo.path,
                    consequence:
                      "The checkout on disk is untouched — this only stops new plans for this project from being based on it.",
                    onConfirm: () =>
                      saveRepos(
                        project.repos.filter((_, i) => i !== index),
                        `Removed ${repo.path}`,
                      ),
                  })
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
              disabled={isAddingRepo}
              onChange={(e) => setRepoDraft(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={repoDraft.trim() === "" || isAddingRepo}
              onClick={() => void addRepo()}
            >
              {isAddingRepo ? (
                <Spinner size="md" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              {isAddingRepo ? "Cloning..." : "Add Repository"}
            </Button>
          </div>
          {repoError && (
            <p className="text-xs text-destructive" data-testid="project-repo-error">
              {repoError}
            </p>
          )}
          {/* The clone is the daemon's, and it can take minutes on a large repository - worth
              saying, because the row only appears once it has finished. */}
          <p className="text-xs text-muted-foreground">
            A remote URL is cloned into TENDRIL_HOME, and the row shows where it was cloned to
            rather than the URL; a local path is stored as typed.
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
          /* Without a fixed layout a `<table>` sizes to its content, so several columns each holding
             a path or a URL made the table far wider than the settings pane and handed the whole
             view a horizontal scrollbar. `table-fixed` makes the columns divide the available width
             instead, which is also what lets the per-cell `truncate` bind. `JobsView` forces the
             same thing for the same reason. */
          className="[&_table.ivy-data-table]:table-fixed"
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
              requestRemoval({
                kind: "review action",
                name: row.name,
                consequence:
                  "It stops being offered on this project's plans in Review, and the remaining actions close up around its place in the run order.",
                onConfirm: () =>
                  void patch(
                    {
                      reviewActions: project.reviewActions
                        .filter((_, i) => i !== index)
                        .map(reviewActionToWire),
                    },
                    `Review action '${row.name}' deleted`,
                  ),
              });
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
          <div className="max-h-80 overflow-auto">
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
          className="[&_table.ivy-data-table]:table-fixed"
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
          className="[&_table.ivy-data-table]:table-fixed"
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
              requestRemoval({
                kind: "environment file",
                name: row.path,
                consequence:
                  "Its variables stop being injected into new plan worktrees. Files already materialized in existing worktrees stay as they are.",
                onConfirm: () =>
                  void patch(
                    { envFiles: project.envFiles.filter((_, i) => i !== index).map(envFileToWire) },
                    `Environment file '${row.path}' deleted`,
                  ),
              });
            }
          }}
        />
      </SubSection>

      {/* Section 7: agent behaviour, `isBeta` in V1. */}
      {isBeta && (
        <SubSection title="Agent Behavior" testId="project-agent-behavior">
          <div>
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
          className="space-y-4"
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
            className="[&_table.ivy-data-table]:table-fixed"
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
                requestRemoval({
                  kind: "MCP server",
                  name: row.name,
                  consequence:
                    "Agents working on this project stop being given its tools. This removes the project's reference to it, not the server definition itself.",
                  onConfirm: () =>
                    void patch(
                      {
                        mcpServers: project.mcpServers
                          .filter((_, i) => i !== index)
                          .map(mcpServerToWire),
                      },
                      `MCP server '${row.name}' deleted`,
                    ),
                });
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
            className="[&_table.ivy-data-table]:table-fixed"
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
                requestRemoval({
                  kind: "custom skill",
                  name: row.name,
                  consequence:
                    "Agents working on this project stop being given it. This removes the project's reference to it, not the skill's own files.",
                  onConfirm: () =>
                    void patch(
                      { skills: project.skills.filter((_, i) => i !== index).map(skillToWire) },
                      `Skill '${row.name}' deleted`,
                    ),
                });
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

      {/* Section 10: danger zone — two actions, because "delete" used to mean neither.
          V1 offers one button, labelled "Delete Project", which calls `SettingsApp.onDeleteProject`
          and only drops the `config.yaml` entry; V2 inherited both the label and the mismatch, and
          patched it with the paragraph of copy that used to sit here. Copy is the wrong instrument:
          it corrects the reader who reads it and nobody else. So the two things that were being
          conflated are now two buttons with the verbs that happen, each saying its own consequence.
          Remove is listed first and is the outline button: it is the one that is almost always
          meant, and the destructive fill is reserved for the one that is not. */}
      <SubSection title="Danger Zone" testId="project-danger-zone">
        <div className="space-y-4">
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRemoving(true)}
              data-testid="remove-project"
            >
              Remove Project
            </Button>
            <p className="text-xs text-muted-foreground">
              Removes the project from config.yaml. Cloned repositories, plan folders and history
              are left on disk, so adding the project back by name restores it.
            </p>
          </div>
          <div className="space-y-2">
            <Button
              type="button"
              variant="destructive"
              onClick={() => setIsDeleting(true)}
              data-testid="delete-project"
            >
              Delete Project
            </Button>
            <p className="text-xs text-muted-foreground">
              Permanently deletes the project&apos;s plans, its cloned repositories under
              {" <TENDRIL_HOME>/Projects/"}, its database rows and its config entry. This cannot be
              undone, and asks you to type the project name first.
            </p>
          </div>
        </div>
      </SubSection>

      <RemoveProjectDialog
        isOpen={isRemoving}
        onClose={() => setIsRemoving(false)}
        projectName={project.name}
        onRemoved={onRemoved}
      />

      <DeleteProjectDialog
        isOpen={isDeleting}
        onClose={() => setIsDeleting(false)}
        projectName={project.name}
        onDeleted={onDeleted}
      />

      {removalDialog}
    </div>
  );
};
