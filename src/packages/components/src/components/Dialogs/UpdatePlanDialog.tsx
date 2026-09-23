import * as React from "react";
import { Button } from "../ui/button";
import { Callout } from "../ui/callout";
import { Textarea } from "../ui/textarea";
import { useTranslation } from "@/i18n/uiDialogs";
import { DialogShell } from "./DialogShell";

export interface UpdatePlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The plan's id, as it appears in the title. */
  planId: string;
  /**
   * Whether an UpdatePlan job is already running for this plan.
   *
   * V1's check, and a convenience rather than the authority: the service refuses a second
   * UpdatePlan on the same folder either way. The caller decides, because only it can see the job
   * list — and without one it cannot tell, which is why this defaults to false rather than
   * guessing.
   */
  hasActiveJob?: boolean;
  /** Dispatches the update. The caller owns the request, its busy state and its failure. */
  onSubmit: (instructions: string) => void | Promise<void>;
  isBusy?: boolean;
  error?: string | null;
}

/**
 * Asks UpdatePlan to revise the plan into a new revision.
 *
 * It rewrites the plan document and touches no code, which the description says explicitly because
 * the name does not: an operator who reads "Update Plan" as "apply the plan" would be dispatching
 * the wrong thing.
 *
 * Presentational. The instructions field and the submit gate live here; the dispatch lives in the
 * app's wrapper, which is also what knows whether a job is already in flight.
 */
export function UpdatePlanDialog({
  isOpen,
  onClose,
  planId,
  hasActiveJob = false,
  onSubmit,
  isBusy = false,
  error,
}: UpdatePlanDialogProps) {
  const { t } = useTranslation("uiDialogs");
  const [instructions, setInstructions] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (isOpen) setInstructions("");
  }, [isOpen]);

  const canSubmit = !isBusy && !hasActiveJob && instructions.trim() !== "";

  const handleSubmit = () => {
    if (!canSubmit) return;
    void onSubmit(instructions.trim());
  };

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("updatePlan.title", { planId })}
      width="rem30"
      shortcut="Ctrl+Enter"
      onShortcut={handleSubmit}
      description={t("updatePlan.description")}
      testId="update-plan-dialog"
      initialFocusRef={textareaRef}
      footer={
        <>
          <Button variant="outline" onClick={onClose} data-testid="dialog-cancel" disabled={isBusy}>
            {t("actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} data-testid="dialog-confirm" disabled={!canSubmit}>
            {isBusy ? t("status.starting") : t("updatePlan.submit")}
          </Button>
        </>
      }
    >
      {/* V1: `Text.P("⚠️ UpdatePlan is already running for this plan. Please wait...").Color(Warning)`,
          as a Callout here — `Alert` has only default and destructive, so it has no warning to give. */}
      {hasActiveJob && (
        <Callout.Warning className="mb-3" data-testid="update-plan-already-running">
          {t("updatePlan.alreadyRunning")}
        </Callout.Warning>
      )}
      <label
        htmlFor="update-plan-instructions"
        className="mb-1 block text-xs text-muted-foreground"
      >
        {t("updatePlan.instructionsLabel")}
      </label>
      <Textarea
        id="update-plan-instructions"
        ref={textareaRef}
        aria-label={t("updatePlan.instructionsAriaLabel")}
        rows={5}
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder={t("updatePlan.instructionsPlaceholder")}
        className="text-sm"
      />
      {error && <Callout.Error className="mt-4">{error}</Callout.Error>}
    </DialogShell>
  );
}
