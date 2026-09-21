import { DirtyRepoDialog } from "../../dialogs";
import { defineSurface } from "./types";
import { repo } from "./models";

/**
 * The reference catalog, ported from V1's `DirtyRepoDialogDebugView.cs` - the one harness V1
 * actually wrote, and the model for every catalog beside it.
 *
 * **Not a verbatim port, and it cannot be.** V1's nine scenarios are built from `PreflightResult`,
 * whose `DirtyReasonDetail` distinguishes uncommitted changes from untracked files, commits ahead
 * of origin, a branch mismatch, a detached HEAD, an in-progress rebase and a missing remote. V2's
 * `RepoStatus` is flat - a path, `git status --porcelain` lines and a count - and
 * `DirtyRepoDialog`'s own comment says so: V1's richer shape "has no counterpart in `RepoStatus`".
 * So these nine keep V1's *intent* (cover every rendering branch, especially the ones ordinary use
 * reaches rarely) against V2's actual model, rather than porting reasons the dialog cannot show.
 */
export const dirtyRepoSurface = defineSurface("DirtyRepoDialog", "dialog", DirtyRepoDialog, [
  {
    title: "Single repo · one change",
    hint: "The singular branch of the per-repo count: `1 uncommitted change`, not `changes`.",
    props: {
      dirtyRepos: [repo("/repos/Ivy-Tendril-V2", ["M src/main.rs"])],
      onProceed: () => {},
    },
    expectText: ["1 uncommitted change", "repository has"],
    expectAbsent: ["more"],
  },
  {
    title: "Single repo · a few changes",
    hint: "Two changes, under the 3-item cap, so every path is listed and no counter appears.",
    props: {
      dirtyRepos: [repo("/repos/Ivy-Tendril-V2", ["M src/main.rs", "M README.md"])],
      onProceed: () => {},
    },
    expectText: ["2 uncommitted changes", "src/main.rs", "README.md"],
    expectAbsent: ["more"],
  },
  {
    title: "Single repo · exactly three changes",
    hint: "The cap's boundary. Three are shown and there is still nothing hidden, so no `+N more`.",
    props: {
      dirtyRepos: [
        repo("/repos/Ivy-Tendril-V2", ["M src/main.rs", "M src/lib.rs", "?? scratch.log"]),
      ],
      onProceed: () => {},
    },
    expectText: ["3 uncommitted changes", "scratch.log"],
    expectAbsent: ["more"],
  },
  {
    title: "Single repo · many changes (+N more)",
    hint: "Six changes past a cap of three: the list truncates and the remainder is counted.",
    props: {
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
      onProceed: () => {},
    },
    expectText: ["6 uncommitted changes", "+3 more"],
  },
  {
    title: "Single repo · service-capped list",
    hint: "The subtle one: the service sent 3 lines but reports 47. `+N more` must count against `changeCount`, not the truncated list, or a repo mid-refactor under-reports.",
    props: {
      dirtyRepos: [
        repo("/repos/Ivy-Tendril-V2", ["M src/main.rs", "M src/lib.rs", "M src/config.rs"], {
          changeCount: 47,
        }),
      ],
      onProceed: () => {},
    },
    expectText: ["47 uncommitted changes", "+44 more"],
  },
  {
    title: "Two repos",
    hint: "The plural branch of the heading: `repositories have`, and one section per repo.",
    props: {
      dirtyRepos: [
        repo("/repos/Ivy-Tendril-V2", ["M src/main.rs"]),
        repo("/repos/Ivy-Framework", ["M src/Ivy/Server.cs", "?? notes.txt"]),
      ],
      onProceed: () => {},
    },
    expectText: ["repositories have", "Ivy-Tendril-V2", "Ivy-Framework"],
  },
  {
    title: "Many repos · long nested paths",
    hint: "Layout and width: four repos whose paths are long enough to wrap or clip the mono line.",
    props: {
      dirtyRepos: [
        repo("/Users/dev/source/repos/Company.Product.Web", ["M src/Components/Dashboard.tsx"]),
        repo("/Users/dev/source/repos/Company.Product.Api", ["M Controllers/ReportingController.cs"]),
        repo("/Users/dev/source/repos/Company.Product.Shared", ["M Models/Report.cs"]),
        repo("/Users/dev/source/repos/Company.Product.Infrastructure", ["M Terraform/main.tf"]),
      ],
      onProceed: () => {},
    },
    expectText: ["repositories have", "Company.Product.Infrastructure"],
  },
  {
    title: "Windows path with a trailing separator",
    hint: "Name extraction: the heading is the last non-empty path segment, so a trailing slash must not leave it blank.",
    props: {
      dirtyRepos: [repo("C:\\Repos\\Ivy-Tendril-V2\\", ["M src\\main.rs"])],
      onProceed: () => {},
    },
    expectText: ["Ivy-Tendril-V2", "C:\\Repos\\Ivy-Tendril-V2\\"],
  },
  {
    title: "Custom proceed label",
    hint: "V1's `proceedLabel`: the dialog guards every dispatch, so the primary is named by its caller rather than fixed.",
    props: {
      dirtyRepos: [repo("/repos/Ivy-Tendril-V2", ["M src/main.rs"])],
      onProceed: () => {},
      proceedLabel: "Create Without Syncing",
    },
    expectText: ["Create Without Syncing"],
    expectAbsent: ["Execute Anyway"],
  },
]);
