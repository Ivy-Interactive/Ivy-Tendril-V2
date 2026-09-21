import * as React from "react";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";
import { ConfirmDialog } from "./ConfirmDialog";

export interface RemoveProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The project's stored name, which is also the path segment the route is addressed by. */
  projectName: string;
  /** Called once the entry is gone, so the caller can re-point its selection. */
  onRemoved?: (projectName: string) => void;
}

/**
 * `ProjectDetailView.cs`'s Danger Zone button, whose `WithConfirm` is the only one in V1.
 *
 * This is the **reversible** half of the Danger Zone: `DELETE /api/projects/:name` contains no
 * `fs::` call of any kind. It removes the `config.yaml` entry and nothing else - the clones under
 * `<TENDRIL_HOME>/Projects/<name>/` survive, the plan folders survive, and the rows in `Plans`,
 * `Jobs` and `Recommendations` keep naming a project the config no longer has. Adding the project
 * back by name is enough to see all of it again.
 *
 * It used to be called Delete Project, which is what V1 calls it too, and both were wrong in the
 * same way: a button labelled *delete* that deletes nothing. The copy below carried the whole
 * correction on its own, and an operator who did not read it had no way to know. So the label is now
 * the verb that happens - Remove - and {@link DeleteProjectDialog} is the one that means delete.
 *
 * Composed on `ConfirmDialog` in `DeletePlanDialog`'s shape rather than on `useRemovalConfirm`: that
 * hook closes before it calls, its `onConfirm` is synchronous, and it has neither a busy state nor
 * anywhere to put a rejection. This is an awaited `DELETE` over the daemon, so on rejection the
 * dialog stays open carrying the backend's message - a project that vanished from the sidebar and
 * then came back is a lie the operator may act on.
 *
 * Nothing to type, per point 4 of the contract in `ConfirmDialog`. That is the right weight for an
 * action that destroys nothing, and it is the difference the reader should see between this dialog
 * and its destructive sibling.
 */
export function RemoveProjectDialog({
  isOpen,
  onClose,
  projectName,
  onRemoved,
}: RemoveProjectDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleRemove = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await bridge.removeProject(projectName);
      onRemoved?.(projectName);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Remove Project"
      testId="remove-project-dialog"
      width="rem40"
      confirmLabel="Remove Project"
      confirmVariant="destructive"
      onConfirm={handleRemove}
      isBusy={isBusy}
      error={error}
      body={
        <>
          <p>
            Are you sure you want to remove project{" "}
            <span className="text-foreground">{projectName}</span>?
          </p>
          <p className="text-muted-foreground">
            This removes the project from config.yaml. Its cloned repositories, plan folders and
            history stay on disk, so nothing is deleted from your machine - but Tendril will stop
            listing the project, and its existing plans and jobs will name a project it no longer
            knows.
          </p>
        </>
      }
    />
  );
}
