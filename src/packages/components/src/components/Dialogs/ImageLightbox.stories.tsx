import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { ImageLightbox, type LightboxImage } from "./ImageLightbox";

/** An inline SVG, so the story needs no network and no file on disk. */
const svg = (width: number, height: number, label: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#14b8a6"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/>` +
      `<text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="${Math.round(height / 10)}" text-anchor="middle" dominant-baseline="middle">${label}</text>` +
      `</svg>`,
  )}`;

/**
 * Full-size view of a chat image attachment, opened from its thumbnail. V2 only.
 *
 * Not a `DialogShell`: no header or footer, and an overlay click closes it. The stories carry a
 * trigger standing in for the thumbnail, so focus return can be tried.
 */
const meta: Meta<typeof ImageLightbox> = {
  title: "Dialogs/ImageLightbox",
  component: ImageLightbox,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof ImageLightbox>;

function Trigger({ image }: { image: LightboxImage }) {
  const [open, setOpen] = React.useState<LightboxImage | null>(image);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setOpen(image)} data-testid="lightbox-story-trigger">
        Open the attachment
      </Button>
      <ImageLightbox image={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** A screenshot with its file name, which is what a pasted attachment carries. */
export const Default: Story = {
  render: () => (
    <Trigger image={{ url: svg(1280, 800, "screenshot.png"), title: "screenshot.png" }} />
  ),
};

/** No title: the accessible name falls back to "Image preview" and the caption row is empty. */
export const Untitled: Story = {
  render: () => <Trigger image={{ url: svg(800, 600, "untitled") }} />,
};

/** Taller than the window, to show it is fitted rather than cropped or scrolled. */
export const TallImage: Story = {
  render: () => (
    <Trigger
      image={{
        url: svg(600, 2400, "tall"),
        title: "a-very-long-file-name-from-a-phone-camera-IMG_20260922_164012_HDR.jpg",
      }}
    />
  ),
};
