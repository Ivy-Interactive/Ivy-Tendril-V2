import type { Meta, StoryObj } from "@storybook/react";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { plan } from "./storyModels";

/**
 * Opens a GitHub issue from the plan via the CreateIssue promptware.
 *
 * Two modes. Without a `subject` the promptware builds the issue from the plan's own revision;
 * supplying one switches into subject mode, where Title and Body become editable fields seeded from
 * it and the plan becomes the *source* plan, still resolving the repo list and job scope.
 *
 * `repo` is the **local repository path**, not an `owner/name` slug — `CreateIssueArgs.repo` is the
 * working directory the promptware runs `gh` in, which is why it is a select over the plan's repos
 * rather than a text box.
 *
 * **Seeding happens once per opening**, not on prop identity, because callers rebuild
 * `projectRepos` and `subject` every render. Storybook remounts between stories, so each story
 * seeds correctly; a story that re-rendered with a new `subject` would not reseed, and that is the
 * fixed behaviour rather than a bug.
 */
const meta = {
  title: "Dialogs/Dispatch/CreateIssueDialog",
  component: CreateIssueDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {} },
} satisfies Meta<typeof CreateIssueDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default. The select is populated from the plan's own repos. */
export const PlanModeSeveralRepos: Story = {
  args: { plan: plan({ repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework"] }) },
};

/** A plan recording no repos of its own falls back to `projectRepos`. */
export const PlanModeProjectRepoFallback: Story = {
  args: { plan: plan({ repos: [] }), projectRepos: ["/repos/FromProject"] },
};

/**
 * Neither the plan nor the project has one, so there is nothing to run `gh` in. The empty select is
 * the case that must not read as a working form.
 */
export const PlanModeNoRepos: Story = {
  args: { plan: plan({ repos: [] }) },
};

/** Six repos: whether the select stays usable, and which one is preselected. */
export const PlanModeManyRepos: Story = {
  args: {
    plan: plan({
      repos: [
        "/repos/Ivy-Tendril-V2",
        "/repos/Ivy-Framework",
        "/repos/Ivy-Tendril",
        "/repos/Ivy-Services",
        "/repos/Ivy-Mcp",
        "/repos/Ivy-Cdn",
      ],
    }),
  },
};

/** Subject mode, seeded from a recommendation. Title and Body are editable. */
export const SubjectMode: Story = {
  args: {
    plan: plan(),
    subject: {
      title: "Extract the duplicated worktree path resolver",
      body: "`resolve_working_directory` and `WorktreePathHelper` compute the same path two ways.",
      source: "00412::Extract the duplicated worktree path resolver",
      kind: "recommendation",
    },
  },
};

/** The body is seeded into a textarea, so a long one is where the dialog scrolls or grows. */
export const SubjectModeLongBody: Story = {
  args: {
    plan: plan(),
    subject: {
      title: "Wireframe leak guard misses copied CSS",
      body: [
        "The guard inspects tsx/ts/jsx/js/css/html and claims a whole-file copy only above five",
        "meaningful lines. A short stylesheet lifted verbatim from a wireframe therefore passes.",
        "",
        "Repro: scaffold a wireframe, copy its `tokens.css` into the product tree, execute.",
        "Expected: the plan fails its wireframe check. Actual: it completes and the PR carries it.",
      ].join("\n"),
      source: "00412::Wireframe leak guard misses copied CSS",
      kind: "recommendation",
    },
  },
};

/**
 * A subject is operator- or agent-written prose, so backticks and angle brackets reach the field as
 * literals and must not be interpreted.
 */
export const SubjectModeMarkupCharacters: Story = {
  args: {
    plan: plan(),
    subject: {
      title: "`resolve_agent` returns <none> for a stale catalog entry",
      body: "Reproduced against a catalog written before the provider rename.",
      source: "00412::resolve_agent returns none",
      kind: "recommendation",
    },
  },
};

/** Subject mode with nothing to run `gh` in — the two independent empty branches meeting. */
export const SubjectModeNoRepos: Story = {
  args: {
    plan: plan({ repos: [] }),
    subject: {
      title: "Dedupe key ignores the subject",
      body: "Two recommendations from one plan collapse onto the same job.",
      source: "00412::Dedupe key ignores the subject",
      kind: "recommendation",
    },
  },
};
