import React, { useState, useEffect } from "react";
import { ContentInput } from "@spacecorps/components-storybook/tendril";
import type { ProjectSummary, StartJobResponse } from "../types/api";
import { jobsStore } from "../state/jobsStore";
import { firstStringArg, submitValueArg } from "../utils/eventArgs";

interface NewPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
  onJobStarted?: (res: StartJobResponse) => void;
  initialTitle?: string;
  initialDescription?: string;
  initialProject?: string;
  initialSourceUrl?: string;
}

export const NewPlanModal: React.FC<NewPlanModalProps> = ({
  isOpen,
  onClose,
  projects,
  onJobStarted,
  initialTitle = "",
  initialDescription = "",
  initialProject = "",
  initialSourceUrl = "",
}) => {
  const [description, setDescription] = useState(
    initialTitle
      ? initialDescription
        ? `${initialTitle}\n\n${initialDescription}`
        : initialTitle
      : initialDescription,
  );
  const [selectedProject, setSelectedProject] = useState(
    initialProject || projects[0]?.name || "Tendril-App",
  );
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl);
  const [priority, setPriority] = useState(0);
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
      if (initialProject && projects.some((p) => p.name === initialProject)) {
        setSelectedProject(initialProject);
      } else if (projects[0]?.name) {
        setSelectedProject(projects[0].name);
      }
      setSourceUrl(initialSourceUrl);
      setError(null);
    }
  }, [isOpen, initialTitle, initialDescription, initialProject, initialSourceUrl, projects]);

  if (!isOpen) return null;

  const projectNames = projects.map((p) => p.name);

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
      // Safe new plan intake: dispatches CreatePlan promptware job
      const res = await jobsStore.startJob({
        type: "CreatePlan",
        project: selectedProject,
        description: text,
        priority,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 id="new-plan-title" className="text-lg font-bold text-slate-100">
              Create New Plan (Intake)
            </h2>
            <p className="text-xs text-slate-400">
              Dispatches an autonomous CreatePlan job to research codebase and author plan.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded p-1 text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="mt-4 space-y-4">
          <div className="flex items-center space-x-4">
            <div className="flex-1">
              <label
                htmlFor="project-select"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Target Project
              </label>
              <select
                id="project-select"
                aria-label="Target Project"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                {projectNames.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-32">
              <label
                htmlFor="priority-input"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Priority
              </label>
              <input
                id="priority-input"
                aria-label="Priority"
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Task Description & Objectives
            </label>
            <ContentInput
              id="content-input"
              value={description}
              placeholder="Describe the task, bug to fix, feature to build, or files to inspect..."
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
            {/* Fallback textarea for direct editing */}
            <textarea
              aria-label="Task description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs to be implemented or investigated?"
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end space-x-3 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting || !description.trim()}
            onClick={() => void handleSubmit()}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition ${
              isSubmitting || !description.trim()
                ? "cursor-not-allowed bg-slate-800 text-slate-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {isSubmitting ? "Dispatching..." : "Start CreatePlan"}
          </button>
        </div>
      </div>
    </div>
  );
};
