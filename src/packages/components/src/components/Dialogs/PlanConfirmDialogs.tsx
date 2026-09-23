import { Button } from "../ui/button";
import { Trans, useTranslation } from "@/i18n/uiDialogs";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The plan-lifecycle confirms, presentational.
 *
 * Grouped in one file because they are one shape: a `ConfirmDialog` whose copy names a consequence,
 * over a request the app owns. Each takes `planId` rather than the app's `PlanDetail | PlanSummary`
 * DTO — following the precedent `PlanGitView` states, that the component which renders a shape owns
 * its declaration and cannot import from the app. The id is all any of this copy actually reads.
 *
 * `onConfirm`, `isBusy` and `error` are the seam. The app's wrappers hold the write, whether that
 * is `plansStore.removePlanOptimistic` or a transition, and hand the outcome back down: on
 * rejection the dialog stays open carrying the backend's message, because a row that vanished from
 * the list and then came back is a lie the operator may act on.
 */

interface PlanConfirmBase {
  isOpen: boolean;
  onClose: () => void;
  /** The plan's id, as it appears in the copy. */
  planId: string;
  onConfirm: () => void | Promise<void>;
  isBusy?: boolean;
  error?: string | null;
}

export interface ResetToDraftDialogProps extends PlanConfirmBase {}

/**
 * Sends the plan back to Draft and removes its worktrees, so it can be executed again from a clean
 * slate.
 *
 * State change and cleanup happen in one request, so the UI cannot leave a half-reset plan behind.
 * A Completed or Skipped plan — or one a job still holds — is refused with a 409, whose message
 * this renders in place. V1's confirm is Warning, not destructive: the commits already pushed are
 * not affected, only the worktrees are.
 */
export function ResetToDraftDialog({
  isOpen,
  onClose,
  planId,
  onConfirm,
  isBusy,
  error,
}: ResetToDraftDialogProps) {
  const { t } = useTranslation("uiDialogs");
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      // `DialogHeader($"Reset Plan #{id} to Draft")`, and V1's Warning (not destructive) confirm.
      title={t("resetToDraft.title", { planId })}
      testId="reset-to-draft-dialog"
      confirmLabel={t("resetToDraft.confirm")}
      confirmVariant="warning"
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
      body={
        <p>
          <Trans
            ns="uiDialogs"
            i18nKey="resetToDraft.body"
            components={{ state: <span className="text-foreground" /> }}
          />
        </p>
      }
    />
  );
}

export interface PartialDeliveryDialogProps extends PlanConfirmBase {
  /** Names of the verifications that failed. Only failures are listed; this is what they are for. */
  failedVerifications: string[];
}

/**
 * Completes the plan while accepting that some verifications failed.
 *
 * Without the partial-delivery flag the same request is refused with a 409 listing the failures,
 * which is exactly what this dialog exists to acknowledge by name before sending it. V1 names the
 * dialog after what blocked completion rather than after the override, and treats the override as
 * destructive: it stamps a plan as shipped incomplete, and duplicate detection reads that stamp
 * afterwards.
 */
export function PartialDeliveryDialog({
  isOpen,
  onClose,
  planId,
  failedVerifications,
  onConfirm,
  isBusy,
  error,
}: PartialDeliveryDialogProps) {
  const { t } = useTranslation("uiDialogs");
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("partialDelivery.title")}
      testId="partial-delivery-dialog"
      confirmLabel={t("partialDelivery.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
      body={
        <>
          <p>
            <Trans
              ns="uiDialogs"
              i18nKey="partialDelivery.body"
              values={{ planId }}
              components={{ state: <span className="text-foreground" /> }}
            />
          </p>
          <ul className="space-y-1" data-testid="failing-verifications">
            {failedVerifications.map((name) => (
              <li key={name} className="text-warning">
                {name}
              </li>
            ))}
          </ul>
        </>
      }
    />
  );
}

export interface DeletePlanDialogProps extends PlanConfirmBase {
  /** Moves the plan to Skipped instead. Reversible, which is why it sits beside Cancel. */
  onSkip: () => void | Promise<void>;
  /** Moves the plan to Icebox instead. */
  onArchive: () => void | Promise<void>;
}

/**
 * Deletes the plan, with the two reversible answers beside it.
 *
 * Framework's body is the question plus its consequence; V1's `Icebox/Dialogs/DeletePlanDialog`
 * words the same question as "Are you sure you want to permanently delete plan #{id}?". The second
 * sentence is what V1's bare copy leaves the operator to guess, and the third names the reversible
 * answers so the footer's four buttons are not a surprise.
 */
export function DeletePlanDialog({
  isOpen,
  onClose,
  planId,
  onConfirm,
  onSkip,
  onArchive,
  isBusy,
  error,
}: DeletePlanDialogProps) {
  const { t } = useTranslation("uiDialogs");
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("deletePlan.title")}
      testId="delete-plan-dialog"
      width="rem40"
      confirmLabel={t("deletePlan.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
      body={<p>{t("deletePlan.body", { planId })}</p>}
      secondaryAction={
        <>
          <Button
            variant="outline"
            onClick={() => void onSkip()}
            data-testid="dialog-skip"
            disabled={isBusy}
          >
            {t("deletePlan.skip")}
          </Button>
          <Button
            variant="outline"
            onClick={() => void onArchive()}
            data-testid="dialog-archive"
            disabled={isBusy}
          >
            {t("deletePlan.archive")}
          </Button>
        </>
      }
    />
  );
}
