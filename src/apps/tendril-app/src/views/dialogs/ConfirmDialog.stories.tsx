import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "@ivy-interactive/components/ui";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The shared primitive the four confirm dialogs are built on.
 *
 * Its stories are about *states* rather than content — busy, error, disabled, secondary action.
 * Each is one prop, and each is the kind of thing that renders correctly in isolation and wrongly
 * in combination, which is exactly what a story catalog is for.
 */
const meta = {
  title: "Dialogs/Confirms/ConfirmDialog",
  component: ConfirmDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onConfirm: () => {},
    title: "Delete this plan?",
    body: "The plan folder, its revisions and its worktrees are removed. This cannot be undone.",
    confirmLabel: "Delete Plan",
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default shape: Cancel outline first, the destructive confirm last, nothing to type. */
export const Destructive: Story = {
  args: { confirmVariant: "destructive" },
};

/** The middle variant, for a consequence that is serious but recoverable. */
export const Warning: Story = {
  args: {
    title: "Reset to Draft?",
    body: "The plan returns to Draft and its worktrees are removed.",
    confirmLabel: "Reset to Draft",
    confirmVariant: "warning",
  },
};

/** The non-destructive variant, where confirming is the ordinary answer. */
export const Primary: Story = {
  args: {
    title: "Complete this plan?",
    body: "The plan is marked Completed.",
    confirmLabel: "Complete",
    confirmVariant: "primary",
  },
};

/** Mid-request: the confirm is disabled and says so, so a second click cannot double-send. */
export const Busy: Story = {
  args: { confirmVariant: "destructive", isBusy: true },
};

/** The error renders where the operator pressed the button, not as a toast that can be missed. */
export const BackendRejection: Story = {
  args: {
    confirmVariant: "destructive",
    error: "Plan 00412 is held by a running job (#1184) and cannot be deleted.",
  },
};

/** A precondition is unmet, so the action stays visible but refused rather than hidden. */
export const ConfirmDisabled: Story = {
  args: {
    title: "Delete this project?",
    body: "Type the project name to confirm.",
    confirmLabel: "Delete Project",
    confirmVariant: "destructive",
    confirmDisabled: true,
  },
};

/**
 * A non-destructive alternative between Cancel and the confirm — the shape `DeletePlanDialog` uses
 * to offer Icebox instead of deletion.
 */
export const WithSecondaryAction: Story = {
  args: {
    confirmVariant: "destructive",
    secondaryAction: (
      <Button variant="outline" onClick={() => {}}>
        Move to Icebox
      </Button>
    ),
  },
};

/**
 * `body` is a ReactNode, not a string: a consequence with structure still has to lay out inside the
 * dialog's width.
 */
export const RichBody: Story = {
  args: {
    title: "Complete with failed verifications?",
    confirmLabel: "Complete Anyway",
    confirmVariant: "warning",
    body: (
      <div className="space-y-2">
        <p>These verifications did not pass:</p>
        <ul className="list-disc pl-5 font-mono text-xs">
          <li>RustClippy</li>
          <li>NpmTest</li>
        </ul>
      </div>
    ),
  },
};
