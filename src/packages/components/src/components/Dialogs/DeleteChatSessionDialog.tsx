import { useTranslation } from "@/i18n/uiPanels";
import { ConfirmDialog } from "./ConfirmDialog";

export interface DeleteChatSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The chat's own title. Blank or omitted, the question names "this chat session" instead, as V1
   * does when `session?.Title` is empty - a quoted fallback title would read as the chat's name.
   */
  sessionTitle?: string | null;
  onConfirm: () => void | Promise<void>;
  isBusy?: boolean;
  /** The daemon's refusal, shown where Delete was pressed; the dialog stays open for it. */
  error?: string | null;
}

/**
 * Deletes a chat. Port of V1 `Apps/Chat/Dialogs/DeleteSessionDialog.cs`, with its wording: "Delete
 * Session", and "Are you sure you want to delete "{title}"? This action cannot be undone."
 *
 * Changed, and why: V1 auto-focuses Delete and binds Enter to it. Here it goes through
 * `ConfirmDialog`, whose contract is that a destructive confirm is never the default focus - Enter
 * on a freshly opened dialog must not delete a conversation. A refusal is shown inline, because V2's
 * delete is a request that can fail (a chat still generating), where V1's was an in-process call.
 * V1's `.Width(Size.Rem(28))` has no step in `DIALOG_WIDTH`; `rem30` is the nearest.
 */
export function DeleteChatSessionDialog({
  isOpen,
  onClose,
  sessionTitle,
  onConfirm,
  isBusy,
  error,
}: DeleteChatSessionDialogProps) {
  const { t } = useTranslation("uiPanels");
  const title = sessionTitle?.trim();
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("deleteChatSession.title")}
      testId="chat-delete-session-dialog"
      width="rem30"
      body={
        <p>
          {title ? t("deleteChatSession.body", { title }) : t("deleteChatSession.bodyUntitled")}
        </p>
      }
      confirmLabel={t("deleteChatSession.confirm")}
      confirmVariant="destructive"
      onConfirm={onConfirm}
      isBusy={isBusy}
      error={error}
    />
  );
}
