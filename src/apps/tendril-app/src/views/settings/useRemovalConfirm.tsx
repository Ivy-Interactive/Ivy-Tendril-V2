import React from "react";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";

/** What is about to be removed, and what to do once the operator says yes. */
export interface RemovalRequest {
  /**
   * What the thing is, in the words the section uses for it — "level", "review action",
   * "environment file". Lower case: it is used mid-sentence.
   */
  kind: string;
  /** The entry's own name or path, quoted back so the operator can see they picked the right row. */
  name: string;
  /**
   * What is lost beyond the entry itself, when anything is. Nothing here means the entry is the whole
   * story, and the dialog says only that it is removed from the configuration.
   */
  consequence?: React.ReactNode;
  onConfirm: () => void;
}

/**
 * The confirm every destructive row action in Settings goes through.
 *
 * Framework's rule, from `Ivy-Framework/src/claude-plugin/skills/ivy-create-app/references/
 * DesignGuidelines.md:147`: "Confirm destructive actions: Use `.WithConfirm()` — **never delete on
 * single click**." Every `Delete` row action here used to write `config.yaml` on the click itself,
 * with no way back and no undo.
 *
 * It composes the same `ConfirmDialog` as the plan and job deletes, so the contract is identical:
 * Cancel first and focused, the destructive confirm last, nothing to type, Escape cancels, a click
 * outside does not dismiss.
 *
 * The copy is deliberately lighter than a plan deletion's. These are configuration entries — a level
 * or a skill reference can be added straight back from the same screen — so the body says what is
 * removed and where from, and does not borrow the language of something irreversible. Where removal
 * *does* reach further than the row (a review action's run order, an env file's variables), the
 * caller says so in `consequence`.
 *
 * Deliberately not a dialog *file* per section: `LevelsSection` notes that this area owns no dialog
 * files, and six near-identical ones would be six chances to drift apart.
 */
export function useRemovalConfirm(): {
  /** Opens the confirm. The action runs only if it is confirmed. */
  requestRemoval: (request: RemovalRequest) => void;
  /** Render once, anywhere in the section. */
  removalDialog: React.ReactNode;
} {
  const [request, setRequest] = React.useState<RemovalRequest | null>(null);

  const close = () => setRequest(null);

  const removalDialog = request ? (
    <ConfirmDialog
      isOpen
      onClose={close}
      // Framework's own titles are `Delete {Entity}` (`ProductsApp.cs:176`), capitalised.
      title={`Remove ${request.kind.replace(/^./, (c) => c.toUpperCase())}`}
      testId="settings-remove-dialog"
      confirmLabel="Remove"
      confirmVariant="destructive"
      onConfirm={() => {
        // Closed first: the write is synchronous from here and the dialog has nothing left to report.
        close();
        request.onConfirm();
      }}
      body={
        <>
          <p>
            Remove {request.kind} <span className="text-foreground">{request.name}</span> from this
            configuration?
          </p>
          {request.consequence !== undefined && (
            <p className="text-muted-foreground">{request.consequence}</p>
          )}
        </>
      }
    />
  ) : null;

  return { requestRemoval: setRequest, removalDialog };
}
