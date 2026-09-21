import * as React from "react";
import { Button, Callout, Input, Textarea } from "@ivy-interactive/components/ui";
import { PlanActionsController } from "../../controllers/planActions";
import {
  describeBridgeError,
  type CreatePrOptions,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";
import { DialogShell } from "./DialogShell";

export interface CreatePrDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  onJobStarted?: (response: StartJobResponse) => void;
}

type ToggleKey = "solveMergeConflicts" | "merge" | "deleteBranch" | "includeArtifacts" | "draft";

interface ToggleDescriptor {
  key: ToggleKey;
  label: string;
  hint?: string;
}

/**
 * The toggles `CreatePrArgs` carries, in V1's order and under V1's labels — the order is the
 * sequence the job performs them in, so reading down the list is reading what will happen.
 *
 * `ToBoolInput` defaults to a checkbox in Ivy Framework and V1 passes no `.Variant(Switch)`, so
 * these are checkboxes.
 */
const TOGGLES: ToggleDescriptor[] = [
  { key: "solveMergeConflicts", label: "Solve Merge Conflicts" },
  { key: "merge", label: "Merge", hint: "Unchecked opens the PR without merging." },
  { key: "deleteBranch", label: "Delete Branch" },
  { key: "includeArtifacts", label: "Include Artifacts" },
  { key: "draft", label: "Create as Draft", hint: "A draft PR cannot be merged." },
];

/**
 * V1's own `UseState` defaults for this dialog. `includeArtifacts` is the one that is *not* the
 * promptware default: `CreatePrArgs.include_artifacts` defaults to true server-side, and V1's dialog
 * deliberately starts it off, so attaching a plan's screenshots and reports to a PR is a choice.
 */
const DEFAULTS: Required<Pick<CreatePrOptions, ToggleKey>> = {
  solveMergeConflicts: true,
  merge: true,
  deleteBranch: true,
  includeArtifacts: false,
  draft: false,
};

/**
 * Approves the plan and starts CreatePr with the options the operator chose.
 *
 * **No assignee field, deliberately.** `CreatePrArgs` has no `assignee`; the CLI folds
 * `--assignee` into `reviewers` when no reviewer is given, so assignee and reviewer are one channel
 * in V2. An assignee input here would silently vanish, so the helper text says so instead.
 *
 * **No target-branch field either**, which V1 does have (a searchable branch select with a custom
 * entry, defaulting to the repo's configured base branch). V2's `CreatePrArgs` carries no
 * `baseBranch` at all — only `SyncRepoArgs` does — so the field would have nowhere to go. Reported
 * with this pass rather than faked.
 */
export function CreatePrDialog({ isOpen, onClose, plan, onJobStarted }: CreatePrDialogProps) {
  const [toggles, setToggles] = React.useState(DEFAULTS);
  const [reviewers, setReviewers] = React.useState("");
  const [comment, setComment] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // V1's `.AutoFocus()` sits on the first checkbox. Nothing here is destructive, so it is the field
  // the dialog opens on rather than Cancel.
  const firstToggleRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setToggles(DEFAULTS);
      setReviewers("");
      setComment("");
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const multipleBranches = "repos" in plan && (plan.repos?.length ?? 0) > 1;

  const setToggle = (key: ToggleKey, checked: boolean) =>
    setToggles((prev) => ({
      ...prev,
      [key]: checked,
      // V1's `UseEffect(() => { if (!merge) deleteBranch.Set(false); }, merge)`: there is no branch
      // to delete when nothing is merged, so unchecking Merge clears it rather than leaving a
      // disabled checkbox ticked.
      ...(key === "merge" && !checked ? { deleteBranch: false } : {}),
    }));

  const handleSubmit = async () => {
    if (isBusy) return;
    const reviewerList = reviewers
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
    const trimmedComment = comment.trim();

    const options: CreatePrOptions = {
      ...toggles,
      // V1 sends `DeleteBranch: deleteBranch && merge`, so a stale tick cannot reach the job.
      deleteBranch: toggles.deleteBranch && toggles.merge,
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
      title={`Create PR for #${plan.id}`}
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={() => void handleSubmit()}
      description="CreatePr pushes the plan's branch, opens the PR and — unless you say otherwise — merges it and deletes the branch."
      testId="create-pr-dialog"
      initialFocusRef={firstToggleRef}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            data-testid="dialog-confirm"
            disabled={isBusy}
          >
            {isBusy ? "Starting…" : "Create PR"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {TOGGLES.map((toggle, index) => {
          const isDeleteBranch = toggle.key === "deleteBranch";
          const label = isDeleteBranch && multipleBranches ? "Delete Branches" : toggle.label;
          const hint = isDeleteBranch
            ? multipleBranches
              ? "Deletes the branches pushed to origin after successful merge."
              : "Deletes the branch pushed to origin after successful merge."
            : toggle.hint;
          const disabled = isDeleteBranch && !toggles.merge;
          return (
            <div key={toggle.key} className="flex items-start gap-2">
              <input
                id={`create-pr-${toggle.key}`}
                ref={index === 0 ? firstToggleRef : undefined}
                type="checkbox"
                checked={toggles[toggle.key]}
                disabled={disabled}
                aria-describedby={hint ? `create-pr-${toggle.key}-hint` : undefined}
                onChange={(event) => setToggle(toggle.key, event.target.checked)}
                className="mt-0.5 size-4 accent-primary disabled:opacity-50"
              />
              {/* The hint is V1's `.Description(...)`, a sibling of the field rather than part of its
                  label: folded into the label it would become part of the checkbox's accessible
                  name, which is then read out in full every time the control is announced. */}
              <div>
                <label
                  htmlFor={`create-pr-${toggle.key}`}
                  className={disabled ? "text-sm text-muted-foreground" : "text-sm text-foreground"}
                >
                  {label}
                </label>
                {hint && (
                  <p id={`create-pr-${toggle.key}-hint`} className="text-xs text-muted-foreground">
                    {hint}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <label htmlFor="create-pr-reviewers" className="mb-1 block text-xs text-muted-foreground">
          Reviewers
        </label>
        <Input
          id="create-pr-reviewers"
          aria-label="Reviewers"
          value={reviewers}
          onChange={(event) => setReviewers(event.target.value)}
          placeholder="octocat, hubot"
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
        <Textarea
          id="create-pr-comment"
          aria-label="Comment"
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Anything the reviewer should know before reading the diff…"
          className="text-sm"
        />
      </div>

      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
