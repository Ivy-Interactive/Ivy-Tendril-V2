import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import {
  VerificationReportSheet,
  type VerificationReportSheetProps,
} from "./VerificationReportSheet";

/**
 * V1's `Apps/Views/Sheets/VerificationReportSheet.cs`: a verification's markdown report, opened from
 * the verification rows on the plan and review pages.
 *
 * Each story opens on a real trigger, because the sheet is only ever seen sliding over a page. The
 * props are the read's state as the app's wrapper passes it: loading, failed, answered, or answered
 * with nothing.
 */
const meta: Meta<typeof VerificationReportSheet> = {
  title: "Sheets/VerificationReportSheet",
  component: VerificationReportSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof VerificationReportSheet>;

function Trigger(
  props: Omit<VerificationReportSheetProps, "verificationName" | "onClose"> & {
    name: string;
  },
) {
  const { name, ...rest } = props;
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" onClick={() => setOpen(true)}>
        View {name} report
      </Button>
      <VerificationReportSheet
        {...rest}
        verificationName={open ? name : null}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

const PASS_REPORT = `---
result: Pass
date: 2026-09-22T10:16:56Z
---

# CheckResult

All requirements in the plan have been met.

| Requirement | Evidence |
|---|---|
| Sheets own their panel | \`JobDebugSheet.tsx\` wraps its body in \`<Sheet>\` |
| Stories carry a trigger | every \`Sheets/*.stories.tsx\` renders a button |
`;

/** A passing report: the badge, the date in the header, and the markdown body. */
export const Passed: Story = {
  render: () => (
    <Trigger
      name="CheckResult"
      report={{
        name: "CheckResult",
        result: "Pass",
        date: "2026-09-22T10:16:56Z",
        content: PASS_REPORT,
      }}
    />
  ),
};

/** A failure, whose report is the reason anyone opens this sheet. */
export const Failed: Story = {
  render: () => (
    <Trigger
      name="RustTest"
      report={{
        name: "RustTest",
        result: "Fail",
        date: "2026-09-22T11:02:40Z",
        content:
          "# RustTest\n\n2 tests failed.\n\n```text\n---- plans::review::reads_artifact stdout ----\nthread 'main' panicked at 'assertion failed: resolved.starts_with(&artifacts_dir)'\n```\n",
      }}
    />
  ),
};

/** The read still out: the badge shows the status `plan.yaml` already has. */
export const Loading: Story = {
  render: () => <Trigger name="DotnetTest" initialStatus="Pending" loading />,
};

/** The report file is not on disk yet. */
export const ReadFailed: Story = {
  render: () => (
    <Trigger
      name="NpmLint"
      initialStatus="Fail"
      error="Verification report 'NpmLint' not found in /home/dev/.tendril/Plans/00412-SplitTheConnectedDialogs/Verification"
    />
  ),
};

/** The read answered with nothing at all. */
export const Empty: Story = {
  render: () => <Trigger name="RustClippy" initialStatus="Skipped" report={null} />,
};

/** A long report scrolls under a header that stays put. */
export const LongReport: Story = {
  render: () => (
    <Trigger
      name="CheckResult"
      report={{
        name: "CheckResult",
        result: "Pass",
        date: "2026-09-22T10:16:56Z",
        content: Array.from(
          { length: 40 },
          (_, i) => `## Requirement ${i + 1}\n\nMet: see \`src/views/sheets\` line ${i * 7 + 3}.\n`,
        ).join("\n"),
      }}
    />
  ),
};
