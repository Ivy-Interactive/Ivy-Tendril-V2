import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { EditProjectMemorySheet, type EditProjectMemorySheetProps } from "./EditProjectMemorySheet";

const STACK_MD = `# Stack

- Rust daemon (axum) in \`src/crates/tendril-server\`
- Tauri 2 shell in \`src/apps/tendril-app/src-tauri\`
- React 19 + Vite+ for the webview; components live in \`src/packages/components\`

## Conventions

- Comments cite the V1 file and line they port.
- Every user-visible string goes through the i18n catalogs (10 locales).
`;

/**
 * V1's `Apps/Settings/Sheets/EditProjectMemorySheet.cs`: add or edit one markdown memory file of a
 * project. Opened from the project settings' memory table — *Add Project Memory* or a row's *Edit*.
 *
 * Each story renders the real trigger, because a sheet on its own shows something the app never
 * displays: it always slides over the Settings page.
 */
const meta: Meta<typeof EditProjectMemorySheet> = {
  title: "Sheets/EditProjectMemorySheet",
  component: EditProjectMemorySheet,
  parameters: { layout: "padded" },
  args: { projectName: "Ivy-Tendril-V2", onSave: () => {} },
};

export default meta;
type Story = StoryObj<typeof EditProjectMemorySheet>;

function WithTrigger({
  label,
  ...props
}: Omit<EditProjectMemorySheetProps, "open" | "onClose"> & { label: string }) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="memory-story-trigger">
        {label}
      </Button>
      <EditProjectMemorySheet {...props} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** *Add Project Memory*: V1's default name, an empty body. */
export const AddNew: Story = {
  render: (args) => <WithTrigger {...args} label="Add Project Memory" existingFileName={null} />,
};

/** A row's *Edit*, once the file has been read. */
export const EditExisting: Story = {
  render: (args) => (
    <WithTrigger
      {...args}
      label="Edit stack.md"
      existingFileName="stack.md"
      initialContent={STACK_MD}
    />
  ),
};

/** The host is still reading the file. */
export const LoadingContent: Story = {
  render: (args) => (
    <WithTrigger {...args} label="Edit stack.md" existingFileName="stack.md" isLoading />
  ),
};

/** The write is in flight; Save is disabled so a double click writes once. */
export const Saving: Story = {
  render: (args) => (
    <WithTrigger
      {...args}
      label="Edit stack.md"
      existingFileName="stack.md"
      initialContent={STACK_MD}
      isSaving
    />
  ),
};

/** The daemon refused (here: a rename onto a file that exists); the typed content stays. */
export const SaveRefused: Story = {
  render: (args) => (
    <WithTrigger
      {...args}
      label="Edit stack.md"
      existingFileName="stack.md"
      initialContent={STACK_MD}
      error="A memory file named 'conventions.md' already exists in project 'Ivy-Tendril-V2'"
    />
  ),
};

/** A long file, which scrolls inside the sheet rather than widening it. */
export const LongContent: Story = {
  render: (args) => (
    <WithTrigger
      {...args}
      label="Edit conventions.md"
      existingFileName="conventions.md"
      initialContent={Array.from({ length: 12 }, () => STACK_MD).join("\n")}
    />
  ),
};
