import * as React from "react";
import { RemoveProjectDialog as RemoveProjectDialogView } from "@ivy-interactive/components/tendril";
import { bridge } from "../../api/bridge";
import { describeBridgeError } from "../../types/api";

export interface RemoveProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  /** Called once the entry is gone, so the caller can re-point its selection. */
  onRemoved?: (projectName: string) => void;
}

/**
 * The connected half of `RemoveProjectDialog`.
 *
 * The dialog itself is presentational and lives in the component library; this owns the one thing
 * it cannot: the `DELETE /api/projects/:name` call, its busy state, and its rejection. That split
 * is what lets the dialog into Storybook — the library cannot import the bridge, and a story
 * cannot reach a daemon.
 *
 * Composed this way rather than on `useRemovalConfirm`: that hook closes before it calls, its
 * `onConfirm` is synchronous, and it has neither a busy state nor anywhere to put a rejection. This
 * is an awaited request, so on failure the dialog stays open carrying the backend's message.
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
    <RemoveProjectDialogView
      isOpen={isOpen}
      onClose={onClose}
      projectName={projectName}
      onConfirm={handleRemove}
      isBusy={isBusy}
      error={error}
    />
  );
}
