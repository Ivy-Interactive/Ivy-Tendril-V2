import type { Meta, StoryObj } from "@storybook/react";
import { PlanSearchDialog } from "./PlanSearchDialog";
import { summary } from "./storyModels";

/**
 * The shell's own plan search, opened by the sidebar section's search icon.
 *
 * It reaches the daemon through `search`, which defaults to `bridge.listPlans({ q })` over the
 * FTS5 index and is injectable. Every story supplies its own, so the dialog runs against a real
 * component with a real seam rather than a module mock.
 */
const meta = {
  title: "Dialogs/Shell/PlanSearchDialog",
  component: PlanSearchDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, onSelectPlan: () => {} },
} satisfies Meta<typeof PlanSearchDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The state the dialog opens in, before anything is typed. */
export const EmptyQuery: Story = {
  args: { search: () => Promise.resolve([]) },
};

/** A query that matches nothing. It must read as "nothing matched", not as "still loading". */
export const NoResults: Story = {
  args: { search: () => Promise.resolve([]) },
};

/** Three rows: the ordinary case, and where the row layout is judged. */
export const AFewResults: Story = {
  args: {
    search: () =>
      Promise.resolve([
        summary({ id: "00412", title: "Port the dialog stories" }),
        summary({ id: "00413", title: "Story catalogs for every dialog", state: "Executing" }),
        summary({ id: "00414", title: "Contract runner", state: "Review" }),
      ]),
  },
};

/** Twenty rows against the result cap, so the list scrolls and the cap is visible. */
export const ManyResults: Story = {
  args: {
    search: () =>
      Promise.resolve(
        Array.from({ length: 20 }, (_, i) =>
          summary({
            id: String(400 + i).padStart(5, "0"),
            title: `Plan number ${i + 1} in a long result set`,
          }),
        ),
      ),
  },
};

/** The index is unavailable or the daemon is down. A rejection must not spin forever. */
export const SearchRejects: Story = {
  args: { search: () => Promise.reject(new Error("search index unavailable")) },
};

/** A pending promise: the loading state on its own, which no other story holds still. */
export const SearchPending: Story = {
  args: { search: () => new Promise<never>(() => {}) },
};
