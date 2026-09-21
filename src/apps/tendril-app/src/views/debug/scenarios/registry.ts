import type { Surface } from "./types";
import { dirtyRepoSurface } from "./dirtyRepo";
import { unansweredQuestionsSurface, pendingAnnotationsSurface } from "./guards";
import {
  confirmSurface,
  deletePlanSurface,
  removeProjectSurface,
  deleteProjectSurface,
  resetToDraftSurface,
  partialDeliverySurface,
} from "./confirms";
import {
  createIssueSurface,
  createPrSurface,
  updatePlanSurface,
  suggestChangesSurface,
} from "./dispatch";
import {
  noProjectsSurface,
  planSearchSurface,
  shareTunnelSurface,
  autoAcceptSurface,
} from "./shell";

/**
 * Every dialog that has a scenario catalog.
 *
 * Ordered as the harness lists them: the three execute guards first, because they are the last
 * thing before a dispatch and the ones that had the least coverage; then the confirms, then the
 * dispatchers, then the shell's own.
 *
 * `tests/dialog-scenarios.test.tsx` asserts this list against the dialogs exported from
 * `views/dialogs/index.ts`, so a new dialog cannot land without either a catalog or an explicit
 * exemption. That is the same device `tests/shell-content-padding.test.tsx` uses for
 * `APP_DESCRIPTORS` - "a new one cannot skip the decision".
 */
export const SURFACES: readonly Surface[] = [
  dirtyRepoSurface,
  unansweredQuestionsSurface,
  pendingAnnotationsSurface,

  confirmSurface,
  deletePlanSurface,
  removeProjectSurface,
  deleteProjectSurface,
  resetToDraftSurface,
  partialDeliverySurface,

  createIssueSurface,
  createPrSurface,
  updatePlanSurface,
  suggestChangesSurface,

  noProjectsSurface,
  planSearchSurface,
  shareTunnelSurface,
  autoAcceptSurface,
];

/**
 * Exports of `views/dialogs/index.ts` that are deliberately not surfaces, with the reason.
 *
 * The completeness test subtracts these from the barrel before comparing, so an exemption is a
 * decision recorded here rather than a silent gap.
 */
export const NOT_SURFACES: Readonly<Record<string, string>> = {
  // The wrapper every dialog composes, not a dialog. It owns the accessibility contract that the
  // contract runner asserts *through* each dialog, so testing it as a surface would test the
  // runner's own premise.
  DialogShell: "the shell every dialog composes, not a dialog itself",
  // Helpers and constants re-exported from the barrel for call sites.
  DIALOG_WIDTH: "a constant",
  planSearchRow: "a row renderer used by the shell's sidebar search",
  planSearchRowBadges: "a row renderer helper",
  MAX_PLAN_SEARCH_RESULTS: "a constant",
  PLAN_SEARCH_DEBOUNCE_MS: "a constant",
  shareTunnelApi: "the live API object a scenario replaces with a frozen one",
  shareUrlForPlan: "a pure function, tested directly in ShareTunnelDialog.test.tsx",
  confirmsProjectName:
    "a pure predicate - the typed-name gate, asserted directly in settings-project-config.test.tsx",
  SHARE_POLL_INTERVAL_MS: "a constant",
};
