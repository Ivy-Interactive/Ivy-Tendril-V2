import * as React from "react";
import { CreatePrDialog as CreatePrDialogView } from "@ivy-interactive/components/dialogs";
import { PlanActionsController } from "../../controllers/planActions";
import {
  describeBridgeError,
  type CreatePrOptions,
  type PlanDetail,
  type PlanSummary,
  type StartJobResponse,
} from "../../types/api";

export interface CreatePrDialogProps {
  isOpen: boolean;
  onClose: () => void;
  plan: PlanDetail | PlanSummary;
  onJobStarted?: (response: StartJobResponse) => void;
}

/**
 * The connected half of `CreatePrDialog`.
 *
 * The dialog owns the five toggles, the reviewer and comment fields, and the rules that shape the
 * options it hands back — including V1's `DeleteBranch: deleteBranch && merge`, so a stale tick
 * cannot reach the job. What lives here is the dispatch and its outcome.
 */
export function CreatePrDialog({ isOpen, onClose, plan, onJobStarted }: CreatePrDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

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
      onSubmit={handleSubmit}
      isBusy={isBusy}
      error={error}
    />
  );
}
