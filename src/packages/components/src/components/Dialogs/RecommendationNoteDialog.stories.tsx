import type { Meta, StoryObj } from "@storybook/react";
import { RecommendationNoteDialog } from "./RecommendationNoteDialog";

const DESCRIPTION = `Drive the packaged app with **tauri-driver** instead of the dev server, so the E2E suite
exercises the same bundle users install.

- Build once with \`pnpm tauri build --debug\`
- Point WebdriverIO at the binary
- Keep the dev-server suite for fast feedback

See the [tauri-driver docs](https://v2.tauri.app/develop/tests/webdriver/).`;

/**
 * Accept or decline a recommendation with a note - V1's `AcceptWithNotesDialog`. The recommendation
 * itself is rendered above the field as markdown, as V1's `Markdown(...).Article()` does, so the note
 * is written with it in view.
 */
const meta: Meta<typeof RecommendationNoteDialog> = {
  title: "Dialogs/RecommendationNoteDialog",
  component: RecommendationNoteDialog,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    onSubmit: () => {},
    title: "Run the E2E suite against the packaged app",
    action: "Accept",
    recommendationDescription: DESCRIPTION,
  },
};

export default meta;
type Story = StoryObj<typeof RecommendationNoteDialog>;

/** Accept, with the recommendation rendered as markdown above the note. */
export const Accept: Story = {};

/** Decline: the reason field and a destructive submit. */
export const Decline: Story = { args: { action: "Decline" } };

/** No description to show: just the note. */
export const WithoutDescription: Story = { args: { recommendationDescription: undefined } };

/** Re-opened with the note written last time. */
export const WithInitialNote: Story = {
  args: { initialNote: "Only for the release pipeline; keep the dev-server suite on PRs." },
};

/** A description long enough to scroll inside its own box rather than push the field away. */
export const LongDescription: Story = {
  args: { recommendationDescription: Array.from({ length: 6 }, () => DESCRIPTION).join("\n\n") },
};
