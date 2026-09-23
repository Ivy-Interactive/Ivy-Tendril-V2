import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { FileSheet, type FileSheetProps } from "./FileSheet";

const REPO = "/home/dev/repos/Ivy-Tendril-V2/src";

/** An inline SVG standing in for a screenshot, so the image story needs no network. */
const IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#0f172a"/><text x="320" y="190" font-size="32" fill="#e2e8f0" text-anchor="middle">wireframe.png</text></svg>',
  );

/**
 * V1's `Apps/Views/Sheets/FileSheet.cs`: a local file a plan's markdown links to (`file:///…`),
 * opened beside the plan. Code is highlighted, markdown rendered, images shown.
 *
 * Each story opens on a real trigger - in the app the trigger is a link in the plan document.
 */
const meta: Meta<typeof FileSheet> = {
  title: "Sheets/FileSheet",
  component: FileSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof FileSheet>;

function Trigger(props: Omit<FileSheetProps, "path" | "onClose"> & { path: string }) {
  const { path, ...rest } = props;
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <p className="text-sm">
        The plan says: see{" "}
        <button type="button" className="text-primary underline" onClick={() => setOpen(true)}>
          {path.split("/").pop()}
        </button>
        .
      </p>
      <FileSheet
        onReveal={() => {}}
        {...rest}
        path={open ? path : null}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

const CODE = `export function SheetPanel({ open, onClose, title }: SheetPanelProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className={SHEET_PANEL_CLASS}>{title}</SheetContent>
    </Sheet>
  );
}
`;

/** A source file from the plan's repo, highlighted by its extension. */
export const Code: Story = {
  render: () => (
    <Trigger
      path={`${REPO}/packages/components/src/components/ui/sheet-panel.tsx`}
      read={{ status: "loaded", content: { kind: "text", text: CODE, size: CODE.length } }}
    />
  ),
};

/**
 * With V1's **Open in {editor}** button. It shows only when the host can launch an editor; the app
 * has no editor launcher yet, so in the app this button is absent.
 */
export const WithEditor: Story = {
  render: () => (
    <Trigger
      path={`${REPO}/packages/components/src/components/ui/sheet-panel.tsx`}
      editorLabel="VS Code"
      onOpenInEditor={() => {}}
      read={{ status: "loaded", content: { kind: "text", text: CODE, size: CODE.length } }}
    />
  ),
};

/** A markdown file renders as a document. */
export const Markdown: Story = {
  render: () => (
    <Trigger
      path={`${REPO}/apps/tendril-app/docs/i18n.md`}
      onOpenFile={() => {}}
      read={{
        status: "loaded",
        content: {
          kind: "text",
          text: "# Localization (i18n)\n\nTen locales. English is the source language.\n\n| Code | Name |\n|---|---|\n| `en` | English |\n| `de` | Deutsch |\n",
          size: 140,
        },
      }}
    />
  ),
};

/** An image link opens the image. */
export const Image: Story = {
  render: () => <Trigger path={`${REPO}/../docs/wireframe.png`} image={{ url: IMAGE }} />,
};

/** The read still out. */
export const Loading: Story = {
  render: () => <Trigger path={`${REPO}/Cargo.toml`} read={{ status: "loading" }} />,
};

/** V1's "File not found.": the link points at a file that is not there, or not one the app may read. */
export const NotFound: Story = {
  render: () => (
    <Trigger
      path={`${REPO}/does/not/exist.rs`}
      editorLabel="VS Code"
      onOpenInEditor={() => {}}
      read={{ status: "failed", error: "File not found." }}
    />
  ),
};

/** A binary file has no preview and offers its folder. */
export const Binary: Story = {
  render: () => (
    <Trigger
      path={`${REPO}/apps/tendril-app/src-tauri/icons/icon.icns`}
      read={{ status: "loaded", content: { kind: "binary", size: 312_455 } }}
    />
  ),
};

/** A refused editor launch is said above the file. */
export const ActionError: Story = {
  render: () => (
    <Trigger
      path={`${REPO}/Cargo.toml`}
      editorLabel="Cursor"
      onOpenInEditor={() => {}}
      actionError="'cursor' not found in PATH."
      read={{
        status: "loaded",
        content: { kind: "text", text: '[workspace]\nmembers = ["crates/*"]\n', size: 36 },
      }}
    />
  ),
};
