import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import {
  CommitDetailSheet,
  type CommitDetail,
  type CommitDetailSheetProps,
} from "./CommitDetailSheet";

const HASH = "3f9c2a1be8d04c7f9a61e2b35d7c0a4e91f8b6d2";

/**
 * V1's `Apps/Views/Sheets/CommitDetailSheet.cs`: one of a plan's commits, opened from the Git tab's
 * commit table or the Details tab's commit list.
 *
 * Each story opens on a real trigger, the way the app opens it: a click on the short hash.
 */
const meta: Meta<typeof CommitDetailSheet> = {
  title: "Sheets/CommitDetailSheet",
  component: CommitDetailSheet,
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj<typeof CommitDetailSheet>;

function Trigger(props: Omit<CommitDetailSheetProps, "hash" | "onClose"> & { hash?: string }) {
  const { hash = HASH, ...rest } = props;
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-48 flex-col items-start gap-3">
      <Button variant="outline" className="font-mono" onClick={() => setOpen(true)}>
        {hash.slice(0, 7)}
      </Button>
      <CommitDetailSheet {...rest} hash={open ? hash : null} onClose={() => setOpen(false)} />
    </div>
  );
}

const SHEET_DIFF = `diff --git a/src/components/Sheets/index.ts b/src/components/Sheets/index.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/components/Sheets/index.ts
+++ b/src/components/Sheets/index.ts
@@ -10,3 +10,5 @@ export {
   type JobDebugField,
 } from "./JobDebugSheet";
 export { ErrorSheet } from "./ErrorSheet";
+export { CommitDetailSheet } from "./CommitDetailSheet";
+export { FileSheet } from "./FileSheet";`;

const NEW_FILE_DIFF = `diff --git a/src/components/Sheets/FileSheet.tsx b/src/components/Sheets/FileSheet.tsx
new file mode 100644
index 0000000..9a8b7c6
--- /dev/null
+++ b/src/components/Sheets/FileSheet.tsx
@@ -0,0 +1,4 @@
+export const FileSheet = () => null;
+
+// V1: Apps/Views/Sheets/FileSheet.cs
+export default FileSheet;`;

const detail = (overrides: Partial<CommitDetail> = {}): CommitDetail => ({
  hash: HASH,
  title: "feat(sheets): port CommitDetailSheet and FileSheet",
  repository: "/home/dev/repos/Ivy-Tendril-V2",
  files: [
    { status: "M", path: "src/components/Sheets/index.ts" },
    { status: "A", path: "src/components/Sheets/FileSheet.tsx" },
  ],
  changes: [
    { filePath: "src/components/Sheets/index.ts", diff: SHEET_DIFF, additions: 2, deletions: 0 },
    {
      filePath: "src/components/Sheets/FileSheet.tsx",
      diff: NEW_FILE_DIFF,
      additions: 4,
      deletions: 0,
    },
  ],
  totalAdditions: 6,
  totalDeletions: 0,
  ...overrides,
});

/** The ordinary case: totals, then one collapsed diff per file. */
export const WithDiff: Story = {
  render: () => <Trigger detail={detail()} />,
};

/** No patch git would print (a merge), so V1's Changed Files list with its badges. */
export const FilesOnly: Story = {
  render: () => (
    <Trigger
      detail={detail({
        title: "Merge branch 'development' into plan/00412",
        changes: [],
        files: [
          { status: "M", path: "src/apps/tendril-app/src/views/ReviewView.tsx" },
          { status: "A", path: "src/packages/components/src/components/Sheets/FileSheet.tsx" },
          { status: "D", path: "src/apps/tendril-app/src/components/ArtifactFileSheet.old.tsx" },
          { status: "R100", path: "src/views/sheets/VerificationReportSheet.tsx" },
        ],
        totalAdditions: 0,
      })}
    />
  ),
};

/** A commit that touched nothing (an empty commit). */
export const Empty: Story = {
  render: () => (
    <Trigger detail={detail({ title: "chore: empty commit", files: [], changes: [] })} />
  ),
};

/** The read still out: the title is the hash alone. */
export const Loading: Story = {
  render: () => <Trigger loading />,
};

/** V1's "Commit not found.": no repo the plan names holds the hash any more. */
export const NotFound: Story = {
  render: () => <Trigger detail={null} />,
};

/** The read failed outright. */
export const Failed: Story = {
  render: () => <Trigger error="git exited with 128: fatal: not a git repository" />,
};

/** A large commit: every file starts collapsed, so it opens as a list of headers. */
export const ManyFiles: Story = {
  render: () => (
    <Trigger
      detail={detail({
        changes: Array.from({ length: 24 }, (_, i) => ({
          filePath: `src/locales/lang${i}/uiReview.json`,
          diff: SHEET_DIFF.replaceAll(
            "src/components/Sheets/index.ts",
            `src/locales/lang${i}/uiReview.json`,
          ),
          additions: 2,
          deletions: 0,
        })),
        totalAdditions: 48,
      })}
    />
  ),
};
