import type { Meta, StoryObj } from "@storybook/react";
import { PartialDeliveryDialog } from "./PlanConfirmDialogs";

/**
 * Completes the plan while accepting that some verifications failed.
 *
 * Without the partial-delivery flag the same request is refused with a 409 listing the failures,
 * which is exactly what this acknowledges by name before sending it. V1 names the dialog after what
 * blocked completion rather than after the override, and treats the override as destructive: it
 * stamps a plan as shipped incomplete, and duplicate detection reads that stamp afterwards.
 */
const meta: Meta<typeof PartialDeliveryDialog> = {
  title: "Dialogs/PartialDeliveryDialog",
  component: PartialDeliveryDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onConfirm: () => {}, planId: "00412" },
};

export default meta;
type Story = StoryObj<typeof PartialDeliveryDialog>;

/** The singular case. */
export const OneFailure: Story = { args: { failedVerifications: ["RustClippy"] } };

/** The plural case, and whether the list stays readable at three. */
export const SeveralFailures: Story = {
  args: { failedVerifications: ["RustClippy", "RustTest", "NpmTest"] },
};

/** All nine of this repository's verifications failing: whether the list scrolls or grows. */
export const EveryVerificationFailing: Story = {
  args: {
    failedVerifications: [
      "NpmBuild",
      "NpmLint",
      "NpmTest",
      "RustBuild",
      "RustClippy",
      "RustFormat",
      "RustTest",
      "Screenshots",
      "CheckResult",
    ],
  },
};

/** A plan carrying none. The dialog still has to say something coherent. */
export const NoFailures: Story = { args: { failedVerifications: [] } };

/** The 409 the flag exists to get past, arriving anyway. */
export const Refused: Story = {
  args: {
    failedVerifications: ["RustClippy"],
    error: "Plan 00412 has failing verifications and partial delivery was not accepted.",
  },
};
