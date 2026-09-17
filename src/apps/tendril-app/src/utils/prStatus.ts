import type { PrState } from "../types/api";

/**
 * PR state to badge classes, mirroring the `BadgeColorMapping` V1's `PullRequestApp` gives its
 * Status column (`src/Ivy.Tendril/Apps/PullRequest/PullRequestApp.cs`): Open is Green, Merged is
 * Purple, Closed is Zinc. `Unknown` is not in that map, so it renders as the default neutral
 * badge here too.
 *
 * These are the design system's own named colour tokens, not Tailwind palette literals: the
 * mapping is V1's, so the colours have to be the ones V1 names. Shared by `PlanPullRequests` and
 * `PullRequestsView` so the per-plan card and the cross-plan table agree on colour.
 */
export const PR_STATE_CLASS: Record<PrState, string> = {
  Open: "border-green/40 bg-green/10 text-green",
  Merged: "border-purple/40 bg-purple/10 text-purple",
  Closed: "border-zinc/40 bg-zinc/10 text-zinc",
  Unknown: "border-border bg-muted text-muted-foreground",
};
