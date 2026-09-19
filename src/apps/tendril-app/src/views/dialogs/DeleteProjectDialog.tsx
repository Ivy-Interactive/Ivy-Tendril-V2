import * as React from "react";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DeleteProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The project's stored name, which is also the path segment the route is addressed by. */
  projectName: string;
  /** Called once the entry is gone, so the caller can re-point its selection. */
  onDeleted?: (projectName: string) => void;
}

/**
 * `ProjectDetailView.cs`'s Danger Zone button, whose `WithConfirm` is the only one in V1.
 *
 * V1's body is the bare "This cannot be undone.", which is both vaguer and more alarming than the
 * truth: `delete_project` contains no `fs::` call of any kind. It removes the `config.yaml` entry
 * and nothing else - the clones under `<TENDRIL_HOME>/Projects/<name>/` survive, the plan folders
 * survive, and the rows in `Plans`, `Jobs` and `Recommendations` keep naming a project the config no
 * longer has. Saying so is what lets an operator judge the click, and it is why the copy below names
 * what stays rather than reaching for irreversibility.
 *
 * Composed on `ConfirmDialog` in `DeletePlanDialog`'s shape rather than on `useRemovalConfirm`: that
 * hook closes before it calls, its `onConfirm` is synchronous, and it has neither a busy state nor
 * anywhere to put a rejection. This is an awaited `DELETE` over the daemon, so on rejection the
 * dialog stays open carrying the backend's message - a project that vanished from the sidebar and
 * then came back is a lie the operator may act on.
 *
 * Nothing to type, per point 4 of the contract in `ConfirmDialog`.
 */
export function DeleteProjectDialog({
  isOpen,
  onClose,
  projectName,
  onDeleted,
}: DeleteProjectDialogProps) {
  const [isBusy, setIsBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsBusy(false);
    }
  }, [isOpen]);

  const handleDelete = async () => {
    setIsBusy(true);
    setError(null);
    try {
      await bridge.deleteProject(projectName);
      onDeleted?.(projectName);
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
      title="Delete Project"
      testId="delete-project-dialog"
      width="rem40"
      confirmLabel="Delete Project"
      confirmVariant="destructive"
      onConfirm={handleDelete}
      isBusy={isBusy}
      error={error}
      body={
        <>
          <p>
            Are you sure you want to delete project{" "}
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
