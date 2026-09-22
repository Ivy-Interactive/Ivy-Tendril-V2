import type { Meta, StoryObj } from "@storybook/react";
import { PlanSearchDialog } from "./PlanSearchDialog";
import type { ShellSectionItemDto } from "../Shell";

const row = (id: string, title: string, badge?: string): ShellSectionItemDto => ({
  id,
  title,
  tag: `#${id}`,
  badges: badge ? [{ label: badge, kind: "neutral" as const }] : [],
});

/**
 * Full-text plan search, opened from the sidebar section's search icon and its `Cmd/Ctrl+K`.
 *
 * It exists because the sidebar lists hold only a slice of the plans — Plans lists Draft and
 * Blocked, Review lists Review and Failed, Icebox lists Icebox — so a Completed, Skipped, Creating,
 * Updating or Executing plan is in none of them and reachable from nowhere else in the UI. The
 * search therefore never sends a status filter.
 *
 * The `search` prop returns rows rather than plan records: building a row needs the Plans list's
 * badge builders and the configured level colours, which the app holds.
 */
const meta: Meta<typeof PlanSearchDialog> = {
  title: "Dialogs/PlanSearchDialog",
  component: PlanSearchDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onSelectPlan: () => {} },
};

export default meta;
type Story = StoryObj<typeof PlanSearchDialog>;

/** The state it opens in. An empty box shows the box alone — no rows, no message, no request. */
export const EmptyQuery: Story = { args: { search: () => Promise.resolve([]) } };

/** Three rows: the ordinary case, and where the row layout is judged. */
export const AFewResults: Story = {
  args: {
    search: () =>
      Promise.resolve([
        row("00412", "Port the dialog stories", "Draft"),
        row("00413", "Split the connected dialogs", "Executing"),
        row("00414", "Contract runner", "Review"),
      ]),
  },
};

/** Twenty rows against the 15-row cap, so the cap is visible. */
export const ManyResults: Story = {
  args: {
    search: () =>
      Promise.resolve(
        Array.from({ length: 20 }, (_, i) =>
          row(String(400 + i).padStart(5, "0"), `Plan number ${i + 1} in a long result set`),
        ),
      ),
  },
};

/** A query that matches nothing. It must read as "nothing matched", not "still loading". */
export const NoResults: Story = { args: { search: () => Promise.resolve([]) } };

/** A rejection is reported: rendered as "No plans found." it would read as "this plan does not exist". */
export const SearchRejects: Story = {
  args: { search: () => Promise.reject(new Error("search index unavailable")) },
};

/** The query is still out, so "No plans found." would be premature. */
export const SearchPending: Story = {
  args: { search: () => new Promise<never>(() => {}) },
};
