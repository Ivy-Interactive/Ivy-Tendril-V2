import { agentsApi } from "../api/agentsApi";
import { chatApi } from "../api/chatApi";
import { publishChatSessionCount } from "./chatSessionCount";
import { onChatEvent, type EventUnsubscribe } from "../api/events";
import { DEFAULT_OPTION_ID, type AgentOption } from "../types/agents";
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  ChatSession,
  ChatState,
  InProgressQuestionAnswers,
} from "../types/chat";
import {
  AGENT_PREFERENCES_STORAGE_KEY,
  loadStoredAgentPreferences,
  loadStoredSelectedAgent,
  saveStoredAgentPreferences,
  saveStoredSelectedAgent,
  type AgentPreference,
  type AgentPreferences,
} from "./agentPreferences";
import type { QuestionsDraftState, QuestionsDraftStore } from "@ivy-interactive/components/tendril";
import {
  extractPlanQuestions,
  mergeConfirmedQuestionsBlock,
  patchQuestionsMarkdown,
} from "../utils/questionMarkdown";

export type { ChatState, InProgressQuestionAnswers } from "../types/chat";

const IN_PROGRESS_ANSWERS_STORAGE_KEY = "tendril:chat:in_progress_answers";
const DRAFT_OWNERS_STORAGE_KEY = "tendril:chat:draft_session_owners";
/**
 * Unsent composer text, keyed by session id.
 *
 * V1 has no counterpart to port, and the reason is instructive: `ChatWidget` holds its prompt in a
 * plain `useState` (`const [promptText, setPromptText] = useState("")`) and never persists it,
 * because the Ivy shell keeps the widget mounted while you move around the app. V2's Chat page is
 * a `React.lazy` route that `App.renderActiveView` swaps out, so leaving the page unmounts the
 * composer and takes the half-typed prompt with it. The nearest thing V1 *does* have is the
 * per-message question-draft store (`questionDraftsRef` in `ChatWidget.tsx`, contract in
 * `PlanMarkdown/questionsContext.ts`), which exists for exactly this reason - "a drafted but
 * unsubmitted answer survives session switches" - so this follows its shape: a map keyed by what
 * the draft belongs to, never one global slot.
 *
 * Keyed per session and not globally on purpose. One shared draft would put a prompt written for
 * one conversation into the composer of another, which is a worse bug than the one being fixed.
 */
const COMPOSER_DRAFTS_STORAGE_KEY = "tendril:chat:composer_drafts";
export const PINNED_SESSIONS_STORAGE_KEY = "tendril:chat:pinned_sessions";

/** The agent every chat runs with until the catalog says otherwise. */
export const FALLBACK_AGENT_ID = "claude";

/**
 * How long an interrupt is given to land before a force-send goes ahead anyway, matching the five
 * seconds `ChatExecutionService.InterruptAsync` waits on the execution task.
 */
export const TURN_INTERRUPT_TIMEOUT_MS = 5000;

/** How a row in the Chats list reads while, or just after, its own turn runs. */
export type ChatSessionRowState = "working" | "completed" | null;

/**
 * The prompt a turn actually carries when files are attached. Port of the `promptWithAttachments`
 * block in `ChatExecutionService.SendMessageAsync`: the paths are appended to the prompt under an
 * `[Attached Files]:` heading, because that is the only channel the agent process has for them.
 */
export function buildPromptWithAttachments(
  prompt: string,
  attachments?: ChatAttachment[] | null,
): string {
  if (!attachments || attachments.length === 0) return prompt;
  const lines: string[] = [];
  if (prompt.trim()) {
    lines.push(prompt, "");
  }
  lines.push("[Attached Files]:");
  for (const attachment of attachments) {
    lines.push(`- ${attachment.path}`);
  }
  return lines.join("\n").trimEnd();
}

function loadStoredPinnedSessions(): Record<string, string> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(PINNED_SESSIONS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch {
    // Fallback to empty map if storage is restricted or throws
  }
  return {};
}

function saveStoredPinnedSessions(data: Record<string, string>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(PINNED_SESSIONS_STORAGE_KEY);
      } else {
        storage.setItem(PINNED_SESSIONS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

function loadStoredInProgressAnswers(): Record<string, InProgressQuestionAnswers> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }

    // Backward compatibility: check sessionStorage for legacy draft answers
    const legacyStorage =
      typeof sessionStorage !== "undefined"
        ? sessionStorage
        : typeof window !== "undefined"
          ? window.sessionStorage
          : null;
    if (legacyStorage) {
      const legacyRaw = legacyStorage.getItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        if (storage) {
          storage.setItem(IN_PROGRESS_ANSWERS_STORAGE_KEY, legacyRaw);
        }
        legacyStorage.removeItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
        return parsed;
      }
    }
  } catch {
    // Fallback to in-memory if storage is restricted or throws
  }
  return {};
}

function saveStoredInProgressAnswers(data: Record<string, InProgressQuestionAnswers>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
      } else {
        storage.setItem(IN_PROGRESS_ANSWERS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

/**
 * The unsent composer text of every session that has some, as of the last write by any window.
 *
 * Same defensive shape as the other stored maps here: storage can be absent (a non-browser test
 * environment), restricted (private browsing), or hold something another version wrote, and none of
 * those is a reason to fail to open a chat.
 */
function loadStoredComposerDrafts(): Record<string, string> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(COMPOSER_DRAFTS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch {
    // Fallback to in-memory if storage is restricted or throws
  }
  return {};
}

function saveStoredComposerDrafts(data: Record<string, string>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
      } else {
        storage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

function loadStoredDraftOwners(): Record<string, string> {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      const raw = storage.getItem(DRAFT_OWNERS_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch {
    // Fallback to in-memory if storage is restricted or throws
  }
  return {};
}

function saveStoredDraftOwners(data: Record<string, string>): void {
  try {
    const storage =
      typeof localStorage !== "undefined"
        ? localStorage
        : typeof window !== "undefined"
          ? window.localStorage
          : null;
    if (storage) {
      if (Object.keys(data).length === 0) {
        storage.removeItem(DRAFT_OWNERS_STORAGE_KEY);
      } else {
        storage.setItem(DRAFT_OWNERS_STORAGE_KEY, JSON.stringify(data));
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
}

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

/**
 * Every live store in this window, so a write made through one is seen by the others.
 *
 * At most two exist: the app-wide store the Chat page owns, and a plan-scoped one behind the chat
 * beside a plan. See {@link ChatStore.adoptStorageChange} for why the sharing is needed at all.
 */
const liveChatStores = new Set<ChatStore>();

export class ChatStore {
  /**
   * The plan this instance follows, or null for the app-wide store the Chat page owns.
   *
   * Two things follow from it and nothing else does: the session list is narrowed to the plan's own
   * conversation (so "select the first one" resolves to `FindForPlan`'s answer, or to nothing), and a
   * session created here records the plan, which is the only way the panel finds it again.
   */
  private readonly planScope: ChatStorePlanScope | null;

  private state: ChatState = {
    sessions: [],
    activeSessionId: null,
    activeSession: null,
    agents: [],
    selectedAgentId: loadStoredSelectedAgent() ?? FALLBACK_AGENT_ID,
    selectedModelId: DEFAULT_OPTION_ID,
    selectedEffort: DEFAULT_OPTION_ID,
    queuedItems: [],
    isGenerating: false,
    isCancelling: false,
    isLoading: false,
    error: null,
    inProgressAnswers: loadStoredInProgressAnswers(),
    submittingAnswers: {},
  };

  private listeners: Set<() => void> = new Set();
  private eventUnsubscribe: EventUnsubscribe | null = null;
  /** In-flight (or settled) `init()`, so concurrent callers share one subscription. */
  private initPromise: Promise<void> | null = null;
  /**
   * Bumped by {@link destroy}, so an `init()` still in flight knows its work is unwanted.
   *
   * `onChatEvent` is awaited, so a store torn down in that window would otherwise have its listener
   * registered *after* the `destroy()` that was supposed to remove it — and the plan panel is torn
   * down in exactly that window, because React's strict mode mounts it, unmounts it and mounts it
   * again before a single await has settled.
   */
  private generation = 0;
  /**
   * Whether `fetchSessions` has come back, so `state.sessions` is a list rather than a placeholder.
   * Only the Chat badge reads it, and only to tell "no chats" from "not asked yet".
   */
  private sessionsLoaded = false;
  private storageListenerAttached = false;
  private draftOwners: Record<string, string> = loadStoredDraftOwners();
  /**
   * Every session's unsent composer text. See {@link COMPOSER_DRAFTS_STORAGE_KEY} for why this is
   * kept out here rather than in the composer's own `useState`.
   */
  private composerDrafts: Record<string, string> = loadStoredComposerDrafts();
  /**
   * Every message's in-progress question-block drafts, keyed `${messageId}::${blockKey}`, exactly
   * as V1's `questionDraftsRef` in `ChatWidget.tsx` keys its own: "a drafted but unsubmitted
   * answer survives session switches for as long as the widget stays mounted".
   *
   * Here rather than in a `useRef` for the same reason {@link COMPOSER_DRAFTS_STORAGE_KEY} is here:
   * V1's chat widget stays mounted while you move around the Ivy shell, V2's Chat page is a lazy
   * route that unmounts, and `ChatMessageRow` is additionally remounted by virtualization every
   * time its row scrolls out of the window. A draft held anywhere in the tree would not survive
   * either. Not persisted: it is unsubmitted UI state, and V1 does not persist it either - what
   * has to outlive a reload is a *submitted* answer, which is {@link inProgressAnswers}.
   */
  private questionDrafts: Map<string, QuestionsDraftState> = new Map();
  /**
   * One `QuestionsDraftStore` per message, cached so the context value keeps its identity across
   * renders and remounts - V1 caches `draftStoreFor` in a `Map` for exactly that reason.
   */
  private questionDraftStores: Map<string, QuestionsDraftStore> = new Map();
  private pinnedSessions: Record<string, string> = loadStoredPinnedSessions();
  private agentPreferences: AgentPreferences = loadStoredAgentPreferences();
  /**
   * Which sessions are generating, and which finished one while the user was elsewhere. V1 keeps
   * both sets in `ChatHistoryService` (`SetSessionGenerating`) and every consumer asks about a
   * named session; `state.isGenerating` here is only the answer for the *active* one, so switching
   * away from a working chat no longer leaves the composer stuck in its stop-and-queue state.
   */
  private generatingSessionIds: Set<string> = new Set();
  private completedSessionIds: Set<string> = new Set();
  /**
   * Sessions whose stop has been asked for but whose turn has not ended. Per session, and not a
   * single flag, for the same reason the generating sets are: stopping one chat and then opening
   * another must not leave the second one's composer wearing the first one's pending state.
   */
  private cancellingSessionIds: Set<string> = new Set();
  /** Resolvers waiting for a session's turn to end, used by the force-send path. */
  private turnEndWaiters: Map<string, Array<() => void>> = new Map();
  /**
   * User messages this client appended before the daemon confirmed them. The daemon's own copy
   * arrives under a fresh id and, when files were attached, with the `[Attached Files]:` block
   * appended, so it is matched by prefix rather than by id - V1's ChatWidget retires its optimistic
   * rows the same way (`m.content.startsWith(opt.content)`).
   */
  private optimisticMessageIds: Set<string> = new Set();

  constructor(planScope?: ChatStorePlanScope) {
    this.planScope = planScope ?? null;
    liveChatStores.add(this);
    if (typeof window !== "undefined") {
      this.attachStorageListener();
    }
    this.applyAgentPreference(this.state.selectedAgentId);
  }

  /** Whether this instance follows one plan's conversation rather than the whole history. */
  public get isPlanScoped(): boolean {
    return this.planScope !== null;
  }

  /** The plan this chat belongs to, or null for the general chat page. */
  public get planId(): string | null {
    return this.planScope?.planId ?? null;
  }

  private handleStorageEvent = (event: StorageEvent): void => {
    this.adoptStorageChange(event.key, event.newValue);
  };

  /**
   * Takes on a write to one of this store's persisted maps, whoever made it.
   *
   * Two callers: the `storage` event, which is another *window*; and {@link broadcastStorageChange},
   * which is the other store in **this** window. V1 needs neither, because its `IChatHistoryService`
   * and `IChatAgentPreferences` are single shared services that both the Chat app and the embedded
   * `PlanChatView` read straight through. Here each store holds its own in-memory copy of the same
   * localStorage, so a pin, an in-progress answer or a per-agent model chosen in the plan panel has
   * to be handed to the store the Chat page reads — otherwise it silently shows the value from before.
   */
  private adoptStorageChange(key: string | null, newValue: string | null): void {
    if (key === IN_PROGRESS_ANSWERS_STORAGE_KEY) {
      try {
        const next = newValue ? JSON.parse(newValue) : {};
        this.state.inProgressAnswers = next;
        this.notify();
      } catch {
        // Ignore malformed external writes
      }
    } else if (key === DRAFT_OWNERS_STORAGE_KEY) {
      try {
        this.draftOwners = newValue ? JSON.parse(newValue) : {};
      } catch {
        // Ignore malformed external writes
      }
    } else if (key === COMPOSER_DRAFTS_STORAGE_KEY) {
      try {
        this.composerDrafts = newValue ? JSON.parse(newValue) : {};
        // No `notify()`: the draft is not part of `state`, it seeds the composer's own field when
        // that field mounts. Telling a composer the user is typing in to adopt another window's
        // text mid-keystroke would overwrite what they are writing.
      } catch {
        // Ignore malformed external writes
      }
    } else if (key === AGENT_PREFERENCES_STORAGE_KEY) {
      try {
        this.agentPreferences = newValue ? JSON.parse(newValue) : {};
        // The picker reads the selected agent's model and effort off `state`, so adopting the map is
        // only half of it: the selection has to be re-resolved against it.
        this.applyAgentPreference(this.state.selectedAgentId);
        this.notify();
      } catch {
        // Ignore malformed external writes
      }
    } else if (key === PINNED_SESSIONS_STORAGE_KEY) {
      try {
        this.pinnedSessions = newValue ? JSON.parse(newValue) : {};
        this.state.sessions = this.sortSessions(this.enrichSessionsWithPins(this.state.sessions));
        if (this.state.activeSession) {
          const isPinned = Boolean(this.pinnedSessions[this.state.activeSession.id]);
          this.state.activeSession.isPinned = isPinned;
          this.state.activeSession.pinnedAt = isPinned
            ? this.pinnedSessions[this.state.activeSession.id]
            : undefined;
        }
        this.notify();
      } catch {
        // Ignore malformed external writes
      }
    }
  }

  /** Hands a write this store just made to every other live store in this window. */
  private broadcastStorageChange(key: string, value: unknown): void {
    const serialized = JSON.stringify(value);
    for (const other of liveChatStores) {
      if (other !== this) other.adoptStorageChange(key, serialized);
    }
  }

  private attachStorageListener(): void {
    if (!this.storageListenerAttached && typeof window !== "undefined") {
      window.addEventListener("storage", this.handleStorageEvent);
      this.storageListenerAttached = true;
    }
  }

  private detachStorageListener(): void {
    if (this.storageListenerAttached && typeof window !== "undefined") {
      window.removeEventListener("storage", this.handleStorageEvent);
      this.storageListenerAttached = false;
    }
  }

  public getState(): ChatState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    /* The shell's Chat badge, which V1 recomputes from `chatService.GetSessions().Count` on every
       `Build()` (`AppShell/TendrilAppShell.cs:1085`). Pushed from here rather than pulled by the
       shell because `App.tsx` must not import this module - see `chatSessionCount.ts`. Doing it on
       every notify is the closest thing to V1's every-build: a create, a delete, a prune and a
       reload all pass through here, and the publish is a no-op when the number has not moved.

       Two stores stay out of it. A plan-scoped one filters the list to a single conversation, so its
       count is not the number of chats the user has. And an app-wide one that has not loaded yet has
       an empty `sessions` meaning "not known", not "none" - publishing that would blank a badge the
       shell's own startup fetch had correctly filled. */
    if (!this.planScope && this.sessionsLoaded) {
      publishChatSessionCount(this.state.sessions.length);
    }
    this.listeners.forEach((l) => l());
  }

  /**
   * Loads drafts, the agent catalog, the event subscription and the session list, at most once.
   *
   * The in-flight promise is stored **synchronously**, because the `eventUnsubscribe` guard inside
   * `runInit` is only reached after two awaits: two overlapping calls (React StrictMode invokes
   * `ChatView`'s mount effect twice) both got past it while the first was still awaiting, and the
   * store ended up with two `chat-event` listeners. `chat.stream_delta` is the one handler that is
   * not idempotent — it *appends* to the message it names — so every streamed chunk, and the
   * synthesized report a failed turn ends with, was written into the message twice.
   *
   * A failed init clears the memo so the next caller can retry.
   */
  public init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.runInit().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async runInit(): Promise<void> {
    const generation = this.generation;
    this.state.inProgressAnswers = loadStoredInProgressAnswers();
    this.draftOwners = loadStoredDraftOwners();
    this.pinnedSessions = loadStoredPinnedSessions();
    this.attachStorageListener();
    liveChatStores.add(this);
    await this.loadAgents();
    if (!this.eventUnsubscribe) {
      try {
        const unsubscribe = await onChatEvent((event) => {
          this.handleChatEvent(event);
        });
        if (generation !== this.generation) {
          // Destroyed while the subscription was being set up, so it belongs to nobody: drop it
          // here rather than leave a listener the `destroy()` already went past.
          unsubscribe();
          return;
        }
        this.eventUnsubscribe = unsubscribe;
      } catch {
        // May fail in mock/testing environments without Tauri runtime
      }
    }
    if (generation !== this.generation) return;
    await this.fetchSessions();
  }

  /**
   * Fetches the agent catalog and restores the last-used agent along with the model and effort
   * that agent is remembered with. A failure leaves the catalog empty and the selection on the
   * `claude` / `default` floor, which is what the backend would have used anyway.
   */
  public async loadAgents(): Promise<AgentOption[]> {
    try {
      const agents = await agentsApi.listAgents();
      this.state.agents = agents;
      const remembered = loadStoredSelectedAgent();
      const restored =
        agents.find((a) => a.id === remembered) ??
        agents.find((a) => a.id === this.state.selectedAgentId) ??
        agents[0];
      if (restored) {
        this.state.selectedAgentId = restored.id;
      }
      this.applyAgentPreference(this.state.selectedAgentId);
      this.notify();
      return agents;
    } catch {
      this.state.agents = [];
      this.notify();
      return [];
    }
  }

  private agentById(agentId: string): AgentOption | undefined {
    return this.state.agents.find((a) => a.id === agentId);
  }

  /**
   * The model an agent runs with: the first remembered candidate the agent still offers, then the
   * one its catalog marks as the default, then the head of the list. Port of
   * `ChatApp.ResolveModel` - a remembered id that the catalog no longer carries is dropped rather
   * than passed through to `--model`.
   */
  public resolveModel(agentId: string, ...preferred: (string | undefined)[]): string {
    const models = this.agentById(agentId)?.models ?? [];
    // With no catalog there is nothing to validate against, so a remembered choice is kept.
    if (models.length === 0) {
      return preferred.find((candidate) => Boolean(candidate)) ?? DEFAULT_OPTION_ID;
    }
    for (const candidate of preferred) {
      if (!candidate) continue;
      const match = models.find((m) => m.id.toLowerCase() === candidate.toLowerCase());
      if (match) return match.id;
    }
    const fallback = models.find(
      (m) =>
        m.id.toLowerCase() === DEFAULT_OPTION_ID ||
        /\(default\)/i.test(m.displayName) ||
        /\sdefault$/i.test(m.displayName),
    );
    return fallback?.id ?? models[0].id;
  }

  /**
   * The effort an agent runs with. Port of `ChatApp.ResolveEffort`: anything the agent does not
   * offer falls back to `default` rather than being sent on.
   */
  public resolveEffort(agentId: string, ...preferred: (string | undefined)[]): string {
    const efforts = this.agentById(agentId)?.efforts ?? [];
    if (efforts.length === 0) {
      return preferred.find((candidate) => Boolean(candidate)) ?? DEFAULT_OPTION_ID;
    }
    for (const candidate of preferred) {
      if (!candidate) continue;
      const match = efforts.find((e) => e.id.toLowerCase() === candidate.toLowerCase());
      if (match) return match.id;
    }
    return DEFAULT_OPTION_ID;
  }

  private applyAgentPreference(agentId: string): void {
    const preference = this.agentPreferences[agentId];
    this.state.selectedModelId = this.resolveModel(agentId, preference?.modelId);
    this.state.selectedEffort = this.resolveEffort(agentId, preference?.effort);
  }

  /**
   * A session remembers the agent, model and effort it ran with, and opening it restores them, so
   * a follow-up turn in an old chat does not silently run on whatever the composer was last set to.
   * Port of the three `Set` calls in `ChatApp.SelectSession`. Two deliberate additions: a session
   * whose agent differs also picks up that agent's remembered model and effort first, and the
   * session's own ids are validated against the catalog, both so the picker cannot end up showing
   * one agent wearing another's model.
   */
  private adoptSessionSelection(session: ChatSession): void {
    if (session.agentId && session.agentId !== this.state.selectedAgentId) {
      this.state.selectedAgentId = session.agentId;
      this.applyAgentPreference(session.agentId);
    }
    const agentId = this.state.selectedAgentId;
    if (session.modelId) {
      this.state.selectedModelId = this.resolveModel(agentId, session.modelId);
    }
    if (session.effort) {
      this.state.selectedEffort = this.resolveEffort(agentId, session.effort);
    }
  }

  /**
   * Records that a session started or stopped generating, mirroring
   * `ChatHistoryService.SetSessionGenerating`: leaving the generating set marks the session
   * completed, so a chat that finished while the user was reading another one can say so.
   */
  private setSessionGenerating(sessionId: string, isGenerating: boolean): void {
    if (!sessionId) return;
    if (isGenerating) {
      this.completedSessionIds.delete(sessionId);
      // Deliberately leaves `cancellingSessionIds` alone. Deltas keep arriving from a turn that is
      // still noticing its cancellation token, and each one lands here; a turn that is *continuing*
      // is not a turn that stopped, so only the branch below - the turn actually ending - retires
      // the pending stop.
      this.generatingSessionIds.add(sessionId);
    } else {
      this.generatingSessionIds.delete(sessionId);
      this.completedSessionIds.add(sessionId);
      // The run this stop was asked about is over, whether the cancel ended it, the agent finished
      // first, or the daemon said so. Either way there is nothing left to be pending about.
      this.cancellingSessionIds.delete(sessionId);
      const waiters = this.turnEndWaiters.get(sessionId);
      if (waiters) {
        this.turnEndWaiters.delete(sessionId);
        for (const resolve of waiters) resolve();
      }
    }
    this.syncGenerating();
  }

  /**
   * `state.isGenerating` only ever describes the active session, as `ChatApp.Build` does, and
   * `state.isCancelling` follows it: both are questions about the conversation on screen.
   */
  private syncGenerating(): void {
    this.state.isGenerating = this.state.activeSessionId
      ? this.generatingSessionIds.has(this.state.activeSessionId)
      : false;
    this.state.isCancelling = this.state.activeSessionId
      ? this.cancellingSessionIds.has(this.state.activeSessionId)
      : false;
  }

  // ---------------------------------------------------------------------------------------------
  // Composer drafts
  //
  // The prompt a user has typed but not sent, kept per session so leaving the Chat page and coming
  // back finds it again. See {@link COMPOSER_DRAFTS_STORAGE_KEY} for why V1 needs none of this.
  // ---------------------------------------------------------------------------------------------

  /** The unsent prompt belonging to a session, or "" for a session that has none. */
  public composerDraft(sessionId: string | null | undefined): string {
    if (!sessionId) return "";
    return this.composerDrafts[sessionId] ?? "";
  }

  /**
   * Records what the composer currently holds for one session, or forgets it when empty.
   *
   * Empty is a delete rather than an empty string so the map stays the size of the drafts that
   * exist, not of every chat ever opened.
   */
  public setComposerDraft(sessionId: string | null | undefined, text: string): void {
    if (!sessionId) return;
    const existing = this.composerDrafts[sessionId] ?? "";
    if (existing === text) return;
    const next = { ...this.composerDrafts };
    if (text) {
      next[sessionId] = text;
    } else {
      delete next[sessionId];
    }
    this.persistComposerDrafts(next);
  }

  /** Drops one session's draft, used when its prompt was sent, queued, or the session went away. */
  public clearComposerDraft(sessionId: string | null | undefined): void {
    this.setComposerDraft(sessionId, "");
  }

  private persistComposerDrafts(drafts: Record<string, string>): void {
    this.composerDrafts = drafts;
    saveStoredComposerDrafts(drafts);
    this.broadcastStorageChange(COMPOSER_DRAFTS_STORAGE_KEY, drafts);
  }

  /**
   * Forgets the drafts of sessions that no longer exist, so a map that is only ever added to cannot
   * grow without bound. Mirrors {@link sweepDraftsForMissingSessions}, including its exemption for
   * the session on screen, which may have been created locally and not yet be in a fetched list.
   */
  private sweepComposerDraftsForMissingSessions(sessions: ChatSession[]): void {
    const liveIds = new Set(sessions.map((s) => s.id));
    const drafts = { ...this.composerDrafts };
    let changed = false;
    for (const sessionId of Object.keys(drafts)) {
      if (liveIds.has(sessionId)) continue;
      if (sessionId === this.state.activeSessionId) continue;
      delete drafts[sessionId];
      changed = true;
    }
    if (changed) this.persistComposerDrafts(drafts);
  }

  public isSessionGenerating(sessionId: string): boolean {
    return this.generatingSessionIds.has(sessionId);
  }

  /** Port of `ChatApp.BuildRowState`: the state a Chats row wears in the list. */
  public sessionRowState(sessionId: string): ChatSessionRowState {
    if (this.generatingSessionIds.has(sessionId)) return "working";
    if (this.completedSessionIds.has(sessionId) && sessionId !== this.state.activeSessionId) {
      return "completed";
    }
    return null;
  }

  /** Port of `ChatHistoryService.ClearSessionCompleted`, called when a session is opened. */
  public clearSessionCompleted(sessionId: string): void {
    this.completedSessionIds.delete(sessionId);
  }

  /**
   * Waits for a session's turn to end, so a force-send interrupts before it sends. The daemon
   * refuses a second turn while one is running, so this is the client-side equivalent of
   * `InterruptAsync` awaiting the execution task, with the same five-second ceiling.
   */
  private waitForTurnToEnd(sessionId: string): Promise<void> {
    if (!this.generatingSessionIds.has(sessionId)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const waiters = this.turnEndWaiters.get(sessionId) ?? [];
      waiters.push(finish);
      this.turnEndWaiters.set(sessionId, waiters);
      setTimeout(finish, TURN_INTERRUPT_TIMEOUT_MS);
    });
  }

  /**
   * Selects an agent and restores *its* model and effort — switching away and back never leaves
   * an agent wearing another one's model.
   */
  public setAgent(agentId: string): void {
    this.state.selectedAgentId = agentId;
    saveStoredSelectedAgent(agentId);
    this.applyAgentPreference(agentId);
    this.notify();
  }

  /** Remembers a model for an agent, selected or not, and applies it if that agent is current. */
  public setModelForAgent(agentId: string, modelId: string): void {
    this.agentPreferences = {
      ...this.agentPreferences,
      [agentId]: { ...this.agentPreferences[agentId], modelId },
    };
    saveStoredAgentPreferences(this.agentPreferences);
    this.broadcastStorageChange(AGENT_PREFERENCES_STORAGE_KEY, this.agentPreferences);
    if (agentId === this.state.selectedAgentId) {
      this.state.selectedModelId = modelId;
    }
    this.notify();
  }

  /** Remembers an effort for an agent, selected or not, and applies it if that agent is current. */
  public setEffortForAgent(agentId: string, effort: string): void {
    this.agentPreferences = {
      ...this.agentPreferences,
      [agentId]: { ...this.agentPreferences[agentId], effort },
    };
    saveStoredAgentPreferences(this.agentPreferences);
    this.broadcastStorageChange(AGENT_PREFERENCES_STORAGE_KEY, this.agentPreferences);
    if (agentId === this.state.selectedAgentId) {
      this.state.selectedEffort = effort;
    }
    this.notify();
  }

  /** The model and effort an agent is remembered with, for the picker's per-agent rows. */
  public getAgentPreference(agentId: string): AgentPreference {
    return this.agentPreferences[agentId] ?? {};
  }

  /**
   * The selection an outbound turn carries. `default` is dropped rather than sent, because
   * `AgentLaunchConfig.model` is passed straight through to `--model`.
   */
  private turnOptions(): { agentId?: string; modelId?: string; effort?: string } {
    const onWire = (value: string): string | undefined =>
      value && value !== DEFAULT_OPTION_ID ? value : undefined;
    return {
      agentId: onWire(this.state.selectedAgentId),
      modelId: onWire(this.state.selectedModelId),
      effort: onWire(this.state.selectedEffort),
    };
  }

  /**
   * Releases everything this instance holds outside itself: the `storage` listener, the `chat-event`
   * subscription, and its place in the live set.
   *
   * The plan panel's store is destroyed when the panel unmounts, which is what keeps a visit to a
   * plan page from leaving another `chat-event` listener behind. The `init()` memo goes with it, so a
   * remount subscribes again rather than believing it already had.
   */
  public destroy(): void {
    this.generation += 1;
    this.detachStorageListener();
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
    }
    // The `init()` memo goes with the subscription it was standing for, so a remount subscribes
    // again instead of believing it already had. Safe now that `generation` stops the previous
    // `runInit` from also finishing: exactly one listener survives, however the two interleave.
    this.initPromise = null;
    this.listeners.clear();
    liveChatStores.delete(this);
  }

  public resetForTesting(): void {
    this.state = {
      sessions: [],
      activeSessionId: null,
      activeSession: null,
      agents: [],
      selectedAgentId: FALLBACK_AGENT_ID,
      selectedModelId: DEFAULT_OPTION_ID,
      selectedEffort: DEFAULT_OPTION_ID,
      queuedItems: [],
      isGenerating: false,
      isCancelling: false,
      isLoading: false,
      error: null,
      inProgressAnswers: {},
      submittingAnswers: {},
    };
    saveStoredInProgressAnswers({});
    this.draftOwners = {};
    saveStoredDraftOwners({});
    this.composerDrafts = {};
    saveStoredComposerDrafts({});
    this.questionDrafts = new Map();
    this.questionDraftStores = new Map();
    this.pinnedSessions = {};
    saveStoredPinnedSessions({});
    this.agentPreferences = {};
    saveStoredAgentPreferences({});
    saveStoredSelectedAgent(null);
    this.sessionsLoaded = false;
    this.generatingSessionIds = new Set();
    this.completedSessionIds = new Set();
    this.cancellingSessionIds = new Set();
    this.turnEndWaiters = new Map();
    this.optimisticMessageIds = new Set();
    // Drop the event subscription and the `init()` memo together: a test that reset the store and
    // called `init()` again would otherwise keep the previous test's listener and skip the reload.
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = null;
    this.initPromise = null;
    try {
      const legacyStorage =
        typeof sessionStorage !== "undefined"
          ? sessionStorage
          : typeof window !== "undefined"
            ? window.sessionStorage
            : null;
      legacyStorage?.removeItem(IN_PROGRESS_ANSWERS_STORAGE_KEY);
    } catch {
      // Ignore
    }
    this.notify();
  }

  private enrichSessionsWithPins(sessions: ChatSession[]): ChatSession[] {
    return sessions.map((s) => {
      const pinnedAt = this.pinnedSessions[s.id];
      return {
        ...s,
        isPinned: Boolean(pinnedAt),
        pinnedAt: pinnedAt ?? undefined,
      };
    });
  }

  private sortSessions(sessions: ChatSession[]): ChatSession[] {
    return [...sessions].sort((a, b) => {
      const aPinned = Boolean(a.isPinned);
      const bPinned = Boolean(b.isPinned);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      if (aPinned && bPinned) {
        const aTime = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
        const bTime = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
        return bTime - aTime;
      }
      const aTime = new Date(a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt).getTime();
      return bTime - aTime;
    });
  }

  public togglePinSession(sessionId: string): void {
    const isCurrentlyPinned = Boolean(this.pinnedSessions[sessionId]);
    if (isCurrentlyPinned) {
      delete this.pinnedSessions[sessionId];
    } else {
      this.pinnedSessions[sessionId] = new Date().toISOString();
    }
    saveStoredPinnedSessions(this.pinnedSessions);
    this.broadcastStorageChange(PINNED_SESSIONS_STORAGE_KEY, this.pinnedSessions);

    if (this.state.activeSession && this.state.activeSession.id === sessionId) {
      this.state.activeSession.isPinned = !isCurrentlyPinned;
      this.state.activeSession.pinnedAt = !isCurrentlyPinned
        ? this.pinnedSessions[sessionId]
        : undefined;
    }

    this.state.sessions = this.sortSessions(this.enrichSessionsWithPins(this.state.sessions));
    this.notify();
  }

  public async pruneEmptySessions(keepSessionId?: string | null): Promise<void> {
    const toDelete = this.state.sessions.filter((s) => {
      if (keepSessionId && s.id === keepSessionId) return false;
      // A generating session is never pruned, whether or not it is the one on screen, which is
      // what `ChatHistoryService.PruneEmptySessions` checks.
      if (this.generatingSessionIds.has(s.id)) return false;
      // Nor is one holding a prompt the user wrote and has not sent. This has no V1 counterpart
      // because V1 has no persisted drafts to protect, but pruning runs on the way out of the Chat
      // page - so without this, typing into a fresh chat and navigating away would delete the very
      // session the draft was being kept for, which is the bug this is all here to fix.
      if (this.composerDrafts[s.id]) return false;
      return !s.messages || s.messages.length === 0;
    });

    if (toDelete.length === 0) return;

    const toDeleteIds = new Set(toDelete.map((s) => s.id));
    this.state.sessions = this.state.sessions.filter((s) => !toDeleteIds.has(s.id));
    if (this.state.activeSessionId && toDeleteIds.has(this.state.activeSessionId)) {
      this.state.activeSessionId = null;
      this.state.activeSession = null;
      this.state.queuedItems = [];
      this.syncGenerating();
    }

    let pinnedChanged = false;
    for (const s of toDelete) {
      if (this.pinnedSessions[s.id]) {
        delete this.pinnedSessions[s.id];
        pinnedChanged = true;
      }
    }
    if (pinnedChanged) {
      saveStoredPinnedSessions(this.pinnedSessions);
    }

    this.notify();

    await Promise.allSettled(toDelete.map((s) => chatApi.deleteSession(s.id).catch(() => {})));
  }

  public handleChatEvent(event: ChatEvent): void {
    switch (event.type) {
      case "chat.stream_delta": {
        // A delta proves its own session is working, whichever one is on screen.
        this.setSessionGenerating(event.sessionId, true);
        if (!this.state.activeSession || this.state.activeSession.id !== event.sessionId) {
          this.notify();
          return;
        }
        const messages = this.state.activeSession.messages;
        const targetIndex = messages.findIndex((m) => m.id === event.messageId);

        if (targetIndex >= 0) {
          const targetMsg = messages[targetIndex];
          // Replace with a new object (rather than mutating targetMsg.content in place) so
          // ChatMessageRow's React.memo sees a changed `message` prop reference and re-renders
          // the streaming row; other rows keep their untouched message references and skip re-render.
          messages[targetIndex] = { ...targetMsg, content: targetMsg.content + event.delta };
        } else {
          // If message does not exist yet, create a streaming assistant message
          messages.push({
            id: event.messageId,
            role: "assistant",
            content: event.delta,
            timestamp: new Date().toISOString(),
          });
        }
        this.notify();
        break;
      }

      case "chat.stream_event": {
        // Same reasoning as the delta above: a stream event proves the session is working.
        this.setSessionGenerating(event.sessionId, true);
        if (!this.state.activeSession || this.state.activeSession.id !== event.sessionId) {
          this.notify();
          return;
        }
        const messages = this.state.activeSession.messages;
        const targetIndex = messages.findIndex((m) => m.id === event.messageId);
        // The stream is newline-delimited JSON, which is exactly what `TurnActivity` hands to
        // `parseEventWireStream`, so appending one line per event makes the tool cards appear as the
        // turn runs. A duplicate line would only re-render the same tool card, since events are keyed
        // by `tool_use_id`.
        if (targetIndex >= 0) {
          const targetMsg = messages[targetIndex];
          const rawStream = targetMsg.rawStream
            ? `${targetMsg.rawStream}\n${event.line}`
            : event.line;
          messages[targetIndex] = { ...targetMsg, rawStream };
        } else {
          messages.push({
            id: event.messageId,
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString(),
            rawStream: event.line,
          });
        }
        this.notify();
        break;
      }

      case "chat.message_added": {
        if (!this.state.activeSession || this.state.activeSession.id !== event.sessionId) {
          return;
        }
        const messages = this.state.activeSession.messages;
        const index = messages.findIndex((m) => m.id === event.message.id);
        if (index >= 0) {
          // An upsert, which is what makes the daemon's copy of a finished turn safe to apply more
          // than once. Fields the frame leaves off are kept: the raw stream is omitted from the
          // finalize frame (it is a whole run's worth of JSON) and attachments only exist locally.
          const existing = messages[index];
          messages[index] = {
            ...event.message,
            rawStream: event.message.rawStream ?? existing.rawStream,
            attachments: event.message.attachments ?? existing.attachments,
          };
        } else {
          // The daemon's copy of a message this client already showed replaces it rather than
          // doubling it up. Prefix match, not equality: the prompt that reaches the agent carries
          // the `[Attached Files]:` block the composer did not show.
          const optimisticIndex =
            event.message.role === "user"
              ? messages.findIndex(
                  (m) =>
                    m.role === "user" &&
                    this.optimisticMessageIds.has(m.id) &&
                    event.message.content.startsWith(m.content),
                )
              : -1;
          if (optimisticIndex >= 0) {
            const optimistic = messages[optimisticIndex];
            this.optimisticMessageIds.delete(optimistic.id);
            // The daemon does not persist attachments on a message, so the chips only survive
            // because the local copy carried them.
            messages[optimisticIndex] = {
              ...event.message,
              attachments: event.message.attachments ?? optimistic.attachments,
            };
          } else {
            messages.push(event.message);
          }
        }
        this.state.activeSession.updatedAt = event.message.timestamp || new Date().toISOString();
        this.notify();
        break;
      }

      case "chat.generating_state": {
        const wasGenerating = this.generatingSessionIds.has(event.sessionId);
        this.setSessionGenerating(event.sessionId, event.isGenerating);
        // A finished turn is re-read from the daemon rather than assumed, the way `ChatApp`'s
        // `OnSessionGeneratingChanged` bumps its version and re-reads the session: the final
        // content, the reconciled tool results and any answers applied mid-flight only exist
        // there. The stream we already received is never truncated by the re-read.
        if (
          wasGenerating &&
          !event.isGenerating &&
          this.state.activeSessionId === event.sessionId
        ) {
          void this.refreshActiveSession({ preserveLocalLonger: true }).catch(() => {});
        }
        this.notify();
        break;
      }

      case "chat.question_answered": {
        if (this.state.activeSessionId === event.sessionId && this.state.activeSession) {
          void (async () => {
            await this.refreshActiveSession().catch(() => {});
            if (this.state.activeSession) {
              const msg = this.state.activeSession.messages.find((m) => m.id === event.messageId);
              if (msg) {
                const confirmedQuestions = extractPlanQuestions(msg.content);
                if (event.answers) {
                  for (const qId of Object.keys(event.answers)) {
                    const q = confirmedQuestions.find((item) => item.id === qId);
                    if (q?.answerPresent) {
                      this.clearInProgressAnswers(event.messageId, qId);
                    }
                  }
                } else {
                  for (const q of confirmedQuestions) {
                    if (q.answerPresent) {
                      this.clearInProgressAnswers(event.messageId, q.id);
                    }
                  }
                }
              }
            }
          })();
        }
        break;
      }

      case "chat.job_spawned": {
        // Recorded on whichever copies of the session are loaded, not only the active one: a turn keeps
        // running after the user navigates away, and a job announced in that window used to be dropped
        // here — so switching back showed a conversation with no jobs in its header.
        //
        // The list is *replaced* rather than pushed to. `ChatView` derives the header's jobs in a
        // `useMemo` keyed on `activeSession.spawnedJobIds`, so a push left the key referentially equal
        // and the memo kept its previous value: the re-render happened and the pill still did not
        // appear. A new array is what makes the change visible.
        let changed = false;
        const record = (session: ChatSession | null | undefined) => {
          if (!session || session.id !== event.sessionId) return false;
          if (session.spawnedJobIds.includes(event.jobId)) return false;
          session.spawnedJobIds = [...session.spawnedJobIds, event.jobId];
          changed = true;
          return true;
        };
        record(this.state.activeSession);
        this.state.sessions.forEach(record);
        if (changed) this.notify();
        break;
      }

      case "chat.session_renamed": {
        const sessionInList = this.state.sessions.find((s) => s.id === event.sessionId);
        if (sessionInList) {
          sessionInList.title = event.title;
        }
        if (this.state.activeSession && this.state.activeSession.id === event.sessionId) {
          this.state.activeSession.title = event.title;
        }
        if (
          sessionInList ||
          (this.state.activeSession && this.state.activeSession.id === event.sessionId)
        ) {
          this.notify();
        }
        break;
      }
    }
  }

  private persistDrafts(drafts: Record<string, InProgressQuestionAnswers>): void {
    // Drop owner entries whose draft is gone, keeping the index bounded by the draft map.
    const owners: Record<string, string> = {};
    for (const [messageId, sessionId] of Object.entries(this.draftOwners)) {
      if (drafts[messageId]) owners[messageId] = sessionId;
    }
    this.state.inProgressAnswers = drafts;
    this.draftOwners = owners;
    saveStoredInProgressAnswers(drafts);
    saveStoredDraftOwners(owners);
    this.broadcastStorageChange(DRAFT_OWNERS_STORAGE_KEY, owners);
    this.broadcastStorageChange(IN_PROGRESS_ANSWERS_STORAGE_KEY, drafts);
  }

  private backfillDraftOwners(sessions: ChatSession[]): void {
    const unownedIds = Object.keys(this.state.inProgressAnswers).filter(
      (messageId) => !this.draftOwners[messageId],
    );
    if (unownedIds.length === 0) return;

    const messageToSession = new Map<string, string>();
    for (const session of sessions) {
      for (const message of session.messages) {
        messageToSession.set(message.id, session.id);
      }
    }

    let backfilled = false;
    const nextOwners = { ...this.draftOwners };
    for (const messageId of unownedIds) {
      const sessionId = messageToSession.get(messageId);
      if (sessionId) {
        nextOwners[messageId] = sessionId;
        backfilled = true;
      }
    }
    if (!backfilled) return;

    this.draftOwners = nextOwners;
    this.persistDrafts(this.state.inProgressAnswers);
  }

  private sweepDraftsForMissingSessions(sessions: ChatSession[]): void {
    const liveIds = new Set(sessions.map((s) => s.id));
    const drafts = { ...this.state.inProgressAnswers };
    let changed = false;

    for (const [messageId, sessionId] of Object.entries(this.draftOwners)) {
      // Unowned drafts (pre-migration, or written with no active session) are never swept.
      if (liveIds.has(sessionId)) continue;
      // Never sweep the session the user is looking at, so a session created locally and not yet
      // present in a concurrently-fetched list keeps its drafts.
      if (sessionId === this.state.activeSessionId) continue;
      if (drafts[messageId]) {
        delete drafts[messageId];
        changed = true;
      }
    }

    if (changed) this.persistDrafts(drafts);
  }

  public async fetchSessions(): Promise<ChatSession[]> {
    this.state.isLoading = true;
    this.state.error = null;
    this.notify();

    try {
      const sessions = await chatApi.listSessions();
      // A plan-scoped store sees only the plan's own conversation, which is `PlanChatView`'s
      // `sessionDtos`: `[ToSessionDto(session)]` when `FindForPlan` found one and an empty list when
      // it did not. Narrowing here rather than at every reader is what keeps the rest of the store
      // honest — "select the first session" then resolves to the plan's, or to nothing at all, and a
      // delete cannot fall back onto an unrelated chat.
      const scope = this.planScope;
      const scoped = scope
        ? sessions.filter((session) => sessionBelongsToPlan(session, scope))
        : sessions;
      const enriched = this.enrichSessionsWithPins(scoped);
      const sorted = this.sortSessions(enriched);
      this.state.sessions = sorted;
      this.sessionsLoaded = true;
      this.state.isLoading = false;
      this.backfillDraftOwners(sorted);
      this.sweepDraftsForMissingSessions(sorted);
      this.sweepComposerDraftsForMissingSessions(sorted);

      // Select first session if none active
      if (!this.state.activeSessionId && sorted.length > 0) {
        await this.selectSession(sorted[0].id);
      } else if (this.state.activeSessionId) {
        // Re-verify current active session still exists
        const exists = sorted.some((s) => s.id === this.state.activeSessionId);
        if (!exists && sorted.length > 0) {
          await this.selectSession(sorted[0].id);
        } else if (!exists) {
          this.state.activeSessionId = null;
          this.state.activeSession = null;
          this.state.queuedItems = [];
        }
      }

      this.notify();
      return sorted;
    } catch (err) {
      this.state.isLoading = false;
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      return [];
    }
  }

  /**
   * Reads one session without making it the active one.
   *
   * A terminal pane needs its conversation's title for its header but is not the chat view and must
   * not take over `activeSession` — `selectSession` would move the chat view's selection and prune the
   * session it left.
   */
  public async fetchSession(id: string): Promise<ChatSession> {
    return await chatApi.getSession(id);
  }

  public async selectSession(id: string): Promise<void> {
    const prevId = this.state.activeSessionId;
    const prevSession = this.state.activeSession;
    if (
      prevId &&
      prevId !== id &&
      prevSession &&
      prevSession.id === prevId &&
      (!prevSession.messages || prevSession.messages.length === 0) &&
      !this.generatingSessionIds.has(prevId)
    ) {
      await this.pruneEmptySessions(id);
    }

    this.state.activeSessionId = id;
    this.state.error = null;
    // Opening a chat acknowledges that it finished, and the composer's state follows the session
    // that is now on screen rather than the one that was. Both are `ChatApp.SelectSession`.
    this.clearSessionCompleted(id);
    this.syncGenerating();
    this.notify();

    try {
      const [session, queue] = await Promise.all([
        chatApi.getSession(id),
        chatApi.getQueue(id).catch(() => []),
      ]);
      // The user can switch chats while this fetch is in flight. Landing a stale session here would
      // leave `activeSession.id` disagreeing with `activeSessionId`, and every guard in
      // `handleChatEvent` compares against `activeSession.id` - so the losing session's stream would
      // then be appended to the pane showing the winning one. Same check as `submitAnswers`.
      if (this.state.activeSessionId !== id) return;

      const isPinned = Boolean(this.pinnedSessions[id]);
      session.isPinned = isPinned;
      session.pinnedAt = isPinned ? this.pinnedSessions[id] : undefined;

      this.state.activeSession = session;
      this.state.queuedItems = queue;
      this.backfillDraftOwners([session]);
      this.adoptSessionSelection(session);

      // Also update in sessions list
      const idx = this.state.sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        this.state.sessions[idx] = session;
        this.state.sessions = this.sortSessions(this.state.sessions);
      }

      this.notify();
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
    }
  }

  /**
   * Re-reads the active session from the daemon. `preserveLocalLonger` keeps a locally streamed
   * message that is longer than the daemon's copy, which is what makes this safe to call the
   * moment a turn ends as well as while one runs.
   */
  public async refreshActiveSession(options?: { preserveLocalLonger?: boolean }): Promise<void> {
    const targetId = this.state.activeSessionId;
    if (!targetId) return;
    const preserveLocalLonger = options?.preserveLocalLonger ?? this.state.isGenerating;
    try {
      const [session, queue] = await Promise.all([
        chatApi.getSession(targetId),
        chatApi.getQueue(targetId).catch(() => []),
      ]);
      // Fired automatically when a turn ends (`chat.generating_state`), so this routinely races a
      // chat switch rather than only on a double-click. Without the re-check the merge below splices
      // the local messages of whichever session is on screen now into the server messages of the one
      // that was. Reading `activeSessionId` once, above, also keeps the two fetches on one session.
      if (this.state.activeSessionId !== targetId) return;

      const isPinned = Boolean(this.pinnedSessions[session.id]);
      session.isPinned = isPinned;
      session.pinnedAt = isPinned ? this.pinnedSessions[session.id] : undefined;

      const localMessages = this.state.activeSession?.messages ?? [];
      const mergedMessages = session.messages.map((serverMsg) => {
        const localMsg = localMessages.find((m) => m.id === serverMsg.id);
        // The daemon persists a turn's stream on a timer, so mid-turn its copy lags the events this
        // client already received. Keeping the longer one applies to the stream for the same reason it
        // applies to the content: otherwise a refresh mid-turn drops tool cards that are on screen.
        const rawStream =
          preserveLocalLonger &&
          (localMsg?.rawStream?.length ?? 0) > (serverMsg.rawStream?.length ?? 0)
            ? localMsg?.rawStream
            : serverMsg.rawStream;
        if (preserveLocalLonger && localMsg && localMsg.content.length > serverMsg.content.length) {
          return {
            ...localMsg,
            content: mergeConfirmedQuestionsBlock(localMsg.content, serverMsg.content),
            rawStream,
          };
        }
        // Attachments live only on this client, so a re-read must not drop the chips.
        return {
          ...serverMsg,
          rawStream,
          attachments: serverMsg.attachments ?? localMsg?.attachments,
        };
      });
      this.state.activeSession = { ...session, messages: mergedMessages };
      this.state.queuedItems = queue;
      this.backfillDraftOwners([session]);

      // Also update in sessions list
      const idx = this.state.sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        this.state.sessions[idx] = this.state.activeSession ?? session;
        this.state.sessions = this.sortSessions(this.state.sessions);
      }

      this.notify();
    } catch {
      // Ignore refresh error
    }
  }

  public async createSession(
    title?: string,
    args?: { agentId?: string; modelId?: string; effort?: string },
  ): Promise<ChatSession> {
    try {
      const prevSession = this.state.activeSession;
      if (
        prevSession &&
        (!prevSession.messages || prevSession.messages.length === 0) &&
        !this.generatingSessionIds.has(prevSession.id)
      ) {
        await this.pruneEmptySessions();
      }

      // A session records its agent/model/effort, so the very first turn runs with the current
      // selection rather than the backend's defaults.
      const newSession = await chatApi.createSession({
        // `PlanChatSessions.CreateForPlan`: `title: $"#{plan.Id} {plan.Title}"`, so the plan's chat
        // is recognisable in the Chat app's own list rather than sitting there as another "New Chat".
        title: title ?? this.planScope?.sessionTitle,
        ...(args ?? this.turnOptions()),
        // `planFolderName: plan.FolderName` — the durable record of which plan owns the conversation,
        // and the only thing that lets the panel find it again on the next visit.
        ...(this.planScope?.folderName ? { planFolderName: this.planScope.folderName } : {}),
      });
      newSession.isPinned = false;
      newSession.pinnedAt = undefined;
      this.state.sessions = this.sortSessions([newSession, ...this.state.sessions]);
      this.state.activeSessionId = newSession.id;
      this.state.activeSession = newSession;
      this.state.queuedItems = [];
      this.syncGenerating();
      this.notify();
      return newSession;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  public async renameSession(id: string, title: string): Promise<ChatSession> {
    // Optimistic update
    const sessionInList = this.state.sessions.find((s) => s.id === id);
    if (sessionInList) {
      sessionInList.title = title;
    }
    if (this.state.activeSession && this.state.activeSession.id === id) {
      this.state.activeSession.title = title;
    }
    this.notify();

    try {
      const updated = await chatApi.updateSession(id, title);
      const isPinned = Boolean(this.pinnedSessions[id]);
      updated.isPinned = isPinned;
      updated.pinnedAt = isPinned ? this.pinnedSessions[id] : undefined;

      if (sessionInList) {
        sessionInList.title = updated.title;
        sessionInList.updatedAt = updated.updatedAt;
        sessionInList.isPinned = updated.isPinned;
        sessionInList.pinnedAt = updated.pinnedAt;
      }
      if (this.state.activeSession && this.state.activeSession.id === id) {
        this.state.activeSession.title = updated.title;
        this.state.activeSession.updatedAt = updated.updatedAt;
        this.state.activeSession.isPinned = updated.isPinned;
        this.state.activeSession.pinnedAt = updated.pinnedAt;
      }
      this.state.sessions = this.sortSessions(this.state.sessions);
      this.notify();
      return updated;
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  public async deleteSession(id: string): Promise<void> {
    try {
      let deletedSession: ChatSession | undefined =
        this.state.activeSession?.id === id
          ? this.state.activeSession
          : this.state.sessions.find((s) => s.id === id);

      if (!deletedSession?.messages?.length) {
        try {
          deletedSession = await chatApi.getSession(id);
        } catch {
          // Deletion should proceed even if we can't fetch the session's messages
        }
      }

      await chatApi.deleteSession(id);
      this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
      if (this.pinnedSessions[id]) {
        delete this.pinnedSessions[id];
        saveStoredPinnedSessions(this.pinnedSessions);
      }
      // Deleting a session cancels its turn daemon-side, so it is neither working nor freshly
      // completed any more.
      this.generatingSessionIds.delete(id);
      this.completedSessionIds.delete(id);
      this.cancellingSessionIds.delete(id);
      this.turnEndWaiters.delete(id);
      // A draft belongs to its conversation, so it goes with it.
      this.clearComposerDraft(id);

      if (this.state.activeSessionId === id) {
        if (this.state.sessions.length > 0) {
          await this.selectSession(this.state.sessions[0].id);
        } else {
          this.state.activeSessionId = null;
          this.state.activeSession = null;
          this.state.queuedItems = [];
        }
      }
      this.syncGenerating();

      const messageIds = new Set(deletedSession?.messages?.map((m) => m.id) ?? []);
      const nextInProgress = { ...this.state.inProgressAnswers };
      let changed = false;
      for (const messageId of Object.keys(nextInProgress)) {
        if (messageIds.has(messageId) || this.draftOwners[messageId] === id) {
          delete nextInProgress[messageId];
          changed = true;
        }
      }
      if (changed) {
        this.persistDrafts(nextInProgress);
      }

      this.notify();
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  public async sendMessage(
    prompt: string,
    options?: { enqueue?: boolean; attachments?: ChatAttachment[]; role?: string },
  ): Promise<void> {
    if (!prompt.trim() && (!options?.attachments || options.attachments.length === 0)) return;

    let sessionId = this.state.activeSessionId;
    if (!sessionId) {
      const newSession = await this.createSession();
      sessionId = newSession.id;
    }

    const wasGenerating = this.generatingSessionIds.has(sessionId);
    let optimisticId: string | null = null;

    if (!options?.enqueue) {
      // Optimistic user message
      optimisticId = `msg-${Date.now()}`;
      const userMsg: ChatMessage = {
        id: optimisticId,
        role: "user",
        content: prompt,
        timestamp: new Date().toISOString(),
        attachments: options?.attachments,
      };
      if (this.state.activeSession) {
        this.state.activeSession.messages.push(userMsg);
        this.optimisticMessageIds.add(optimisticId);
      }
      this.setSessionGenerating(sessionId, true);
      this.notify();
    }

    try {
      if (options?.enqueue) {
        // Only `postMessage` persists attachments onto the queued item.
        const res = await chatApi.postMessage(sessionId, prompt, options);
        if (res.queued) {
          const queue = await chatApi.getQueue(sessionId);
          this.state.queuedItems = queue;
          this.notify();
        }
      } else {
        // `postMessage` starts the turn with ChatTurnOptions::default(), so it cannot carry the
        // agent/model/effort selection; the execute route can. The prompt carries the attachment
        // paths, because the execute route has nowhere else to put them.
        await chatApi.executeTurn(sessionId, {
          prompt: buildPromptWithAttachments(prompt, options?.attachments),
          ...this.turnOptions(),
        });
      }
    } catch (err) {
      // The turn was refused, so this session's generating state is whatever it already was - a
      // send that races a running turn must not tell the composer the chat went idle. The row the
      // send optimistically added is dropped, since nothing will ever answer it.
      if (!wasGenerating) {
        this.generatingSessionIds.delete(sessionId);
        this.syncGenerating();
      }
      if (optimisticId && this.state.activeSession) {
        this.state.activeSession.messages = this.state.activeSession.messages.filter(
          (m) => m.id !== optimisticId,
        );
        this.optimisticMessageIds.delete(optimisticId);
      }
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  /**
   * Stops the turn in flight. The queue is cleared first, as `ContentView`'s `OnCancelStream`
   * does: the daemon drains its queue as soon as a turn ends, so a stop that left prompts behind
   * would immediately start the next one instead of stopping.
   *
   * The session is marked cancelling *before* the first await, which is the whole point: V1's
   * `handleCancelStream` is synchronous and its stop button vanishes on the same tick, while here
   * `cancel_session` is a round trip and the agent process then takes its own time to die. Without
   * something published up front the button looked untouched for that entire window, so people
   * pressed it again - the reported "I have to press it 2 times". The flag is cleared by the turn
   * actually ending (see {@link setSessionGenerating}), not by this call returning, because the
   * cancel resolving only means the token was signalled.
   */
  public async cancelGeneration(): Promise<void> {
    const sessionId = this.state.activeSessionId;
    if (!sessionId) return;

    // Published synchronously, before anything is awaited, so the composer has already re-rendered
    // by the time the user could reach for the button again.
    this.cancellingSessionIds.add(sessionId);
    this.syncGenerating();
    this.notify();

    const previousQueue = this.state.queuedItems;
    if (previousQueue.length > 0) {
      this.state.queuedItems = [];
      this.notify();
      try {
        await chatApi.clearQueue(sessionId);
      } catch {
        // A queue that could not be cleared is still queued; show it again rather than lie.
        this.state.queuedItems = previousQueue;
        this.notify();
      }
    }

    try {
      await chatApi.cancelTurn(sessionId);
      this.setSessionGenerating(sessionId, false);
      this.notify();
    } catch (err) {
      // The stop never landed and the turn is still running, so the pending state has to come off:
      // a button stuck in "stopping" over a turn nobody stopped is a dead end, and pressing again
      // is now the right thing for the user to do.
      this.cancellingSessionIds.delete(sessionId);
      this.syncGenerating();
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
    }
  }

  /**
   * Jumps a queued prompt to the front of the line. Port of `ContentView.OnSendQueuedNow` and the
   * `ForceSend` path behind it: the item leaves the queue and starts a turn straight away,
   * interrupting the one in flight (`ChatExecutionService.ForceSendMessageAsync` =
   * `InterruptAsync` then `SendMessageAsync`).
   */
  public async sendQueuedNow(itemId: string): Promise<void> {
    const sessionId = this.state.activeSessionId;
    if (!sessionId) return;
    const item = this.state.queuedItems.find((queued) => queued.id === itemId);
    if (!item) return;

    const previousQueue = this.state.queuedItems;
    this.state.queuedItems = previousQueue.filter((queued) => queued.id !== itemId);
    this.notify();

    try {
      // The item has to leave the daemon's queue before the turn starts, or it would be drained
      // again once that turn finishes.
      await chatApi.deleteQueuedItem(sessionId, itemId);
      if (this.generatingSessionIds.has(sessionId)) {
        await chatApi.cancelTurn(sessionId);
        await this.waitForTurnToEnd(sessionId);
      }
      await this.sendMessage(item.prompt, { attachments: item.attachments });
    } catch (err) {
      // A prompt the user asked to send now must not disappear. Its place in the queue is lost,
      // which is the price of having taken it out before the send could be attempted.
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      try {
        const restored = await chatApi.enqueueItem(sessionId, item.prompt, item.attachments);
        this.state.queuedItems = [...this.state.queuedItems, restored];
      } catch {
        this.state.queuedItems = previousQueue;
      }
      this.notify();
    }
  }

  public setInProgressAnswer(
    messageId: string,
    questionId: string,
    answer: string | string[] | undefined | null,
  ): void {
    const values: string[] =
      answer === undefined || answer === null
        ? []
        : Array.isArray(answer)
          ? answer.map(String)
          : answer === ""
            ? []
            : [String(answer)];

    const currentMsgAnswers = this.state.inProgressAnswers[messageId] || {};
    let updatedMsgAnswers: InProgressQuestionAnswers | undefined;

    if (values.length === 0) {
      if (currentMsgAnswers[questionId]) {
        const next = { ...currentMsgAnswers };
        delete next[questionId];
        if (Object.keys(next).length > 0) {
          updatedMsgAnswers = next;
        }
      } else if (Object.keys(currentMsgAnswers).length > 0) {
        updatedMsgAnswers = currentMsgAnswers;
      }
    } else {
      updatedMsgAnswers = {
        ...currentMsgAnswers,
        [questionId]: values,
      };
    }

    const nextInProgress = { ...this.state.inProgressAnswers };
    if (updatedMsgAnswers) {
      nextInProgress[messageId] = updatedMsgAnswers;
      if (this.state.activeSessionId) {
        this.draftOwners = { ...this.draftOwners, [messageId]: this.state.activeSessionId };
      }
    } else {
      delete nextInProgress[messageId];
    }

    this.persistDrafts(nextInProgress);
    this.notify();
  }

  public getInProgressAnswers(messageId: string): InProgressQuestionAnswers | undefined {
    return this.state.inProgressAnswers[messageId];
  }

  public clearInProgressAnswers(messageId: string, questionId?: string): void {
    if (!this.state.inProgressAnswers[messageId]) return;

    const nextInProgress = { ...this.state.inProgressAnswers };
    if (questionId) {
      const nextMsg = { ...nextInProgress[messageId] };
      delete nextMsg[questionId];
      if (Object.keys(nextMsg).length === 0) {
        delete nextInProgress[messageId];
      } else {
        nextInProgress[messageId] = nextMsg;
      }
    } else {
      delete nextInProgress[messageId];
    }

    this.persistDrafts(nextInProgress);
    this.notify();
  }

  public isSubmittingAnswer(messageId: string, questionId?: string): boolean {
    const msgSubmitting = this.state.submittingAnswers[messageId];
    if (!msgSubmitting) return false;
    if (questionId) {
      return msgSubmitting[questionId] === true;
    }
    return Object.values(msgSubmitting).some((v) => v === true);
  }

  private setSubmitting(messageId: string, questionId: string, isSubmitting: boolean): void {
    const nextSubmitting = { ...this.state.submittingAnswers };
    if (isSubmitting) {
      nextSubmitting[messageId] = {
        ...nextSubmitting[messageId],
        [questionId]: true,
      };
    } else {
      if (nextSubmitting[messageId]) {
        const nextMsg = { ...nextSubmitting[messageId] };
        delete nextMsg[questionId];
        if (Object.keys(nextMsg).length === 0) {
          delete nextSubmitting[messageId];
        } else {
          nextSubmitting[messageId] = nextMsg;
        }
      }
    }
    this.state.submittingAnswers = nextSubmitting;
  }

  /**
   * The draft store for one message's question blocks, for a `QuestionsDraftContext.Provider`.
   * Stable per message id, so the provider's value does not change identity on every render.
   */
  public questionDraftStore(messageId: string): QuestionsDraftStore {
    let store = this.questionDraftStores.get(messageId);
    if (!store) {
      store = {
        read: (blockKey) => this.questionDrafts.get(`${messageId}::${blockKey}`),
        write: (blockKey, state) => {
          this.questionDrafts.set(`${messageId}::${blockKey}`, state);
        },
        clear: (blockKey) => {
          this.questionDrafts.delete(`${messageId}::${blockKey}`);
        },
      };
      this.questionDraftStores.set(messageId, store);
    }
    return store;
  }

  /**
   * Applies a whole question block's answers in one call and then sends the summary as the next
   * user turn, which is what `ContentView`'s `OnAnswerQuestion` does:
   *
   * ```csharp
   * chatService.ApplyQuestionAnswers(e.Value.SessionId, e.Value.MessageId, e.Value.Answers);
   * ...
   * if (!string.IsNullOrWhiteSpace(e.Value.ResponseText))
   *     sendMessage(new ChatSendMessageDto(e.Value.ResponseText, SessionId: e.Value.SessionId));
   * ```
   *
   * One round trip for the block, not one per answered question: the answers were drafted locally
   * and Submit is what commits them. The summary is sent after the block is stored so the turn the
   * agent reads and the document it reads it from agree, and it goes through {@link sendMessage},
   * which parks it in the queue when a turn is already running.
   */
  public async submitAnswers(
    messageId: string,
    answers: Record<string, string[]>,
    responseText?: string,
  ): Promise<void> {
    if (!this.state.activeSessionId) return;

    const questionIds = Object.keys(answers);
    for (const questionId of questionIds) {
      this.setInProgressAnswer(messageId, questionId, answers[questionId]);
      this.setSubmitting(messageId, questionId, true);
    }

    // Optimistically patch in-memory message content
    if (this.state.activeSession) {
      const messages = this.state.activeSession.messages;
      const targetIndex = messages.findIndex((m) => m.id === messageId);
      if (targetIndex >= 0) {
        const targetMsg = messages[targetIndex];
        const pendingForMsg = this.getInProgressAnswers(messageId) ?? answers;
        messages[targetIndex] = {
          ...targetMsg,
          content: patchQuestionsMarkdown(targetMsg.content, pendingForMsg),
        };
      }
    }
    this.notify();

    const sessionId = this.state.activeSessionId;
    try {
      const updatedSession = await chatApi.answerQuestions(sessionId, messageId, answers);

      if (this.state.activeSessionId === updatedSession.id) {
        if (this.state.isGenerating && this.state.activeSession) {
          const mergedMessages = this.state.activeSession.messages.map((localMsg) => {
            const serverMsg = updatedSession.messages.find((m) => m.id === localMsg.id);
            if (!serverMsg) return localMsg;
            if (localMsg.content.length > serverMsg.content.length) {
              return {
                ...localMsg,
                content: mergeConfirmedQuestionsBlock(localMsg.content, serverMsg.content),
              };
            }
            return serverMsg;
          });
          for (const serverMsg of updatedSession.messages) {
            if (!mergedMessages.some((m) => m.id === serverMsg.id)) {
              mergedMessages.push(serverMsg);
            }
          }
          this.state.activeSession = {
            ...updatedSession,
            messages: mergedMessages,
          };
        } else {
          this.state.activeSession = updatedSession;
        }
      }
      const idx = this.state.sessions.findIndex((s) => s.id === updatedSession.id);
      if (idx >= 0) {
        this.state.sessions[idx] =
          this.state.activeSessionId === updatedSession.id && this.state.activeSession
            ? this.state.activeSession
            : updatedSession;
      }

      // Only drop a draft once the confirmed message content actually carries that answer.
      const targetMsg = this.state.activeSession?.messages.find((m) => m.id === messageId);
      if (targetMsg) {
        const questions = extractPlanQuestions(targetMsg.content);
        for (const questionId of questionIds) {
          const q = questions.find((item) => item.id === questionId);
          if (q && q.answerPresent) {
            this.clearInProgressAnswers(messageId, questionId);
          }
        }
      }
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      for (const questionId of questionIds) {
        this.setSubmitting(messageId, questionId, false);
      }
      this.notify();
    }

    // After the block is stored, never before: the follow-up turn is the agent being told what was
    // decided, and it must not read a document that has not caught up yet.
    if (responseText && responseText.trim()) {
      await this.sendMessage(responseText);
    }
  }

  /**
   * Rewrites a queued prompt in place. An empty prompt deletes the item, matching the legacy
   * widget: clearing the text of a queued message is how you drop it.
   */
  public async updateQueuedMessage(itemId: string, prompt: string): Promise<void> {
    if (!this.state.activeSessionId) return;
    const trimmed = prompt.trim();
    if (!trimmed) {
      await this.deleteQueuedMessage(itemId);
      return;
    }

    const previous = this.state.queuedItems;
    this.state.queuedItems = previous.map((item) =>
      item.id === itemId ? { ...item, prompt: trimmed } : item,
    );
    this.notify();

    try {
      await chatApi.updateQueuedItem(this.state.activeSessionId, itemId, trimmed);
    } catch (err) {
      this.state.queuedItems = previous;
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
    }
  }

  public async deleteQueuedMessage(itemId: string): Promise<void> {
    if (!this.state.activeSessionId) return;

    this.state.queuedItems = this.state.queuedItems.filter((item) => item.id !== itemId);
    this.notify();

    try {
      await chatApi.deleteQueuedItem(this.state.activeSessionId, itemId);
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
    }
  }
}

export const chatStore = new ChatStore();
