import React from "react";
import { type PlanQuestion } from "@ivy-interactive/components/tendril";
import type { Job, PlanDetail, PlanSummary } from "../../types/api";
import type { ChatSession } from "../../types/chat";
import { sessionBelongsToPlan } from "../../state/chatStore";
import { planFolderName } from "../../components/chat/PlanChatPanel";
import { ErrorBanner } from "../../components/ErrorBanner";
import { formatPlanId } from "../PlansView";

/**
 * The plan page's vocabulary: the tab and dialog ids it switches on, the two in-flight sets its
 * gates read, the label and meta helpers `ContentView.Build` calls, and the three small views that
 * render a fixed shape. None of them touch the page's state, which is why they sit apart from it -
 * `findPlanChatSession` is called from outside the view entirely, and the tests drive the rest
 * without mounting anything.
 */

export type PlanDetailTab = "plan" | "details" | "diff" | "recommendations" | "git";

/**
 * The job statuses V1 counts as "a job already holds this plan"
 * (`ContentView.HasActiveJob<TArgs>`: `Running or Queued or Pending`). `Blocked` is deliberately not
 * one of them there, so it is not one here either: a blocked job is waiting on another job and V1
 * lets the second dispatch queue behind it.
 */
export const IN_FLIGHT_JOB_STATUSES: ReadonlyArray<Job["status"]> = [
  "Running",
  "Queued",
  "Pending",
];

/**
 * The plan states in which a job owns the plan folder.
 *
 * V1 never has to name these on the Drafts page because `PlansApp.Build` only ever hands it plans
 * that are `Draft` or `Blocked` **and** have no active job, so no mid-flight plan reaches the action
 * bar at all. V2's detail view is reachable for every plan, so the same exclusion has to be stated
 * here or the page offers Execute on a plan that is already executing.
 */
export const IN_FLIGHT_PLAN_STATES: ReadonlyArray<string> = ["Creating", "Updating", "Executing"];

/**
 * `PlanModels.cs`: `IsPullRequestSource => SourceUrl?.Contains("/pull/") == true`. The workspace
 * labels the source link "PR" or "Issue" from exactly this test
 * (`ContentView.Build`: `.Source(..., selectedPlan.IsPullRequestSource ? "PR" : "Issue")`).
 */
export const sourceLabel = (sourceUrl: string | undefined): string =>
  sourceUrl?.includes("/pull/") ? "PR" : "Issue";

/** `#21` from a `00021-SomeFolderName` plan folder, as `DetailsTabView.ParsePlanLinks` does. */
export const planLinkLabel = (folder: string): string => {
  const name = folder.split(/[/\\]/).pop() ?? folder;
  const dashIdx = name.indexOf("-");
  const idPart = dashIdx > 0 ? name.slice(0, dashIdx) : name;
  return formatPlanId(idPart);
};

/**
 * The workspace's meta line, from `ContentView.BuildMeta`: the plan's position in the list, and
 * the plans it waits on. Position is computed over the same newest-first ordering the list uses.
 */
export const buildMeta = (plan: PlanDetail, allPlans: PlanSummary[]): string | null => {
  const ordered = [...allPlans].sort(
    (a, b) => (Number.parseInt(b.id, 10) || 0) - (Number.parseInt(a.id, 10) || 0),
  );
  const index = ordered.findIndex((p) => p.id === plan.id);
  const parts: string[] = [];
  if (index >= 0 && ordered.length > 0) parts.push(`${index + 1}/${ordered.length} plans`);
  if (plan.dependsOn && plan.dependsOn.length > 0)
    parts.push(`Depends on ${plan.dependsOn.map(planLinkLabel).join(", ")}`);
  return parts.length > 0 ? parts.join(" \u00b7 ") : null;
};

/**
 * `ContentView.BuildFailureCallout`: a failed plan says why at the top of its Plan tab, and a
 * failed verification is the better answer than the job log. The report bodies V1 quotes live in
 * `<planFolder>/Verification/<name>.md`, which this page reads only inside the Verifications tab,
 * so the callout names the verifications and points at their reports rather than inventing a
 * summary. With no failed verification at all it falls back to V1's log wording.
 */
export const ExecutionFailedCallout: React.FC<{ plan: PlanDetail; jobs: Job[] }> = ({
  plan,
  jobs,
}) => {
  const failed = (plan.verifications ?? []).filter(
    (v) => v.status === "Fail" || v.status === "Pending",
  );
  // V1's second branch, `BuildLogFailureCallout`, reads the plan's last job log and quotes its
  // "Final Output" section. V2 has no log reader here, but the daemon already reports the same thing
  // on the job row, so the last failed job for this plan is the nearest equivalent — and it is a far
  // better answer than "check the logs".
  const lastFailure = [...jobs]
    .filter((j) => j.planId === plan.id && (j.status === "Failed" || j.status === "Timeout"))
    .sort((a, b) =>
      (a.completedAt ?? a.startedAt ?? "").localeCompare(b.completedAt ?? b.startedAt ?? ""),
    )
    .pop();
  const reason = lastFailure?.statusMessage?.trim();
  return (
    <ErrorBanner data-testid="plan-failure-callout" className="mb-4">
      <p className="font-semibold">Execution Failed</p>
      {failed.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {failed.map((v) => (
            <li key={v.name}>
              <span className="font-semibold">{v.name}</span> {v.status}, see verification report
              for details
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1" data-testid="plan-failure-reason">
          {reason || "No details available. Check the job logs."}
        </p>
      )}
    </ErrorBanner>
  );
};

/** One label/value row of the Details tab, dropped entirely when the value is empty. */
export const DetailRow: React.FC<{
  label: string;
  children?: React.ReactNode;
  empty?: boolean;
}> = ({ label, children, empty }) =>
  empty ? null : (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );

/**
 * The plan's own chat session, mirroring `PlanChatSessions.BelongsTo`: "A session belongs to exactly
 * one plan, recorded on the session itself". Matched case-insensitively as V1 does.
 *
 * V1 also consults `plan.ChatSessionId` first and then falls back to this scan; `PlanDetail` carries
 * no such field, and V1 calls it "a hint whose target must be checked before use" anyway, so the scan
 * is the whole of it here.
 *
 * The rule itself now lives in `chatStore` as `sessionBelongsToPlan`, because that is what narrows a
 * plan-scoped store's session list; this stays as the plan-shaped way in.
 */
export function findPlanChatSession(
  sessions: ChatSession[],
  plan: PlanDetail,
): ChatSession | undefined {
  const scope = {
    planId: plan.id,
    folderName: planFolderName(plan),
    sessionTitle: plan.title,
  };
  return sessions.find((session) => sessionBelongsToPlan(session, scope));
}

/**
 * The Questions dropdown, a port of `QuestionsPanelView`: "an index of every question in the plan,
 * so a long revision stays navigable. Clicking an entry scrolls its block into view."
 *
 * V1's presentation rules, kept exactly: the count line reads `{answered} of {total} answered`; an
 * entry carrying an answer is struck through and muted, "what stays live is what still wants a
 * human"; and an `optional: true` question says so beside its title but stays live until answered,
 * because "optional means the plan does not wait on it, not that anybody has dealt with it". The
 * label falls back title → header → id.
 *
 * `savingIds` is V2's own: V1's write is synchronous, so its panel never renders an answer that is
 * still on its way to disk. Here `bridge.updateLatestRevision` is awaited, so the in-flight moment
 * exists and is said out loud rather than looking already settled.
 */
export const PlanQuestionsPanel: React.FC<{
  questions: PlanQuestion[];
  savingIds: ReadonlySet<string>;
  onSelect: (questionId: string) => void;
}> = ({ questions, savingIds, onSelect }) => {
  const answered = questions.filter((q) => q.answerPresent).length;
  const label = (question: PlanQuestion) => question.title || question.header || question.id;

  return (
    <div className="space-y-2" data-testid="plan-questions-panel">
      <p className="text-xs text-muted-foreground">
        {answered} of {questions.length} answered
      </p>
      <ul className="space-y-1">
        {questions.map((question, index) => (
          <li key={`${index}:${question.id}`}>
            <button
              type="button"
              onClick={() => onSelect(question.id)}
              data-testid={`plan-question-${question.id}`}
              /* `SidebarListRow`'s hover treatment, and for its reason. The row used to carry
                 `hover:text-foreground` alone, which is invisible on the rows that most want the
                 affordance: an unanswered question is already `text-foreground`, so hovering it
                 changed nothing at all. `--accent` is no help either -- it is `#f8f8f8` on a
                 `#ffffff` surface, 1.06:1 -- so the fill is `--secondary`, which is what every
                 selected row in the app already uses. The padding and radius exist to give that
                 fill a shape; without them it paints a full-bleed band across the panel.
                 `cursor-pointer` is explicit rather than inherited: Tailwind v4's preflight dropped
                 v3's `button { cursor: pointer }`, so a bare <button> now falls back to `auto`. */
              className={`block w-full cursor-pointer rounded-selector px-2 py-1 text-left text-xs transition hover:bg-secondary/60 hover:text-foreground ${
                question.answerPresent ? "text-muted-foreground line-through" : "text-foreground"
              }`}
            >
              {question.optional ? `${label(question)} (Optional)` : label(question)}
            </button>
            {savingIds.has(question.id) && (
              <span className="text-2xs text-muted-foreground">saving…</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** The lifecycle dialogs this view owns, at most one open at a time. */
export type LifecycleDialog =
  | "update"
  | "createIssue"
  | "delete"
  | "reset"
  | "partialDelivery"
  | "suggestChanges"
  | "createPr";
