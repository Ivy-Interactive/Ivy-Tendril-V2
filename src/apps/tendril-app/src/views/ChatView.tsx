import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChatInput, ChatMessageList } from "@ivy-interactive/components/renderers";
import { VoiceRecorder, type VoiceStatus } from "@ivy-interactive/components/tendril";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
} from "@ivy-interactive/components/ui";
import { bridge } from "../api/bridge";
import { usePublishSidebarList, type ShellSidebarList } from "../state/sidebarListStore";
import { chatStore, type ChatState, type ChatStore } from "../state/chatStore";
import { jobsStore } from "../state/jobsStore";
import { plansStore } from "../state/plansStore";
import type { ChatMessage, ChatSession, ChatAttachment, ChatQueuedItem } from "../types/chat";
import type { Job, PlanSummary } from "../types/api";
import { PIN_TOP_PADDING, useChatAutoScroll } from "../hooks/useChatAutoScroll";
import {
  useChatMessageWindow,
  CHAT_VIRTUALIZATION_MIN_MESSAGES,
  estimateChatMessageHeight,
} from "../hooks/useChatMessageWindow";
import { ConfirmDialog } from "./dialogs/ConfirmDialog";
import { ChatMessageRow } from "./ChatMessageRow";
import { ChatHeader, JobsMenu } from "./ChatHeader";
import { AgentPicker } from "../components/chat/AgentPicker";
import { ImageLightbox, type LightboxImage } from "../components/chat/ImageLightbox";
import { useWebviewFileDrop } from "../hooks/useWebviewFileDrop";
import { resolveJobState } from "../utils/jobStatus";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  HelpCircle,
  ListPlus,
  Loader2,
  Mic,
  Paperclip,
  Pencil,
  SendHorizontal,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { usePendingChatQuestions } from "../hooks/usePendingChatQuestions";
import { useWireframeBaseUrl } from "../api/proxyOrigin";

interface ChatViewProps {
  onCreatePlan?: (initialDescription: string) => void;
  /** Opens the plan a system event or a spawned job refers to. */
  onOpenPlan?: (planId: string) => void;
  /**
   * The store this conversation is read from and written through. Defaults to the app-wide one the
   * Chat page owns; the chat beside a plan passes a plan-scoped instance, which is what V1's
   * `PlanChatView` does by holding its own `activeSessionId` over the one shared history service.
   */
  store?: ChatStore;
  /**
   * `Chat.ContentView(embedded: true)`: this chat is hosted inside another page rather than being
   * the page. The table above {@link ChatView} says exactly what that turns off.
   */
  embedded?: boolean;
  /**
   * `ContentView`'s `greeting`. The Chat page passes the time-of-day line; the plan panel passes
   * `$"#{plan.Id} {plan.Title}"`, which is where the plan's name is shown — V1's embedded chat has
   * no title bar to put it in.
   */
  greeting?: string;
  /** `ContentView`'s `headline`: `PlanChatView.Headline` embedded, V1's chat headline otherwise. */
  headline?: string;
  /** `ContentView`'s `samplePrompts`. Absent means `SamplePrompts.ForChat` off the live plan list. */
  samplePrompts?: SamplePrompt[];
  /**
   * A line the host wants drafted into the composer, not sent — "Discuss with agent" on a plan page
   * is the one thing that asks for it. The token is what makes a repeat request work: an unchanged
   * string compares equal and nothing would move.
   */
  draftPrompt?: { text: string; token: number };
}

/** One chip of the empty state: the label is the button, the prompt is what it drafts. */
export interface SamplePrompt {
  label: string;
  prompt: string;
}

/** `ChatSearchDialog.MaxResults`: the search dialog never lists more than fifteen chats. */
const MAX_CHAT_SEARCH_RESULTS = 15;

/** The transcription socket the shared composer defaults to; the mic here speaks to the same one. */
const TRANSCRIPTION_URL = "wss://tendril-api.ivy.app/transcribe/ws";

/** The composer's headline prompt, and the placeholder it writes under. */
const COMPOSER_PLACEHOLDER = "Ask Tendril anything...";
const EMPTY_STATE_HEADLINE = "What Are We Producing Today?";

/** A single line of prompt text at the composer's line height, in CSS pixels. */
const SINGLE_LINE_HEIGHT = 32;

/**
 * The static tail of the sample prompts, in the order and with the wording of
 * `SamplePrompts.ForChat`'s fallbacks: the label is the button, the prompt is what it drafts.
 */
const SAMPLE_PROMPTS = [
  { label: "Add a new project", prompt: "Add a new project to my tendril" },
  { label: "Edit verifications", prompt: "Edit verifications for my projects" },
  { label: "Create a team vault", prompt: "Create a shared team vault" },
  {
    label: "What should I work on next?",
    prompt:
      "Look at my draft plans across all projects and recommend which two to execute next, with reasons.",
  },
  {
    label: "What shipped this week?",
    prompt:
      "Summarize the plans that reached Completed in the last seven days, grouped by project.",
  },
];

/** `SamplePrompts.Max`: the empty state never offers more than five. */
const MAX_SAMPLE_PROMPTS = 5;

/** `#21`, not `#00021`, as `PlansView.formatPlanId` explains; inlined to keep the chunks apart. */
const shortPlanId = (id: string): string => id.replace(/^0+(?=\d)/, "") || id;

/**
 * Whether an attachment's path is a real path on the machine, POSIX or Windows.
 *
 * A `File` from an `<input>` or a paste reports only its base name, and staging a base name would ask
 * the app to read a file relative to a working directory nothing here can reason about.
 */
const isAbsolutePath = (path: string): boolean => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path);

const newestByUpdated = (plans: PlanSummary[]): PlanSummary | undefined =>
  [...plans].sort(
    (a, b) => new Date(b.updated ?? 0).getTime() - new Date(a.updated ?? 0).getTime(),
  )[0];

/**
 * Port of `SamplePrompts.ForChat`. The chips are what this tendril happens to need right now, with
 * the five generic prompts as the tail that fills whatever the rules did not: plans waiting for
 * review, the newest failure, the newest block, and jobs in flight, capped at five.
 *
 * V1's fifth rule - the newest plan with `PartialDelivery` - has no counterpart here: `PlanSummary`
 * carries no partial-delivery flag, so that chip is absent rather than guessed at.
 */
export function buildChatSamplePrompts(plans: PlanSummary[], jobs: Job[]): SamplePrompt[] {
  const prompts: SamplePrompt[] = [];
  const labels = new Set<string>();
  const add = (label: string, prompt: string) => {
    if (labels.has(label)) return;
    labels.add(label);
    prompts.push({ label, prompt });
  };

  const reviewPlans = plans.filter((p) => p.state === "Review");
  if (reviewPlans.length > 0) {
    const planList = reviewPlans.map((p) => `#${shortPlanId(p.id)} ${p.title}`).join(", ");
    add(
      `Review the ${reviewPlans.length} plans waiting`,
      `${reviewPlans.length} plans are waiting for review: ${planList}. Summarize what each delivers and tell me which to merge first.`,
    );
  }

  const failedPlan = newestByUpdated(plans.filter((p) => p.state === "Failed"));
  if (failedPlan) {
    add(
      `Why did #${shortPlanId(failedPlan.id)} fail?`,
      `Plan #${shortPlanId(failedPlan.id)} ${failedPlan.title} failed. Read its logs and verification reports and explain what went wrong.`,
    );
  }

  const blockedPlan = newestByUpdated(plans.filter((p) => p.state === "Blocked"));
  if (blockedPlan) {
    add(
      `What is blocking #${shortPlanId(blockedPlan.id)}?`,
      `Plan #${shortPlanId(blockedPlan.id)} ${blockedPlan.title} is blocked. List the plans it depends on and what each one still needs.`,
    );
  }

  const runningJobs = jobs.filter(
    (job) => job.status === "Running" || job.status === "Pending" || job.status === "Queued",
  );
  if (runningJobs.length > 0) {
    add(
      "What are my jobs doing?",
      `${runningJobs.length} jobs are running. Summarize what each one is working on.`,
    );
  }

  for (const fallback of SAMPLE_PROMPTS) {
    add(fallback.label, fallback.prompt);
  }

  return prompts.slice(0, MAX_SAMPLE_PROMPTS);
}

/**
 * The plan a chip can be written about: whatever `SamplePrompts.ForPlan` reads off a `PlanFile`.
 * Both `PlanDetail` and `PlanSummary` satisfy it, which is what lets the plan page and the review
 * page share one panel.
 */
export interface SamplePromptPlan {
  state: string;
  verifications?: { name: string; status: string }[];
  prs?: string[];
  dependsOn?: string[];
}

/**
 * Port of `SamplePrompts.ForPlan`, in V1's order — the list is append-only, so source order *is*
 * priority, and `labels.Add(label)` is what suppresses a duplicate. Capped at `SamplePrompts.Max`.
 *
 * The rules, in order: the first failed verification in list order, then the first PR, then the
 * dependencies of a Blocked plan, then a Draft plan's scope, then the two unconditional fallbacks.
 * At most one of Blocked and Draft can fire, so the cap can only ever drop the last fallback.
 *
 * V1's second rule — `plan.PartialDelivery` → "What is missing?" — has no counterpart here, for the
 * same reason `buildChatSamplePrompts` is missing its fifth: neither `PlanDetail` nor `PlanSummary`
 * carries a partial-delivery flag, so that chip is absent rather than guessed at.
 */
export function buildPlanSamplePrompts(plan: SamplePromptPlan): SamplePrompt[] {
  const prompts: SamplePrompt[] = [];
  const labels = new Set<string>();
  const add = (label: string, prompt: string) => {
    if (labels.has(label)) return;
    labels.add(label);
    prompts.push({ label, prompt });
  };

  const failed = (plan.verifications ?? []).find((v) => v.status === "Fail");
  if (failed) {
    add(
      `Why did ${failed.name} fail?`,
      `The ${failed.name} verification failed for this plan. Read its report in Verification/${failed.name}.md and explain the failure and how to fix it.`,
    );
  }

  const firstPr = (plan.prs ?? [])[0];
  if (firstPr) {
    add(
      "Summarize the PR feedback",
      `Read the review comments on ${firstPr} and list the changes they ask for.`,
    );
  }

  if (plan.state === "Blocked") {
    add(
      "What is blocking this?",
      `This plan is blocked on ${(plan.dependsOn ?? []).join(", ")}. Tell me what each dependency still needs.`,
    );
  }

  if (plan.state === "Draft") {
    add(
      "Tighten the scope",
      "Read the latest revision of this plan and point out anything out of scope or under specified.",
    );
  }

  add(
    "Explain the solution",
    "Explain the Solution section of this plan in plain terms, and list every file it will touch.",
  );
  add(
    "What could go wrong?",
    "What are the riskiest parts of this plan, and what should I check in review?",
  );

  return prompts.slice(0, MAX_SAMPLE_PROMPTS);
}

/** The time-of-day greeting above the empty state's headline. */
function buildGreeting(now: Date): string {
  const hour = now.getHours();
  const word =
    hour >= 5 && hour < 12 ? "Morning" : hour >= 12 && hour < 17 ? "Afternoon" : "Evening";
  return `Good ${word}!`;
}

/** The chat's own name, falling back to the label a chat carries before it is titled. */
const displayTitle = (session: ChatSession | null | undefined): string =>
  session && session.title.trim() ? session.title : "New Chat";

/** The plan a session belongs to, shown as its row tag; null for a free-standing chat. */
const planTag = (session: ChatSession): string | null =>
  session.planFolderName ? `#${shortPlanId(session.planFolderName.split("-")[0])}` : null;

/** The row actions the Chats list carries, so the shell can wire its row menu to them. */
export interface ChatSidebarListActions {
  onNew: () => void;
  onSearch: () => void;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  onTogglePin: (sessionId: string) => void;
}

/**
 * `ChatApp.BuildSidebarList`: the Chats list the shell sidebar shows while this app is open.
 *
 * Everything non-default here is V1's, and each flag has a reason:
 * - `collapsedMenu: true` folds the collapsed rail's list into one flyout button instead of the
 *   narrow id chips a plan list shows there - a chat has no id to chip.
 * - `searchLabel: "Search chats"` with its own `onSearch`, because an absent `onSearch` means the
 *   plan search dialog, "which is right for every plan list and wrong for anything else".
 * - `onNew` is the new-chat action, labelled "New chat".
 * - `onRename` / `onDelete` / `onTogglePin` are the row's own actions.
 *
 * A row's `state` is `ChatApp.BuildRowState`: "working" while its own turn is running, "completed"
 * when it finished while the user was reading a different chat. V1 also sets `Icon: "Terminal"` on a
 * terminal session; V2's `ChatSession` has no terminal kind, so no row ever carries that glyph.
 */
export const buildChatSidebarList = (
  sessions: ChatSession[],
  selectedId: string | null,
  rowState: (sessionId: string) => "working" | "completed" | null,
  actions: ChatSidebarListActions,
): ShellSidebarList => ({
  appId: "chat",
  title: "Chats",
  items: sessions.map((session) => ({
    id: session.id,
    title: displayTitle(session),
    tag: planTag(session) ?? undefined,
    state: rowState(session.id) ?? undefined,
    pinned: session.isPinned,
  })),
  selectedId,
  searchable: true,
  onSearch: actions.onSearch,
  searchLabel: "Search chats",
  onNew: actions.onNew,
  newLabel: "New chat",
  collapsedMenu: true,
  onRename: actions.onRename,
  onDelete: actions.onDelete,
  onTogglePin: actions.onTogglePin,
  buildSelectArgs: (sessionId) => {
    /* The shell routes a click as `OpenApp(new NavigateArgs("chat", BuildSelectArgs(id)))` and V1's
       `ChatApp` reads `ChatAppArgs.SessionId` back out. V2 has no arg-carrying navigation yet, so the
       session is selected here too; the returned object is still V1's args, so this drops out once
       the shell can hand args to a view. */
    actions.onSelect(sessionId);
    return { sessionId };
  },
});

/**
 * How many lines the textarea is currently rendering, from its own metrics.
 *
 * `scrollHeight` includes the padding, so the padding comes back off before dividing by the line
 * height. Rounding matters: a line box can report a fractional height, and comparing a *total* against
 * a constant puts the single-line case exactly on the boundary — one line of 14px text with `leading-5`
 * and `py-1.5` is precisely 32px, so a half-pixel anywhere flips the composer to multiline on the first
 * character typed. Counting lines cannot land on a boundary, and does not care what the font size is.
 */
const renderedLineCount = (textarea: HTMLTextAreaElement): number => {
  const style = getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const padding =
    (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  // `line-height: normal` resolves to no number; V1's single-line total is the only thing left to
  // measure against, and its own padding is what this subtracts.
  const perLine =
    Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : SINGLE_LINE_HEIGHT - padding;
  if (perLine <= 0) return 1;
  return Math.max(1, Math.round((textarea.scrollHeight - padding) / perLine));
};

/**
 * Whether the prompt needs more than one line beside the composer's buttons. It is measured at the
 * width the textarea has inline, whichever layout is showing, so the composer does not flip back
 * and forth once the toolbar has moved above the text and widened it.
 *
 * That hysteresis is the whole reason for the temporary style swap below, and it is the part a port
 * loses first: the multiline layout is *wider*, so text that wrapped inline stops wrapping once the
 * toolbar moves above it, and a naive measurement of the live element would immediately decide one line
 * is enough and flip back. So the question is always asked at the inline width.
 */
export const needsMultipleLines = (
  textarea: HTMLTextAreaElement,
  row: HTMLElement | null,
): boolean => {
  if (!textarea.value) return false;
  if (textarea.value.includes("\n")) return true;
  // Before the composer has a width nothing can be measured; the placeholder would wrap.
  if (!row || row.clientWidth === 0) return false;
  const siblings = Array.from(row.children).filter((child) => child !== textarea) as HTMLElement[];
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const inlineWidth =
    row.clientWidth -
    siblings.reduce((sum, child) => sum + child.offsetWidth, 0) -
    gap * siblings.length;
  if (inlineWidth <= 0) return false;
  const previous = {
    flex: textarea.style.flex,
    width: textarea.style.width,
    height: textarea.style.height,
  };
  textarea.style.flex = "0 0 auto";
  textarea.style.width = `${Math.max(inlineWidth, 0)}px`;
  textarea.style.height = "auto";
  const wraps = renderedLineCount(textarea) > 1;
  textarea.style.flex = previous.flex;
  textarea.style.width = previous.width;
  textarea.style.height = previous.height;
  return wraps;
};

/**
 * The conversation, which is `Apps/Chat/ContentView` — the *same* view whether it is the Chat page or
 * the panel beside a plan. V1 has exactly one chat view and two callers; `embedded` is the whole of
 * the difference, and `Apps/Views/PlanChatView` is the second caller.
 *
 * Every effect here that reaches outside this subtree, and what an embedded instance does with it.
 * Written out in full rather than gated where noticed: a sidebar publish or a webview listener
 * leaking out of the panel beside a plan is a bug nobody would think to look for in this file.
 *
 * | effect | embedded |
 * | --- | --- |
 * | `store.subscribe` / `store.init()` | **kept** — it is the conversation. The panel's store is its own, so `init()` opens a second `chat-event` listener; unmount `destroy()`s it, so a visit leaks nothing. |
 * | `store.pruneEmptySessions()` on unmount | **off**. V1 prunes in `ChatApp`, not in `ContentView`, and an embedded prune would reach chats the panel does not own. |
 * | `usePublishSidebarList` | **off**, and the list is not even built. `PlanChatView` publishes none, which is exactly why V1's embedded chat shows no session list. |
 * | the Chats search dialog | **off**. Only the published list's `onSearch` opens it, so it is already unreachable; not rendering it keeps a second `Dialog` off the plan page. |
 * | `useWebviewFileDrop` | **off**. It listens on the *webview*, not on this subtree, so a second registration would answer drops made anywhere in the app. The React drag handlers stay — those are scoped — and the paperclip still opens the file dialog. |
 * | `ChatHeader` | **off**: V1 swaps the whole header for a right-aligned `JobsMenu` that appears only once the conversation has jobs. So no rename, no delete menu, and no new-chat button — `PlanChatView` passes `startNewChat: () => { }`. |
 * | composer keys, voice recorder, autoscroll, lightbox, `ResizeObserver` | **kept**: all of them are this instance's own DOM. |
 * | `jobsStore` / `plansStore` subscriptions | **kept**. Read-only, and `PlanChatView` subscribes to `JobsChanged` for the same reason — the jobs pill follows the live list. |
 *
 * There is no keyboard shortcut to gate: the composer's Enter handling is a `keydown` on its own
 * textarea, and every registered `useShortcut` in the app belongs to `App.tsx` or `PlanWorkspace`.
 */
export const ChatView: React.FC<ChatViewProps> = ({
  onCreatePlan,
  onOpenPlan,
  store = chatStore,
  embedded = false,
  greeting: greetingOverride,
  headline = EMPTY_STATE_HEADLINE,
  samplePrompts: samplePromptsOverride,
  draftPrompt,
}) => {
  const [storeState, setStoreState] = useState<ChatState>(() => store.getState());
  const [inputPrompt, setInputPrompt] = useState("");
  /** `ChatApp`'s own search trigger, opened from the Chats section's search icon. */
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // V1 opens the queue panel: a prompt that will be sent for you is worth reading without a click.
  const [isQueueExpanded, setIsQueueExpanded] = useState(true);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [editingQueuedText, setEditingQueuedText] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // The chat beside a plan resolves `wireframe` fences against that plan; the general chat page
  // has no plan, so a fence there renders a placeholder. The base names the daemon's origin, not
  // the app's -- see `useWireframeBaseUrl`.
  const wireframeBaseUrl = useWireframeBaseUrl(store.planId);

  const [activeLightboxImage, setActiveLightboxImage] = useState<LightboxImage | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [deleteSessionError, setDeleteSessionError] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [jobs, setJobs] = useState<Job[]>(jobsStore.getState().jobs);
  const [plans, setPlans] = useState<PlanSummary[]>(plansStore.getState().plans);
  const [multiline, setMultiline] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRowRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queuedEditFocusedIdRef = useRef<string | null>(null);
  const pinnedMessageRef = useRef<{ id: string; content: string } | null>(null);
  /** The copy being made of each attached file, keyed by the path the user attached it by. */
  const stagingRef = useRef(new Map<string, Promise<string>>());

  const requestComposerFocus = useCallback(() => {
    textareaRef.current?.focus();
  }, []);

  const syncMultiline = useCallback(() => {
    const el = textareaRef.current;
    if (el) setMultiline(needsMultipleLines(el, inputRowRef.current));
  }, []);

  /** Grows the field with its content up to the ten-line ceiling the stylesheet caps it at. */
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    syncMultiline();
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [syncMultiline]);

  // The toolbar moving above or back beside the text changes the textarea's width, so its height
  // follows; on mount the textarea keeps its stylesheet height.
  const shownMultilineRef = useRef(multiline);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || shownMultilineRef.current === multiline) return;
    shownMultilineRef.current = multiline;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [multiline]);

  useEffect(() => {
    const row = inputRowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncMultiline());
    observer.observe(row);
    return () => observer.disconnect();
  }, [syncMultiline]);

  useEffect(() => () => recorderRef.current?.stop(), []);

  // Keyed on the token, not the text, so asking twice re-drafts the same line over an edited one.
  const draftToken = draftPrompt?.token ?? 0;
  const draftText = draftPrompt?.text ?? "";
  useEffect(() => {
    if (draftToken > 0) setInputPrompt(draftText);
  }, [draftToken, draftText]);

  useEffect(() => {
    setStoreState({ ...store.getState() });
    const unsub = store.subscribe(() => {
      setStoreState({ ...store.getState() });
    });
    store.init().catch(() => {});
    return () => {
      unsub();
      if (embedded) {
        // The panel owns this store, so it takes the `chat-event` subscription down with it rather
        // than leaving one behind per visit to a plan page. And it prunes nothing: V1 prunes in
        // `ChatApp`, not in the `ContentView` the panel is, and a prune here would reach chats the
        // panel never showed.
        store.destroy();
      } else {
        void store.pruneEmptySessions();
      }
    };
  }, [store, embedded]);

  // The spawned jobs pill reads its statuses from the live job list.
  useEffect(() => {
    const unsub = jobsStore.subscribe(() => {
      setJobs([...jobsStore.getState().jobs]);
    });
    return unsub;
  }, []);

  // The empty state's chips are drawn from the plans that need attention, so they follow the plan
  // list rather than a snapshot taken when the view mounted.
  useEffect(() => {
    const unsub = plansStore.subscribe(() => {
      setPlans([...plansStore.getState().plans]);
    });
    return unsub;
  }, []);

  const {
    sessions,
    activeSessionId,
    activeSession,
    queuedItems,
    isGenerating,
    error,
    agents,
    selectedAgentId,
    selectedModelId,
    selectedEffort,
  } = storeState;

  /**
   * The jobs this conversation started. A job that has aged out of the live list keeps its place,
   * with the outcome recovered from the transcript — a conversation's own jobs disappearing from
   * the header is worse than showing one with a thinner label.
   */
  const spawnedJobs = useMemo(() => {
    const sessionId = activeSession?.id;
    // Two sources for the same fact, unioned as V1's `ToSessionDto` unions them. The job's own
    // `chatSessionId` is the durable one — the daemon recorded it when the job was submitted — and it
    // is what makes the header right after a reload, or when the `chat.job_spawned` announcing a job
    // arrived while another conversation was on screen. The session's `spawnedJobIds` then adds back
    // the jobs that have aged out of the live list, whose outcome the transcript still holds.
    const ids = [
      ...(sessionId ? jobs.filter((job) => job.chatSessionId === sessionId).map((j) => j.id) : []),
      ...(activeSession?.spawnedJobIds ?? []),
    ].filter((id, index, all) => all.indexOf(id) === index);
    if (ids.length === 0) return [];
    const history = activeSession?.messages ?? [];

    return ids
      .map((id): Job | undefined => {
        const live = jobs.find((job) => job.id === id);
        if (live) return live;

        const state = resolveJobState(id, jobs, history);
        if (state === "unknown") return undefined;
        return {
          id,
          type: "Job",
          project: "",
          status: state === "completed" ? "Completed" : "Failed",
        };
      })
      .filter((job): job is Job => job !== undefined);
    // `messages.length` rather than `messages`: the store appends to that array in place, so its identity
    // does not change when a message arrives and a memo keyed on it alone keeps its previous value
    // however many times the component re-renders. A job whose outcome is only knowable from a
    // just-arrived `[System Event]` would never appear.
  }, [
    activeSession?.id,
    activeSession?.spawnedJobIds,
    activeSession?.messages,
    activeSession?.messages.length,
    jobs,
  ]);

  const latestMessage = activeSession?.messages[activeSession.messages.length - 1];
  const streamContentKey = `${activeSession?.id ?? ""}-${activeSession?.messages.length ?? 0}-${latestMessage?.id ?? ""}-${latestMessage?.content.length ?? 0}-${isGenerating}`;

  const {
    scrollContainerRef,
    anchorRef,
    spacerRef,
    autoScrollEnabled,
    isAtBottom,
    toggleAutoScroll,
    scrollToTail,
    resetToTail,
    pinMessage,
    retargetPin,
    clearPin,
  } = useChatAutoScroll({
    content: streamContentKey,
    isGenerating,
  });

  const addAttachments = (incoming: ChatAttachment[]) => {
    setAttachments((prev) => {
      const existingPaths = new Set(prev.map((a) => a.path));
      return [...prev, ...incoming.filter((a) => !existingPaths.has(a.path))];
    });
  };

  /**
   * Swaps the path of the chip added for `source` for the path the file was staged at.
   *
   * If a chip already carries the staged path — the same file attached twice — the second row is
   * dropped rather than duplicated: `addAttachments` de-duplicates on the path it was given, which is
   * the source path, and by the time this runs the first row no longer carries it.
   */
  const applyStagedPath = (source: string, staged: string) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.path === staged)) {
        return prev.filter((a) => a.path !== source);
      }
      return prev.map((a) => (a.path === source ? { ...a, path: staged } : a));
    });
  };

  /**
   * Copies each picked file into Tendril's attachment directory and re-points its chip at the copy.
   *
   * This is what makes an attachment previewable. The daemon only serves a file inside a configured
   * local-file root — the Tendril home, the plans folder, the project repos — and a screenshot picked
   * from `~/Desktop` is in none of them, so a message that referenced the original path could never
   * render more than a paperclip chip. V1 has the same constraint and answers it the same way: its
   * composer uploads every attachment into `<TendrilHome>/Attachments/<sessionId>/` and references the
   * copy. The staged path is also what the turn's `[Attached Files]:` block carries, so the agent reads
   * the same bytes the thumbnail shows.
   *
   * A staging failure is not fatal and not reported: the chip keeps the path the user picked, so the
   * agent is still told about a file that exists and only the thumbnail falls back to a chip.
   *
   * In-flight uploads are keyed by source path so that two drops of one file — or a drop of a file
   * already attached — settle on a single copy instead of racing into `shot.png` and `shot_1.png`.
   */
  const stageAttachments = async (paths: string[]) => {
    const sessionId = activeSession?.id;
    await Promise.all(
      paths.map(async (source) => {
        let pending = stagingRef.current.get(source);
        if (!pending) {
          pending = bridge.uploadChatAttachment(source, sessionId).then((staged) => staged.path);
          stagingRef.current.set(source, pending);
        }
        try {
          applyStagedPath(source, await pending);
        } catch {
          // Retried if the file is attached again.
          stagingRef.current.delete(source);
        }
      }),
    );
  };

  const addAttachmentPaths = (paths: string[]) => {
    addAttachments(paths.map((path) => ({ name: path.split(/[/\\]/).pop() || path, path })));
    void stageAttachments(paths);
  };

  const processFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).map((file) => ({
      name: file.name,
      path: (file as unknown as { path?: string }).path || file.name,
      mimeType: file.type || undefined,
    }));
    addAttachments(incoming);
    // A `File` from an `<input>` or a paste is bytes without a path in a Tauri webview, and there is
    // nothing on disk to stage; only the ones that did arrive with a real path are copied.
    void stageAttachments(incoming.map((a) => a.path).filter(isAbsolutePath));
  };

  // Webview-wide, not subtree-wide: see the table above. An embedded panel registers nothing.
  const nativeDropActive = useWebviewFileDrop({
    onPaths: addAttachmentPaths,
    onDragStateChange: setIsDraggingOver,
    enabled: !embedded,
  });

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = "";
    }
  };

  const handleAttachClick = async () => {
    try {
      const selected = await open({
        multiple: true,
        title: "Select Files to Attach",
      });
      if (selected === null) {
        return;
      }
      const paths = Array.isArray(selected) ? selected : [selected];
      addAttachmentPaths(paths);
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (nativeDropActive) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleCreateSession = async () => {
    try {
      await store.createSession("New Chat");
      requestComposerFocus();
    } catch {
      // Handled in store
    }
  };

  /** Deleting a conversation is confirmed first: V1 puts a dialog in front of it. */
  /**
   * Deletes the session the dialog is asking about, keeping the dialog open on failure so the
   * rejection can be read where the button was pressed — the whole reason this went through
   * `ConfirmDialog` rather than a bare `AlertDialog`, which had nowhere to report one.
   */
  const confirmDeleteSession = async () => {
    const id = deletingSessionId;
    if (!id) return;
    setDeleteSessionError(null);
    setIsDeletingSession(true);
    try {
      await store.deleteSession(id);
      setDeletingSessionId(null);
    } catch (err) {
      setDeleteSessionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingSession(false);
    }
  };

  /** Clears the composer after a send or a queue, and lets the field collapse to one line. */
  const resetComposer = () => {
    setInputPrompt("");
    setAttachments([]);
    // The next message attaching the same file gets its own copy: this one has been sent, and a second
    // chip pointing at the first message's file would be re-using something the user cannot see.
    stagingRef.current.clear();
    setMultiline(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  /**
   * Sends, or queues while the agent is still working: V1's composer never refuses a prompt, it
   * parks it behind the turn in flight and sends it when the agent finishes.
   */
  const handleSendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? inputPrompt).trim();
    if (!text && attachments.length === 0) return;
    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined;

    if (isGenerating) {
      resetComposer();
      try {
        await store.sendMessage(text, { enqueue: true, attachments: currentAttachments });
      } catch {
        // Handled in store
      }
      return;
    }

    resetComposer();
    resetToTail();
    try {
      // The store appends its optimistic user message synchronously, so the row to pin exists by
      // the time this returns to us — pin it so the question sits at the top while the reply grows.
      const pending = store.sendMessage(text, {
        attachments: currentAttachments,
      });
      const optimistic = store.getState().activeSession?.messages.at(-1);
      if (optimistic?.role === "user") {
        pinnedMessageRef.current = { id: optimistic.id, content: optimistic.content };
        pinMessage(optimistic.id);
      }
      await pending;
    } catch {
      // Handled in store
    }
  };

  /** Enter sends, ⌘/Ctrl+Enter sends, Shift+Enter is a newline. */
  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void handleSendMessage();
  };

  const handleComposerChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputPrompt(e.target.value);
    adjustTextareaHeight();
  };

  /** Files pasted into the prompt become attachments, as they do on a drop. */
  const handleComposerPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (pasted.length === 0) return;
    e.preventDefault();
    processFiles(pasted);
  };

  /**
   * Dictation, transcribed by the same endpoint the shared composer uses. The transcript is
   * appended to whatever is already typed rather than replacing it.
   */
  const toggleVoiceRecording = async () => {
    if (voiceStatus !== "idle") {
      recorderRef.current?.stop();
      return;
    }
    setVoiceError(null);
    const recorder = new VoiceRecorder({
      endpoint: TRANSCRIPTION_URL,
      onStatusChange: setVoiceStatus,
      onResult: (transcription: string) => {
        const trimmed = transcription.trim();
        if (!trimmed) {
          setVoiceError("Nothing was transcribed. Please try again.");
          return;
        }
        setInputPrompt((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
        requestComposerFocus();
        requestAnimationFrame(adjustTextareaHeight);
      },
      onError: (message: string) => setVoiceError(message),
    });
    recorderRef.current = recorder;
    await recorder.start();
  };

  /**
   * Drafts the follow-up rather than sending it: the outcomes are the agent's to summarise, but
   * what to ask about them is still the user's call, so the prompt lands in the composer.
   */
  const handleReviewJobs = () => {
    const summary = spawnedJobs
      .map((job) => `- ${job.type} ${job.id}${job.planTitle ? ` (${job.planTitle})` : ""}`)
      .join("\n");
    setInputPrompt(
      `Review the outcomes of the jobs this conversation started and tell me what changed:\n${summary}`,
    );
    requestComposerFocus();
  };

  /**
   * Jumps a queued prompt to the front: it leaves the queue and starts a turn right away, even
   * while one is running, which is what V1's force-send does. The store owns the interrupt and the
   * put-it-back-on-failure, so the prompt cannot be lost between the two calls.
   */
  const handleSendQueuedNow = async (item: ChatQueuedItem) => {
    await store.sendQueuedNow(item.id);
  };

  const handleStartEditQueued = (itemId: string, prompt: string) => {
    setEditingQueuedId(itemId);
    setEditingQueuedText(prompt);
  };

  const handleCancelEditQueued = () => {
    setEditingQueuedId(null);
    setEditingQueuedText("");
    queuedEditFocusedIdRef.current = null;
  };

  const handleSaveEditQueued = async (itemId: string) => {
    const next = editingQueuedText;
    setEditingQueuedId(null);
    setEditingQueuedText("");
    queuedEditFocusedIdRef.current = null;
    try {
      // An empty commit drops the item, which is how a queued prompt is cleared.
      await store.updateQueuedMessage(itemId, next);
    } catch {
      // Handled in store
    }
  };

  const handleCopyMessage = useCallback((msg: ChatMessage) => {
    void navigator.clipboard.writeText(msg.content);
    setCopiedMessageId(msg.id);
    setTimeout(() => {
      setCopiedMessageId(null);
    }, 2000);
  }, []);

  const handleCreatePlanFromMessage = useCallback(
    (content: string) => {
      if (onCreatePlan) {
        onCreatePlan(content);
      }
    },
    [onCreatePlan],
  );

  const messages = activeSession?.messages ?? [];

  // The optimistic user message is superseded by the server's copy, which arrives under a
  // different id, so the pin has to follow the content across the swap or it loses its target.
  useEffect(() => {
    const pinned = pinnedMessageRef.current;
    if (!pinned) return;
    if (messages.some((m) => m.id === pinned.id)) return;
    // Prefix, not equality: the daemon's copy of the prompt carries the `[Attached Files]:` block
    // the composer never showed, which is why V1 matches with `startsWith` too.
    const replacement = messages.find(
      (m) => m.role === "user" && m.content.startsWith(pinned.content),
    );
    if (replacement) {
      retargetPin(pinned.id, replacement.id);
      pinnedMessageRef.current = { ...pinned, id: replacement.id };
    } else {
      pinnedMessageRef.current = null;
      clearPin();
    }
  }, [messages, retargetPin, clearPin]);

  // A different conversation has nothing pinned, and a stale spacer would leave dead space.
  useEffect(() => {
    pinnedMessageRef.current = null;
    clearPin();
  }, [activeSessionId, clearPin]);

  const getMessageKey = useCallback((index: number) => messages[index].id, [messages]);

  const estimateMessageSize = useCallback(
    (index: number, clientWidth?: number) => {
      const msg = messages[index];
      if (!msg) return 160;
      return estimateChatMessageHeight(msg.content, {
        role: msg.role,
        hasAttachments: Boolean(msg.attachments && msg.attachments.length > 0),
        containerWidth: clientWidth,
      });
    },
    [messages],
  );

  const { isVirtualized, totalSize, items, scrollToIndex, visibleRange } = useChatMessageWindow({
    count: messages.length,
    scrollContainerRef,
    getItemKey: getMessageKey,
    enabled: messages.length >= CHAT_VIRTUALIZATION_MIN_MESSAGES,
    estimateSize: estimateMessageSize,
    pinnedIndex: messages.length - 1,
  });

  const pendingQuestions = usePendingChatQuestions({
    messages,
    visibleRange,
  });

  const targetPendingQuestion = pendingQuestions.find((q) => q.isScrolledOutOfView);

  const handleJumpToQuestion = useCallback(
    (index: number) => {
      scrollToIndex(index, { smooth: true, align: "center" });
    },
    [scrollToIndex],
  );

  /**
   * The composer's agent pill. `compact` is icon-only, and V1 turns it on for exactly one case —
   * `compact={embedded}` in `ChatWidget.tsx` — because the panel beside a plan has no room for the
   * agent's name beside the mic and the send button.
   */
  const renderAgentPicker = (compact: boolean) => (
    <AgentPicker
      instanceId={compact ? "agent-picker-compact" : "agent-picker"}
      compact={compact}
      agents={agents}
      selectedAgentId={selectedAgentId}
      selectedModelId={selectedModelId}
      selectedEffort={selectedEffort}
      onAgentChange={(agentId) => store.setAgent(agentId)}
      onModelChange={(agentId, modelId) => store.setModelForAgent(agentId, modelId)}
      onEffortChange={(agentId, effort) => store.setEffortForAgent(agentId, effort)}
      rememberedFor={(agentId) => store.getAgentPreference(agentId)}
    />
  );

  const timeOfDayGreeting = useMemo(() => buildGreeting(new Date()), []);
  const greeting = greetingOverride ?? timeOfDayGreeting;
  const chatSamplePrompts = useMemo(() => buildChatSamplePrompts(plans, jobs), [plans, jobs]);
  const samplePrompts = samplePromptsOverride ?? chatSamplePrompts;
  const hasComposerContent = inputPrompt.trim().length > 0 || attachments.length > 0;

  /**
   * The composer's embedded measurements, from `chat-widget.css`'s embedded block: "the composer
   * takes the prototype's tighter measurements (16px icons, 28px buttons)", a 12px radius rather than
   * 16px, the paperclip flush rather than hung at -6px, 6px between the tools rather than 12px, and
   * 0.9 opacity on the two ghost buttons rather than 0.6.
   *
   * The textarea's own metrics are deliberately left alone. V1 also shrinks it to 28px/14px there,
   * but `needsMultipleLines` measures the live element against its own padding and line height, and
   * that measurement is what decides whether the toolbar sits beside the prompt or above it. Four
   * pixels of field height is not worth putting a second set of numbers under that.
   */
  const composerStyle = embedded
    ? {
        box: "rounded-xl",
        button: "size-7 rounded-md",
        icon: "size-4",
        attachOffset: "",
        ghost: "opacity-90 hover:opacity-100",
        tools: "gap-1.5",
      }
    : {
        box: "rounded-2xl",
        button: "size-8 rounded-lg",
        icon: "size-5",
        attachOffset: "-ml-1.5",
        ghost: "opacity-60 hover:opacity-100",
        tools: "gap-3",
      };

  const sessionPendingDeletion = sessions.find((s) => s.id === deletingSessionId);
  const sessionPendingDeletionLabel = sessionPendingDeletion?.title.trim()
    ? `"${sessionPendingDeletion.title}"`
    : "this chat session";

  /**
   * The Chats list goes to the shell sidebar, not into this page: `ChatApp.Build` renders no list of
   * its own, it sends one and returns a `ContentView` that is the conversation. Published on every
   * render, as `ShellSidebarListSignal` documents ("The active app publishes this on every build") -
   * V1 additionally guards the send behind a fingerprint, which is an optimisation over the same
   * contract rather than a different one.
   */
  const sidebarList = useMemo(
    () =>
      embedded
        ? null
        : buildChatSidebarList(
            sessions,
            activeSessionId ?? null,
            (id) => store.sessionRowState(id),
            {
              onNew: () => void handleCreateSession(),
              onSearch: () => {
                setSearchQuery("");
                setIsSearchOpen(true);
              },
              onSelect: (id) => void store.selectSession(id),
              onRename: (id, title) => void store.renameSession(id, title),
              onDelete: (id) => setDeletingSessionId(id),
              onTogglePin: (id) => store.togglePinSession(id),
            },
          ),
    // The row states are read through the store on each build, so a re-render caused by a
    // generating-state event rebuilds the list even though `sessions` is the same array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, activeSessionId, storeState, embedded],
  );

  usePublishSidebarList(sidebarList);

  /** `ChatSearchDialog`: a case-insensitive match on the chat's display title, capped at fifteen. */
  const searchResults = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return sessions
      .filter((session) => term.length === 0 || displayTitle(session).toLowerCase().includes(term))
      .slice(0, MAX_CHAT_SEARCH_RESULTS);
  }, [sessions, searchQuery]);

  return (
    <div
      className="flex h-full w-full overflow-hidden bg-background text-foreground"
      data-embedded={embedded}
      data-testid={embedded ? "embedded-chat-view" : "chat-view"}
    >
      {/* Main Chat Thread Area. A file may be dropped anywhere in it, not only on the composer. */}
      <main
        className="relative flex flex-1 flex-col overflow-hidden"
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingOver && (
          <div className="absolute inset-2 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-foreground bg-background/90 backdrop-blur-xs pointer-events-none">
            <div className="flex flex-col items-center gap-2.5 text-center text-foreground">
              <Upload className="size-9 opacity-80" />
              <span className="font-medium">Drop files here to attach to message</span>
            </div>
          </div>
        )}
        {/* Error Banner */}
        {error && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive flex items-center justify-between">
            <span>{error}</span>
          </div>
        )}

        {/*
          Header Toolbar. Embedded there is none: `ChatWidget` renders
          `activeSession && headerJobs.length > 0 && <div className="chat-header--embedded"><JobsMenu/></div>`
          in its place, right-aligned with no border, because the page hosting the panel already
          carries the plan's name and its actions. That is also where the new-chat button goes — the
          plan's chat is the plan's, and `PlanChatView` passes `startNewChat: () => { }`.
        */}
        {embedded ? (
          activeSession &&
          spawnedJobs.length > 0 && (
            <div
              data-testid="embedded-chat-jobs"
              className="flex shrink-0 items-center justify-end px-4 pb-2"
            >
              <JobsMenu
                jobs={spawnedJobs}
                spawned
                onOpenPlan={onOpenPlan}
                onReviewJobs={handleReviewJobs}
              />
            </div>
          )
        ) : (
          <ChatHeader
            key={activeSessionId ?? "none"}
            title={activeSession ? displayTitle(activeSession) : "No Active Chat"}
            editable={Boolean(activeSession)}
            autoScrollEnabled={autoScrollEnabled}
            onToggleAutoScroll={toggleAutoScroll}
            jobs={spawnedJobs}
            onOpenPlan={onOpenPlan}
            onReviewJobs={handleReviewJobs}
            onNewChat={handleCreateSession}
            onRename={(next) => {
              if (activeSession) void store.renameSession(activeSession.id, next);
            }}
            onDelete={() => activeSession && setDeletingSessionId(activeSession.id)}
          />
        )}

        {/* Message Thread List */}
        <div className="flex-1 overflow-hidden relative">
          {!activeSession || activeSession.messages.length === 0 ? (
            /* V1's empty thread: the greeting, the headline, and the prompts it suggests. No
               explanation of what a chat is - the composer below says that.

               `chat-widget.css`'s embedded block gives the same markup the panel's measurements:
               20px/26px instead of 24px, `gap: 0` instead of 4px, `padding: 32px 16px` instead of
               48px, the greeting truncated to one line (it is the plan's title, which is long), and
               the chips flush left in a horizontal scroller rather than centred and wrapped -
               "centering an overflowing nowrap scroller would push leading chips past the scroll
               origin". */
            <div
              className={`flex h-full flex-col items-center justify-center px-4 text-center ${
                embedded ? "gap-0 py-8" : "gap-1 py-12"
              }`}
            >
              <div
                className={
                  embedded
                    ? "w-full truncate text-xl font-light leading-relaxed text-muted-foreground"
                    : "text-2xl font-normal leading-tight text-muted-foreground"
                }
                title={embedded ? greeting : undefined}
              >
                {greeting}
              </div>
              <div
                className={
                  embedded
                    ? "text-xl font-medium leading-relaxed text-foreground"
                    : "text-2xl font-semibold leading-tight text-foreground"
                }
              >
                {headline}
              </div>
              {/* Wraps in both modes. Embedded, the panel is only as wide as the plan page leaves it,
                  so a nowrap row put the later chips off the edge — and with no room for a horizontal
                  scrollbar they were simply unreachable. A chip that does not fit takes the next line. */}
              <div
                className={`mt-4 flex flex-wrap gap-2 ${
                  embedded ? "w-full justify-start" : "justify-center"
                }`}
                data-testid="sample-prompts"
              >
                {samplePrompts.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    title={item.prompt}
                    onClick={() => {
                      setInputPrompt(item.prompt);
                      requestComposerFocus();
                    }}
                    className="max-w-full rounded-2xl border border-border bg-background px-4 py-2 text-left font-medium text-foreground transition-colors hover:border-muted-foreground hover:bg-accent"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ChatMessageList
              ref={scrollContainerRef}
              /* `.chat-thread` embedded is `padding: 10px var(--tch-embedded-inset) 0` — the rows
                 inset themselves 16px because `.pws-chat` adds no horizontal padding, so the list
                 scrolls at the panel's full width and the scrollbar sits clear of the text. */
              className={embedded ? "h-full px-4" : "h-full"}
              style={{ paddingTop: PIN_TOP_PADDING }}
              enableAutoScroll={false}
              showScrollButton={false}
            >
              {isVirtualized ? (
                <div
                  style={{ height: totalSize, position: "relative" }}
                  data-testid="chat-virtual-container"
                >
                  {items.map((item) => {
                    const msg = messages[item.index];
                    return (
                      <div
                        key={item.key}
                        ref={item.measureRef}
                        data-index={item.index}
                        data-testid="chat-virtual-row"
                        style={{
                          position: "absolute",
                          top: item.start,
                          left: 0,
                          width: "100%",
                          paddingBottom: 24,
                        }}
                      >
                        <ChatMessageRow
                          message={msg}
                          isCopied={copiedMessageId === msg.id}
                          onCopy={handleCopyMessage}
                          onCreatePlan={handleCreatePlanFromMessage}
                          inProgressAnswers={storeState.inProgressAnswers[msg.id]}
                          isSubmittingAnswer={store.isSubmittingAnswer(msg.id)}
                          onOpenPlan={onOpenPlan}
                          onOpenImage={setActiveLightboxImage}
                          wireframeBaseUrl={wireframeBaseUrl}
                          jobs={jobs}
                          threadMessages={messages}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                messages.map((msg, index) => (
                  <div key={msg.id} data-index={index}>
                    <ChatMessageRow
                      message={msg}
                      isCopied={copiedMessageId === msg.id}
                      onCopy={handleCopyMessage}
                      onCreatePlan={handleCreatePlanFromMessage}
                      inProgressAnswers={storeState.inProgressAnswers[msg.id]}
                      isSubmittingAnswer={store.isSubmittingAnswer(msg.id)}
                      onOpenPlan={onOpenPlan}
                      onOpenImage={setActiveLightboxImage}
                          wireframeBaseUrl={wireframeBaseUrl}
                      jobs={jobs}
                      threadMessages={messages}
                    />
                  </div>
                ))
              )}

              {/* The live turn's own status line, as V1 renders it: muted, in the thread, at the
                  leading edge where the reply will appear. */}
              {isGenerating && (
                <div className="flex min-h-6 w-full items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span>Working...</span>
                </div>
              )}

              {/* Sized by the pin so the pinned row can sit at the top of the viewport. */}
              <div
                ref={spacerRef}
                data-testid="chat-pin-spacer"
                aria-hidden="true"
                className="w-full shrink-0 pointer-events-none"
                style={{ height: 0 }}
              />

              <div
                ref={anchorRef}
                data-testid="chat-scroll-anchor"
                className="h-px w-full pointer-events-none"
              />
            </ChatMessageList>
          )}

          {/* Floating Actions: Jump to Pending Question & Scroll to Tail */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 pointer-events-none">
            {targetPendingQuestion && (
              <button
                type="button"
                data-testid="chat-jump-to-question-button"
                onClick={() => handleJumpToQuestion(targetPendingQuestion.messageIndex)}
                className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3.5 py-1.5 text-xs font-medium text-warning shadow-lg backdrop-blur transition-colors hover:bg-warning/20"
              >
                <HelpCircle className="size-3.5 text-warning" />
                <span>
                  Jump to pending question {targetPendingQuestion.direction === "down" ? "↓" : "↑"}
                </span>
              </button>
            )}

            {!isAtBottom && (
              <button
                type="button"
                data-testid="chat-scroll-tail-button"
                onClick={() => scrollToTail(true)}
                className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full border border-border bg-popover/90 px-3.5 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur transition-colors hover:bg-accent"
              >
                <ArrowDown className="size-3.5 text-muted-foreground" />
                {isGenerating ? (
                  <>
                    <span>Scroll to streaming tail</span>
                    <span className="flex size-1.5 animate-pulse rounded-full bg-current" />
                  </>
                ) : (
                  <span>Scroll to bottom</span>
                )}
              </button>
            )}
          </div>
        </div>

        {/*
          The composer, as V1 builds it: one rounded surface holding the attachment affordance, the
          prompt, and the agent picker, mic and send button, with the queue that feeds it directly
          above and the whole thing capped to the thread's width.
        */}
        {/* No divider above the composer: its own surface separates it from the thread.
            `.chat-footer` embedded is `padding: 12px var(--tch-embedded-inset) 0` — no bottom
            padding, because `.pws-chat` already ends in `padding: 0 0 14px`. */}
        <div
          data-testid="chat-composer-area"
          className={embedded ? "shrink-0 px-4 pt-3" : "shrink-0 px-3 py-4"}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
            {queuedItems.length > 0 && (
              <div className="rounded-2xl border border-border bg-muted/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-medium text-foreground">Queued Messages</span>
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-xs text-foreground">
                      {queuedItems.length}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      Sends after agent finishes working
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="chat-queue-collapse"
                    aria-label={
                      isQueueExpanded ? "Collapse queued messages" : "Expand queued messages"
                    }
                    aria-expanded={isQueueExpanded}
                    onClick={() => setIsQueueExpanded(!isQueueExpanded)}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-selector text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronDown
                      className={`size-4 transition-transform ${isQueueExpanded ? "" : "-rotate-90"}`}
                    />
                  </button>
                </div>

                {isQueueExpanded && (
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {queuedItems.map((item) => (
                      <div
                        key={item.id}
                        data-testid="queued-item"
                        className="flex items-center justify-between gap-2 rounded-selector bg-background px-2 py-1"
                      >
                        {editingQueuedId === item.id ? (
                          <>
                            <Input
                              data-testid="queued-item-input"
                              aria-label="Edit queued prompt"
                              value={editingQueuedText}
                              ref={(node) => {
                                // Focus once per edit: re-focusing on every keystroke would fight
                                // the caret the user is moving.
                                if (node && queuedEditFocusedIdRef.current !== item.id) {
                                  queuedEditFocusedIdRef.current = item.id;
                                  node.focus();
                                  node.select();
                                }
                              }}
                              onChange={(e) => setEditingQueuedText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void handleSaveEditQueued(item.id);
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  handleCancelEditQueued();
                                }
                              }}
                              className="h-7 flex-1 border-border bg-background px-1.5 py-0.5 text-foreground"
                            />
                            <button
                              type="button"
                              data-testid="queued-item-save"
                              onClick={() => void handleSaveEditQueued(item.id)}
                              className="text-muted-foreground hover:text-foreground"
                              title="Save queued prompt"
                            >
                              <Check className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              data-testid="queued-item-cancel"
                              onClick={handleCancelEditQueued}
                              className="text-muted-foreground hover:text-destructive"
                              title="Cancel edit"
                            >
                              <X className="size-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span className="truncate text-foreground">
                                {item.prompt ||
                                  (item.attachments && item.attachments.length > 0
                                    ? `${item.attachments.length} attachment${item.attachments.length > 1 ? "s" : ""}`
                                    : "")}
                              </span>
                              {item.attachments && item.attachments.length > 0 && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">
                                  <Paperclip className="size-2.5" />
                                  {item.attachments.length}
                                </span>
                              )}
                            </span>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                data-testid="queued-item-send-now"
                                onClick={() => void handleSendQueuedNow(item)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Send now"
                              >
                                <ArrowRight className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                data-testid="queued-item-edit"
                                onClick={() => handleStartEditQueued(item.id, item.prompt)}
                                className="text-muted-foreground hover:text-foreground"
                                title="Edit queued prompt"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => store.deleteQueuedMessage(item.id)}
                                className="text-muted-foreground hover:text-destructive"
                                title="Remove from queue"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              className={`flex flex-col gap-2 ${composerStyle.box} border bg-muted py-2 pl-3.5 pr-2 transition-colors ${
                isDraggingOver
                  ? "border-dashed border-foreground"
                  : "border-transparent focus-within:border-input"
              }`}
            >
              {voiceError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-field border border-destructive bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive"
                >
                  <span className="min-w-0 flex-1">{voiceError}</span>
                  <button
                    type="button"
                    onClick={() => setVoiceError(null)}
                    aria-label="Dismiss voice input error"
                    title="Dismiss"
                    className="inline-flex size-5 shrink-0 items-center justify-center rounded-selector text-current"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              {attachments.length > 0 && (
                <div
                  data-testid="composer-attachment-chips"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {attachments.map((att, index) => (
                    <div
                      key={`${att.path}-${index}`}
                      className="flex max-w-full items-center gap-1.5 rounded-md bg-background px-1.5 py-1 text-foreground"
                      title={att.path}
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="max-w-[220px] truncate">{att.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(index)}
                        className="rounded-selector p-0.5 text-muted-foreground hover:text-destructive"
                        title={`Remove ${att.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  {attachments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setAttachments([])}
                      className="rounded-selector px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-destructive"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              )}

              {/* One line: buttons sit beside the text. More than one: the buttons line up as a
                  toolbar above it and the text takes the whole width. */}
              <div
                ref={inputRowRef}
                data-multiline={multiline}
                className={`flex min-h-8 items-end gap-3 ${multiline ? "flex-wrap" : ""}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  data-testid="file-upload-input"
                  onChange={handleFileInputChange}
                />
                <button
                  type="button"
                  data-testid="composer-attach-button"
                  onClick={handleAttachClick}
                  title="Attach file"
                  aria-label="Attach file"
                  className={`${composerStyle.attachOffset} inline-flex ${composerStyle.button} shrink-0 items-center justify-center text-foreground ${composerStyle.ghost} transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    multiline ? "order-0" : ""
                  }`}
                >
                  <Paperclip className={composerStyle.icon} />
                </button>

                <ChatInput
                  ref={textareaRef}
                  id="chat-composer"
                  aria-label="Chat prompt"
                  placeholder={COMPOSER_PLACEHOLDER}
                  value={inputPrompt}
                  onChange={handleComposerChange}
                  onKeyDown={handleComposerKeyDown}
                  onPaste={handleComposerPaste}
                  className={multiline ? "order-2 basis-full" : ""}
                />

                <div
                  className={`flex shrink-0 items-center ${composerStyle.tools} ${multiline ? "order-1 ml-auto" : ""}`}
                >
                  {/* `compact={embedded}` in `ChatWidget.tsx`: icon-only beside a plan. */}
                  {renderAgentPicker(embedded)}

                  <button
                    type="button"
                    data-testid="composer-voice-button"
                    onClick={() => void toggleVoiceRecording()}
                    title="Voice input"
                    aria-label="Voice input"
                    className={`inline-flex ${composerStyle.button} shrink-0 items-center justify-center transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      voiceStatus === "recording"
                        ? "animate-pulse text-destructive opacity-100"
                        : voiceStatus === "idle"
                          ? `text-foreground ${composerStyle.ghost}`
                          : "text-foreground opacity-100"
                    }`}
                  >
                    {voiceStatus === "connecting" || voiceStatus === "processing" ? (
                      <Loader2 className={`${composerStyle.icon} animate-spin`} />
                    ) : voiceStatus === "recording" ? (
                      <Square className={composerStyle.icon} />
                    ) : (
                      <Mic className={composerStyle.icon} />
                    )}
                  </button>

                  {isGenerating ? (
                    <>
                      {hasComposerContent && (
                        <button
                          type="button"
                          data-testid="composer-queue-button"
                          onClick={() => void handleSendMessage()}
                          title="Queue message"
                          aria-label="Queue message"
                          className={`inline-flex ${composerStyle.button} shrink-0 items-center justify-center bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                        >
                          <ListPlus className="size-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => store.cancelGeneration()}
                        title="Stop agent"
                        aria-label="Stop agent"
                        className={`inline-flex ${composerStyle.button} shrink-0 items-center justify-center border border-input bg-muted text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                      >
                        <Square className="size-3 fill-current" />
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSendMessage()}
                      disabled={!hasComposerContent}
                      title="Send message"
                      aria-label="Send message"
                      className={`inline-flex ${composerStyle.button} shrink-0 items-center justify-center bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                    >
                      <SendHorizontal className="size-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <ImageLightbox image={activeLightboxImage} onClose={() => setActiveLightboxImage(null)} />

        {/* The app's confirmation contract, rather than a bare `AlertDialog`: `AlertDialogAction`
            renders the *primary* treatment, so deleting a chat looked like the safe choice, and a
            rejected delete had nowhere to report itself. `ConfirmDialog` carries the destructive
            variant, the inline error surface, and the Escape/outside-click rules from `DialogShell`. */}
        <ConfirmDialog
          isOpen={deletingSessionId !== null}
          onClose={() => {
            setDeletingSessionId(null);
            setDeleteSessionError(null);
          }}
          title="Delete Session"
          body={`Are you sure you want to delete ${sessionPendingDeletionLabel}? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={() => void confirmDeleteSession()}
          isBusy={isDeletingSession}
          error={deleteSessionError}
          testId="chat-delete-session-dialog"
        />

        {/* `Apps/Chat/Dialogs/ChatSearchDialog`: search over chat titles, opened from the Chats
            section's search icon, and picking a row selects that chat. It belongs to the chat app,
            not the shell - the shell's own search icon opens the *plan* search dialog, which is why
            the published list carries its own `onSearch`.

            Embedded there is no published list, so nothing can open this; it is also the wrong
            offer, since the panel follows the plan's session and cannot be pointed at another. */}
        {!embedded && (
          <Dialog open={isSearchOpen} onOpenChange={setIsSearchOpen}>
            <DialogContent data-testid="chat-search-dialog" className="max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Search Chats</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <Input
                  autoFocus
                  type="search"
                  aria-label="Search chats"
                  placeholder="Search chats"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchResults.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No chats found.</p>
                ) : (
                  <div className="flex max-h-80 flex-col overflow-y-auto">
                    {searchResults.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        data-testid="chat-search-result"
                        onClick={() => {
                          setIsSearchOpen(false);
                          void store.selectSession(session.id);
                        }}
                        className="flex items-center justify-between gap-2 rounded-selector px-2.5 py-2 text-left text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        <span className="truncate">{displayTitle(session)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Date(session.updatedAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}
      </main>
    </div>
  );
};

export default ChatView;
