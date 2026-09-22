import * as React from "react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { useTranslation, type TFunction } from "@/i18n/uiDialogs";
import { DialogShell } from "./DialogShell";

/**
 * The options a CreatePr dispatch carries.
 *
 * Declared here rather than imported from the app, on the rule `PlanGitView` states: the component
 * that collects these owns their shape. The app's `CreatePrOptions` is structurally identical.
 */
export interface CreatePrOptions {
  solveMergeConflicts: boolean;
  merge: boolean;
  deleteBranch: boolean;
  includeArtifacts: boolean;
  draft: boolean;
  reviewers?: string[];
  comment?: string;
}

export interface CreatePrDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The plan's id, as it appears in the title. */
  planId: string;
  /** How many repos the plan spans. More than one means more than one branch, which the copy says. */
  repoCount?: number;
  /** Dispatches CreatePr. The app owns the request, its busy state and its failure. */
  onSubmit: (options: CreatePrOptions) => void | Promise<void>;
  isBusy?: boolean;
  error?: string | null;
}

type ToggleKey = "solveMergeConflicts" | "merge" | "deleteBranch" | "includeArtifacts" | "draft";

interface ToggleCopy {
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
const TOGGLES: readonly ToggleKey[] = [
  "solveMergeConflicts",
  "merge",
  "deleteBranch",
  "includeArtifacts",
  "draft",
];

/**
 * A toggle's label and hint, looked up at render time so they follow the language.
 * `multipleBranches` - the plan spans several repos, so there is a branch per repo - is a yes/no
 * choice between two wordings, not a count: the label shows no number, so it is a context
 * (`label_multiple`) rather than a plural that would pick the singular for 21 repos in Russian.
 */
function toggleCopy(t: TFunction, key: ToggleKey, multipleBranches: boolean): ToggleCopy {
  const branchContext = multipleBranches ? "multiple" : undefined;
  switch (key) {
    case "solveMergeConflicts":
      return { label: t("createPr.toggles.solveMergeConflicts.label") };
    case "merge":
      return {
        label: t("createPr.toggles.merge.label"),
        hint: t("createPr.toggles.merge.hint"),
      };
    case "deleteBranch":
      return {
        label: t("createPr.toggles.deleteBranch.label", { context: branchContext }),
        hint: t("createPr.toggles.deleteBranch.hint", { context: branchContext }),
      };
    case "includeArtifacts":
      return { label: t("createPr.toggles.includeArtifacts.label") };
    case "draft":
      return {
        label: t("createPr.toggles.draft.label"),
        hint: t("createPr.toggles.draft.hint"),
      };
  }
}

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
export function CreatePrDialog({
  isOpen,
  onClose,
  planId,
  repoCount,
  onSubmit,
  isBusy = false,
  error,
}: CreatePrDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const [toggles, setToggles] = React.useState(DEFAULTS);
  const [reviewers, setReviewers] = React.useState("");
  const [comment, setComment] = React.useState("");
  // V1's `.AutoFocus()` sits on the first checkbox. Nothing here is destructive, so it is the field
  // the dialog opens on rather than Cancel.
  const firstToggleRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setToggles(DEFAULTS);
      setReviewers("");
      setComment("");
    }
  }, [isOpen]);

  const multipleBranches = (repoCount ?? 0) > 1;

  const setToggle = (key: ToggleKey, checked: boolean) =>
    setToggles((prev) => ({
      ...prev,
      [key]: checked,
      // V1's `UseEffect(() => { if (!merge) deleteBranch.Set(false); }, merge)`: there is no branch
      // to delete when nothing is merged, so unchecking Merge clears it rather than leaving a
      // disabled checkbox ticked.
      ...(key === "merge" && !checked ? { deleteBranch: false } : {}),
    }));

  const handleSubmit = () => {
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

    void onSubmit(options);
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("createPr.title", { planId })}
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={() => void handleSubmit()}
      description={t("createPr.description")}
      testId="create-pr-dialog"
      initialFocusRef={firstToggleRef}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            {t("actions.cancel")}
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            data-testid="dialog-confirm"
            disabled={isBusy}
          >
            {isBusy ? t("status.starting") : t("createPr.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {TOGGLES.map((key, index) => {
          const isDeleteBranch = key === "deleteBranch";
          const { label, hint } = toggleCopy(t, key, multipleBranches);
          const disabled = isDeleteBranch && !toggles.merge;
          return (
            <div key={key} className="flex items-start gap-2">
              <input
                id={`create-pr-${key}`}
                ref={index === 0 ? firstToggleRef : undefined}
                type="checkbox"
                checked={toggles[key]}
                disabled={disabled}
                aria-describedby={hint ? `create-pr-${key}-hint` : undefined}
                onChange={(event) => setToggle(key, event.target.checked)}
                className="mt-0.5 size-4 accent-primary disabled:opacity-50"
              />
              {/* The hint is V1's `.Description(...)`, a sibling of the field rather than part of its
                  label: folded into the label it would become part of the checkbox's accessible
                  name, which is then read out in full every time the control is announced. */}
              <div>
                <label
                  htmlFor={`create-pr-${key}`}
                  className={disabled ? "text-sm text-muted-foreground" : "text-sm text-foreground"}
                >
                  {label}
                </label>
                {hint && (
                  <p id={`create-pr-${key}-hint`} className="text-xs text-muted-foreground">
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
          {t("createPr.reviewers.label")}
        </label>
        <Input
          id="create-pr-reviewers"
          aria-label={t("createPr.reviewers.label")}
          value={reviewers}
          onChange={(event) => setReviewers(event.target.value)}
          placeholder="octocat, hubot"
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("createPr.reviewers.hint")}</p>
      </div>

      <div className="mt-4">
        <label htmlFor="create-pr-comment" className="mb-1 block text-xs text-muted-foreground">
          {t("createPr.comment.label")}
        </label>
        <Textarea
          id="create-pr-comment"
          aria-label={t("createPr.comment.label")}
          rows={3}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t("createPr.comment.placeholder")}
          className="text-sm"
        />
      </div>

      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
