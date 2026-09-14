import React from "react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@ivy-interactive/components/ui";
import { X } from "lucide-react";

export interface LightboxImage {
  /** A URL the webview can load — a local path must already be through `convertFileSrc`. */
  url: string;
  title?: string;
}

export interface ImageLightboxProps {
  image: LightboxImage | null;
  onClose: () => void;
}

/**
 * Full-size view of an image attachment. Radix's Dialog supplies the focus trap, Escape-to-close
 * and focus return to the thumbnail that opened it, so none of that is hand-rolled here.
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({ image, onClose }) => (
  <Dialog
    open={image !== null}
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
  >
    <DialogContent
      data-testid="image-lightbox"
      aria-label={image?.title || "Image preview"}
      className="max-w-[90vw] gap-2 border-border bg-popover p-3 text-popover-foreground"
    >
      <DialogTitle className="sr-only">{image?.title || "Image preview"}</DialogTitle>
      {image && (
        <img
          src={image.url}
          alt={image.title || "Attachment preview"}
          className="max-h-[85vh] max-w-[90vw] object-contain"
        />
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{image?.title}</span>
        <DialogClose
          data-testid="image-lightbox-close"
          aria-label="Close preview"
          className="flex shrink-0 items-center gap-1 rounded-selector px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" aria-hidden="true" />
          <span>Close</span>
        </DialogClose>
      </div>
    </DialogContent>
  </Dialog>
);

export default ImageLightbox;
