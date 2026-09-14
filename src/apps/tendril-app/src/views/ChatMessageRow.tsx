import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatBubble,
  ChatBubbleMessage,
  ChatBubbleAction,
  ChatBubbleActionWrapper,
} from "@ivy-interactive/components/renderers";
import { PlanMarkdown } from "@ivy-interactive/components/tendril";
import { Copy, FilePlus, Loader2, Paperclip } from "lucide-react";
import { chatStore } from "../state/chatStore";
import type { ChatMessage, InProgressQuestionAnswers } from "../types/chat";
import { isWriteInAnswer, patchQuestionsMarkdown } from "../utils/questionMarkdown";

export interface ChatMessageRowProps {
  message: ChatMessage;
  isCopied: boolean;
  onCopy: (message: ChatMessage) => void;
  onCreatePlan: (content: string) => void;
  inProgressAnswers?: InProgressQuestionAnswers;
  isSubmittingAnswer?: boolean;
}

export const ChatMessageRow: React.FC<ChatMessageRowProps> = React.memo(function ChatMessageRow({
  message,
  isCopied,
  onCopy,
  onCreatePlan,
  inProgressAnswers: propInProgressAnswers,
  isSubmittingAnswer: propIsSubmittingAnswer,
}) {
  const isUser = message.role === "user";

  const [, setTick] = useState(0);
  useEffect(() => {
    // If not controlled by parent props, subscribe to chatStore for this message
    if (propInProgressAnswers === undefined || propIsSubmittingAnswer === undefined) {
      return chatStore.subscribe(() => {
        setTick((t) => t + 1);
      });
    }
  }, [propInProgressAnswers, propIsSubmittingAnswer, message.id]);

  const pendingDebounceTimersRef = useRef<
    Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>
  >(new Map());

  // Flush all pending debounced commits immediately before unmounting so typed text is never lost
  useEffect(() => {
    return () => {
      const pending = Array.from(pendingDebounceTimersRef.current.values());
      pendingDebounceTimersRef.current.clear();
      for (const { timer, commit } of pending) {
        clearTimeout(timer);
        commit();
      }
    };
  }, []);

  const handleAnswersChange = useCallback(
    (eventName: string, _widgetId: string, args: unknown[]) => {
      if (eventName !== "OnAnswersChange") return;
      const payload = args[0] as
        | Array<{ questionId: string; answer: string[] | null }>
        | { questionId: string; answer: string[] | null };
      const items = Array.isArray(payload) ? payload : [payload];
      for (const item of items) {
        const hasPending = pendingDebounceTimersRef.current.has(item.questionId);
        const writeIn = isWriteInAnswer(message.content, item.questionId, item.answer, hasPending);

        if (writeIn) {
          const existing = pendingDebounceTimersRef.current.get(item.questionId);
          if (existing) {
            clearTimeout(existing.timer);
          }

          const commit = () => {
            pendingDebounceTimersRef.current.delete(item.questionId);
            chatStore.setInProgressAnswer(message.id, item.questionId, item.answer);
            void chatStore.submitAnswer(message.id, item.questionId, item.answer);
          };

          const timer = setTimeout(commit, 300);
          pendingDebounceTimersRef.current.set(item.questionId, { timer, commit });
        } else {
          const existing = pendingDebounceTimersRef.current.get(item.questionId);
          if (existing) {
            clearTimeout(existing.timer);
            pendingDebounceTimersRef.current.delete(item.questionId);
          }
          chatStore.setInProgressAnswer(message.id, item.questionId, item.answer);
          void chatStore.submitAnswer(message.id, item.questionId, item.answer);
        }
      }
    },
    [message.id, message.content],
  );

  const currentMessage =
    chatStore.getState().activeSession?.messages.find((m) => m.id === message.id) ?? message;
  const inProgressAnswers = isUser
    ? undefined
    : (propInProgressAnswers ?? chatStore.getInProgressAnswers(message.id));
  const isSubmitting = isUser
    ? false
    : (propIsSubmittingAnswer ?? chatStore.isSubmittingAnswer(message.id));
  const content = useMemo(() => {
    if (isUser || !inProgressAnswers) return currentMessage.content;
    return patchQuestionsMarkdown(currentMessage.content, inProgressAnswers);
  }, [isUser, currentMessage.content, inProgressAnswers]);

  return (
    <ChatBubble variant={isUser ? "sent" : "received"} layout={isUser ? "default" : "ai"}>
      <div className="flex flex-col max-w-3xl">
        <ChatBubbleMessage
          variant={isUser ? "sent" : "received"}
          className={
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border text-foreground"
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
              {isSubmitting && (
                <div
                  data-testid="submitting-answer-indicator"
                  className="flex items-center gap-1.5 text-xs text-success mt-2 font-medium"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Submitting answer...</span>
                </div>
              )}
            </div>
          )}

          {message.attachments && message.attachments.length > 0 && (
            <div
              data-testid="message-attachments"
              className={`mt-2 flex flex-wrap gap-1.5 pt-1.5 border-t ${
                isUser ? "border-success/40" : "border-border"
              }`}
            >
              {message.attachments.map((att, idx) => (
                <div
                  key={`${att.path}-${idx}`}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
                    isUser ? "bg-black/20 text-white/95" : "bg-muted text-muted-foreground"
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
            className={isCopied ? "text-success" : "text-muted-foreground"}
          />
          <button
            type="button"
            onClick={() => onCreatePlan(message.content)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-success px-2 py-1 rounded transition-colors"
            title="Create Plan from message"
          >
            <FilePlus className="size-3.5" />
            <span>Create Plan</span>
          </button>
        </ChatBubbleActionWrapper>
      </div>
    </ChatBubble>
  );
});

export default ChatMessageRow;
