import * as React from "react";
import {
  CreateIssueDialog as CreateIssueDialogView,
  type CreateIssueSubject,
  type CreateIssueSubmit,
} from "@ivy-interactive/components/dialogs";
import { PlanActionsController } from "../../controllers/planActions";
import { bridge } from "../../api/bridge";
import { parseProjects } from "../PlansView";
import {
  describeBridgeError,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";

export type { CreateIssueSubject };

export interface CreateIssueDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * In subject mode this is the *source* plan - the one the recommendation came from. It is still
   * what resolves the repo list and the job's plan scope.
   */
  plan: PlanDetail | PlanSummary;
  /** Fallback when the plan records no repos of its own. */
  projectRepos?: string[];
  subject?: CreateIssueSubject;
  onJobStarted?: (response: StartJobResponse) => void;
}

/**
 * The connected half of `CreateIssueDialog`.
 *
 * Resolving which repos to offer is this side's job - the plan's own, or the project's when it
 * records none - because only the app holds either. `repo` is the **local repository path**, not an
 * `owner/name` slug: it is the working directory the promptware runs `gh` in, which is why the view
 * renders a select over paths rather than a text box.
 *
 * The form, both modes and the submit gate stay with the view, including the rule that subject mode
 * needs a title: it is the only thing the promptware has to name the issue with, since it will not
 * be reading the plan's.
 */
export function CreateIssueDialog({
  isOpen,
  onClose,
  plan,
  projectRepos = [],
  subject,
  onJobStarted,
}: CreateIssueDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // V1's `assigneesQuery` / `labelsQuery` (`GetAssigneesAsync` / `GetLabelsAsync`), read per
  // opening from the project's `issues/metadata`, which unions every repo's lists and caches them
  // daemon-side. V1 keys its queries on the selected repo; the daemon answers per project, so the
  // lists do not change with the repo select.
  const [assigneeOptions, setAssigneeOptions] = React.useState<string[]>([]);
  const [labelOptions, setLabelOptions] = React.useState<string[]>([]);
  const [metadataLoading, setMetadataLoading] = React.useState(false);
  const [metadataError, setMetadataError] = React.useState<string | null>(null);
  const project = parseProjects(plan.project)[0];

  React.useEffect(() => {
    if (!isOpen || !project || project === "Auto") return;
    let cancelled = false;
    setMetadataLoading(true);
    setMetadataError(null);
    void Promise.resolve()
      .then(() => bridge.getProjectIssueMetadata(project))
      .then((metadata) => {
        if (cancelled) return;
        setAssigneeOptions(Array.isArray(metadata?.assignees) ? metadata.assignees : []);
        setLabelOptions(Array.isArray(metadata?.labels) ? metadata.labels : []);
      })
      .catch((err) => {
        if (cancelled) return;
        // The fields fall back to free text, so a repo `gh` cannot read still gets an issue.
        setAssigneeOptions([]);
        setLabelOptions([]);
        setMetadataError(describeBridgeError(err));
      })
      .finally(() => {
        if (!cancelled) setMetadataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, project]);

  const repos = React.useMemo(() => {
    const planRepos = "repos" in plan && plan.repos ? plan.repos : [];
    return planRepos.length > 0 ? planRepos : projectRepos;
  }, [plan, projectRepos]);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleSubmit = async (args: CreateIssueSubmit) => {
    setIsBusy(true);
    setError(null);
    try {
      const response = await PlanActionsController.createIssue(plan, args);
      onJobStarted?.(response);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <CreateIssueDialogView
      isOpen={isOpen}
      onClose={onClose}
      planId={plan.id}
      repos={repos}
      subject={subject}
      assigneeOptions={assigneeOptions}
      labelOptions={labelOptions}
      metadataLoading={metadataLoading}
      metadataError={metadataError}
      onSubmit={handleSubmit}
      isBusy={isBusy}
      error={error}
    />
  );
}
