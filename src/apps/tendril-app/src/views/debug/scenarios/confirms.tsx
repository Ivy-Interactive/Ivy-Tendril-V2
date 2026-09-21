import { Button } from "@ivy-interactive/components/ui";
import {
  ConfirmDialog,
  DeletePlanDialog,
  RemoveProjectDialog,
  DeleteProjectDialog,
  ResetToDraftDialog,
  PartialDeliveryDialog,
} from "../../dialogs";
import { defineSurface } from "./types";
import { plan } from "./models";

const noop = () => {};

/**
 * `ConfirmDialog` and the four dialogs built on it.
 *
 * `ConfirmDialog` is the shared primitive, so its catalog is about *states* rather than content:
 * busy, error, disabled, secondary action. Those four states are each one prop, and each is the
 * kind of thing that renders correctly in isolation and wrongly in combination - which is exactly
 * what a harness is for.
 *
 * The four wrappers are about *copy*. Each states a consequence in plain words, and each names its
 * confirm button with the verb that happens, so the accessible name of the button is the action.
 */

export const confirmSurface = defineSurface("ConfirmDialog", "dialog", ConfirmDialog, [
  {
    title: "Destructive",
    hint: "The default shape: Cancel outline first, the destructive confirm last, nothing to type.",
    props: {
      title: "Delete this plan?",
      body: "The plan folder, its revisions and its worktrees are removed. This cannot be undone.",
      confirmLabel: "Delete Plan",
      confirmVariant: "destructive" as const,
      onConfirm: noop,
    },
    expectText: ["Delete this plan?", "Delete Plan", "cannot be undone"],
  },
  {
    title: "Warning",
    hint: "The middle variant, for a consequence that is serious but recoverable.",
    props: {
      title: "Reset to Draft?",
      body: "The plan returns to Draft and its worktrees are removed.",
      confirmLabel: "Reset to Draft",
      confirmVariant: "warning" as const,
      onConfirm: noop,
    },
    expectText: ["Reset to Draft?"],
  },
  {
    title: "Primary",
    hint: "The non-destructive variant, where confirming is the ordinary answer.",
    props: {
      title: "Complete this plan?",
      body: "The plan is marked Completed.",
      confirmLabel: "Complete",
      confirmVariant: "primary" as const,
      onConfirm: noop,
    },
    expectText: ["Complete this plan?"],
  },
  {
    title: "Busy",
    hint: "Mid-request: the confirm is disabled and says so, so a second click cannot double-send.",
    props: {
      title: "Delete this plan?",
      body: "The plan folder and its worktrees are removed.",
      confirmLabel: "Delete Plan",
      confirmVariant: "destructive" as const,
      onConfirm: noop,
      isBusy: true,
    },
    expectText: ["Delete this plan?"],
  },
  {
    title: "Backend rejection",
    hint: "The error renders where the operator pressed the button, not as a toast that can be missed.",
    props: {
      title: "Delete this plan?",
      body: "The plan folder and its worktrees are removed.",
      confirmLabel: "Delete Plan",
      confirmVariant: "destructive" as const,
      onConfirm: noop,
      error: "Plan 00412 is held by a running job (#1184) and cannot be deleted.",
    },
    expectText: ["held by a running job"],
  },
  {
    title: "Confirm disabled",
    hint: "A precondition is unmet, so the action is visible but refused rather than hidden.",
    props: {
      title: "Delete this project?",
      body: "Type the project name to confirm.",
      confirmLabel: "Delete Project",
      confirmVariant: "destructive" as const,
      onConfirm: noop,
      confirmDisabled: true,
    },
    expectText: ["Delete this project?"],
  },
  {
    title: "With a secondary action",
    hint: "A non-destructive alternative rendered between Cancel and the confirm — the shape `DeletePlanDialog` uses to offer Icebox instead of deletion.",
    props: {
      title: "Delete this plan?",
      body: "The plan folder and its worktrees are removed.",
      confirmLabel: "Delete Plan",
      confirmVariant: "destructive" as const,
      onConfirm: noop,
      secondaryAction: (
        <Button variant="outline" onClick={noop}>
          Move to Icebox
        </Button>
      ),
    },
    expectText: ["Move to Icebox", "Delete Plan"],
  },
  {
    title: "Rich body",
    hint: "`body` is a ReactNode, not a string: a consequence with structure still has to lay out inside the dialog's width.",
    props: {
      title: "Complete with failed verifications?",
      body: (
        <div className="space-y-2">
          <p>These verifications did not pass:</p>
          <ul className="list-disc pl-5 font-mono text-xs">
            <li>RustClippy</li>
            <li>NpmTest</li>
          </ul>
        </div>
      ),
      confirmLabel: "Complete Anyway",
      confirmVariant: "warning" as const,
      onConfirm: noop,
    },
    expectText: ["RustClippy", "NpmTest", "Complete Anyway"],
  },
]);

export const deletePlanSurface = defineSurface("DeletePlanDialog", "dialog", DeletePlanDialog, [
  {
    title: "Draft plan",
    hint: "The ordinary case, where deleting, archiving and skipping are all offered.",
    props: { plan: plan({ state: "Draft" }) },
    expectText: ["00412"],
  },
  {
    title: "Completed plan",
    hint: "A finished plan: whether the alternatives to deletion still make sense.",
    props: { plan: plan({ state: "Completed" }) },
    expectText: ["00412"],
  },
  {
    title: "Executing plan",
    hint: "A plan a job still holds. Deletion is refused server-side, so the copy must not promise it.",
    props: { plan: plan({ state: "Executing" }) },
    expectText: ["00412"],
  },
  {
    title: "Plan with a long title",
    hint: "The title appears in the body copy, so a long one is a wrapping case.",
    props: {
      plan: plan({
        title:
          "Give every dialog a scenario catalog that drives both the debug harness and an automated contract suite",
      }),
    },
    expectText: ["00412"],
  },
  {
    title: "Plan carrying worktrees and PRs",
    hint: "What deletion actually removes. A plan with commits and a PR open is the case where the consequence is largest.",
    props: {
      plan: plan({
        state: "Review",
        commits: ["a1b2c3d Add the registry", "e4f5g6h Add the contract runner"],
        prs: ["https://github.com/Ivy-Interactive/Ivy-Tendril-V2/pull/241"],
      }),
    },
    expectText: ["00412"],
  },
]);

export const removeProjectSurface = defineSurface(
  "RemoveProjectDialog",
  "dialog",
  RemoveProjectDialog,
  [
    {
      title: "Ordinary project",
      hint: "The base case. V1's body is a bare `This cannot be undone.`, which is vaguer than the truth and points the wrong way: `delete_project` removes the config entry and nothing on disk, so this *is* undone by adding the project back.",
      props: { projectName: "Ivy-Tendril-V2" },
      expectText: ["Ivy-Tendril-V2", "stay on disk"],
    },
    {
      title: "Project with a long name",
      hint: "The name is interpolated into the body, so a long one is a wrapping case.",
      props: { projectName: "Company.Product.Infrastructure.Provisioning" },
      expectText: ["Company.Product.Infrastructure.Provisioning"],
    },
    {
      title: "Name with spaces",
      hint: "The name is also the path segment the route is addressed by, so spaces are worth seeing rendered.",
      props: { projectName: "My Side Project" },
      expectText: ["My Side Project"],
    },
    {
      title: "Name with a dot prefix",
      hint: "A leading dot reads as a hidden folder. It is a legal project name and must render as itself.",
      props: { projectName: ".scratch" },
      expectText: [".scratch"],
    },
    {
      title: "Single-character name",
      hint: "The shortest legal name, where a layout that assumes width has nowhere to hide.",
      props: { projectName: "x" },
      expectText: ["x"],
    },
  ],
);

/**
 * The destructive sibling, and the app's only typed-name gate.
 *
 * Every scenario here opens with the confirm *disabled*, which is the state that matters: the
 * harness shows a dialog whose primary action is refused until the name is typed, and whose
 * Ctrl+Enter cap is absent for the same reason. The names below are the ones where typing is
 * awkward - spaces, a leading dot, a single character - because the gate is only as good as the
 * phrase it asks for.
 */
export const deleteProjectSurface = defineSurface(
  "DeleteProjectDialog",
  "dialog",
  DeleteProjectDialog,
  [
    {
      title: "Ordinary project",
      hint: "The base case, before anything is typed: the confirm is visible and refused, and the body lists what deletion actually removes.",
      props: { projectName: "Ivy-Tendril-V2" },
      expectText: ["Ivy-Tendril-V2", "cannot be undone", "Type"],
    },
    {
      title: "Project with a long name",
      hint: "The name appears in the body, in the path bullet, in the field label and as the placeholder - four wrapping cases from one string.",
      props: { projectName: "Company.Product.Infrastructure.Provisioning" },
      expectText: ["Company.Product.Infrastructure.Provisioning"],
    },
    {
      title: "Name with spaces",
      hint: "A name the operator has to reproduce exactly, spaces and all, to arm the confirm.",
      props: { projectName: "My Side Project" },
      expectText: ["My Side Project"],
    },
    {
      title: "Name with a dot prefix",
      hint: "A leading dot is easy to drop when retyping, which is the gate doing its job rather than a defect.",
      props: { projectName: ".scratch" },
      expectText: [".scratch"],
    },
    {
      title: "Single-character name",
      hint: "The weakest the gate ever is: one character. Still a deliberate act, and still not a slip of the mouse between two adjacent buttons.",
      props: { projectName: "x" },
      expectText: ["x"],
    },
  ],
);

export const resetToDraftSurface = defineSurface(
  "ResetToDraftDialog",
  "dialog",
  ResetToDraftDialog,
  [
    {
      title: "Failed plan",
      hint: "The ordinary case: execution failed and the plan goes back for another pass.",
      props: { plan: plan({ state: "Failed" }) },
      expectText: ["00412"],
    },
    {
      title: "Review plan",
      hint: "Execution succeeded but the work needs redoing. State change and worktree cleanup happen in one request, so the UI cannot leave a half-reset plan behind.",
      props: { plan: plan({ state: "Review" }) },
      expectText: ["00412"],
    },
    {
      title: "Completed plan",
      hint: "A terminal state the backend refuses. Covered in `TerminalStateRejection`; here it is the rendering half.",
      props: { plan: plan({ state: "Completed" }) },
      expectText: ["00412"],
    },
    {
      title: "Skipped plan",
      hint: "The other terminal state, which is refused for the same reason and must read the same way.",
      props: { plan: plan({ state: "Skipped" }) },
      expectText: ["00412"],
    },
    {
      title: "Executing plan",
      hint: "A job still holds the worktrees this would remove.",
      props: { plan: plan({ state: "Executing" }) },
      expectText: ["00412"],
    },
    {
      title: "Plan with many worktrees",
      hint: "Reset removes every worktree. A multi-repo plan is where that consequence is largest.",
      props: {
        plan: plan({
          state: "Failed",
          repos: ["/repos/Ivy-Tendril-V2", "/repos/Ivy-Framework", "/repos/Ivy-Tendril"],
        }),
      },
      expectText: ["00412"],
    },
  ],
);

export const partialDeliverySurface = defineSurface(
  "PartialDeliveryDialog",
  "dialog",
  PartialDeliveryDialog,
  [
    {
      title: "One failed verification",
      hint: "The singular case. Without the partial-delivery flag the same request is refused with a 409 listing the failures, which is what this dialog acknowledges by name.",
      props: {
        plan: plan({
          state: "Review",
          verifications: [
            { name: "RustClippy", status: "Fail" },
            { name: "NpmTest", status: "Pass" },
          ],
        }),
      },
      expectText: ["Verification Failed", "RustClippy"],
    },
    {
      title: "Several failed verifications",
      hint: "The plural case, and whether the list is readable at three.",
      props: {
        plan: plan({
          state: "Review",
          verifications: [
            { name: "RustClippy", status: "Fail" },
            { name: "RustTest", status: "Fail" },
            { name: "NpmTest", status: "Fail" },
          ],
        }),
      },
      expectText: ["Verification Failed"],
    },
    {
      title: "Many failed verifications",
      hint: "All nine of this repository's verifications failing: whether the list scrolls or grows the dialog.",
      props: {
        plan: plan({
          state: "Review",
          verifications: [
            { name: "NpmBuild", status: "Fail" },
            { name: "NpmLint", status: "Fail" },
            { name: "NpmTest", status: "Fail" },
            { name: "RustBuild", status: "Fail" },
            { name: "RustClippy", status: "Fail" },
            { name: "RustFormat", status: "Fail" },
            { name: "RustTest", status: "Fail" },
            { name: "Screenshots", status: "Fail" },
            { name: "CheckResult", status: "Fail" },
          ],
        }),
      },
      expectText: ["Verification Failed"],
    },
    {
      title: "Mixed pass and fail",
      hint: "The realistic case: most pass, one or two do not, and only the failures are the point.",
      props: {
        plan: plan({
          state: "Review",
          verifications: [
            { name: "NpmBuild", status: "Pass" },
            { name: "NpmTest", status: "Pass" },
            { name: "RustClippy", status: "Fail" },
            { name: "Screenshots", status: "Skipped" },
          ],
        }),
      },
      expectText: ["Verification Failed"],
    },
    {
      title: "Skipped, not failed",
      hint: "A verification that does not apply is marked Skipped rather than dropped, and Skipped is not a failure to acknowledge.",
      props: {
        plan: plan({
          state: "Review",
          verifications: [
            { name: "Screenshots", status: "Skipped" },
            { name: "NpmTest", status: "Pass" },
          ],
        }),
      },
      expectText: ["Verification Failed"],
    },
    {
      title: "No verifications at all",
      hint: "A plan carrying none. The dialog still has to say something coherent.",
      props: { plan: plan({ state: "Review", verifications: [] }) },
      expectText: ["Verification Failed"],
    },
    {
      title: "Pending verification",
      hint: "A verification that never ran, which is neither a pass to rely on nor a failure to acknowledge.",
      props: {
        plan: plan({
          state: "Review",
          verifications: [
            { name: "RustTest", status: "Pending" },
            { name: "NpmTest", status: "Fail" },
          ],
        }),
      },
      expectText: ["Verification Failed"],
    },
  ],
);
