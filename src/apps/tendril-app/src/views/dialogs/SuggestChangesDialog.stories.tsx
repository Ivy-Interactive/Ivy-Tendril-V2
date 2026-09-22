import type { Meta, StoryObj } from "@storybook/react";
import { SuggestChangesDialog } from "./SuggestChangesDialog";
import { plan } from "./storyModels";

/**
 * Two dialogs in one, like `CreateIssueDialog`.
 *
 * Without `appComments` it is the diff-side *Request Changes*, where `inlineCommentCount` drives
 * the callout, the submit label and whether an empty field may still be submitted. With them it is
 * V1's `ReviewAction/UpdateFromCommentsDialog`: a different header, a read-only listing grouped by
 * page, and a queue behind whatever the plan is already running.
 */
const meta = {
  title: "Dialogs/Dispatch/SuggestChangesDialog",
  component: SuggestChangesDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, plan: plan({ state: "Review" }) },
} satisfies Meta<typeof SuggestChangesDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing typed and no comments: the case where submitting has nothing to send. */
export const EmptyRequest: Story = {};

/** `initialChangeRequest` is a draft put in front of the reviewer, not a dispatch — so editable. */
export const PrefilledDraft: Story = {
  args: { initialChangeRequest: "The registry should assert completeness against the barrel." },
};

/** One unresolved inline comment. */
export const OneInlineComment: Story = {
  args: { inlineCommentCount: 1 },
};

/** The plural half of the same copy. */
export const SeveralInlineComments: Story = {
  args: { inlineCommentCount: 7 },
};

/** App comments from a single page. */
export const AppCommentsOnePage: Story = {
  args: {
    appUrl: "http://127.0.0.1:5173/",
    appComments: [
      {
        id: "c1",
        number: 1,
        tag: "button",
        selector: "#save",
        comment: "This should say Publish, not Save.",
        url: "http://127.0.0.1:5173/settings",
      },
    ],
  },
};

/** Grouping: three pages, one of which carries no `url` and belongs to the entry URL. */
export const AppCommentsSeveralPages: Story = {
  args: {
    appUrl: "http://127.0.0.1:5173/",
    appComments: [
      {
        id: "c1",
        number: 1,
        tag: "button",
        selector: "#save",
        comment: "This should say Publish.",
        url: "http://127.0.0.1:5173/settings",
      },
      {
        id: "c2",
        number: 2,
        tag: "table",
        selector: ".jobs",
        comment: "Sort by start time, not id.",
        url: "http://127.0.0.1:5173/jobs",
      },
      {
        id: "c3",
        number: 3,
        tag: "h1",
        selector: "h1",
        comment: "Heading is the wrong size here.",
      },
    ],
  },
};

/** A comment written as prose rather than a phrase, which is what reviewers actually leave. */
export const AppCommentLongText: Story = {
  args: {
    appUrl: "http://127.0.0.1:5173/",
    appComments: [
      {
        id: "c1",
        number: 1,
        tag: "form",
        selector: "form.levels",
        comment:
          "The badge field is preserved through an edit but never shown, so there is no way to tell from this screen whether a level has one. Either surface it read-only or make it editable, but the current state is invisible either way.",
      },
    ],
  },
};
