import type { ChatSession } from "../../types/chat";

/**
 * How a store instance is narrowed to one plan, and the rule that decides whether a session is that
 * plan's. `PlanChatSessions` in V1, which is one file there for the same reason.
 */

/**
 * The plan a store instance is scoped to, so the chat beside a plan follows that plan's own
 * conversation and nothing else.
 *
 * This is V1's arrangement, not an invention: `PlanChatView` keeps its **own** `activeSessionId`
 * state over the one shared `IChatHistoryService`, and hands `Chat.ContentView` a `sessionDtos` list
 * of zero or one session — whatever `PlanChatSessions.FindForPlan` resolves. A second `ChatStore`
 * carrying a scope is that second `activeSessionId`.
 */
export interface ChatStorePlanScope {
  // The store keeps the object it is handed and reads it live rather than copying the fields out, so
  // a caller may refine it in place. The review page needs that: it renders the panel from a queue
  // row and only learns the plan's folder when the detail record lands, and the folder is what a new
  // session records as its owner.

  /** The plan's id as its folder records it — `00021`. */
  planId: string;
  /** `00021-BuildDesktopOperator`, which is the whole of `PlanChatSessions.BelongsTo`. */
  folderName?: string;
  /** `#21 Build Desktop Operator`: the title `PlanChatSessions.CreateForPlan` gives a new session. */
  sessionTitle: string;
}

/**
 * `PlanChatSessions.BelongsTo`: "A session belongs to exactly one plan, recorded on the session
 * itself." Matched case-insensitively, as V1's `StringComparison.OrdinalIgnoreCase` does.
 *
 * The id-prefix arm is V2's own. V1 can compare `plan.FolderName` directly because a `PlanFile`
 * always has one; a `PlanDetail` fetched without `folderPath` does not, and it still knows its
 * number, so `<id>-<slug>` is accepted as the second key rather than losing the conversation.
 */
export function sessionBelongsToPlan(session: ChatSession, scope: ChatStorePlanScope): boolean {
  const recorded = session.planFolderName?.toLowerCase();
  if (!recorded) return false;
  const folder = scope.folderName?.toLowerCase();
  if (folder && recorded === folder) return true;
  return recorded.startsWith(`${scope.planId.toLowerCase()}-`);
}
