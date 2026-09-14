import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { PlanActionsController } from "../../controllers/plan_actions";
import {
  describeBridgeError,
  type CreatePrOptions,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";
import { DialogShell } from "./DialogShell";
import { ALERT_CLASS, FIELD_CLASS } from "./fieldStyles";

export interface CreatePrDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  onJobStarted?: (response: StartJobResponse) => void;
}

interface ToggleDescriptor {
  key: "merge" | "draft" | "deleteBranch" | "includeArtifacts" | "solveMergeConflicts";
  label: string;
  hint: string;
}

/**
 * The toggles are exactly the booleans `CreatePrArgs` carries, and their defaults
 * are the promptware's own — so opening this dialog and confirming does what the
 * bare `{ type: "CreatePr", folderPath }` dispatch used to do.
 */
const TOGGLES: ToggleDescriptor[] = [
  {
    key: "merge",
    label: "Merge when checks pass",
    hint: "Unchecked opens the PR without merging.",
  },
  { key: "draft", label: "Open as draft", hint: "A draft PR cannot be merged." },
  { key: "deleteBranch", label: "Delete branch after merge", hint: "Only applies when merging." },
  {
    key: "includeArtifacts",
    label: "Include artifacts",
    hint: "Attaches screenshots and reports from the plan's Artifacts folder.",
  },
  {
    key: "solveMergeConflicts",
    label: "Solve merge conflicts",
    hint: "Lets the agent resolve conflicts against the base branch.",
  },
];

const DEFAULTS: Required<
  Pick<
    CreatePrOptions,
    "merge" | "draft" | "deleteBranch" | "includeArtifacts" | "solveMergeConflicts"
  >
> = {
  merge: true,
  draft: false,
  deleteBranch: true,
  includeArtifacts: true,
  solveMergeConflicts: true,
};

/**
 * Approves the plan and starts CreatePr with the options the operator chose.
 *
 * **No assignee field, deliberately.** `CreatePrArgs` has no `assignee` and no
 * `baseBranch`; the CLI folds `--assignee` into `reviewers` when no reviewer is
 * given, so assignee and reviewer are one channel in V2. An assignee input here
 * would silently vanish, so the helper text says so instead.
 */
export function CreatePrDialog({ isOpen, onClose, plan, onJobStarted }: CreatePrDialogProps) {
  const [toggles, setToggles] = React.useState(DEFAULTS);
  const [reviewers, setReviewers] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setToggles(DEFAULTS);
      setReviewers("");
      setComment("");
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const reviewerList = reviewers
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
    const trimmedComment = comment.trim();

    const options: CreatePrOptions = {
      ...toggles,
      // Omitted rather than sent empty: an empty `reviewers`/`comment` would
      // override the promptware's own handling of "not specified".
      ...(reviewerList.length > 0 ? { reviewers: reviewerList } : {}),
      ...(trimmedComment ? { comment: trimmedComment } : {}),
    };

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
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={`Create pull request for ${plan.id}`}
      description="CreatePr pushes the plan's branch, opens the PR and — unless you say otherwise — merges it and deletes the branch."
      testId="create-pr-dialog"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={onClose}
            data-testid="dialog-cancel"
            disabled={isBusy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            data-testid="dialog-confirm"
            disabled={isBusy}
          >
            {isBusy ? "Starting…" : "Create Pull Request"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {TOGGLES.map((toggle) => (
          <div key={toggle.key} className="flex items-start gap-2">
            <input
              id={`create-pr-${toggle.key}`}
              type="checkbox"
              checked={toggles[toggle.key]}
              onChange={(event) =>
                setToggles((prev) => ({ ...prev, [toggle.key]: event.target.checked }))
              }
              className="mt-0.5 size-4 accent-primary"
            />
            <label htmlFor={`create-pr-${toggle.key}`} className="text-sm text-foreground">
              {toggle.label}
              <span className="block text-xs text-muted-foreground">{toggle.hint}</span>
            </label>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="create-pr-reviewers" className="mb-1 block text-xs text-muted-foreground">
          Reviewers
        </label>
        <input
          id="create-pr-reviewers"
          aria-label="Reviewers"
          value={reviewers}
          onChange={(event) => setReviewers(event.target.value)}
          placeholder="octocat, hubot"
          className={FIELD_CLASS}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Comma-separated GitHub logins. V2 has no separate assignee field — the CLI folds an
          assignee into the reviewer list, so these are the same channel.
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="create-pr-comment" className="mb-1 block text-xs text-muted-foreground">
          Comment
        </label>
        <textarea
          id="create-pr-comment"
          aria-label="Comment"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Anything the reviewer should know before reading the diff…"
          className={FIELD_CLASS}
        />
      </div>

      {error && (
        <div role="alert" className={ALERT_CLASS}>
          {error}
        </div>
      )}
    </DialogShell>
  );
}
