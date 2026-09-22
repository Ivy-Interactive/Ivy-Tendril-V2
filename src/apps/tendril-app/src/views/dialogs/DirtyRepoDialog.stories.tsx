import type { Meta, StoryObj } from "@storybook/react";
import { DirtyRepoDialog } from "./DirtyRepoDialog";
import { repo } from "./storyModels";

/**
 * The reference catalog, ported from V1's `Apps/Debug/DirtyRepoDialogDebugView.cs` — the one dialog
 * harness V1 actually wrote, and the model for every stories file beside it.
 *
 * **Not a verbatim port, and it cannot be.** V1's nine scenarios are built from `PreflightResult`,
 * whose `DirtyReasonDetail` distinguishes uncommitted changes from untracked files, commits ahead
 * of origin, a branch mismatch, a detached HEAD, an in-progress rebase and a missing remote. V2's
 * `RepoStatus` is flat — a path, `git status --porcelain` lines and a count — and
 * `DirtyRepoDialog`'s own comment says so: V1's richer shape "has no counterpart in `RepoStatus`".
 * So these nine keep V1's *intent* (cover every rendering branch, especially the ones ordinary use
 * reaches rarely) against V2's actual model, rather than porting reasons the dialog cannot show.
 */
const meta = {
  title: "Dialogs/DirtyRepoDialog",
  component: DirtyRepoDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onProceed: () => {} },
} satisfies Meta<typeof DirtyRepoDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The singular branch of the per-repo count: `1 uncommitted change`, not `changes`. */
export const OneChange: Story = {
  args: { dirtyRepos: [repo("/repos/Ivy-Tendril-V2", ["M src/main.rs"])] },
};

/** Two changes, under the 3-item cap, so every path is listed and no counter appears. */
export const AFewChanges: Story = {
  args: {
    dirtyRepos: [repo("/repos/Ivy-Tendril-V2", ["M src/main.rs", "M README.md"])],
  },
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
 * Name extraction: the heading is the last non-empty path segment, so a trailing separator must
 * not leave it blank.
 */
export const WindowsPathTrailingSeparator: Story = {
  args: {
    dirtyRepos: [repo("C:\\Repos\\Ivy-Tendril-V2\\", ["M src\\main.rs"])],
  },
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
