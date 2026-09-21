import React from "react";
import { IconButton } from "@ivy-interactive/components/ui";
import { Paperclip, X } from "lucide-react";
import { isImageAttachment, useAttachmentPreview } from "../../hooks/useAttachmentPreview";
import type { ChatAttachment } from "../../types/chat";

/**
 * An attached file as it looks in the composer, before the turn goes out.
 *
 * Ported from `ComposerAttachmentCard` in
 * `Ivy-Tendril/src/Ivy.Tendril.Widgets/frontend/src/ChatWidget/attachments.tsx`. V1 shows the picture
 * itself here, and the thread already did in V2 — the composer was the one place an attachment was
 * only ever a paperclip and a file name, which left "did I pick the right screenshot?" unanswerable
 * until after it had been sent.
 *
 * Two differences from V1, both deliberate. It does not render PDFs: V1 draws their first page on a
 * canvas with `pdfjs-dist`, which is not a dependency of this app and cannot become one eagerly while
 * the entry chunk sits at 94% of its budget. And it carries no upload progress or failure state,
 * because staging here is a local file copy that the chip already reflects by re-pointing at the
 * staged path — there is no upload bar to show.
 */

export interface ComposerAttachmentProps {
  attachment: ChatAttachment;
  /**
   * The file is still being copied into the attachment directory, so its path is the one the user
   * picked it by and the daemon will not serve it yet. Asking anyway would cache a refusal against
   * that path and the thumbnail would never appear.
   */
  isStaging?: boolean;
  onRemove: () => void;
}

export const ComposerAttachment: React.FC<ComposerAttachmentProps> = ({
  attachment,
  isStaging = false,
  onRemove,
}) => {
  const isImage = isImageAttachment(attachment);
  const { url } = useAttachmentPreview(attachment.path, isImage && !isStaging);

  /* V1's card puts its remove affordance in a `Tooltip` too — `.chat-thumbnail-card-remove` in
     `Ivy-Tendril/src/Ivy.Tendril.Widgets/frontend/src/ChatWidget/attachments.tsx`. The file name goes
     in the accessible name rather than the tooltip, because two chips in a row otherwise offer the
     same "Remove file" and there is no way to tell which is which. */
  const remove = (
    <IconButton
      label={`Remove ${attachment.name}`}
      size="xs"
      variant="danger"
      tone="muted"
      onClick={onRemove}
    >
      <X className="size-3" />
    </IconButton>
  );

  // A refused image falls back to the chip rather than to a broken-image icon: the file is still
  // attached and still going to the agent, and the daemon deliberately does not say whether it was
  // outside the allowed roots or simply gone, so there is nothing more honest to show. The same
  // fallback covers the window between attaching a file and its copy landing somewhere servable.
  if (!isImage || !url) {
    return (
      <div
        className="flex max-w-full items-center gap-1.5 rounded-selector bg-background px-1.5 py-1 text-foreground"
        title={attachment.path}
      >
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="max-w-[220px] truncate">{attachment.name}</span>
        {remove}
      </div>
    );
  }

  return (
    <div
      className="flex max-w-full items-center gap-1.5 rounded-selector bg-background py-1 pl-1 pr-1.5 text-foreground"
      title={attachment.path}
    >
      <img
        data-testid="composer-attachment-preview"
        src={url}
        alt={attachment.name}
        className="size-8 shrink-0 rounded-selector object-cover"
      />
      <span className="max-w-[220px] truncate">{attachment.name}</span>
      {remove}
    </div>
  );
};
