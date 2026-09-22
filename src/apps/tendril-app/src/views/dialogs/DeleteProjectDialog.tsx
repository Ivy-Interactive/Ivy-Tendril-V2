import * as React from "react";
import { DeleteProjectDialog as DeleteProjectDialogView } from "@ivy-interactive/components/dialogs";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";

export { confirmsProjectName } from "@ivy-interactive/components/dialogs";

export interface DeleteProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The project's stored name. Also the path segment the route is addressed by, and the phrase to type. */
  projectName: string;
  /** Called once the project and its data are gone, so the caller can re-point its selection. */
  onDeleted?: (projectName: string) => void;
}

/**
 * The connected half of `DeleteProjectDialog`: the Danger Zone's irreversible action,
 * `DELETE /api/projects/:name/data`, which deletes the project's data from disk rather than
 * forgetting the project.
 *
 * The typed-name gate stays with the view, because it is what the operator interacts with and it
 * has to hold whether the confirm is reached by click or by the Ctrl+Enter chord. What lives here
 * is only the request, its busy state and its rejection — on failure the dialog stays open carrying
 * the backend's message, since a project that disappeared and then came back is a lie the operator
 * may act on.
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
      await bridge.deleteProjectData(projectName);
      onDeleted?.(projectName);
      onClose();
    } catch (err) {
      setError(describeBridgeError(err));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <DeleteProjectDialogView
      isOpen={isOpen}
      onClose={onClose}
      projectName={projectName}
      onConfirm={handleDelete}
      isBusy={isBusy}
      error={error}
    />
  );
}
