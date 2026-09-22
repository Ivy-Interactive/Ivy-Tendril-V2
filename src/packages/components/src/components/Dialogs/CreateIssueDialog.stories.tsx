import type { Meta, StoryObj } from "@storybook/react";
import { CreateIssueDialog } from "./CreateIssueDialog";

/**
 * Opens a GitHub issue from the plan via the CreateIssue promptware.
 *
 * Two modes. Without a `subject` the promptware builds the issue from the plan's own revision;
 * supplying one switches into subject mode, where Title and Body become editable fields seeded from
 * it and the plan becomes the *source* plan.
 *
 * `repo` is the **local repository path**, not an `owner/name` slug — it is the working directory
 * the promptware runs `gh` in, which is why this is a select over paths rather than a text box.
 *
 * Fields seed **once per opening**, not on prop identity, because callers rebuild `subject` and
 * `repos` every render. Storybook remounts between stories, so each seeds correctly.
 */
const meta: Meta<typeof CreateIssueDialog> = {
  title: "Dialogs/CreateIssueDialog",
  component: CreateIssueDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onSubmit: () => {}, planId: "00412" },
};

export default meta;
type Story = StoryObj<typeof CreateIssueDialog>;

/** The default, with the plan's own repos in the select. */
export const PlanMode: Story = {
  args: { repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework"] },
};

/** Nothing to run `gh` in. The empty select must not read as a working form. */
export const NoRepos: Story = { args: { repos: [] } };

/** Six repos: whether the select stays usable, and which one is preselected. */
export const ManyRepos: Story = {
  args: {
    repos: [
      "/repos/Ivy-Tendril-V2",
      "/repos/Ivy-Framework",
      "/repos/Ivy-Tendril",
      "/repos/Ivy-Services",
      "/repos/Ivy-Mcp",
      "/repos/Ivy-Cdn",
    ],
  },
};

/** Subject mode, seeded from a recommendation. Title and Body are editable. */
export const SubjectMode: Story = {
  args: {
    repos: ["/repos/Ivy-Tendril-V2"],
    subject: {
      title: "Extract the duplicated worktree path resolver",
      body: "`resolve_working_directory` and `WorktreePathHelper` compute the same path two ways.",
      source: "00412::Extract the duplicated worktree path resolver",
      kind: "recommendation",
    },
  },
};

/** The body seeds a textarea, so a long one is where the dialog scrolls or grows. */
export const SubjectModeLongBody: Story = {
  args: {
    repos: ["/repos/Ivy-Tendril-V2"],
    subject: {
      title: "Wireframe leak guard misses copied CSS",
      body: [
        "The guard inspects tsx/ts/jsx/js/css/html and claims a whole-file copy only above five",
        "meaningful lines. A short stylesheet lifted verbatim from a wireframe therefore passes.",
        "",
        "Repro: scaffold a wireframe, copy its `tokens.css` into the product tree, execute.",
      ].join("\n"),
      source: "00412::Wireframe leak guard misses copied CSS",
      kind: "recommendation",
    },
  },
};

/** Backticks and angle brackets reach the field as literals and must not be interpreted. */
export const SubjectModeMarkupCharacters: Story = {
  args: {
    repos: ["/repos/Ivy-Tendril-V2"],
    subject: {
      title: "`resolve_agent` returns <none> for a stale catalog entry",
      body: "Reproduced against a catalog written before the provider rename.",
      source: "00412::resolve_agent returns none",
      kind: "recommendation",
    },
  },
};

/** Mid-dispatch. */
export const Busy: Story = {
  args: { repos: ["/repos/Ivy-Tendril-V2"], isBusy: true },
};

/** A rejected dispatch, reported in place. */
export const Rejected: Story = {
  args: {
    repos: ["/repos/Ivy-Tendril-V2"],
    error: "gh: could not resolve to a Repository with the name 'Ivy-Tendril-V2'.",
  },
};
