import { X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "../ui/dialog";
import { useTranslation } from "@/i18n/uiPanels";

export interface LightboxImage {
  /**
   * A URL the webview can load. A file on this machine is not one: in the app the thumbnail that
   * opens the lightbox has already resolved its path to a `data:` URL through the daemon's
   * `/ivy/local-file` guard, and passes that same URL here, so the full-size view costs no second
   * read and cannot show an image the guard refused.
   */
  url: string;
  title?: string;
}

export interface ImageLightboxProps {
  /** The image to show, or `null` for closed. */
  image: LightboxImage | null;
  onClose: () => void;
}

/**
 * Full-size view of a chat image attachment, opened from its thumbnail. V2 only: V1's chat widget
 * opens an attachment in the browser instead.
 *
 * Deliberately not a `DialogShell`: it has no question, no header and no footer, only the image and
 * a close control under it. Radix's `Dialog` still supplies the focus trap, Escape-to-close and focus
 * return to the thumbnail that opened it, so none of that is hand-rolled here - and unlike a
 * `DialogShell`, a click on the overlay closes it, because there is nothing in it to lose.
 */
export function ImageLightbox({ image, onClose }: ImageLightboxProps) {
  const { t } = useTranslation("uiPanels");
  const label = image?.title || t("lightbox.fallbackTitle");
  return (
    <Dialog
      open={image !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="image-lightbox"
        aria-label={label}
        className="max-w-[90vw] gap-2 border-border bg-popover p-3 text-popover-foreground"
      >
        <DialogTitle className="sr-only">{label}</DialogTitle>
        {image && (
          <img
            src={image.url}
            alt={image.title || t("lightbox.fallbackAlt")}
            className="max-h-[85vh] max-w-[90vw] object-contain"
          />
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{image?.title}</span>
          <DialogClose
            data-testid="image-lightbox-close"
            aria-label={t("lightbox.closeLabel")}
            className="flex shrink-0 items-center gap-1 rounded-selector px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden="true" />
            <span>{t("lightbox.close")}</span>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
