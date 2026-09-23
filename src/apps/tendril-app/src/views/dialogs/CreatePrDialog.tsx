import * as React from "react";
import { CreatePrDialog as CreatePrDialogView } from "@ivy-interactive/components/dialogs";
import { PlanActionsController } from "../../controllers/planActions";
import { bridge } from "../../api/bridge";
import { readProjectEntries } from "../settings/projectConfig";
import { parseProjects } from "../PlansView";
import {
  describeBridgeError,
  type CreatePrOptions,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
  type TendrilConfig,
} from "../../types/api";

export interface CreatePrDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  onJobStarted?: (response: StartJobResponse) => void;
}

const repoName = (path: string): string =>
  path.split(/[/\\]/).filter(Boolean).pop()?.toLowerCase() ?? path.toLowerCase();

/**
 * V1 `CreatePrDialog.GetDefaultBaseBranch`: the configured `baseBranch` of the project repo whose
 * folder name matches the plan's first repo. The plan's own project is searched first, then every
 * project, as a repo can be shared between them. Undefined when nothing is configured - V1 falls back
 * to asking git, which the dialog expresses as "each repository's base branch" instead of guessing.
 */
export function defaultPrBaseBranch(
  config: TendrilConfig | null | undefined,
  plan: PlanDetail | PlanSummary,
): string | undefined {
  const firstRepo = "repos" in plan ? plan.repos?.[0] : undefined;
  if (!firstRepo) return undefined;
  const name = repoName(firstRepo);
  const own = new Set(parseProjects(plan.project).map((p) => p.toLowerCase()));
  const entries = readProjectEntries(config ?? null);
  const ordered = [
    ...entries.filter((p) => own.has(p.name.toLowerCase())),
    ...entries.filter((p) => !own.has(p.name.toLowerCase())),
  ];
  for (const entry of ordered) {
    const repo = entry.repos.find((r) => repoName(r.path) === name);
    if (repo?.baseBranch) return repo.baseBranch;
  }
  return undefined;
}

/**
 * The connected half of `CreatePrDialog`.
 *
 * The dialog owns the five toggles, the target branch, the reviewer and comment fields, and the
 * rules that shape the options it hands back — including V1's `DeleteBranch: deleteBranch && merge`,
 * so a stale tick cannot reach the job. What lives here is the dispatch and its outcome, and the two
 * reads V1's dialog makes on open: the default base branch (from the project config) and the people
 * who can review (V1 `GetAssigneesAsync`, here the project's `issues/metadata`).
 */
export function CreatePrDialog({ isOpen, onClose, plan, onJobStarted }: CreatePrDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [defaultBranch, setDefaultBranch] = React.useState<string | undefined>(undefined);
  const [reviewerOptions, setReviewerOptions] = React.useState<string[]>([]);
  const [reviewerError, setReviewerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const project = parseProjects(plan.project)[0];

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setReviewerError(null);

    void Promise.resolve()
      .then(() => bridge.getConfig())
      .then((config) => {
        if (!cancelled) setDefaultBranch(defaultPrBaseBranch(config, plan));
      })
      .catch(() => {
        // No config, no default: the select offers "each repository's base branch".
      });

    if (project && project !== "Auto") {
      void Promise.resolve()
        .then(() => bridge.getProjectIssueMetadata(project))
        .then((metadata) => {
          if (!cancelled)
            setReviewerOptions(Array.isArray(metadata?.assignees) ? metadata.assignees : []);
        })
        .catch((err) => {
          if (!cancelled) {
            setReviewerOptions([]);
            setReviewerError(describeBridgeError(err));
          }
        });
    } else {
      setReviewerOptions([]);
    }

    return () => {
      cancelled = true;
    };
    // `plan` is re-read only per opening: a poll that hands a fresh object mid-edit must not reset
    // the selection the operator is making.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, plan.id, project]);

  const handleSubmit = async (options: CreatePrOptions) => {
    setIsBusy(true);
    setError(null);
    try {
      const response = await PlanActionsController.createPr(plan, options);
      onJobStarted?.(response);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <CreatePrDialogView
      isOpen={isOpen}
      onClose={onClose}
      planId={plan.id}
      repoCount={"repos" in plan ? (plan.repos?.length ?? 0) : 0}
      defaultBranch={defaultBranch}
      reviewerOptions={reviewerOptions}
      reviewerOptionsError={reviewerError}
      onSubmit={handleSubmit}
      isBusy={isBusy}
      error={error}
    />
  );
}
