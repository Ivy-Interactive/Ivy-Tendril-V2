import * as React from "react";
import { Button } from "../ui/button";
import { DialogShell, DialogShortcutHint } from "./DialogShell";

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
      // Navigational rather than a submit, and included anyway: this is the *only* way forward from
      // the dialog — there is nothing to configure here, so "Go to Projects" is unambiguously the
      // primary and the chord cannot be mistaken for a second, more destructive answer. Consistency
      // is the argument. A user who has learned Ctrl+Enter on every other dialog should not have to
      // find out which ones opted out, and this one costs nothing to include. Contrast
      // `PlanSearchDialog` and `ShareTunnelDialog`, which are left alone on purpose: the first has
      // only a Close in its footer, and the second's real actions are status-dependent body buttons
      // where one chord would start a tunnel in one state and stop it in another.
      shortcut="Ctrl+Enter"
      onShortcut={onOpenSettings}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" onClick={onClose} data-testid="dialog-cancel">
            Cancel
          </Button>
          {/* V1's label is `Go to Projects`, and it navigates to the Projects tag of Settings —
              which is where `onOpenSettings` lands too, so the label survives the port intact. */}
          <Button onClick={onOpenSettings} data-testid="open-settings">
            Go to Projects
            <DialogShortcutHint shortcut="Ctrl+Enter" />
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
