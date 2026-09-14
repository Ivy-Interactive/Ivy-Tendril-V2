import { agentsApi } from "../api/agentsApi";
import { chatApi } from "../api/chatApi";
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
  loadStoredAgentPreferences,
  loadStoredSelectedAgent,
  saveStoredAgentPreferences,
  saveStoredSelectedAgent,
  type AgentPreference,
  type AgentPreferences,
} from "./agentPreferences";
import {
  extractPlanQuestions,
  mergeConfirmedQuestionsBlock,
  patchQuestionsMarkdown,
} from "../utils/questionMarkdown";

export type { ChatState, InProgressQuestionAnswers } from "../types/chat";

const IN_PROGRESS_ANSWERS_STORAGE_KEY = "tendril:chat:in_progress_answers";
const DRAFT_OWNERS_STORAGE_KEY = "tendril:chat:draft_session_owners";
export const PINNED_SESSIONS_STORAGE_KEY = "tendril:chat:pinned_sessions";

/** The agent every chat runs with until the catalog says otherwise. */
export const FALLBACK_AGENT_ID = "claude";

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

export class ChatStore {
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
    isLoading: false,
    error: null,
    inProgressAnswers: loadStoredInProgressAnswers(),
    submittingAnswers: {},
  };

  private listeners: Set<() => void> = new Set();
  private eventUnsubscribe: EventUnsubscribe | null = null;
  private storageListenerAttached = false;
  private draftOwners: Record<string, string> = loadStoredDraftOwners();
  private pinnedSessions: Record<string, string> = loadStoredPinnedSessions();
  private agentPreferences: AgentPreferences = loadStoredAgentPreferences();

  constructor() {
    if (typeof window !== "undefined") {
      this.attachStorageListener();
    }
    this.applyAgentPreference(this.state.selectedAgentId);
  }

  private handleStorageEvent = (event: StorageEvent): void => {
    if (event.key === IN_PROGRESS_ANSWERS_STORAGE_KEY) {
      try {
        const next = event.newValue ? JSON.parse(event.newValue) : {};
        this.state.inProgressAnswers = next;
        this.notify();
      } catch {
        // Ignore malformed external writes
      }
    } else if (event.key === DRAFT_OWNERS_STORAGE_KEY) {
      try {
        this.draftOwners = event.newValue ? JSON.parse(event.newValue) : {};
      } catch {
        // Ignore malformed external writes
      }
    } else if (event.key === PINNED_SESSIONS_STORAGE_KEY) {
      try {
        this.pinnedSessions = event.newValue ? JSON.parse(event.newValue) : {};
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
  };

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
    this.listeners.forEach((l) => l());
  }

  public async init(): Promise<void> {
    this.state.inProgressAnswers = loadStoredInProgressAnswers();
    this.draftOwners = loadStoredDraftOwners();
    this.pinnedSessions = loadStoredPinnedSessions();
    this.attachStorageListener();
    await this.loadAgents();
    if (!this.eventUnsubscribe) {
      try {
        this.eventUnsubscribe = await onChatEvent((event) => {
          this.handleChatEvent(event);
        });
      } catch {
        // May fail in mock/testing environments without Tauri runtime
      }
    }
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

  /** Where an agent with no remembered preference starts: the head of each of its lists. */
  private agentDefaults(agentId: string): { modelId: string; effort: string } {
    const agent = this.agentById(agentId);
    return {
      modelId: agent?.models[0]?.id ?? DEFAULT_OPTION_ID,
      effort: agent?.efforts[0]?.id ?? DEFAULT_OPTION_ID,
    };
  }

  private applyAgentPreference(agentId: string): void {
    const preference = this.agentPreferences[agentId];
    const defaults = this.agentDefaults(agentId);
    this.state.selectedModelId = preference?.modelId ?? defaults.modelId;
    this.state.selectedEffort = preference?.effort ?? defaults.effort;
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

  public destroy(): void {
    this.detachStorageListener();
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
    }
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
      isLoading: false,
      error: null,
      inProgressAnswers: {},
      submittingAnswers: {},
    };
    saveStoredInProgressAnswers({});
    this.draftOwners = {};
    saveStoredDraftOwners({});
    this.pinnedSessions = {};
    saveStoredPinnedSessions({});
    this.agentPreferences = {};
    saveStoredAgentPreferences({});
    saveStoredSelectedAgent(null);
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
      if (this.state.isGenerating && this.state.activeSessionId === s.id) return false;
      return !s.messages || s.messages.length === 0;
    });

    if (toDelete.length === 0) return;

    const toDeleteIds = new Set(toDelete.map((s) => s.id));
    this.state.sessions = this.state.sessions.filter((s) => !toDeleteIds.has(s.id));
    if (this.state.activeSessionId && toDeleteIds.has(this.state.activeSessionId)) {
      this.state.activeSessionId = null;
      this.state.activeSession = null;
      this.state.queuedItems = [];
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
        if (!this.state.activeSession || this.state.activeSession.id !== event.sessionId) {
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
        this.state.isGenerating = true;
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
          messages[index] = event.message;
        } else {
          messages.push(event.message);
        }
        this.state.activeSession.updatedAt = event.message.timestamp || new Date().toISOString();
        this.notify();
        break;
      }

      case "chat.generating_state": {
        if (this.state.activeSessionId === event.sessionId) {
          this.state.isGenerating = event.isGenerating;
          this.notify();
        }
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
        if (this.state.activeSessionId === event.sessionId && this.state.activeSession) {
          if (!this.state.activeSession.spawnedJobIds.includes(event.jobId)) {
            this.state.activeSession.spawnedJobIds.push(event.jobId);
            this.notify();
          }
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
      const enriched = this.enrichSessionsWithPins(sessions);
      const sorted = this.sortSessions(enriched);
      this.state.sessions = sorted;
      this.state.isLoading = false;
      this.backfillDraftOwners(sorted);
      this.sweepDraftsForMissingSessions(sorted);

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

  public async selectSession(id: string): Promise<void> {
    const prevId = this.state.activeSessionId;
    const prevSession = this.state.activeSession;
    if (
      prevId &&
      prevId !== id &&
      prevSession &&
      prevSession.id === prevId &&
      (!prevSession.messages || prevSession.messages.length === 0) &&
      !this.state.isGenerating
    ) {
      await this.pruneEmptySessions(id);
    }

    this.state.activeSessionId = id;
    this.state.error = null;
    this.notify();

    try {
      const [session, queue] = await Promise.all([
        chatApi.getSession(id),
        chatApi.getQueue(id).catch(() => []),
      ]);
      const isPinned = Boolean(this.pinnedSessions[id]);
      session.isPinned = isPinned;
      session.pinnedAt = isPinned ? this.pinnedSessions[id] : undefined;

      this.state.activeSession = session;
      this.state.queuedItems = queue;
      this.backfillDraftOwners([session]);

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

  public async refreshActiveSession(): Promise<void> {
    if (!this.state.activeSessionId) return;
    try {
      const [session, queue] = await Promise.all([
        chatApi.getSession(this.state.activeSessionId),
        chatApi.getQueue(this.state.activeSessionId).catch(() => []),
      ]);
      const isPinned = Boolean(this.pinnedSessions[session.id]);
      session.isPinned = isPinned;
      session.pinnedAt = isPinned ? this.pinnedSessions[session.id] : undefined;

      if (this.state.isGenerating && this.state.activeSession) {
        const mergedMessages = session.messages.map((serverMsg) => {
          const localMsg = this.state.activeSession?.messages.find((m) => m.id === serverMsg.id);
          if (localMsg && localMsg.content.length > serverMsg.content.length) {
            return {
              ...localMsg,
              content: mergeConfirmedQuestionsBlock(localMsg.content, serverMsg.content),
            };
          }
          return serverMsg;
        });
        this.state.activeSession = {
          ...session,
          messages: mergedMessages,
        };
      } else {
        this.state.activeSession = session;
      }
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
        !this.state.isGenerating
      ) {
        await this.pruneEmptySessions();
      }

      // A session records its agent/model/effort, so the very first turn runs with the current
      // selection rather than the backend's defaults.
      const newSession = await chatApi.createSession({
        title,
        ...(args ?? this.turnOptions()),
      });
      newSession.isPinned = false;
      newSession.pinnedAt = undefined;
      this.state.sessions = this.sortSessions([newSession, ...this.state.sessions]);
      this.state.activeSessionId = newSession.id;
      this.state.activeSession = newSession;
      this.state.queuedItems = [];
      this.state.isGenerating = false;
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

      if (this.state.activeSessionId === id) {
        if (this.state.sessions.length > 0) {
          await this.selectSession(this.state.sessions[0].id);
        } else {
          this.state.activeSessionId = null;
          this.state.activeSession = null;
          this.state.queuedItems = [];
        }
      }

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

    if (!options?.enqueue) {
      // Optimistic user message
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: prompt,
        timestamp: new Date().toISOString(),
        attachments: options?.attachments,
      };
      if (this.state.activeSession) {
        this.state.activeSession.messages.push(userMsg);
      }
      this.state.isGenerating = true;
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
        // agent/model/effort selection; the execute route can.
        await chatApi.executeTurn(sessionId, { prompt, ...this.turnOptions() });
      }
    } catch (err) {
      this.state.isGenerating = false;
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  public async cancelGeneration(): Promise<void> {
    if (!this.state.activeSessionId) return;
    try {
      await chatApi.cancelTurn(this.state.activeSessionId);
      this.state.isGenerating = false;
      this.notify();
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
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

  public async submitAnswer(
    messageId: string,
    questionId: string,
    answer: string | string[] | undefined | null,
  ): Promise<void> {
    if (!this.state.activeSessionId) return;

    // Immediately record into inProgressAnswers and track submitting state
    this.setInProgressAnswer(messageId, questionId, answer);
    this.setSubmitting(messageId, questionId, true);

    const values =
      answer === undefined || answer === null
        ? []
        : Array.isArray(answer)
          ? answer.map(String)
          : answer === ""
            ? []
            : [String(answer)];

    const answersPayload: Record<string, string[]> = {
      [questionId]: values,
    };

    // Optimistically patch in-memory message content
    if (this.state.activeSession) {
      const messages = this.state.activeSession.messages;
      const targetIndex = messages.findIndex((m) => m.id === messageId);
      if (targetIndex >= 0) {
        const targetMsg = messages[targetIndex];
        const pendingForMsg = this.getInProgressAnswers(messageId) || { [questionId]: values };
        messages[targetIndex] = {
          ...targetMsg,
          content: patchQuestionsMarkdown(targetMsg.content, pendingForMsg),
        };
      }
    }
    this.notify();

    try {
      const updatedSession = await chatApi.answerQuestions(
        this.state.activeSessionId,
        messageId,
        answersPayload,
      );

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

      // Only clear inProgressAnswers once confirmed message content in activeSession actually contains the parsed answer
      const targetMsg = this.state.activeSession?.messages.find((m) => m.id === messageId);
      if (targetMsg) {
        const questions = extractPlanQuestions(targetMsg.content);
        const q = questions.find((item) => item.id === questionId);
        if (q && q.answerPresent) {
          this.clearInProgressAnswers(messageId, questionId);
        }
      }
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.setSubmitting(messageId, questionId, false);
      this.notify();
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
