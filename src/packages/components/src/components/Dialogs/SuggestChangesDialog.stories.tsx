import type { Meta, StoryObj } from "@storybook/react";
import { SuggestChangesDialog } from "./SuggestChangesDialog";

/**
 * Two dialogs in one.
 *
 * Without `appComments` it is the diff-side *Request Changes*, where `inlineCommentCount` drives
 * the callout, the submit label and whether an empty field may still be submitted. With them it is
 * V1's `ReviewAction/UpdateFromCommentsDialog`: a different header, a read-only listing grouped by
 * page, and a queue behind whatever the plan is already running.
 *
 * `allowed` is the app's answer to `CanRequestChanges`, which needs the plan's jobs — Review, or
 * Executing with a retry already in flight. The refusal state is the one worth looking at, because
 * it promises the comments are kept.
 */
const meta: Meta<typeof SuggestChangesDialog> = {
  title: "Dialogs/SuggestChangesDialog",
  component: SuggestChangesDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onSubmit: () => {},
    planId: "00412",
    planState: "Review",
  },
};

export default meta;
type Story = StoryObj<typeof SuggestChangesDialog>;

/** Nothing typed and no comments: submitting has nothing to send. */
export const EmptyRequest: Story = {};

/** A draft put in front of the reviewer, not a dispatch — so it is editable. */
export const PrefilledDraft: Story = {
  args: { initialChangeRequest: "The registry should assert completeness against the barrel." },
};

/** One unresolved inline comment, which lets an empty field submit. */
export const OneInlineComment: Story = { args: { inlineCommentCount: 1 } };

/** The plural half of the same copy. */
export const SeveralInlineComments: Story = { args: { inlineCommentCount: 7 } };

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
      { id: "c3", number: 3, tag: "h1", selector: "h1", comment: "Heading is the wrong size." },
    ],
  },
};

/** Queued behind work already in flight, which the notice names. */
export const QueuedBehindJobs: Story = {
  args: {
    planState: "Executing",
    inFlightCount: 2,
    appUrl: "http://127.0.0.1:5173/",
    appComments: [
      { id: "c1", number: 1, tag: "button", selector: "#save", comment: "Wrong label." },
    ],
  },
};

/** Refused: the plan is not taking changes, and the copy promises the comments are kept. */
export const NotTakingChanges: Story = {
  args: {
    planState: "Completed",
    allowed: false,
    appUrl: "http://127.0.0.1:5173/",
    appComments: [
      { id: "c1", number: 1, tag: "button", selector: "#save", comment: "Wrong label." },
    ],
  },
};

/** V1's uploads on the diff-side request: staged files referenced from the change request. */
export const WithAttachments: Story = {
  args: {
    onAttachFiles: () => {},
    onRemoveAttachment: () => {},
    attachments: [
      {
        name: "misaligned-header.png",
        path: "/Users/dev/.tendril/Attachments/9c1e/misaligned-header.png",
      },
    ],
  },
};
