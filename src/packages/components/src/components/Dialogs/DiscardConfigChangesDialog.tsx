import { useTranslation } from "@/i18n/uiSettings";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DiscardConfigChangesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Throws the unsaved edits away and reloads the file from disk. */
  onConfirm: () => void;
}

/**
 * The confirm in front of the `config.yaml` editor's *Reload* while it holds unsaved edits
 * (`ConfigEditorView` in the app, V1's `RawConfigEditorView.cs`).
 *
 * V1 reloads on the click and loses the edits silently. Reloading is the right answer to a stale
 * write, so it is still offered, but the thing at stake is the operator's own typing, which nothing
 * can bring back — hence a destructive confirm with Cancel focused, not a toast afterwards.
 */
export function DiscardConfigChangesDialog({
  isOpen,
  onClose,
  onConfirm,
}: DiscardConfigChangesDialogProps) {
  const { t } = useTranslation("uiSettings");
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("configEditor.discard.title")}
      testId="config-editor-reload-dialog"
      confirmLabel={t("configEditor.discard.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      body={<p>{t("configEditor.discard.body")}</p>}
    />
  );
}
