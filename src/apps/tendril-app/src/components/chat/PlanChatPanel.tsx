import React, { useEffect, useMemo, useRef } from "react";
import { ChatStore, type ChatStorePlanScope } from "../../state/chatStore";
import {
  ChatView,
  buildPlanSamplePrompts,
  type SamplePrompt,
  type SamplePromptPlan,
} from "../../views/ChatView";

/** `PlanChatView.Headline`. */
export const PLAN_CHAT_HEADLINE = "Ask Tendril to Change Anything";

/** Everything the panel needs off the plan it sits beside. `PlanDetail` and `PlanSummary` both fit. */
export interface PlanChatPlan extends SamplePromptPlan {
  id: string;
  title: string;
  /** Absolute path of the plan folder; its last segment is `plan.FolderName`. */
  folderPath?: string;
}

/** `00021-Some-Plan` from the plan's folder path — what a session records in `planFolderName`. */
export const planFolderName = (plan: PlanChatPlan): string | undefined =>
  plan.folderPath ? plan.folderPath.split(/[/\\]/).pop() || undefined : undefined;

/** `#21`, not `#00021`, as `PlansView.formatPlanId` explains. */
const shortPlanId = (id: string): string => id.replace(/^0+(?=\d)/, "") || id;

/**
 * The chat panel beside a plan, which is V1's `Apps/Views/PlanChatView`: **not** a chat of its own but
 * "the plan's own session, hosted by the same content view the Chat app uses". V1 builds it by
 * constructing `new Chat.ContentView(...)` with `embedded: true`, and this does the same thing by
 * rendering {@link ChatView} with `embedded`.
 *
 * That is the whole point of the component. Everything the main chat has — the eventwire tool-call
 * stream and its cards, the Antigravity parser, the queue with its edit and send-now, the pinned
 * question and the jump-to-question control, the attachment chips, the confirm dialog, the composer's
 * one-line-to-toolbar layout, the spawned-job pill — is here because it is the same view, not because
 * it was ported twice.
 *
 * The four things V1 passes it, and they are the only four:
 * - a session/agent/model/effort state of its own → a plan-scoped {@link ChatStore},
 * - `greeting: $"#{plan.Id} {plan.Title}"` and `headline: PlanChatView.Headline`,
 * - `samplePrompts: SamplePrompts.ForPlan(plan)`,
 * - `startNewChat: () => { }`, a no-op — which `embedded` renders as no new-chat affordance at all.
 *
 * V1 additionally renders `isShareMode ? null : new PlanChatView(...)`. V2 has no share mode yet
 * (nothing in the app reads an `isShareMode`), so there is no arm to preserve; when one arrives, it
 * belongs at the two call sites, exactly as V1 puts it there.
 */
export const PlanChatPanel: React.FC<{
  plan: PlanChatPlan;
  /** A line the page wants drafted into the composer; a new `token` means "again". */
  draft?: { text: string; token: number };
  /** Opens the plan a job in this conversation reports. */
  onOpenPlan?: (planId: string) => void;
}> = ({ plan, draft, onOpenPlan }) => {
  const folder = planFolderName(plan);
  const sessionTitle = `#${shortPlanId(plan.id)} ${plan.title}`;

  /**
   * This panel's own store, which is V1's arrangement rather than a workaround for it: `PlanChatView`
   * holds its own `activeSessionId` over the one shared `IChatHistoryService`, so that selecting the
   * plan's conversation here does not move the Chat page's selection. Both stores read the same
   * daemon and the same `chat-event` stream; each filters that stream by its own active session, so a
   * turn in one is never written into the other.
   *
   * One store per plan, so switching plans builds a new one rather than re-pointing this one. The
   * scope it reads is refined in place rather than rebuilt: the review page renders this panel from a
   * queue row and only learns the plan's `folderPath` when the detail record lands a moment later.
   * Rebuilding the store then would tear a conversation down and put another in its place; taking the
   * folder on in place instead leaves the panel alone and simply widens what a *new* session records.
   * `ChatStorePlanScope` says the store reads the object live for this reason.
   */
  const scopeRef = useRef<ChatStorePlanScope>({
    planId: plan.id,
    folderName: folder,
    sessionTitle,
  });
  scopeRef.current.folderName = folder ?? scopeRef.current.folderName;
  scopeRef.current.sessionTitle = sessionTitle;

  const storeRef = useRef<{ planId: string; store: ChatStore } | null>(null);
  if (storeRef.current === null || storeRef.current.planId !== plan.id) {
    storeRef.current = { planId: plan.id, store: new ChatStore(scopeRef.current) };
  }
  const store = storeRef.current.store;

  /**
   * The store the panel stops using is taken down, whether that is because the panel went away or
   * because the plan beside it changed. So a plan page visited ten times leaves one `chat-event`
   * listener behind rather than ten. A destroyed store can be revived by `init()`, which is what
   * makes this safe under strict mode's mount / unmount / mount.
   *
   * `ChatView` destroys it on its own unmount as well, and both are idempotent — but neither is
   * redundant: this one covers a plan switch, where `ChatView` is not unmounted at all, only handed
   * a different store.
   */
  useEffect(() => () => store.destroy(), [store]);

  const samplePrompts: SamplePrompt[] = useMemo(
    () => buildPlanSamplePrompts(plan),
    // The chips are `SamplePrompts.ForPlan`'s four inputs and nothing else, so a plan object
    // rebuilt by a refetch does not rebuild them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan.state, plan.verifications, plan.prs, plan.dependsOn],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="plan-chat">
      <ChatView
        store={store}
        embedded
        greeting={sessionTitle}
        headline={PLAN_CHAT_HEADLINE}
        samplePrompts={samplePrompts}
        draftPrompt={draft}
        onOpenPlan={onOpenPlan}
      />
    </div>
  );
};
