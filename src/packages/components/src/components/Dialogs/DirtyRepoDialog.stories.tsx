import type { Meta, StoryObj } from "@storybook/react";
import { DirtyRepoDialog } from "./DirtyRepoDialog";
import { repo } from "./storyModels";

/**
 * The last guard before dispatch: a target repo has uncommitted work.
 *
 * Ported from V1's `Apps/Debug/DirtyRepoDialogDebugView.cs`, the one dialog harness V1 actually
 * wrote — and deliberately **not** verbatim. V1's nine scenarios are built from `PreflightResult`,
 * which distinguishes untracked files, commits ahead of origin, a branch mismatch, a detached HEAD
 * and more. V2's shape is flat — a path, porcelain lines and a count — so these keep V1's *intent*
 * (cover every rendering branch, especially the ones ordinary use reaches rarely) against the model
 * this dialog actually has.
 */
const meta: Meta<typeof DirtyRepoDialog> = {
  title: "Dialogs/DirtyRepoDialog",
  component: DirtyRepoDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onProceed: () => {} },
};

export default meta;
type Story = StoryObj<typeof DirtyRepoDialog>;

/** The singular branch of the per-repo count: `1 uncommitted change`, not `changes`. */
export const OneChange: Story = {
  args: { dirtyRepos: [repo("/repos/Ivy-Tendril-V2", ["M src/main.rs"])] },
};

/** Two changes, under the 3-item cap, so every path is listed and no counter appears. */
export const AFewChanges: Story = {
  args: { dirtyRepos: [repo("/repos/Ivy-Tendril-V2", ["M src/main.rs", "M README.md"])] },
};

/** The cap's boundary. Three are shown and nothing is hidden, so there is still no `+N more`. */
export const ExactlyThreeChanges: Story = {
  args: {
    dirtyRepos: [
      repo("/repos/Ivy-Tendril-V2", ["M src/main.rs", "M src/lib.rs", "?? scratch.log"]),
    ],
  },
};

/** Six changes past a cap of three: the list truncates and the remainder is counted. */
export const ManyChanges: Story = {
  args: {
    dirtyRepos: [
      repo("/repos/Ivy-Tendril-V2", [
        "M src/main.rs",
        "M src/lib.rs",
        "M src/config.rs",
        "M src/models/job.rs",
        "M README.md",
        "?? scratch.log",
      ]),
    ],
  },
};

/**
 * The subtle one: the service sent 3 lines but reports 47. `+N more` must count against
 * `changeCount`, not the truncated list, or a repo mid-refactor under-reports what it is hiding.
 */
export const ServiceCappedList: Story = {
  args: {
    dirtyRepos: [
      repo("/repos/Ivy-Tendril-V2", ["M src/main.rs", "M src/lib.rs", "M src/config.rs"], {
        changeCount: 47,
      }),
    ],
  },
};

/** The plural branch of the heading — `repositories have` — and one section per repo. */
export const TwoRepos: Story = {
  args: {
    dirtyRepos: [
      repo("/repos/Ivy-Tendril-V2", ["M src/main.rs"]),
      repo("/repos/Ivy-Framework", ["M src/Ivy/Server.cs", "?? notes.txt"]),
    ],
  },
};

/** Layout and width: four repos whose paths are long enough to wrap or clip the mono line. */
export const ManyReposLongPaths: Story = {
  args: {
    dirtyRepos: [
      repo("/Users/dev/source/repos/Company.Product.Web", ["M src/Components/Dashboard.tsx"]),
      repo("/Users/dev/source/repos/Company.Product.Api", ["M Controllers/ReportingController.cs"]),
      repo("/Users/dev/source/repos/Company.Product.Shared", ["M Models/Report.cs"]),
      repo("/Users/dev/source/repos/Company.Product.Infrastructure", ["M Terraform/main.tf"]),
    ],
  },
};

/**
 * Name extraction: the heading is the last non-empty path segment, so a trailing separator must not
 * leave it blank.
 */
export const WindowsPathTrailingSeparator: Story = {
  args: { dirtyRepos: [repo("C:\\Repos\\Ivy-Tendril-V2\\", ["M src\\main.rs"])] },
};

/**
 * V1's `proceedLabel`: the dialog guards every dispatch, so the primary is named by its caller
 * rather than fixed.
 */
export const CustomProceedLabel: Story = {
  args: {
    dirtyRepos: [repo("/repos/Ivy-Tendril-V2", ["M src/main.rs"])],
    proceedLabel: "Create Without Syncing",
  },
};

/**
 * V1's `CreatePlanDialogLauncher` use: "Create Without Syncing", and a line per repo saying the plan
 * is written against this state while ExecutePlan branches from `origin/<baseBranch>`.
 */
export const CreatePlanPurpose: Story = {
  args: {
    purpose: "createPlan",
    dirtyRepos: [
      repo("/repos/Ivy-Tendril-V2", ["M src/main.rs", "?? notes.txt"], {
        baseBranch: "development",
      }),
    ],
  },
};

/**
 * With *Sync Repos* offered. Clicking it with local work present swaps in the SyncRepo policy
 * dialog (see `Dialogs/SyncRepoDialog`).
 */
export const WithSyncRepos: Story = {
  args: {
    purpose: "createPlan",
    onSyncRepos: () => {},
    dirtyRepos: [
      repo("/repos/Ivy-Tendril-V2", ["M src/main.rs"], { baseBranch: "development" }),
      repo("/repos/Ivy-Framework", ["?? scratch.log"], { baseBranch: "main" }),
    ],
  },
};
