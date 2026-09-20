import type { PrState } from "../types/api";

/**
 * PR state to Ivy colour name — the `BadgeColorMapping` V1's `PullRequestApp` gives its Status
 * column (`src/Ivy.Tendril/Apps/PullRequest/PullRequestApp.cs:137-143`): Open is Green, Merged is
 * Purple, Closed is Zinc.
 *
 * A *name*, not a class list, because that is what the framework's mapping is and what the library
 * `Badge` takes: `color` resolves the name through `ivyColorVar` and tints the badge from the
 * theme's own token. `Unknown` is absent from V1's map, so it stays undefined here and renders as
 * the plain neutral badge.
 *
 * Shared by `PlanPullRequests` and `PullRequestsView` so the per-plan card and the cross-plan table
 * agree on colour.
 */
export const PR_STATE_COLOR: Partial<Record<PrState, string>> = {
  Open: "Green",
  Merged: "Purple",
  Closed: "Zinc",
};
