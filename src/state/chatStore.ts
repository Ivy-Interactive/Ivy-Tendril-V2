import { chatApi } from "../api/chatApi";
import { onChatEvent, type EventUnsubscribe } from "../api/events";
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  ChatSession,
  ChatState,
  InProgressQuestionAnswers,
} from "../types/chat";
import { patchQuestionsMarkdown } from "../utils/questionMarkdown";

export type { ChatState, InProgressQuestionAnswers } from "../types/chat";

const IN_PROGRESS_ANSWERS_STORAGE_KEY = "tendril:chat:in_progress_answers";

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

class ChatStore {
  private state: ChatState = {
    sessions: [],
    activeSessionId: null,
    activeSession: null,
    queuedItems: [],
    isGenerating: false,
    isLoading: false,
    error: null,
    inProgressAnswers: loadStoredInProgressAnswers(),
  };

  private listeners: Set<() => void> = new Set();
  private eventUnsubscribe: EventUnsubscribe | null = null;
  private storageListenerAttached = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.attachStorageListener();
    }
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
    this.attachStorageListener();
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
      queuedItems: [],
      isGenerating: false,
      isLoading: false,
      error: null,
      inProgressAnswers: {},
    };
    saveStoredInProgressAnswers({});
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
          if (event.answers) {
            for (const qId of Object.keys(event.answers)) {
              this.clearInProgressAnswers(event.messageId, qId);
            }
          } else {
            this.clearInProgressAnswers(event.messageId);
          }
          // Refresh session to get server-rendered answered state
          this.refreshActiveSession().catch(() => {});
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

  public async fetchSessions(): Promise<ChatSession[]> {
    this.state.isLoading = true;
    this.state.error = null;
    this.notify();

    try {
      const sessions = await chatApi.listSessions();
      this.state.sessions = sessions;
      this.state.isLoading = false;

      // Select first session if none active
      if (!this.state.activeSessionId && sessions.length > 0) {
        await this.selectSession(sessions[0].id);
      } else if (this.state.activeSessionId) {
        // Re-verify current active session still exists
        const exists = sessions.some((s) => s.id === this.state.activeSessionId);
        if (!exists && sessions.length > 0) {
          await this.selectSession(sessions[0].id);
        } else if (!exists) {
          this.state.activeSessionId = null;
          this.state.activeSession = null;
          this.state.queuedItems = [];
        }
      }

      this.notify();
      return sessions;
    } catch (err) {
      this.state.isLoading = false;
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      return [];
    }
  }

  public async selectSession(id: string): Promise<void> {
    this.state.activeSessionId = id;
    this.state.error = null;
    this.notify();

    try {
      const [session, queue] = await Promise.all([
        chatApi.getSession(id),
        chatApi.getQueue(id).catch(() => []),
      ]);
      this.state.activeSession = session;
      this.state.queuedItems = queue;
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
      this.state.activeSession = session;
      this.state.queuedItems = queue;

      // Also update in sessions list
      const idx = this.state.sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        this.state.sessions[idx] = session;
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
      const newSession = await chatApi.createSession({
        title,
        ...args,
      });
      this.state.sessions = [newSession, ...this.state.sessions];
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
      if (sessionInList) {
        sessionInList.title = updated.title;
        sessionInList.updatedAt = updated.updatedAt;
      }
      if (this.state.activeSession && this.state.activeSession.id === id) {
        this.state.activeSession.title = updated.title;
        this.state.activeSession.updatedAt = updated.updatedAt;
      }
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
      if (messageIds.size > 0) {
        const nextInProgress = { ...this.state.inProgressAnswers };
        let changed = false;
        for (const messageId of Object.keys(nextInProgress)) {
          if (messageIds.has(messageId)) {
            delete nextInProgress[messageId];
            changed = true;
          }
        }
        if (changed) {
          this.state.inProgressAnswers = nextInProgress;
          saveStoredInProgressAnswers(nextInProgress);
        }
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
      const hasOptions =
        options &&
        (options.enqueue !== undefined ||
          options.role !== undefined ||
          (options.attachments !== undefined && options.attachments.length > 0));
      const res = await chatApi.postMessage(sessionId, prompt, hasOptions ? options : undefined);
      if (res.queued) {
        const queue = await chatApi.getQueue(sessionId);
        this.state.queuedItems = queue;
        this.notify();
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
    } else {
      delete nextInProgress[messageId];
    }
    this.state.inProgressAnswers = nextInProgress;

    saveStoredInProgressAnswers(this.state.inProgressAnswers);
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

    this.state.inProgressAnswers = nextInProgress;

    saveStoredInProgressAnswers(this.state.inProgressAnswers);
    this.notify();
  }

  public async submitAnswer(
    messageId: string,
    questionId: string,
    answer: string | string[] | undefined | null,
  ): Promise<void> {
    if (!this.state.activeSessionId) return;

    // Immediately record into inProgressAnswers
    this.setInProgressAnswer(messageId, questionId, answer);

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
        this.state.activeSession = updatedSession;
      }
      const idx = this.state.sessions.findIndex((s) => s.id === updatedSession.id);
      if (idx >= 0) {
        this.state.sessions[idx] = updatedSession;
      }

      this.clearInProgressAnswers(messageId, questionId);
      this.notify();
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
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
