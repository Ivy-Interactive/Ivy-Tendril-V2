import * as React from "react";
import { Callout } from "../ui/callout";
import { NativeSelect } from "../ui/native-select";
import { ContentInput } from "../ContentInput";
import { useTranslation } from "@/i18n/uiDialogs";
import { DialogShell } from "./DialogShell";

/**
 * `CreatePlanDialog.AddProjectActionValue`. Picking it is a navigation, not a project.
 */
export const ADD_PROJECT_VALUE = "__tendril_add_project__";

/**
 * The project value that asks CreatePlan to pick the project itself. It is what the job is sent and
 * what {@link defaultProject} compares, so only its label is translated.
 */
export const AUTO_PROJECT = "Auto";

/**
 * `CreatePlanDialog.MaxProjectsForToggleVariant`: up to this many projects the picker is a
 * segmented toggle, above it a plain select.
 */
export const MAX_PROJECTS_FOR_TOGGLE = 6;

export interface ProjectOption {
  value: string;
  label: string;
}

/**
 * `CreatePlanDialog.BuildProjectSelectOptions`: "Auto" leads whenever there is more than one
 * project to choose between (or none configured yet), then the projects, then the escape hatch to
 * settings. With exactly one project there is nothing to decide, so no "Auto".
 */
export function buildProjectOptions(
  projectNames: string[],
  includeAddProject: boolean,
  labels: { auto: string; addProject: string },
): ProjectOption[] {
  const options: ProjectOption[] = [];
  if (projectNames.length > 1 || projectNames.length === 0) {
    options.push({ value: AUTO_PROJECT, label: labels.auto });
  }
  options.push(...projectNames.map((p) => ({ value: p, label: p })));
  if (includeAddProject) {
    options.push({ value: ADD_PROJECT_VALUE, label: labels.addProject });
  }
  return options;
}

/**
 * `CreatePlanDialog._defaultProject`: one project means that project; otherwise the remembered
 * or caller-supplied one if it is still real, and "Auto" when it is not.
 */
export function defaultProject(projectNames: string[], preferred?: string): string {
  if (projectNames.length === 1) return projectNames[0];
  if (preferred === AUTO_PROJECT || (preferred && projectNames.includes(preferred))) {
    return preferred;
  }
  return AUTO_PROJECT;
}

/** A file `ContentInput` read into memory, as its `OnUploadFile` event hands it over. */
export interface CreatePlanUpload {
  name: string;
  base64Data: string;
}

export interface CreatePlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The configured projects' names, in configured order. */
  projects: string[];
  /** Pre-selected project: the remembered one, or the one a caller (an inbox issue) names. */
  initialProject?: string;
  /** Pre-filled task description. */
  initialDescription?: string;
  /**
   * Dispatches CreatePlan with the trimmed description and the picked project. The app owns the
   * request, the dirty-repo preflight in front of it, and the outcome.
   */
  onSubmit: (description: string, project: string) => void | Promise<void>;
  /** Opens project settings, for the picker's "+ Add New Project" entry. Omitted, it is not offered. */
  onAddProject?: () => void;
  /**
   * The configured coding agent's name, for V1's split-button entry "Chat with <agent>". Offered only
   * together with {@link onContinueInChat}.
   */
  agentLabel?: string;
  /** V1's `OnMenuAction`: discuss the plan with the agent instead of creating it. */
  onContinueInChat?: (description: string, project: string) => void;
  /**
   * Stages a file the operator attached and answers with the path it now lives at, which replaces the
   * bare file name in the description's `[file: …]` reference - V1's `UseUpload` handler, which writes
   * into `Attachments/<uploadSessionId>/` and appends ` [file: <path>]`. Omitted, attachments keep the
   * name `ContentInput` gave them.
   */
  onUploadFile?: (file: CreatePlanUpload) => Promise<string>;
  isBusy?: boolean;
  error?: string | null;
}

/** The first argument of a `ContentInput` event when it is a string (`OnChange`, `OnMenuAction`, …). */
function firstString(args: unknown[] | undefined): string | undefined {
  const first = args?.[0];
  return typeof first === "string" ? first : undefined;
}

/** `OnSubmit`'s `{ value, Value }` payload, or `undefined` when it carries no string. */
function submittedValue(args: unknown[] | undefined): string | undefined {
  const first = args?.[0] as { value?: unknown; Value?: unknown } | undefined;
  const value = first?.value ?? first?.Value;
  return typeof value === "string" ? value : undefined;
}

/** `OnUploadFile`'s `{ name, base64Data }` payload, or `undefined` when it is malformed. */
function uploadArg(args: unknown[] | undefined): CreatePlanUpload | undefined {
  const first = args?.[0] as
    | { name?: unknown; Name?: unknown; base64Data?: unknown; Base64Data?: unknown }
    | undefined;
  const name = first?.name ?? first?.Name;
  const base64Data = first?.base64Data ?? first?.Base64Data;
  return typeof name === "string" && typeof base64Data === "string"
    ? { name, base64Data }
    : undefined;
}

/** Removes one ` [file: …]` reference, spaced or not, as V1's `OnRemoveAttachment` does. */
function withoutFileRef(text: string, path: string): string {
  const ref = ` [file: ${path}]`;
  if (text.includes(ref)) return text.replace(ref, "");
  return text.replace(ref.trim(), "");
}

/**
 * Create New Plan, as V1's `CreatePlanDialog` composes it: a project picker over a single content
 * input that owns its own Create button. There is no priority field - V1 passes `priority: 0` for
 * every plan created here (`onCreatePlan(text, project, 0, uploadSessionId)`), and its
 * `PriorityOptions` never reach the dialog body.
 *
 * `.Width(Size.Rem(30))` on the dialog, and `mobileSheet` for V1's bottom `Sheet` below the mobile
 * breakpoint. No footer: `ContentInput` carries Create, the "Chat with <agent>" split entry and the
 * attachment affordances, as V1's `ContentInput` widget does.
 *
 * Presentational. The dispatch, the dirty-repo preflight and the staging of attachments are the
 * app's; this owns the text, the picker and the parsing of `ContentInput`'s events.
 */
export function CreatePlanDialog({
  isOpen,
  onClose,
  projects,
  initialProject,
  initialDescription = "",
  onSubmit,
  onAddProject,
  agentLabel,
  onContinueInChat,
  onUploadFile,
  isBusy = false,
  error,
}: CreatePlanDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const [description, setDescription] = React.useState(initialDescription);
  const [selectedProject, setSelectedProject] = React.useState(() =>
    defaultProject(projects, initialProject),
  );
  const [localError, setLocalError] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // V1's `.AutoFocus()` on the ContentInput. `ContentInput` exposes no ref, so the shell is pointed at
  // its textarea through a ref that looks it up when the shell asks.
  const textareaRef = React.useMemo<React.RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return containerRef.current?.querySelector("textarea") ?? null;
      },
    }),
    [],
  );

  // Seeded on every open, not on prop identity: the caller builds `projects` from its own render
  // state, and re-seeding on it would discard what the operator had typed.
  const projectsRef = React.useRef(projects);
  projectsRef.current = projects;
  React.useEffect(() => {
    if (!isOpen) return;
    setDescription(initialDescription);
    setSelectedProject(defaultProject(projectsRef.current, initialProject));
    setLocalError(null);
  }, [isOpen, initialDescription, initialProject]);

  // The projects can arrive after the dialog opens; a selection that is no longer offered falls back
  // to the default rather than being sent.
  React.useEffect(() => {
    setSelectedProject((current) =>
      current === AUTO_PROJECT || projects.includes(current)
        ? current
        : defaultProject(projects, initialProject),
    );
  }, [projects, initialProject]);

  const options = buildProjectOptions(projects, onAddProject !== undefined, {
    auto: t("createPlan.autoProject"),
    addProject: t("createPlan.addProject"),
  });
  const useToggleVariant = projects.length <= MAX_PROJECTS_FOR_TOGGLE;
  const continueLabel =
    agentLabel && onContinueInChat
      ? t("createPlan.continueInChat", { agent: agentLabel })
      : undefined;

  const handleProjectChange = (value: string) => {
    // `UseEffect` on `selectedProject` in V1: the action value is never a selection, it closes the
    // dialog and takes you to Settings → Projects.
    if (value === ADD_PROJECT_VALUE) {
      onClose();
      onAddProject?.();
      return;
    }
    setSelectedProject(value);
  };

  const handleSubmit = (submitted: string) => {
    if (isBusy) return;
    const text = submitted.trim();
    if (!text) {
      setLocalError(t("createPlan.emptyDescription"));
      return;
    }
    setLocalError(null);
    void onSubmit(text, selectedProject);
  };

  const handleUpload = async (file: CreatePlanUpload) => {
    if (!onUploadFile) return;
    try {
      const staged = await onUploadFile(file);
      // `ContentInput` has already put ` [file: <name>]` in the text (its `OnChange` runs before the
      // upload); the staged path is what the plan and the agent can actually open.
      setDescription((current) => current.replace(`[file: ${file.name}]`, `[file: ${staged}]`));
    } catch (err) {
      setDescription((current) => withoutFileRef(current, file.name));
      setLocalError(
        t("attachments.failed", {
          name: file.name,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  };

  const shownError = error ?? localError;

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("createPlan.title")}
      testId="new-plan-modal"
      width="rem30"
      mobileSheet
      initialFocusRef={textareaRef}
    >
      <div ref={containerRef} className="space-y-2" data-testid="new-plan-surface">
        {shownError && (
          <Callout.Error className="mb-2" data-testid="create-plan-error">
            {shownError}
          </Callout.Error>
        )}

        {/* `Layout.Vertical().Gap(2) | projectPickerWidget | contentInputWidget` */}
        {useToggleVariant ? (
          <div
            role="radiogroup"
            aria-label={t("createPlan.projectPickerLabel")}
            className="flex flex-wrap gap-1 rounded-field border border-border p-1"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selectedProject === o.value}
                onClick={() => handleProjectChange(o.value)}
                className={`rounded-selector px-3 py-1.5 text-sm font-medium transition ${
                  selectedProject === o.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : (
          <NativeSelect
            id="project-select"
            aria-label={t("createPlan.projectPickerLabel")}
            value={selectedProject}
            onChange={(e) => handleProjectChange(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        )}

        <ContentInput
          id="content-input"
          value={description}
          autoFocus
          submitLabel={t("createPlan.submit")}
          placeholder={t("createPlan.placeholder")}
          menuOptions={continueLabel ? [continueLabel] : []}
          eventHandler={(evt: string, _id: string, args?: unknown[]) => {
            switch (evt) {
              case "OnChange": {
                const text = firstString(args);
                if (text !== undefined) setDescription(text);
                return;
              }
              case "OnSubmit": {
                const text = submittedValue(args);
                if (text === undefined) return;
                setDescription(text);
                handleSubmit(text);
                return;
              }
              case "OnMenuAction": {
                // V1 ignores the entry while the description is blank: there is nothing to discuss.
                if (firstString(args) !== continueLabel || !description.trim()) return;
                onContinueInChat?.(description.trim(), selectedProject);
                return;
              }
              case "OnUploadFile": {
                const file = uploadArg(args);
                if (file) void handleUpload(file);
                return;
              }
              case "OnRemoveAttachment": {
                const path = firstString(args);
                if (path !== undefined) setDescription((current) => withoutFileRef(current, path));
                return;
              }
            }
          }}
        />
      </div>
    </DialogShell>
  );
}
