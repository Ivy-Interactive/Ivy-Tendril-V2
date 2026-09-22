import type { Meta, StoryObj } from "@storybook/react";
import { PartialDeliveryDialog } from "./PartialDeliveryDialog";
import { plan } from "./storyModels";

/**
 * Completes the plan while accepting that some verifications failed.
 *
 * Without the partial-delivery flag the same request is refused with a 409 listing the failures,
 * which is exactly what this dialog exists to acknowledge by name. V1 names it after what blocked
 * completion rather than after the override, and treats the override as destructive: it stamps a
 * plan as shipped incomplete, and duplicate detection reads that stamp afterwards.
 *
 * It renders only the `Fail` verifications, so the stories are about how many there are and what
 * the non-failing statuses do at the edges.
 */
const meta = {
  title: "Dialogs/Confirms/PartialDeliveryDialog",
  component: PartialDeliveryDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof PartialDeliveryDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The singular case. */
export const OneFailure: Story = {
  args: {
    plan: plan({
      state: "Review",
      verifications: [
        { name: "RustClippy", status: "Fail" },
        { name: "NpmTest", status: "Pass" },
      ],
    }),
  },
};

/** The plural case, and whether the list stays readable at three. */
export const SeveralFailures: Story = {
  args: {
    plan: plan({
      state: "Review",
      verifications: [
        { name: "RustClippy", status: "Fail" },
        { name: "RustTest", status: "Fail" },
        { name: "NpmTest", status: "Fail" },
      ],
    }),
  },
};

/** All nine of this repository's verifications failing: whether the list scrolls or grows. */
export const EveryVerificationFailing: Story = {
  args: {
    plan: plan({
      state: "Review",
      verifications: [
        { name: "NpmBuild", status: "Fail" },
        { name: "NpmLint", status: "Fail" },
        { name: "NpmTest", status: "Fail" },
        { name: "RustBuild", status: "Fail" },
        { name: "RustClippy", status: "Fail" },
        { name: "RustFormat", status: "Fail" },
        { name: "RustTest", status: "Fail" },
        { name: "Screenshots", status: "Fail" },
        { name: "CheckResult", status: "Fail" },
      ],
    }),
  },
};

/** The realistic case: most pass, one or two do not, and only the failures are the point. */
export const MixedPassAndFail: Story = {
  args: {
    plan: plan({
      state: "Review",
      verifications: [
        { name: "NpmBuild", status: "Pass" },
        { name: "NpmTest", status: "Pass" },
        { name: "RustClippy", status: "Fail" },
        { name: "Screenshots", status: "Skipped" },
      ],
    }),
  },
};

/**
 * A verification that does not apply is marked Skipped rather than dropped, and Skipped is not a
 * failure to acknowledge — so this dialog has nothing to list.
 */
export const SkippedNotFailed: Story = {
  args: {
    plan: plan({
      state: "Review",
      verifications: [
        { name: "Screenshots", status: "Skipped" },
        { name: "NpmTest", status: "Pass" },
      ],
    }),
  },
};

/** A plan carrying none at all. The dialog still has to say something coherent. */
export const NoVerifications: Story = {
  args: { plan: plan({ state: "Review", verifications: [] }) },
};

/** A verification that never ran: neither a pass to rely on nor a failure to acknowledge. */
export const PendingVerification: Story = {
  args: {
    plan: plan({
      state: "Review",
      verifications: [
        { name: "RustTest", status: "Pending" },
        { name: "NpmTest", status: "Fail" },
      ],
    }),
  },
};
