import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  PlanGitView,
  PlanMarkdown,
  PlanWorkspace,
  type PlanActionDto,
  type PlanQuestion,
  type PlanTabDto,
} from "@ivy-interactive/components/tendril";
import {
  describeBridgeError,
  type Annotation,
  type Job,
  type PlanDetail,
  type PlanGitData,
  type PlanSummary,
  type RecommendationItem,
  type RecommendationState,
  type RepoStatus,
  type StartJobResponse,
} from "../types/api";
import type { ChatMessage, ChatSession } from "../types/chat";
import { bridge } from "../api/bridge";
import { chatApi } from "../api/chatApi";
import { onChatEvent, onPlanEvent } from "../api/events";
import { extractPlanQuestions, patchQuestionsMarkdown } from "../utils/questionMarkdown";
import { PlanActionsController } from "../controllers/plan_actions";
import { PlanPullRequests } from "./PlanPullRequests";
import { draftActions, type DraftAction } from "../controllers/draft_actions";
import { collectExecuteGuards, type ExecuteGuard } from "../controllers/execute_guards";
import { PlanRevisionDiff } from "./PlanRevisionDiff";
import { PlanVerifications } from "./PlanVerifications";
import { formatPlanId, normalizePlanState, parseProjects, planStateBadgeClass } from "./PlansView";
import { RecommendationCard } from "../components/RecommendationCard";
import { RecommendationNoteDialog } from "../components/RecommendationNoteDialog";
import { CreateIssueDialog } from "./dialogs/CreateIssueDialog";
import { CreatePrDialog } from "./dialogs/CreatePrDialog";
import { DeletePlanDialog } from "./dialogs/DeletePlanDialog";
import { DirtyRepoDialog } from "./dialogs/DirtyRepoDialog";
import { DiscardPlanDialog } from "./dialogs/DiscardPlanDialog";
import { PartialDeliveryDialog } from "./dialogs/PartialDeliveryDialog";
import { PendingAnnotationsDialog } from "./dialogs/PendingAnnotationsDialog";
import { ResetToDraftDialog } from "./dialogs/ResetToDraftDialog";
import { SuggestChangesDialog } from "./dialogs/SuggestChangesDialog";
import { UnansweredQuestionsDialog } from "./dialogs/UnansweredQuestionsDialog";
import { UpdatePlanDialog } from "./dialogs/UpdatePlanDialog";

type PlanDetailTab = "plan" | "details" | "diff" | "recommendations" | "git";

/**
 * The job statuses V1 counts as "a job already holds this plan"
 * (`ContentView.HasActiveJob<TArgs>`: `Running or Queued or Pending`). `Blocked` is deliberately not
 * one of them there, so it is not one here either: a blocked job is waiting on another job and V1
 * lets the second dispatch queue behind it.
 */
const IN_FLIGHT_JOB_STATUSES: ReadonlyArray<Job["status"]> = ["Running", "Queued", "Pending"];

/**
 * The plan states in which a job owns the plan folder.
 *
 * V1 never has to name these on the Drafts page because `PlansApp.Build` only ever hands it plans
 * that are `Draft` or `Blocked` **and** have no active job, so no mid-flight plan reaches the action
 * bar at all. V2's detail view is reachable for every plan, so the same exclusion has to be stated
 * here or the page offers Execute on a plan that is already executing.
 */
const IN_FLIGHT_PLAN_STATES: ReadonlyArray<string> = ["Creating", "Updating", "Executing"];

/**
 * `PlanModels.cs`: `IsPullRequestSource => SourceUrl?.Contains("/pull/") == true`. The workspace
 * labels the source link "PR" or "Issue" from exactly this test
 * (`ContentView.Build`: `.Source(..., selectedPlan.IsPullRequestSource ? "PR" : "Issue")`).
 */
const sourceLabel = (sourceUrl: string | undefined): string =>
  sourceUrl?.includes("/pull/") ? "PR" : "Issue";

/** `#21` from a `00021-SomeFolderName` plan folder, as `DetailsTabView.ParsePlanLinks` does. */
const planLinkLabel = (folder: string): string => {
  const name = folder.split(/[/\\]/).pop() ?? folder;
  const dashIdx = name.indexOf("-");
  const idPart = dashIdx > 0 ? name.slice(0, dashIdx) : name;
  return formatPlanId(idPart);
};

/**
 * The workspace's meta line, from `ContentView.BuildMeta`: the plan's position in the list, and
 * the plans it waits on. Position is computed over the same newest-first ordering the list uses.
 */
const buildMeta = (plan: PlanDetail, allPlans: PlanSummary[]): string | null => {
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
const ExecutionFailedCallout: React.FC<{ plan: PlanDetail; jobs: Job[] }> = ({ plan, jobs }) => {
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
    <div
      role="alert"
      data-testid="plan-failure-callout"
      className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
    >
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
    </div>
  );
};

/** One label/value row of the Details tab, dropped entirely when the value is empty. */
const DetailRow: React.FC<{ label: string; children?: React.ReactNode; empty?: boolean }> = ({
  label,
  children,
  empty,
}) =>
  empty ? null : (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm text-foreground">{children}</dd>
    </div>
  );

/**
 * Why answering a question cannot be persisted yet.
 *
 * V1 merges an answer into the **same** revision — `ContentView.ApplyAnswer` calls
 * `IPlanReaderService.UpdateLatestRevision`, on the stated grounds that "answering a question is not
 * a new revision of the plan, it is filling in a blank the plan left". The service exposes no HTTP
 * route for that write: `POST /api/plans/{id}/revisions` (`PlanController.WriteRevision`) is
 * `RevisionWriter.WriteNext`, which **appends**. Using it would inflate `revisionCount`, and the
 * PendingAnnotations guard's own "answers not yet folded in" term is defined as
 * `state === "Draft" && revisionCount === 1` (`execute_guards.unfoldedAnswerCount`), so an append
 * would silently switch that guard off. So the picker works, the answer is held on the page, and this
 * says plainly that it did not reach disk.
 */
const ANSWER_WRITE_UNAVAILABLE =
  "Answer recorded on this page only: the service has no route that writes an answer back into the " +
  "same revision. `POST /api/plans/{id}/revisions` appends a new one, which would break the execute " +
  "guard's revision test. Needed: an in-place write (`PUT /api/plans/{id}/revisions/latest`) onto " +
  "`IPlanReaderService.UpdateLatestRevision`.";

/** Why a plan with no chat session yet cannot be given one from here. */
const PLAN_CHAT_UNAVAILABLE =
  "This plan has no chat session yet, and one cannot be started here: `cmd_create_chat_session` " +
  "takes no `planFolderName`, so nothing can create the plan-attached session V1's " +
  "`PlanChatSessions.CreateForPlan` creates.";

/** `00021-Some-Plan` from the plan's folder path — what a chat session records in `planFolderName`. */
const planFolderName = (plan: PlanDetail): string | undefined =>
  plan.folderPath ? plan.folderPath.split(/[/\\]/).pop() || undefined : undefined;

/**
 * The plan's own chat session, mirroring `PlanChatSessions.BelongsTo`: "A session belongs to exactly
 * one plan, recorded on the session itself". Matched case-insensitively as V1 does.
 *
 * V1 also consults `plan.ChatSessionId` first and then falls back to this scan; `PlanDetail` carries
 * no such field, and V1 calls it "a hint whose target must be checked before use" anyway, so the scan
 * is the whole of it here. The id prefix is accepted as a second key because a plan detail fetched
 * without `folderPath` still knows its number, and the folder is `<id>-<slug>`.
 */
export function findPlanChatSession(
  sessions: ChatSession[],
  plan: PlanDetail,
): ChatSession | undefined {
  const folder = planFolderName(plan)?.toLowerCase();
  return sessions.find((session) => {
    const recorded = session.planFolderName?.toLowerCase();
    if (!recorded) return false;
    return recorded === folder || recorded.startsWith(`${plan.id.toLowerCase()}-`);
  });
}

/** One heading of the plan document, as the contents panel lists it. */
export interface PlanTocEntry {
  level: number;
  text: string;
  /** Which same-named heading this is, so two `## Problem`s stay distinguishable. */
  occurrence: number;
}

/** Inline markdown reduced to the text `PlanMarkdown` will actually render for it. */
const inlineText = (raw: string): string =>
  raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, "")
    .trim();

/**
 * The plan's headings, in document order.
 *
 * V1 has no table-of-contents widget: its plan page never fills `PlanMarkdown`'s `StickyContent`
 * slot. But that slot is V1's own designated place for one — `PlanMarkdown.cs` documents it as
 * "pinned in place and unaffected by the [markdown] scroll", and the widget's sample app names
 * "**Table of contents** — navigate long documents without losing position" as its first use case
 * (`Ivy.Tendril.Widgets/.samples/Apps/DraftMarkdown/StickyContentApp.cs`). So this is V1's mechanism
 * filled in, not a new surface invented beside it.
 *
 * Fenced code is skipped following CommonMark, the same reason `questionsSource.scan` does it: a plan
 * that documents markdown must not have its examples read as its own structure.
 */
export function extractPlanHeadings(markdown: string | undefined): PlanTocEntry[] {
  const entries: PlanTocEntry[] = [];
  if (!markdown) return entries;

  const counts = new Map<string, number>();
  let openFence: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const run = fence[1];
      if (openFence === null) openFence = run;
      else if (run[0] === openFence[0] && run.length >= openFence.length) openFence = null;
      continue;
    }
    if (openFence !== null) continue;

    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (!heading) continue;
    const text = inlineText(heading[2]);
    if (!text) continue;
    const occurrence = counts.get(text) ?? 0;
    counts.set(text, occurrence + 1);
    entries.push({ level: heading[1].length, text, occurrence });
  }

  return entries;
}

/**
 * The contents panel pinned beside the plan, rendered into `PlanMarkdown`'s `StickyContent` slot.
 *
 * Indented by heading level and capped in height, because it shares the pane with the document; the
 * top-level `# ` title is dropped, since a contents list whose first row is the page title navigates
 * to where the reader already is.
 */
const PlanContentsPanel: React.FC<{
  entries: PlanTocEntry[];
  onSelect: (entry: PlanTocEntry) => void;
}> = ({ entries, onSelect }) => {
  const shown = entries.filter((entry) => entry.level > 1);
  if (shown.length === 0) return null;

  return (
    <nav
      aria-label="Plan contents"
      data-testid="plan-toc"
      className="max-h-[60vh] w-52 overflow-y-auto py-4"
    >
      <p className="mb-2 text-xs font-semibold text-muted-foreground">Contents</p>
      <ul className="space-y-0.5">
        {shown.map((entry) => (
          <li key={`${entry.level}:${entry.text}:${entry.occurrence}`}>
            <button
              type="button"
              onClick={() => onSelect(entry)}
              style={{ paddingLeft: `${(entry.level - 2) * 10}px` }}
              className="block w-full truncate text-left text-xs text-muted-foreground transition hover:text-foreground"
              title={entry.text}
            >
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
};

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
 * `unsavedIds` is V2's own: an answer that only exists on this page is flagged, since V1's never are
 * (its write lands before the panel re-renders).
 */
const PlanQuestionsPanel: React.FC<{
  questions: PlanQuestion[];
  unsavedIds: ReadonlySet<string>;
  onSelect: (questionId: string) => void;
}> = ({ questions, unsavedIds, onSelect }) => {
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
              className={`block w-full text-left text-xs transition hover:text-foreground ${
                question.answerPresent ? "text-muted-foreground line-through" : "text-foreground"
              }`}
            >
              {question.optional ? `${label(question)} (Optional)` : label(question)}
            </button>
            {unsavedIds.has(question.id) && (
              <span className="text-[10px] text-warning">not saved</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * The chat panel beside the plan, V1's `PlanChatView`: "the plan's own session, hosted by the same
 * content view the Chat app uses", under the headline `PlanChatView.Headline`.
 *
 * Deliberately talks to `chatApi` rather than `chatStore`: the store is a singleton with one
 * `activeSessionId`, which the Chat page owns, and selecting this plan's session through it would
 * move the Chat page too. V1 has the same split — `PlanChatView` keeps its own `activeSessionId`
 * state over the shared `IChatHistoryService`.
 */
const PlanChatPanel: React.FC<{
  plan: PlanDetail;
  /** A line the page wants drafted into the composer; a new `token` means "again". */
  draft: { text: string; token: number };
  onError: (message: string) => void;
}> = ({ plan, draft, onError }) => {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyed on the token, not the text, so "Discuss" twice re-drafts the same line over an edited one.
  useEffect(() => {
    if (draft.token > 0) setPrompt(draft.text);
  }, [draft.token, draft.text]);

  const load = useCallback(async () => {
    const sessions = await chatApi.listSessions();
    const found = findPlanChatSession(sessions, plan);
    if (!found) return null;
    // The list route carries no messages, so the session itself has to be read.
    const full = await chatApi.getSession(found.id).catch(() => found);
    return full;
  }, [plan]);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    void load()
      .then((found) => {
        if (!cancelled) setSession(found);
      })
      .catch(() => {
        // No session list is the same as no session: the panel offers its composer and says why a
        // send cannot go anywhere, rather than refusing to render.
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  /**
   * The agent answers out of band, so the panel follows the same stream the Chat page does — V1's
   * `PlanChatView` subscribes to `StreamUpdated` and `SessionsChanged` for the same reason, and
   * filters on the session id exactly like this.
   *
   * Keyed on the id rather than the session object: a re-read replaces the object, and depending on
   * it would tear the subscription down and build it up again on every message.
   */
  const sessionId = session?.id;
  useEffect(() => {
    if (!sessionId) return;
    const signal = { cancelled: false };
    let unlisten: (() => void) | undefined;

    void onChatEvent((payload) => {
      const event = payload as { sessionId?: string } | null;
      if (event?.sessionId !== sessionId) return;
      void chatApi
        .getSession(sessionId)
        .then((next) => {
          if (!signal.cancelled) setSession(next);
        })
        .catch(() => {});
    })
      .then((fn) => {
        if (signal.cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      signal.cancelled = true;
      unlisten?.();
    };
  }, [sessionId]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [session?.messages?.length]);

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    if (!session) {
      onError(PLAN_CHAT_UNAVAILABLE);
      return;
    }
    setSending(true);
    try {
      await chatApi.executeTurn(session.id, { prompt: text });
      setPrompt("");
      setSession(await chatApi.getSession(session.id).catch(() => session));
    } catch (err) {
      onError(`Chat message failed: ${describeBridgeError(err)}`);
    } finally {
      setSending(false);
    }
  };

  const messages: ChatMessage[] = session?.messages ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-testid="plan-chat">
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="pt-6 text-center text-sm font-medium text-muted-foreground">
            Ask Tendril to Change Anything
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              data-testid={`plan-chat-message-${message.role}`}
              className={`rounded-lg border border-border p-2 text-xs whitespace-pre-wrap ${
                message.role === "user" ? "bg-muted text-foreground" : "bg-card text-foreground"
              }`}
            >
              {message.content}
            </div>
          ))
        )}
      </div>
      <div className="flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          aria-label="Message this plan's chat"
          placeholder="Ask Tendril anything..."
          className="w-full resize-none rounded-lg border border-border bg-background p-2 text-xs text-foreground"
        />
        <button
          type="button"
          disabled={sending || prompt.trim().length === 0}
          onClick={() => void send()}
          className="self-end rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground/70"
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
};

/** The lifecycle dialogs this view owns, at most one open at a time. */
type LifecycleDialog =
  | "update"
  | "createIssue"
  | "delete"
  | "discard"
  | "reset"
  | "partialDelivery"
  | "suggestChanges"
  | "createPr";

interface PlanDetailViewProps {
  plan: PlanDetail;
  allPlans?: PlanSummary[];
  /** Repos to offer the Create Issue dialog when the plan records none. */
  projectRepos?: string[];
  /**
   * The live job list. `UpdatePlanDialog` reads it to refuse a second UpdatePlan while one is still
   * in flight, as V1 does — two agents rewriting one plan file at once is how a plan ends up with
   * half of each.
   */
  jobs?: Job[];
  /** Dispatches ExecutePlan — called only once every guard has been passed.
   *  A rejection is surfaced in the action error banner rather than swallowed. */
  onExecute?: (planId: string) => void | Promise<void>;
  /** A job one of the dialogs started, so the shell can open its session tab. */
  onJobStarted?: (response: StartJobResponse) => void;
  /** The plan's state changed on the service; the caller should re-fetch it. */
  onPlanChanged?: (planId: string) => void;
  onPlanDeleted?: (planId: string) => void;
  onBack?: () => void;
}

export const PlanDetailView: React.FC<PlanDetailViewProps> = ({
  plan,
  allPlans = [],
  projectRepos = [],
  jobs = [],
  onExecute,
  onJobStarted,
  onPlanChanged,
  onPlanDeleted,
  onBack,
}) => {
  // V1's tab ids (`ContentView.PlanTab` / `DetailsTab` / `GitTab`), plus the three tabs V2
  // adds. Order matters: see the tab strip below.
  const [activeSubTab, setActiveSubTab] = useState<PlanDetailTab>("plan");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>(
    plan.recommendations || [],
  );
  const [activeNoteDialog, setActiveNoteDialog] = useState<{
    title: string;
    action: "Accept" | "Decline";
  } | null>(null);
  const [activeDialog, setActiveDialog] = useState<LifecycleDialog | null>(null);
  // The pre-execution guard chain. `guards` is empty unless one is open, and
  // `onExecute` fires only after the last one has been passed.
  const [guards, setGuards] = useState<ExecuteGuard[]>([]);
  const [guardIndex, setGuardIndex] = useState(0);
  /**
   * True while the pre-execution checks are running.
   *
   * V1 has this as `isCheckingPreflight` from `Context.UsePreflightCheck()` and spends it on the
   * Execute button: `disabled: isCheckingPreflight, loading: isCheckingPreflight`
   * (`ContentView.Build`). The checks shell out to git in every repo of the plan's project, so
   * without it a second click during the first check runs the whole chain twice and can dispatch
   * two ExecutePlan jobs.
   */
  const [isCheckingPreflight, setIsCheckingPreflight] = useState(false);
  /**
   * V1's `TransitionPlanOptimistically`: the state the plan is *about* to be in, shown until the
   * service confirms it. `JobService.StartJob` owns the authoritative transition, so this exists
   * purely so the badge and the action set stop offering Execute the instant it was pressed.
   *
   * Cleared whenever the plan prop's own state moves, which is the confirmation arriving.
   */
  const [optimisticState, setOptimisticState] = useState<string | null>(null);
  /**
   * Verification statuses this page has written but not yet seen come back on the plan.
   *
   * V1 does not need this: `VerificationsPanelView` writes through `planService` and the whole view
   * rebuilds off the refreshed `PlanFile`. Here the plan arrives as a prop, so without carrying the
   * write forward the header's Create PR / Accept Partial Delivery gates would keep reading the
   * statuses from before the toggle.
   */
  const [verificationOverrides, setVerificationOverrides] = useState<
    Record<string, PlanDetail["verifications"][number]["status"]>
  >({});

  /**
   * The revision as the reader is answering it.
   *
   * V1's own comment: "The revision as the user is editing it. Answers are merged in here and written
   * straight back to the same revision file — answering a question is not a new revision of the plan,
   * it is filling in a blank the plan left." Reset when the plan's content moves underneath, which is
   * the same trigger V1 uses to reseed it.
   */
  const [revisionContent, setRevisionContent] = useState(plan.latestRevisionContent ?? "");
  /** Answers merged into `revisionContent` that never reached the service. See `ANSWER_WRITE_UNAVAILABLE`. */
  const [unsavedAnswers, setUnsavedAnswers] = useState<ReadonlySet<string>>(new Set());
  /**
   * Brings a question into view when its index entry is clicked. V1: "The token is what makes a
   * repeat click work — an unchanged id compares equal and nothing would move."
   */
  const [scrollTo, setScrollTo] = useState<{ questionId: string; token: number } | null>(null);

  useEffect(() => {
    setRevisionContent(plan.latestRevisionContent ?? "");
    setUnsavedAnswers(new Set());
    setScrollTo(null);
  }, [plan.latestRevisionContent]);

  /** The plan's questions as the page currently holds them, for the index and its answered count. */
  const questions = useMemo<PlanQuestion[]>(() => {
    try {
      return extractPlanQuestions(revisionContent);
    } catch {
      // A malformed fence renders as prose rather than a picker, so it indexes as nothing.
      return [];
    }
  }, [revisionContent]);

  /**
   * The unanswered count the workspace badges and its dot follow.
   *
   * Read from the *persisted* revision, not from `revisionContent`: an answer this page is holding
   * but could not write is not answered as far as the execute guard is concerned, and a dot that went
   * out on an unsaved answer would be lying. `ContentView.CountUnansweredQuestions` counts every
   * question without an answer, optional ones included — the badge says how much of the plan is still
   * blank, which is not the same question as what blocks execution.
   */
  const unansweredQuestions = useMemo(() => {
    try {
      return extractPlanQuestions(plan.latestRevisionContent ?? "").filter((q) => !q.answerPresent)
        .length;
    } catch {
      return 0;
    }
  }, [plan.latestRevisionContent]);

  /**
   * Answers already written into the revision on disk. The second term of V1's Update Plan badge
   * (`activeAnnotationCount + answeredQuestions`), read from the persisted revision because that is
   * what the UpdatePlan job will read.
   */
  const answeredQuestionCount = useMemo(() => {
    try {
      return extractPlanQuestions(plan.latestRevisionContent ?? "").filter((q) => q.answerPresent)
        .length;
    } catch {
      return 0;
    }
  }, [plan.latestRevisionContent]);

  /**
   * A line the page wants the chat composer pre-filled with, and a token so asking twice works — the
   * same shape, and the same reason, as `scrollTo`. "Discuss with agent" is the one thing that sets it.
   */
  const [chatDraft, setChatDraft] = useState<{ text: string; token: number }>({
    text: "",
    token: 0,
  });

  /** Where the plan document is mounted, so the contents panel can drive its scroll. */
  const planPaneRef = useRef<HTMLDivElement>(null);

  const toc = useMemo(() => extractPlanHeadings(revisionContent), [revisionContent]);

  /**
   * Scrolls a heading to the top of the document pane.
   *
   * The same move `PlanMarkdown`'s own `scrollTo` effect makes, and for the reason it gives: "The
   * widget owns its own scroll, so move that rather than calling scrollIntoView, which would also drag
   * every scrollable ancestor of the host page along with it."
   */
  const scrollToHeading = useCallback((entry: PlanTocEntry) => {
    const pane = planPaneRef.current;
    const shell = pane?.querySelector<HTMLElement>(".pmv-shell");
    const body = pane?.querySelector<HTMLElement>(".pmv-markdown");
    if (!shell || !body) return;
    const matching = Array.from(body.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(
      (heading) => heading.textContent?.trim() === entry.text,
    );
    const target = matching[entry.occurrence] ?? matching[0];
    if (!target) return;
    const delta = target.getBoundingClientRect().top - shell.getBoundingClientRect().top - 16;
    shell.scrollTo({ top: shell.scrollTop + delta, behavior: "smooth" });
  }, []);

  /**
   * V1's `ContentView.ApplyAnswer`, minus the write it cannot make.
   *
   * The merge is the local half of what `QuestionAnswers.TryApply` does server-side: only the
   * addressed question's `answer` key changes, every other byte of the document is left alone. What
   * V1 does next — `planService.UpdateLatestRevision(...)` — has no route here, so the answer is held
   * and said to be held. See `ANSWER_WRITE_UNAVAILABLE`.
   */
  const applyAnswer = useCallback(
    (questionId: string, answer: string[]) => {
      // Merged off the current value rather than inside a state updater: an updater must stay pure, and
      // this one would otherwise raise the banner twice under StrictMode's double invocation.
      const merged = patchQuestionsMarkdown(revisionContent, { [questionId]: answer });
      // `TryApply` "reports a miss instead of throwing … a stale answer is worth ignoring".
      if (merged === revisionContent) return;
      setRevisionContent(merged);
      setUnsavedAnswers((prev) => new Set(prev).add(questionId));
      setActionError(ANSWER_WRITE_UNAVAILABLE);
    },
    [revisionContent],
  );

  /**
   * Everything a plan switch has to forget, mirroring `ContentView.Build`'s plan-change block.
   *
   * Keyed on the plan's id and not on the prop's identity, exactly as V1 keys it: "every refresh
   * hands the state a fresh PlanFile instance of the same plan, and that must not throw the reader
   * back to the first tab". The open dialogs matter most — V1 spells out why it closes the questions
   * dialog here: "Left open across a switch, 'Execute Anyway' would run the new plan on a
   * confirmation the user gave for the old one."
   */
  useEffect(() => {
    setActiveSubTab("plan");
    setActiveDialog(null);
    setActiveNoteDialog(null);
    setGuards([]);
    setGuardIndex(0);
    setIsCheckingPreflight(false);
    setActionError(null);
    setPendingAction(null);
    setOptimisticState(null);
    setVerificationOverrides({});
  }, [plan.id]);

  // The service has spoken, so the guess is spent. Comparing against the raw prop rather than the
  // normalised value keeps a legacy-named state from looking like a change on every render.
  useEffect(() => {
    setOptimisticState(null);
    setVerificationOverrides({});
  }, [plan.state, plan.updated]);

  useEffect(() => {
    setRecommendations(plan.recommendations || []);
    let cancelled = false;
    bridge
      .listRecommendations(plan.id)
      .then((recs) => {
        if (!cancelled && recs) {
          setRecommendations(recs);
        }
      })
      .catch(() => {
        // Fall back to initial plan.recommendations
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id, plan.recommendations]);

  /**
   * The plan's inline annotations, which is what `PlanMarkdown` needs to render its highlights and
   * what the PendingAnnotations execute guard counts.
   *
   * Reloaded when the revision text changes, because V1 does exactly that and says why:
   * "Annotation offsets anchor to the plan text; drop them if the content changed underneath (plan
   * updated, edited, or revised)" (`ContentView.Build`).
   */
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const loadAnnotations = useCallback(() => {
    let cancelled = false;
    bridge
      .listAnnotations(plan.id)
      .then((list) => {
        if (!cancelled) setAnnotations(list);
      })
      .catch(() => {
        // An unreadable list is an empty one: the guard degrades to "nothing known", never to a
        // page that will not render.
        if (!cancelled) setAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  useEffect(
    () => loadAnnotations(),
    // `latestRevisionContent` is in here on purpose: see the note above.
    [loadAnnotations, plan.latestRevisionContent],
  );

  /**
   * Another window, or a job, can rewrite this plan's annotations. V1 subscribes to
   * `IPlanAnnotationService.AnnotationsChanged` for the same reason and filters on the folder path
   * (`ContentView.Build`); the daemon's equivalent is the `plan.annotations_changed` broadcast.
   */
  useEffect(() => {
    const signal = { cancelled: false };
    let unlisten: (() => void) | undefined;

    void onPlanEvent((payload) => {
      const event = payload as { type?: string; planId?: string } | null;
      if (event?.type !== "plan.annotations_changed") return;
      // Every plan shares the one channel, so another plan's change is not ours.
      if (event.planId !== plan.id) return;
      loadAnnotations();
    })
      .then((fn) => {
        if (signal.cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => {
        // Without the stream the highlights are merely not live; every write still replaces the list
        // from what the service persisted.
      });

    return () => {
      signal.cancelled = true;
      unlisten?.();
    };
  }, [plan.id, loadAnnotations]);

  /**
   * Persist an annotation edit.
   *
   * `PlanMarkdown` reports the whole array rather than the one thing that changed, exactly as V1's
   * `OnAnnotationsChange` does — V1 can hand that straight to
   * `IPlanAnnotationService.SaveAnnotationsAsync`, which takes a list. The bridge here is
   * per-annotation, so the array is diffed against what we had: anything new or changed is upserted,
   * anything gone is deleted. The persisted list is what lands in state, so a rejected write leaves
   * the highlights showing what is actually on disk.
   */
  const handleAnnotationsChange = (next: Annotation[]) => {
    const previous = annotations;
    setAnnotations(next);

    const byId = new Map(previous.map((a) => [a.id, a]));
    const writes: (() => Promise<Annotation[]>)[] = [];
    for (const annotation of next) {
      const before = byId.get(annotation.id);
      if (!before || JSON.stringify(before) !== JSON.stringify(annotation)) {
        writes.push(() => bridge.upsertAnnotation(plan.id, annotation));
      }
    }
    const keptIds = new Set(next.map((a) => a.id));
    for (const annotation of previous) {
      if (!keptIds.has(annotation.id)) {
        writes.push(() => bridge.deleteAnnotation(plan.id, annotation.id));
      }
    }
    if (writes.length === 0) return;

    // Sequenced as thunks, not fired off together: each call answers with the plan's whole list, so
    // overlapping writes would race to be the one whose snapshot sticks.
    void writes
      .reduce<Promise<Annotation[]>>(
        (chain, write) => chain.then(() => write()),
        Promise.resolve(next),
      )
      .then(setAnnotations)
      .catch((err: unknown) => {
        setAnnotations(previous);
        setActionError(`Failed to save annotation: ${describeBridgeError(err)}`);
      });
  };

  // Fetched on mount rather than when the Git tab is opened: the at-risk badge on
  // the tab button is the whole point of the feature, and a warning you only see
  // once you have clicked into the tab is not a warning. A rejection is confined to
  // the Git tab's own body — it must not disturb the other tabs or the action banner.
  const [gitData, setGitData] = useState<PlanGitData | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  /**
   * What the git read is keyed on.
   *
   * `plan.id` alone is not enough. V1 makes this point explicitly where it revalidates the plan
   * content query on a watcher event (`ContentView.Build`): "Without this the query key (the folder
   * path) never changes while a plan is open, so the cached content - commits, git changes,
   * artifacts - is served for the life of the view even while a job is executing the plan." A refetch
   * of the plan hands us a new object with the same id, so the worktrees, the commit reachability
   * verdicts and the at-risk badge would all be frozen at whatever they were when the tab opened.
   *
   * `updated` is bumped by every `plan.yaml` write, so it is the change signal; the commit and PR
   * counts are included because they are what the Git tab actually renders.
   */
  const gitQueryKey = `${plan.id}|${plan.updated ?? ""}|${plan.state}|${
    plan.commits?.length ?? 0
  }|${plan.prs?.length ?? 0}`;

  useEffect(() => {
    // The last-known-good data stays on screen across a revalidation. V1 makes the same call for the
    // same reason (`ContentView.ShouldShowLoadingPlaceholder`: "a revalidation keeps the
    // last-known-good content"), and only a plan switch is allowed to blank it.
    setGitError(null);
    let cancelled = false;
    bridge
      .getPlanGit(plan.id)
      .then((data) => {
        if (!cancelled && data) {
          setGitData(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setGitError(describeBridgeError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [plan.id, gitQueryKey]);

  // A plan switch, on the other hand, must not show the previous plan's git state while the new
  // one loads.
  useEffect(() => {
    setGitData(null);
  }, [plan.id]);

  // Legacy's CountGitItems: worktrees + recorded commits + pull requests.
  const gitItemCount = gitData
    ? gitData.worktrees.length + (plan.commits?.length ?? 0) + (plan.prs?.length ?? 0)
    : null;

  const commitsAtRisk = gitData
    ? Object.values(gitData.unassociatedCommitRefStatus).filter(
        (status) => status === "unreachable" || status === "missing",
      ).length
    : 0;

  /**
   * The workspace's own tab strip (`PlanTabDto[]`), in V1's order. `ContentView.Build` adds Git only
   * when it has something to show (`if (gitItemCount > 0) tabs.Add(...)`); a null count means the
   * fetch has not answered yet, so the tab stays rather than appearing and disappearing under the
   * pointer.
   *
   * This is the strip *inside* the plan page, not the shell's bottom strip — nothing here opens or
   * closes a shell tab.
   *
   * Counts stay inside the label rather than becoming `PlanTabDto.badge` elements, so a tab's
   * accessible name still carries its count. Verifications is deliberately **not** a tab: V1 puts it
   * in the tab strip's corner dropdown (`VerificationsPanelView` in the workspace's `Verifications`
   * slot), which is where it now lives here too.
   */
  const tabs: { id: PlanDetailTab; label: string; badge?: string }[] = [
    { id: "plan", label: "Plan" },
    { id: "details", label: "Details" },
    { id: "diff", label: "Diff View" },
    { id: "recommendations", label: `Recommendations (${recommendations.length})` },
  ];
  if (gitItemCount === null || gitItemCount > 0) {
    // The at-risk warning used to be a bare dot with an `aria-label`; a `PlanTabDto` carries only a
    // label and a badge, so the count becomes the badge (`new PlanTabDto(GitTab, "Git", count)` is how
    // V1 badges this tab) and the label says what it counts, which no dot could.
    const label = gitItemCount === null ? "Git" : `Git (${gitItemCount})`;
    tabs.push({
      id: "git",
      label: commitsAtRisk > 0 ? `${label} · ${commitsAtRisk} at risk` : label,
      badge: commitsAtRisk > 0 ? String(commitsAtRisk) : undefined,
    });
  }

  // `var activeTab = tabs.Any(t => t.Id == selectedTab.Value) ? selectedTab.Value : PlanTab;`
  const effectiveTab: PlanDetailTab = tabs.some((t) => t.id === activeSubTab)
    ? activeSubTab
    : "plan";

  const meta = buildMeta(plan, allPlans);

  /**
   * The plan as this page currently believes it to be: the prop, plus the state it has optimistically
   * moved and the verification statuses it has written.
   *
   * Every gate below reads this rather than the prop, which is what makes an action stop offering
   * itself the moment it has been taken — V1 gets the same effect by writing the optimistic plan
   * straight into `selectedPlanState` (`ContentView.TransitionPlanOptimistically`).
   *
   * `state` is also normalised here, so a plan still recorded under a legacy name is gated as the
   * state it actually is: without this a `ReadyForReview` plan is not `"Review"`, so Create PR,
   * Retry Plan and Accept Partial Delivery all silently vanish from a plan sitting in review.
   */
  const effectivePlan: PlanDetail = React.useMemo(() => {
    const state = (optimisticState ?? normalizePlanState(plan.state)) as PlanDetail["state"];
    const overrides = Object.keys(verificationOverrides);
    const verifications =
      overrides.length === 0
        ? plan.verifications
        : (plan.verifications ?? []).map((v) =>
            v.name in verificationOverrides ? { ...v, status: verificationOverrides[v.name] } : v,
          );
    if (state === plan.state && verifications === plan.verifications) return plan;
    return { ...plan, state, verifications };
  }, [plan, optimisticState, verificationOverrides]);

  /**
   * Whether a job of this type already holds the plan, mirroring `ContentView.HasActiveJob<TArgs>`.
   *
   * V1 spends this on `DraftActions`: `Expand` and `Split` are handed
   * `disabled: ctx.HasActiveExpandJob` / `HasActiveSplitJob`, and their handlers open with
   * `if (ctx.HasActiveSplitJob) return;` — the guard is stated twice because a disabled button that
   * still fires is how a plan gets two agents rewriting it at once.
   */
  const hasActiveJob = (type: string): boolean =>
    jobs.some(
      (job) =>
        job.type === type && job.planId === plan.id && IN_FLIGHT_JOB_STATUSES.includes(job.status),
    );

  /**
   * True while a job owns the plan folder.
   *
   * V1 never shows the draft action bar in this situation at all: `PlansApp.Build` filters the list
   * to `Draft`/`Blocked` plans that have no active job, so a plan mid-flight is simply not on the
   * page. V2's detail view is reachable for any plan, so the same rule has to be applied here.
   */
  const isPlanInFlight =
    IN_FLIGHT_PLAN_STATES.includes(effectivePlan.state) ||
    hasActiveJob("ExecutePlan") ||
    hasActiveJob("RetryPlan");

  // Gating checks
  const canExec = PlanActionsController.canExecute(effectivePlan, allPlans);
  const canPr = PlanActionsController.canCreatePr(effectivePlan);
  const canRetryPlan = PlanActionsController.canRetry(effectivePlan);
  const canDiscardPlan = PlanActionsController.canDiscard(effectivePlan);
  const canResetPlan = PlanActionsController.canReset(effectivePlan);
  const canPartial = PlanActionsController.canCompletePartial(effectivePlan);

  /**
   * Run a lifecycle action, reporting any rejection in the banner. Every one of
   * these ends up starting a promptware job on the service, which can refuse
   * (dependency not met, plan in the wrong state, daemon down): so the
   * rejection is the operator's only signal that nothing happened.
   *
   * Returns whether the action went through, so a caller that made an optimistic guess can take it
   * back. No action supplied counts as not going through: nothing happened.
   */
  const runAction = async (
    label: string,
    action: ((planId: string) => void | Promise<void>) | undefined,
  ): Promise<boolean> => {
    if (!action) return false;
    setActionError(null);
    setPendingAction(label);
    try {
      await action(plan.id);
      return true;
    } catch (err) {
      setActionError(`${label} failed: ${describeBridgeError(err)}`);
      return false;
    } finally {
      setPendingAction(null);
    }
  };

  /**
   * Execute, gated.
   *
   * Nothing is dispatched while a guard is open: `onExecute` is called either
   * because no guard fired, or because the operator proceeded through all of
   * them. Repo status and the annotation count are both best-effort — what the
   * service cannot report degrades to "nothing known" rather than blocking
   * execution forever.
   */
  const handleExecute = async () => {
    // V1's Execute button is `disabled: isCheckingPreflight` while the check runs. Re-entering here
    // would run the whole git sweep twice and, worse, could open a second guard chain over the
    // first, so the click is dropped rather than queued.
    if (isCheckingPreflight || isPlanInFlight) return;
    setActionError(null);
    setIsCheckingPreflight(true);

    try {
      let repoStatus: RepoStatus[] | undefined;
      try {
        repoStatus = await bridge.getRepoStatus(plan.id);
      } catch {
        repoStatus = undefined;
      }

      // Only unresolved annotations block: a resolved one needs no UpdatePlan run. Re-read on the
      // click rather than trusting what was loaded on render, as V1 re-reads its own state here.
      let annotationCount: number | undefined;
      try {
        annotationCount = (await bridge.listAnnotations(plan.id)).filter(
          (a) => !a.isResolved,
        ).length;
      } catch {
        annotationCount = undefined;
      }

      let collected: ExecuteGuard[] = [];
      try {
        collected = collectExecuteGuards({ plan: effectivePlan, repoStatus, annotationCount });
      } catch {
        // A guard that cannot be collected must not swallow the click.
        collected = [];
      }

      if (collected.length === 0) {
        await dispatchExecute();
        return;
      }

      setGuards(collected);
      setGuardIndex(0);
    } finally {
      setIsCheckingPreflight(false);
    }
  };

  /**
   * The dispatch itself, once every guard has been passed.
   *
   * V1's `ContentView.LaunchExecute` moves the plan to `Creating` before starting the job and
   * comments that `JobService.StartJob` owns the real transition — the optimistic move exists so the
   * page stops offering Execute the instant it was pressed. The guess is rolled back if the dispatch
   * is refused, because a refused job leaves the plan exactly where it was.
   */
  const dispatchExecute = async () => {
    setOptimisticState("Creating");
    if (!(await runAction("Execute Plan", onExecute))) {
      setOptimisticState(null);
    }
  };

  const clearGuards = () => {
    setGuards([]);
    setGuardIndex(0);
  };

  const handleGuardProceed = async () => {
    if (guardIndex + 1 < guards.length) {
      setGuardIndex(guardIndex + 1);
      return;
    }
    clearGuards();
    await dispatchExecute();
  };

  const handleGuardUpdatePlan = () => {
    clearGuards();
    setActiveDialog("update");
  };

  const activeGuard = guards[guardIndex];

  const handleJobStarted = (response: StartJobResponse) => {
    onJobStarted?.(response);
  };

  const handleDraftAction = async (action: DraftAction) => {
    switch (action.id) {
      case "execute":
        await handleExecute();
        return;
      case "update":
        setActiveDialog("update");
        return;
      // `DraftActions.StartExpand` / `StartSplit` both open with an early return on their own active
      // job, and both move the plan optimistically before starting: Expand to `Creating`, Split to
      // `Updating`. The early return is not belt-and-braces — a keyboard shortcut reaches the handler
      // without going through the disabled button.
      case "expand":
        if (hasActiveJob("ExpandPlan")) return;
        setOptimisticState("Creating");
        if (
          !(await runAction("Expand Plan", async () => {
            handleJobStarted(await PlanActionsController.expandPlan(effectivePlan));
          }))
        ) {
          setOptimisticState(null);
        }
        return;
      case "split":
        if (hasActiveJob("SplitPlan")) return;
        setOptimisticState("Updating");
        if (
          !(await runAction("Split Plan", async () => {
            handleJobStarted(await PlanActionsController.splitPlan(effectivePlan));
          }))
        ) {
          setOptimisticState(null);
        }
        return;
      case "createIssue":
        setActiveDialog("createIssue");
        return;
      case "delete":
        setActiveDialog("delete");
        return;
      case "copyId":
        await runAction("Copy Plan ID", () => navigator.clipboard.writeText(plan.id));
        return;
      case "copyPath":
        await runAction("Copy Folder Path", () =>
          navigator.clipboard.writeText(plan.folderPath ?? ""),
        );
        return;
      case "openFolder":
        await runAction("Open Folder", () => openPath(plan.folderPath ?? ""));
        return;
    }
  };

  const handleOpenDialog = (title: string, action: "Accept" | "Decline") => {
    setActiveNoteDialog({ title, action });
  };

  const handleCloseDialog = () => {
    setActiveNoteDialog(null);
  };

  const handleSubmitDialog = async (note?: string) => {
    if (!activeNoteDialog) return;
    const { title, action } = activeNoteDialog;
    const trimmedNote = note?.trim();
    const accepting = action === "Accept";
    const targetState: RecommendationState = accepting
      ? trimmedNote
        ? "AcceptedWithNotes"
        : "Accepted"
      : "Declined";
    const notePayload = trimmedNote || undefined;
    // The same dialog text is a note on an accept and a reason on a decline, so
    // it goes to a different field either way round.
    const declineReason = accepting ? undefined : notePayload;
    const notes = accepting ? notePayload : undefined;

    handleCloseDialog();
    setActionError(null);

    // Snapshot for rollback
    const previous = recommendations;
    setRecommendations((prev) =>
      prev.map((r) => (r.title === title ? { ...r, state: targetState, declineReason, notes } : r)),
    );

    try {
      await bridge.setRecommendationState(plan.id, title, targetState, declineReason, notes);
    } catch (err) {
      setRecommendations(previous);
      setActionError(`Failed to update recommendation "${title}": ${describeBridgeError(err)}`);
    }
  };

  /**
   * The workspace's action row, assembled the way `DraftActions.Build` assembles it: "Update and
   * Share as icons, everything else in the overflow menu", the primary CTA on its own, and the
   * annotations/answers roll-up as a badged secondary button.
   *
   * Every entry is a `PlanActionDto` and reports back through one `OnAction` event, exactly as
   * `PlanWorkspaceActions.ApplyTo` wires it: "Tags are unique across icon actions, menu items and the
   * labeled buttons, so one event serves them all."
   */
  const iconActions: PlanActionDto[] = [];
  const workspaceMenu: PlanActionDto[] = [];
  const secondaryActions: PlanActionDto[] = [];
  let primaryAction: PlanActionDto | null = null;

  const draftSet = draftActions().filter((action) => action.isAvailable(effectivePlan));
  const availableDraft = new Set(draftSet.map((action) => action.id));
  const draftLabel = (id: DraftAction["id"]) =>
    draftSet.find((action) => action.id === id)?.label ?? id;

  if (!isPlanInFlight && effectivePlan.state !== "Review" && effectivePlan.state !== "Completed") {
    // `actions.Action("Update", "Update", Icons.WandSparkles, ctx.ShowUpdateDialog, "U")`.
    if (availableDraft.has("update")) {
      iconActions.push({
        tag: "update",
        label: draftLabel("update"),
        icon: "WandSparkles",
        shortcut: "U",
        disabled: pendingAction !== null || hasActiveJob("UpdatePlan"),
      });
    }

    // The overflow menu, in `DraftActions`' own order.
    if (availableDraft.has("expand"))
      workspaceMenu.push({
        tag: "expand",
        label: draftLabel("expand"),
        icon: "Expand",
        shortcut: "P",
        disabled: pendingAction !== null || hasActiveJob("ExpandPlan"),
      });
    if (availableDraft.has("split"))
      workspaceMenu.push({
        tag: "split",
        label: draftLabel("split"),
        icon: "Scissors",
        disabled: pendingAction !== null || hasActiveJob("SplitPlan"),
      });
    if (availableDraft.has("delete"))
      workspaceMenu.push({
        tag: "delete",
        label: draftLabel("delete"),
        icon: "Trash",
        shortcut: "Backspace",
        danger: true,
        disabled: pendingAction !== null,
      });
    if (availableDraft.has("createIssue"))
      workspaceMenu.push({ tag: "createIssue", label: draftLabel("createIssue"), icon: "Github" });

    // `actions.Menu("DiscussWithAgent", $"Discuss with {agentLabel}", agentIcon, ..., focusChat: true)`.
    workspaceMenu.push({
      tag: "DiscussWithAgent",
      label: "Discuss with agent",
      icon: "MessageSquare",
      focusChat: true,
    });

    if (availableDraft.has("openFolder"))
      workspaceMenu.push({
        tag: "openFolder",
        label: draftLabel("openFolder"),
        icon: "FolderOpen",
      });
    if (availableDraft.has("copyPath"))
      workspaceMenu.push({
        tag: "copyPath",
        label: draftLabel("copyPath"),
        icon: "ClipboardCopy",
      });
    if (availableDraft.has("copyId"))
      workspaceMenu.push({ tag: "copyId", label: draftLabel("copyId"), icon: "ClipboardCopy" });

    /**
     * `AddSecondary("UpdatePlan", "Update Plan", Icons.WandSparkles, ..., badge: (activeAnnotationCount
     * + answeredQuestions))`, with V1's reason: "Both kinds of pending work go through one button,
     * because one job answers both: an UpdatePlan that folds them into the plan. The badge counts them
     * together."
     */
    const pendingWork = annotations.filter((a) => !a.isResolved).length + answeredQuestionCount;
    if (pendingWork > 0) {
      secondaryActions.push({
        tag: "UpdatePlan",
        label: "Update Plan",
        icon: "WandSparkles",
        badge: String(pendingWork),
        disabled: pendingAction !== null || hasActiveJob("UpdatePlan"),
      });
    }

    // `actions.SetPrimary("Execute", "Execute", Icons.Rocket, ..., "x", disabled: isCheckingPreflight,
    // loading: isCheckingPreflight)`.
    if (availableDraft.has("execute")) {
      primaryAction = {
        tag: "execute",
        label: isCheckingPreflight
          ? "Checking..."
          : pendingAction === "Execute Plan"
            ? "Starting..."
            : draftLabel("execute"),
        icon: "Rocket",
        shortcut: "x",
        disabled: pendingAction !== null || isCheckingPreflight || !canExec.allowed,
        loading: isCheckingPreflight,
      };
    }
  }

  // The Review page's own set. V1 keeps these in `ReviewActions`, on the same workspace.
  if (!isPlanInFlight && effectivePlan.state === "Review") {
    primaryAction = {
      tag: "CreatePr",
      label: "Create PR",
      icon: "GitPullRequest",
      disabled: !canPr.allowed || pendingAction !== null,
    };
    secondaryActions.push({
      tag: "RetryPlan",
      label: "Retry Plan",
      icon: "RotateCcw",
      disabled: !canRetryPlan.allowed || pendingAction !== null,
    });
    if (canPartial.allowed)
      secondaryActions.push({
        tag: "AcceptPartialDelivery",
        label: "Accept Partial Delivery",
        icon: "CircleCheck",
      });
  }

  if (!isPlanInFlight && canResetPlan.allowed)
    workspaceMenu.push({ tag: "ResetToDraft", label: "Reset to Draft…", icon: "RotateCcw" });
  if (!isPlanInFlight && canDiscardPlan.allowed)
    workspaceMenu.push({
      tag: "DiscardPlan",
      label: "Discard Plan…",
      icon: "Ban",
      danger: true,
    });

  const handleWorkspaceAction = async (tag: string) => {
    const draft = draftSet.find((action) => action.id === tag);
    if (draft) {
      await handleDraftAction(draft);
      return;
    }
    switch (tag) {
      case "UpdatePlan":
        setActiveDialog("update");
        return;
      case "CreatePr":
        setActiveDialog("createPr");
        return;
      case "RetryPlan":
        setActiveDialog("suggestChanges");
        return;
      case "AcceptPartialDelivery":
        setActiveDialog("partialDelivery");
        return;
      case "ResetToDraft":
        setActiveDialog("reset");
        return;
      case "DiscardPlan":
        setActiveDialog("discard");
        return;
      case "DiscussWithAgent":
        // The workspace has already put the caret in the composer (`focusChat`); this drafts V1's
        // opening line for it, `PlanChatSessions.DiscussPrompt`, "phrased for where the plan is".
        setChatDraft({
          text:
            effectivePlan.state === "Review" ||
            effectivePlan.state === "Completed" ||
            effectivePlan.state === "Failed"
              ? "I want to discuss the outcome of this plan before completing it. Summarize what was done and point out anything worth a closer look."
              : "I want to discuss this plan before executing it. Summarize it and point out anything you would change.",
          token: chatDraft.token + 1,
        });
        return;
    }
  };

  /**
   * The plan document pane.
   *
   * Not wrapped in a scroll container of its own: `PlanTabView.Build` notes "PlanMarkdown owns its own
   * scroll, so the Plan tab is not wrapped in Cap()", and the contents panel is pinned by the widget's
   * own `StickyContent` slot, which only works inside that scroll.
   */
  const planPane = (
    <div key="plan-pane" ref={planPaneRef} className="flex min-h-0 flex-1 flex-col">
      {/* `PlanTabView.Build`: a failed plan leads with why, above the plan itself. */}
      {effectivePlan.state === "Failed" && (
        <div className="px-8 pt-6">
          <ExecutionFailedCallout plan={effectivePlan} jobs={jobs} />
        </div>
      )}
      {/* `PlanTabView.Build` composes this as
          `new PlanMarkdown(annotatedContent).Article().DangerouslyAllowLocalFiles()
           .Annotations(...).OnAnnotationsChange(...).OnAnswersChange(onAnswerChanged)
           .ScrollTo(scrollTo)`. `OnAnswersChange` is what makes the questions in the document
          answerable at all; without it `PlanMarkdown` passes `undefined` as its answer callback and
          "undefined puts every callout in read-only mode". */}
      <PlanMarkdown
        id="plan-markdown"
        content={revisionContent || "# No revision content available"}
        article
        dangerouslyAllowLocalFiles
        annotations={annotations}
        scrollTo={scrollTo}
        events={["OnAnnotationsChange", "OnAnswersChange"]}
        eventHandler={(evt: string, _id: string, args?: unknown[]) => {
          if (evt === "OnAnnotationsChange") {
            const next = args?.[0];
            if (Array.isArray(next)) handleAnnotationsChange(next as Annotation[]);
            return;
          }
          if (evt !== "OnAnswersChange") return;
          const payload = args?.[0] as { questionId?: string; answer?: unknown } | undefined;
          if (!payload?.questionId) return;
          // `null` on the wire means the key goes; a list is the answer. Either way the merge takes a
          // list, and an empty one removes the `answer` key.
          const value = Array.isArray(payload.answer)
            ? (payload.answer as unknown[]).map((entry) => String(entry))
            : [];
          applyAnswer(payload.questionId, value);
        }}
        slots={{
          StickyContent: [<PlanContentsPanel key="toc" entries={toc} onSelect={scrollToHeading} />],
        }}
      />
    </div>
  );

  /** Every tab body but the Plan tab's, which owns its own scroll. */
  const otherTabsPane = (
    <div key="tab-pane" className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      {effectiveTab === "diff" && (
        <div className="rounded-xl border border-border bg-card/40 p-6">
          <PlanRevisionDiff planId={plan.id} revisionCount={plan.revisionCount ?? 0} />
        </div>
      )}

      {effectiveTab === "recommendations" && (
        <div className="space-y-4 rounded-xl border border-border bg-card/40 p-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Plan Recommendations</h3>
            <p className="text-xs text-muted-foreground">
              Out-of-scope follow-ups and improvements discovered during execution.
            </p>
          </div>

          {recommendations.length === 0 ? (
            <p data-testid="no-recommendations" className="text-xs text-muted-foreground/70">
              ExecutePlan registered no recommendations for this plan.
            </p>
          ) : (
            <div className="space-y-3">
              {recommendations.map((rec) => (
                <RecommendationCard
                  key={rec.title}
                  recommendation={rec}
                  onAccept={(title) => handleOpenDialog(title, "Accept")}
                  onDecline={(title) => handleOpenDialog(title, "Decline")}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {effectiveTab === "git" && (
        <div className="rounded-xl border border-border bg-card/40 p-6">
          {gitError ? (
            <p data-testid="git-tab-error" className="text-xs text-destructive">
              {gitError}
            </p>
          ) : gitData ? (
            <PlanGitView
              data={gitData}
              prs={plan.prs ?? []}
              planState={effectivePlan.state}
              onOpenUrl={(url) => void openPath(url)}
            />
          ) : (
            <p className="text-sm text-muted-foreground/70">Loading git state…</p>
          )}
        </div>
      )}

      {effectiveTab === "details" && (
        <div className="space-y-4">
          {/* `DetailsTabView.Build`'s own field order, and its `RemoveEmpty()`: a row the plan
              has no value for is dropped rather than rendered blank. */}
          <dl className="rounded-xl border border-border bg-card/40 p-4">
            <DetailRow label="Plan ID">
              <button
                type="button"
                onClick={() =>
                  void runAction("Copy Plan ID", () => navigator.clipboard.writeText(plan.id))
                }
                title="Copy to clipboard"
                className="font-mono hover:underline"
              >
                {plan.id}
              </button>
            </DetailRow>
            <DetailRow label="Folder" empty={!plan.folderPath}>
              <button
                type="button"
                onClick={() =>
                  void runAction("Copy Folder Path", () =>
                    navigator.clipboard.writeText(plan.folderPath ?? ""),
                  )
                }
                title="Copy to clipboard"
                className="break-all font-mono hover:underline"
              >
                {plan.folderPath}
              </button>
            </DetailRow>
            <DetailRow label="Initial Prompt" empty={!plan.initialPrompt}>
              <span className="whitespace-pre-wrap">{plan.initialPrompt}</span>
            </DetailRow>
            <DetailRow label="Revision" empty={!plan.revisionCount}>
              {plan.revisionCount}
            </DetailRow>
            <DetailRow label="Profile" empty={!plan.executionProfile}>
              {plan.executionProfile}
            </DetailRow>
            <DetailRow
              label="Related Plans"
              empty={!plan.relatedPlans || plan.relatedPlans.length === 0}
            >
              {(plan.relatedPlans ?? []).map(planLinkLabel).join(", ")}
            </DetailRow>
            <DetailRow label="Depends On" empty={!plan.dependsOn || plan.dependsOn.length === 0}>
              {(plan.dependsOn ?? []).map(planLinkLabel).join(", ")}
            </DetailRow>
            <DetailRow label="Issue" empty={!plan.sourceUrl}>
              <a
                href={plan.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-primary hover:underline"
              >
                {plan.sourceUrl}
              </a>
            </DetailRow>
            <DetailRow label="Created" empty={!plan.created}>
              {(plan.created ?? "").slice(0, 10)}
            </DetailRow>
            <DetailRow label="Level" empty={!plan.level}>
              {plan.level}
            </DetailRow>
            <DetailRow label="Project" empty={!plan.project}>
              {plan.project}
            </DetailRow>
            <DetailRow label="State">{effectivePlan.state}</DetailRow>
          </dl>

          {/* Repos and commits have no row of their own in V1's Details tab; they are kept here
              because V2's Git tab is the only other place they appear and it is hidden while a
              plan has nothing in git yet. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card/40 p-4">
              <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Repositories
              </h4>
              <ul className="mt-2 space-y-1 font-mono text-sm text-muted-foreground">
                {plan.repos && plan.repos.length > 0 ? (
                  plan.repos.map((r, i) => <li key={i}>{r}</li>)
                ) : (
                  <li className="font-sans text-muted-foreground/70">No repositories specified</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-4">
              <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Commits
              </h4>
              <ul className="mt-2 space-y-1 font-mono text-sm text-muted-foreground">
                {plan.commits && plan.commits.length > 0 ? (
                  plan.commits.map((c, i) => <li key={i}>{c}</li>)
                ) : (
                  <li className="font-sans text-muted-foreground/70">No commits yet</li>
                )}
              </ul>
            </div>

            {/* `GitTabView`: the PR section exists only when the plan records one. */}
            {plan.prs && plan.prs.length > 0 && (
              <PlanPullRequests planId={plan.id} prs={plan.prs} />
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-full min-h-0" data-testid="plan-detail-view">
      {/*
        The plan page's frame, `ContentView.Build`'s
        `actions.ApplyTo(new PlanWorkspace(tabContent, new PlanChatView(...),
        new VerificationsPanelView(...), questionsPanel).PlanId(...).Title(...)...)`.

        The four positional arguments are the Content, Chat, Verifications and Questions slots, in
        that order, and everything else is a named setter on the widget.
      */}
      <PlanWorkspace
        id="plan-workspace"
        // `.PlanId($"#{selectedPlan.Id}")` — `#21`, not `#00021`.
        planId={formatPlanId(plan.id)}
        title={plan.title}
        meta={meta ?? undefined}
        // `.Source(SourceUrl, IsPullRequestSource ? "PR" : "Issue")`.
        sourceUrl={plan.sourceUrl || undefined}
        sourceLabel={sourceLabel(plan.sourceUrl)}
        actions={iconActions}
        menuItems={workspaceMenu}
        primary={primaryAction}
        secondary={secondaryActions}
        tabs={tabs as PlanTabDto[]}
        selectedTab={effectiveTab}
        // `.QuestionsLabel(unanswered > 0 ? $"Questions ({unanswered} unanswered)" : "Questions")`.
        questionsLabel={
          unansweredQuestions > 0 ? `Questions (${unansweredQuestions} unanswered)` : "Questions"
        }
        unansweredQuestions={unansweredQuestions}
        events={["OnAction", "OnTabSelect"]}
        eventHandler={(evt: string, _id: string, args?: unknown[]) => {
          if (evt === "OnTabSelect") {
            const id = args?.[0];
            if (typeof id === "string") setActiveSubTab(id as PlanDetailTab);
            return;
          }
          if (evt !== "OnAction") return;
          const tag = args?.[0];
          if (typeof tag === "string") void handleWorkspaceAction(tag);
        }}
        slots={{
          /**
           * `.ProjectBadges(ProjectHelper.BuildBadges(selectedPlan.Project, config))`.
           *
           * The lifecycle badge rides along, which V1's plan page has no need for: `PlansApp.Build`
           * only ever lists Draft/Blocked plans, so the state was never in question. V2's detail page
           * is reachable for every plan, so it has to say which one it is looking at.
           */
          ProjectBadges: [
            <span
              key="state"
              data-testid="plan-state-badge"
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${planStateBadgeClass(
                effectivePlan.state,
              )}`}
            >
              {effectivePlan.state}
            </span>,
            ...parseProjects(plan.project).map((project) => (
              <span
                key={project}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {project}
              </span>
            )),
            ...(plan.level
              ? [
                  <span
                    key="level"
                    className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {plan.level}
                  </span>,
                ]
              : []),
          ],
          /**
           * V1 leaves the `Toolbar` slot empty and reports refusals through toasts, which V2's shell
           * does not have. So the banner the page already had lives here, above the tab strip, which
           * is where the slot renders.
           */
          Toolbar: [
            ...(onBack
              ? [
                  <button
                    key="back"
                    type="button"
                    onClick={onBack}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← Back to plans
                  </button>,
                ]
              : []),
            ...(isPlanInFlight
              ? [
                  <span
                    key="in-flight"
                    data-testid="plan-in-flight-notice"
                    className="rounded-lg border border-info/40 bg-info/10 px-3 py-1.5 text-xs font-medium text-info"
                  >
                    A job is running on this plan.
                  </span>,
                ]
              : []),
            ...(actionError
              ? [
                  <div
                    key="error"
                    role="alert"
                    data-testid="plan-action-error"
                    className="flex-1 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
                  >
                    {actionError}
                  </div>,
                ]
              : []),
          ],
          /**
           * `new VerificationsPanelView(selectedPlan, planService, config, chatExecution)` — the
           * corner dropdown, not a tab. This is also the first consumer the shared
           * `SortableVerificationList` could have had; it is not used here because V1's panel is a
           * checkbox list whose order comes from the project config, not a hand-orderable one.
           */
          Verifications: [
            <PlanVerifications
              key="verifications"
              planId={plan.id}
              project={plan.project}
              verifications={effectivePlan.verifications || []}
              planState={effectivePlan.state}
              onVerificationChange={(name, status) =>
                setVerificationOverrides((prev) => ({ ...prev, [name]: status }))
              }
            />,
          ],
          /**
           * `questions.Count > 0 ? new QuestionsPanelView(questions, id => { selectedTab.Set(PlanTab);
           * scrollTo.Set(new QuestionScrollTarget(id, token + 1)); }) : null` — clicking an entry
           * returns to the Plan tab and scrolls the question into view.
           */
          Questions:
            questions.length > 0
              ? [
                  <PlanQuestionsPanel
                    key="questions"
                    questions={questions}
                    unsavedIds={unsavedAnswers}
                    onSelect={(questionId) => {
                      setActiveSubTab("plan");
                      setScrollTo({ questionId, token: (scrollTo?.token ?? 0) + 1 });
                    }}
                  />,
                ]
              : undefined,
          Chat: [
            <PlanChatPanel
              key="chat"
              plan={plan}
              draft={chatDraft}
              onError={(message) => setActionError(message)}
            />,
          ],
          Content: [effectiveTab === "plan" ? planPane : otherTabsPane],
        }}
      />

      {/* Optional Note Dialog */}
      <RecommendationNoteDialog
        isOpen={activeNoteDialog !== null}
        title={activeNoteDialog?.title ?? ""}
        action={activeNoteDialog?.action ?? "Accept"}
        onClose={handleCloseDialog}
        onSubmit={handleSubmitDialog}
      />

      {/* Pre-execution guards, shown one at a time in collection order. */}
      <PendingAnnotationsDialog
        isOpen={activeGuard?.kind === "PendingAnnotations"}
        onClose={clearGuards}
        annotationCount={activeGuard?.annotationCount ?? 0}
        onUpdatePlan={handleGuardUpdatePlan}
        onProceed={() => void handleGuardProceed()}
      />
      <UnansweredQuestionsDialog
        isOpen={activeGuard?.kind === "UnansweredQuestions"}
        onClose={clearGuards}
        questions={activeGuard?.questions ?? []}
        onUpdatePlan={handleGuardUpdatePlan}
        onProceed={() => void handleGuardProceed()}
      />
      <DirtyRepoDialog
        isOpen={activeGuard?.kind === "DirtyRepo"}
        onClose={clearGuards}
        dirtyRepos={activeGuard?.dirtyRepos ?? []}
        onProceed={() => void handleGuardProceed()}
      />

      {/* Lifecycle dialogs */}
      <UpdatePlanDialog
        isOpen={activeDialog === "update"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        planJobs={jobs}
        onJobStarted={handleJobStarted}
      />
      <CreateIssueDialog
        isOpen={activeDialog === "createIssue"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        projectRepos={projectRepos}
        onJobStarted={handleJobStarted}
      />
      <DeletePlanDialog
        isOpen={activeDialog === "delete"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onDeleted={(planId) => onPlanDeleted?.(planId)}
        onArchived={(planId) => onPlanChanged?.(planId)}
      />
      <DiscardPlanDialog
        isOpen={activeDialog === "discard"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onDiscarded={(planId) => onPlanChanged?.(planId)}
      />
      <ResetToDraftDialog
        isOpen={activeDialog === "reset"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onReset={(planId) => onPlanChanged?.(planId)}
      />
      <PartialDeliveryDialog
        isOpen={activeDialog === "partialDelivery"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onCompleted={(planId) => onPlanChanged?.(planId)}
      />
      <SuggestChangesDialog
        isOpen={activeDialog === "suggestChanges"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onJobStarted={handleJobStarted}
      />
      <CreatePrDialog
        isOpen={activeDialog === "createPr"}
        onClose={() => setActiveDialog(null)}
        plan={plan}
        onJobStarted={handleJobStarted}
      />
    </div>
  );
};
