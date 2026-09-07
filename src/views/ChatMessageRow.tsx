import React, { useCallback, useMemo } from "react";
import {
  ChatBubble,
  ChatBubbleMessage,
  ChatBubbleAction,
  ChatBubbleActionWrapper,
} from "@spacecorps/components-storybook/renderers";
import { PlanMarkdown } from "@spacecorps/components-storybook/tendril";
import { Copy, FilePlus, Paperclip } from "lucide-react";
import { chatStore } from "../state/chatStore";
import type { ChatMessage } from "../types/chat";
import { patchQuestionsMarkdown } from "../utils/questionMarkdown";

export interface ChatMessageRowProps {
  message: ChatMessage;
  isCopied: boolean;
  onCopy: (message: ChatMessage) => void;
  onCreatePlan: (content: string) => void;
}

export const ChatMessageRow: React.FC<ChatMessageRowProps> = React.memo(
  function ChatMessageRow({ message, isCopied, onCopy, onCreatePlan }) {
    const isUser = message.role === "user";

    const handleAnswersChange = useCallback(
      (eventName: string, _widgetId: string, args: unknown[]) => {
        if (eventName !== "OnAnswersChange") return;
        const payload = args[0] as
          | Array<{ questionId: string; answer: string[] | null }>
          | { questionId: string; answer: string[] | null };
        const items = Array.isArray(payload) ? payload : [payload];
        for (const item of items) {
          chatStore.setInProgressAnswer(message.id, item.questionId, item.answer);
          chatStore.submitAnswer(message.id, item.questionId, item.answer);
        }
      },
      [message.id]
    );

    const inProgressAnswers = isUser ? undefined : chatStore.getInProgressAnswers(message.id);
    const content = useMemo(() => {
      if (isUser || !inProgressAnswers) return message.content;
      return patchQuestionsMarkdown(message.content, inProgressAnswers);
    }, [isUser, message.content, inProgressAnswers]);

    return (
      <ChatBubble variant={isUser ? "sent" : "received"} layout={isUser ? "default" : "ai"}>
        <div className="flex flex-col max-w-3xl">
          <ChatBubbleMessage
            variant={isUser ? "sent" : "received"}
            className={
              isUser
                ? "bg-emerald-600 text-white"
                : "bg-slate-900 border border-slate-800 text-slate-100"
            }
          >
            {isUser ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div>
            ) : (
              <div className="text-sm">
                <PlanMarkdown
                  id={`chat-msg-${message.id}`}
                  content={content}
                  events={["OnAnswersChange"]}
                  eventHandler={handleAnswersChange}
                />
              </div>
            )}

            {message.attachments && message.attachments.length > 0 && (
              <div
                data-testid="message-attachments"
                className={`mt-2 flex flex-wrap gap-1.5 pt-1.5 border-t ${
                  isUser ? "border-emerald-500/40" : "border-slate-800"
                }`}
              >
                {message.attachments.map((att, idx) => (
                  <div
                    key={`${att.path}-${idx}`}
                    className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                      isUser ? "bg-black/20 text-white/95" : "bg-slate-800 text-slate-300"
                    }`}
                    title={att.path}
                  >
                    <Paperclip className="size-3 opacity-75 shrink-0" />
                    <span className="max-w-[140px] truncate">{att.name}</span>
                  </div>
                ))}
              </div>
            )}
          </ChatBubbleMessage>

          {/* Action bar on message */}
          <ChatBubbleActionWrapper className={isUser ? "justify-end" : "justify-start"}>
            <ChatBubbleAction
              icon={<Copy className="size-3.5" />}
              onClick={() => onCopy(message)}
              className={isCopied ? "text-emerald-400" : "text-slate-400"}
            />
            <button
              type="button"
              onClick={() => onCreatePlan(message.content)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 px-2 py-1 rounded transition-colors"
              title="Create Plan from message"
            >
              <FilePlus className="size-3.5" />
              <span>Create Plan</span>
            </button>
          </ChatBubbleActionWrapper>
        </div>
      </ChatBubble>
    );
  }
);

export default ChatMessageRow;
