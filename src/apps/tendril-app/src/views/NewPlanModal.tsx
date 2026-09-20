import React, { useState, useEffect } from "react";
import { ContentInput } from "@ivy-interactive/components/tendril";
import { IconButton } from "@ivy-interactive/components/ui";
import { X } from "lucide-react";
import type { ProjectSummary, StartJobResponse } from "../types/api";
import { jobsStore } from "../state/jobsStore";
import { firstStringArg, submitValueArg } from "../utils/eventArgs";
import { ErrorBanner } from "../components/ErrorBanner";

interface NewPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
  onJobStarted?: (res: StartJobResponse) => void;
  /** Opens project settings, for the picker's "+ Add New Project" entry. Omitted, the entry is not offered. */
  onAddProject?: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialProject?: string;
  initialSourceUrl?: string;
}

/**
 * `CreatePlanDialog.AddProjectActionValue`. Picking it is a navigation, not a project.
 */
const ADD_PROJECT_VALUE = "__tendril_add_project__";

/**
 * `CreatePlanDialog.MaxProjectsForToggleVariant`: up to this many projects the picker is a
 * segmented toggle, above it a plain select.
 */
const MAX_PROJECTS_FOR_TOGGLE = 6;

/**
 * `CreatePlanDialog.BuildProjectSelectOptions`: "Auto" leads whenever there is more than one
 * project to choose between (or none configured yet), then the projects, then the escape hatch to
 * settings. With exactly one project there is nothing to decide, so no "Auto".
 */
export function buildProjectOptions(
  projectNames: string[],
  includeAddProject: boolean,
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  if (projectNames.length > 1 || projectNames.length === 0) {
    options.push({ value: "Auto", label: "Auto" });
  }
  options.push(...projectNames.map((p) => ({ value: p, label: p })));
  if (includeAddProject) {
    options.push({ value: ADD_PROJECT_VALUE, label: "+ Add New Project" });
  }
  return options;
}

/**
 * `CreatePlanDialog._defaultProject`: one project means that project; otherwise the remembered
 * or caller-supplied one if it is still real, and "Auto" when it is not.
 */
export function defaultProject(projectNames: string[], preferred?: string): string {
  if (projectNames.length === 1) return projectNames[0];
  if (preferred === "Auto" || (preferred && projectNames.includes(preferred))) return preferred;
  return "Auto";
}

/**
 * Create New Plan, as V1's `CreatePlanDialog` composes it: a project picker over a single
 * content input that owns its own Create button. There is no priority field — V1 passes
 * `priority: 0` for every plan created here (`onCreatePlan(text, project, 0, uploadSessionId)`),
 * and its `PriorityOptions` never reach the dialog body.
 */
export const NewPlanModal: React.FC<NewPlanModalProps> = ({
  isOpen,
  onClose,
  projects,
  onJobStarted,
  onAddProject,
  initialTitle = "",
  initialDescription = "",
  initialProject = "",
  initialSourceUrl = "",
}) => {
  const projectNames = projects.map((p) => p.name);

  const [description, setDescription] = useState(
    initialTitle
      ? initialDescription
        ? `${initialTitle}\n\n${initialDescription}`
        : initialTitle
      : initialDescription,
  );
  const [selectedProject, setSelectedProject] = useState(
    defaultProject(projectNames, initialProject),
  );
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const combinedDesc = initialTitle
        ? initialDescription
          ? `${initialTitle}\n\n${initialDescription}`
          : initialTitle
        : initialDescription;
      setDescription(combinedDesc);
      setSelectedProject(
        defaultProject(
          projects.map((p) => p.name),
          initialProject,
        ),
      );
      setSourceUrl(initialSourceUrl);
      setError(null);
    }
  }, [isOpen, initialTitle, initialDescription, initialProject, initialSourceUrl, projects]);

  if (!isOpen) return null;

  const options = buildProjectOptions(projectNames, onAddProject !== undefined);
  const useToggleVariant = projectNames.length <= MAX_PROJECTS_FOR_TOGGLE;

  const handleProjectChange = (value: string) => {
    // `UseEffect` on `selectedProject` in V1: the action value is never a selection, it closes
    // the dialog and takes you to Settings → Projects.
    if (value === ADD_PROJECT_VALUE) {
      onClose();
      onAddProject?.();
      return;
    }
    setSelectedProject(value);
  };

  const handleSubmit = async (submittedText?: string) => {
    if (isSubmitting) return;
    const text = (submittedText ?? description).trim();
    if (!text) {
      setError("Please enter a description for the new plan.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Safe new plan intake: dispatches CreatePlan promptware job. Priority is always Normal
      // here, matching V1's dialog.
      const res = await jobsStore.startJob({
        type: "CreatePlan",
        project: selectedProject,
        description: text,
        priority: 0,
        sourceUrl: sourceUrl.trim() || undefined,
      });

      setIsSubmitting(false);
      setDescription("");
      setSourceUrl("");
      if (onJobStarted) {
        onJobStarted(res);
      }
      onClose();
    } catch (err) {
      setIsSubmitting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-plan-title"
      data-testid="new-plan-modal"
      /* Bottom-anchored below `sm`, centred above it: V1 swaps the whole surface at
         `Breakpoint.Mobile` for `new Sheet(...).Side(SheetSide.Bottom).Height(Size.Fit())` and keeps
         the `Dialog` elsewhere (`CreatePlanDialog.Build`). Both surfaces dismiss the same three ways
         and carry the same title, so the swap is a placement change and is expressed as one here
         rather than as a second component. */
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      {/* `.Width(Size.Rem(30))` on V1's dialog; `Size.Fit()` height on the mobile sheet, which is
          what `h-auto` with a capped max height amounts to. */}
      <div
        data-testid="new-plan-surface"
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-box border border-border bg-card p-6 shadow-2xl sm:max-h-none sm:max-w-[30rem] sm:rounded-box"
        onClick={(e) => e.stopPropagation()}
      >
        {/* No `border-b` here: the rule the header used to carry was the only divider in the dialog
            and was asked for removal. The `pb-4` stays -- it is the gap to the body, not the line. */}
        <div className="flex items-center justify-between pb-4">
          <h2 id="new-plan-title" className="text-lg font-bold text-foreground">
            Create New Plan
          </h2>
          {/* See the note on `JobSessionView`'s tab close: an icon, not the "✕" glyph. */}
          <IconButton label="Close modal" size="md" tone="muted" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>

        {error && <ErrorBanner className="mt-4">{error}</ErrorBanner>}

        {/* `Layout.Vertical().Gap(2) | projectPickerWidget | contentInputWidget` */}
        <div className="mt-4 space-y-2">
          {useToggleVariant ? (
            <div
              role="radiogroup"
              aria-label="Target Project"
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
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <select
              id="project-select"
              aria-label="Target Project"
              value={selectedProject}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="w-full rounded-field border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}

          <ContentInput
            id="content-input"
            value={description}
            autoFocus
            submitLabel="Create"
            placeholder="Enter task description..."
            eventHandler={(evt: string, _id: string, args?: unknown[]) => {
              if (evt === "OnChange") {
                const text = firstStringArg(args);
                if (text !== undefined) setDescription(text);
                return;
              }
              if (evt === "OnSubmit") {
                const text = submitValueArg(args);
                if (text === undefined) return;
                setDescription(text);
                void handleSubmit(text);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};
