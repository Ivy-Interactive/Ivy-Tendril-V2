import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Copy, FolderOpen } from "lucide-react";
import { SheetPanel } from "@/components/ui/sheet-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";

/**
 * `SheetPanel`: the app's right-hand detail sheet, at V1's `UxHelper.SheetWidth`. Each story opens
 * it from a button, as the app does, so the width ladder, the single rule under the header and the
 * header's line-up with the close button are the real ones.
 */
const meta: Meta<typeof SheetPanel> = {
  title: "UI/SheetPanel",
  component: SheetPanel,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof SheetPanel>;

const LOG = Array.from(
  { length: 80 },
  (_, i) => `[2026-09-22T10:${String(i % 60).padStart(2, "0")}:00Z] INFO step ${i}: build ok`,
).join("\n");

function Host(props: Omit<React.ComponentProps<typeof SheetPanel>, "open" | "onClose">) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open
      </Button>
      <SheetPanel {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** An artifact: file name, its place in the plan, and header actions beside the close button. */
export const WithActions: Story = {
  render: () => (
    <Host
      title="output.log"
      description={<span className="font-mono">Artifacts/output.log</span>}
      actions={
        <>
          <IconButton label="Copy path" size="md" tone="muted">
            <Copy className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton label="Show in folder" size="md" tone="muted">
            <FolderOpen className="size-4" aria-hidden="true" />
          </IconButton>
        </>
      }
    >
      <pre className="whitespace-pre-wrap font-mono text-xs">{LOG}</pre>
    </Host>
  ),
};

/** A verification report: a status badge beside the title, and text in the actions slot. */
export const WithBadge: Story = {
  render: () => (
    <Host
      title="RustTest"
      description="Verification report details for RustTest"
      hideDescription
      titleAccessory={<Badge variant="destructive">Fail</Badge>}
      actions={
        <span className="font-mono text-xs text-muted-foreground">2026-09-07T10:41:11Z</span>
      }
    >
      <p>2 tests failed: dto_mapping, revision_diff</p>
    </Host>
  ),
};
