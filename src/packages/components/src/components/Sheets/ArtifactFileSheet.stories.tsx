import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { ArtifactFileSheet, type ArtifactFileSheetProps } from "./ArtifactFileSheet";

const PLAN_FOLDER = "/home/dev/.tendril/Plans/00412-SplitTheConnectedDialogs";
const ARTIFACTS = `${PLAN_FOLDER}/Artifacts`;

/** An inline SVG standing in for a screenshot, so the image story needs no network. */
const PNG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#1f2937"/><text x="320" y="190" font-size="32" fill="#e5e7eb" text-anchor="middle">home.png</text></svg>',
  );

/**
 * The Review app's artifact sheet (V1 `Review/ContentView.cs:464`): a file from the plan's
 * `Artifacts` folder, rendered by type.
 *
 * Each story opens on a real trigger. The props are the read's outcome as the app's wrapper passes
 * it, so every state the daemon can answer with has a story.
 */
const meta: Meta<typeof ArtifactFileSheet> = {
  title: "Sheets/ArtifactFileSheet",
  component: ArtifactFileSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof ArtifactFileSheet>;

function Trigger(props: Omit<ArtifactFileSheetProps, "path" | "onClose"> & { path: string }) {
  const { path, ...rest } = props;
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open {path.split("/").pop()}
      </Button>
      <ArtifactFileSheet
        planFolderPath={PLAN_FOLDER}
        onReveal={() => {}}
        {...rest}
        path={open ? path : null}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

/** A log, highlighted and soft-wrapped. */
export const TextLog: Story = {
  render: () => (
    <Trigger
      path={`${ARTIFACTS}/build.log`}
      read={{
        status: "loaded",
        content: {
          kind: "text",
          text: "[09:14:02] cargo build --workspace\n[09:15:40] Finished dev [unoptimized + debuginfo]\n[09:15:41] all 42 tests passed",
          size: 112,
        },
      }}
    />
  ),
};

/** JSON, highlighted with its indentation kept. */
export const Json: Story = {
  render: () => (
    <Trigger
      path={`${ARTIFACTS}/results.json`}
      read={{
        status: "loaded",
        content: {
          kind: "text",
          text: JSON.stringify({ passed: 42, failed: 0, skipped: ["flaky::network"] }, null, 2),
          size: 72,
        },
      }}
    />
  ),
};

/** Markdown renders as markdown; its relative links stay inside the sheet. */
export const Markdown: Story = {
  render: () => (
    <Trigger
      path={`${ARTIFACTS}/notes.md`}
      onOpenArtifact={() => {}}
      read={{
        status: "loaded",
        content: {
          kind: "text",
          text: "# Release notes\n\nShipped the operator view. See [the build log](build.log).\n\n- Sheets own their panel\n- Stories carry a trigger\n",
          size: 120,
        },
      }}
    />
  ),
};

/** A screenshot, read through the guarded local-file route. */
export const Image: Story = {
  render: () => <Trigger path={`${ARTIFACTS}/screenshots/home.png`} image={{ url: PNG }} />,
};

/** The read still out. */
export const Loading: Story = {
  render: () => <Trigger path={`${ARTIFACTS}/build.log`} read={{ status: "loading" }} />,
};

/** A file with nothing to show inline offers its folder instead. */
export const Binary: Story = {
  render: () => (
    <Trigger
      path={`${ARTIFACTS}/bundle.zip`}
      read={{ status: "loaded", content: { kind: "binary", size: 2048 } }}
    />
  ),
};

/** Over the daemon's preview cap. */
export const TooLarge: Story = {
  render: () => (
    <Trigger
      path={`${ARTIFACTS}/trace.log`}
      read={{ status: "loaded", content: { kind: "tooLarge", size: 5 * 1024 * 1024 } }}
    />
  ),
};

/** Past the highlight limit: shown plain, with a note saying why. */
export const PlainPastLimit: Story = {
  render: () => (
    <Trigger
      path={`${ARTIFACTS}/results.json`}
      read={{
        status: "loaded",
        content: { kind: "text", text: `{"results": [${"0,".repeat(400)}0]}`, size: 70_000 },
      }}
    />
  ),
};

/** The daemon refused the read: the path is outside the plan's `Artifacts` folder. */
export const Refused: Story = {
  render: () => (
    <Trigger
      path="/etc/hosts"
      read={{ status: "failed", error: "'/etc/hosts' is not in the plan's Artifacts folder" }}
    />
  ),
};

/** A refused reveal is said above the file rather than swallowed. */
export const ActionError: Story = {
  render: () => (
    <Trigger
      path={`${ARTIFACTS}/build.log`}
      actionError="opener.reveal_item_in_dir not allowed"
      read={{ status: "loaded", content: { kind: "text", text: "build ok", size: 8 } }}
    />
  ),
};
