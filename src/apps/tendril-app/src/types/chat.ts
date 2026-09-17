import type { AgentOption } from "./agents";

export interface ChatAttachment {
  name: string;
  path: string;
  mimeType?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  agentId?: string;
  modelId?: string;
  rawStream?: string;
  effort?: string;
  attachments?: ChatAttachment[];
}

export interface ChatQueuedItem {
  id: string;
  prompt: string;
  attachments?: ChatAttachment[];
  createdAt: string;
  /**
   * `system` for an event the daemon queued behind a turn that was already running — a job finishing
   * while the user was still talking. Absent for everything the composer enqueues, which is the
   * user's own prompts.
   */
  role?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentId?: string;
  modelId?: string;
  messages: ChatMessage[];
  effort?: string;
  spawnedJobIds: string[];
  planFolderName?: string;
  isPinned?: boolean;
  pinnedAt?: string;
}

export interface ChatMessageAddedEvent {
  type: "chat.message_added";
  sessionId: string;
  message: ChatMessage;
}

export interface ChatStreamDeltaEvent {
  type: "chat.stream_delta";
  sessionId: string;
  messageId: string;
  delta: string;
}

/**
 * One eventwire line of a turn in flight, so its tool calls render while they happen.
 *
 * `line` is a single `{"kind":…}` JSON event — the shape `parseEventWireStream` reads — and is
 * appended to the named message's `rawStream`. V1's equivalent is `ChatExecutionService`'s
 * `StreamLineEmitted`.
 */
export interface ChatStreamEventEvent {
  type: "chat.stream_event";
  sessionId: string;
  messageId: string;
  line: string;
}

export interface ChatGeneratingStateEvent {
  type: "chat.generating_state";
  sessionId: string;
  isGenerating: boolean;
}

export interface ChatQuestionAnsweredEvent {
  type: "chat.question_answered";
  sessionId: string;
  messageId: string;
  answers: Record<string, string[]>;
}

export interface ChatJobSpawnedEvent {
  type: "chat.job_spawned";
  sessionId: string;
  jobId: string;
}

export interface ChatSessionRenamedEvent {
  type: "chat.session_renamed";
  sessionId: string;
  title: string;
}

export type ChatEvent =
  | ChatMessageAddedEvent
  | ChatStreamDeltaEvent
  | ChatStreamEventEvent
  | ChatGeneratingStateEvent
  | ChatQuestionAnsweredEvent
  | ChatJobSpawnedEvent
  | ChatSessionRenamedEvent;

export type InProgressQuestionAnswers = Record<string, string[]>; // questionId -> answer values

export interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  /** The catalog behind the composer's agent picker; empty when it could not be fetched. */
  agents: AgentOption[];
  selectedAgentId: string;
  selectedModelId: string;
  selectedEffort: string;
  queuedItems: ChatQueuedItem[];
  isGenerating: boolean;
  isLoading: boolean;
  error: string | null;
  inProgressAnswers: Record<string, InProgressQuestionAnswers>; // messageId -> { questionId: answer[] }
  submittingAnswers: Record<string, Record<string, boolean>>; // messageId -> questionId -> boolean
}
