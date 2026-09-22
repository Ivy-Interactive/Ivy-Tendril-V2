import * as React from "react";
import { Button } from "../ui/button";
import { Trans, useTranslation } from "@/i18n/uiDialogs";
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
  const { t } = useTranslation("uiDialogs");
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      title={t("noProjects.title")}
      description={t("noProjects.description")}
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
            {t("actions.cancel")}
          </Button>
          {/* V1's label is `Go to Projects`, and it navigates to the Projects tag of Settings —
              which is where `onOpenSettings` lands too, so the label survives the port intact. */}
          <Button onClick={onOpenSettings} data-testid="open-settings">
            {t("noProjects.openSettings")}
            <DialogShortcutHint shortcut="Ctrl+Enter" />
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        <Trans
          ns="uiDialogs"
          i18nKey="noProjects.body"
          components={{ location: <span className="text-foreground" /> }}
        />
      </p>
    </DialogShell>
  );
}
