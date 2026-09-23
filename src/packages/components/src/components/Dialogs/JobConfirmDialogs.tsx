import { i18n, useTranslation, type TFunction } from "@/i18n/uiJobs";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The Jobs table's confirms, presentational.
 *
 * Grouped in one file because they are one shape, like `PlanConfirmDialogs`: a `ConfirmDialog`
 * whose copy names a consequence, over a request the app owns. V1 builds the first three inline in
 * `JobsApp.DataTable.cs` (`:296`, `:319`, `:335`); their copy is V1's, word for word. The clear is
 * V2's own - V1 fires its clears straight off the menu - and is here so that all four read the same.
 *
 * `onConfirm`, `isBusy` and `error` are the seam: the app holds the write and hands the outcome back
 * down, and on a rejection the dialog stays open carrying the reason rather than dismissing as
 * though it had worked. Each confirm deliberately focuses Cancel rather than V1's `.AutoFocus()` on
 * the destructive button; `ConfirmDialog` documents why.
 */

interface JobConfirmBase {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isBusy?: boolean;
  error?: string | null;
  /** The dialog's test id. Each has a default; a host with two copies on screen can tell them apart. */
  testId?: string;
}

export interface DeleteJobDialogProps extends JobConfirmBase {}

/**
 * `JobsApp.DataTable.cs:296-317`: "Delete Job", and a destructive Delete. The handler V1 runs is
 * "stop it if it is still running, then delete", which is the app's to do.
 */
export function DeleteJobDialog({
  isOpen,
  onClose,
  onConfirm,
  isBusy,
  error,
  testId = "job-delete-dialog",
}: DeleteJobDialogProps) {
  const { t } = useTranslation("uiJobs");
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("deleteJob.title")}
      body={<p>{t("deleteJob.body")}</p>}
      confirmLabel={t("deleteJob.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
      testId={testId}
    />
  );
}

export interface StopJobsDialogProps extends JobConfirmBase {
  /** How many jobs the sweep would stop, as the header menu counted them. */
  count: number;
}

/** `JobsApp.DataTable.cs:319-333`: stops every queued job and leaves running ones alone. */
export function StopQueuedJobsDialog({
  isOpen,
  onClose,
  count,
  onConfirm,
  isBusy,
  error,
  testId = "stop-queued-dialog",
}: StopJobsDialogProps) {
  const { t } = useTranslation("uiJobs");
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("stopQueued.title")}
      body={t("stopQueued.body", { count })}
      confirmLabel={t("stopQueued.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
      testId={testId}
    />
  );
}

/**
 * `JobsApp.DataTable.cs:335-350`: stops every job that has not finished. Running agents are killed
 * and their plans revert, which the body says because the label does not.
 */
export function StopAllJobsDialog({
  isOpen,
  onClose,
  count,
  onConfirm,
  isBusy,
  error,
  testId = "stop-all-dialog",
}: StopJobsDialogProps) {
  const { t } = useTranslation("uiJobs");
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("stopAll.title")}
      body={t("stopAll.body", { count })}
      confirmLabel={t("stopAll.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
      testId={testId}
    />
  );
}

/** A bulk clear's scope: one terminal status, or `all` of them. Its copy is `clearJobs.scopes.<key>`. */
export type JobClearScopeKey = "completed" | "failed" | "timeout" | "stopped" | "all";

/** What the clear confirm says and offers, for one scope and one count. */
export interface JobClearPrompt {
  /** The dialog's title: the menu item the operator picked. */
  title: string;
  /** The question, naming both what goes and how many. */
  body: string;
  /** The destructive button's label. */
  confirmLabel: string;
  /** True while there is nothing to confirm — no count yet, or nothing to remove. */
  confirmDisabled: boolean;
}

/** A `t` for callers outside React; it translates into the language current at each call. */
const translateAtCall: TFunction = i18n.getFixedT(null, "uiJobs");

/**
 * The clear confirm's copy.
 *
 * A function rather than JSX in the dialog because the *sentence* is the safety mechanism: "Delete 412
 * completed jobs?" and "Delete completed jobs?" are different decisions, and V1 asks neither — it fires
 * `ClearCompletedJobs()` straight off the menu item. Three states, and each has to be right:
 *
 * - **not counted yet** (`null`): says so, and arms nothing. Offering a confirm a moment before the
 *   figure lands is how someone removes four hundred rows they thought were four.
 * - **nothing to remove**: says that instead of asking, and stays disarmed.
 * - **n rows**: the number, the noun, and what goes with them.
 */
export function describeJobClearPrompt(
  scope: JobClearScopeKey,
  count: number | null,
  t: TFunction = translateAtCall,
): JobClearPrompt {
  const title = t(`clearJobs.scopes.${scope}.title`);
  if (count === null) {
    return {
      title,
      body: t(`clearJobs.scopes.${scope}.counting`),
      confirmLabel: t("clearJobs.confirm"),
      confirmDisabled: true,
    };
  }
  if (count === 0) {
    return {
      title,
      body: t(`clearJobs.scopes.${scope}.empty`),
      confirmLabel: t("clearJobs.confirm"),
      confirmDisabled: true,
    };
  }
  return {
    title,
    body: t(`clearJobs.scopes.${scope}.confirm`, { count }),
    confirmLabel: t("clearJobs.confirmCount", { count }),
    confirmDisabled: false,
  };
}

export interface ClearJobsDialogProps extends JobConfirmBase {
  /** The scope the operator picked from the header menu. */
  scope: JobClearScopeKey;
  /** How many rows it would remove, counted over the whole table. `null` while still counting. */
  count: number | null;
}

/**
 * The Jobs table's bulk clears. V1 fires `ClearCompletedJobs()` straight off the menu item with no
 * dialog at all; this is the one place V2 deliberately does not follow it, because a bulk delete of
 * unbounded size is exactly what Framework's confirmation contract exists for. One dialog serves all
 * five scopes — they differ only in a noun and a count — and the confirm stays disarmed until the
 * count is in and non-zero.
 */
export function ClearJobsDialog({
  isOpen,
  onClose,
  scope,
  count,
  onConfirm,
  isBusy,
  error,
  testId = "jobs-clear-dialog",
}: ClearJobsDialogProps) {
  const { t } = useTranslation("uiJobs");
  const prompt = describeJobClearPrompt(scope, count, t);
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={prompt.title}
      body={<p data-testid="jobs-clear-body">{prompt.body}</p>}
      confirmLabel={prompt.confirmLabel}
      confirmVariant="destructive"
      confirmDisabled={prompt.confirmDisabled}
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
      testId={testId}
    />
  );
}
