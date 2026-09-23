import { Paperclip, X } from "lucide-react";
import { Button } from "../ui/button";
import { useTranslation } from "@/i18n/uiDialogs";

/** A file attached to a dialog's request, as the caller staged it. */
export interface DialogAttachment {
  /** The name the operator picked the file by. */
  name: string;
  /** Where it was staged - what the request's ` [file: …]` reference will name. */
  path: string;
}

/**
 * The attachment half of the props a request dialog takes. Every field is optional and nothing is
 * rendered without `onAttachFiles`, so a caller that cannot stage files keeps the dialog it had.
 */
export interface DialogAttachmentProps {
  attachments?: DialogAttachment[];
  /** Opens the caller's file picker. The caller stages what is picked and passes it back. */
  onAttachFiles?: () => void;
  onRemoveAttachment?: (path: string) => void;
  /** A pick is being staged. */
  isAttaching?: boolean;
  /** Why the last pick could not be attached. */
  attachError?: string | null;
}

/**
 * The attach control and chip strip under a request field: V1 puts a `ContentInput` with uploads in
 * `UpdatePlanDialog` and `SuggestChangesDialog`, whose upload handler stages each file into
 * `Attachments/<uploadSessionId>/` and appends ` [file: <path>]` to the text. The field stays a
 * textarea here; the attachments are the part of `ContentInput` these dialogs were missing.
 */
export function DialogAttachments({
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
  isAttaching = false,
  attachError,
  disabled = false,
}: DialogAttachmentProps & { disabled?: boolean }) {
  const { t } = useTranslation("uiDialogs");
  if (!onAttachFiles) return null;

  return (
    <div className="mt-3" data-testid="dialog-attachments">
      {attachments.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1" aria-label={t("attachments.label")}>
          {attachments.map((file) => (
            <li
              key={file.path}
              className="flex items-center gap-1 rounded-selector border border-border px-2 py-0.5 text-xs text-foreground"
              title={file.path}
            >
              <Paperclip className="size-3 text-muted-foreground" aria-hidden />
              <span className="max-w-48 truncate">{file.name}</span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  className="rounded-selector p-0.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  aria-label={t("attachments.remove", { name: file.name })}
                  onClick={() => onRemoveAttachment(file.path)}
                  disabled={disabled}
                >
                  <X className="size-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAttachFiles}
        disabled={disabled || isAttaching}
        data-testid="dialog-attach-files"
      >
        <Paperclip className="size-4" aria-hidden />
        {isAttaching ? t("attachments.attaching") : t("attachments.attach")}
      </Button>
      {attachError && (
        <p className="mt-1 text-xs text-destructive" data-testid="dialog-attach-error">
          {attachError}
        </p>
      )}
    </div>
  );
}
