import * as React from "react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Input } from "../ui/input";
import { NativeSelect } from "../ui/native-select";
import { Textarea } from "../ui/textarea";
import { PickerChips } from "./PickerChips";
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
  /**
   * The branch the PR targets, when the operator picked one other than the default (V1
   * `CreatePrArgs.BaseBranch`). Absent means each repo's own base branch.
   */
  baseBranch?: string;
}

/** The select's sentinel for V1's "+ Custom branch..." entry (`customOptionValue`). */
const CUSTOM_BRANCH_VALUE = "__custom_branch__";

export interface CreatePrDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The plan's id, as it appears in the title. */
  planId: string;
  /** How many repos the plan spans. More than one means more than one branch, which the copy says. */
  repoCount?: number;
  /**
   * The plan's first repo's configured base branch - V1's `GetDefaultBaseBranch`, which the Target
   * Branch select leads with as "<branch> (default)". Unknown, the select leads with "each
   * repository's base branch" instead, which sends no override.
   */
  defaultBranch?: string;
  /** Other branches to offer in the select (V1 lists the repo's local branches). */
  branches?: string[];
  /**
   * People who can be asked to review, from GitHub (V1 `GetAssigneesAsync`). Given, Reviewers is a
   * pick list; absent or empty, it stays a comma-separated field.
   */
  reviewerOptions?: string[];
  /** Why the reviewer list could not be loaded, shown under the field (V1 `assigneesError`). */
  reviewerOptionsError?: string | null;
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
 * **Target Branch** is V1's `BuildTargetBranchField`: the default first, then any other branches the
 * caller knows, then "+ Custom branch..." which swaps the select for a text field. It reaches the job
 * as `CreatePrArgs.baseBranch`, which the daemon writes into every plan repo's `RepoConfigs` entry
 * and as `PrBaseBranch`.
 */
export function CreatePrDialog({
  isOpen,
  onClose,
  planId,
  repoCount,
  defaultBranch,
  branches = [],
  reviewerOptions = [],
  reviewerOptionsError,
  onSubmit,
  isBusy = false,
  error,
}: CreatePrDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const [toggles, setToggles] = React.useState(DEFAULTS);
  const [reviewers, setReviewers] = React.useState("");
  const [pickedReviewers, setPickedReviewers] = React.useState<string[]>([]);
  const [comment, setComment] = React.useState("");
  // V1's `selectedBranch` / `isCustomBranch` / `customBranchText`.
  const [selectedBranch, setSelectedBranch] = React.useState(defaultBranch ?? "");
  const [isCustomBranch, setIsCustomBranch] = React.useState(false);
  const [customBranch, setCustomBranch] = React.useState("");
  // V1's `.AutoFocus()` sits on the first checkbox. Nothing here is destructive, so it is the field
  // the dialog opens on rather than Cancel.
  const firstToggleRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isOpen) {
      setToggles(DEFAULTS);
      setReviewers("");
      setPickedReviewers([]);
      setComment("");
      setIsCustomBranch(false);
      setCustomBranch("");
    }
  }, [isOpen]);

  // The default can arrive after the dialog opens (it is read from the project config); it is the
  // selection until the operator picks something else.
  React.useEffect(() => {
    if (isOpen) setSelectedBranch(defaultBranch ?? "");
  }, [isOpen, defaultBranch]);

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
    const reviewerList =
      reviewerOptions.length > 0
        ? pickedReviewers
        : reviewers
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry !== "");
    const trimmedComment = comment.trim();
    // V1: `isCustomBranch && !IsNullOrWhiteSpace(customBranchText) ? customBranchText.Trim() :
    // selectedBranch`. Sent only when it differs from the default: V1 always sends it, and then the
    // first repo's base overrides every other repo's, which a multi-repo plan does not want.
    const target = (isCustomBranch && customBranch.trim() ? customBranch : selectedBranch).trim();
    const baseBranch = target !== "" && target !== (defaultBranch ?? "") ? target : undefined;

    const options: CreatePrOptions = {
      ...toggles,
      // V1 sends `DeleteBranch: deleteBranch && merge`, so a stale tick cannot reach the job.
      deleteBranch: toggles.deleteBranch && toggles.merge,
      // Omitted rather than sent empty: an empty `reviewers`/`comment` would
      // override the promptware's own handling of "not specified".
      ...(reviewerList.length > 0 ? { reviewers: reviewerList } : {}),
      ...(trimmedComment ? { comment: trimmedComment } : {}),
      ...(baseBranch ? { baseBranch } : {}),
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
      {/* `BuildTargetBranchField`: a select led by the default, with a custom entry that swaps it
          for a text field and a "Choose from list" way back. */}
      <div className="mb-4" data-testid="create-pr-target-branch">
        <div className="mb-1 flex items-center justify-between">
          <label
            htmlFor={isCustomBranch ? "create-pr-custom-branch" : "create-pr-target-branch"}
            className="block text-xs text-muted-foreground"
          >
            {t("createPr.targetBranch.label")}
          </label>
          {isCustomBranch && (
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setIsCustomBranch(false);
                if (selectedBranch.trim() === "") setSelectedBranch(defaultBranch ?? "");
              }}
            >
              {t("createPr.targetBranch.chooseFromList")}
            </button>
          )}
        </div>
        {isCustomBranch ? (
          <>
            <Input
              id="create-pr-custom-branch"
              aria-label={t("createPr.targetBranch.label")}
              value={customBranch}
              autoFocus
              onChange={(event) => setCustomBranch(event.target.value)}
              placeholder={t("createPr.targetBranch.customPlaceholder")}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {defaultBranch
                ? t("createPr.targetBranch.customHint", { branch: defaultBranch })
                : t("createPr.targetBranch.customHintRepoDefault")}
            </p>
          </>
        ) : (
          <NativeSelect
            id="create-pr-target-branch"
            aria-label={t("createPr.targetBranch.label")}
            value={selectedBranch}
            onChange={(event) => {
              if (event.target.value === CUSTOM_BRANCH_VALUE) {
                setIsCustomBranch(true);
                return;
              }
              setSelectedBranch(event.target.value);
            }}
          >
            {defaultBranch ? (
              <option value={defaultBranch}>
                {t("createPr.targetBranch.defaultOption", { branch: defaultBranch })}
              </option>
            ) : (
              <option value="">{t("createPr.targetBranch.repoDefault")}</option>
            )}
            {branches
              .filter((branch) => branch.toLowerCase() !== (defaultBranch ?? "").toLowerCase())
              .map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            <option value={CUSTOM_BRANCH_VALUE}>{t("createPr.targetBranch.custom")}</option>
          </NativeSelect>
        )}
      </div>

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
        {reviewerOptions.length > 0 ? (
          <PickerChips
            options={reviewerOptions}
            selected={pickedReviewers}
            ariaLabel={t("createPr.reviewers.label")}
            testId="create-pr-reviewer-picker"
            onToggle={(login) =>
              setPickedReviewers((current) =>
                current.includes(login)
                  ? current.filter((entry) => entry !== login)
                  : [...current, login],
              )
            }
          />
        ) : (
          <Input
            id="create-pr-reviewers"
            aria-label={t("createPr.reviewers.label")}
            value={reviewers}
            onChange={(event) => setReviewers(event.target.value)}
            placeholder="octocat, hubot"
          />
        )}
        <p className="mt-1 text-xs text-muted-foreground">{t("createPr.reviewers.hint")}</p>
        {reviewerOptionsError && (
          <p className="mt-1 text-xs text-destructive" data-testid="create-pr-reviewers-error">
            {t("createPr.reviewers.loadError", { error: reviewerOptionsError })}
          </p>
        )}
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
