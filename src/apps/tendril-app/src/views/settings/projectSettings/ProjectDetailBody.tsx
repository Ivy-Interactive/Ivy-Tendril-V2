import React from "react";
import { FolderSearch, Plus, X } from "lucide-react";
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
import { useTranslation, type TFunction } from "../../../i18n";
import { notificationsStore } from "../../../state/notificationsStore";
import { describeBridgeError } from "../../../types/api";
import {
  ColorSwatchField,
  LinesField,
  SETTINGS_CONTAINER,
  SaveError,
  SelectField,
  SubSection,
} from "../fields";
import { type RemovalRequest, useRemovalConfirm } from "../useRemovalConfirm";
import { parseLines } from "../configValues";
import {
  AUTO_IMPLEMENT_VALUES,
  OUTSIDE_FILE_POLICIES,
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
  projectOptionLabel,
  projectOptions,
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
import { ImportRepoAssetsDialog } from "../../dialogs/ImportRepoAssetsDialog";
import { ProjectMemorySection } from "./ProjectMemorySection";
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
const editDeleteActions = <TRow,>(t: TFunction<"settingsProjects">): DataTableRowAction<TRow>[] => [
  { tag: "edit", label: t("rowActions.edit") },
  { tag: "delete", label: t("common:actions.delete"), variant: "destructive" },
];

/**
 * The room {@link editDeleteActions} needs, set through `DataTable`'s own
 * `--ivy-data-table-actions-width` override. Goes on every table that uses those actions.
 *
 * Under `table-fixed` the actions column is exactly that width, whatever it holds, and the 5rem
 * default fits one button. `Edit` and `Delete` are two text buttons, 116px together plus the cell's
 * 26px of padding, so they overflowed leftwards and `Edit` always sat over the last 49px of the
 * column before it. That went unnoticed while the root blade was laid out as wide as its content,
 * because the Condition column was wide and a short value ended well clear of the button. Once a
 * flex blade stopped being sized by its content (`bladeWidthVariant`'s `flex`), opening an editor
 * beside this blade at a 1280px window left the root about 350px wide, and a review action's
 * "always" was printed over its `Edit`.
 *
 * The width is in `--spacing` units, like the calendar's `--cell-size`, because most of those 142px
 * are the buttons' `px-3` and the cell's padding, which are counted in the same unit. 36 of them is
 * 155px at the default 0.27rem, and that leaves margin for a wider fallback font.
 */
const EDIT_DELETE_ACTIONS_WIDTH = "[--ivy-data-table-actions-width:--spacing(36)]";

/**
 * Which kind of entry a removal on this screen is. These are ids, never shown, and they are spelled
 * like the settings namespace's `RemovalKind` (`settings:removal.title_<kind>`), which words a whole
 * title and question per kind. Until `useRemovalConfirm` takes such an id, `requestRemoval` below
 * turns it into this namespace's translated lower-case noun (`removalKinds.<id>`) for the hook's
 * `kind`; once it does, the wrapper should pass the id through as `kindId` instead.
 */
type ProjectRemovalKind =
  | "repository"
  | "reviewAction"
  | "environmentFile"
  | "mcpServer"
  | "customSkill";

/**
 * The words `parseModeLines` accepts at the start of a rule line (`OUTSIDE_FILE_POLICIES`), and the
 * two Claude tools a file Deny rule covers. The hints name them, so they are passed in as variables:
 * translating one would teach a keyword the parser reads as part of an Allow rule's path.
 */
const RULE_KEYWORDS = { allow: "Allow", deny: "Deny", write: "Write", edit: "Edit" } as const;

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
  const { t } = useTranslation("settingsProjects");
  const { push, pop } = useBlades();
  const [error, setError] = React.useState<string | null>(null);
  const [repoDraft, setRepoDraft] = React.useState("");
  const [repoError, setRepoError] = React.useState<string | null>(null);
  const [isAddingRepo, setIsAddingRepo] = React.useState(false);
  const [isRemoving, setIsRemoving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  /** Which `ImportRepoAssetsDialog` is open — V1 opens one per table, for skills or MCP servers. */
  const [importing, setImporting] = React.useState<"skills" | "mcpServers" | null>(null);
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
      notificationsStore.notifySuccess(t("notifications.saved"), message);
    } catch (err) {
      setError(t("saveError", { error: describeBridgeError(err) }));
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
  const { requestRemoval: requestAnyRemoval, removalDialog } = useRemovalConfirm();
  const requestRemoval = ({
    kindId,
    ...request
  }: Omit<RemovalRequest, "kind"> & { kindId: ProjectRemovalKind }) =>
    requestAnyRemoval({ ...request, kind: t(`removalKinds.${kindId}`) });

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
      setRepoError(t("repositories.add.invalidPath"));
      return;
    }

    if (project.repos.some((repo) => repo.path.toLowerCase() === path.toLowerCase())) {
      setRepoDraft("");
      return;
    }

    if (classifyRepoPath(path) === "local") {
      saveRepos([...project.repos, { path, rest: {} }], t("repositories.add.added", { path }));
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
      notificationsStore.notifySuccess(
        t("notifications.cloned"),
        t("repositories.add.cloned", { path: added.path }),
      );
    } catch (err) {
      // The daemon has already put every URL its clone errors mention through `redact_credentials`,
      // so relaying its message is safe and re-stating the typed URL here would undo that.
      setRepoError(t("repositories.add.failed", { error: describeBridgeError(err) }));
    } finally {
      setIsAddingRepo(false);
    }
  };

  /* ----------------------------------------------------------- review actions */

  const reviewActionColumns: DataTableColumn<ReviewActionConfigEntry>[] = [
    { name: "name", header: t("reviewActions.columns.name"), accessor: (row) => row.name },
    {
      name: "command",
      header: t("reviewActions.columns.command"),
      accessor: (row) => row.command,
      cell: cappedCell<ReviewActionConfigEntry>((row) => row.command),
    },
    {
      name: "condition",
      header: t("reviewActions.columns.condition"),
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
      t("reviewActions.saved", { name: action.name }),
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
        t("verifications.updated", { project: project.name }),
      );
      return;
    }
    if (eventName === "OnReorder") {
      const indices = JSON.parse(payload) as number[];
      saveVerifications(
        reorderProjectVerifications(indices, displayed, project.verifications),
        t("verifications.orderSaved"),
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
        notificationsStore.notifySuccess(t("notifications.saved"), t("verifications.added"));
      } catch (err) {
        setError(t("verifications.addFailed", { error: describeBridgeError(err) }));
      }
    })();
  };

  /* -------------------------------------------------------------------- ports */

  const portColumns: DataTableColumn<ProjectPortConfigEntry>[] = [
    { name: "name", header: t("ports.columns.name"), accessor: (row) => row.name },
    {
      name: "defaultPort",
      header: t("ports.columns.defaultPort"),
      accessor: (row) => row.defaultPort,
    },
    {
      name: "description",
      header: t("ports.columns.description"),
      accessor: (row) => row.description,
    },
  ];

  const submitPort = (port: ProjectPortConfigEntry, existing: ProjectPortConfigEntry | null) => {
    const others = project.ports.filter((p) => p.name !== existing?.name);
    pop(1);
    void patch({ ports: portsToWire([...others, port]) }, t("ports.saved", { name: port.name }));
  };

  /* --------------------------------------------------------- environment files */

  const envFileColumns: DataTableColumn<ProjectEnvFileConfigEntry>[] = [
    {
      name: "path",
      header: t("envFiles.columns.path"),
      accessor: (row) => row.path,
      cell: cappedCell<ProjectEnvFileConfigEntry>((row) => row.path),
    },
    {
      name: "template",
      header: t("envFiles.columns.template"),
      accessor: (row) => row.template,
      cell: cappedCell<ProjectEnvFileConfigEntry>((row) => row.template),
    },
    {
      name: "overrides",
      header: t("envFiles.columns.overrides"),
      accessor: (row) => Object.keys(row.overrides).join(", "),
      cell: cappedCell<ProjectEnvFileConfigEntry>((row) => Object.keys(row.overrides).join(", ")),
    },
  ];

  const submitEnvFile = (file: ProjectEnvFileConfigEntry, index: number | null) => {
    const next = [...project.envFiles];
    if (index === null) next.push(file);
    else next[index] = file;
    pop(1);
    void patch({ envFiles: next.map(envFileToWire) }, t("envFiles.saved", { path: file.path }));
  };

  /* ------------------------------------------------------------- mcp / skills */

  const mcpColumns: DataTableColumn<ProjectMcpServerRefEntry>[] = [
    { name: "name", header: t("mcpServers.columns.name"), accessor: (row) => row.name },
    {
      name: "command",
      header: t("mcpServers.columns.command"),
      accessor: (row) => [row.command, ...row.arguments].join(" "),
      cell: cappedCell<ProjectMcpServerRefEntry>((row) =>
        [row.command, ...row.arguments].join(" "),
      ),
    },
    {
      name: "disabled",
      header: t("mcpServers.columns.disabled"),
      accessor: (row) =>
        row.disabled ? t("mcpServers.disabledValue.yes") : t("mcpServers.disabledValue.no"),
    },
  ];

  const submitMcpServer = (server: ProjectMcpServerRefEntry, index: number | null) => {
    const next = [...project.mcpServers];
    if (index === null) next.push(server);
    else next[index] = server;
    pop(1);
    void patch(
      { mcpServers: next.map(mcpServerToWire) },
      t("mcpServers.saved", { name: server.name }),
    );
  };

  const skillColumns: DataTableColumn<ProjectSkillRefEntry>[] = [
    { name: "name", header: t("skills.columns.name"), accessor: (row) => row.name },
    {
      name: "description",
      header: t("skills.columns.description"),
      accessor: (row) => row.description,
      cell: cappedCell<ProjectSkillRefEntry>((row) => row.description),
    },
    {
      name: "path",
      header: t("skills.columns.path"),
      accessor: (row) => row.path,
      cell: cappedCell<ProjectSkillRefEntry>((row) => row.path),
    },
  ];

  const submitSkill = (skill: ProjectSkillRefEntry, index: number | null) => {
    const next = [...project.skills];
    if (index === null) next.push(skill);
    else next[index] = skill;
    pop(1);
    void patch({ skills: next.map(skillToWire) }, t("skills.saved", { name: skill.name }));
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
    [t("security.enforcement.controls.sandbox"), enforcement.sandbox],
    [t("security.enforcement.controls.network"), enforcement.network],
    [t("security.enforcement.controls.terminalPrompt"), enforcement.terminalPrompt],
    [t("security.enforcement.controls.fileRules"), enforcement.fileRules],
  ];
  const enforcedControls = enforcementPairs.filter(([, on]) => on).map(([name]) => name);
  const ignoredControls = enforcementPairs.filter(([, on]) => !on).map(([name]) => name);

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

      <SubSection title={t("basic.title")} hint={t("basic.hint")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ color: basic.color, context: basic.context }, t("basic.saved"));
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
            label={t("basic.color.label")}
            value={basic.color}
            hint={t("basic.color.hint")}
            onChange={(value) => setBasic((prev) => ({ ...prev, color: value }))}
          />
          <LinesField
            id="project-context"
            label={t("basic.context.label")}
            value={basic.context}
            rows="tall"
            placeholder={t("basic.context.placeholder")}
            onChange={(value) => setBasic((prev) => ({ ...prev, context: value }))}
          />
          <Button type="submit" disabled={!basicChanged}>
            {t("common:actions.save")}
          </Button>
        </form>
      </SubSection>

      {/* Section 2: repositories. V1's `ProjectRepoPickerView` is a list, not a table, with the
          base branch editable per row. Its Sync button is omitted: no bridge method syncs a repo. */}
      <SubSection
        title={t("repositories.title")}
        hint={t("repositories.hint")}
        count={project.repos.length}
        testId="project-repos"
      >
        <div className="space-y-2">
          {project.repos.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("repositories.empty")}</p>
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
                aria-label={t("repositories.baseBranch.ariaLabel", { path: repo.path })}
                value={repo.baseBranch ?? ""}
                placeholder={t("repositories.baseBranch.placeholder")}
                className="w-40"
                onChange={(e) => {
                  const next = [...project.repos];
                  const value = e.target.value.trim();
                  next[index] = { ...repo, baseBranch: value === "" ? undefined : value };
                  saveRepos(next, t("repositories.baseBranch.saved", { path: repo.path }));
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("repositories.remove.ariaLabel", { path: repo.path })}
                onClick={() =>
                  requestRemoval({
                    kindId: "repository",
                    name: repo.path,
                    consequence: t("repositories.remove.consequence"),
                    onConfirm: () =>
                      saveRepos(
                        project.repos.filter((_, i) => i !== index),
                        t("repositories.remove.removed", { path: repo.path }),
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
              aria-label={t("repositories.add.ariaLabel")}
              value={repoDraft}
              placeholder={t("repositories.add.placeholder")}
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
              {isAddingRepo ? t("repositories.add.cloning") : t("repositories.add.button")}
            </Button>
          </div>
          {repoError && (
            <p className="text-xs text-destructive" data-testid="project-repo-error">
              {repoError}
            </p>
          )}
          {/* The clone is the daemon's, and it can take minutes on a large repository - worth
              saying, because the row only appears once it has finished. */}
          <p className="text-xs text-muted-foreground">{t("repositories.note")}</p>
        </div>
      </SubSection>

      {/* Section 3: review actions. */}
      <SubSection
        title={t("reviewActions.title")}
        hint={t("reviewActions.hint")}
        count={project.reviewActions.length}
        testId="project-review-actions"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openBlade(
                t("reviewActions.addTitle"),
                <ReviewActionBlade
                  existing={null}
                  onSubmit={(action) => submitReviewAction(action, null)}
                />,
              )
            }
          >
            <Plus className="size-4" aria-hidden />
            {t("reviewActions.addButton")}
          </Button>
        }
      >
        <DataTable<ReviewActionConfigEntry>
          /* Without a fixed layout a `<table>` sizes to its content, so several columns each holding
             a path or a URL made the table far wider than the settings pane and handed the whole
             view a horizontal scrollbar. `table-fixed` makes the columns divide the available width
             instead, which is also what lets the per-cell `truncate` bind. `JobsView` forces the
             same thing for the same reason. */
          className={`[&_table.ivy-data-table]:table-fixed ${EDIT_DELETE_ACTIONS_WIDTH}`}
          data-testid="project-review-actions-table"
          paginated={false}
          columns={reviewActionColumns}
          rows={project.reviewActions}
          getRowId={(row) => row.name}
          rowActions={editDeleteActions<ReviewActionConfigEntry>(t)}
          emptyState={<span className="text-muted-foreground">{t("reviewActions.empty")}</span>}
          onRowAction={({ tag, row }) => {
            const index = project.reviewActions.findIndex((a) => a.name === row.name);
            if (tag === "edit") {
              openBlade(
                t("reviewActions.editTitle"),
                <ReviewActionBlade
                  existing={row}
                  onSubmit={(action) => submitReviewAction(action, index)}
                />,
              );
            } else if (tag === "delete") {
              requestRemoval({
                kindId: "reviewAction",
                name: row.name,
                consequence: t("reviewActions.removal.consequence"),
                onConfirm: () =>
                  void patch(
                    {
                      reviewActions: project.reviewActions
                        .filter((_, i) => i !== index)
                        .map(reviewActionToWire),
                    },
                    t("reviewActions.deleted", { name: row.name }),
                  ),
              });
            }
          }}
        />
      </SubSection>

      {/* Section 4: verifications, with the run order the project's own array encodes. */}
      <SubSection
        title={t("verifications.title")}
        hint={t("verifications.hint")}
        count={project.verifications.length}
        testId="project-verifications"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openBlade(
                t("verifications.addTitle"),
                <VerificationBlade
                  existingNames={verificationDefs.map((def) => def.name)}
                  onSubmit={addVerification}
                />,
              )
            }
          >
            <Plus className="size-4" aria-hidden />
            {t("verifications.addButton")}
          </Button>
        }
      >
        {displayed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("verifications.empty")}</p>
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
        title={t("ports.title")}
        hint={t("ports.hint")}
        count={project.ports.length}
        testId="project-ports"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openBlade(
                t("ports.addTitle"),
                <PortBlade existing={null} onSubmit={(p) => submitPort(p, null)} />,
              )
            }
          >
            <Plus className="size-4" aria-hidden />
            {t("ports.addButton")}
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
          rowActions={[{ tag: "edit", label: t("rowActions.edit") }]}
          emptyState={<span className="text-muted-foreground">{t("ports.empty")}</span>}
          onRowAction={({ tag, row }) => {
            if (tag === "edit") {
              openBlade(
                t("ports.editTitle"),
                <PortBlade existing={row} onSubmit={(p) => submitPort(p, row)} />,
              );
            }
          }}
        />
        {/* V1 can delete and rename a port because it rewrites the whole file. This app cannot. */}
        <Callout.Warning data-testid="project-ports-merge-note">
          {t("ports.mergeLimitation")}
        </Callout.Warning>
      </SubSection>

      {/* Section 6: environment files. */}
      <SubSection
        title={t("envFiles.title")}
        hint={t("envFiles.hint")}
        count={project.envFiles.length}
        testId="project-env-files"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openBlade(
                t("envFiles.addTitle"),
                <EnvFileBlade existing={null} onSubmit={(f) => submitEnvFile(f, null)} />,
              )
            }
          >
            <Plus className="size-4" aria-hidden />
            {t("envFiles.addButton")}
          </Button>
        }
      >
        <DataTable<ProjectEnvFileConfigEntry>
          className={`[&_table.ivy-data-table]:table-fixed ${EDIT_DELETE_ACTIONS_WIDTH}`}
          data-testid="project-env-files-table"
          paginated={false}
          columns={envFileColumns}
          rows={project.envFiles}
          getRowId={(row) => row.path}
          rowActions={editDeleteActions<ProjectEnvFileConfigEntry>(t)}
          emptyState={<span className="text-muted-foreground">{t("envFiles.empty")}</span>}
          onRowAction={({ tag, row }) => {
            const index = project.envFiles.findIndex((f) => f.path === row.path);
            if (tag === "edit") {
              openBlade(
                t("envFiles.editTitle"),
                <EnvFileBlade existing={row} onSubmit={(f) => submitEnvFile(f, index)} />,
              );
            } else if (tag === "delete") {
              requestRemoval({
                kindId: "environmentFile",
                name: row.path,
                consequence: t("envFiles.removal.consequence"),
                onConfirm: () =>
                  void patch(
                    { envFiles: project.envFiles.filter((_, i) => i !== index).map(envFileToWire) },
                    t("envFiles.deleted", { path: row.path }),
                  ),
              });
            }
          }}
        />
      </SubSection>

      {/* Section 7: agent behaviour, `isBeta` in V1. */}
      {isBeta && (
        <SubSection title={t("agentBehavior.title")} testId="project-agent-behavior">
          <div>
            <SelectField
              id="project-auto-implement"
              label={t("agentBehavior.autoImplement.label")}
              value={security.autoImplementPlans}
              options={projectOptions(t, "autoImplement", AUTO_IMPLEMENT_VALUES)}
              onChange={(value) => {
                setSecurityField("autoImplementPlans", value);
                void patch({ autoImplementPlans: value }, t("agentBehavior.saved"));
              }}
            />
          </div>
        </SubSection>
      )}

      {/* Security. No V1 counterpart at all: `ProjectDetailView` never exposed the seven flattened
          `AgentSecurityConfig` keys that `apply_security_settings` reads on every job launch. They
          belong to one project, so they live here rather than as a top-level settings section. */}
      <SubSection title={t("security.title")} hint={t("security.hint")} testId="project-security">
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
              t("security.saved", { project: project.name }),
            );
          }}
        >
          <SelectField
            id="project-security-preset"
            label={t("security.preset.label")}
            value={security.securityPreset}
            options={projectOptions(t, "securityPreset", SECURITY_PRESETS)}
            hint={t("security.preset.hint")}
            onChange={(value) => setSecurityField("securityPreset", value)}
          />
          <SelectField
            id="project-sandbox-mode"
            label={t("security.sandboxMode.label")}
            value={security.sandboxMode}
            options={projectOptions(t, "sandboxMode", SANDBOX_MODES)}
            disabled={presetOverrides}
            hint={t("security.sandboxMode.hint", {
              effective: projectOptionLabel(t, "sandboxMode", effectiveSandboxMode(security)),
            })}
            onChange={(value) => setSecurityField("sandboxMode", value)}
          />
          <SelectField
            id="project-outside-file-access"
            label={t("security.outsideFileAccess.label")}
            value={security.outsideFileAccessPolicy}
            options={projectOptions(t, "outsideFileAccess", OUTSIDE_FILE_POLICIES)}
            disabled={presetOverrides}
            hint={t("security.outsideFileAccess.hint", {
              effective: projectOptionLabel(
                t,
                "outsideFileAccess",
                effectiveOutsideFileAccess(security),
              ),
            })}
            onChange={(value) => setSecurityField("outsideFileAccessPolicy", value)}
          />
          <SelectField
            id="project-terminal-auto-execution"
            label={t("security.terminalAutoExecution.label")}
            value={security.terminalAutoExecution}
            options={projectOptions(t, "terminalAutoExecution", TERMINAL_AUTO_EXECUTIONS)}
            hint={t("security.terminalAutoExecution.hint", {
              effective: projectOptionLabel(
                t,
                "terminalAutoExecution",
                effectiveTerminalAutoExecution(security),
              ),
            })}
            onChange={(value) => setSecurityField("terminalAutoExecution", value)}
          />
          <LinesField
            id="project-file-permissions"
            label={t("security.filePermissions.label")}
            value={security.filePermissions.map((rule) => `${rule.mode} ${rule.path}`).join("\n")}
            placeholder={"Allow src/**\nDeny .env"}
            hint={t("security.filePermissions.hint", {
              syntax: "Allow|Ask|Deny <path>",
              ...RULE_KEYWORDS,
            })}
            onChange={(value) =>
              setSecurityField(
                "filePermissions",
                parseModeLines(value).map((rule) => ({ path: rule.value, mode: rule.mode })),
              )
            }
          />
          <LinesField
            id="project-network-rules"
            label={t("security.networkRules.label")}
            value={security.networkAccessRules
              .map((rule) => `${rule.mode} ${rule.urlPattern}`)
              .join("\n")}
            placeholder={"Deny https://example.com/*"}
            hint={
              effectiveNetworkAllowed(security)
                ? t("security.networkRules.hintAllowed", {
                    syntax: "Allow|Deny <url pattern>",
                    deny: RULE_KEYWORDS.deny,
                  })
                : t("security.networkRules.hintDenied", {
                    syntax: "Allow|Deny <url pattern>",
                    deny: RULE_KEYWORDS.deny,
                  })
            }
            onChange={(value) =>
              setSecurityField(
                "networkAccessRules",
                parseModeLines(value).map((rule) => ({ urlPattern: rule.value, mode: rule.mode })),
              )
            }
          />
          <LinesField
            id="project-allowed-terminal-commands"
            label={t("security.allowedCommands.label")}
            value={security.allowedTerminalCommands.join("\n")}
            placeholder={"pnpm\ncargo"}
            hint={t("security.allowedCommands.hint", { syntax: "Bash(<command> *)" })}
            onChange={(value) => setSecurityField("allowedTerminalCommands", parseLines(value))}
          />

          {/* A control the configured agent's CLI has no argument for is inert, so say which. */}
          <Callout.Info data-testid="project-security-enforcement">
            <div className="space-y-1">
              <p>
                {enforcedControls.length > 0
                  ? t("security.enforcement.enforces", {
                      agent: agentLabel,
                      controls: enforcedControls,
                    })
                  : t("security.enforcement.enforcesNone", { agent: agentLabel })}
              </p>
              {ignoredControls.length > 0 && (
                <p className="text-xs">
                  {t("security.enforcement.ignored", {
                    agent: agentLabel,
                    controls: ignoredControls,
                  })}
                </p>
              )}
            </div>
          </Callout.Info>

          <Button type="submit" disabled={!securityChanged}>
            {t("common:actions.save")}
          </Button>
        </form>
      </SubSection>

      {/* Section 8: local permissions (MCP), `isBeta` in V1. */}
      {isBeta && (
        <SubSection
          title={t("mcpServers.title")}
          hint={t("mcpServers.hint")}
          count={project.mcpServers.length}
          testId="project-mcp-servers"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setImporting("mcpServers")}
                data-testid="project-mcp-import"
              >
                <FolderSearch className="size-4" aria-hidden />
                {t("importFromRepo")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  openBlade(
                    t("mcpServers.addTitle"),
                    <McpServerBlade existing={null} onSubmit={(s) => submitMcpServer(s, null)} />,
                  )
                }
              >
                <Plus className="size-4" aria-hidden />
                {t("mcpServers.addButton")}
              </Button>
            </div>
          }
        >
          <DataTable<ProjectMcpServerRefEntry>
            className={`[&_table.ivy-data-table]:table-fixed ${EDIT_DELETE_ACTIONS_WIDTH}`}
            data-testid="project-mcp-servers-table"
            paginated={false}
            columns={mcpColumns}
            rows={project.mcpServers}
            getRowId={(row) => row.name}
            rowActions={editDeleteActions<ProjectMcpServerRefEntry>(t)}
            emptyState={<span className="text-muted-foreground">{t("mcpServers.empty")}</span>}
            onRowAction={({ tag, row }) => {
              const index = project.mcpServers.findIndex((s) => s.name === row.name);
              if (tag === "edit") {
                openBlade(
                  t("mcpServers.editTitle"),
                  <McpServerBlade existing={row} onSubmit={(s) => submitMcpServer(s, index)} />,
                );
              } else if (tag === "delete") {
                requestRemoval({
                  kindId: "mcpServer",
                  name: row.name,
                  consequence: t("mcpServers.removal.consequence"),
                  onConfirm: () =>
                    void patch(
                      {
                        mcpServers: project.mcpServers
                          .filter((_, i) => i !== index)
                          .map(mcpServerToWire),
                      },
                      t("mcpServers.deleted", { name: row.name }),
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
          title={t("skills.title")}
          hint={t("skills.hint")}
          count={project.skills.length}
          testId="project-skills"
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setImporting("skills")}
                data-testid="project-skills-import"
              >
                <FolderSearch className="size-4" aria-hidden />
                {t("importFromRepo")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  openBlade(
                    t("skills.addTitle"),
                    <SkillBlade existing={null} onSubmit={(s) => submitSkill(s, null)} />,
                  )
                }
              >
                <Plus className="size-4" aria-hidden />
                {t("skills.addButton")}
              </Button>
            </div>
          }
        >
          <DataTable<ProjectSkillRefEntry>
            className={`[&_table.ivy-data-table]:table-fixed ${EDIT_DELETE_ACTIONS_WIDTH}`}
            data-testid="project-skills-table"
            paginated={false}
            columns={skillColumns}
            rows={project.skills}
            getRowId={(row) => row.name}
            rowActions={editDeleteActions<ProjectSkillRefEntry>(t)}
            emptyState={<span className="text-muted-foreground">{t("skills.empty")}</span>}
            onRowAction={({ tag, row }) => {
              const index = project.skills.findIndex((s) => s.name === row.name);
              if (tag === "edit") {
                openBlade(
                  t("skills.editTitle"),
                  <SkillBlade existing={row} onSubmit={(s) => submitSkill(s, index)} />,
                );
              } else if (tag === "delete") {
                requestRemoval({
                  kindId: "customSkill",
                  name: row.name,
                  consequence: t("skills.removal.consequence"),
                  onConfirm: () =>
                    void patch(
                      { skills: project.skills.filter((_, i) => i !== index).map(skillToWire) },
                      t("skills.deleted", { name: row.name }),
                    ),
                });
              }
            }}
          />
          {/* `ProjectMemoryTableView` + `EditProjectMemorySheet`: the markdown files under
              `<TENDRIL_HOME>/Projects/<Project>/Memory/`, through `/api/projects/:name/memory`. */}
          <ProjectMemorySection projectName={project.name} requestRemoval={requestAnyRemoval} />
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
      <SubSection title={t("dangerZone.title")} testId="project-danger-zone">
        <div className="space-y-4">
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsRemoving(true)}
              data-testid="remove-project"
            >
              {t("dangerZone.remove.button")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("dangerZone.remove.description")}</p>
          </div>
          <div className="space-y-2">
            <Button
              type="button"
              variant="destructive"
              onClick={() => setIsDeleting(true)}
              data-testid="delete-project"
            >
              {t("dangerZone.delete.button")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("dangerZone.delete.description", { path: "<TENDRIL_HOME>/Projects/" })}
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

      <ImportRepoAssetsDialog
        isOpen={importing !== null}
        onClose={() => setImporting(null)}
        projectName={project.name}
        kind={importing ?? "skills"}
        projectRepos={project.repos.map((repo) => repo.path)}
        onImported={(names) => {
          notificationsStore.notifySuccess(
            t("notifications.saved"),
            t("importedFromRepo", { context: importing ?? "skills", count: names.length }),
          );
          void onReloadConfig();
        }}
      />

      {removalDialog}
    </div>
  );
};
