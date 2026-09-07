import { invoke } from "@tauri-apps/api/core";
import type {
  ChatAttachment,
  ChatQueuedItem,
  ChatSession,
} from "../types/chat";

export const chatApi = {
  async listSessions(): Promise<ChatSession[]> {
    return await invoke<ChatSession[]>("cmd_list_chat_sessions");
  },

  async createSession(args?: {
    title?: string;
    agentId?: string;
    modelId?: string;
    effort?: string;
  }): Promise<ChatSession> {
    return await invoke<ChatSession>("cmd_create_chat_session", { req: args });
  },

  async getSession(id: string): Promise<ChatSession> {
    return await invoke<ChatSession>("cmd_get_chat_session", { id });
  },

  async updateSession(id: string, title: string): Promise<ChatSession> {
    return await invoke<ChatSession>("cmd_update_chat_session", { id, title });
  },

  async deleteSession(id: string): Promise<void> {
    await invoke("cmd_delete_chat_session", { id });
  },

  async postMessage(
    id: string,
    prompt: string,
    options?: {
      enqueue?: boolean;
      attachments?: ChatAttachment[];
      role?: string;
    }
  ): Promise<{ started?: boolean; queued?: boolean; id?: string }> {
    return await invoke<{ started?: boolean; queued?: boolean; id?: string }>(
      "cmd_post_chat_message",
      {
        id,
        req: {
          prompt,
          enqueue: options?.enqueue,
          attachments: options?.attachments,
          role: options?.role,
        },
      }
    );
  },

  async executeTurn(
    id: string,
    options?: {
      prompt?: string;
      agentId?: string;
      modelId?: string;
      effort?: string;
    }
  ): Promise<void> {
    await invoke("cmd_execute_chat_turn", { id, req: options });
  },

  async cancelTurn(id: string): Promise<{ cancelled: boolean }> {
    const cancelled = await invoke<boolean>("cmd_cancel_chat_turn", { id });
    return { cancelled };
  },

  async answerQuestions(
    sessionId: string,
    messageId: string,
    answers: Record<string, string[]>
  ): Promise<ChatSession> {
    return await invoke<ChatSession>("cmd_answer_chat_questions", {
      sessionId,
      messageId,
      answers,
    });
  },

  async getQueue(id: string): Promise<ChatQueuedItem[]> {
    return await invoke<ChatQueuedItem[]>("cmd_get_chat_queue", { id });
  },

  async enqueueItem(
    id: string,
    prompt: string,
    attachments?: ChatAttachment[]
  ): Promise<ChatQueuedItem> {
    return await invoke<ChatQueuedItem>("cmd_enqueue_chat_message", {
      id,
      req: { prompt, attachments },
    });
  },

  async clearQueue(id: string): Promise<void> {
    await invoke("cmd_clear_chat_queue", { id });
  },

  async deleteQueuedItem(sessionId: string, itemId: string): Promise<void> {
    await invoke("cmd_delete_queued_chat_item", { sessionId, itemId });
  },
};
