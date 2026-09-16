import * as React from "react";
import { Button } from "@ivy-interactive/components/ui";
import { DialogShell } from "./DialogShell";

export interface NoProjectsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Navigates to Settings, where projects are configured. */
  onOpenSettings: () => void;
}

/**
 * The empty state for the new-plan flow: a plan needs a project, and none is
 * configured.
 *
 * There is no `projects` nav id — the nav list is dashboard | plans | review |
 * inbox | jobs | costs | settings — so Settings is where this points, and the
 * copy names the Projects section within it.
 */
export function NoProjectsDialog({ isOpen, onClose, onOpenSettings }: NoProjectsDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="No Projects"
      description="Every plan belongs to a project, and this Tendril home has none yet."
      testId="no-projects-dialog"
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            Cancel
          </Button>
          {/* V1's label is `Go to Projects`, and it navigates to the Projects tag of Settings —
              which is where `onOpenSettings` lands too, so the label survives the port intact. */}
          <Button onClick={onOpenSettings} data-testid="open-settings">
            Go to Projects
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Add a project under <span className="text-foreground">Settings → Projects</span> — a name,
        its repositories and the verifications its plans run — then create the plan again.
      </p>
    </DialogShell>
  );
}
